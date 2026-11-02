# CLAUDE.md – ATC trainer Praha Ruzyně (LKPR)

Handoff and working notes for Claude. Read this file first in every session.

## Working with the user

- Communicate in **Czech**. The ATC HMI, labels and radio phraseology are **English** (ICAO); the
  trainer chrome (test checklists, instructor panel, results report) is Czech.
- Tone: professional, factual, direct. No emojis, no apologies, no filler.
- Actively point out flaws and weak spots in the user's ideas.
- When presenting choices, give **3 options**, justify each, list pros and cons. If the user rejects
  them, propose entirely new ones.
- The user tests on an **iPad Pro 11" (M2), Safari / Home Screen web app**, with touch, Apple Pencil,
  hardware keyboard and microphone. He reports results by pasting the app's "Výsledky" (results)
  text. Apple Pencil Scribble was rejected (handwriting recognition is unreliable) – do not rely on it.
- Long-term goal: realistic APP + TWR trainer (Phase 1 sim core + APP scenarios with scoring,
  Phase 2 TWR = Delivery + Ground + Tower, Phase 3 campaign and a FEAST-style aptitude module).
  Real minima, real airlines on typical routes, TopSky-like look.

## Repository layout

```
src/            source (plain browser JS, no framework, no bundler; globals in load order)
docs/           BUILD OUTPUT served by GitHub Pages (main branch, /docs). Never edit by hand.
  index.html    the whole app in one file (CSS + JS inlined)
  asr-worker.js, mic-worklet.js, tts-worker.js, llm-worker.js   copied from src/ by build.py (workers cannot be inlined)
  voices/       pilot voice packs: <id>.mp3 sprite (16 kHz, 32 kbps) + <id>.json index (tools/tts/packgen.py)
  vendor/       transformers.js, onnxruntime-web (WASM + standalone bundle), phonemizer (espeak-ng WASM); pinned and verified (tools/vendor.py)
tools/          build, browser tests, data generation, TTS pack generator, ASR evaluation
.work/          gitignored: models, sherpa-onnx, raw WAV, screenshots, bundle.js
```

Site: https://9b4d6h6t7m-sys.github.io/atc-ruzyne/ (Pages must be set to `main` + `/docs`).

## Build and test

```bash
python3 tools/build.py            # src/ -> docs/index.html (+ .work/bundle.js)
node --check .work/bundle.js      # syntax check of the concatenated bundle
python3 tools/functest.py         # Playwright/Chromium functional test, must end with "FAILED: []"
node tools/asr_eval/eval.js gb us cz   # VoiceParser accuracy on stored Whisper transcripts
python3 tools/vendor.py --check   # vendored runtime matches VENDOR.json (sha256)
node tools/asr_eval/browser.js base.en gb us cz [--prompt]   # the game's ASR worker on the eval audio
node tools/asr_eval/policy.js 'tools/asr_eval/hyp/tjs-whisper-base.en_{v}.json'   # executed/wrong/say-again per threshold
```

- Always rebuild and commit `docs/` together with source changes (Pages serves the committed build).
- `functest.py` serves `docs/` on a local port itself and sets `App.fastRadio = true` so readbacks
  are not played in real time. Screenshots go to `.work/shots/`. It runs Chromium with a fake
  microphone (PTT capture) and routes `huggingface.co` model requests to `.work/models/`; the ASR
  self-test (voice pack → Whisper tiny.en WASM → parser → readback) runs only when tiny.en is there
  (`node tools/asr_eval/browser.js tiny.en gb --limit 1` downloads it), otherwise it prints SKIP. The
  neural-voice check (Piper VCTK → Whisper hears "120"/"852" → spoken on the radio) needs
  `.work/models/rhasspy/piper-voices/en/en_GB/vctk/medium/en_GB-vctk-medium.onnx(.json)` (curl from the
  pinned revision in `TTS_REPO`), otherwise SKIP. Before timing-sensitive drags it waits until the voice
  models have loaded (a press held > 330 ms before moving is a vector gesture by design).
- Playwright `route.fulfill` cannot carry files of a few hundred MB (the browser closes): test LLMs with
  `LLMBench.localModelPath = '/models/'` (relative path) and a local HTTP server instead.
- Python Playwright must match the preinstalled Chromium: `pip install playwright==1.63.0`
  (Chromium 1243 in `/opt/pw-browsers`; never run `playwright install`).
- Headless audio timing is unreliable under CPU load (the fake output device renders in bursts): tests
  check that PTT captured audio, not its duration.
- `tools/setup_work.sh` downloads sherpa-onnx, the TTS voices and Whisper into `.work/` (GitHub
  release assets) and compiles `batchtts`. Needed only for `tools/tts/packgen.py` and
  `tools/asr_eval/run.py`, not for the game.
- `tools/gen_data.py` regenerated `src/data.js` (window.LKPR) from Natural Earth + X-Plane apt.dat;
  those sources are not in the repo (`.work/data_src`). Treat `src/data.js` as the source of truth.

## Architecture (src/, in build order – see `ORDER` in tools/build.py)

| file | contents |
|---|---|
| data.js | generated LKPR geometry: runways, taxiways, stands, TMA, fixes, terrain/map layers |
| core.js | `Geo`, `FIX`, `RWY`, `PERF`, `AIRLINES`, `PHON`/`DIGW` (spoken forms), `Speak` (callsign/number/fix speech), `Store`, DOM helpers |
| sim.js | `Aircraft` (flight model, ILS capture, modes), `Sim` (step, conflicts), traffic generators |
| phrase.js | `Phrase` (ATC/pilot phrase builders; readback variants by pilot style), `Parser` (typed commands), `cmdLabel`, `Comms` (radio queue, frequency busy incl. controller PTT `txOn/txOff`, readbacks; `atc(ac, cmds, {text, note, delay})` logs a speech transcript with what was understood) |
| voiceparse.js | `VoiceParser` for speech: phonetic keys, fuzzy callsign matching restricted to aircraft on frequency, ambiguity check, homophone-aware number reading, confidence; `prompt(aircraft)` = Whisper decoder prompt |
| audio.js | `Sound`: iOS-safe audio (unlock on every gesture, `navigator.audioSession` – `play-and-record` while `Mic.capturing`, silent-loop keep-alive, resume on visibility), tones, `say()` (speechSynthesis fallback), `transmit()` |
| voicepack.js | `VoicePack`: loads `voices/<id>`, plans a phrase from the unit vocabulary (mid/end intonation variants), schedules it through a VHF radio chain (band-pass, presence, compressor, soft clip). `VP_MAP` maps airline → accent voice pool; `renderOffline()` (used by the ASR self-test) |
| tts.js | `PilotTTS`: runtime neural pilot voices (Piper via `tts-worker.js`), `TTS_MODELS`/`TTS_VOICES` (pack voice id → model, speaker, speed), pre-synthesis of queued transmissions, playback through `VoicePack.chain`; packs and device voice are the fallbacks |
| tts-worker.js | module worker (copied to docs/): espeak-ng phonemes (vendored phonemizer) → Piper ids → ONNX Runtime WASM (vendored standalone bundle), model files from `rhasspy/piper-voices` (pinned revision) in the Cache API, silence trim, level matched to the packs |
| voice.js | voice control: `ASR_MODELS` (pinned Whisper repos/revisions/dtypes, read by tools), `ASR` (worker client: WebGPU→WASM fallback, progress, transcribe), `Mic` (getUserMedia → AudioWorklet, audio session switching), `Voice` (PTT state machine, keys, radio policy, self-test, stats), `pttControl()` |
| asr-worker.js | module worker (copied to docs/): imports `vendor/transformers-4.3.2/`, Whisper load + warm-up, resample to 16 kHz, silence trim, fast log-mel, decoder prompt, greedy decoding |
| mic-worklet.js | AudioWorkletProcessor (copied to docs/): 2048-frame blocks with peak level, `flush` |
| llm.js | `LLMBench` and `LLM_MODELS` (pinned small instruct models): on-device benchmark for AI pilots (pilot persona, 3 non-standard questions, timings, fact check), crash detection through `atc.llm.running` |
| llm-worker.js | module worker (copied to docs/): transformers.js `AutoModelForCausalLM`, WebGPU q4f16 or WASM q4, chat template (`enable_thinking: false`), streamer timing |
| radar.js | `RadarView` (TopSky-like), `PanZoom`, `CommandMenu`, label menus, vector gestures (pen/long-press drag → HDG, snap to fix → DCT) |
| ground.js | A-SMGCS ground view, `GroundTraffic`, RIMCAS, status bar, sequence list |
| window.js | `WindowView`: canvas tower-cab view (sky, sun, clouds, stars, terrain, Prague skyline, buildings, 3D aircraft, lights, fog/LVP halo) |
| strips.js | `StripBay` (drag strips, reorder, CLR state) |
| tests.js | the current app is a **feature-test harness**: `TESTS` (radar, ground, strips, touch, pencil, mouse, keyboard, voices, input, voice, ai, alerts, display, storage, perf, results) with Czech checklists, instructor actions, ATC command dock (`mountDock`, `commandLine`) |
| app.js | `App` shell: navigation, audio button, results report (incl. `voiceReport()`: backend, timings, last transcripts), PTT key hooks (capture phase), boot, frame loop |

Conventions: HMI strings English; one global object per module; no external runtime dependencies
except Google Fonts and the Whisper model files (Hugging Face hub, pinned revisions, cached by the
browser). Keep 120 Hz on ProMotion: cap canvas DPR (window view ≤ 1.5), batch drawing.
`build.py` prepends `const ASSET = {...}`: URLs of the copied worker files with a content hash.

## iOS / Safari constraints (learned the hard way)

- Audio only starts from a user gesture; `AudioContext` can become `suspended`/`interrupted` after
  app switching. `Sound.unlock()` runs on every gesture; `whenRunning()` resumes or drops a sound
  after 400 ms. A silent looping `<audio>` keeps the session alive in silent mode.
- `navigator.audioSession.type` exists on iPadOS Safari; `'playback'` normally, `'play-and-record'`
  while the microphone is open (`Mic` switches it around each PTT; `Sound.unlock()` respects it).
  Unverified on the iPad: whether the switch interrupts the AudioContext or lowers playback volume
  (the voice test has a "keep microphone open" toggle to compare).
- Bluetooth headsets (AirPods) switch to the hands-free profile when the microphone opens: measured
  1.9 s and a call-like sound change (AirPods, 24 kHz track). After one slow or Bluetooth opening `Mic`
  keeps the microphone open for the session (`autoKeep`), closes it in the background, and records a
  0.3 s pre-roll so a word spoken together with the PTT press is kept.
- A touch `pointerdown` is not a user activation (only `pointerup`/`touchend` are): the PTT button
  cannot resume a suspended AudioContext. `Voice.down()` reports AUDIO SUSPENDED instead of waiting.
- GitHub Pages sends no COOP/COEP headers, so the page is not cross-origin isolated and ONNX Runtime
  WASM runs single-threaded there (WebGPU is unaffected).
- Leaving the app drops the display to 60 Hz until it is reopened (OS behaviour, not a bug).
- The app used to run as a claude.ai artifact (strict CSP, no microphone). It now runs on GitHub Pages,
  so microphone, WebGPU, Workers, Cache API and cross-origin model downloads are available.

## Pilot voices: runtime neural TTS (v0.5, default) with voice packs as fallback

The user found the voice packs "dictated" and the numbers hard to follow (each word, each digit a
separate fragment with final intonation). `PilotTTS` now synthesises the whole transmission at run time
with the same Piper speakers (tts-worker.js, ONNX Runtime WASM, 1 thread on Pages): VCTK 77 MB (gb_m1,
gb_m2, gb_f1, sc_m1, ie_m1, us_m1, au_m1, in_m1), L2-ARCTIC 77 MB (ar_m1, es_m1, ko_m1), Czech jirka
63 MB with English phonemes (cz_m1); `rhasspy/piper-voices` revision b4e358ff…, files in the Cache API.
Readbacks are synthesised when queued (`Comms.atc/pilot` → `PilotTTS.prepare`), so they are ready when
the pilot answers. Lower noise/noiseW than the trained defaults keep digits steady; pace 0.98; level
matched to the packs (voiced RMS). fr_f1/it_m1 (Kokoro) still use the packs – add Kokoro (kokoro-js or
the ONNX model with the same phonemizer) to cover them. Test 8 has the source switch (Neurální /
Balíčky / Jen iPad) and synthesis timings; the report has a "Neurální hlasy" line.
Measured headless (WASM, 1 thread, container vCPU): model load 5–13 s, synthesis 1.6–4 s per
transmission (about half the audio duration), speech about half as long as the pack version. Whisper
base.en as an impartial listener (no prompt) got 120, 852, 270, 220, 90, runway 24, 4000, QNH 1013 and
139 right from the neural voice, where the packs gave e.g. "speed 2-0-0", "nine, zedo"; still weak:
"two niner zero" with the Spanish-accent speaker.

### Voice packs (fallback)

- Offline neural TTS (sherpa-onnx: Piper VCTK/L2-ARCTIC voices, Czech Piper voice with English
  phonemes for Czech crews, Kokoro for French/Italian) rendered into per-voice sprites of ~244
  vocabulary units (digits, phonetic alphabet, airline telephony, phrases, 56 fixes, 9 navaids),
  each in a "mid" and an "end" intonation. Assembled at runtime; falls back to speechSynthesis.
- Adding a spoken word = add it to the vocabulary in `tools/tts/packgen.py`, regenerate packs
  (`python3 tools/tts/packgen.py all`), rebuild. A coverage check over all phrases must find no
  missing unit.

## Voice control (variant B) – v0.4, first iPad test done

First iPad report (2026-11-02): WebGPU works in Safari's worker (base.en fp32/q4, model from cache
2.9 s, ASR median 0.7 s per transmission); most failures came from the AirPods microphone opening late
(cut callsigns, PTT released before the microphone was ready) – fixed by `autoKeep` + pre-roll. Free
questions ("how many passengers on board") end in "say again" by design until AI pilots exist. The
controller's own "say again" makes the last (or addressed) pilot repeat its last transmission.
The voice-pack self-test misheard "niner zero" as "980": concatenated digits are hard to follow, for
people and for Whisper – the reason for runtime TTS (below). A leaner decoder prompt (callsigns, ILS,
fixes only) was worse (gb 69 %, us 63 %) than the full one (76 %, 68 %).

Push-to-talk speech input, fully on-device, then grammar-constrained interpretation.

Pipeline: PTT (`pttControl()` button on the radar views, held Space, or a learned key such as a
Bluetooth pedal; pause moved to P) → `Mic` (getUserMedia with EC/NS/AGC → `mic-worklet.js` blocks;
opened per press and closed on release unless "keep microphone open"; audio session
`play-and-record` only while open) → `ASR.transcribe()` (`asr-worker.js`: resample to 16 kHz,
energy trim – no speech means no radio response, fast log-mel, Whisper greedy decoding with
`VoiceParser.prompt(aircraft on frequency)` as decoder prompt) → `VoiceParser.parse()` →
`Voice.handle()` policy:

- callsign + instructions, confidence ≥ `Voice.minConf` (0.6) → `Comms.atc()`: transcript in the
  radio log with what was understood as a note, readback after 0.8–1.8 s.
- callsign but no, uncertain or only partly understood instruction → that pilot: "say again, <callsign>".
  Partly understood = numbers or instruction words after the callsign that no recognised instruction
  used (`unexplained`, caps confidence at 0.5).
- ambiguous callsign → the most likely pilot: "Praha Radar, say again" (log note CALLSIGN AMBIGUOUS).
  The planned wording "station calling, say again callsign" needs the units `station calling` and
  `callsign` in the voice packs; add them at the next `packgen.py` run and change `Voice.handle()`.
- no callsign → a random pilot on frequency: "Praha Radar, say again" (only for ≥ 3 words).
- PTT over a pilot transmission → BLOCKED, nothing delivered. While PTT is held no pilot starts.

Runtime: `@huggingface/transformers` 4.3.2 with its exact `onnxruntime-web 1.31.0-dev.20260914-8d85527a0`
(asyncify WASM for WebGPU/current browsers, plain WASM for Safari < 26 without WebGPU), vendored by
`tools/vendor.py` into `docs/vendor/transformers-4.3.2/` (41.8 MB; jsDelivr is not used). Models:
`onnx-community/whisper-{tiny,base,small}.en` at pinned revisions (`ASR_MODELS` in voice.js); WASM
q8/q8, WebGPU fp32 encoder + q4 decoder (small.en: fp16 encoder). Default base.en, device auto
(WebGPU, WASM fallback when the WebGPU session fails, reported in the voice test). transformers.js
caches model and WASM files in the Cache API (`transformers-cache`); after one successful load the
app loads the model at start (`atc.asr.auto`). HF serves CORS for the Pages origin (checked).

Measured with the game's worker in headless Chromium (`tools/asr_eval/browser.js`; Linux x86, WASM
4 threads, cross-origin isolated; on Pages the iPad gets 1 WASM thread, or WebGPU), parser after the
v0.4 fixes, whole-transmission accuracy / wrong aircraft:

| transcripts | gb | us | cz |
|---|---|---|---|
| sherpa-onnx base.en int8 (baseline) | 59 % / 0 | 56 % / 1 | 9 % / 1 |
| transformers.js tiny.en q8 | 46 % / 5 | 45 % / 2 | 6 % / 2 |
| transformers.js tiny.en q8 + prompt | 57 % / 2 | 53 % / 2 | 13 % / 1 |
| transformers.js base.en q8 | 58 % / 1 | 62 % / 2 | 8 % / 0 |
| **transformers.js base.en q8 + prompt** (default) | **76 % / 1** | **68 % / 0** | **19 % / 0** |

The decoder prompt is the biggest single gain: base.en callsign recognition gb 74 → 90 %, us 82 → 93 %,
cz 41 → 74 % (the eval prompt holds the addressed flight and six others, as the game's frequency would,
plus eight arrival fixes). Risk seen once: "runway 30" decoded as "24" (the prompt names the active runway).
Policy on base.en + prompt, gb+us, minConf 0.6 (`tools/asr_eval/policy.js`): 70 % executed correctly,
5 % executed wrongly (a wrong number; no wrong aircraft), 25 % "say again". Without the coverage check
14 % were executed wrongly, mostly with a second or third instruction silently dropped.

Latency per transmission (40 gb transmissions, 3.5 s of audio on average, container vCPUs, nothing else
running), median / p90 from the worker message to the transcript: base.en WASM 4 threads 2.3 / 2.9 s with
the prompt (2.3 / 3.7 s without), 1 thread 5.4 / 6.2 s (5.1 / 6.0 s without); tiny.en 1 thread with the
prompt 2.7 / 3.1 s. The prompt costs nothing measurable; log-mel features take 30–40 ms. GitHub Pages
gives the iPad 1 WASM thread, so WebGPU decides whether base.en is fast enough there (M2 cores are faster
than these vCPUs). WebGPU itself was checked headless on a SwiftShader adapter (correct transcripts,
fp32 encoder + q4 decoder session works; CPU-emulated, so no timing).

Diagnostics: test "Hlasové ovládání" (radar, PTT, transcript table; instructor: model, device,
load, self-test without microphone, learn pedal key, keep microphone open, EC/NS/AGC, prompt on/off,
PTT button side). The
results report adds backend, timings and the last 12 transcripts with audio length / PTT hold
time, ASR time (features + decoder) and outcome: paste them to tune the parser on real speech.

To confirm on the iPad: WebGPU active (and in the worker) and its latency; download and caching;
microphone permission in Safari vs the Home Screen app; effect of the audio-session switch on pilot
playback (volume, route) and on the first syllable (open latency, "keep microphone open" and
"EC/NS/AGC" toggles); pedal key; accuracy with a real (Czech) accent.

Next steps for voice control (after the iPad report): tune `VoiceParser` on the real transcripts from
the results report (wrong numbers are the main remaining error; telephony, ILS wording and fix names
next); add `station calling` and `callsign` to the voice packs; if WebGPU is missing in Safari's
worker, decide between WASM (1 thread on Pages) and cross-origin isolation through a service worker
(WASM threads, but COEP also constrains Google Fonts and model downloads); small.en only if base.en
is not good enough with a real accent (410 MB on WebGPU).

Offline evaluation (`tools/asr_eval/`): 160 synthetic controller transmissions (`dataset.json`:
id, callsign, expected commands, spoken text), synthesised with three voices (`audio/<cz|gb|us>/<id>.mp3`,
16 kHz mono). Transcripts in `hyp/`: `whisper-base.en_<v>.json` (sherpa-onnx baseline) and
`tjs-whisper-<model>[-prompt]_<v>.json` (the game's worker). `eval.js` scores them with the
game's parser (`HYP=<pattern with {v}>`), `policy.js` simulates the radio policy per threshold.
Remaining failures: mangled telephony (Ryanair, Skytravel, Aegean, Qatari, Turkish, Vueling,
Finnair), ILS wording ("FIDA LS approach"), number fragments ("1 under 0"), direct-to fixes
("direct evening" → EVEMI), "contact Rousin". The synthetic Czech accent is far worse than real
speech; real accuracy must be measured on the iPad.

## AI pilots (user chose "P2 built on P1"; order: plan A = voices first, then P1, then P2)

- Step 1 (v0.5): on-device LLM benchmark, test "AI piloti – měření" (`LLMBench`, `llm-worker.js`).
  Candidates (onnx-community, pinned revisions in `LLM_MODELS`): LFM2 350M (255 MB q4f16), Qwen3 0.6B
  (570 MB), Gemma 3 1B (763 MB), LFM2 1.2B (760 MB). A pilot persona answers three non-standard
  questions (persons on board, fuel endurance, destination); the report lists load time, warm-up, time to
  first token, tokens/s, answers and a fact check, plus "stránka spadla" when Safari killed the page during
  a run (flag `atc.llm.running`). The user should run it with Whisper and the neural voices loaded.
  Cache API may refuse files of this size (seen headless) – then the model downloads again next time.
  WASM fallback uses q8: the WASM build of ONNX Runtime has no GatherBlockQuantized (4-bit embeddings).
  Checked headless: LFM2 350M q4 on WebGPU (SwiftShader) loads and answers "Air France 1083, 152
  passengers…" (timings meaningless on CPU emulation); q4f16 needs shader-f16 (the iPad has it).
- P1 (deterministic, always available): scripted pilot initiative – initial calls, requests (direct,
  higher/lower, weather deviation), "unable", "say again", emergencies, lost comms, go-arounds; common
  non-standard questions with facts from the sim (souls on board, fuel endurance, say heading/level/speed).
- P2 (LLM layer, chosen from the benchmark): only for transmissions P1 does not understand; constrained
  output (JSON intent + reply text) grounded in the aircraft state; numbers and callsigns validated against
  the sim; "say again" when unsure; spoken by `PilotTTS`. Standard readbacks stay deterministic.

## Environment notes

- Claude Code cloud environment `atc` (network: Limited, package managers on) allows additionally:
  `huggingface.co`, `*.huggingface.co`, `*.hf.co`, `cdn.jsdelivr.net` (models and library builds),
  `cdn.playwright.dev`, `playwright.download.prss.microsoft.com` (Chromium for Playwright tests).
  If a host is blocked (HTTP 403 from the proxy), tell the user its exact name so they can add it.
- GitHub release assets (sherpa-onnx) are used by `tools/setup_work.sh`. In Claude Code cloud
  sessions the GitHub proxy may only serve repositories attached to the session; if those downloads
  return 403, use `pip install sherpa-onnx` and the same models from Hugging Face mirrors instead.
- Headless Chromium on Linux does not reproduce iPad Safari (WebGPU, microphone permission, audio
  session). Test the WASM path headless; WebGPU and mic behaviour must be confirmed by the user on the iPad.
- Commit messages: short imperative summary; keep the attribution trailer the session provides.
