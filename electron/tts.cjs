// Edge TTS synthesis + highlight-plan construction.
// Mirrors the verified M0 spike logic: word boundaries -> sequential mapping onto
// normalized verse offsets, with punctuation bridging.

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const MPEG2_L3_BITRATE = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1];
const MPEG1_L3_BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1];
const MPEG2_SR = [22050, 24000, 16000, -1];
const MPEG1_SR = [44100, 48000, 32000, -1];

function mp3DurationMs(buf) {
  let i = 0;
  if (buf.length > 10 && buf.subarray(0, 3).toString() === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + size;
  }
  let ms = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const versionBits = (buf[i + 1] >> 3) & 0x3;
    const layerBits = (buf[i + 1] >> 1) & 0x3;
    const brIdx = (buf[i + 2] >> 4) & 0xf;
    const srIdx = (buf[i + 2] >> 2) & 0x3;
    const pad = (buf[i + 2] >> 1) & 0x1;
    if (versionBits === 1 || layerBits === 0 || brIdx === 0xf || srIdx === 3) { i++; continue; }
    const isMpeg1 = versionBits === 3;
    const bitrate = (isMpeg1 ? MPEG1_L3_BITRATE : MPEG2_L3_BITRATE)[brIdx];
    const sampleRate = (isMpeg1 ? MPEG1_SR : MPEG2_SR)[srIdx];
    if (!bitrate || bitrate < 0 || !sampleRate || sampleRate < 0) { i++; continue; }
    const samples = isMpeg1 ? 1152 : 576;
    const frameLen = Math.floor((isMpeg1 ? 144 : 72) * bitrate * 1000 / sampleRate) + pad;
    if (frameLen <= 4 || i + frameLen > buf.length) break;
    ms += (samples / sampleRate) * 1000;
    i += frameLen;
  }
  return Math.round(ms);
}

function parseWordBoundaries(chunks) {
  const events = [];
  for (const raw of chunks) {
    let obj;
    try { obj = JSON.parse(raw); } catch { continue; }
    for (const m of obj.Metadata ?? []) {
      // SentenceBoundary duplicates the whole sentence; keep word boundaries only.
      if (m.Type !== 'WordBoundary') continue;
      const d = m.Data ?? {};
      events.push({
        offsetMs: (d.Offset ?? 0) / 10000,
        durationMs: (d.Duration ?? 0) / 10000,
        text: d.text?.Text ?? '',
      });
    }
  }
  return events;
}

// Sequential mapping + punctuation bridging so the overlay does not flicker off at ，。
function buildSpans(boundaries, verseText) {
  const spans = [];
  let cursor = 0;
  let unmapped = 0;
  for (const b of boundaries) {
    if (!b.text) { unmapped++; continue; }
    const idx = verseText.indexOf(b.text, cursor);
    if (idx < 0) { unmapped++; continue; }
    spans.push({
      charStart: idx,
      charEnd: idx + b.text.length,
      tMs: Math.round(b.offsetMs),
      durMs: Math.round(b.durationMs),
    });
    cursor = idx + b.text.length;
  }
  // bridge gaps between consecutive spans (punctuation belongs to the preceding word)
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].charStart > spans[i - 1].charEnd) spans[i - 1].charEnd = spans[i].charStart;
  }
  return { spans, unmapped };
}

async function synthesize({ text, voice, locale, rate }) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
    sentenceBoundaryEnabled: true,
    voiceLocale: locale,
  });

  const { audio, metaChunks } = await new Promise((resolve, reject) => {
    const audioChunks = [];
    const metaChunks = [];
    // scale timeout with input length: per-verse requests are fast, long ones are not
    const timeoutMs = 20000 + text.length * 120;
    const timer = setTimeout(() => reject(new Error('synthesis timeout')), timeoutMs);
    const { audioStream, metadataStream } = tts.toStream(text, rate ? { rate } : undefined);
    audioStream.on('data', (c) => audioChunks.push(c));
    audioStream.on('error', (e) => { clearTimeout(timer); reject(e); });
    audioStream.on('end', () => { clearTimeout(timer); resolve({ audio: Buffer.concat(audioChunks), metaChunks }); });
    if (metadataStream) metadataStream.on('data', (c) => metaChunks.push(c.toString()));
  });
  tts.close();
  return { audio, metaChunks };
}

async function speak({ text, voice, locale, rate }) {
  const { audio, metaChunks } = await synthesize({ text, voice, locale, rate });
  const boundaries = parseWordBoundaries(metaChunks);
  const { spans, unmapped } = buildSpans(boundaries, text);
  const durationMs = mp3DurationMs(audio);
  return {
    audioBase64: audio.toString('base64'),
    durationMs,
    spans,
    unmapped,
    boundaryCount: boundaries.length,
    // measured trailing silence (M0: 500-950ms); exposed so the UI can trim if desired
    trailingSilenceMs: spans.length ? Math.max(0, durationMs - (spans.at(-1).tMs + spans.at(-1).durMs)) : durationMs,
  };
}

module.exports = { speak, mp3DurationMs, buildSpans };
