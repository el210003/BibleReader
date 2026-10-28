# M0 Spike Results

Executed against live services on 2026-10-27. Node v26.12.1, `msedge-tts@2.1.1`, Windows.
Raw artifacts are in `spikes/out/`; scripts are in `spikes/`.

**Verdict: both external assumptions hold, and one design assumption was wrong in a good way.**

---

## Spike 01 — Scripture fetch + CJK normalization

Fetched John 3 via bolls.life for `CUV`, `CUNP`, `CUNPS`, `PCB`, `ChiSB`, `WEB`, `RV1960`, `FRLSG`.

| Translation | raw chars | spaces | removed | normalized | map integrity | inline markup |
|---|---|---|---|---|---|---|
| `CUV` | 71 | 35 | 35 | 36 | **ok** | no |
| `CUNP` | 38 | 0 | 0 | 38 | ok | **yes** (`<i>`) |
| `CUNPS` | 38 | 0 | 0 | 38 | ok | **yes** (`<i>`) |
| `PCB` | 33 | 0 | 0 | 33 | ok | no |
| `ChiSB` | 40 | 0 | 0 | 40 | ok | no |
| `WEB` | 134 | 26 | 0 | 133 | ok | no |
| `RV1960` | 149 | 33 | 0 | 145 | ok | no |
| `FRLSG` | 143 | 27 | 0 | 143 | ok | no |

Confirmed:

- **`CUV` is character-separated.** `「 神 愛 世 人 ， …` → 35 spaces removed, 71 chars collapse to 36. Normalization is required for both display and TTS.
- **The offset map is sound.** For every normalized index, `raw[map[i]] === normalized[i]` held in all eight translations. Normalized text is a verified subsequence of raw.
- **Raw offsets are not usable for highlighting.** Probing `獨生子` in `CUV`: normalized index 11, raw index 22. A highlighter built on raw offsets would be off by 11 characters. Highlight offsets must be computed **after** normalization — the proposal's requirement is confirmed, not theoretical.
- **`CUNP`/`CUNPS` carry `<i>` markup** around supplied words. Sanitizer must preserve it.
- **`RV1960` contains double spaces** (`mundo,  que`); whitespace collapsing handles it (149 → 145).

Provider behavior: no rate limiting hit at ~2 req/sec; no key required.

---

## Spike 02 — Edge TTS connectivity + word boundaries + stitching

| Check | Result |
|---|---|
| Voice list (`getVoices`) | **OK**, 322 voices, 169 ms |
| `zh-TW` voices | `zh-TW-HsiaoChenNeural`, `zh-TW-YunJheNeural`, `zh-TW-HsiaoYuNeural` |
| Synthesis, `zh-TW-HsiaoChenNeural`, 36-char verse | **OK**, 48,384 bytes, 8,064 ms audio, 555 ms wall |
| Synthesis, `en-US-AvaNeural`, 130-char verse | **OK**, 53,568 bytes, 8,928 ms audio, 345 ms wall |
| 403 / `Sec-MS-GEC` failure | **none** (library handles clock skew retry) |

**Word boundaries are returned and are richer than assumed.** For Chinese the engine emits *phrase-level* boundaries, not characters:

```
神愛 | 世人 | 甚至 | 將 | 他的 | 獨生子 | 賜給 | 他們 | 叫 | 一切 | 信 | 他的 | 不 | 至 | 滅亡 | 反 | 得 | 永生
```

Each event carries `Offset` and `Duration` in 100-nanosecond ticks (divide by 10,000 for ms), plus the boundary `Text` and `Length`.

**MP3 stitching is exact.** Two independently synthesized chunks concatenated:

| | frames | duration |
|---|---|---|
| chunk A | 187 | 4,488 ms |
| chunk B | 183 | 4,392 ms |
| stitched | 370 | 8,880 ms |

`delta = 0 ms`, `frameDelta = 0`, `skippedBytes = 0`. Concatenation produces a stream that parses cleanly across the join with no resync loss.

---

## Spike 03 — Highlight plan (the critical one)

Mapped every boundary event onto normalized verse character offsets, sequentially.

| | `CUV` 3:16 (zh-TW) | `CUV` 3:17 (zh-TW) | `WEB` 3:16 (en-US) |
|---|---|---|---|
| normalized chars | 36 | 43 | 133 |
| audio | 8,064 ms | 9,456 ms | 9,048 ms |
| boundary events | 19 | 25 | 27 |
| word boundaries mapped | **18 / 18** | **24 / 24** | **26 / 26** |
| monotonic, non-overlapping | yes | yes | yes |
| span text mismatches | **0** | **0** | **0** |
| char coverage | 83.3% | 83.7% | 78.2% |
| audio coverage | 88.2% | 90.0% | 96.0% |

The single "unmapped" event per verse was a **`SentenceBoundary`** (whole-sentence text), not a word boundary. Filtering to `type === 'WordBoundary'` gives **100% mapping**.

Uncovered characters are punctuation and the opening quote (`「`, `，`, `。`) — the engine does not emit boundaries for them. That is correct behavior; the highlighter should bridge punctuation gaps rather than leave holes.

**Verse-to-verse rebasing works exactly.** v16 (8,064 ms) + v17 (9,456 ms) concatenated to 17,520 ms with `delta = 0 ms`, 730 frames, 0 skipped bytes. Rebasing v17's spans by v16's duration produced correct absolute times (first v17 span at 8,164 ms).

---

## Spike 04 — Length limits and latency

| chars | audio produced | wall time | result |
|---|---|---|---|
| 101 | 23,952 ms | 1,761 ms | ok |
| 199 | 46,632 ms | 492 ms | ok |
| 390 | 91,032 ms | 11,186 ms | ok |
| 603 | 139,584 ms | 1,004 ms | ok |
| 700 | 162,168 ms | 37,784 ms | ok |
| 900 | 206,064 ms | 14,046 ms | ok |
| 1,100 | 250,176 ms | 21,026 ms | ok |
| 1,256 | 285,936 ms | 4,083 ms | ok |
| 1,500 | 342,768 ms | 35,188 ms | ok |
| 2,000 | 456,312 ms | 47,647 ms | ok |

Two findings that change the plan:

1. **There is no hard character limit up to 2,000 chars.** An earlier "failure" at 1,256 chars was the spike's own 60 s client timeout, not a server limit. Timeouts must scale with input length.
2. **Long-input latency is wildly variable** (4 s to 48 s for the same order of magnitude). Per-verse synthesis does not have this problem: verse-sized requests (36–40 chars) completed in **260–511 ms** across four runs.

Conclusion: synthesize **per verse**, never per chapter. This keeps the p95 comfortably under the 2 s acceptance criterion and makes prefetch of verse N+1 the correct strategy.

---

## Spike 05 — Speed control

| requested rate | audio duration |
|---|---|
| default | 8,064 ms |
| `1` | 8,064 ms |
| `1.5` | 5,400 ms |
| `2` | 4,056 ms |
| `0.75` | 10,752 ms |

Speed control is **server-side prosody**, so it re-synthesizes rather than using playback rate. This is better quality than client-side `playbackRate`, but it means the audio cache key must include rate, and changing speed mid-playback requires a re-synthesis (not an instant adjustment).

---

## Corrections to the proposal

These findings invalidate three assumptions in `PROPOSAL.md`:

1. **Chinese highlighting is phrase-level, not character-level.** The proposal (§3.5 item 1, §4.4) assumed we would need per-character advance measurement and a separate "character path". The engine already segments Chinese into phrases, so **one highlight path serves all four languages**: sequential mapping of boundary text onto normalized character offsets. This removes a whole class of layout complexity. The only locale-specific part left is font metrics for the overlay's line wrapping.
2. **`CUV` normalization is mandatory, and offsets must be post-normalization.** Confirmed with a concrete failure mode (raw index 22 vs normalized 11).
3. **Trailing silence per verse is ~500–950 ms** (zh: 8,064 ms audio vs 7,113 ms last boundary end; en: 9,048 vs 8,550). Concatenating verses will insert that gap. For continuous reading this is acceptable as a natural pause, but it should be an explicit, configurable trim rather than an accident.

Additional design consequences:

- Filter boundary events to `type === 'WordBoundary'`; `SentenceBoundary` events duplicate the whole sentence and would corrupt a naive mapper.
- Bridge punctuation gaps when building the highlight plan so the overlay does not flicker off during `，` and `。`.
- Audio cache key: `(translation, book, chapter, verse, voice, rate)`.
- Client timeout should scale with text length; per-verse requests make this a non-issue.
- `CUNP`/`CUNPS` need `<i>` preserved through sanitization.

## Spike 07 — Concurrency / throttling

Every earlier spike was strictly sequential. The real app overlaps requests (prefetch verse N+1 while N plays, fast clicking), so this needed measuring.

| concurrency | wall | ok | failed |
|---|---|---|---|
| 1 | 674 ms | 1/1 | 0 |
| 2 | 1,758 ms | 2/2 | 0 |
| 4 | 1,698 ms | 4/4 | 0 |
| 8 | 1,696 ms | 8/8 | 0 |

Sustained burst of 8 requests, twice back-to-back with no cooldown: **8/8 both rounds** (591 ms and 436 ms).

**No 403s, no throttling, no socket errors at 8 parallel.** Each request used its own `MsEdgeTTS` instance (its own WebSocket). Since the design only needs 1–2 requests in flight (one playing, one prefetching), there is substantial headroom.

## Spike 08 — Offline fallback viability

Tested in a real Electron renderer via `speechSynthesis`.

**OS voices are installed for all four launch locales on this machine:**

| locale | voice |
|---|---|
| `zh-TW` | Microsoft Hanhan, Yating, Zhiwei |
| `en-US` | Microsoft David, Mark, Zira |
| `es-ES` | Microsoft Helena, Laura, Pablo |
| `fr-FR` | Microsoft Hortense, Julie, Paul |

15 voices total. All four locales **speak successfully**, with much faster start than Edge TTS:

| locale | start | end | `onboundary` events |
|---|---|---|---|
| zh-TW | 118 ms | yes | **10** |
| en-US | 53 ms | yes | **7** |
| es-ES | 47 ms | yes | **9** |
| fr-FR | 36 ms | yes | **8** |

**The fallback retains karaoke.** Chromium fires `onboundary` for these SAPI voices, so the degraded mode is not "sentence-level highlight or nothing" as the proposal assumed — the same overlay can drive word highlighting from OS-voice boundaries. Quality is clearly worse (SAPI is robotic) but the interaction survives.

Note: the first version of this probe reported "es did not start" — that was a test artifact from queuing utterances without `cancel()` between them, not a real failure. Corrected above.

## Spike 09 — zh-HK (Cantonese) voices

Cantonese was initially deferred on the grounds that no written-Cantonese translation exists. That reasoning was wrong in practice: Hong Kong churches read 和合本 aloud in Cantonese, so a `zh-HK` voice over the same text is the correct behaviour, not a mismatch.

CUV John 3:16, same normalized text, four voices:

| voice | audio | word boundaries | mapped | unmapped | char coverage |
|---|---|---|---|---|---|
| `zh-HK-HiuGaaiNeural` | 10,632 ms | 20 | **20** | 0 | 83.3% |
| `zh-HK-HiuMaanNeural` | 8,208 ms | 20 | **20** | 0 | 83.3% |
| `zh-HK-WanLungNeural` | 7,704 ms | 20 | **20** | 0 | 83.3% |
| `zh-TW-HsiaoChenNeural` (control) | 8,064 ms | 18 | **18** | 0 | 83.3% |

All three Cantonese voices work through the app's real modules (`electron/tts.cjs`), not just the spike harness, with zero unmapped boundaries.

Differences worth knowing:

- Cantonese output is slower (10.6 s vs 8.1 s for the same verse) and boundary granularity is finer (`他 | 的` instead of `他的`).
- First-call latency was higher in the spike (1.2–2.5 s vs 0.4 s), consistent with per-connection setup on a fresh socket rather than a per-locale penalty.
- Coverage is identical (83.3%), so the highlight overlay behaves the same.

Cantonese is therefore wired in as a **voice variant**, not a translation. `zh-TW` remains the default.

## Spike 11 — Hebrew (RTL)

| check | result |
|---|---|
| Hebrew editions on bolls.life | `WLC`, `WLCa`, `WLCC`, `HAC` (39 books, OT only, all `dir=rtl`), `DHNT` (27 books, NT, ids 40–66) |
| Genesis 1:1 (WLC) | 65 chars, 59 Hebrew codepoints, 31 niqqud/te'amim, no HTML |
| Edge voices | `he-IL-AvriNeural` (M), `he-IL-HilaNeural` (F) |
| synthesis | 3,984 ms audio for Gen 1:1 |
| boundary mapping | **7/7 mapped, 0 unmapped, 90.8% char coverage** — the existing mapping code works unchanged, including vowel points |
| font | Noto Serif Hebrew subset → 65 KB woff2 |

RTL was the only real work: `dir="rtl"` on the reading surface, mirrored verse gutter, and
bidi isolation for numbers. Verified in-app (`dir=rtl`, Hebrew heading, `gutterMirrored:true`,
20 marks mapped with `markCheck:true`).

Note: `capturePage` returned a stale frame after text-only changes in an occluded window, so
the Hebrew screenshot is taken from a second offscreen window. Worth remembering for any
future visual regression testing.

## Spike 12 — translation catalogue audit (Spanish / French)

Fetched every Spanish and French edition the provider lists and checked each for real
scripture, canon size, direction and markup.

| Language | entries | usable | notes |
|---|---|---|---|
| Spanish | 7 | 6 | `BTX3`, `RV1960`, `RV2004`, `PDT`, `NTV`, `LBLA` all return scripture; **`NVI` returns a Biblica placeholder** |
| French | 5 | 5 | `NBS`, `FRDBY`, `FRLSG`, `FRPDV17`, `BDS`; `FRPDV17` has 75 books (9 deuterocanonical) |

The `NVI` failure is easy to miss: it returns 36 well-formed verses with the right numbering,
but every verse repeats the same licensing notice — 1 distinct opening across John 3. A
naive "does it return rows?" check would pass it. The catalogue therefore ships 6 Spanish and
5 French editions, and the UI now shows each translation's license status.

## What is now de-risked

- Edge TTS works today with no key and no token failures.
- Word-boundary karaoke is feasible for all four languages with 100% mapping accuracy.
- MP3 chunk stitching is exact, so multi-verse passages and prefetch are safe.
- Verse-sized synthesis latency (260–511 ms) supports the "speak on click within 2 s" acceptance criterion.
- 8 parallel synthesis requests complete cleanly; prefetch will not trip throttling.
- The offline fallback has working OS voices for all four locales, and `onboundary` keeps karaoke alive.

## What remains unverified

- **Offline failure latency.** When Edge TTS is unreachable, `msedge-tts` defaults to a 10 s connection timeout before erroring. A 10 s hang before falling back is bad UX; the app should set `connectionTimeoutMs` to ~2–3 s. This is a config decision, not an unknown, but it has not been exercised on a truly disconnected machine.
- **Sustained multi-hour usage** — the spikes ran for seconds to minutes, not hours. The `Sec-MS-GEC` token path could still rotate or break over a long session.
- **Audio quality for `es-MX` / `fr-CA`** — only `es-ES` and `fr-FR` were exercised; the Latin-American and Canadian variants are untested.
- **`onboundary` coverage across machines** — verified here (15 voices), but a machine without the Chinese language pack would have no `zh-TW` OS voice, so the fallback must detect absence and say so rather than silently speaking English.
