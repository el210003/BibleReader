import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, BookList, CacheStats, Catalog, Span, Verse } from './api';
import './App.css';

type PlaySpan = { verse: number; charStart: number; charEnd: number; tMs: number; durMs: number };

type Playback = {
  mode: 'edge' | 'system';
  spans: PlaySpan[];
  url?: string;
  durationMs: number;
  boundaryCount: number;
  unmapped: number;
  source: 'memory' | 'disk' | 'network' | 'system';
  synthMs: number;
  label: string;
};

type SelectionBar = { x: number; y: number; start: number; end: number };
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

function mapSpansToVerses(
  spans: Span[],
  selStart: number,
  verseStarts: number[],
  verseLengths: number[]
): PlaySpan[] {
  const out: PlaySpan[] = [];
  for (const s of spans) {
    const gStart = selStart + s.charStart;
    let vi = -1;
    for (let i = 0; i < verseStarts.length; i++) {
      if (gStart >= verseStarts[i] && gStart < verseStarts[i] + verseLengths[i]) {
        vi = i;
        break;
      }
    }
    if (vi < 0) continue;
    // clamp to the verse so a span can never bleed into the next one
    const verseEnd = verseStarts[vi] + verseLengths[vi];
    const gEnd = Math.min(selStart + s.charEnd, verseEnd);
    const charStart = gStart - verseStarts[vi];
    out.push({
      verse: vi + 1,
      charStart,
      charEnd: Math.max(gEnd - verseStarts[vi], charStart + 1),
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
  const [chapterMeta, setChapterMeta] = useState<{ fromCache: boolean; fetchedAt: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [activeSpan, setActiveSpan] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState('1');
  const [status, setStatus] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [region, setRegion] = useState('default');
  const [selBar, setSelBar] = useState<SelectionBar | null>(null);
  const [queue, setQueue] = useState<{ list: number[]; pos: number } | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const prefetchRef = useRef<Set<number>>(new Set());
  const queueRef = useRef<{ list: number[]; pos: number } | null>(null);
  const sysSpanCount = useRef(0);
  const cancelledRef = useRef(false);
  const handleEndedRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // ---------- boot ----------
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
    window.api.cacheStats().then(setCache).catch(() => {});
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    savePrefs({ translation, voice, book, chapter, region });
  }, [hydrated, translation, voice, book, chapter, region]);

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
      const res = await window.api.getChapter({ translation, book, chapter });
      setVerses(res.verses);
      setChapterMeta({ fromCache: res.fromCache, fetchedAt: res.fetchedAt });
    } catch (e) {
      setError(String(e));
      setChapterMeta(null);
    } finally {
      setLoading(false);
    }
  }, [translation, book, chapter]);

  useEffect(() => {
    if (!hydrated) return;
    loadChapter();
  }, [loadChapter, hydrated]);

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

  const verseRange = useCallback(
    (verseNum: number) => {
      const i = verses.findIndex((v) => v.verse === verseNum);
      if (i < 0) return null;
      return { start: chapterIndex.starts[i], end: chapterIndex.starts[i] + chapterIndex.lengths[i] };
    },
    [verses, chapterIndex]
  );

  // ---------- system-voice fallback (offline / Edge failure) ----------
  // getVoices() can be empty until 'voiceschanged' fires, so wait for it rather than
  // concluding "no voice installed" on the first attempt.
  const getSystemVoice = useCallback(async (locale: string) => {
    const synth = window.speechSynthesis;
    let voices = synth.getVoices();
    if (!voices.length) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        synth.addEventListener('voiceschanged', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      voices = synth.getVoices();
    }
    const exact = voices.find((v) => v.lang.toLowerCase() === locale.toLowerCase());
    const prefix = voices.find((v) => v.lang.toLowerCase().startsWith(locale.split('-')[0]));
    return exact ?? prefix ?? null;
  }, []);

  const speakSystem = useCallback(
    async (text: string, locale: string, startGlobal: number, label: string) => {
      const synth = window.speechSynthesis;
      const v = await getSystemVoice(locale);
      if (!v) {
        setError(`Edge 連線失敗，且系統沒有 ${locale} 語音`);
        setStatus('');
        return;
      }

      cancelledRef.current = false;
      sysSpanCount.current = 0;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v;
      u.lang = v.lang;
      // honour the same speed control the Edge path uses (SAPI accepts 0.1-10)
      u.rate = Math.min(10, Math.max(0.1, Number(rate) || 1));

      setPlayback((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          mode: 'system',
          spans: [],
          durationMs: 0,
          boundaryCount: 0,
          unmapped: 0,
          source: 'system',
          synthMs: 0,
          label: `${label}（系統語音 ${v.lang}）`,
        };
      });
      setActiveSpan(-1);
      setStatus('');

      u.onboundary = (ev) => {
        const cs = ev.charIndex ?? 0;
        const len = (ev as SpeechSynthesisEvent & { charLength?: number }).charLength || 1;
        const mapped = mapSpansToVerses(
          [{ charStart: cs, charEnd: cs + len, tMs: (ev.elapsedTime || 0) * 1000, durMs: 220 }],
          startGlobal,
          chapterIndex.starts,
          chapterIndex.lengths
        );
        if (!mapped.length) return;
        sysSpanCount.current += mapped.length;
        setActiveSpan(sysSpanCount.current - 1);
        setPlayback((p) => (p && p.mode === 'system' ? { ...p, spans: [...p.spans, ...mapped] } : p));
      };
      u.onstart = () => setPlaying(true);
      u.onend = () => {
        setPlaying(false);
        if (!cancelledRef.current) handleEndedRef.current?.();
      };
      u.onerror = () => setPlaying(false);

      synth.speak(u);
      setNotice(`Edge 不可用，改用系統語音（${v.lang}）`);
    },
    [chapterIndex, getSystemVoice, rate]
  );

  // ---------- Edge TTS ----------
  const speakEdge = useCallback(
    async (startGlobal: number, endGlobal: number, label: string, opts?: { keepQueue?: boolean }) => {
      const text = chapterIndex.fullText.slice(startGlobal, endGlobal);
      if (!text.trim()) return false;
      const meta = catalog?.translations[translation];
      const chosen = meta?.voices.find((v) => v.id === voice);
      if (!chosen) return false;

      if (!opts?.keepQueue) setQueue(null);
      setStatus('合成中…');
      const t0 = performance.now();
      try {
        const res = await window.api.speak({ text, voice: chosen.id, locale: chosen.locale, rate });
        const synthMs = Math.round(performance.now() - t0);
        const spans = mapSpansToVerses(res.spans, startGlobal, chapterIndex.starts, chapterIndex.lengths);
        setPlayback((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return {
            mode: 'edge',
            spans,
            url: base64ToBlobUrl(res.audioBase64),
            durationMs: res.durationMs,
            boundaryCount: res.boundaryCount,
            unmapped: res.unmapped,
            source: res.source,
            synthMs,
            label,
          };
        });
        setNotice(null);
        setStatus('');
        window.api.cacheStats().then(setCache).catch(() => {});
        return true;
      } catch {
        setStatus('');
        return false;
      }
    },
    [chapterIndex, catalog, translation, voice, rate]
  );

  const speakRange = useCallback(
    async (startGlobal: number, endGlobal: number, label: string, opts?: { keepQueue?: boolean }) => {
      setSelBar(null);
      const ok = await speakEdge(startGlobal, endGlobal, label, opts);
      if (ok) return;
      const meta = catalog?.translations[translation];
      const chosen = meta?.voices.find((v) => v.id === voice);
      if (!chosen) return;
      if (!opts?.keepQueue) setQueue(null);
      const text = chapterIndex.fullText.slice(startGlobal, endGlobal);
      await speakSystem(text, chosen.locale, startGlobal, label);
    },
    [speakEdge, speakSystem, catalog, translation, voice, chapterIndex]
  );

  const speakVerse = useCallback(
    (verseNum: number) => {
      const r = verseRange(verseNum);
      if (r) speakRange(r.start, r.end, `第 ${verseNum} 節`);
    },
    [verseRange, speakRange]
  );

  // ---------- queue ----------
  const startQueue = useCallback(
    (fromVerse: number) => {
      const list = verses.filter((v) => v.verse >= fromVerse).map((v) => v.verse);
      if (!list.length) return;
      prefetchRef.current.clear();
      setQueue({ list, pos: 0 });
    },
    [verses]
  );

  useEffect(() => {
    if (!queue) return;
    const verseNum = queue.list[queue.pos];
    const r = verseRange(verseNum);
    if (!r) return;

    speakRange(r.start, r.end, `第 ${verseNum} 節`, { keepQueue: true });

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

  const handleEnded = useCallback(() => {
    const q = queueRef.current;
    if (q && q.pos < q.list.length - 1) {
      setQueue({ ...q, pos: q.pos + 1 });
    } else {
      setActiveSpan(-1);
      setQueue(null);
    }
  }, []);

  useEffect(() => {
    handleEndedRef.current = handleEnded;
  }, [handleEnded]);

  // ---------- audio ----------
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !playback || playback.mode !== 'edge') return;
    setActiveSpan(-1);
    a.load();
    a.play().catch((e) => setError(String(e)));
  }, [playback]);

  useEffect(() => {
    if (!playback || playback.mode !== 'edge' || !audioRef.current) return;
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

  useEffect(() => {
    if (activeSpan < 0 || !playback) return;
    const s = playback.spans[activeSpan];
    if (!s) return;
    document.querySelector(`.verse[data-verse="${s.verse}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeSpan, playback]);

  const stopAll = useCallback(() => {
    cancelledRef.current = true;
    window.speechSynthesis.cancel();
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    setPlaying(false);
    setActiveSpan(-1);
    setQueue(null);
  }, []);

  // ---------- selection ----------
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
    const svIdx = verses.findIndex((v) => v.verse === Number(startEl.dataset.verse));
    const evIdx = verses.findIndex((v) => v.verse === Number(endEl.dataset.verse));
    if (svIdx < 0 || evIdx < 0 || evIdx < svIdx) {
      setSelBar(null);
      return;
    }
    const startVtext = startEl.querySelector('.vtext');
    const endVtext = endEl.querySelector('.vtext');
    if (!startVtext || !endVtext) return;

    const startGlobal = chapterIndex.starts[svIdx] + offsetWithin(startVtext, range.startContainer, range.startOffset);
    const endGlobal = chapterIndex.starts[evIdx] + offsetWithin(endVtext, range.endContainer, range.endOffset);
    if (endGlobal <= startGlobal) {
      setSelBar(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelBar({ x: rect.left + rect.width / 2, y: rect.top, start: startGlobal, end: endGlobal });
  }, [verses, chapterIndex]);

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
    return (['old', 'new', 'deutero'] as const)
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
      {notice && (
        <div className="notice">
          {notice}
          <button onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <main className="reader" onMouseUp={onMouseUp}>
        {chapterMeta?.fromCache && (
          <p className="cached-note">
            離線快取 · {new Date(chapterMeta.fetchedAt).toLocaleDateString()}
          </p>
        )}
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
          src={playback?.mode === 'edge' ? playback.url : undefined}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            handleEnded();
          }}
        />
        <button
          className="primary"
          disabled={!playback}
          onClick={() => {
            if (playback?.mode === 'system') {
              if (playing) window.speechSynthesis.pause();
              else window.speechSynthesis.resume();
              setPlaying(!playing);
              return;
            }
            const a = audioRef.current;
            if (!a) return;
            if (a.paused) a.play().catch((e) => setError(String(e)));
            else a.pause();
          }}
        >
          {playing ? '⏸ 暫停' : '▶ 播放'}
        </button>
        <button disabled={!playback} onClick={stopAll}>⏹ 停止</button>
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
        <button
          onClick={async () => {
            const s = await window.api.clearCache();
            setCache(s);
            setNotice('已清除快取');
          }}
        >
          清快取
        </button>
        <div className="meta">
          {status && <span className="pill">{status}</span>}
          {queue && <span className="pill" data-testid="queue">{queue.pos + 1}/{queue.list.length}</span>}
          {cache && (
            <span className="pill" data-testid="cache">
              cache {Math.round(cache.totalBytes / 1048576)}MB
            </span>
          )}
          {playback && (
            <>
              <span className="pill">{playback.label}</span>
              <span className="pill">{playback.source}</span>
              <span className="pill">{playback.boundaryCount} boundaries</span>
              {playback.mode === 'edge' && (
                <span className="pill">{Math.round(playback.durationMs / 100) / 10}s</span>
              )}
              {playback.unmapped > 0 && <span className="pill warn">{playback.unmapped} unmapped</span>}
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
