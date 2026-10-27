// Smoke test of the real app modules (not spike copies): scripture.cjs + tts.cjs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const scripture = require('../electron/scripture.cjs');
const tts = require('../electron/tts.cjs');

const verses = await scripture.getChapter({ translation: 'CUV', book: 43, chapter: 3 });
const v16 = verses.find(v => v.verse === 16);
console.log('chapter verses:', verses.length);
console.log('v16 text:', v16.text);
console.log('removedSpaces:', v16.removedSpaces, 'rawLen:', v16.rawLen);

const res = await tts.speak({ text: v16.text, voice: 'zh-TW-HsiaoChenNeural', locale: 'zh-TW', rate: '1' });
console.log('audio bytes(base64):', res.audioBase64.length, 'durationMs:', res.durationMs);
console.log('boundaries:', res.boundaryCount, 'spans:', res.spans.length, 'unmapped:', res.unmapped);
console.log('trailingSilenceMs:', res.trailingSilenceMs);
console.log('first 6 spans:', JSON.stringify(res.spans.slice(0, 6)));
console.log('last span:', JSON.stringify(res.spans.at(-1)));

// verify spans reference the correct substrings
const bad = res.spans.filter(s => {
  const sub = v16.text.slice(s.charStart, s.charEnd);
  return sub.length === 0;
});
console.log('empty spans:', bad.length);

// verify full coverage of the verse by spans+bridging
const covered = new Set();
for (const s of res.spans) for (let i = s.charStart; i < s.charEnd; i++) covered.add(i);
console.log('char coverage:', covered.size, '/', v16.text.length, `(${((covered.size / v16.text.length) * 100).toFixed(1)}%)`);
