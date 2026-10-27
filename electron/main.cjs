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
    win.webContents.on('did-finish-load', () => {
      console.log('[smoke] renderer loaded');
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
               // exercise the real click -> speak -> karaoke path
               verses[15]?.click();
               await new Promise(r => setTimeout(r, 2500));
               const audio = document.querySelector('audio');
               return JSON.stringify({
                 ...base,
                 ui: {
                   marks: document.querySelectorAll('.vtext mark').length,
                   activeMarks: document.querySelectorAll('.vtext mark.on').length,
                   audioSrc: audio?.src?.startsWith('blob:') ?? false,
                   playing: audio ? !audio.paused : false,
                   currentTime: audio ? Number(audio.currentTime.toFixed(2)) : null,
                   status: [...document.querySelectorAll('.pill')].map(p => p.textContent),
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

ipcMain.handle('catalog:get', () => ({
  translations: scripture.TRANSLATIONS,
  books: scripture.BOOKS,
}));

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
