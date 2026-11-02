#!/bin/bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; WORK="${ATC_WORK:-$ROOT/.work}"
# asr.sh file.wav... -> English Whisper transcript per file
B=$WORK/asr/sherpa-onnx-v1.13.8-linux-x64-shared; export LD_LIBRARY_PATH=$B/lib; A=$WORK/asr
for f in "$@"; do ffmpeg -loglevel error -y -i "$f" -ac 1 -ar 16000 /tmp/asr16.wav
  t=$($B/bin/sherpa-onnx-offline --whisper-encoder=$A/sherpa-onnx-whisper-turbo/turbo-encoder.int8.onnx --whisper-decoder=$A/sherpa-onnx-whisper-turbo/turbo-decoder.int8.onnx --tokens=$A/sherpa-onnx-whisper-turbo/turbo-tokens.txt --whisper-language=en --num-threads=2 /tmp/asr16.wav 2>&1 | grep -o '"text": "[^"]*"' | head -1)
  echo "$(basename $f): $t"; done
