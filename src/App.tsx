import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, Span, Verse, SpeakResult } from './api';
import './App.css';

type Playback = {
  verse: number;
  spans: Span[];
  url: string;
  durationMs: number;
  boundaryCount: number;
  unmapped: number;
  cached: boolean;
  synthMs: number;
};

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
    /* storage unavailable: defaults still apply next launch */
  }
}

function base64ToBlobUrl(b64: string, mime = 'audio/mpeg') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

// Build render segments: highlighted spans plus the plain gaps between them.
function buildSegments(text: string, spans: Span[]) {
  const segs: { type: 'text' | 'span'; value: string; spanIndex?: number }[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.charStart > cursor) segs.push({ type: 'text', value: text.slice(cursor, s.charStart) });
    segs.push({ type: 'span', value: text.slice(s.charStart, s.charEnd), spanIndex: i });
    cursor = s.charEnd;
  });
  if (cursor < text.length) segs.push({ type: 'text', value: text.slice(cursor) });
  return segs;
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [translation, setTranslation] = useState('CUV');
  const [voice, setVoice] = useState('zh-TW-HsiaoChenNeural');
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    window.api
      .getCatalog()
      .then((c) => {
        setCatalog(c);
        // Explicit user preference wins; otherwise use the locale-derived default.
        // zh-HK / zh-MO locales therefore start in Cantonese on the 和合本 text.
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

  // persist the reader's choices so the locale default is a first-run behaviour only
  useEffect(() => {
    if (!hydrated) return;
    savePrefs({ translation, voice, book, chapter, region });
  }, [hydrated, translation, voice, book, chapter, region]);

  const loadChapter = useCallback(async () => {
    setLoading(true);
    setError(null);
    setVerses([]);
    setPlayback(null);
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
    if (!hydrated) return; // avoid fetching a default chapter before prefs/locale defaults apply
    loadChapter();
  }, [loadChapter, hydrated]);

  // karaoke loop: drive the overlay from audio currentTime
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
        if (t >= s.tMs) idx = i; // hold last completed span so the text does not flicker off
      }
      setActiveSpan(idx);
      if (!a.paused) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playback]);

  const speak = useCallback(
    async (verse: Verse) => {
      const meta = catalog?.translations[translation];
      const chosen = meta?.voices.find((v) => v.id === voice);
      if (!meta || !chosen) return;
      setStatus('synthesizing…');
      const t0 = performance.now();
      try {
        const res: SpeakResult = await window.api.speak({
          text: verse.text,
          voice: chosen.id,
          locale: chosen.locale,
          rate,
        });
        const synthMs = Math.round(performance.now() - t0);
        if (playback?.url) URL.revokeObjectURL(playback.url);
        const url = base64ToBlobUrl(res.audioBase64);
        setPlayback({
          verse: verse.verse,
          spans: res.spans,
          url,
          durationMs: res.durationMs,
          boundaryCount: res.boundaryCount,
          unmapped: res.unmapped,
          cached: res.cached,
          synthMs,
        });
        setStatus('');
      } catch (e) {
        setStatus('');
        setError(String(e));
      }
    },
    [catalog, translation, voice, rate, playback]
  );

  // start playback once the new source is committed to the DOM
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !playback) return;
    setActiveSpan(-1);
    a.load();
    a.play().catch((e) => setError(String(e)));
  }, [playback]);

  const activeVerse = playback?.verse ?? null;
  const segments = useMemo(() => {
    if (!playback) return null;
    const v = verses.find((x) => x.verse === playback.verse);
    return v ? buildSegments(v.text, playback.spans) : null;
  }, [playback, verses]);

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
                // reset to a voice that suits the new translation, preferring one that
                // matches this machine's locale (es-MX -> es-MX voice, zh-HK -> Cantonese)
                const v = catalog?.preferredVoice[next] ?? catalog?.translations[next]?.defaultVoice;
                if (v) setVoice(v);
              }}
            >
              {catalog &&
                Object.entries(catalog.translations).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            書卷
            <select value={book} onChange={(e) => setBook(Number(e.target.value))}>
              {catalog?.books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            聲音
            <select data-testid="voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
              {catalog?.translations[translation]?.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            章
            <input
              type="number"
              min={1}
              value={chapter}
              onChange={(e) => setChapter(Math.max(1, Number(e.target.value) || 1))}
            />
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

      <main className="reader">
        {verses.map((v) => {
          const isActive = activeVerse === v.verse;
          return (
            <div
              key={v.verse}
              className={`verse${isActive ? ' active' : ''}`}
              onClick={() => speak(v)}
              title="點擊朗讀"
            >
              <span className="vnum">{v.verse}</span>
              <p className="vtext">
                {isActive && segments
                  ? segments.map((seg, i) =>
                      seg.type === 'span' ? (
                        <mark
                          key={i}
                          className={seg.spanIndex === activeSpan ? 'on' : undefined}
                        >
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

      <footer className="transport">
        <audio
          ref={audioRef}
          src={playback?.url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setActiveSpan(-1);
          }}
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
          {playback && (
            <>
              <span className="pill">第 {playback.verse} 節</span>
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
