# BibleReader · 聖經朗讀

A Windows desktop Bible reader that speaks what you highlight, in Traditional Chinese,
English, Spanish, and French.

**Status: M1/M3 core complete** — the app reads the full canon, speaks highlighted text,
and plays chapters continuously. See `PROPOSAL.md` for the plan and `SPIKE-RESULTS.md` for
the measurements that shaped it.

---

## What works right now

- **Full canon navigation.** All 66 books for `CUV`, `CUNP`, `RV1960`, `FRLSG`; 83 for
  `WEB` (its 17 deuterocanonical books are grouped separately). Book names are localized
  (繁體中文 / English / Español / Français) because the provider's own names are wrong for
  display — CUV returns Simplified ("创世记") despite Traditional text.
- `CUV` character-spacing is normalized (the 1919 edition arrives as `「 神 愛 世 人 ，`).
- **Highlight-to-speak.** Select any text inside a verse — or drag across verses — and a
  floating bar offers 朗讀選取 / 整節. The selected span is synthesized and karaoke-highlighted
  in place, across verse boundaries if the selection spans them.
- Click any verse → speak that verse. Voices cover Mandarin (`zh-TW`), Cantonese (`zh-HK`),
  English, Spanish (`es-ES`/`es-MX`) and French (`fr-FR`/`fr-CA`), with phrase-level karaoke
  driven by real Edge word-boundary timings.
- **Continuous chapter playback** with prefetch of the next verse while the current one plays,
  auto-advance, auto-scroll to the spoken verse, and stop-at-end.
- Speed control re-synthesizes server-side (0.75×–2×).
- **Disk cache with LRU eviction** for chapters (30-day TTL) and synthesized audio (500 MB
  default cap, `BIBLEREADER_CACHE_MB` to change). Previously read chapters open offline.
- **Offline fallback.** If Edge TTS is unreachable, the app speaks through an OS voice for
  the same locale and keeps word-level karaoke via `speechSynthesis` `onboundary` events.
  It says so in a banner rather than silently degrading.
- Choices persist across launches.

Verified end-to-end by `npm run smoke`, which drives the real UI (click-to-speak,
selection-to-speak, and continuous playback):

```
{"books":{"count":66,"first":"創世記","john":"約翰福音","last":"啟示錄"},
 "clickTest":{"marks":20,"activeMarks":1,"playing":true,"currentTime":1.99},
 "selTest":{"barShown":true,"barButtons":["▶ 朗讀選取","整節","×"],"label":"選取範圍","marks":4,"playing":true},
 "queueTest":{"queuePill":"2/36","playing":true,"activeVerse":"1"}}
```

That is: the 66-book canon loads with Traditional Chinese names, a verse click synthesizes
and plays with live karaoke, a text selection surfaces the action bar and speaks only the
selected span, and continuous playback auto-advanced to verse 2 of 36.

## What is deliberately not built yet

- Bundled CJK font (currently uses the system serif) — M1.
- Sleep timer — M3.
- UI localization: on-screen labels are Chinese-only even when the scripture is English,
  Spanish, or French — M1.
- Packaged installer — M5.

## Cache and offline behaviour

Chapters and synthesized audio are cached under the app data directory
(`cache/chapters`, `cache/audio`) with an LRU index. The index is rebuilt from the filesystem
if it is lost, so a truncated index cannot silently disable eviction.

| setting | default |
|---|---|
| chapter TTL | 30 days |
| audio cache cap | 500 MB (`BIBLEREADER_CACHE_MB`) |
| clear | 清快取 button in the transport, or `cache:clear` IPC |

Verified: cold run reports `source: network` and populates the cache; a second run reports
`source: disk`, shows the 離線快取 note, and needs no network for the chapter.

The fallback ladder is implemented, not aspirational:

1. Edge neural voice.
2. OS voice for the same locale (`speechSynthesis`), with karaoke driven by `onboundary`
   `charIndex`/`charLength`. Verified producing correctly ordered spans on the same verse.
3. A visible banner; if no OS voice exists for that locale, an explicit error rather than
   silence.

For QA, `BIBLEREADER_FORCE_FALLBACK=1` disables Edge synthesis so the fallback path can be
exercised deliberately.

## First-run defaults

The shipped default scripture is Chinese (和合本 `CUV`), and the voice is chosen from the
reader's system language list:

| detected region | default voice |
|---|---|
| `zh-HK` / `zh-MO` / `yue` present | **Cantonese** `zh-HK-HiuGaaiNeural` |
| anything else | Mandarin `zh-TW-HsiaoChenNeural` |

Detection uses `app.getPreferredSystemLanguages()`, **not** `app.getLocale()` — Chromium
normalises `zh-HK` to `zh-TW` at the UI-locale level, so `getLocale()` cannot tell Hong Kong
from Taiwan. Choices are persisted after first run, so the locale default is a first-run
behaviour only, not something that overrides the reader later.

For QA, `BIBLEREADER_LOCALE_OVERRIDE=zh-TW` (or `zh-HK`) forces a branch without touching
OS settings.

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
electron/books.cjs     localized 66-book name tables (zh-Hant/en/es/fr) + canon sections
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
