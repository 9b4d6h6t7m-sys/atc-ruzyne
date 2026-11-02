#!/bin/bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; WORK="${ATC_WORK:-$ROOT/.work}"
A=$WORK/asr; export LD_LIBRARY_PATH=$A/sherpa-onnx-v1.13.8-linux-x64-shared/lib
for v in gb cz; do
$A/sherpa-onnx-v1.13.8-linux-x64-shared/bin/sherpa-onnx-offline --whisper-encoder=$A/sherpa-onnx-whisper-turbo/turbo-encoder.int8.onnx --whisper-decoder=$A/sherpa-onnx-whisper-turbo/turbo-decoder.int8.onnx --tokens=$A/sherpa-onnx-whisper-turbo/turbo-tokens.txt --whisper-language=en --num-threads=2 $(ls $v/c*_16k.wav | sort) > turbo_$v.out 2>&1
done
echo done > turbo.done
