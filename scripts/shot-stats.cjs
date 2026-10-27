const { app, nativeImage } = require('electron');
const path = require('node:path');
app.whenReady().then(() => {
  for (const f of ['shot-light.png', 'shot-dark.png']) {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', 'spikes', 'out', f));
    if (img.isEmpty()) { console.log(f, 'MISSING'); continue; }
    const { width, height } = img.getSize();
    const buf = img.toBitmap();
    const counts = new Map();
    let dark = 0, light = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const b = buf[i], g = buf[i + 1], r = buf[i + 2];
      const k = `${r},${g},${b}`;
      counts.set(k, (counts.get(k) || 0) + 1);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 90) dark++;
      if (lum > 170) light++;
    }
    const total = width * height;
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    console.log(`${f}: ${width}x${height} colours=${counts.size} dark%=${(dark / total * 100).toFixed(1)} light%=${(light / total * 100).toFixed(1)}`);
    console.log('  top:', JSON.stringify(top));
  }
  app.quit();
});
