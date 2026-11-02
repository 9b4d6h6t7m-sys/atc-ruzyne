#!/bin/bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; WORK="${ATC_WORK:-$ROOT/.work}"
# tts.sh <engine> <voice-spec> <out.wav> <text>
B=$WORK/asr/sherpa-onnx-v1.13.8-linux-x64-shared; export LD_LIBRARY_PATH=$B/lib; T=$WORK/tts
eng=$1; v=$2; out=$3; shift 3; txt="$*"
case $eng in
  kokoro) sid=${v%%:*}; lang=${v#*:}; K=$T/dl_kokoro/kokoro-int8-multi-lang-v1_0
    $B/bin/sherpa-onnx-offline-tts --kokoro-model=$K/model.int8.onnx --kokoro-voices=$K/voices.bin --kokoro-tokens=$K/tokens.txt --kokoro-data-dir=$K/espeak-ng-data --kokoro-lang=$lang --num-threads=2 --sid=$sid --output-filename=$out "$txt" ;;
  vctk) M=$T/dl_vctk/vits-piper-en_GB-vctk-medium; $B/bin/sherpa-onnx-offline-tts --vits-model=$M/en_GB-vctk-medium.onnx --vits-tokens=$M/tokens.txt --vits-data-dir=$M/espeak-ng-data --num-threads=2 --sid=$v --output-filename=$out "$txt" ;;
  l2) M=$T/dl_l2/vits-piper-en_US-l2arctic-medium; $B/bin/sherpa-onnx-offline-tts --vits-model=$M/en_US-l2arctic-medium.onnx --vits-tokens=$M/tokens.txt --vits-data-dir=$M/espeak-ng-data --num-threads=2 --sid=$v --output-filename=$out "$txt" ;;
  cs) M=$T/dl_cs/vits-piper-cs_CZ-jirka-medium; $B/bin/sherpa-onnx-offline-tts --vits-model=$M/$v --vits-tokens=$M/tokens.txt --vits-data-dir=$M/espeak-ng-data --num-threads=2 --output-filename=$out "$txt" ;;
  de) M=$T/dl_de/vits-piper-de_DE-thorsten-medium; $B/bin/sherpa-onnx-offline-tts --vits-model=$M/$v --vits-tokens=$M/tokens.txt --vits-data-dir=$M/espeak-ng-data --num-threads=2 --output-filename=$out "$txt" ;;
esac
