const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const scripture = require('./scripture.cjs');
const tts = require('./tts.cjs');
const cache = require('./cache.cjs');

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
               try {
               const wait = (ms) => new Promise(r => setTimeout(r, ms));
               const verses = document.querySelectorAll('.verse');
               const cat = await window.api.getCatalog();
               const books = await window.api.getBooks({ translation: 'CUV' });
               const base = {
                 hasApi: !!window.api,
                 title: document.querySelector('.brand-cn')?.textContent,
                 verses: verses.length,
                 firstVerse: document.querySelector('.vtext')?.textContent?.slice(0, 24),
                 books: {
                   count: books.books.length,
                   first: books.books[0]?.name,
                   john: books.books.find(b => b.id === 43)?.name,
                   last: books.books[books.books.length - 1]?.name,
                   sections: books.sections,
                 },
               };
               const initial = {
                 systemLocale: cat.systemLocale,
                 effectiveLocales: cat.effectiveLocales,
                 defaults: cat.defaults,
               };
               const voiceSel = document.querySelector('[data-testid="voice"]');
               const hydrated = { translation: document.querySelectorAll('select')[0]?.value, voice: voiceSel?.value };

               // 1) click-to-speak
               verses[15]?.click();
               await wait(2500);
               const a1 = document.querySelector('audio');
               const pillTexts = () => [...document.querySelectorAll('.pill')].map(p => p.textContent);
               // verify highlight spans actually point at the right characters
               const av = document.querySelector('.verse.active');
               const avText = av?.querySelector('.vtext')?.textContent ?? '';
               const markTexts = av ? [...av.querySelectorAll('mark')].map(m => m.textContent) : [];
               let mcCursor = 0, markCheck = true;
               for (const t of markTexts) {
                 const i = avText.indexOf(t, mcCursor);
                 if (i < 0 || !t) { markCheck = false; break; }
                 mcCursor = i + t.length;
               }
               const clickTest = {
                 marks: document.querySelectorAll('.vtext mark').length,
                 activeMarks: document.querySelectorAll('.vtext mark.on').length,
                 playing: a1 ? !a1.paused : false,
                 currentTime: a1 ? Number(a1.currentTime.toFixed(2)) : null,
                 source: pillTexts().find(t => ['memory','disk','network','system'].includes(t)) ?? null,
                 notice: document.querySelector('.notice')?.textContent?.trim() ?? null,
                 offlineNote: document.querySelector('.cached-note')?.textContent?.trim() ?? null,
                 cachePill: document.querySelector('[data-testid="cache"]')?.textContent ?? null,
                 cacheStats: await window.api.cacheStats(),
                 markTexts,
                 markCheck,
               };

               // 2) selection -> speak on an untouched verse
               const vt = document.querySelector('.verse[data-verse="1"] .vtext');
               const tn = vt && vt.firstChild;
               let selTest = null;
               if (tn && tn.nodeType === 3) {
                 const range = document.createRange();
                 range.setStart(tn, 0);
                 range.setEnd(tn, Math.min(4, tn.length));
                 const sel = window.getSelection();
                 sel.removeAllRanges();
                 sel.addRange(range);
                 document.querySelector('.reader').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                 await wait(400);
                 const bar = document.querySelector('.selbar');
                 const barButtons = bar ? [...bar.querySelectorAll('button')].map(b => b.textContent.trim()) : [];
                 bar?.querySelector('button.primary')?.click();
                 await wait(2500);
                 const a2 = document.querySelector('audio');
                 selTest = {
                   barShown: !!bar,
                   barButtons,
                   selectedText: range.toString(),
                   label: [...document.querySelectorAll('.pill')].map(p => p.textContent).find(t => t && t.includes('選取')) ?? null,
                   marks: document.querySelectorAll('.vtext mark').length,
                   playing: a2 ? !a2.paused : false,
                   currentTime: a2 ? Number(a2.currentTime.toFixed(2)) : null,
                 };
               }

               // 3) continuous queue
               const contBtn = [...document.querySelectorAll('footer button')].find(b => b.textContent.includes('連續'));
               contBtn?.click();
               await wait(2500);
               const queuePill = document.querySelector('[data-testid="queue"]')?.textContent ?? null;
               const a3 = document.querySelector('audio');
               const queueTest = {
                 buttonFound: !!contBtn,
                 queuePill,
                 playing: a3 ? !a3.paused : false,
                 activeVerse: document.querySelector('.verse.active')?.dataset?.verse ?? null,
               };

               return JSON.stringify({
                 ...base,
                 initial,
                 hydrated,
                 clickTest,
                 selTest,
                 queueTest,
                 prefs: localStorage.getItem('biblereader.prefs.v1'),
               });
               } catch (e) { return JSON.stringify({ error: String((e && (e.stack || e.message)) || e) }); }
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
    systemLocale,
    preferredLanguages: preferred,
    effectiveLocales: effective,
    defaults: scripture.defaultsForLocale(effective),
    preferredVoice,
  };
});

ipcMain.handle('scripture:books', async (_e, { translation }) => {
  return scripture.getBooks(translation);
});

ipcMain.handle('scripture:chapter', async (_e, args) => {
  return scripture.getChapter(args);
});

ipcMain.handle('tts:speak', async (_e, { text, voice, locale, rate }) => {
  return tts.speak({ text, voice, locale, rate });
});

ipcMain.handle('cache:stats', () => cache.stats());

ipcMain.handle('cache:clear', () => {
  cache.clearAll();
  return cache.stats();
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
