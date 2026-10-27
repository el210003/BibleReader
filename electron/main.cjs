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
      // keep rendering when the window is occluded, otherwise capturePage can return a
      // stale frame and the screenshot tooling silently lies about what the app looks like
      backgroundThrottling: false,
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
    // `once`, because the Hebrew shot reloads the page and must not re-enter this handler
    win.webContents.once('did-finish-load', async () => {
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
        const fs = require('node:fs');
        fs.mkdirSync(path.join(__dirname, '..', 'spikes', 'out'), { recursive: true });
        const shoot = async (name) => {
          const img = await win.webContents.capturePage();
          const out = path.join(__dirname, '..', 'spikes', 'out', name);
          fs.writeFileSync(out, img.toPNG());
          console.log('[shot] saved', name, JSON.stringify(img.getSize()));
        };
        // force light first: a previously persisted theme would otherwise make both shots identical
        await win.webContents.executeJavaScript(
          "document.documentElement.dataset.theme='light'; localStorage.setItem('biblereader.theme','light');"
        );
        await new Promise((r) => setTimeout(r, 900));
        await shoot('shot-light.png');
        await win.webContents.executeJavaScript(
          "document.documentElement.dataset.theme='dark'; localStorage.setItem('biblereader.theme','dark');"
        );
        await new Promise((r) => setTimeout(r, 900));
        await shoot('shot-dark.png');
        // Hebrew RTL proof shot. capturePage on the live window keeps returning a stale
        // frame after a text-only change, so boot a second offscreen window with the Hebrew
        // prefs the app already persisted.
        await win.webContents.executeJavaScript(
          "(() => { const s = document.querySelector('[data-testid=\"translation\"]'); const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value'); d.set.call(s,'WLC'); s.dispatchEvent(new Event('change',{bubbles:true})); })()"
        );
        await new Promise((r) => setTimeout(r, 1500));

        const heWin = new BrowserWindow({
          show: false,
          width: 1180,
          height: 900,
          webPreferences: {
            offscreen: true,
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false,
          },
        });
        await heWin.loadFile(distIndex);
        await new Promise((r) => setTimeout(r, 4500));
        const heState = await heWin.webContents.executeJavaScript(
          "JSON.stringify({translation: document.querySelector('[data-testid=\"translation\"]')?.value, dir: document.querySelector('.reading-column')?.getAttribute('dir'), heading: document.querySelector('.chapter-head h1')?.textContent, verses: document.querySelectorAll('.verse').length})"
        );
        console.log('[shot] hebrew state:', heState);
        const heImg = await heWin.webContents.capturePage();
        const heOut = path.join(__dirname, '..', 'spikes', 'out', 'shot-hebrew.png');
        fs.writeFileSync(heOut, heImg.toPNG());
        console.log('[shot] saved shot-hebrew.png', JSON.stringify(heImg.getSize()));
        heWin.destroy();
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
               const hydrated = { translation: document.querySelector('[data-testid="translation"]')?.value, voice: voiceSel?.value };

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

               // 4) UI localization + bundled font + sleep timer controls
               const setSelect = (el, v) => {
                 const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
                 desc.set.call(el, v);
                 el.dispatchEvent(new Event('change', { bubbles: true }));
               };
               const langSel = document.querySelector('[data-testid="uilang"]');
               const beforeLabels = [...document.querySelectorAll('.transport button')].map(b => b.textContent.trim());
               let afterLabels = beforeLabels;
               if (langSel) {
                 setSelect(langSel, 'en');
                 await wait(400);
                 afterLabels = [...document.querySelectorAll('.transport button')].map(b => b.textContent.trim());
               }
               const fontOk = document.fonts ? document.fonts.check('16px "BibleReader TC"') : null;
               const fontLoaded = [...(document.fonts || [])].some(f => f.family.includes('BibleReader'));
               const sleepSel = [...document.querySelectorAll('.transport select')].some(s => [...s.options].some(o => o.value === '15'));
               const i18nTest = { before: beforeLabels.slice(0, 2), after: afterLabels.slice(0, 2), fontOk, fontLoaded, sleepSel };

               // 5) keyboard: Esc must stop playback, Ctrl+Shift+S must start speaking
               window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
               await wait(400);
               const queueAfterEsc = document.querySelector('[data-testid="queue"]')?.textContent ?? null;
               window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true, bubbles: true }));
               await wait(2200);
               const shortcutMarks = document.querySelectorAll('.vtext mark').length;
               const keyboardTest = { queueAfterEsc, shortcutMarks, spoke: shortcutMarks > 0 };

               // 6) navigator panel: opens, lists books, offers a chapter grid, closes
               document.querySelector('.reference')?.click();
               await wait(500);
               const panelEl = document.querySelector('.panel');
               const panelTest = {
                 open: panelEl?.classList.contains('open') ?? false,
                 bookItems: document.querySelectorAll('.book-item').length,
                 chapterCells: document.querySelectorAll('.chapter-cell').length,
                 hasSearch: !!document.querySelector('input[type="search"]'),
                 theme: document.documentElement.dataset.theme,
               };
               panelEl?.querySelector('.panel-head .icon-btn')?.click();
               await wait(400);
               panelTest.closedAgain = !document.querySelector('.panel')?.classList.contains('open');

               // 7) Hebrew: RTL scripture, Hebrew canon, Hebrew voice + span mapping
               setSelect(document.querySelector('[data-testid="translation"]'), 'WLC');
               await wait(3200);
               const col = document.querySelector('.reading-column');
               const heVerseEl = document.querySelector('.verse[data-verse="1"]');
               heVerseEl?.click();
               await wait(2800);
               const heAv = document.querySelector('.verse.active');
               const heText = heAv?.querySelector('.vtext')?.textContent ?? '';
               const heMarks = heAv ? [...heAv.querySelectorAll('mark')].map(m => m.textContent) : [];
               let heCursor = 0, heMarkCheck = heMarks.length > 0;
               for (const t of heMarks) {
                 const i = heText.indexOf(t, heCursor);
                 if (i < 0 || !t) { heMarkCheck = false; break; }
                 heCursor = i + t.length;
               }
               const hebrewTest = {
                 dir: col?.getAttribute('dir') ?? null,
                 lang: col?.getAttribute('lang') ?? null,
                 verses: document.querySelectorAll('.verse').length,
                 bookItems: document.querySelectorAll('.book-item').length,
                 heading: document.querySelector('.chapter-head h1')?.textContent ?? null,
                 voice: document.querySelector('[data-testid="voice"]')?.value ?? null,
                 marks: heMarks.length,
                 markCheck: heMarkCheck,
                 source: pillTexts().find(t => ['memory','disk','network','system'].includes(t)) ?? null,
                 // RTL geometry: the verse number must sit against the RIGHT edge
                 gutterMirrored: (() => {
                   const v = document.querySelector('.verse');
                   const n = v?.querySelector('.vnum');
                   if (!v || !n) return null;
                   const vr = v.getBoundingClientRect();
                   const nr = n.getBoundingClientRect();
                   return (vr.right - nr.right) < 60;
                 })(),
               };

               return JSON.stringify({
                 ...base,
                 initial,
                 hydrated,
                 clickTest,
                 selTest,
                 queueTest,
                 i18nTest,
                 keyboardTest,
                 panelTest,
                 hebrewTest,
                 prefs: localStorage.getItem('biblereader.prefs.v1'),
               });
               } catch (e) { return JSON.stringify({ error: String((e && (e.stack || e.message)) || e) }); }
             })()`
          )
          .then((r) => {
            console.log('[smoke] renderer state:', r);
            try {
              require('node:fs').writeFileSync(
                require('node:path').join(require('node:os').tmpdir(), 'biblereader-smoke.json'),
                r
              );
            } catch (e) {
              console.log('[smoke] could not write result file:', String(e));
            }
          })
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

// Two instances would fight over the same cache directory and LRU index.
// Smoke/shot modes intentionally bypass the lock so they can run alongside a live window.
const testMode = Boolean(process.env.SMOKE || process.env.SHOT);
const gotLock = testMode ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

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
