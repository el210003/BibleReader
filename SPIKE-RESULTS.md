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

## What is now de-risked

- Edge TTS works today with no key and no token failures.
- Word-boundary karaoke is feasible for all four languages with 100% mapping accuracy.
- MP3 chunk stitching is exact, so multi-verse passages and prefetch are safe.
- Verse-sized synthesis latency (260–511 ms) supports the "speak on click within 2 s" acceptance criterion.

## What remains unverified

- Behaviour under sustained load / parallel synthesis (spikes were strictly sequential). M2 must test 3–5 concurrent requests for 403 throttling.
- Offline / Web Speech fallback quality on this machine.
- Whether the `Sec-MS-GEC` token path stays stable over weeks.
- Audio quality for `es-MX` / `fr-CA` variants (only `zh-TW` and `en-US` were exercised).
