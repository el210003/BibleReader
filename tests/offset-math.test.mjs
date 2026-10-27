// Tests for the riskiest code in the project: text normalization and boundary→offset
// mapping. The proposal called for fixed fixtures here; this is that.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scripture = require('../electron/scripture.cjs');
const tts = require('../electron/tts.cjs');

// Real fixture: bolls.life CUV John 3:16 as delivered (character-separated), and the
// word boundaries Edge actually returned for it.
const RAW_CUV =
  '「 神 愛 世 人 ， 甚 至 將 他 的 獨 生 子 賜 給 他 們 ， 叫 一 切 信 他 的 ， 不 至 滅 亡 ， 反 得 永 生 。';
const NORMALIZED = '「神愛世人，甚至將他的獨生子賜給他們，叫一切信他的，不至滅亡，反得永生。';
const BOUNDARIES = [
  '神愛', '世人', '甚至', '將', '他的', '獨生子', '賜給', '他們', '叫', '一切',
  '信', '他的', '不', '至', '滅亡', '反', '得', '永生',
];

test('normalizes the CUV character-spacing quirk', () => {
  const out = scripture.normalizeText(RAW_CUV);
  assert.equal(out.text, NORMALIZED);
  assert.equal(out.removedSpaces, 35);
  assert.equal(RAW_CUV.length, 71);
  assert.equal(out.text.length, 36);
});

test('leaves Latin text intact but collapses double spaces', () => {
  const out = scripture.normalizeText('Porque de tal manera amó Dios al mundo,  que ha');
  assert.equal(out.text, 'Porque de tal manera amó Dios al mundo, que ha');
  assert.equal(out.removedSpaces, 0);
});

test('does not strip spaces between Latin words', () => {
  const out = scripture.normalizeText('For God so loved the world');
  assert.equal(out.text, 'For God so loved the world');
});

test('maps every real boundary onto verse offsets in order', () => {
  const boundaries = BOUNDARIES.map((t, i) => ({ text: t, offsetMs: i * 400, durationMs: 380 }));
  const { spans, unmapped } = tts.buildSpans(boundaries, NORMALIZED);

  assert.equal(unmapped, 0);
  assert.equal(spans.length, BOUNDARIES.length);

  // first word starts after the opening quote, not at 0
  assert.equal(spans[0].charStart, 1);
  assert.equal(spans[0].charEnd >= 3, true);

  // strictly increasing, never overlapping
  for (let i = 1; i < spans.length; i++) {
    assert.ok(spans[i].charStart >= spans[i - 1].charEnd, `span ${i} overlaps previous`);
  }

  // the last word ends before the closing full stop
  assert.equal(spans.at(-1).charEnd, NORMALIZED.length - 1);

  // every span points at real text
  for (const s of spans) {
    assert.ok(s.charEnd > s.charStart, 'span must be non-empty');
    assert.ok(s.charEnd <= NORMALIZED.length, 'span must stay in bounds');
  }
});

test('bridges punctuation gaps so the overlay does not flicker', () => {
  // 世人 ends at the comma; 甚至 starts after it. Bridging must absorb the comma into
  // the preceding span, otherwise the highlight goes dark mid-sentence.
  const boundaries = [
    { text: '神愛', offsetMs: 0, durationMs: 400 },
    { text: '世人', offsetMs: 500, durationMs: 400 },
    { text: '甚至', offsetMs: 900, durationMs: 400 },
  ];
  const { spans } = tts.buildSpans(boundaries, NORMALIZED);
  const commaIdx = NORMALIZED.indexOf('，');
  assert.equal(spans[1].charEnd, commaIdx + 1, 'comma should be absorbed into the 世人 span');
  assert.equal(spans[1].charEnd, spans[2].charStart);
});

test('counts boundaries that do not appear in the verse as unmapped', () => {
  const boundaries = [
    { text: '神愛', offsetMs: 0, durationMs: 400 },
    { text: '不存在的詞', offsetMs: 500, durationMs: 400 },
    { text: '世人', offsetMs: 900, durationMs: 400 },
  ];
  const { spans, unmapped } = tts.buildSpans(boundaries, NORMALIZED);
  assert.equal(unmapped, 1);
  assert.equal(spans.length, 2);
});

test('never maps a span past the end of the verse', () => {
  const boundaries = [{ text: '永生', offsetMs: 0, durationMs: 400 }];
  const { spans } = tts.buildSpans(boundaries, NORMALIZED);
  assert.equal(spans.length, 1);
  assert.ok(spans[0].charEnd <= NORMALIZED.length);
});
