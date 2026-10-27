import { getChapter, stripHtml, normalizeCjkSpacing, synthesize, parseBoundaries } from './lib.mjs';
const verses = await getChapter('CUV', 43, 3);
const v = verses.find(x => x.verse === 16);
const norm = normalizeCjkSpacing(stripHtml(v.text));
const { metaChunks } = await synthesize({ voice: 'zh-TW-HsiaoChenNeural', voiceLocale: 'zh-TW', text: norm.text });
const bs = parseBoundaries(metaChunks);
let cursor = 0;
for (const b of bs) {
  const idx = norm.text.indexOf(b.text, cursor);
  const tag = idx < 0 ? 'UNMAPPED' : 'ok';
  if (tag === 'UNMAPPED') console.log(`[${tag}] text=${JSON.stringify(b.text)} len=${b.length} type=${b.type} t=${b.offsetMs}`);
  else cursor = idx + b.text.length;
}
console.log('--- all boundary texts in order ---');
console.log(bs.map(b => b.text).join(' | '));
console.log('--- verse ---');
console.log(norm.text);
