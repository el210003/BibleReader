// Spike 08b — corrected fallback probe: cancel between utterances (the 08 run queued
// them, so "es did not start" was a test artifact), and check whether onboundary fires.
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadURL('data:text/html,<html><body>voice probe</body></html>');

  const raw = await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let voices = [];
      for (let i = 0; i < 20; i++) {
        voices = speechSynthesis.getVoices();
        if (voices.length) break;
        await wait(150);
      }

      const probe = async (langPrefix, text) => {
        speechSynthesis.cancel();
        await wait(250);
        const v = voices.find((x) => x.lang.toLowerCase() === langPrefix.toLowerCase()) ||
                  voices.find((x) => x.lang.toLowerCase().startsWith(langPrefix.toLowerCase()));
        if (!v) return { lang: langPrefix, voice: null, started: false };
        const u = new SpeechSynthesisUtterance(text);
        u.voice = v; u.lang = v.lang;
        const t0 = performance.now();
        let boundaries = 0;
        u.onboundary = () => { boundaries++; };
        const started = await new Promise((resolve) => {
          u.onstart = () => resolve(true);
          setTimeout(() => resolve(false), 4000);
          speechSynthesis.speak(u);
        });
        const msToStart = started ? Math.round(performance.now() - t0) : null;
        const ended = await new Promise((resolve) => {
          u.onend = () => resolve(true);
          setTimeout(() => resolve(false), 15000);
        });
        speechSynthesis.cancel();
        return { lang: langPrefix, voice: v.lang + ' | ' + v.name, started, msToStart, ended, boundaries };
      };

      const probes = [];
      probes.push(await probe('zh-TW', '神愛世人，甚至將他的獨生子賜給他們。'));
      probes.push(await probe('en-US', 'For God so loved the world.'));
      probes.push(await probe('es-ES', 'Porque de tal manera amó Dios al mundo.'));
      probes.push(await probe('fr-FR', 'Car Dieu a tant aimé le monde.'));

      return JSON.stringify({ totalVoices: voices.length, probes });
    })()
  `);

  const data = JSON.parse(raw);
  console.log('total OS voices:', data.totalVoices);
  for (const p of data.probes) {
    console.log(`${p.lang}: voice=${p.voice ?? 'NONE'} started=${p.started}${p.msToStart ? '(' + p.msToStart + 'ms)' : ''} ended=${p.ended} boundaries=${p.boundaries}`);
  }
  app.quit();
});
