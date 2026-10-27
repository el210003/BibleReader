// Builds the bundled CJK font: downloads Noto Serif TC, subsets it to exactly the glyphs
// the Chinese Bible text uses (plus Latin/punctuation), and emits a woff2 into src/assets.
//
// Subsetting to the corpus is what keeps this shippable: the full Traditional Chinese face
// is ~15-24 MB, while the CUV corpus is a few thousand distinct characters.
//
// Requires: python -m pip install fonttools brotli

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const cacheDir = path.join(root, '.fontcache');
const outDir = path.join(root, 'src', 'assets', 'fonts');
const SOURCE_URL = 'https://github.com/notofonts/noto-cjk/raw/main/Serif/Variable/OTF/Subset/NotoSerifTC-VF.otf';
// Every Chinese translation the app ships, so no glyph is missing for CUNP/PCB/ChiSB etc.
const CORPUS_TRANSLATIONS = ['CUV', 'CUNP', 'CUNPS', 'PCB', 'PCBS', 'ChiSB'];
const corpusUrl = (t) => `https://bolls.life/static/translations/${t}.json`;

fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const sourcePath = path.join(cacheDir, 'NotoSerifTC-VF.otf');
if (!fs.existsSync(sourcePath)) {
  console.log('[font] downloading source font…');
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`font download ${res.status}`);
  fs.writeFileSync(sourcePath, Buffer.from(await res.arrayBuffer()));
}
console.log('[font] source:', (fs.statSync(sourcePath).size / 1048576).toFixed(1), 'MB');

// --- collect the codepoints actually used by the Chinese scripture ---
const strip = (html) => String(html).replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ');
const cps = new Set();

// Latin, digits, punctuation and typographic quotes so references and headings render.
const addRange = (from, to) => {
  for (let cp = from; cp <= to; cp++) cps.add(cp);
};
addRange(0x20, 0x7e);
addRange(0xa0, 0xff);
addRange(0x2000, 0x206f);
addRange(0x3000, 0x303f); // CJK punctuation
addRange(0xff00, 0xffef); // fullwidth forms

let corpusVerses = 0;
for (const tr of CORPUS_TRANSLATIONS) {
  console.log('[font] fetching corpus', tr, '…');
  const res = await fetch(corpusUrl(tr));
  if (!res.ok) throw new Error(`corpus ${tr} ${res.status}`);
  const verses = await res.json();
  corpusVerses += verses.length;
  for (const v of verses) {
    for (const ch of strip(v.text)) {
      const cp = ch.codePointAt(0);
      if (cp !== undefined) cps.add(cp);
    }
  }
  console.log('[font]  ', tr, 'verses:', verses.length, '| cumulative codepoints:', cps.size);
}
console.log('[font] corpus verses total:', corpusVerses, '| distinct codepoints:', cps.size);

const unicodesFile = path.join(cacheDir, 'unicodes.txt');
fs.writeFileSync(unicodesFile, [...cps].map((c) => c.toString(16)).join(','));

// --- subset ---
const out = path.join(outDir, 'NotoSerifTC-subset.woff2');
try {
  execFileSync(
    'pyftsubset',
    [
      sourcePath,
      `--unicodes-file=${unicodesFile}`,
      '--flavor=woff2',
      `--output-file=${out}`,
      '--layout-features=*',
      '--no-hinting',
      '--desubroutinize',
      '--name-IDs=*',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );
  console.log('[font] subset written:', (fs.statSync(out).size / 1048576).toFixed(2), 'MB');
} catch (e) {
  console.warn('[font] pyftsubset failed, falling back to the full OTF:', String(e).slice(0, 120));
  const fallback = path.join(outDir, 'NotoSerifTC.otf');
  fs.copyFileSync(sourcePath, fallback);
  console.log('[font] copied:', (fs.statSync(fallback).size / 1048576).toFixed(1), 'MB');
}
