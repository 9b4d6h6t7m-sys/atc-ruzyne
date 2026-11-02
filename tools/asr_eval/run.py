#!/usr/bin/env python3
"""Synthesize controller transmissions with several voices and transcribe them with Whisper base.en (offline)."""
import os as _os, pathlib as _pl
ROOT = _pl.Path(__file__).resolve().parents[2]
WORK = _pl.Path(_os.environ.get('ATC_WORK', ROOT / '.work'))
import json, os, subprocess, sys, re
T = f'{WORK}/tts'; A = f'{WORK}/asr'; E = f'{A}/eval'
data = json.load(open(f'{ROOT}/tools/asr_eval/dataset.json'))
VOICES = {'cz': ('vits', f'{T}/dl_cs/vits-piper-cs_CZ-jirka-medium/cs_en.onnx', f'{T}/dl_cs/vits-piper-cs_CZ-jirka-medium', 0, 1.0),
          'gb': ('vits', f'{T}/dl_vctk/vits-piper-en_GB-vctk-medium/en_GB-vctk-medium.onnx', f'{T}/dl_vctk/vits-piper-en_GB-vctk-medium', 60, 1.0),
          'us': ('vits', f'{T}/dl_vctk/vits-piper-en_GB-vctk-medium/en_GB-vctk-medium.onnx', f'{T}/dl_vctk/vits-piper-en_GB-vctk-medium', 75, 1.0)}
voices = sys.argv[1].split(',') if len(sys.argv) > 1 else list(VOICES)
env = dict(os.environ, LD_LIBRARY_PATH=f'{A}/sherpa-onnx-v1.13.8-linux-x64-shared/lib')
for v in voices:
    eng, model, d, sid, speed = VOICES[v]; out = f'{E}/{v}'; os.makedirs(out, exist_ok=True)
    lst = f'{out}/list.tsv'; open(lst, 'w').write(''.join(f"{o['id']}\t{o['say']}.\n" for o in data))
    if not os.path.exists(f"{out}/{data[-1]['id']}.wav"): subprocess.run([f'{T}/bin/batchtts', 'vits', model, f'{d}/tokens.txt', f'{d}/espeak-ng-data', str(sid), str(speed), lst, out], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wavs = []
    for o in data:
        src, dst = f"{out}/{o['id']}.wav", f"{out}/{o['id']}_16k.wav"
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-ar', '16000', '-ac', '1', dst], check=True); wavs.append(dst)
    res = subprocess.run([f'{A}/sherpa-onnx-v1.13.8-linux-x64-shared/bin/sherpa-onnx-offline',
        f'--whisper-encoder={A}/dl_base/sherpa-onnx-whisper-base.en/base.en-encoder.int8.onnx',
        f'--whisper-decoder={A}/dl_base/sherpa-onnx-whisper-base.en/base.en-decoder.int8.onnx',
        f'--tokens={A}/dl_base/sherpa-onnx-whisper-base.en/base.en-tokens.txt', '--num-threads=2', *wavs], env=env, capture_output=True, text=True)
    txt = res.stdout + res.stderr
    texts = [json.loads(l)['text'] for l in txt.splitlines() if l.startswith('{"lang"')]
    hyp = {o['id']: t for o, t in zip(data, texts)}
    json.dump(hyp, open(f'{E}/hyp_{v}.json', 'w'), indent=0)
    print(v, len(hyp), 'transcripts')
