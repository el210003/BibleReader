// Spike 11 — Hebrew feasibility: scripture source, RTL metadata, Edge voices,
// word-boundary mapping, and font coverage.

import { getChapter, stripHtml, synthesize, parseBoundaries, parseMp3, sleep } from './lib.mjs';

const HEBREW = /[\u0590-\u05FF]/;
const NIQQUD = /[\u0591-\u05C7]/; // vowel points + cantillation

const j = async (u) => {
  const r = await fetch(u, { headers: { 'User-Agent': 'BibleReader/0.1 (spike)' } });
  if (!r.ok) throw new Error(`${u} ${r.status}`);
  return r.json();
};

// 1) does the provider expose Hebrew translations, and do they carry a dir flag?
const langs = await j('https://bolls.life/static/bolls/app/views/languages.json');
const he = langs.find((l) => /hebrew|עברית/i.test(l.language || ''));
console.log('[source] Hebrew group:', he ? he.language : 'MISSING');
if (he) {
  console.log('[source] translations:', he.translations.map((t) => `${t.short_name}${t.dir ? '(dir=' + t.dir + ')' : ''}`).join(', '));
}

// 2) what does a Hebrew chapter actually look like?
const verses = await getChapter('WLC', 1, 1);
const v1 = verses[0];
const raw = stripHtml(v1.text);
const chars = [...raw];
console.log('[text] verses in chapter:', verses.length, '| v1 raw chars:', raw.length);
console.log('[text] hebrew codepoints:', chars.filter((c) => HEBREW.test(c)).length,
  '| niqqud/te\'amim:', chars.filter((c) => NIQQUD.test(c)).length);
console.log('[text] sample:', JSON.stringify(raw.slice(0, 60)));
console.log('[text] has html markup:', /<[a-z]/i.test(v1.text));

// 3) voices
const voices = await j('https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4');
const heVoices = voices.filter((v) => v.Locale.toLowerCase().startsWith('he'));
console.log('[voices] he-* available:', heVoices.length, heVoices.map((v) => `${v.ShortName}/${v.Gender}`).join(', '));

// 4) synthesis + boundary mapping on a real Hebrew verse
if (heVoices.length) {
  const voice = heVoices[0];
  await sleep(600);
  const t0 = Date.now();
  const { audio, metaChunks } = await synthesize({ voice: voice.ShortName, voiceLocale: voice.Locale, text: raw });
  const mp3 = parseMp3(audio);
  const words = parseBoundaries(metaChunks).filter((b) => b.type === 'WordBoundary');

  let cursor = 0, mapped = 0, unmapped = 0;
  const spans = [];
  for (const b of words) {
    if (!b.text) { unmapped++; continue; }
    const idx = raw.indexOf(b.text, cursor);
    if (idx < 0) { unmapped++; continue; }
    spans.push({ start: idx, end: idx + b.text.length, tMs: Math.round(b.offsetMs) });
    cursor = idx + b.text.length;
    mapped++;
  }
  const covered = new Set();
  for (const s of spans) for (let i = s.start; i < s.end; i++) covered.add(i);

  console.log('[tts] voice:', voice.ShortName, '| wall:', Date.now() - t0, 'ms | audio:', mp3.durationMs, 'ms');
  console.log('[tts] boundaries:', words.length, '| mapped:', mapped, '| unmapped:', unmapped,
    '| char coverage:', ((covered.size / raw.length) * 100).toFixed(1) + '%');
  console.log('[tts] first boundary texts:', words.slice(0, 6).map((b) => b.text).join(' | '));
  console.log('[tts] first spans:', JSON.stringify(spans.slice(0, 4)));
}

// 5) font coverage: the bundled CJK subset cannot render Hebrew
const fonts = [
  ['https://github.com/notofonts/hebrew/raw/main/fonts/NotoSerifHebrew/hinted/ttf/NotoSerifHebrew-Regular.ttf', 'Noto Serif Hebrew (TTF)'],
];
for (const [url, label] of fonts) {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    console.log('[font]', label, r.status, r.headers.get('content-length'), 'bytes');
  } catch (e) {
    console.log('[font]', label, 'FAILED', String(e).slice(0, 60));
  }
}
