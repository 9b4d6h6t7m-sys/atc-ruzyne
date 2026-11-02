#!/bin/bash
# Download the offline speech toolchain into .work/ (gitignored). Only needed for regenerating
# voice packs (tools/tts/packgen.py) and for the offline ASR evaluation (tools/asr_eval/).
# The game itself needs none of this.
#   tools/setup_work.sh            # sherpa-onnx + TTS voices + Whisper base.en
#   tools/setup_work.sh turbo      # additionally Whisper large-v3-turbo (~1 GB, upper-bound ASR tests)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; WORK="${ATC_WORK:-$ROOT/.work}"
R=https://github.com/k2-fsa/sherpa-onnx/releases/download
SO=sherpa-onnx-v1.13.8-linux-x64-shared
mkdir -p "$WORK/tts/bin" "$WORK/asr"

fetch() {  # fetch <dest-dir> <url>  (extracts a .tar.bz2 once)
  local dir=$1 url=$2 name; name=$(basename "$url" .tar.bz2)
  [ -d "$dir/$name" ] && return 0
  mkdir -p "$dir"; echo "downloading $name"
  curl -fsSL "$url" | tar xj -C "$dir"
}

fetch "$WORK/asr" "$R/v1.13.8/$SO.tar.bz2"
fetch "$WORK/tts/dl_vctk" "$R/tts-models/vits-piper-en_GB-vctk-medium.tar.bz2"
fetch "$WORK/tts/dl_l2" "$R/tts-models/vits-piper-en_US-l2arctic-medium.tar.bz2"
fetch "$WORK/tts/dl_cs" "$R/tts-models/vits-piper-cs_CZ-jirka-medium.tar.bz2"
fetch "$WORK/tts/dl_kokoro" "$R/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2"
fetch "$WORK/asr/dl_base" "$R/asr-models/sherpa-onnx-whisper-base.en.tar.bz2"
if [ "${1:-}" = turbo ]; then fetch "$WORK/asr" "$R/asr-models/sherpa-onnx-whisper-turbo.tar.bz2"; fi

# Czech-accented English pilot (cz_m1): the Czech Piper voice driven by English espeak phonemes.
CS="$WORK/tts/dl_cs/vits-piper-cs_CZ-jirka-medium"
[ -f "$CS/cs_en.onnx" ] || python3 "$ROOT/tools/tts/onnxmeta.py" "$CS/cs_CZ-jirka-medium.onnx" "$CS/cs_en.onnx" voice=en-gb language=English

# Batch synthesiser (loads a model once, renders many lines).
B="$WORK/asr/$SO"
gcc -O2 -o "$WORK/tts/bin/batchtts" "$ROOT/tools/tts/batchtts.c" -I"$B/include" -L"$B/lib" -lsherpa-onnx-c-api -Wl,-rpath,"$B/lib"
echo "ready: $WORK"
