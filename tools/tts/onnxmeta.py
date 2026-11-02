#!/usr/bin/env python3
"""Minimal ONNX ModelProto metadata editor (no onnx package needed): list or set metadata_props (field 14)."""
import sys
def rv(b, i):
    r = s = 0
    while True:
        x = b[i]; i += 1; r |= (x & 0x7f) << s; s += 7
        if x < 0x80: return r, i
def wv(n):
    out = bytearray()
    while True:
        x = n & 0x7f; n >>= 7
        if n: out.append(x | 0x80)
        else: out.append(x); return bytes(out)
def fields(b):
    i = 0
    while i < len(b):
        start = i; key, i = rv(b, i); f, w = key >> 3, key & 7
        if w == 0: _, i = rv(b, i); yield f, w, b[start:i], None
        elif w == 2: L, j = rv(b, i); yield f, w, b[start:j + L], b[j:j + L]; i = j + L
        elif w == 1: i += 8; yield f, w, b[start:i], None
        elif w == 5: i += 4; yield f, w, b[start:i], None
        else: raise ValueError('wire type %d' % w)
def entry(k, v):
    kb, vb = k.encode(), v.encode()
    inner = b'\x0a' + wv(len(kb)) + kb + b'\x12' + wv(len(vb)) + vb
    return b'\x72' + wv(len(inner)) + inner   # field 14, wire type 2
if __name__ == '__main__':
    src = sys.argv[1]; b = open(src, 'rb').read(); sets = dict(a.split('=', 1) for a in sys.argv[3:]) if len(sys.argv) > 3 else {}
    out = bytearray(); meta = {}
    for f, w, raw, payload in fields(b):
        if f == 14:
            kv = {ff: p.decode() for ff, ww, rr, p in fields(payload)}; k, v = kv.get(1, ''), kv.get(2, '')
            meta[k] = v
            if k in sets: out += entry(k, sets.pop(k)); continue
        out += raw
    for k, v in sets.items(): out += entry(k, v)
    print({k: (v[:60] + '...' if len(v) > 60 else v) for k, v in meta.items()})
    if len(sys.argv) > 2 and sys.argv[2] != '-': open(sys.argv[2], 'wb').write(out); print('written', sys.argv[2])
