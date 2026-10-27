// Spike 08 — offline fallback viability. The plan's step 2 is "browser speechSynthesis
// with an OS voice matching the locale". Question: does this machine actually have usable
// OS voices for zh-TW / es / fr, and does speechSynthesis fire onstart at all in Electron?

const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL('data:text/html,<html><body>voice probe</body></html>');

  const script = `
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let voices = [];
      for (let i = 0; i < 20; i++) {
        voices = speechSynthesis.getVoices();
        if (voices.length) break;
        await wait(150);
      }
      const byLang = {};
      for (const v of voices) {
        const k = v.lang;
        (byLang[k] ||= []).push(v.name);
      }
      const wanted = ['zh', 'en', 'es', 'fr'];
      const coverage = {};
      for (const w of wanted) {
        coverage[w] = voices.filter((v) => v.lang.toLowerCase().startsWith(w)).map((v) => v.lang + ' | ' + v.name);
      }

      // can we actually speak? measure time to onstart, and whether zh works
      const probe = async (lang) => {
        const v = voices.find((x) => x.lang.toLowerCase().startsWith(lang));
        if (!v) return { lang, voice: null, started: false };
        const u = new SpeechSynthesisUtterance(lang.startsWith('zh') ? '神愛世人' : 'For God so loved the world');
        u.voice = v;
        u.lang = v.lang;
        const t0 = performance.now();
        const started = await new Promise((resolve) => {
          u.onstart = () => resolve(true);
          setTimeout(() => resolve(false), 2500);
          speechSynthesis.speak(u);
        });
        return { lang, voice: v.lang + ' | ' + v.name, started, msToStart: started ? Math.round(performance.now() - t0) : null };
      };

      const probes = [];
      for (const lang of ['zh', 'en', 'es', 'fr']) probes.push(await probe(lang));
      speechSynthesis.cancel();

      return JSON.stringify({
        totalVoices: voices.length,
        distinctLangs: Object.keys(byLang).length,
        coverage,
        probes,
      });
    })()
  `;

  try {
    const raw = await win.webContents.executeJavaScript(script);
    console.log('[fallback] ' + raw);
    const data = JSON.parse(raw);
    console.log('\n--- summary ---');
    console.log('OS voices installed:', data.totalVoices, 'across', data.distinctLangs, 'langs');
    for (const [k, v] of Object.entries(data.coverage)) {
      console.log(`  ${k}: ${v.length ? v.join(' ; ') : 'NONE'}`);
    }
    for (const p of data.probes) {
      console.log(`  speak(${p.lang}): ${p.started ? `ok in ${p.msToStart}ms via ${p.voice}` : 'DID NOT START'}`);
    }
  } catch (e) {
    console.log('[fallback] ERROR', String(e));
  }
  app.quit();
});
