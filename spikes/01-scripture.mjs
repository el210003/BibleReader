// Spike 01 — Scripture fetch + CJK normalization + offset integrity.
// Question: does bolls.life CUV really serve character-separated text, and can we
// normalize it into a string whose character offsets are stable and reversible?

const UA = 'BibleReader/0.1 (spike; +https://github.com/bible-reader)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- fetch ----------
async function getChapter(translation, book, chapter) {
  const url = `https://bolls.life/get-text/${translation}/${book}/${chapter}/`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${translation} ${res.status} ${res.statusText}`);
  return res.json();
}

// ---------- html -> text ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function stripHtml(html) {
  // keep inline emphasis markers so the reader can style supplied words later
  let s = String(html)
    .replace(/<i>([\s\S]*?)<\/i>/gi, '\u0001$1\u0002')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '\u0001$1\u0002')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '');
  s = s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return s;
}

// ---------- cjk classification ----------
const isHan = (ch) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
const CJK_PUNCT = '，。、；：！？「」『』（）〈〉《》…—·～';
const isCjkPunct = (ch) => CJK_PUNCT.includes(ch);
const isCjkish = (ch) => !!ch && (isHan(ch) || isCjkPunct(ch) || /\s/.test(ch) === false && /[\uff00-\uffef]/.test(ch));

// ---------- normalization ----------
// CUV (1919 和合本) arrives with a space between every glyph. Collapse spaces that sit
// between two CJK-ish glyphs; keep spaces that separate Latin words.
function normalizeCjkSpacing(raw) {
  const out = [];
  const map = []; // normalized index -> raw index
  let removed = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === ' ' || ch === '\t') {
      const prev = raw[i - 1];
      const next = raw[i + 1];
      const cjkBoundary = (isHan(prev) || isCjkPunct(prev)) && (isHan(next) || isCjkPunct(next));
      if (cjkBoundary) {
        removed++;
        continue;
      }
      // collapse runs of whitespace to a single space
      if (out.length && out[out.length - 1] === ' ') continue;
      out.push(' ');
      map.push(i);
      continue;
    }
    out.push(ch);
    map.push(i);
  }

  return { text: out.join('').trim(), map, removed };
}

function cjkDensity(text) {
  const han = [...text].filter(isHan).length;
  const spaces = [...text].filter((c) => c === ' ').length;
  return { han, spaces, ratio: han ? spaces / han : 0 };
}

// ---------- main ----------
const BOOK = 43, CHAPTER = 3, VERSE = 16;
const TRANSLATIONS = ['CUV', 'CUNP', 'CUNPS', 'PCB', 'ChiSB', 'WEB', 'RV1960', 'FRLSG'];

const report = [];

for (const t of TRANSLATIONS) {
  let verses;
  try {
    verses = await getChapter(t, BOOK, CHAPTER);
  } catch (err) {
    report.push({ translation: t, error: String(err.message) });
    console.log(`[${t}] FETCH FAILED: ${err.message}`);
    await sleep(400);
    continue;
  }

  const v16 = verses.find((x) => x.verse === VERSE);
  if (!v16) {
    console.log(`[${t}] no verse 16 (got ${verses.length} verses)`);
    await sleep(400);
    continue;
  }

  const raw = stripHtml(v16.text);
  const density = cjkDensity(raw);
  const norm = normalizeCjkSpacing(raw);

  // Integrity check: normalized text must be a subsequence of raw at the mapped indices.
  let mapOk = true;
  for (let i = 0; i < norm.text.length; i++) {
    if (raw[norm.map[i]] !== norm.text[i]) { mapOk = false; break; }
  }

  // Highlight sanity: pick the offset of a known phrase in the normalized text.
  const probe = t.startsWith('CUV') || t === 'CUNP' || t === 'CUNPS' ? '獨生子' : null;
  const probeIdx = probe ? norm.text.indexOf(probe) : -1;
  const probeRawIdx = probeIdx >= 0 ? norm.map[probeIdx] : -1;
  const probeRawOk = probeIdx >= 0 ? raw.slice(probeRawIdx, probeRawIdx + probe.length) === probe : null;

  report.push({
    translation: t,
    verses: verses.length,
    rawLen: raw.length,
    han: density.han,
    spacesInRaw: density.spaces,
    spacePerHan: Number(density.ratio.toFixed(2)),
    removedSpaces: norm.removed,
    normLen: norm.text.length,
    mapOk,
    probe,
    probeIdx,
    probeRawIdx,
    probeRawOk,
    inlineMarkup: /\u0001/.test(raw),
    sampleRaw: raw.slice(0, 40),
    sampleNorm: norm.text.slice(0, 40),
  });

  console.log(
    `[${t}] raw=${raw.length} han=${density.han} spaces=${density.spaces} removed=${norm.removed} ` +
    `norm=${norm.text.length} mapOk=${mapOk} probeRawOk=${probeRawOk} markup=${/\u0001/.test(raw)}`
  );
  console.log(`      raw : ${raw.slice(0, 46)}`);
  console.log(`      norm: ${norm.text.slice(0, 46)}`);

  await sleep(400); // provider etiquette
}

console.log('\n=== JSON ===');
console.log(JSON.stringify(report, null, 2));
