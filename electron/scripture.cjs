// Scripture provider + normalization. Shared logic, used by the main process.
// M0 scope: bolls.life only, four translations. The provider adapter interface and the
// getBible fallback are M1 work.

const books = require('./books.cjs');
const cache = require('./cache.cjs');

const UA = 'BibleReader/0.1 (+https://github.com/bible-reader)';

const booksCache = new Map();

async function getBooks(translation) {
  const meta = TRANSLATIONS[translation];
  if (!meta) throw new Error(`unknown translation ${translation}`);
  if (booksCache.has(translation)) return booksCache.get(translation);

  const res = await fetch(`https://bolls.life/get-books/${translation}/`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`bolls.life books ${res.status} ${res.statusText}`);
  const rows = await res.json();

  const out = rows.map((b) => {
    const section = books.sectionOf(b.bookid);
    return {
      id: b.bookid,
      chapters: b.chapters,
      // provider names are unreliable for display (CUV returns Simplified, WEB has apocrypha)
      name: books.localizedBookName(b.bookid, meta.lang, b.name),
      providerName: b.name,
      section,
    };
  });
  const result = { books: out, sections: books.sectionLabels(meta.lang) };
  booksCache.set(translation, result);
  return result;
}

// Voice catalogue. zh-HK (Cantonese) voices read the same written-Chinese text: Hong Kong
// churches read 和合本 in Cantonese, so the characters are pronounced in Cantonese rather
// than translated. It is a voice variant, not a separate translation.
const ZH_HANT_VOICES = [
  { id: 'zh-TW-HsiaoChenNeural', locale: 'zh-TW', label: '台灣華語 · 女聲 HsiaoChen' },
  { id: 'zh-TW-YunJheNeural', locale: 'zh-TW', label: '台灣華語 · 男聲 YunJhe' },
  { id: 'zh-TW-HsiaoYuNeural', locale: 'zh-TW', label: '台灣華語 · 女聲 HsiaoYu' },
  { id: 'zh-HK-HiuGaaiNeural', locale: 'zh-HK', label: '粵語 · 女聲 HiuGaai' },
  { id: 'zh-HK-HiuMaanNeural', locale: 'zh-HK', label: '粵語 · 女聲 HiuMaan' },
  { id: 'zh-HK-WanLungNeural', locale: 'zh-HK', label: '粵語 · 男聲 WanLung' },
];

const TRANSLATIONS = {
  CUV: {
    name: '和合本 (繁體)',
    lang: 'zh-Hant',
    voices: ZH_HANT_VOICES,
    defaultVoice: 'zh-TW-HsiaoChenNeural',
  },
  CUNP: {
    name: '新標點和合本',
    lang: 'zh-Hant',
    voices: ZH_HANT_VOICES,
    defaultVoice: 'zh-TW-HsiaoChenNeural',
  },
  WEB: {
    name: 'World English Bible',
    lang: 'en',
    voices: [
      { id: 'en-US-AvaNeural', locale: 'en-US', label: 'English US · Female Ava' },
      { id: 'en-US-AndrewNeural', locale: 'en-US', label: 'English US · Male Andrew' },
      { id: 'en-GB-SoniaNeural', locale: 'en-GB', label: 'English UK · Female Sonia' },
    ],
    defaultVoice: 'en-US-AvaNeural',
  },
  RV1960: {
    name: 'Reina-Valera 1960',
    lang: 'es',
    voices: [
      { id: 'es-ES-ElviraNeural', locale: 'es-ES', label: 'Español ES · Elvira' },
      { id: 'es-ES-AlvaroNeural', locale: 'es-ES', label: 'Español ES · Álvaro' },
      { id: 'es-MX-DaliaNeural', locale: 'es-MX', label: 'Español MX · Dalia' },
      { id: 'es-MX-JorgeNeural', locale: 'es-MX', label: 'Español MX · Jorge' },
    ],
    defaultVoice: 'es-ES-ElviraNeural',
  },
  FRLSG: {
    name: 'Segond 1910',
    lang: 'fr',
    voices: [
      { id: 'fr-FR-DeniseNeural', locale: 'fr-FR', label: 'Français FR · Denise' },
      { id: 'fr-FR-HenriNeural', locale: 'fr-FR', label: 'Français FR · Henri' },
      { id: 'fr-CA-SylvieNeural', locale: 'fr-CA', label: 'Français CA · Sylvie' },
    ],
    defaultVoice: 'fr-FR-DeniseNeural',
  },
};

// Region detection. `app.getLocale()` is NOT usable for this: Chromium normalises
// zh-HK to zh-TW at the UI-locale level (verified: --lang=zh-HK yields getLocale()==='zh-TW').
// The reliable signal is the preferred-language list, which keeps the full tag
// (e.g. 'zh-Hant-HK').
const HK_TAGS = /^(zh-hk|zh-hant-hk|zh-mo|zh-hant-mo|yue)(-|$)/i;

function regionFromLocales(locales) {
  const list = (Array.isArray(locales) ? locales : [locales]).map((l) => String(l || ''));
  return list.some((l) => HK_TAGS.test(l)) ? 'zh-HK' : 'zh-TW';
}

// First-run defaults. The shipped default scripture language is Chinese (和合本), as
// specified — an English or Spanish OS locale still opens in 和合本. What the locale does
// decide is which Chinese voice: Hong Kong / Macau readers get Cantonese (zh-HK),
// everyone else gets Mandarin (zh-TW). Everything is overridable and then persisted.
function defaultsForLocale(locales) {
  const region = regionFromLocales(locales);
  return region === 'zh-HK'
    ? { translation: 'CUV', voice: 'zh-HK-HiuGaaiNeural', region }
    : { translation: 'CUV', voice: 'zh-TW-HsiaoChenNeural', region };
}

// When the reader switches translation, prefer a voice matching one of their locales
// (es-MX reader -> es-MX voice, zh-HK reader -> Cantonese), else the translation default.
function pickVoiceForLocale(voices, locales, fallbackId) {
  const list = (Array.isArray(locales) ? locales : [locales]).map((l) => String(l || '').toLowerCase());
  for (const l of list) {
    const exact = voices.find((v) => v.locale.toLowerCase() === l);
    if (exact) return exact.id;
  }
  for (const l of list) {
    // take the last subtag: 'zh-hant-hk' -> 'hk', not 'hant'
    const region = l.split('-').pop();
    if (!region || region === l) continue;
    const sameRegion = voices.find((v) => v.locale.toLowerCase().endsWith('-' + region));
    if (sameRegion) return sameRegion.id;
  }
  return fallbackId;
}

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

  // cache-first: a previously read chapter works offline
  const cached = cache.getChapter(translation, book, chapter);
  if (cached) return { verses: cached.verses, fromCache: true, fetchedAt: cached.fetchedAt };

  const res = await fetch(`https://bolls.life/get-text/${translation}/${book}/${chapter}/`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`bolls.life ${res.status} ${res.statusText}`);
  const rows = await res.json();
  const verses = rows.map((r) => {
    const raw = stripHtml(r.text);
    const norm = normalizeText(raw);
    return {
      verse: r.verse,
      text: norm.text,
      // markup flags so the reader can style supplied words (CUNP/CUNPS)
      hasSuppliedWords: raw.includes('\u0001'),
      rawLen: raw.length,
      removedSpaces: norm.removedSpaces,
    };
  });

  cache.putChapter(translation, book, chapter, verses);
  return { verses, fromCache: false, fetchedAt: Date.now() };
}

module.exports = {
  getChapter,
  normalizeText,
  stripHtml,
  defaultsForLocale,
  pickVoiceForLocale,
  regionFromLocales,
  getBooks,
  TRANSLATIONS,
};
