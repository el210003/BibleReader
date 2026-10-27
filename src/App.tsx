import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, BookList, Catalog, Span, SpeakResult, Verse } from './api';
import './App.css';

type PlaySpan = { verse: number; charStart: number; charEnd: number; tMs: number; durMs: number };

type Playback = {
  spans: PlaySpan[];
  url: string;
  durationMs: number;
  boundaryCount: number;
  unmapped: number;
  cached: boolean;
  synthMs: number;
  label: string;
};

type SelectionBar = { x: number; y: number; text: string; start: number; end: number };

type Prefs = { translation: string; voice: string; book: number; chapter: number; region?: string };

const PREFS_KEY = 'biblereader.prefs.v1';

function loadPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : null;
  } catch {
    return null;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

function base64ToBlobUrl(b64: string, mime = 'audio/mpeg') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

function closestVerseEl(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  return (el?.closest('.verse') as HTMLElement | null) ?? null;
}

function offsetWithin(vtext: Element, container: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(vtext, 0);
  try {
    r.setEnd(container, offset);
  } catch {
    return 0;
  }
  return r.toString().length;
}

// Map synthesized spans (relative to the spoken substring) back onto verse-relative
// offsets. Spans that cross a verse boundary are clamped; bridging in main keeps that rare.
function mapSpansToVerses(
  spans: Span[],
  selStart: number,
  verseStarts: number[],
  verseLengths: number[]
): PlaySpan[] {
  const out: PlaySpan[] = [];
  for (const s of spans) {
    const gStart = selStart + s.charStart;
    const gEnd = selStart + s.charEnd;
    let vi = -1;
    for (let i = 0; i < verseStarts.length; i++) {
      if (gStart >= verseStarts[i] && gStart < verseStarts[i] + verseLengths[i]) {
        vi = i;
        break;
      }
    }
    if (vi < 0) continue;
    const verseEnd = verseStarts[vi] + verseLengths[vi];
    const charEnd = Math.min(gEnd, verseEnd) - verseStarts[vi];
    out.push({
      verse: vi + 1,
      charStart: gStart - verseStarts[vi],
      charEnd: Math.max(charEnd, gStart - verseStarts[vi] + 1),
      tMs: s.tMs,
      durMs: s.durMs,
    });
  }
  return out;
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [translation, setTranslation] = useState('CUV');
  const [voice, setVoice] = useState('zh-TW-HsiaoChenNeural');
  const [bookList, setBookList] = useState<BookList | null>(null);
  const [book, setBook] = useState(43);
  const [chapter, setChapter] = useState(3);
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [activeSpan, setActiveSpan] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState('1');
  const [status, setStatus] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [region, setRegion] = useState('default');
  const [selBar, setSelBar] = useState<SelectionBar | null>(null);
  const [queue, setQueue] = useState<{ list: number[]; pos: number } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const prefetchRef = useRef<Set<number>>(new Set());

  // ---------- boot: catalog + first-run defaults ----------
  useEffect(() => {
    window.api
      .getCatalog()
      .then((c) => {
        setCatalog(c);
        const saved = loadPrefs();
        if (saved && c.translations[saved.translation]) {
          setTranslation(saved.translation);
          setVoice(saved.voice);
          setBook(saved.book);
          setChapter(saved.chapter);
          setRegion(saved.region ?? c.defaults.region);
        } else {
          setTranslation(c.defaults.translation);
          setVoice(c.defaults.voice);
          setRegion(c.defaults.region);
        }
        setHydrated(true);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    savePrefs({ translation, voice, book, chapter, region });
  }, [hydrated, translation, voice, book, chapter, region]);

  // ---------- books ----------
  useEffect(() => {
    if (!hydrated) return;
    window.api
      .getBooks({ translation })
      .then((bl) => {
        setBookList(bl);
        if (!bl.books.some((b) => b.id === book)) setBook(bl.books[0]?.id ?? 1);
      })
      .catch((e) => setError(String(e)));
  }, [translation, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentBook: Book | undefined = bookList?.books.find((b) => b.id === book);

  // clamp chapter when the book changes
  useEffect(() => {
    if (!currentBook) return;
    if (chapter > currentBook.chapters) setChapter(1);
  }, [currentBook, chapter]);

  // ---------- chapter ----------
  const loadChapter = useCallback(async () => {
    setLoading(true);
    setError(null);
    setVerses([]);
    setPlayback(null);
    setQueue(null);
    setSelBar(null);
    try {
      const rows = await window.api.getChapter({ translation, book, chapter });
      setVerses(rows);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [translation, book, chapter]);

  useEffect(() => {
    if (!hydrated) return;
    loadChapter();
  }, [loadChapter, hydrated]);

  // ---------- chapter-level text index (for selection -> speech) ----------
  const chapterIndex = useMemo(() => {
    const starts: number[] = [];
    const lengths: number[] = [];
    let cursor = 0;
    for (const v of verses) {
      starts.push(cursor);
      lengths.push(v.text.length);
      cursor += v.text.length;
    }
    return { starts, lengths, fullText: verses.map((v) => v.text).join('') };
  }, [verses]);

  // ---------- playback helpers ----------
  const speakRange = useCallback(
    async (startGlobal: number, endGlobal: number, label: string, opts?: { keepQueue?: boolean }) => {
      const text = chapterIndex.fullText.slice(startGlobal, endGlobal);
      if (!text.trim()) return;
      const meta = catalog?.translations[translation];
      const chosen = meta?.voices.find((v) => v.id === voice);
      if (!chosen) return;

      if (!opts?.keepQueue) setQueue(null);
      setStatus('合成中…');
      setSelBar(null);
      const t0 = performance.now();
      try {
        const res: SpeakResult = await window.api.speak({
          text,
          voice: chosen.id,
          locale: chosen.locale,
          rate,
        });
        const synthMs = Math.round(performance.now() - t0);
        const spans = mapSpansToVerses(res.spans, startGlobal, chapterIndex.starts, chapterIndex.lengths);
        setPlayback((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return {
            spans,
            url: base64ToBlobUrl(res.audioBase64),
            durationMs: res.durationMs,
            boundaryCount: res.boundaryCount,
            unmapped: res.unmapped,
            cached: res.cached,
            synthMs,
            label,
          };
        });
        setStatus('');
      } catch (e) {
        setStatus('');
        setError(String(e));
      }
    },
    [chapterIndex, catalog, translation, voice, rate]
  );

  const verseRange = useCallback(
    (verseNum: number) => {
      const i = verses.findIndex((v) => v.verse === verseNum);
      if (i < 0) return null;
      return { start: chapterIndex.starts[i], end: chapterIndex.starts[i] + chapterIndex.lengths[i] };
    },
    [verses, chapterIndex]
  );

  const speakVerse = useCallback(
    (verseNum: number) => {
      const r = verseRange(verseNum);
      if (r) speakRange(r.start, r.end, `第 ${verseNum} 節`);
    },
    [verseRange, speakRange]
  );
  // ---------- continuous chapter playback ----------
  const startQueue = useCallback(
    (fromVerse: number) => {
      const list = verses.filter((v) => v.verse >= fromVerse).map((v) => v.verse);
      if (!list.length) return;
      prefetchRef.current.clear();
      setQueue({ list, pos: 0 });
    },
    [verses]
  );

  // drive the queue: synthesize current, prefetch next
  useEffect(() => {
    if (!queue) return;
    const verseNum = queue.list[queue.pos];
    const r = verseRange(verseNum);
    if (!r) return;

    speakRange(r.start, r.end, `第 ${verseNum} 節`, { keepQueue: true });

    // prefetch the next verse into the main-process cache while this one plays
    const next = queue.list[queue.pos + 1];
    const meta = catalog?.translations[translation];
    const chosen = meta?.voices.find((v) => v.id === voice);
    if (next && chosen && !prefetchRef.current.has(next)) {
      prefetchRef.current.add(next);
      const nr = verseRange(next);
      if (nr) {
        window.api
          .speak({
            text: chapterIndex.fullText.slice(nr.start, nr.end),
            voice: chosen.id,
            locale: chosen.locale,
            rate,
          })
          .catch(() => {});
      }
    }
  }, [queue, verseRange, speakRange, chapterIndex, catalog, translation, voice, rate]);

  // ---------- audio ----------
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !playback) return;
    setActiveSpan(-1);
    a.load();
    a.play().catch((e) => setError(String(e)));
  }, [playback]);

  useEffect(() => {
    if (!playback || !audioRef.current) return;
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      const t = a.currentTime * 1000;
      let idx = -1;
      for (let i = 0; i < playback.spans.length; i++) {
        const s = playback.spans[i];
        if (t >= s.tMs && t < s.tMs + s.durMs) { idx = i; break; }
        if (t >= s.tMs) idx = i;
      }
      setActiveSpan(idx);
      if (!a.paused) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playback]);

  // auto-scroll to the verse being spoken
  useEffect(() => {
    if (activeSpan < 0 || !playback) return;
    const s = playback.spans[activeSpan];
    if (!s) return;
    const el = document.querySelector(`.verse[data-verse="${s.verse}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeSpan, playback]);

  const onEnded = useCallback(() => {
    setPlaying(false);
    if (queue && queue.pos < queue.list.length - 1) {
      setQueue({ ...queue, pos: queue.pos + 1 });
    } else {
      setActiveSpan(-1);
      setQueue(null);
    }
  }, [queue]);

  // ---------- selection -> speech ----------
  const onMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelBar(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const startEl = closestVerseEl(range.startContainer);
    const endEl = closestVerseEl(range.endContainer);
    if (!startEl || !endEl) {
      setSelBar(null);
      return;
    }
    const sv = Number(startEl.dataset.verse);
    const ev = Number(endEl.dataset.verse);
    const svIdx = verses.findIndex((v) => v.verse === sv);
    const evIdx = verses.findIndex((v) => v.verse === ev);
    if (svIdx < 0 || evIdx < 0 || evIdx < svIdx) {
      setSelBar(null);
      return;
    }

    const startVtext = startEl.querySelector('.vtext');
    const endVtext = endEl.querySelector('.vtext');
    if (!startVtext || !endVtext) return;

    const startOff = offsetWithin(startVtext, range.startContainer, range.startOffset);
    const endOff = offsetWithin(endVtext, range.endContainer, range.endOffset);
    const startGlobal = chapterIndex.starts[svIdx] + startOff;
    const endGlobal = chapterIndex.starts[evIdx] + endOff;
    if (endGlobal <= startGlobal) {
      setSelBar(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    setSelBar({
      x: rect.left + rect.width / 2,
      y: rect.top,
      text: chapterIndex.fullText.slice(startGlobal, endGlobal),
      start: startGlobal,
      end: endGlobal,
    });
  }, [verses, chapterIndex]);

  // ---------- render helpers ----------
  const segmentsFor = useCallback(
    (v: Verse) => {
      if (!playback) return null;
      const spans = playback.spans.filter((s) => s.verse === v.verse);
      if (!spans.length) return null;
      const segs: { type: 'text' | 'span'; value: string; spanIdx: number }[] = [];
      let cursor = 0;
      for (const s of spans) {
        const idx = playback.spans.indexOf(s);
        if (s.charStart > cursor) segs.push({ type: 'text', value: v.text.slice(cursor, s.charStart), spanIdx: -1 });
        segs.push({ type: 'span', value: v.text.slice(s.charStart, s.charEnd), spanIdx: idx });
        cursor = s.charEnd;
      }
      if (cursor < v.text.length) segs.push({ type: 'text', value: v.text.slice(cursor), spanIdx: -1 });
      return segs;
    },
    [playback]
  );

  const activeVerse = activeSpan >= 0 && playback ? playback.spans[activeSpan]?.verse : null;
  const bookSections = useMemo(() => {
    if (!bookList) return [];
    const order: Array<'old' | 'new' | 'deutero'> = ['old', 'new', 'deutero'];
    return order
      .map((s) => ({ key: s, label: bookList.sections[s], books: bookList.books.filter((b) => b.section === s) }))
      .filter((g) => g.books.length > 0);
  }, [bookList]);

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <span className="brand-cn">聖經朗讀</span>
          <span className="brand-en">BibleReader</span>
        </div>
        <div className="controls">
          <label>
            譯本
            <select
              value={translation}
              onChange={(e) => {
                const next = e.target.value;
                setTranslation(next);
                const v = catalog?.preferredVoice[next] ?? catalog?.translations[next]?.defaultVoice;
                if (v) setVoice(v);
              }}
            >
              {catalog &&
                Object.entries(catalog.translations).map(([k, v]) => (
                  <option key={k} value={k}>{v.name}</option>
                ))}
            </select>
          </label>
          <label>
            書卷
            <select value={book} onChange={(e) => setBook(Number(e.target.value))}>
              {bookSections.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {g.books.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            章
            <select value={chapter} onChange={(e) => setChapter(Number(e.target.value))}>
              {Array.from({ length: currentBook?.chapters ?? 1 }, (_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}</option>
              ))}
            </select>
          </label>
          <label>
            聲音
            <select data-testid="voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
              {catalog?.translations[translation]?.voices.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
          <button onClick={loadChapter} disabled={loading}>
            {loading ? '載入中…' : '載入'}
          </button>
        </div>
      </header>

      {error && (
        <div className="error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <main className="reader" onMouseUp={onMouseUp}>
        {verses.map((v) => {
          const segs = segmentsFor(v);
          return (
            <div
              key={v.verse}
              className={`verse${activeVerse === v.verse ? ' active' : ''}`}
              data-verse={v.verse}
              onClick={() => speakVerse(v.verse)}
              title="點擊朗讀整節"
            >
              <span className="vnum">{v.verse}</span>
              <p className="vtext">
                {segs
                  ? segs.map((seg, i) =>
                      seg.type === 'span' ? (
                        <mark key={i} className={seg.spanIdx === activeSpan ? 'on' : undefined}>
                          {seg.value}
                        </mark>
                      ) : (
                        <span key={i}>{seg.value}</span>
                      )
                    )
                  : v.text}
              </p>
            </div>
          );
        })}
        {!loading && verses.length === 0 && !error && <p className="empty">沒有內容</p>}
      </main>

      {selBar && (
        <div className="selbar" style={{ left: selBar.x, top: selBar.y }}>
          <button className="primary" onClick={() => speakRange(selBar.start, selBar.end, '選取範圍')}>
            ▶ 朗讀選取
          </button>
          <button
            onClick={() => {
              const idx = chapterIndex.starts.findLastIndex((s) => s <= selBar.start);
              const sv = verses[idx];
              if (sv) speakVerse(sv.verse);
            }}
          >
            整節
          </button>
          <button onClick={() => { window.getSelection()?.removeAllRanges(); setSelBar(null); }}>×</button>
        </div>
      )}

      <footer className="transport">
        <audio
          ref={audioRef}
          src={playback?.url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={onEnded}
        />
        <button
          className="primary"
          disabled={!playback}
          onClick={() => {
            const a = audioRef.current;
            if (!a) return;
            if (a.paused) a.play().catch((e) => setError(String(e)));
            else a.pause();
          }}
        >
          {playing ? '⏸ 暫停' : '▶ 播放'}
        </button>
        <button
          disabled={!playback}
          onClick={() => {
            const a = audioRef.current;
            if (!a) return;
            a.pause();
            a.currentTime = 0;
            setActiveSpan(-1);
          }}
        >
          ⏹ 停止
        </button>
        <button disabled={!verses.length} onClick={() => startQueue(activeVerse ?? verses[0]?.verse ?? 1)}>
          ▶ 連續朗讀
        </button>
        <label>
          速度
          <select value={rate} onChange={(e) => setRate(e.target.value)}>
            <option value="0.75">0.75×</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
          </select>
        </label>
        <div className="meta">
          {status && <span className="pill">{status}</span>}
          {queue && <span className="pill" data-testid="queue">{queue.pos + 1}/{queue.list.length}</span>}
          {playback && (
            <>
              <span className="pill">{playback.label}</span>
              <span className="pill">{Math.round(playback.durationMs / 100) / 10}s</span>
              <span className="pill">{playback.boundaryCount} boundaries</span>
              <span className="pill">{playback.cached ? 'cached' : `${playback.synthMs}ms`}</span>
              {playback.unmapped > 0 && <span className="pill warn">{playback.unmapped} unmapped</span>}
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
