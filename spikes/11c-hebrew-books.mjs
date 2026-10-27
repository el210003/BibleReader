for (const t of ['WLC', 'WLCa', 'WLCC', 'HAC', 'DHNT']) {
  try {
    const books = await (await fetch(`https://bolls.life/get-books/${t}/`, { headers: { 'User-Agent': 'BibleReader/0.1' } })).json();
    const ids = books.map(b => b.bookid);
    console.log(`${t}: ${books.length} books | id range ${Math.min(...ids)}-${Math.max(...ids)} | first=${books[0].name} | last=${books[books.length-1].name}`);
  } catch (e) { console.log(t, 'FAILED', String(e).slice(0, 60)); }
}
