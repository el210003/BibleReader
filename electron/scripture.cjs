// Scripture provider + normalization. Shared logic, used by the main process.
// M0 scope: bolls.life only, four translations. The provider adapter interface and the
// getBible fallback are M1 work.

const UA = 'BibleReader/0.1 (+https://github.com/bible-reader)';

const TRANSLATIONS = {
  CUV: { name: '和合本 (繁體)', lang: 'zh-Hant', voice: 'zh-TW-HsiaoChenNeural', locale: 'zh-TW' },
  CUNP: { name: '新標點和合本', lang: 'zh-Hant', voice: 'zh-TW-HsiaoChenNeural', locale: 'zh-TW' },
  WEB: { name: 'World English Bible', lang: 'en', voice: 'en-US-AvaNeural', locale: 'en-US' },
  RV1960: { name: 'Reina-Valera 1960', lang: 'es', voice: 'es-ES-ElviraNeural', locale: 'es-ES' },
  FRLSG: { name: 'Segond 1910', lang: 'fr', voice: 'fr-FR-DeniseNeural', locale: 'fr-FR' },
};

const BOOKS = [
  { id: 1, name: 'Genesis' },
  { id: 19, name: 'Psalms' },
  { id: 43, name: 'John' },
  { id: 45, name: 'Romans' },
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function stripHtml(html) {
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

const isHan = (ch) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
const CJK_PUNCT = '，。、；：！？「」『』（）〈〉《》…—·～';
const isCjkPunct = (ch) => CJK_PUNCT.includes(ch);

// CUV (1919) is served character-separated: collapse spaces between CJK glyphs only.
// Verified in M0: 71 chars -> 36, offset map integrity holds.
function normalizeText(raw) {
  const out = [];
  let removed = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === ' ' || ch === '\t') {
      const prev = raw[i - 1];
      const next = raw[i + 1];
      if ((isHan(prev) || isCjkPunct(prev)) && (isHan(next) || isCjkPunct(next))) {
        removed++;
        continue;
      }
      if (out.length && out[out.length - 1] === ' ') continue;
      out.push(' ');
      continue;
    }
    out.push(ch);
  }
  return { text: out.join('').trim(), removedSpaces: removed };
}

async function getChapter({ translation, book, chapter }) {
  if (!TRANSLATIONS[translation]) throw new Error(`unknown translation ${translation}`);
  const res = await fetch(`https://bolls.life/get-text/${translation}/${book}/${chapter}/`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`bolls.life ${res.status} ${res.statusText}`);
  const rows = await res.json();
  return rows.map((r) => {
    const raw = stripHtml(r.text);
    const norm = normalizeText(raw);
    return {
      verse: r.verse,
      text: norm.text,
      // markup flags so the reader can style supplied words (CUNP/CUNPS)
      hasSuppliedWords: /\u0001/.test(raw),
      rawLen: raw.length,
      removedSpaces: norm.removedSpaces,
    };
  });
}

module.exports = { getChapter, normalizeText, stripHtml, TRANSLATIONS, BOOKS };
