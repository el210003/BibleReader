// Generates build/icon.png (512x512) by rendering the brand mark in an offscreen window.
// Keeps the icon source in the repo instead of a binary blob nobody can regenerate.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 512;

const html = `<!doctype html><html><body style="margin:0;background:transparent">
  <div style="width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center;
              background:#241f1a;border-radius:112px">
    <div style="font-family:'Microsoft JhengHei','PingFang TC','Source Han Serif TC',serif;
                font-size:300px;line-height:1;color:#f7f4ee;padding-bottom:12px">聖</div>
  </div>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'icon.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('[icon] wrote', out, JSON.stringify(img.getSize()));
  app.quit();
});
