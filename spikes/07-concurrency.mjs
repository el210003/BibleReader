// Spike 07 — concurrency / throttling. Every earlier spike was strictly sequential
// (one request at a time, 700-900ms apart). The real app overlaps requests: prefetch
// verse N+1 while N plays, fast clicking, chapter prefetch. Question: how many parallel
// synthesis requests before Edge Read Aloud pushes back (403 / throttle / socket errors)?

import { getChapter, stripHtml, normalizeCjkSpacing, synthesize, parseBoundaries, parseMp3, sleep } from './lib.mjs';

const verses = await getChapter('CUV', 43, 3);
const texts = verses.slice(0, 12).map((v) => normalizeCjkSpacing(stripHtml(v.text)).text);

async function runLevel(n) {
  const batch = texts.slice(0, n);
  const t0 = Date.now();
  const results = await Promise.allSettled(
    batch.map((text) => synthesize({ voice: 'zh-TW-HsiaoChenNeural', voiceLocale: 'zh-TW', text, timeoutMs: 45000 }))
  );
  const wall = Date.now() - t0;

  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  const latencies = ok.map((r) => parseMp3(r.value.audio).durationMs);
  const words = ok.map((r) => parseBoundaries(r.value.metaChunks).filter((b) => b.type === 'WordBoundary').length);

  console.log(`\nconcurrency=${n}: wall=${wall}ms ok=${ok.length}/${n} failed=${failed.length}`);
  console.log(`  audio durations: ${latencies.join(', ')}ms`);
  console.log(`  word boundaries per request: ${words.join(', ')}`);
  for (const f of failed) console.log(`  FAILED: ${String(f.reason?.message ?? f.reason).slice(0, 160)}`);
  return { n, wall, ok: ok.length, failed: failed.length };
}

const out = [];
for (const n of [1, 2, 4, 8]) {
  out.push(await runLevel(n));
  await sleep(1500); // cool down between levels
}

// sustained burst: 8 back-to-back with no cooldown, then immediately 8 more
console.log('\n--- sustained burst: 8 + 8 back to back ---');
for (let round = 1; round <= 2; round++) {
  const t0 = Date.now();
  const results = await Promise.allSettled(
    texts.slice(0, 8).map((text) => synthesize({ voice: 'zh-TW-HsiaoChenNeural', voiceLocale: 'zh-TW', text, timeoutMs: 45000 }))
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected');
  console.log(`round ${round}: wall=${Date.now() - t0}ms ok=${ok}/8`);
  for (const f of failed) console.log(`  FAILED: ${String(f.reason?.message ?? f.reason).slice(0, 160)}`);
}

console.log('\n=== JSON ===');
console.log(JSON.stringify(out, null, 2));
