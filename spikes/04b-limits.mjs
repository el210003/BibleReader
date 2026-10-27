import { getChapter, stripHtml, normalizeCjkSpacing, synthesize, parseBoundaries, parseMp3, sleep } from './lib.mjs';
const verses = await getChapter('CUV', 19, 119);
const norm = verses.map(v => normalizeCjkSpacing(stripHtml(v.text)).text);
const joined = norm.join('');
console.log('total available chars:', joined.length);

const sizes = [700, 900, 1100, 1256, 1500, 2000];
for (const n of sizes) {
  const text = joined.slice(0, n);
  await sleep(900);
  const t0 = Date.now();
  try {
    const { audio, metaChunks } = await synthesize({ voice: 'zh-TW-HsiaoChenNeural', voiceLocale: 'zh-TW', text, timeoutMs: 120000 });
    const mp3 = parseMp3(audio);
    const words = parseBoundaries(metaChunks).filter(b => b.type === 'WordBoundary');
    const last = words.at(-1);
    console.log(`chars=${n} OK audio=${mp3.durationMs}ms words=${words.length} lastEnd=${last ? Math.round(last.offsetMs+last.durationMs) : '-'} wall=${Date.now()-t0}ms`);
  } catch (e) {
    console.log(`chars=${n} FAILED wall=${Date.now()-t0}ms: ${e.message}`);
  }
  await sleep(900);
}

// latency variance on a realistic verse-sized request
console.log('\n--- latency variance, 40-char Chinese verse ---');
const t = norm[0].slice(0, 40);
for (let i = 0; i < 4; i++) {
  await sleep(900);
  const t0 = Date.now();
  try {
    const { audio } = await synthesize({ voice: 'zh-TW-HsiaoChenNeural', voiceLocale: 'zh-TW', text: t });
    const mp3 = parseMp3(audio);
    console.log(`  run ${i + 1}: wall=${Date.now()-t0}ms audio=${mp3.durationMs}ms`);
  } catch (e) { console.log(`  run ${i + 1}: FAILED ${e.message}`); }
}
