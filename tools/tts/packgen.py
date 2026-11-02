#!/usr/bin/env python3
"""Build pilot voice packs for the ATC trainer.

For every voice: synthesise each vocabulary unit as "X, X." (first copy = continuation intonation,
second copy = final intonation), split at the pause, normalise loudness, pack all fragments into one
16 kHz MP3 sprite with an index of [mid_start, mid_dur, end_start, end_dur] per unit key.
Usage: packgen.py <voice-id>... | all | test
"""
import os as _os, pathlib as _pl
ROOT = _pl.Path(__file__).resolve().parents[2]
WORK = _pl.Path(_os.environ.get('ATC_WORK', ROOT / '.work'))
import json, os, re, subprocess, sys, wave, time
import numpy as np

T = f'{WORK}/tts'; BIN = f'{T}/bin/batchtts'; OUT = f'{ROOT}/docs/voices'
K = f'{T}/dl_kokoro/kokoro-int8-multi-lang-v1_0'
VCTK = f'{T}/dl_vctk/vits-piper-en_GB-vctk-medium'; L2 = f'{T}/dl_l2/vits-piper-en_US-l2arctic-medium'; CS = f'{T}/dl_cs/vits-piper-cs_CZ-jirka-medium'

VOICES = {
    # id: (engine, model spec, speaker id, speed, description)
    'gb_m1': ('vits', (f'{VCTK}/en_GB-vctk-medium.onnx', VCTK), 60, 1.06, 'English male (VCTK p232)'),
    'gb_m2': ('vits', (f'{VCTK}/en_GB-vctk-medium.onnx', VCTK), 95, 1.06, 'English male (VCTK p226)'),
    'gb_f1': ('vits', (f'{VCTK}/en_GB-vctk-medium.onnx', VCTK), 90, 1.06, 'English female (VCTK p228)'),
    'sc_m1': ('vits', (f'{VCTK}/en_GB-vctk-medium.onnx', VCTK), 96, 1.06, 'Scottish male (VCTK p260)'),
    'ie_m1': ('vits', (f'{VCTK}/en_GB-vctk-medium.onnx', VCTK), 97, 1.06, 'Irish male (VCTK p245)'),
    'us_m1': ('vits', (f'{VCTK}/en_GB-vctk-medium.onnx', VCTK), 75, 1.06, 'American male (VCTK p345)'),
    'au_m1': ('vits', (f'{VCTK}/en_GB-vctk-medium.onnx', VCTK), 25, 1.06, 'Australian male (VCTK p374)'),
    'in_m1': ('vits', (f'{VCTK}/en_GB-vctk-medium.onnx', VCTK), 92, 1.04, 'Indian male (VCTK p251)'),
    'ar_m1': ('vits', (f'{L2}/en_US-l2arctic-medium.onnx', L2), 21, 1.0, 'Arabic accent male (L2-ARCTIC ABA)'),
    'es_m1': ('vits', (f'{L2}/en_US-l2arctic-medium.onnx', L2), 22, 1.0, 'Spanish accent male (L2-ARCTIC EBVS)'),
    'ko_m1': ('vits', (f'{L2}/en_US-l2arctic-medium.onnx', L2), 16, 1.0, 'Korean accent male (L2-ARCTIC HKK)'),
    'cz_m1': ('vits', (f'{CS}/cs_en.onnx', CS), 0, 1.1, 'Czech accent male (Piper jirka, English phonemes)'),
    'fr_f1': ('kokoro', None, 30, 1.08, 'French accent female (Kokoro ff_siwis)'),
    'it_m1': ('kokoro', None, 36, 1.08, 'Italian accent male (Kokoro im_nicola)'),
}

DIG = {'zero': 'zero', 'one': 'one', 'two': 'two', 'three': 'tree', 'four': 'four', 'five': 'five', 'six': 'six', 'seven': 'seven',
       'eight': 'eight', 'niner': 'niner', 'nine': 'nine', 'decimal': 'decimal', 'thousand': 'thousand', 'hundred': 'hundred'}
PHON = {'alfa': 'alpha', 'bravo': 'bravo', 'charlie': 'charlie', 'delta': 'delta', 'echo': 'echo', 'foxtrot': 'foxtrot', 'golf': 'golf',
        'hotel': 'hotel', 'india': 'india', 'juliett': 'juliett', 'kilo': 'kilo', 'lima': 'lima', 'mike': 'mike', 'november': 'november',
        'oscar': 'oscar', 'papa': 'papa', 'quebec': 'kebeck', 'romeo': 'romeo', 'sierra': 'sierra', 'tango': 'tango', 'uniform': 'uniform',
        'victor': 'victor', 'whiskey': 'whiskey', 'xray': 'x-ray', 'yankee': 'yankee', 'zulu': 'zulu'}
TEL = {'skytravel': 'Skytravel', 'ryanair': 'Ryan air', 'easy': 'Easy', 'alpine': 'Alpine', 'topswiss': 'Top Swiss', 'wizz air': 'Wizz Air',
       'lufthansa': 'Lufthansa', 'eurowings': 'Eurowings', 'airfrans': 'Air France', 'klm': 'K L M', 'speedbird': 'Speedbird', 'austrian': 'Austrian',
       'swiss': 'Swiss', 'lot': 'Lot', 'vueling': 'Vueling', 'itarrow': 'Itarrow', 'turkish': 'Turkish', 'emirates': 'Emirates', 'qatari': 'Qatari',
       'scandinavian': 'Scandinavian', 'finnair': 'Finnair', 'france soleil': 'France Soleil', 'aegean': 'Aegean', 'shamrock': 'Shamrock',
       'tarom': 'Tarom', 'condor': 'Condor', 'beeline': 'Beeline', 'air serbia': 'Air Serbia', 'csa': 'C S A', 'heavy': 'heavy'}
PHRASES = ['praha radar', 'praha approach', 'praha control', 'praha information', 'tower', 'ground', 'radar contact', 'good day', 'good morning',
           'bye bye', 'thanks', 'thank you', 'roger', 'wilco', 'affirm', 'negative', 'say again', 'unable', 'standby',
           'flight level', 'altitude', 'feet', 'heading', 'left heading', 'right heading', 'turning left heading', 'turning right heading',
           'left', 'right', 'descend', 'descending', 'climb', 'climbing', 'maintain', 'maintaining', 'down to', 'up to', 'leaving', 'passing',
           'reduce speed', 'reducing', 'increase speed', 'increasing', 'maintain speed', 'speed', 'knots', 'no speed restrictions',
           'direct', 'proceeding direct', 'cleared i l s approach runway', 'cleared i l s runway', 'runway',
           'established localizer runway', 'localizer established runway', 'going around', 'resuming own navigation', 'own navigation',
           'inbound', 'departure', 'with you', 'q n h', 'contact', 'over to', 'squawk', 'squawking', 'information', 'with information',
           # tower and ground (phase 2)
           'ready for departure', 'holding point', 'holding short', 'hold short', 'lining up', 'line up and wait', 'lining up and waiting',
           'cleared for take off', 'cleared to land', 'runway vacated', 'vacated', 'taxi', 'taxiing', 'via', 'stand', 'request',
           'request taxi', 'request start up', 'start up approved', 'pushback', 'push and start', 'on final', 'crossing runway',
           'cross runway', 'behind', 'traffic in sight', 'looking out', 'wind check', 'expedite', 'mayday mayday mayday', 'pan pan pan pan pan pan',
           'go around', 'emergency', 'request vectors', 'request priority', 'souls on board', 'endurance', 'minutes', 'fuel']
SPECIAL = {'ruzyne tower': 'Roozinyeh Tower', 'ruzyne ground': 'Roozinyeh Ground', 'ruzyne delivery': 'Roozinyeh Delivery',
           'praha radar': 'Praha Radar', 'praha approach': 'Praha Approach', 'praha control': 'Praha Control', 'praha information': 'Praha Information',
           'q n h': 'Q N H', 'cleared i l s approach runway': 'cleared I L S approach runway', 'cleared i l s runway': 'cleared I L S runway',
           'pan pan pan pan pan pan': 'pan pan, pan pan, pan pan', 'mayday mayday mayday': 'mayday, mayday, mayday', 'start up approved': 'start up approved'}
FIXES = 'AKEVA APRAQ ARTUP ARVEG BAGRU BALTU BAROX DOBEN DONAD ERASU EVEMI GOLOP KENOK KUVIX LOMKI RATEV SOMIS UTORO VENOX ELPON ELMEK BEKVI BULEK LEMBI LAGAR SULOV RAPET VARIK KILNU ENITA NIRGO PEPIK LIKSA PISAM KOZLI RAVKU KONAR DITIS ODOMO BEPAS BUDEX LANUX MIKOV LEDVA BODAL ELVOT ENORU RASAN DEKOV OMELO LALUK MAREM TOMTI AGNAV VESUB ODNEM'.split()
NAVAIDS = ['vlasim', 'vozice', 'neratovice', 'frydlant', 'cheb', 'desna', 'brno', 'hermsdorf', 'rakovnik']


def vocab():
    u = {}
    u.update(DIG); u.update(PHON); u.update(TEL)
    for p in PHRASES: u[p] = SPECIAL.get(p, p)
    for k in ('ruzyne tower', 'ruzyne ground', 'ruzyne delivery'): u[k] = SPECIAL[k]
    for f in FIXES: u[f.lower()] = f[0] + f[1:].lower()
    for n in NAVAIDS: u[n] = n.capitalize()
    return u


def read_wav(p):
    with wave.open(p) as w:
        sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x, sr


def frames_db(x, fr):
    n = len(x) // fr
    if n == 0: return np.array([-120.0])
    e = np.sqrt(np.mean(x[:n * fr].reshape(n, fr) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(e / (e.max() + 1e-9))


def trim(y, sr, thr=-50, margin=0.025, tail=0.035):
    # generous margins: weak onsets (h, f, th) and releases (s, t, k) must survive the cut
    fr = int(sr * 0.005); db = frames_db(y, fr); on = np.where(db > thr)[0]
    if not len(on): return y[:0]
    a = max(0, on[0] * fr - int(margin * sr)); b = min(len(y), (on[-1] + 1) * fr + int(tail * sr))
    return y[a:b]


def split_two(x, sr):
    fr = int(sr * 0.01); db = frames_db(x, fr); n = len(db); sil = db < -36
    runs, i = [], 0
    while i < n:
        if sil[i]:
            j = i
            while j < n and sil[j]: j += 1
            runs.append((i, j)); i = j
        else: i += 1
    voiced = np.where(~sil)[0]
    if len(voiced) < 4: return None
    v0, v1 = voiced[0], voiced[-1]
    cand = [r for r in runs if r[0] > v0 and r[1] < v1]
    if not cand: return None
    mid = (v0 + v1) / 2
    r = max(cand, key=lambda r: (r[1] - r[0]) - 0.15 * abs((r[0] + r[1]) / 2 - mid))
    if r[1] - r[0] < 5: return None
    cut = (r[0] + r[1]) // 2 * fr
    a, b = trim(x[:cut], sr), trim(x[cut:], sr)
    if len(a) < sr * 0.08 or len(b) < sr * 0.08: return None
    ratio = len(a) / len(b)
    if not 0.55 < ratio < 1.8: return None
    return a, b


def synth(vid, items, tmp):
    eng, spec, sid, speed, _ = VOICES[vid]
    lst = f'{tmp}/list.tsv'
    with open(lst, 'w') as f:
        for i, t in items: f.write(f'{i}\t{t}\n')
    if eng == 'kokoro':
        cmd = [BIN, 'kokoro', f'{K}/model.int8.onnx', f'{K}/voices.bin', f'{K}/tokens.txt', f'{K}/espeak-ng-data', 'en', str(sid), str(speed), lst, tmp]
    else:
        model, d = spec
        cmd = [BIN, 'vits', model, f'{d}/tokens.txt', f'{d}/espeak-ng-data', str(sid), str(speed), lst, tmp]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def build(vid, only=None, log=print):
    t0 = time.time(); tmp = f'{T}/work/{vid}'; os.makedirs(tmp, exist_ok=True)
    U = vocab(); keys = list(U) if not only else only
    ids = {k: f'u{i:03d}' for i, k in enumerate(keys)}
    repack = os.environ.get('REPACK') == '1' and all(os.path.exists(f'{tmp}/{ids[k]}m.wav') for k in keys)
    if not repack:
        for f in os.listdir(tmp): os.remove(os.path.join(tmp, f))
    # two separate utterances per unit: trailing comma = continuation intonation (mid), full stop = final (end)
    if not repack: synth(vid, [x for k in keys for x in ((ids[k] + 'm', f'{U[k]},'), (ids[k] + 'e', f'{U[k]}.'))], tmp)
    frags, retry, sr = {}, [], None
    for k in keys:
        pm, pe = f'{tmp}/{ids[k]}m.wav', f'{tmp}/{ids[k]}e.wav'
        if not (os.path.exists(pm) and os.path.exists(pe)): retry.append(k); continue
        xm, sr = read_wav(pm); xe, sr = read_wav(pe); a, b = trim(xm, sr), trim(xe, sr)
        if len(a) < sr * 0.06 or len(b) < sr * 0.06: retry.append(k); continue
        frags[k] = (a, b)
    # loudness: equalise voiced RMS per fragment towards the voice median (bounded gain)
    def vrms(y):
        fr = int(sr * 0.01); n = len(y) // fr
        if n == 0: return 1e-4
        e = np.sqrt(np.mean(y[:n * fr].reshape(n, fr) ** 2, axis=1)); v = e[e > e.max() * 0.25]
        return float(np.sqrt(np.mean(v ** 2))) if len(v) else 1e-4
    allr = [vrms(a) for a, b in frags.values()] + [vrms(b) for a, b in frags.values()]
    target = float(np.median(allr))
    gap = np.zeros(int(sr * 0.12), dtype=np.float32); parts = [gap]; pos = len(gap); index = {}
    for k, (a, b) in frags.items():
        ent = []
        for y in (a, b):
            g = float(np.clip(target / max(vrms(y), 1e-4), 0.5, 2.0)); y = np.clip(y * g, -0.98, 0.98)
            ent += [round(pos / sr, 4), round(len(y) / sr, 4)]; parts += [y.astype(np.float32), gap]; pos += len(y) + len(gap)
        index[k] = ent
    sprite = np.concatenate(parts); peak = float(np.max(np.abs(sprite))) or 1.0; sprite = sprite / peak * 0.9
    os.makedirs(OUT, exist_ok=True); wav = f'{tmp}/sprite.wav'
    with wave.open(wav, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((sprite * 32767).astype(np.int16).tobytes())
    mp3 = f'{OUT}/{vid}.mp3'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-af', 'highpass=f=120', '-ar', '16000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k', mp3], check=True)
    meta = {'id': vid, 'desc': VOICES[vid][4], 'u': index, 'dur': round(len(sprite) / sr, 3)}
    json.dump(meta, open(f'{OUT}/{vid}.json', 'w'), separators=(',', ':'))
    log(f'{vid}: {len(frags)} units, retries {len(retry)}, sprite {meta["dur"]:.0f} s, mp3 {os.path.getsize(mp3) // 1024} kB, {time.time() - t0:.0f} s')


if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['test']:
        build('gb_m1', only=['descending', 'flight level', 'eight', 'zero', 'skytravel', 'juliett', 'cleared i l s approach runway', 'golop', 'ruzyne tower', 'q n h'])
        sys.exit()
    vids = list(VOICES) if args == ['all'] else args
    with open(f'{T}/packgen.log', 'a') as lf:
        for v in vids:
            try: build(v, log=lambda s: (lf.write(s + '\n'), lf.flush()))
            except Exception as e: lf.write(f'{v}: ERROR {e}\n'); lf.flush()
        lf.write('ALL DONE\n')
