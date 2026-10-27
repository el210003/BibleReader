// Spike 03 — highlight plan feasibility: map TTS word-boundary text onto normalized
// verse character offsets, across two consecutive verses (offset rebasing).

import { getChapter, stripHtml, normalizeCjkSpacing, synthesize, parseBoundaries, parseMp3, sleep } from './lib.mjs';

const BOOK = 43, CHAPTER = 3;

async function buildVersePlan(translation, verseNum, voice, locale) {
  const verses = await getChapter(translation, BOOK, CHAPTER);
  const v = verses.find((x) => x.verse === verseNum);
  const raw = stripHtml(v.text);
  const norm = normalizeCjkSpacing(raw);

  await sleep(500);
  const { audio, metaChunks } = await synthesize({ voice, voiceLocale: locale, text: norm.text });
  const boundaries = parseBoundaries(metaChunks);
  const mp3 = parseMp3(audio);

  // Sequential mapping: boundary text must appear in the normalized verse, in order.
  const spans = [];
  let cursor = 0;
  let unmapped = 0;
  for (const b of boundaries) {
    if (!b.text) { unmapped++; continue; }
    const idx = norm.text.indexOf(b.text, cursor);
    if (idx < 0) { unmapped++; continue; }
    spans.push({
      start: idx,
      end: idx + b.text.length,
      tMs: Math.round(b.offsetMs ?? 0),
      durMs: Math.round(b.durationMs ?? 0),
      text: b.text,
    });
    cursor = idx + b.text.length;
  }

  // Coverage: how much of the verse is covered by mapped spans, and does the span text match?
  const covered = new Set();
  let textMismatch = 0;
  for (const s of spans) {
    for (let i = s.start; i < s.end; i++) covered.add(i);
    if (norm.text.slice(s.start, s.end) !== s.text) textMismatch++;
  }

  // Monotonicity check: spans must be non-overlapping and increasing.
  let monotonic = true;
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start < spans[i - 1].end) monotonic = false;
  }

  return {
    translation, verse: verseNum, voice,
    rawLen: raw.length, normLen: norm.text.length, removedSpaces: norm.removed,
    audioDurationMs: mp3.durationMs,
    boundaryCount: boundaries.length,
    mappedCount: spans.length,
    unmapped,
    monotonic,
    textMismatch,
    coverageChars: covered.size,
    coveragePct: Number(((covered.size / norm.text.length) * 100).toFixed(1)),
    audioCoveragePct: spans.length
      ? Number((((spans.at(-1).tMs + spans.at(-1).durMs) / mp3.durationMs) * 100).toFixed(1))
      : 0,
    firstSpans: spans.slice(0, 5),
    lastSpans: spans.slice(-3),
    normText: norm.text,
    audioBytes: audio.length,
    audio,
  };
}

const out = {};

// --- Chinese, two consecutive verses ---
const zh16 = await buildVersePlan('CUV', 16, 'zh-TW-HsiaoChenNeural', 'zh-TW');
await sleep(800);
const zh17 = await buildVersePlan('CUV', 17, 'zh-TW-HsiaoChenNeural', 'zh-TW');

// --- Latin control ---
await sleep(800);
const en16 = await buildVersePlan('WEB', 16, 'en-US-AvaNeural', 'en-US');

// --- rebasing: concatenate v16+v17 audio and shift v17 spans by v16 duration ---
const stitched = Buffer.concat([zh16.audio, zh17.audio]);
const stitchedMp3 = parseMp3(stitched);
const rebased = [
  ...zh16.firstSpans,
  ...zh17.firstSpans.map((s) => ({ ...s, tMs: s.tMs + zh16.audioDurationMs, verse: 17 })),
];

for (const r of [zh16, zh17, en16]) {
  delete r.audio;
  console.log(`\n[${r.translation} ${r.verse}] ${r.voice}`);
  console.log(`  norm=${r.normLen} chars, audio=${r.audioDurationMs}ms, boundaries=${r.boundaryCount}, mapped=${r.mappedCount}, unmapped=${r.unmapped}`);
  console.log(`  monotonic=${r.monotonic} textMismatch=${r.textMismatch} charCoverage=${r.coveragePct}% audioCoverage=${r.audioCoveragePct}%`);
  console.log(`  normText: ${r.normText}`);
  console.log(`  firstSpans: ${JSON.stringify(r.firstSpans)}`);
  console.log(`  lastSpans : ${JSON.stringify(r.lastSpans)}`);
}

console.log(`\n[rebasing] v16=${zh16.audioDurationMs}ms + v17=${zh17.audioDurationMs}ms = ${stitchedMp3.durationMs}ms stitched (frames=${stitchedMp3.frames}, skipped=${stitchedMp3.skippedBytes})`);
console.log(`[rebasing] sample spans: ${JSON.stringify(rebased)}`);

out.zh16 = zh16; out.zh17 = zh17; out.en16 = en16;
out.rebase = {
  v16Ms: zh16.audioDurationMs,
  v17Ms: zh17.audioDurationMs,
  stitchedMs: stitchedMp3.durationMs,
  deltaMs: stitchedMp3.durationMs - (zh16.audioDurationMs + zh17.audioDurationMs),
  frames: stitchedMp3.frames,
  skippedBytes: stitchedMp3.skippedBytes,
  sampleRebasedSpans: rebased,
};

console.log('\n=== JSON ===');
console.log(JSON.stringify(out, null, 2));
