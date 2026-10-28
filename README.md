# BibleReader · 聖經朗讀

A Windows desktop Bible reader that speaks what you highlight, in Traditional Chinese,
English, Spanish, French, and Hebrew scripture (right-to-left).

**Status: M0–M5 implemented** — full canon, highlight-to-speak, continuous playback, disk
cache with offline reads, OS-voice fallback, bundled CJK font, four-locale UI, keyboard
shortcuts, and an NSIS installer. Not done: code signing. See `PROPOSAL.md` (§12 as-built
deviations) and `SPIKE-RESULTS.md` for the measurements that shaped it.

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
- **Hebrew scripture (RTL).** `WLC` (Westminster Leningrad Codex, OT with niqqud and
  te'amim) and `DHNT` (Delitzsch Hebrew New Testament), with `he-IL` voices. The reading
  surface flips to `dir="rtl"` with a mirrored verse gutter; highlight mapping works
  unchanged on Hebrew, including vowel points. The interface stays in whichever of the four
  UI languages you chose — Hebrew is scripture, not a UI locale.
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

## Translations

Every entry is selectable in the panel and shows its license status there.

| Language | Public domain | Licensed (©) |
|---|---|---|
| Chinese | `CUV` 和合本 1919 | `CUNP` 新標點和合本 |
| Hebrew | `WLC` (OT), `DHNT` (NT) | — |
| English | `WEB` | — |
| Spanish | `RV1960` | `BTX3`, `RV2004`, `PDT`, `NTV`, `LBLA` |
| French | `FRLSG` Segond 1910, `FRDBY` Darby 1890 | `NBS`, `FRPDV17`, `BDS` |

`FRPDV17` carries 9 deuterocanonical books (75 total), grouped in their own section.

**`NVI` is deliberately excluded.** bolls.life serves a Biblica placeholder for it — all 36
verses of John 3 share the same opening line ("Biblica, Inc. me prohibió usar la traducción
NIV…"), so it is unusable there rather than merely licensed.

## Interface

The UI is reading-first: no permanent control bars compete with the text.

- A slim top bar shows the current reference; clicking it opens a navigator panel with
  translation, voice, book search, and a chapter grid. The cramped header of selects is gone.
- Scripture renders in the bundled serif on a paper surface, in a measured column.
- Light and dark themes follow the OS by default, with a manual toggle in the top bar and the
  panel. The theme is applied before first paint so there is no flash.
- Hovering a verse reveals a quiet play marker in the margin; the active verse is softly
  marked. Selection still raises the speak action bar.
- Scripture size is adjustable (16–34 px) from the panel or with Ctrl +/−, and persists
  between sessions. Leading scales with it.
- The transport is a floating dock with a progress line, speed, sleep timer, and cache state.

Regenerate the visual proof with `npm run shots` (writes light and dark screenshots plus
palette statistics to `spikes/out/`).

## Install

```bash
npm run dist     # builds release/BibleReader-Setup-0.1.0.exe (NSIS, x64)
```

The installer is per-user, lets you choose the directory, and creates desktop/Start-menu
shortcuts. It is **unsigned**, so Windows SmartScreen will warn on first launch
("More info" → "Run anyway"). Code signing is the one remaining shipping task.

Verified on the packaged build (not just from source): 66 books load, a verse click reads
from the on-disk cache with correct karaoke spans, selection-to-speak works, the UI switches
to English, the bundled font loads, Esc stops playback, Ctrl+Shift+S speaks.

## What is deliberately not built yet

- Code signing (SmartScreen warning until then).
- Provider rate limiting/backoff hardening (M4 leftover).
- Multi-hour soak testing of the Edge token path.

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

## If the window is blank

The app now tells you *why* instead of showing nothing:

| situation | what you see |
|---|---|
| `dist/` missing | "No build found" with the exact path and the command to run |
| dev server not reachable | "Cannot reach the dev server" with the URL it tried |
| preload failed | "Preload script did not load" |
| render-time exception | the stack trace and a Reload button |

**Most common cause: a stale dev server.** `npm run dev` uses a fixed port; if a Vite server
from a previous session is still listening on 5173, the script dies with
`Port 5173 is already in use` and `concurrently -k` kills Electron, so no window appears.
`npm run dev` now preflights the port and tells you what to do:

```bash
npm run dev:free     # kill whatever holds 5173
```

Or skip the dev server entirely with `npm start`, which builds and runs from `dist`.

Run the environment check first:

```bash
npm run doctor
```

It verifies build output, `main`/preload wiring, Node/Electron versions, the cache
directory, and reachability of bolls.life and the Edge voice list.

If every check passes but the window is still a flat colour, the DOM is fine and the
compositor is at fault — try:

```bash
npm run start:nogpu     # BIBLEREADER_DISABLE_GPU=1
```

Stale preferences from earlier builds can make the app open in an unexpected translation.
Reset them:

```bash
npm run reset           # BIBLEREADER_RESET_PREFS=1
```

Diagnostics are always on: `npx electron .` prints `[load]`, `[preload]`, and `[renderer]`
lines to the terminal.

## Run it

```bash
npm install
npm start            # build, then run from dist/  (safest: no dev server)
npm run dev          # Vite dev server + Electron (preflights port 5173)
npm run doctor       # environment/build/wiring/network checks
npm run reset        # clear persisted preferences
npm run dev:free     # kill a stale dev server holding 5173
npm run start:nogpu  # disable hardware acceleration (blank-window GPU fallback)
npm test             # offset-math unit tests (normalization, boundary mapping)
npm run font         # regenerate the subset CJK font (needs fonttools + brotli)
npm run icon         # regenerate build/icon.png
npm run dist         # build the NSIS installer
node scripts/publish-github.mjs repo        # create the private GitHub repo (token from git credential store)
node scripts/publish-github.mjs release <owner> <repo> <tag> <installer>   # publish a release
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
tests/                  offset-math unit tests (`npm test`)
spikes/                 M0 spike scripts (runnable with node)
electron/books.cjs     localized 66-book name tables (zh-Hant/en/es/fr) + canon sections
electron/cache.cjs     filesystem chapter/audio cache with LRU index + eviction
electron/doctor.cjs    `npm run doctor` environment checks
src/i18n.ts            UI strings for 繁體中文 / English / Español / Français
src/App.css            design tokens, light/dark palettes, reading surface
src/assets/fonts/      subset Noto Serif TC (1.78 MB) + Noto Serif Hebrew (65 KB), generated
scripts/build-font.mjs subsets the CJK font to the glyphs the CUV corpus uses
scripts/make-icon.cjs  renders build/icon.png
build/icon.png         installer/app icon
scripts/predev.mjs     dev-server port preflight
scripts/dev-free.mjs   frees port 5173
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

## License

MIT — see [LICENSE](LICENSE).

### Third-party notices

- **Bundled fonts:** Noto Serif TC (subset to the Chinese scripture glyphs) and Noto Serif
  Hebrew (subset to the Hebrew block), both under the SIL Open Font License 1.1.
- **Scripture text:** fetched from bolls.life. The shipped defaults are public-domain editions
  (CUV 1919, WEB, RV1960, FRLSG). Licensed translations (NIV, ESV, NVI, NBS, 思高) are opt-in
  selections and remain under their publishers' terms — the MIT license covers this app's code,
  not the scripture text.
- **Speech:** Edge Read Aloud voices are provided by Microsoft's service.
