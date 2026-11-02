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
  voices/       pilot voice packs: <id>.mp3 sprite (16 kHz, 32 kbps) + <id>.json index
tools/          build, browser tests, data generation, TTS pack generator, ASR evaluation
.work/          gitignored: models, sherpa-onnx, eval audio, screenshots, bundle.js
```

Site: https://9b4d6h6t7m-sys.github.io/atc-ruzyne/ (Pages must be set to `main` + `/docs`).

## Build and test

```bash
python3 tools/build.py            # src/ -> docs/index.html (+ .work/bundle.js)
node --check .work/bundle.js      # syntax check of the concatenated bundle
python3 tools/functest.py         # Playwright/Chromium functional test, must end with "FAILED: []"
node tools/asr_eval/eval.js gb us cz   # VoiceParser accuracy on stored Whisper transcripts
```

- Always rebuild and commit `docs/` together with source changes (Pages serves the committed build).
- `functest.py` serves `docs/` on a local port itself and sets `App.fastRadio = true` so readbacks
  are not played in real time. Screenshots go to `.work/shots/`.
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
| phrase.js | `Phrase` (ATC/pilot phrase builders; readback variants by pilot style), `Parser` (typed commands), `cmdLabel`, `Comms` (radio queue, frequency busy, readbacks) |
| audio.js | `Sound`: iOS-safe audio (unlock on every gesture, `navigator.audioSession`, silent-loop keep-alive, resume on visibility), tones, `say()` (speechSynthesis fallback), `transmit()` |
| voicepack.js | `VoicePack`: loads `voices/<id>`, plans a phrase from the unit vocabulary (mid/end intonation variants), schedules it through a VHF radio chain (band-pass, presence, compressor, soft clip). `VP_MAP` maps airline → accent voice pool |
| voiceparse.js | `VoiceParser` for speech: phonetic keys, fuzzy callsign matching restricted to aircraft on frequency, ambiguity check, homophone-aware number reading, confidence. **Not yet in the build.** |
| radar.js | `RadarView` (TopSky-like), `PanZoom`, `CommandMenu`, label menus, vector gestures (pen/long-press drag → HDG, snap to fix → DCT) |
| ground.js | A-SMGCS ground view, `GroundTraffic`, RIMCAS, status bar, sequence list |
| window.js | `WindowView`: canvas tower-cab view (sky, sun, clouds, stars, terrain, Prague skyline, buildings, 3D aircraft, lights, fog/LVP halo) |
| strips.js | `StripBay` (drag strips, reorder, CLR state) |
| tests.js | the current app is a **feature-test harness**: `TESTS` (radar, ground, strips, touch, pencil, mouse, keyboard, voices, input, alerts, display, storage, perf, results) with Czech checklists, instructor actions, ATC command dock (`mountDock`, `commandLine`) |
| app.js | `App` shell: navigation, audio button, results report, boot, frame loop |

Conventions: HMI strings English; one global object per module; no external runtime dependencies so
far except Google Fonts. Keep 120 Hz on ProMotion: cap canvas DPR (window view ≤ 1.5), batch drawing.

## iOS / Safari constraints (learned the hard way)

- Audio only starts from a user gesture; `AudioContext` can become `suspended`/`interrupted` after
  app switching. `Sound.unlock()` runs on every gesture; `whenRunning()` resumes or drops a sound
  after 400 ms. A silent looping `<audio>` keeps the session alive in silent mode.
- `navigator.audioSession.type` exists on iPadOS Safari; use `'playback'` normally. For microphone
  capture it will have to switch to `'play-and-record'` during push-to-talk and back afterwards.
- Leaving the app drops the display to 60 Hz until it is reopened (OS behaviour, not a bug).
- The app used to run as a claude.ai artifact (strict CSP, no microphone). It now runs on GitHub Pages,
  so microphone, WebGPU, Workers, Cache API and cross-origin model downloads are available.

## Pilot voices (done)

- Offline neural TTS (sherpa-onnx: Piper VCTK/L2-ARCTIC voices, Czech Piper voice with English
  phonemes for Czech crews, Kokoro for French/Italian) rendered into per-voice sprites of ~244
  vocabulary units (digits, phonetic alphabet, airline telephony, phrases, 56 fixes, 9 navaids),
  each in a "mid" and an "end" intonation. Assembled at runtime; falls back to speechSynthesis.
- Adding a spoken word = add it to the vocabulary in `tools/tts/packgen.py`, regenerate packs
  (`python3 tools/tts/packgen.py all`), rebuild. A coverage check over all phrases must find no
  missing unit.

## In progress: voice control (user chose "variant B")

Push-to-talk speech input, fully on-device, then grammar-constrained interpretation.

1. PTT: on-screen button, hold Space (pause moves to P), Bluetooth pedal acting as a key. Frequency
   is busy while transmitting.
2. Capture: `getUserMedia` + AudioWorklet, resample to 16 kHz mono, trim silence.
3. ASR: Whisper via transformers.js (`@huggingface/transformers`) in a Web Worker; WebGPU with WASM
   fallback; selectable tiny.en/base.en/small.en. Candidate model id `onnx-community/whisper-base.en`
   (verify files/dtypes before use). Bias decoding with a prompt of callsigns on frequency, fixes and
   runway if supported. Vendor the library and pin versions; cache models (Cache API).
4. Interpretation: `VoiceParser.parse(text, aircraftOnFrequency)` → commands + confidence. Policy:
   low confidence → pilot answers "say again"; ambiguous callsign → "station calling, say again
   callsign". Show the recognised text in the radio log.
5. Diagnostics test page: mic permission, model download progress, WebGPU availability, latency,
   last transcripts.

Offline evaluation (`tools/asr_eval/`): 160 synthetic controller transmissions, synthesised with
three voices, transcribed by Whisper base.en (sherpa-onnx), scored with the game's parser.
Current whole-transmission accuracy: gb 57 %, us 55 %, cz (synthetic Czech accent) 9 %; wrong
aircraft ≤ 1. Remaining failures: mangled telephony (Ryanair, Skytravel, Aegean, Qatari, Turkish,
Vueling, Finnair), ILS wording ("FIDA LS approach"), number fragments ("1 under 0"), direct-to fixes
("direct evening" → EVEMI), "contact Rousin". Synthetic Czech accent is far worse than real speech;
real accuracy must be measured on the iPad.

## Next: AI pilots (user chose "P2 built on P1")

- P1 (deterministic, always available): scripted pilot initiative – initial calls, requests (direct,
  higher/lower, weather deviation), "unable", "say again", emergencies, lost comms, go-arounds.
- P2 (optional layer): small on-device LLM via WebGPU (e.g. Qwen2.5-0.5B/1.5B-Instruct ONNX q4f16 via
  transformers.js, or WebLLM) producing a constrained intent (JSON) grounded in the aircraft state;
  numbers and callsigns are validated against the sim; templates as fallback. Mind Safari memory limits.
- Free-text pilot speech needs runtime TTS with the same voice identities (Piper via onnxruntime-web
  + espeak-ng WASM; Kokoro for fr/it). Fixed phrases keep using the voice packs.

## Environment notes

- Claude Code cloud environment for this repo should allow, besides the default package registries:
  `huggingface.co`, `*.huggingface.co`, `*.hf.co`, `cdn.jsdelivr.net` (models and library builds).
- GitHub release assets (sherpa-onnx) are used by `tools/setup_work.sh`.
- Commit messages: short imperative summary; keep the attribution trailer the session provides.
