const urls = [
  'https://github.com/google/fonts/raw/main/ofl/notoserifhebrew/NotoSerifHebrew%5Bwdth,wght%5D.ttf',
  'https://github.com/google/fonts/raw/main/ofl/frankruhllibre/FrankRuhlLibre%5Bwght%5D.ttf',
  'https://github.com/notofonts/hebrew/raw/main/fonts/NotoSerifHebrew/unhinted/ttf/NotoSerifHebrew-Regular.ttf',
  'https://github.com/notofonts/hebrew/raw/main/fonts/NotoSerifHebrew/hinted/ttf/NotoSerifHebrew-Regular.ttf',
];
for (const u of urls) {
  try {
    const r = await fetch(u, { method: 'HEAD', redirect: 'follow' });
    console.log(r.status, r.headers.get('content-length'), u.split('/').slice(-2).join('/'));
  } catch (e) { console.log('FAIL', u.split('/').pop(), String(e).slice(0, 50)); }
}

const books = await (await fetch('https://bolls.life/get-books/WLC/', { headers: { 'User-Agent': 'BibleReader/0.1' } })).json();
console.log('WLC books:', books.length, '| first 3:', books.slice(0, 3).map(b => b.name).join(' , '), '| last:', books[books.length - 1].name);
