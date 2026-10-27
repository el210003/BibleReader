// Can't view the PNG directly, so measure it: a blank window is one flat colour.
const { app, nativeImage } = require('electron');
const path = require('node:path');

app.whenReady().then(() => {
  const p = path.join(__dirname, 'out', 'shot.png');
  const img = nativeImage.createFromPath(p);
  const { width, height } = img.getSize();
  const buf = img.toBitmap(); // BGRA
  const counts = new Map();
  let ink = 0;
  const bg = [238, 244, 247]; // #f7f4ee as B,G,R
  for (let i = 0; i < buf.length; i += 4) {
    const b = buf[i], g = buf[i + 1], r = buf[i + 2];
    const key = `${r},${g},${b}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    const d = Math.abs(r - bg[2]) + Math.abs(g - bg[1]) + Math.abs(b - bg[0]);
    if (d > 40) ink++;
  }
  const total = width * height;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log('size:', width, 'x', height);
  console.log('distinct colours:', counts.size);
  console.log('non-background pixels:', ink, `(${((ink / total) * 100).toFixed(2)}%)`);
  console.log('top colours:', JSON.stringify(top));
  app.quit();
});
