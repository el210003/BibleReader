// Spike 05 — does prosody rate actually change output duration (speed control feasibility)?
import { synthesize, parseMp3, sleep } from './lib.mjs';
const text = '神愛世人，甚至將他的獨生子賜給他們，叫一切信他的，不至滅亡，反得永生。';
for (const rate of ['default', '1', '1.5', '2', '0.75']) {
  await sleep(700);
  const t0 = Date.now();
  try {
    const { audio } = await synthesize({ voice: 'zh-TW-HsiaoChenNeural', voiceLocale: 'zh-TW', text, rate });
    const mp3 = parseMp3(audio);
    console.log(`rate=${rate} audio=${mp3.durationMs}ms wall=${Date.now()-t0}ms`);
  } catch (e) { console.log(`rate=${rate} FAILED: ${e.message}`); }
}
