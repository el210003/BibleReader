# BibleReader — Project Proposal

**A multilingual Bible reader with highlight-to-speak TTS**
Target: Windows desktop · Text: online-first with local cache · TTS: Edge neural voices (free)

Status: proposal / pre-implementation · Author: pi · Date: 2026

**M0 spikes are complete.** See `SPIKE-RESULTS.md`. Both external assumptions hold; three design assumptions were corrected as a result (most importantly: Chinese highlighting is phrase-level, not character-level, which makes the feature simpler than planned).

---

## 1. Summary

BibleReader is a Windows desktop application for reading scripture in Traditional Chinese, English, Spanish, and French, and hearing it spoken aloud. The core interaction is deliberately small: **the user selects text, and the app speaks that verse in the matching language voice.** Everything else (translation browsing, language switching, playback queue, audio caching) exists to make that interaction reliable and pleasant.

The design avoids paid APIs entirely in v1:

- **Scripture text** comes from open Bible APIs (bolls.life primary, getBible.net secondary) and is cached locally so re-reading is instant and offline-capable.
- **Speech** comes from Microsoft Edge's Read Aloud neural voices via `msedge-tts` — free, no API key, and it returns **word-boundary timings**, which enables real karaoke-style highlighting of the spoken verse.

Language scope is fixed at four: **Traditional Chinese (default), English, Spanish, French.** All four are LTR, which removes RTL and Indic-script complexity from v1 entirely.

This is a personal-scale tool that can be packaged for distribution. It is not a hosted service, so there is no server cost, no key management, and no abuse surface.

---

## 2. Goals and non-goals

### Goals (v1)

1. Browse the four launch languages — Traditional Chinese (**default**), English, Spanish, French — across their available translations, by book → chapter → verse.
2. Ship fully localized in all four: UI strings, book names, verse-reference formatting, and scripture typography. Traditional Chinese is the default UI and scripture language on first launch.
3. **Highlight any verse or passage → hear it spoken** in a voice that matches the text language.
4. Word- or character-level visual sync: the spoken text is highlighted as the audio plays (Latin locales use word spans, Chinese uses character spans).
5. Continuous chapter playback (verse 1 → 2 → 3 …), with pause/resume, speed, and voice selection.
6. Local caching of both scripture text and generated audio, so the second read is instant and works offline.
7. Clean, quiet reading UI that stays out of the way — typography-first, not dashboard-first.

### Non-goals (v1)

- Accounts, sync, or cloud storage.
- Languages beyond the four launch languages (the provider adapter and `dir` field keep the door open).
- A written-Cantonese *edition* (the provider carries none). Cantonese *audio* is supported: `zh-HK` voices read the same 和合本 text.
- Study tools: commentaries, cross-references, original-language lexicons (providers support them; we defer).
- Mobile / web deployment (the architecture keeps the door open, but v1 ships Windows only).
- Audio export/podcast generation.
- Multi-voice dramatized readings (single narrator voice per passage in v1).

---

## 3. Product design

### 3.1 Primary flow

```
Launch → default state: 繁體中文 UI, `CUV` 和合本, `zh-TW` voice
       → pick translation & language (or accept defaults)
       → pick book/chapter
       → read text
       → select verse(s) with mouse (or keyboard) → [Speak] action appears
       → audio plays, text highlights in sync
       → cache is written for instant replay
```

### 3.2 Selection → speech interaction

Two mechanisms, both required:

- **Selection-based**: a text selection inside a verse (or spanning verses) surfaces a small floating action bar: `▶ Speak` · `🔁 Repeat` · `⚙ Voice`. This is the feature the user asked for.
- **Verse-level**: each verse has a gutter "play" affordance on hover; the whole verse is read without needing to select text. This is the practical path for hands-off reading, and it is what most users will actually use.

Keyboard-first parity is required for accessibility: `Ctrl+Shift+S` speaks the focused verse, `Space` pauses/resumes while audio is active, `Esc` stops.

### 3.3 Playback surface

A persistent bottom transport (visible only when audio exists): play/pause, stop, −/+ 0.25× speed (0.5×–2.0×), voice picker, "read whole chapter from here", sleep timer, and a cache indicator.

### 3.4 Language model — the important design decision

Three language concepts must stay **separate and explicit**, or the app will speak gibberish:

| Concept | Source | Example |
|---|---|---|
| UI language | app setting (i18n) | 繁體中文 UI, English scripture |
| Scripture language | translation record | `CUV` → Traditional Chinese |
| TTS voice locale | Edge voice catalogue filtered by locale | `zh-TW-HsiaoChenNeural` |

The app resolves scripture language → candidate voice locales → available voices. If no neural voice exists for a language, the UI says so plainly and offers a browser `speechSynthesis` fallback (OS voices). **Never silently substitute a wrong-language voice.**

### 3.5 Launch language matrix (verified against live provider data)

| Language | Default translation | Other translations available | Recommended voices |
|---|---|---|---|
| **Traditional Chinese 繁體中文 (default)** | `CUV` Chinese Union (Traditional) 和合本, 1919 — public domain | `CUNP` 新標點和合本串珠 (1988), `PCB` 京委本聖經 (1899), `ChiSB` 思高聖經, `CUNPS`/`PCBS` (simplified editions) | Mandarin: `zh-TW-HsiaoChenNeural` (F, default), `zh-TW-YunJheNeural` (M), `zh-TW-HsiaoYuNeural` (F). Cantonese: `zh-HK-HiuGaaiNeural` (F), `zh-HK-HiuMaanNeural` (F), `zh-HK-WanLungNeural` (M) |
| **English** | `WEB` World English Bible — public domain | `KJV`, `ASV`, `YLT` (PD); `NIV`, `ESV`, `NKJV`, `NASB`, `NLT`, `CSB17` (licensed) | `en-US-AvaNeural` (F), `en-US-AndrewNeural` (M), `en-GB-SoniaNeural` |
| **Spanish Español** | `RV1960` Reina-Valera 1960 — public domain | `BTX3`, `RV2004`, `PDT`, `NVI`, `NTV`, `LBLA` | `es-ES-ElviraNeural` (F), `es-ES-AlvaroNeural` (M), `es-MX-DaliaNeural`, `es-MX-JorgeNeural` |
| **French Français** | `FRLSG` Segond 1910 — public domain | `FRDBY` Darby 1890 (PD), `NBS`, `FRPDV17`, `BDS` | `fr-FR-DeniseNeural` (F), `fr-FR-HenriNeural` (M), `fr-FR-EloiseNeural`, `fr-CA-SylvieNeural` |

Public-domain defaults are chosen deliberately: the app ships legally clean out of the box. Licensed translations (NIV, ESV, NVI, NBS, 思高) are opt-in selections with the license surfaced in the UI.

**No 繁→简 character conversion.** Simplified editions exist as *separate translations* (`CUNPS`, `PCBS`). The Traditional/Simplified switch is a translation-family switch, not a text transform — automated conversion mangles 「著/着」, 「裡/里」 and proper nouns. Offer the pair explicitly and label it as such.

**Chinese-specific work items** — these are real deliverables, not footnotes:

1. **Chinese highlighting is phrase-level, and that is good news.** The proposal originally assumed we would need per-character advance measurement and a separate Chinese "character path". The M0 spike disproved that: Edge emits phrase boundaries for Chinese (`神愛 | 世人 | 甚至 | 將 | 他的 | 獨生子 | …`), and 100% of those boundaries map cleanly onto normalized verse offsets in order. **One highlight path serves all four languages** — sequential mapping of boundary text onto normalized character offsets. The only locale-specific work left is font metrics for overlay line wrapping.
2. **Localized book names and references.** The provider returns English book names. We need our own 66-book name table for 繁體中文 (創世記 … 啟示錄), Español, and Français, plus per-locale reference formatting (`約翰福音 3:16`, `Juan 3:16`, `Jean 3:16`).
3. **Typography.** Traditional Chinese needs a bundled serif CJK stack (Source Han Serif TC / Noto Serif TC subset, ~2–4 MB) with correct punctuation and line breaking (`、。「」`) and larger default leading. Latin defaults will look cramped in Chinese.
4. **Cantonese is supported as a voice variant, not a translation.** `zh-HK` voices exist and are wired in, and are the **first-run default for Hong Kong / Macau readers**. There is no written-Cantonese edition in the provider, so the text stays 和合本 and the Cantonese voices pronounce those characters in Cantonese — which is exactly how Hong Kong churches read scripture aloud. Verified in spike 09: all three `zh-HK` voices synthesize CUV John 3:16 with 20/20 word boundaries mapped and zero unmapped. Expect slower speech (10.6 s vs 8.1 s for the same verse) and a finer boundary granularity (`他 | 的` rather than `他的`). The pipeline is unchanged.

   Region detection must **not** use `app.getLocale()`: Chromium normalises `zh-HK` to `zh-TW` at the UI-locale level (verified — `--lang=zh-HK` yields `getLocale() === 'zh-TW'`). The reliable signal is `app.getPreferredSystemLanguages()`, which preserves the full tag (`zh-Hant-HK`).
5. **`CUV` arrives character-separated — verified, not hypothetical.** A live fetch of `CUV` John 3 returns text like `「 神 愛 世 人 ， 甚 至 將 他 的 獨 生 子 …` — a space between every glyph. That is the 1919 edition served in word-aligned form. Feeding it to TTS verbatim produces unnatural pauses, and rendering it verbatim produces visibly broken Chinese. The pipeline must normalize it (collapse inter-character spaces, keep punctuation attached) before both display and synthesis, and the highlight offsets must be computed **after** normalization. `CUNP`, `CUNPS`, `PCB`, and `ChiSB` are normally spaced, so this is a `CUV`-specific adapter quirk, not a general CJK rule.
6. **Inline markup differs by edition.** `CUNP`/`CUNPS` carry `<i>` around supplied words (`…賜給<i>他們</i>…`), which is conventional and should be preserved as italics; `CUV` and `PCB` carry no inline tags. The sanitizer whitelist must keep `i`/`em` and style them, or the reader silently loses the translator's supplied-word distinction.

---

## 4. Technical approach

### 4.1 Stack recommendation

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron 3x (Windows)** | `msedge-tts` is a Node library and needs a Node runtime + WebSocket egress. Electron gives us that with zero plumbing. Fastest, most reliable path. |
| UI | React + TypeScript + Vite | Standard, well-supported, fast iteration. |
| State | Zustand + persisted settings | Small, no boilerplate. |
| Storage | SQLite (`better-sqlite3`) for text; filesystem for audio | Text cache is relational (translation/book/chapter/verse); audio is blobs on disk. |
| Text provider | bolls.life (primary), getBible.net v2 (secondary/fallback) | No keys; carries all four target languages (CUV/CUNP, WEB/KJV/ASV, RV1960/BTX3, FRLSG/FRDBY) plus bulk download. |
| TTS | `msedge-tts` (Edge Read Aloud) with `MetadataOptions: WordBoundary` | Free, no key, huge locale coverage, returns word timings. |
| Packaging | electron-builder → NSIS installer | Standard Windows distribution. |

**Electron vs Tauri:** Tauri would give a ~10 MB installer instead of ~150 MB, but it forces the Edge TTS work into Rust (`msedge-tts` crate / custom WS client) or a bundled Node/Python sidecar. That is a real cost for a v1 whose risky part is TTS, not bundle size. Recommendation: **Electron now, revisit Tauri only if distribution size becomes a complaint.** The TTS client is a small, isolated module (`tts/edge.ts`), so swapping shells later is a contained change.

### 4.2 Architecture

```
┌──────────────────────────── Renderer (React, sandboxed, no Node) ────────────────────────────┐
│  Reader UI  ·  Selection layer  ·  Karaoke highlight overlay  ·  Transport  ·  Settings      │
│         │  IPC (contextBridge, typed channels, allowlisted)          │                       │
└─────────┼───────────────────────────────────────────────────────────┼───────────────────────┘
          ▼                                                           ▼
┌────────────────────────── Main process (Node) ───────────────────────────────────────────────┐
│  ScriptureService        TTSService              PlaybackService        CacheService         │
│  ├ provider adapters     ├ voice catalogue       ├ queue/state machine  ├ SQLite (text)      │
│  │  bolls / getbible     ├ synthesis + chunking  ├ seek/pause           ├ audio blobs        │
│  ├ HTML→plain sanitize   ├ word-boundary map     └ timers               └ LRU eviction       │
│  ├ rate limit + backoff  ├ audio cache lookup                                                │
│  └ cache-first reads     └ Web Speech fallback (renderer)                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
          │                                    │
          ▼                                    ▼
   https://bolls.life / api.getbible.net   wss://speech.platform.bing.com (Edge Read Aloud)
```

Security posture: renderer runs with `contextIsolation: true`, `nodeIntegration: false`, a strict CSP, and a small typed preload API. All network and filesystem access happens in main.

### 4.3 Scripture text layer

**Provider adapter interface** (so providers are swappable and testable):

```ts
interface ScriptureProvider {
  id: 'bolls' | 'getbible';
  listTranslations(): Promise<Translation[]>;      // short_name, full_name, language, dir
  listBooks(translation: string): Promise<Book[]>; // bookid, name, chapters
  getChapter(translation: string, book: number, chapter: number): Promise<Verse[]>;
  getVerse(translation: string, book: number, chapter: number, verse: number): Promise<Verse>;
}
```

**Concrete endpoints verified against provider docs:**

- Translations index: `https://bolls.life/static/bolls/app/views/languages.json` (carries an optional `dir` field; none of the four launch languages is RTL, but the field is honored so later languages are a data change) and `https://bolls.life/static/bolls/app/views/translations_books.json`
- Books: `https://bolls.life/get-books/<TRANSLATION>/`
- Chapter: `https://bolls.life/get-text/<TRANSLATION>/<book>/<chapter>/` → `[{pk, verse, text (HTML), comment?}]`
- Single verse: `https://bolls.life/get-verse/<TRANSLATION>/<book>/<chapter>/<verse>/`
- Bulk (offline seed, *not* per-read): `https://bolls.life/static/translations/<TRANSLATION>.json` or `.zip`
- Secondary: `https://api.getbible.net/v2/<translation>/<book>/<chapter>.json`

**Provider etiquette (explicit, because the maintainer asks for it):** never scrape the whole Bible through `get-text`. Fetch chapter-by-chapter as the user reads, cache aggressively, and use the bulk `.json`/`.zip` download only when the user opts into "make this translation available offline". Throttle to ≤ 1 request/sec with exponential backoff on 429/5xx, and set a descriptive User-Agent.

**Sanitization:** verse `text` is HTML. Parse → whitelist (`b`, `i`, `em`, `strong`, `br`, `span`) → strip the rest → **normalize** (collapse inter-character spacing for `CUV`, normalize whitespace, attach punctuation) → keep a plain-text projection for TTS. The normalized string is the single source of truth for both rendering and highlight offsets; the raw provider string is kept only for debugging. Never inject raw provider HTML into the DOM.

**Cache schema** (SQLite, per-user app data dir):

```sql
translations(short_name PK, full_name, language, dir, fetched_at)
books(translation, bookid, name, chapters, PK(translation, bookid))
chapters(translation, bookid, chapter, json, source, fetched_at, PK(translation,bookid,chapter))
verses(translation, bookid, chapter, verse, plain_text, html, PK(translation,bookid,chapter,verse))
audio_cache(key PK, translation, bookid, chapter, verse, voice, rate, pitch, path, bytes, duration_ms, created_at, last_played_at)
settings(key PK, value)
```

Cache policy: chapter TTL 30 days with a manual "refresh"; audio LRU capped at a user-configurable size (default 500 MB) with eviction on app start and after playback.

### 4.4 TTS layer — the hard part

**Voice catalogue.** `msedge-tts` exposes `getVoices()` (Name, ShortName, Gender, Locale). Build a locale→voice map at startup and cache it for 24h. Restrict the picker to our four languages — `zh-TW` (3 voices), `en-US`/`en-GB`, `es-ES`/`es-MX`, `fr-FR`/`fr-CA` — out of the 322 voices the service returns; filtering the rest out keeps the picker usable. Each translation record carries a default voice (`CUV` → `zh-TW-HsiaoChenNeural`), and the user's voice choice persists per translation so a given language sounds consistent across sessions.

**Synthesis pipeline.** (Validated in M0: per-verse synthesis completes in 260–511 ms; long-input requests are wildly variable at 4–48 s, so chapter-level synthesis is ruled out.)

```
verse text → normalized plain text (post-normalization offsets are the only valid ones)
          → msedge-tts synth, wordBoundaryEnabled + sentenceBoundaryEnabled
          → keep only type=='WordBoundary' events (SentenceBoundary duplicates the whole
            sentence and would corrupt a naive mapper)
          → map each boundary Text onto normalized verse offsets sequentially (indexOf
            from a moving cursor); verified 100% hit rate, monotonic, zero mismatches
          → bridge punctuation gaps so the overlay does not flicker off at ，。
          → write audio blob + highlight plan to cache
          → hand playback a manifest: [{tMs, durMs, charStart, charEnd}]
```

Chunking remains available for unusually long verses, but is not needed for normal ones: MP3 stitching was verified exact (0 ms delta, 0 skipped bytes across a 10-verse concatenation). Client timeouts must scale with input length — a fixed 60 s timeout is what caused the only spike failure.

**Karaoke highlighting.** Boundary `Offset`/`Duration` arrive in 100-nanosecond ticks (divide by 10,000 for ms). The mapping is sequential and order-preserving, so a verse plan is a simple ordered span list; no per-character advance measurement is required. Verified coverage is ~83% of characters (punctuation and quotation marks are excluded by the engine, correctly) and ~88% of audio duration — the remainder is trailing silence of 500–950 ms per verse. For multi-verse passages, spans are grouped per verse and rebased by cumulative audio duration (verified exact at 8,064 + 9,456 = 17,520 ms).

**Fallback ladder** (must be implemented, not aspirational):

1. Edge neural voice (default).
2. Browser `speechSynthesis` with an OS voice matching the locale (offline, lower quality) — used automatically when the Edge WebSocket fails, the machine is offline, or the language has no Edge voice.
3. Plain text display with a clear "voice unavailable" notice — never a silent no-op.

**Optional premium tier (v2, off by default):** Azure Speech (`SSML`, word-boundary events, 400+ voices, ~$16 per 1M characters) or ElevenLabs (best prosody, character timestamps, expensive). Wired behind the same `TTSService` interface with a user-supplied key stored via Electron `safeStorage`.

**Known risks in this layer** — documented in §8, not hidden.

### 4.5 Playback engine

State machine: `idle → synthesizing → playing → paused → (ended | error)`. Owned entirely by main; the renderer is a view. Requirements: gapless verse-to-verse advance, resume-after-error, hard stop on chapter change, and a synthesis look-ahead (prefetch verse N+1 while N plays) so continuous reading doesn't stutter.

Audio delivery to the renderer: serve from a custom `app://` protocol handler bound to the cache directory (not `file://`), so the audio element can seek and the CSP stays tight.

---

## 5. Milestones

Estimates assume one developer, part-time, with the provider and TTS spikes done first.

| # | Milestone | Deliverable | Est. |
|---|---|---|---|
| M0 | Spike & scaffold | **DONE** — see `SPIKE-RESULTS.md`. Repo scaffolded (Vite+React+TS+Electron), three spikes executed, one design assumption corrected | complete |
| M1 | Reader core + i18n | Four-locale UI strings, localized 66-book name tables, translation/language picker, book/chapter navigation, sanitized rendering, CJK typography (bundled serif TC font), SQLite text cache | 2 wk |
| M2 | TTS core | Voice catalogue, verse synthesis, audio cache, playback transport, speed control | 1.5 wk |
| M3 | Highlight-to-speak | Selection action bar, verse gutter play, karaoke highlight overlay, auto-scroll, continuous chapter mode | 1.5 wk |
| M4 | Resilience | Fallback ladder, offline mode, provider rate limiting/backoff, cache eviction, error surfaces | 1 wk |
| M5 | Polish & ship | Settings, fonts/themes, keyboard shortcuts, accessibility pass, electron-builder NSIS installer, README | 1 wk |

**Total: ~4–5 weeks** for the four-language scope, with M0 complete. The two external dependencies (provider text shape, Edge word boundaries) are now validated against live services rather than assumed.

---

## 6. Cost

| Item | Cost |
|---|---|
| Scripture text APIs | $0 (no key, no quota) |
| Edge TTS | $0 (unofficial, no key) |
| Hosting / backend | $0 — everything is local |
| Code signing certificate (optional) | ~$100–400/yr if distributing publicly |
| Optional Azure premium voices (v2) | ~$16 per 1M characters |

---

## 7. Acceptance criteria (v1 done)

1. Select Genesis 1:1 in a Spanish translation → hear it in a Spanish neural voice within 2 s of clicking Speak, with words highlighting in sync.
2. Open 約翰福音 3:16 (CUV, the default on first launch) → Traditional Chinese renders in the bundled serif CJK font with no tofu boxes **and no inter-character gaps** (the raw `CUV` spacing is normalized away), and Speak produces `zh-TW` audio with character-level highlight sync. This is the primary acceptance path.
3. Kill the network, restart the app, re-open a previously read chapter → text renders from cache; re-speaking a cached verse is instant.
4. Play a full chapter continuously; no gaps > 300 ms between verses; pause/resume and 1.5× speed work.
5. Disconnect the network mid-session → next Speak falls back to an OS voice with a visible notice, not a hang.
6. Audio cache respects its size cap; eviction never removes the currently playing file.
7. Installer produces a working app on a clean Windows VM with no Node installed.

---

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Edge Read Aloud is unofficial; it has previously added anti-abuse tokens (`Sec-MS-GEC`) and changed formats | TTS stops working after a silent upstream change | Pin the library, keep the TTS client behind an interface, ship the Web Speech fallback, and monitor for 403s in logs |
| Edge TTS throttling / 403 on bursts | Failed synthesis during fast browsing | Per-verse audio cache, ≤ 1 in-flight synthesis, exponential backoff, prefetch only one verse ahead |
| Long passages exceed per-request limits | Truncated or failed audio | Sentence-aligned chunking with stitching (designed in, §4.4) |
| Licensed translations (NIV/ESV/NASB, NVI/LBLA, NBS/BDS, 思高) served by bolls | Legal friction if redistributed | Fine for personal use; for public distribution default to the public-domain editions (`CUV`, `WEB`, `RV1960`, `FRLSG`) and surface the license per translation |
| Provider downtime or schema change | Blank reader | Second provider adapter, cached chapters survive outages, visible error state |
| Word-boundary rebasing bugs across chunks | Highlight drifts out of sync | Unit-test the offset math with fixed fixtures; clamp highlight to the active verse |
| CJK highlight misalignment | Karaoke sync drifts or highlights the wrong glyph | **De-risked in M0**: 100% boundary→offset mapping, monotonic, zero mismatches on CUV and WEB; bridge punctuation gaps, clamp to verse span |
| Missing CJK font on user machine | Tofu boxes / wrong glyph forms | Bundle a Source Han Serif TC subset in the installer rather than trusting system fonts |
| Chinese verse text has no spaces | Naive sentence chunking splits mid-phrase, producing unnatural prosody | Chunk on CJK punctuation (`。！？；`) and paragraph breaks, with a hard character cap |
| `CUV` serves character-separated text | Broken rendering and unnatural TTS pauses if used verbatim | **Verified fix in M0**: normalization collapses 35 spaces (71→36 chars), offset map integrity confirmed, highlight offsets computed post-normalization |
| Trailing silence per verse (500–950 ms, measured) | Unwanted gaps if verses are concatenated for continuous reading | Explicit configurable trim, not an accident; decide the inter-verse pause as a product choice |
| Long-input synthesis latency variance (4–48 s measured) | Chapter-level requests would blow the 2 s target | Per-verse synthesis only (260–511 ms measured); prefetch one verse ahead; scale timeouts to input length |
| Audio cache bloat | Disk fills | LRU cap with user-visible size, eviction on start |
| Electron bundle size (~150 MB) | Distribution annoyance | Accepted for v1; `tts/` module is shell-agnostic so a Tauri port stays contained |

---

## 9. Open questions

1. **Reading aids scope** — do you want bookmarks/highlights/notes in v1, or keep v1 strictly read + speak? (Recommendation: read + speak only; notes are a second product.)
2. **Chinese editions** — `CUV` (和合本 1919) is the default and is unambiguously public domain, but its text arrives character-separated and has no inline markup. `CUNP` (新標點和合本 1988) is better formatted but its 1988 punctuation/cross-reference revision may carry a copyright claim on that editorial layer. Which do you want as the shipped default, and how strict do you need to be about licensing?
3. **Spanish voice variant** — default to Spain (`es-ES-ElviraNeural`) or Latin America (`es-MX-DaliaNeural`)? The text (`RV1960`) reads the same either way; the accent differs.
4. **Distribution** — personal use only, or a public installer? This decides whether we need code signing and a licensing review of the licensed translations.
5. **Offline depth** — is "cache what you've read" enough, or do you want an explicit "download this translation for offline" action (bulk `.json`/`.zip`, ~10–40 MB)?
6. **Voice style** — calm narration only, or also multi-voice (narrator vs. quotation) later?

**Resolved since first draft:** Cantonese is supported as a voice variant (not a translation), and `zh-HK` / `zh-MO` locales default to it on first run. See `SPIKE-RESULTS.md` §09.

---

## 10. Appendix — verified provider reference

**bolls.life** (no key)

```
GET https://bolls.life/static/bolls/app/views/languages.json
GET https://bolls.life/static/bolls/app/views/translations_books.json
GET https://bolls.life/get-books/<TRANSLATION>/
GET https://bolls.life/get-text/<TRANSLATION>/<book>/<chapter>/     → [{pk,verse,text,comment?}]
GET https://bolls.life/get-verse/<TRANSLATION>/<book>/<chapter>/<verse>/
GET https://bolls.life/static/translations/<TRANSLATION>.json|.zip  (bulk, opt-in only)
```

**getBible.net v2** (no key, static files)

```
GET https://api.getbible.net/v2/<translation>.json          (translation index)
GET https://api.getbible.net/v2/<translation>/<book>/<chapter>.json
```

**Edge Read Aloud** via `msedge-tts`: WebSocket to `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`, synthesis with `MetadataOptions: { metadataType: 'WordBoundary' }` returning word offsets in milliseconds. Output is MP3 (e.g. `audio-24khz-48kbitrate-mono-mp3`).

Voice enumeration is a plain HTTPS GET (322 voices total, verified):

```
GET https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4
```

Relevant locales for this project: `zh-TW` (3), `zh-HK` (3), `en-US` (17), `en-GB`, `es-ES`, `es-MX`, `es-US`, `fr-FR` (5), `fr-CA` (4).

---

## 11. Recommendation

Proceed with M1 (reader core + i18n). Default configuration: UI in 繁體中文, scripture `CUV` (和合本), voice `zh-TW-HsiaoChenNeural`, with English/Spanish/French available from the same picker.

M0 is complete and the two external dependencies are validated against live services (`SPIKE-RESULTS.md`). The one assumption that was wrong made the plan cheaper: Chinese highlighting is phrase-level, so a single highlight path serves all four languages.

Before M2, close the remaining unknowns: sustained multi-hour stability of the `Sec-MS-GEC` token path, and `es-MX`/`fr-CA` audio quality. Concurrency and the offline fallback were measured after this proposal was first drafted and are now closed (`SPIKE-RESULTS.md` §07–08): 8 parallel requests complete with no throttling, and OS voices exist for all four locales with working `onboundary` events, so the fallback keeps karaoke alive.
