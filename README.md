# BibleReader · 聖經朗讀

A Windows desktop Bible reader that speaks what you highlight, in Traditional Chinese,
English, Spanish, and French.

**Status: M0 complete** — scaffolded app runs end-to-end (fetch chapter → synthesize →
karaoke highlight). See `PROPOSAL.md` for the plan and `SPIKE-RESULTS.md` for the
measurements that shaped it.

---

## What works right now

- Loads John 3 (and Genesis 1 / Psalms 23 / Romans 8) from bolls.life in `CUV`, `CUNP`,
  `WEB`, `RV1960`, `FRLSG`.
- `CUV` character-spacing is normalized (the 1919 edition arrives as `「 神 愛 世 人 ，`).
- Click any verse → synthesized `zh-TW` / `en-US` / `es-ES` / `fr-FR` audio plays, with
  phrase-level karaoke highlighting driven by real Edge word-boundary timings.
- Speed control re-synthesizes server-side (0.75×–2×).
- In-memory audio cache.

Verified end-to-end by `npm run smoke`, which drives the real UI:

```
{"verses":36,"ui":{"marks":18,"activeMarks":1,"audioSrc":true,"playing":true,
 "currentTime":2.06,"status":["第 16 節","8.1s","18 boundaries","340ms"]}}
```

That is: 36 verses of CUV John 3 loaded and normalized, verse 16 clicked, audio synthesized
in 340 ms, playback running at t=2.06 s, and exactly one highlight mark active — the karaoke
overlay is tracking the real word-boundary timeline.

## What is deliberately not built yet

- Disk cache (LRU) — M2.
- Full 66-book name tables for all four locales (only 4 books are listed) — M1.
- Bundled CJK font (currently uses system serif) — M1.
- Continuous chapter playback, prefetch, sleep timer — M2/M3.
- Web Speech fallback when offline — M4.
- Packaged installer — M5.

## Run it

```bash
npm install
npm run dev          # Vite dev server + Electron
npm run smoke        # headless-ish check: loads app, fetches a chapter, synthesizes a verse
npm start            # build then run from dist/
```

## Layout

```
electron/main.cjs       main process, IPC, window
electron/preload.cjs    contextBridge API (getCatalog / getChapter / speak)
electron/scripture.cjs  bolls.life provider + CUV normalization
electron/tts.cjs        Edge TTS synthesis + word-boundary → highlight-plan mapping
src/App.tsx             reader UI, karaoke overlay, transport
spikes/                 M0 spike scripts (runnable with node)
spikes/out/             generated audio artifacts (gitignored)
```

## Security posture

Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and a CSP meta
tag. All network and filesystem access happens in the main process. `'unsafe-inline'` in
`script-src` exists only for Vite's dev-time React refresh preamble and can be dropped
for packaged builds.

## Known constraints

- Edge Read Aloud is an unofficial API. It works today (322 voices, no key), but the
  library handles `Sec-MS-GEC` token and clock-skew retries; pin `msedge-tts` and keep the
  Web Speech fallback in the plan.
- Long-text synthesis latency is highly variable (4–48 s for 700–2000 chars). Always
  synthesize per verse.
- Each verse's audio carries 500–950 ms of trailing silence. Decide the inter-verse pause
  explicitly rather than inheriting it.
- Licensed translations (`NIV`, `ESV`, `NVI`, `NBS`, `思高`) are opt-in; the shipped
  defaults (`CUV`, `WEB`, `RV1960`, `FRLSG`) are public domain.

## License note

Scripture text is served by bolls.life. Public-domain editions are used as defaults so the
app is legally clean out of the box.
