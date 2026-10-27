// `npm run doctor` — answers "why is the window blank?" without guessing.
// Checks build output, preload wiring, cache dir, provider reachability and TTS reachability.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ok = (m) => console.log(`[OK]   ${m}`);
const bad = (m) => console.log(`[FAIL] ${m}`);
const warn = (m) => console.log(`[WARN] ${m}`);

async function main() {
  console.log('BibleReader doctor\n');

  // 1. build output
  const dist = path.join(root, 'dist', 'index.html');
  if (fs.existsSync(dist)) {
    const assets = path.join(root, 'dist', 'assets');
    const files = fs.existsSync(assets) ? fs.readdirSync(assets) : [];
    ok(`build present (${files.length} asset files)`);
    if (!files.some((f) => f.endsWith('.js'))) bad('dist/assets has no .js bundle');
  } else {
    bad('dist/index.html missing — run `npm run build` or `npm start`');
  }

  // 2. electron entry + preload wiring
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.main) ok(`package.json main = ${pkg.main}`);
  else bad('package.json has no "main"');
  const preload = path.join(root, 'electron', 'preload.cjs');
  if (fs.existsSync(preload)) ok('preload.cjs present');
  else bad('preload.cjs missing');

  const mainSrc = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  if (mainSrc.includes("preload: path.join(__dirname, 'preload.cjs')")) ok('main.cjs wires the preload script');
  else bad('main.cjs does not wire preload.cjs');

  // 3. native deps that need an ABI match
  ok(`node ${process.versions.node}, electron module ${require('electron/package.json').version}`);

  // 4. cache dir
  try {
    const cache = require('./cache.cjs');
    const s = cache.stats();
    ok(`cache root ${s.root} (${Math.round(s.totalBytes / 1048576)}MB, ${s.chapters} chapters, ${s.audio} audio)`);
  } catch (e) {
    bad(`cache init failed: ${String(e)}`);
  }

  // 5. provider reachability
  try {
    const res = await fetch('https://bolls.life/get-text/CUV/43/3/', {
      headers: { 'User-Agent': 'BibleReader/0.1 (doctor)' },
    });
    if (res.ok) ok(`bolls.life reachable (${res.status})`);
    else bad(`bolls.life returned ${res.status}`);
  } catch (e) {
    warn(`bolls.life unreachable — cached chapters still work (${String(e).slice(0, 80)})`);
  }

  // 6. TTS reachability
  try {
    const res = await fetch(
      'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4',
      { headers: { 'User-Agent': 'BibleReader/0.1 (doctor)' } }
    );
    if (res.ok) {
      const voices = await res.json();
      ok(`Edge voice list reachable (${voices.length} voices)`);
    } else {
      warn(`Edge voice list returned ${res.status} — fallback to OS voices will apply`);
    }
  } catch (e) {
    warn(`Edge TTS unreachable — fallback to OS voices will apply (${String(e).slice(0, 80)})`);
  }

  console.log('\nIf the window is blank but every check passes, run:');
  console.log('  npx electron . 2>&1 | head -40');
  console.log('and look for [load], [preload], or [renderer] lines.');
}

main().catch((e) => {
  bad(String(e));
  process.exitCode = 1;
});
