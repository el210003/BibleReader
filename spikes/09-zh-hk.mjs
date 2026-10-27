// Spike 09 — zh-HK (Cantonese) voices against written-Chinese scripture.
// Question: do zh-HK voices synthesize CUV text, and do their word boundaries map onto
// the verse the same way zh-TW's did? Audio quality can't be judged here — only that the
// pipeline holds and the voice set is real.

import { getChapter, stripHtml, normalizeCjkSpacing, synthesize, parseBoundaries, parseMp3, sleep } from './lib.mjs';

const verses = await getChapter('CUV', 43, 3);
const v16 = verses.find((v) => v.verse === 16);
const text = normalizeCjkSpacing(stripHtml(v16.text)).text;
console.log('verse:', text);

const voices = [
  { name: 'zh-HK-HiuGaaiNeural', locale: 'zh-HK' },
  { name: 'zh-HK-HiuMaanNeural', locale: 'zh-HK' },
  { name: 'zh-HK-WanLungNeural', locale: 'zh-HK' },
  { name: 'zh-TW-HsiaoChenNeural', locale: 'zh-TW' }, // control
];

const rows = [];
for (const v of voices) {
  await sleep(800);
  const t0 = Date.now();
  try {
    const { audio, metaChunks } = await synthesize({ voice: v.name, voiceLocale: v.locale, text });
    const mp3 = parseMp3(audio);
    const all = parseBoundaries(metaChunks);
    const words = all.filter((b) => b.type === 'WordBoundary');

    // sequential mapping, same algorithm the app uses
    let cursor = 0, mapped = 0, unmapped = 0;
    const spans = [];
    for (const b of words) {
      if (!b.text) { unmapped++; continue; }
      const idx = text.indexOf(b.text, cursor);
      if (idx < 0) { unmapped++; continue; }
      spans.push({ start: idx, end: idx + b.text.length, tMs: Math.round(b.offsetMs) });
      cursor = idx + b.text.length;
      mapped++;
    }
    const covered = new Set();
    for (const s of spans) for (let i = s.start; i < s.end; i++) covered.add(i);

    rows.push({
      voice: v.name,
      locale: v.locale,
      ok: true,
      wallMs: Date.now() - t0,
      audioMs: mp3.durationMs,
      words: words.length,
      mapped,
      unmapped,
      coveragePct: Number(((covered.size / text.length) * 100).toFixed(1)),
      sampleWords: words.slice(0, 8).map((b) => b.text).join(' | '),
    });
    console.log(`[${v.name}] ok wall=${rows.at(-1).wallMs}ms audio=${mp3.durationMs}ms words=${words.length} mapped=${mapped} unmapped=${unmapped} coverage=${rows.at(-1).coveragePct}%`);
    console.log(`         segments: ${rows.at(-1).sampleWords}`);
  } catch (e) {
    rows.push({ voice: v.name, locale: v.locale, ok: false, error: String(e.message) });
    console.log(`[${v.name}] FAILED: ${e.message}`);
  }
}

console.log('\n=== JSON ===');
console.log(JSON.stringify(rows, null, 2));
