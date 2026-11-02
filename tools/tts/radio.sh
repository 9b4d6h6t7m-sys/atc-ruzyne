#!/bin/bash
# radio.sh in.wav out.wav : VHF radio colouring (band-limit, compression, mild clipping) + key-up noise and squelch tail
in=$1; out=$2
S=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
D=$(python3 -c "print(round($S + 0.34, 3))"); E=$(python3 -c "print(round($S + 0.14, 3))")
ffmpeg -loglevel error -y -i "$in" -f lavfi -i "anoisesrc=color=pink:amplitude=0.5:sample_rate=22050:duration=$D" -filter_complex "\
[0:a]aresample=22050,adelay=120|120,apad=whole_dur=$D,highpass=f=330,highpass=f=330,lowpass=f=2700,lowpass=f=2900,acompressor=threshold=0.05:ratio=9:attack=2:release=70:makeup=6,asoftclip=type=atan:param=1.4,volume=0.75[s];\
[1:a]highpass=f=500,lowpass=f=3300,volume='0.022+0.09*exp(-t/0.05)+0.12*gte(t,$E)*lt(t,$E+0.16)':eval=frame[n];\
[s][n]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.9[o]" -map "[o]" -ac 1 -ar 22050 "$out"
