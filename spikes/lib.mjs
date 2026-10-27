// Shared helpers for the M0 spikes.
import pkg from 'msedge-tts';
const { MsEdgeTTS, OUTPUT_FORMAT } = pkg;

const UA = 'BibleReader/0.1 (spike; +https://github.com/bible-reader)';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getChapter(translation, book, chapter) {
  const res = await fetch(`https://bolls.life/get-text/${translation}/${book}/${chapter}/`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`${translation} ${res.status} ${res.statusText}`);
  return res.json();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function stripHtml(html) {
  let s = String(html)
    .replace(/<i>([\s\S]*?)<\/i>/gi, '\u0001$1\u0002')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '\u0001$1\u0002')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '');
  s = s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return s;
}

const isHan = (ch) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
const CJK_PUNCT = '，。、；：！？「」『』（）〈〉《》…—·～';
const isCjkPunct = (ch) => CJK_PUNCT.includes(ch);

export function normalizeCjkSpacing(raw) {
  const out = [];
  const map = [];
  let removed = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === ' ' || ch === '\t') {
      const prev = raw[i - 1];
      const next = raw[i + 1];
      if ((isHan(prev) || isCjkPunct(prev)) && (isHan(next) || isCjkPunct(next))) { removed++; continue; }
      if (out.length && out[out.length - 1] === ' ') continue;
      out.push(' ');
      map.push(i);
      continue;
    }
    out.push(ch);
    map.push(i);
  }
  return { text: out.join('').trim(), map, removed };
}

// ---- mp3 ----
const MPEG2_L3_BITRATE = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1];
const MPEG1_L3_BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1];
const MPEG2_SR = [22050, 24000, 16000, -1];
const MPEG1_SR = [44100, 48000, 32000, -1];

export function parseMp3(buf) {
  let i = 0;
  if (buf.length > 10 && buf.subarray(0, 3).toString() === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + size;
  }
  let frames = 0, skipped = 0, durationMs = 0, sampleRate = 0, bitrate = 0, mpegVersion = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { skipped++; i++; continue; }
    const versionBits = (buf[i + 1] >> 3) & 0x3;
    const layerBits = (buf[i + 1] >> 1) & 0x3;
    const brIdx = (buf[i + 2] >> 4) & 0xf;
    const srIdx = (buf[i + 2] >> 2) & 0x3;
    const pad = (buf[i + 2] >> 1) & 0x1;
    if (versionBits === 1 || layerBits === 0 || brIdx === 0xf || srIdx === 3) { skipped++; i++; continue; }
    const isMpeg1 = versionBits === 3;
    bitrate = (isMpeg1 ? MPEG1_L3_BITRATE : MPEG2_L3_BITRATE)[brIdx];
    sampleRate = (isMpeg1 ? MPEG1_SR : MPEG2_SR)[srIdx];
    if (!bitrate || bitrate < 0 || !sampleRate || sampleRate < 0) { skipped++; i++; continue; }
    const samples = isMpeg1 ? 1152 : 576;
    const frameLen = Math.floor((isMpeg1 ? 144 : 72) * bitrate * 1000 / sampleRate) + pad;
    if (frameLen <= 4 || i + frameLen > buf.length) break;
    frames++;
    durationMs += (samples / sampleRate) * 1000;
    mpegVersion = versionBits;
    i += frameLen;
  }
  return {
    frames, skippedBytes: skipped, durationMs: Math.round(durationMs), sampleRate, bitrate,
    mpegVersion: mpegVersion === 3 ? 'MPEG1' : mpegVersion === 2 ? 'MPEG2' : 'MPEG2.5', bytes: buf.length,
  };
}

// ---- tts ----
export async function synthesize({ voice, voiceLocale, text, rate, timeoutMs = 60000 }) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
    sentenceBoundaryEnabled: true,
    voiceLocale,
  });
  const result = await new Promise((resolve, reject) => {
    const audio = [];
    const metaChunks = [];
    const timer = setTimeout(() => reject(new Error('synthesis timeout')), timeoutMs);
    const { audioStream, metadataStream } = tts.toStream(text, rate ? { rate } : undefined);
    audioStream.on('data', (c) => audio.push(c));
    audioStream.on('error', (e) => { clearTimeout(timer); reject(e); });
    audioStream.on('end', () => { clearTimeout(timer); resolve({ audio: Buffer.concat(audio), metaChunks }); });
    if (metadataStream) metadataStream.on('data', (c) => metaChunks.push(c.toString()));
  });
  tts.close();
  return result;
}

export function parseBoundaries(chunks) {
  const events = [];
  for (const raw of chunks) {
    let obj;
    try { obj = JSON.parse(raw); } catch { continue; }
    for (const m of obj.Metadata ?? []) {
      const d = m.Data ?? {};
      events.push({
        type: m.Type,
        offsetMs: d.Offset != null ? d.Offset / 10000 : null,
        durationMs: d.Duration != null ? d.Duration / 10000 : null,
        text: d.text?.Text ?? '',
        length: d.text?.Length ?? null,
      });
    }
  }
  return events;
}
