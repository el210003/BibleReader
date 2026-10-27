const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const scripture = require('./scripture.cjs');
const tts = require('./tts.cjs');

// Simple in-memory synthesis cache for M0. Disk LRU cache is M2.
const cache = new Map();

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 900,
    backgroundColor: '#f7f4ee',
    title: 'BibleReader',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Smoke mode: load, report, quit. Used by CI / `npm run smoke`.
  if (process.env.SMOKE) {
    let firstLoad = true;
    win.webContents.on('did-finish-load', () => {
      if (firstLoad) {
        // clear persisted prefs and reload so this measures FIRST-RUN behaviour
        firstLoad = false;
        console.log('[smoke] renderer loaded; clearing prefs for first-run measurement');
        win.webContents
          .executeJavaScript("localStorage.clear(); location.reload();")
          .catch(() => {});
        return;
      }
      setTimeout(() => {
        win.webContents
          .executeJavaScript(
            `(async () => {
               const verses = document.querySelectorAll('.verse');
               const base = {
                 hasApi: !!window.api,
                 title: document.querySelector('.brand-cn')?.textContent,
                 verses: verses.length,
                 firstVerse: document.querySelector('.vtext')?.textContent?.slice(0, 24),
               };
               const cat = await window.api.getCatalog();
               const initial = {
                 systemLocale: cat.systemLocale,
                 preferredLanguages: cat.preferredLanguages,
                 effectiveLocales: cat.effectiveLocales,
                 defaults: cat.defaults,
                 preferredVoice: cat.preferredVoice,
               };
               const voiceSel = document.querySelector('[data-testid="voice"]');
               const translationSel = document.querySelectorAll('select')[0];
               const voiceOptions = voiceSel ? [...voiceSel.options].map(o => o.value) : [];
               const hydrated = { translation: translationSel?.value, voice: voiceSel?.value };
               verses[15]?.click();
               await new Promise(r => setTimeout(r, 2500));
               const audio = document.querySelector('audio');
               return JSON.stringify({
                 ...base,
                 initial,
                 hydrated,
                 ui: {
                   voiceOptions,
                   marks: document.querySelectorAll('.vtext mark').length,
                   activeMarks: document.querySelectorAll('.vtext mark.on').length,
                   audioSrc: audio?.src?.startsWith('blob:') ?? false,
                   playing: audio ? !audio.paused : false,
                   currentTime: audio ? Number(audio.currentTime.toFixed(2)) : null,
                   status: [...document.querySelectorAll('.pill')].map(p => p.textContent),
                   prefs: localStorage.getItem('biblereader.prefs.v1'),
                 }
               });
             })()`
          )
          .then((r) => console.log('[smoke] renderer state:', r))
          .catch((e) => console.log('[smoke] renderer error:', String(e)))
          .finally(() => app.quit());
      }, 2500);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.log(`[smoke] load failed ${code} ${desc}`);
      app.quit();
    });
  }
}

ipcMain.handle('catalog:get', () => {
  const preferred = app.getPreferredSystemLanguages?.() ?? [];
  const systemLocale = app.getSystemLocale?.() ?? app.getLocale();
  // QA override so both branches can be exercised without changing OS settings.
  const override = process.env.BIBLEREADER_LOCALE_OVERRIDE;
  const effective = override ? [override] : preferred.length ? preferred : [systemLocale];

  const preferredVoice = {};
  for (const [id, meta] of Object.entries(scripture.TRANSLATIONS)) {
    preferredVoice[id] = scripture.pickVoiceForLocale(meta.voices, effective, meta.defaultVoice);
  }
  return {
    translations: scripture.TRANSLATIONS,
    books: scripture.BOOKS,
    systemLocale,
    preferredLanguages: preferred,
    effectiveLocales: effective,
    defaults: scripture.defaultsForLocale(effective),
    preferredVoice,
  };
});

ipcMain.handle('scripture:chapter', async (_e, args) => {
  return scripture.getChapter(args);
});

ipcMain.handle('tts:speak', async (_e, { text, voice, locale, rate }) => {
  const key = `${voice}|${rate || 'default'}|${text}`;
  if (cache.has(key)) return { ...cache.get(key), cached: true };

  const result = await tts.speak({ text, voice, locale, rate });
  cache.set(key, result);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return { ...result, cached: false };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
