const { app, BrowserWindow, ipcMain, shell } = require('electron');

// Some Windows GPU/driver combinations paint an Electron window as a flat colour while the
// DOM is perfectly fine. Opt-in escape hatch for that case (must run before app is ready).
if (process.env.BIBLEREADER_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  console.log('[gpu] hardware acceleration disabled');
}
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
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');

  if (devUrl) {
    win.loadURL(devUrl);
    // A dev-server that is not actually serving would leave a blank window.
    win.webContents.on('did-fail-load', () => {
      win.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<body style="font:14px/1.6 system-ui;padding:40px;background:#f7f4ee;color:#241f1a">
               <h2>Cannot reach the dev server</h2>
               <p>Tried <code>${devUrl}</code>. Start it with <code>npm run dev</code>,
               or run <code>npm start</code> to use the built bundle.</p>
             </body>`
          )
      );
    });
  } else if (require('node:fs').existsSync(distIndex)) {
    win.loadFile(distIndex);
  } else {
    // Never show a blank window because a build step was skipped.
    win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<body style="font:14px/1.6 system-ui;padding:40px;background:#f7f4ee;color:#241f1a">
             <h2>No build found</h2>
             <p><code>dist/index.html</code> does not exist, so there is nothing to render.</p>
             <p>Run <code>npm run build</code> (or <code>npm start</code>, which builds first),
             or use <code>npm run dev</code>.</p>
             <p style="color:#6b6157">Looked for: <code>${distIndex}</code></p>
           </body>`
        )
    );
  }

  // Always-on diagnostics: a blank window should never be silent.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`[load] FAILED ${code} ${desc} ${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer] process gone:', JSON.stringify(details));
  });
  win.webContents.on('console-message', (event) => {
    console.log(`[renderer:${event.level}] ${event.message}`);
  });
  win.webContents.on('preload-error', (_e, p, err) => {
    console.log('[preload] ERROR', p, String(err));
  });

  // Screenshot mode: proves whether the window actually renders anything.
  if (process.env.SHOT) {
    win.webContents.on('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 3500));
      try {
        const probe = await win.webContents.executeJavaScript(
          'JSON.stringify({app: !!document.querySelector(".app"), header: !!document.querySelector(".bar"), verses: document.querySelectorAll(".verse").length, selects: [...document.querySelectorAll("select")].map(s=>s.value), prefs: localStorage.getItem("biblereader.prefs.v1"), firstVerse: document.querySelector(".vtext")?.textContent?.slice(0,30), bookOptionsFirst: document.querySelectorAll("select")[1]?.options[0]?.text, bg: getComputedStyle(document.body).backgroundColor, rootHtmlLen: document.getElementById("root")?.innerHTML.length ?? -1})'
        );
        console.log('[probe]', probe);
      } catch (e) {
        console.log('[probe] failed', String(e));
      }
      try {
        const img = await win.webContents.capturePage();
        const fs = require('node:fs');
        fs.mkdirSync(path.join(__dirname, '..', 'spikes', 'out'), { recursive: true });
        const out = path.join(__dirname, '..', 'spikes', 'out', 'shot.png');
        fs.writeFileSync(out, img.toPNG());
        console.log('[shot] saved', out, JSON.stringify(img.getSize()));
      } catch (e) {
        console.log('[shot] failed', String(e));
      }
      app.quit();
    });
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

app.whenReady().then(async () => {
  // Support escape hatch: stale preferences can make the app open in an unexpected
  // translation/book. BIBLEREADER_RESET_PREFS=1 clears them before the first load.
  if (process.env.BIBLEREADER_RESET_PREFS === '1') {
    await require('electron').session.defaultSession.clearStorageData({ storages: ['localstorage'] });
    console.log('[reset] cleared persisted preferences');
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
