// Spike 02 — Edge TTS word-boundary metadata + MP3 chunk stitching.
// Questions:
//  1. Does msedge-tts 2.1.1 still work against Edge Read Aloud (no 403 / token failure)?
//  2. Does wordBoundaryEnabled return usable offsets, and what is their unit/shape?
//  3. Can independently synthesized MP3 chunks be concatenated into one valid stream?

import pkg from 'msedge-tts';
const { MsEdgeTTS, OUTPUT_FORMAT } = pkg;
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'spikes/out';
mkdirSync(OUT, { recursive: true });

// ---------------- MP3 frame parser (for duration verification) ----------------
const MPEG2_L3_BITRATE = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1];
const MPEG1_L3_BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1];
const MPEG2_SR = [22050, 24000, 16000, -1];
const MPEG1_SR = [44100, 48000, 32000, -1];

function parseMp3(buf) {
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
    const brTable = isMpeg1 ? MPEG1_L3_BITRATE : MPEG2_L3_BITRATE;
    const srTable = isMpeg1 ? MPEG1_SR : MPEG2_SR;
    bitrate = brTable[brIdx];
    sampleRate = srTable[srIdx];
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
    frames,
    skippedBytes: skipped,
    durationMs: Math.round(durationMs),
    sampleRate,
    bitrate,
    mpegVersion: mpegVersion === 3 ? 'MPEG1' : mpegVersion === 2 ? 'MPEG2' : 'MPEG2.5',
    bytes: buf.length,
  };
}

// ---------------- synth helper ----------------
function synthesize(tts, text) {
  return new Promise((resolve, reject) => {
    const audio = [];
    const metaChunks = [];
    const timer = setTimeout(() => reject(new Error('synthesis timeout (60s)')), 60000);

    const { audioStream, metadataStream } = tts.toStream(text);
    audioStream.on('data', (c) => audio.push(c));
    audioStream.on('error', (e) => { clearTimeout(timer); reject(e); });
    audioStream.on('end', () => {
      clearTimeout(timer);
      resolve({ audio: Buffer.concat(audio), metaChunks });
    });
    if (metadataStream) {
      metadataStream.on('data', (c) => metaChunks.push(c.toString()));
      metadataStream.on('error', () => {});
    }
  });
}

// Each metadata message is one complete JSON object (verified in 02b), not a JSONL stream.
function parseBoundaries(chunks) {
  const events = [];
  for (const raw of chunks) {
    let obj;
    try { obj = JSON.parse(raw); } catch { continue; }
    for (const m of obj.Metadata ?? []) {
      if (m.Type !== 'WordBoundary' && m.Type !== 'SentenceBoundary') continue;
      const d = m.Data ?? {};
      events.push({
        type: m.Type,
        offsetTicks: d.Offset,
        durationTicks: d.Duration,
        offsetMs: d.Offset != null ? d.Offset / 10000 : null,
        durationMs: d.Duration != null ? d.Duration / 10000 : null,
        text: d.text?.Text ?? '',
        length: d.text?.Length ?? null,
        boundaryType: d.text?.BoundaryType ?? null,
      });
    }
  }
  return events;
}

// ---------------- main ----------------
const results = {};

// 1. connectivity + voice list
const probe = new MsEdgeTTS();
const t0 = Date.now();
let voices;
try {
  voices = await probe.getVoices();
  probe.close();
  results.voices = {
    ok: true,
    latencyMs: Date.now() - t0,
    total: voices.length,
    zhTW: voices.filter((v) => v.Locale === 'zh-TW').map((v) => v.ShortName),
    enUS: voices.filter((v) => v.Locale === 'en-US').map((v) => v.ShortName).slice(0, 6),
  };
  console.log(`[voices] OK in ${results.voices.latencyMs}ms, total=${voices.length}, zh-TW=${results.voices.zhTW.join(',')}`);
} catch (e) {
  results.voices = { ok: false, error: String(e.message) };
  console.log(`[voices] FAILED: ${e.message}`);
}

const CUV_16 = '「神愛世人，甚至將他的獨生子賜給他們，叫一切信他的，不至滅亡，反得永生。';
const WEB_16 = 'For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.';

// 2. Chinese synthesis with word boundaries
async function runOne(label, voice, text, locale) {
  const tts = new MsEdgeTTS();
  const started = Date.now();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
      voiceLocale: locale,
    });
    const { audio, metaChunks } = await synthesize(tts, text);
    tts.close();
    const b = parseBoundaries(metaChunks);
    const mp3 = parseMp3(audio);
    writeFileSync(`${OUT}/${label}.mp3`, audio);
    writeFileSync(`${OUT}/${label}.meta.json`, JSON.stringify(b, null, 2));

    const out = {
      ok: true,
      voice,
      textChars: text.length,
      wallMs: Date.now() - started,
      audioBytes: audio.length,
      audio: mp3,
      boundaryCount: b.length,
      boundaries: b.slice(0, 8),
      firstOffsetMs: b[0]?.offsetMs ?? null,
      lastOffsetMs: b[b.length - 1]?.offsetMs ?? null,
      lastEndMs: b.length ? Math.round((b[b.length - 1].offsetMs ?? 0) + (b[b.length - 1].durationMs ?? 0)) : null,
      coverage: b.length ? Number((((b[b.length - 1].offsetMs ?? 0) + (b[b.length - 1].durationMs ?? 0)) / mp3.durationMs).toFixed(2)) : null,
    };
    results[label] = out;
    console.log(`[${label}] ${voice} bytes=${audio.length} dur=${mp3.durationMs}ms frames=${mp3.frames} ${mp3.mpegVersion}/${mp3.bitrate}kbps boundaries=${b.length} lastEnd=${out.lastEndMs}ms coverage=${out.coverage} wall=${out.wallMs}ms`);
    if (b.length) console.log(`         sample: ${JSON.stringify(b.slice(0, 4))}`);
    return out;
  } catch (e) {
    tts.close();
    results[label] = { ok: false, voice, error: String(e.message) };
    console.log(`[${label}] FAILED: ${e.message}`);
    return results[label];
  }
}

const zh = await runOne('zh-16', 'zh-TW-HsiaoChenNeural', CUV_16, 'zh-TW');
await new Promise((r) => setTimeout(r, 800));
const en = await runOne('en-16', 'en-US-AvaNeural', WEB_16, 'en-US');

// 3. stitch test: two Chinese chunks concatenated
await new Promise((r) => setTimeout(r, 800));
const chunkA = '「神愛世人，甚至將他的獨生子賜給他們，';
const chunkB = '叫一切信他的，不至滅亡，反得永生。';

const ttsA = new MsEdgeTTS();
await ttsA.setMetadata('zh-TW-HsiaoChenNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
  wordBoundaryEnabled: true, voiceLocale: 'zh-TW',
});
const a = await synthesize(ttsA, chunkA);
ttsA.close();
await new Promise((r) => setTimeout(r, 800));

const ttsB = new MsEdgeTTS();
await ttsB.setMetadata('zh-TW-HsiaoChenNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
  wordBoundaryEnabled: true, voiceLocale: 'zh-TW',
});
const b2 = await synthesize(ttsB, chunkB);
ttsB.close();

const stitched = Buffer.concat([a.audio, b2.audio]);
writeFileSync(`${OUT}/zh-stitched.mp3`, stitched);

const pa = parseMp3(a.audio);
const pb = parseMp3(b2.audio);
const ps = parseMp3(stitched);

results.stitch = {
  chunkA: pa,
  chunkB: pb,
  stitched: ps,
  sumDurationMs: pa.durationMs + pb.durationMs,
  deltaMs: ps.durationMs - (pa.durationMs + pb.durationMs),
  framesSum: pa.frames + pb.frames,
  frameDelta: ps.frames - (pa.frames + pb.frames),
  boundaryA: parseBoundaries(a.metaChunks).slice(0, 3),
  boundaryB: parseBoundaries(b2.metaChunks).slice(0, 3),
};

console.log(`[stitch] A=${pa.durationMs}ms/${pa.frames}f B=${pb.durationMs}ms/${pb.frames}f stitched=${ps.durationMs}ms/${ps.frames}f delta=${results.stitch.deltaMs}ms frameDelta=${results.stitch.frameDelta} skippedBytes=${ps.skippedBytes}`);

console.log('\n=== JSON ===');
console.log(JSON.stringify(results, null, 2));
