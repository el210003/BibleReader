// Spike 04 — per-request length limit. Feed increasingly long Chinese passages and
// measure whether the engine synthesizes all of it, and where it breaks.
import { getChapter, stripHtml, normalizeCjkSpacing, synthesize, parseBoundaries, parseMp3, sleep } from './lib.mjs';

const verses = await getChapter('CUV', 19, 119); // Psalm 119
const norm = verses.map(v => normalizeCjkSpacing(stripHtml(v.text)).text);
console.log('Psalm 119 verses:', norm.length, 'total chars:', norm.reduce((a, s) => a + s.length, 0));

for (const n of [5, 10, 20, 30, 60]) {
  const text = norm.slice(0, n).join('');
  await sleep(700);
  const t0 = Date.now();
  try {
    const { audio, metaChunks } = await synthesize({ voice: 'zh-TW-HsiaoChenNeural', voiceLocale: 'zh-TW', text });
    const mp3 = parseMp3(audio);
    const words = parseBoundaries(metaChunks).filter(b => b.type === 'WordBoundary');
    const last = words.at(-1);
    const covered = words.reduce((a, b) => a + (b.text?.length ?? 0), 0);
    console.log(`chars=${text.length} -> audio=${mp3.durationMs}ms bytes=${audio.length} wall=${Date.now()-t0}ms words=${words.length} charsCovered=${covered} (${((covered/text.length)*100).toFixed(1)}%) lastEnd=${last ? Math.round(last.offsetMs + last.durationMs) : '-'}ms`);
  } catch (e) {
    console.log(`chars=${text.length} -> FAILED after ${Date.now()-t0}ms: ${e.message}`);
  }
  await sleep(700);
}
