#!/usr/bin/env python3
"""Generate LKPR data module (data.js) from AIP extracts, X-Plane 2013 apt.dat and Natural Earth."""
import os as _os, pathlib as _pl
ROOT = _pl.Path(__file__).resolve().parents[1]
WORK = _pl.Path(_os.environ.get('ATC_WORK', ROOT / '.work'))
import json, math, re

def dms(s):
    """Parse AIP coordinate like 500606.61N or 0141334.68E to decimal degrees."""
    s = s.strip()
    hemi = s[-1]; num = s[:-1]
    if hemi in 'NS':
        d, m, sec = int(num[0:2]), int(num[2:4]), float(num[4:])
    else:
        d, m, sec = int(num[0:3]), int(num[3:5]), float(num[5:])
    v = d + m/60 + sec/3600
    return -v if hemi in 'SW' else v

def pt(s):
    a, b = s.split()
    return (dms(a), dms(b))

LAT0, LON0 = 50.100833, 14.26  # ARP 500603N 0141536E
KX = math.cos(math.radians(LAT0)) * 60.0  # NM per deg lon
KY = 60.0
def to_nm(lat, lon): return ((lon-LON0)*KX, (lat-LAT0)*KY)
def from_nm(x, y): return (LAT0 + y/KY, LON0 + x/KX)

OKL = pt('500544.80N 0141555.81E')

def arc(p_from, p_to, center, cw, step_deg=3.0):
    cx, cy = to_nm(*center)
    x1, y1 = to_nm(*p_from); x2, y2 = to_nm(*p_to)
    r1 = math.hypot(x1-cx, y1-cy); r2 = math.hypot(x2-cx, y2-cy)
    b1 = math.degrees(math.atan2(x1-cx, y1-cy)) % 360
    b2 = math.degrees(math.atan2(x2-cx, y2-cy)) % 360
    if cw:
        sweep = (b2 - b1) % 360
    else:
        sweep = -((b1 - b2) % 360)
    n = max(2, int(abs(sweep)/step_deg))
    out = []
    for i in range(1, n):
        t = i/n; b = math.radians(b1 + sweep*t); r = r1 + (r2-r1)*t
        out.append(from_nm(cx + r*math.sin(b), cy + r*math.cos(b)))
    return out

def build_poly(spec):
    """spec: list of tokens: coordinate string or ('CW'|'CCW', radius) meaning arc to next coordinate."""
    pts = []; pending = None
    for tok in spec:
        if isinstance(tok, tuple):
            pending = tok; continue
        p = pt(tok)
        if pending and pts:
            pts += arc(pts[-1], p, OKL, pending[0] == 'CW')
            pending = None
        pts.append(p)
    if pending and pts:  # arc closing back to first point
        pts += arc(pts[-1], pts[0], OKL, pending[0] == 'CW')
    return pts

CW = lambda r: ('CW', r)
CCW = lambda r: ('CCW', r)

TMA = {
 'TMA I': ('2500 ft', '3500 ft', ['501502.83N 0140408.55E','501402.98N 0141032.84E',CCW(9),'500902.68N 0140254.89E','500637.44N 0140757.06E','500450.13N 0140201.36E',CCW(9),'500038.81N 0140425.41E','500142.19N 0140801.96E',CCW(6.5),'500006.17N 0142055.49E','495933.96N 0142458.76E',CCW(8.5),'500310.23N 0142830.47E','500058.45N 0143301.14E',CW(12),'495649.90N 0142822.84E','495913.92N 0140017.77E',CW(12)]),
 'TMA II': ('3500 ft', 'FL95', ['502331.25N 0140140.62E','502324.77N 0143620.29E','502128.83N 0144610.99E',CW(25),'501433.28N 0145219.90E','500905.08N 0144943.92E','495847.84N 0143727.62E','495259.83N 0144915.52E',CW(25),'494816.81N 0144337.12E','495008.79N 0140310.85E','495027.63N 0135549.35E','495218.61N 0135251.96E','495315.84N 0134221.62E',CW(25),'495854.06N 0133837.42E','500536.03N 0134451.71E',CW(20)]),
 'TMA III': ('4500 ft', 'FL95', ['501433.28N 0145219.90E','501409.32N 0145728.83E',CW(28),'501107.99N 0145839.41E',CW(28),'495503.59N 0145603.54E',CW(28),'495109.96N 0145257.92E','495259.83N 0144915.52E','495847.84N 0143727.62E','500905.08N 0144943.92E']),
 'TMA IV': ('FL65', 'FL95', ['495259.83N 0144915.52E','495109.96N 0145257.92E',CW(28),'494305.72N 0144122.39E','494415.01N 0141752.64E','495008.79N 0140310.85E','494816.81N 0144337.12E',CCW(25)]),
 'TMA V': ('FL65', 'FL95', ['503157.41N 0140037.91E','503201.59N 0143056.23E',CW(28),'501409.32N 0145728.83E','501433.28N 0145219.90E',CCW(25),'502128.83N 0144610.99E','502324.77N 0143620.29E','502331.25N 0140140.62E',CCW(20),'500536.03N 0134451.71E','495854.06N 0133837.42E',CCW(25),'495315.84N 0134221.62E','495218.61N 0135251.96E','495027.63N 0135549.35E','494647.97N 0134401.54E',CW(28),'500256.18N 0133240.43E',CW(28)]),
 'TMA VI': ('FL75', 'FL95', ['500256.18N 0133240.43E',CCW(28),'494647.97N 0134401.54E','494345.21N 0133348.70E',CW(35),'495958.32N 0132221.54E']),
 'TMA VII': ('FL75', 'FL95', ['495503.59N 0145603.54E','494742.36N 0150222.25E',CW(35),'493854.18N 0145037.98E','493958.46N 0142826.56E','494415.01N 0141752.64E','494305.72N 0144122.39E',CCW(28),'495109.96N 0145257.92E',CCW(28)]),
 'TMA VIII': ('2000 ft', '3500 ft', ['501846.06N 0142007.04E','501404.96N 0143408.27E','501313.39N 0144155.71E','501133.35N 0144117.44E','500916.15N 0143343.10E','501013.99N 0143300.66E','501032.03N 0143247.42E','501322.33N 0141452.39E','501712.44N 0141620.48E']),
 'TMA IX': ('FL95', 'FL165', ['503548.47N 0134759.46E','503628.26N 0144203.35E',CW(35),'495454.10N 0150731.76E',CW(35),'495112.52N 0150515.77E','494720.15N 0151423.01E',CW(42),'493035.74N 0145122.83E','493447.95N 0144108.45E',CW(35),'493216.69N 0143139.01E',CW(35),'493709.15N 0134446.01E','493100.59N 0132448.73E',CW(48),'501025.68N 0130139.70E','501054.53N 0132206.38E',CW(35)]),
}
CTR = ['501402.98N 0141032.84E','501322.33N 0141452.39E','501032.03N 0143247.42E','500916.15N 0143343.10E','500653.26N 0142552.39E','500428.41N 0142549.81E','500310.23N 0142830.47E',CW(8.5),'495933.96N 0142458.76E','500006.17N 0142055.49E',CW(6.5),'500142.19N 0140801.96E','500038.81N 0140425.41E',CW(9),'500450.13N 0140201.36E','500637.44N 0140757.06E','500902.68N 0140254.89E',CW(9)]

# AIP ENR 4.4 (current) coordinates
AIP_FIX = {
 'AKEVA':'495717.56N 0140237.59E','APRAQ':'493854.00N 0140721.00E','ARTUP':'504106.85N 0145418.37E','ARVEG':'495956.37N 0144102.25E',
 'BAGRU':'502554.62N 0142013.53E','BALTU':'500522.06N 0131935.48E','BAROX':'495654.77N 0134315.06E','DOBEN':'494624.02N 0133341.55E',
 'DONAD':'500450.93N 0130000.00E','ERASU':'501607.51N 0142841.31E','EVEMI':'501638.86N 0140633.88E','GOLOP':'503508.74N 0142944.63E',
 'KENOK':'495126.01N 0144534.00E','KUVIX':'500619.91N 0135601.47E','LOMKI':'495433.61N 0131428.40E','RATEV':'500703.32N 0143512.65E',
 'SOMIS':'500838.56N 0135715.18E','UTORO':'501635.91N 0143304.17E','VENOX':'503317.95N 0140802.37E','ELPON':'495530.04N 0143702.29E',
 'ELMEK':'495414.04N 0140147.55E','BEKVI':'500424.08N 0144320.49E','BULEK':'502447.66N 0150355.10E','LEMBI':'503302.86N 0145252.61E',
 'LAGAR':'504742.99N 0152201.52E','SULOV':'501744.26N 0143405.85E','RAPET':'501125.76N 0122019.10E','VARIK':'501728.00N 0122252.00E',
 'KILNU':'502836.68N 0125441.97E','ENITA':'494207.69N 0122825.99E','NIRGO':'491951.40N 0130755.99E','PEPIK':'484658N 0170445E',
 'LIKSA':'490909.96N 0160053.13E','PISAM':'485334.4871N 0152313.6576E','KOZLI':'500334N 0152113E','RAVKU':'504600.53N 0142543.87E',
 'KONAR':'502642.50N 0130356.08E','DITIS':'485352.8840N 0150658.8955E',
}
CLS = {}
for n in ['AKEVA','ARVEG','BAROX','ERASU','EVEMI','KENOK','KUVIX','RATEV','SOMIS']: CLS[n] = 'iaf'
for n in ['GOLOP','LOMKI','APRAQ','BAGRU']: CLS[n] = 'star'
for n in ['ARTUP','VENOX','BALTU','DOBEN','UTORO']: CLS[n] = 'sid'

fixes = {}
for n, s in AIP_FIX.items():
    la, lo = pt(s); fixes[n] = [round(la,6), round(lo,6), CLS.get(n, 'fix')]
# Additional fixes from X-Plane fix.dat 2013 (GPL) within Czech area
extra = {}
for line in open('/tmp/fix.dat', encoding='latin-1'):
    p = line.split()
    if len(p) != 3 or len(p[2]) != 5 or not p[2].isalpha(): continue
    try: la, lo = float(p[0]), float(p[1])
    except: continue
    if 48.5 < la < 51.1 and 12.0 < lo < 18.9:
        extra[p[2]] = (la, lo)
WANT = 'ODOMO TIVDA RUDAP DOLUP BAVRI BEPAS UPEGU LUPEV VAKLA BUDEX LANUX LOKVO NAVTI MIKOV LEDVA TABEN NELPA BODAL TUMKA ELVOT ENORU DIVUK TIBLA OMIFU RASAN BEFRE DEKOV OMELO LALUK MAREM ASTEL TOMTI VEXIL AGNAV VESUB ODNEM'.split()
for n in WANT:
    if n in extra and n not in fixes:
        fixes[n] = [round(extra[n][0],6), round(extra[n][1],6), 'fix']

navaids = {
 'OKL': [round(OKL[0],6), round(OKL[1],6), 'VOR/DME', '112.60', 'PRAHA'],
 'VLM': [49.704272, 15.066742, 'VOR/DME', '114.30', 'VLASIM'],
 'VOZ': [49.532328, 14.874664, 'VOR/DME', '116.30', 'VOZICE'],
 'NER': [50.366558, 14.621364, 'VOR/DME', '108.60', 'NERATOVICE'],
 'OKX': [50.902681, 15.031900, 'VOR/DME', '114.85', 'FRYDLANT'],
 'OKG': [50.065147, 12.405739, 'VOR/DME', '115.70', 'CHEB'],
 'OKF': [48.969175, 15.545578, 'VOR/DME', '113.15', 'DESNA'],
 'BNO': [49.150064, 16.692581, 'VOR/DME', '113.90', 'BRNO'],
 'HDO': [50.928150, 14.368800, 'VOR/DME', '115.00', 'HERMSDORF'],
 'RAK': [50.097058, 13.690717, 'NDB', '386', 'RAKOVNIK'],
}

# Runways (AIP AD 2.12) + ILS (X-Plane 2013 navdata, LOC freq/ident)
RW = [
 ('06', '500606.61N 0141334.68E', 65.0, 60, 1202, ('111.15','PH','CAT I')),
 ('24', '500657.42N 0141624.12E', 245.0, 240, 1158, ('109.10','PR','CAT III')),
 ('12', '500628.84N 0141443.32E', 127.0, 122, 1160, ('109.95','PA','CAT I')),
 ('30', '500525.68N 0141654.02E', 307.0, 302, 1232, ('109.50','PG','CAT I')),
]
rwys = []
thr = {r[0]: pt(r[1]) for r in RW}
opp = {'06':'24','24':'06','12':'30','30':'12'}
for rid, c, tb, mb, el, ils in RW:
    la, lo = thr[rid]; ola, olo = thr[opp[rid]]
    x1,y1 = to_nm(la,lo); x2,y2 = to_nm(ola,olo)
    brg = math.degrees(math.atan2(x2-x1, y2-y1)) % 360
    length_m = math.hypot(x2-x1, y2-y1)*1852
    rwys.append({'id':rid,'thr':[round(la,7),round(lo,7)],'end':[round(ola,7),round(olo,7)],'trueHdg':round(brg,2),'magHdg':mb,'elev':el,
                 'len':round(length_m),'width':45,'ils':{'f':ils[0],'id':ils[1],'cat':ils[2],'gs':3.0}})

# Natural Earth: Czechia border
def dp(points, eps):
    if len(points) < 3: return points
    def perp(p, a, b):
        (x,y),(x1,y1),(x2,y2) = p,a,b
        dx,dy = x2-x1, y2-y1
        if dx == dy == 0: return math.hypot(x-x1, y-y1)
        t = max(0,min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy)))
        return math.hypot(x-(x1+t*dx), y-(y1+t*dy))
    keep = [False]*len(points); keep[0]=keep[-1]=True; stack=[(0,len(points)-1)]
    while stack:
        i,j = stack.pop(); dmax=0; idx=None
        for k in range(i+1,j):
            d = perp(points[k], points[i], points[j])
            if d > dmax: dmax, idx = d, k
        if idx is not None and dmax > eps:
            keep[idx] = True; stack += [(i,idx),(idx,j)]
    return [p for p,k in zip(points,keep) if k]

ne = json.load(open(f'{WORK}/data_src/ne/geojson/ne_10m_admin_0_countries.geojson'))
border = []
for f in ne['features']:
    if f['properties'].get('ADM0_A3') == 'CZE':
        ring = f['geometry']['coordinates'][0]
        nm = [to_nm(la, lo) for lo, la in ring]
        simp = dp(nm, 0.15)
        border = [[round(from_nm(x,y)[0],5), round(from_nm(x,y)[1],5)] for x,y in simp]

rivers = {}
rv = json.load(open(f'{WORK}/data_src/ne/geojson/ne_10m_rivers_lake_centerlines.geojson'))
for f in rv['features']:
    n = f['properties'].get('name')
    if n in ('Vltava','Elbe'):
        g = f['geometry']; lines = g['coordinates'] if g['type']=='MultiLineString' else [g['coordinates']]
        for ln in lines:
            pts = [(la,lo) for lo,la in ln if 49.3 < la < 50.9 and 13.6 < lo < 15.3]
            if len(pts) > 2:
                nm = [to_nm(la,lo) for la,lo in pts]; simp = dp(nm, 0.05)
                rivers.setdefault('Labe' if n=='Elbe' else n, []).append([[round(from_nm(x,y)[0],5), round(from_nm(x,y)[1],5)] for x,y in simp])

places = []
pp = json.load(open(f'{WORK}/data_src/ne/geojson/ne_10m_populated_places_simple.geojson'))
for f in pp['features']:
    pr = f['properties']
    if pr.get('adm0_a3') == 'CZE' or pr.get('sov_a3') == 'CZE':
        lo, la = f['geometry']['coordinates']
        if 49.4 < la < 50.8 and 13.4 < lo < 15.2:
            places.append({'n': pr.get('name'), 'lat': round(la,5), 'lon': round(lo,5), 'r': pr.get('scalerank')})

# Ground layout from X-Plane 2013 apt.dat (GPL, Robin A. Peel)
def bez_seg(A, B, cA, cB, n=6):
    pts=[]
    if cA is None and cB is None: return [B]
    P0, P3 = A, B
    if cA is not None and cB is not None:
        P1 = cA; P2 = (2*B[0]-cB[0], 2*B[1]-cB[1])
        for i in range(1,n+1):
            t=i/n; u=1-t
            pts.append((u**3*P0[0]+3*u*u*t*P1[0]+3*u*t*t*P2[0]+t**3*P3[0], u**3*P0[1]+3*u*u*t*P1[1]+3*u*t*t*P2[1]+t**3*P3[1]))
    else:
        C = cA if cA is not None else (2*B[0]-cB[0], 2*B[1]-cB[1])
        for i in range(1,n+1):
            t=i/n; u=1-t
            pts.append((u*u*P0[0]+2*u*t*C[0]+t*t*P3[0], u*u*P0[1]+2*u*t*C[1]+t*t*P3[1]))
    return pts

lines = open(f'{WORK}/data_src/LKPR_apt.dat').read().split('\n')
pave = []; feats = []; cur = None; ring = []
def flush_ring(closed):
    global ring
    if not ring: return
    out = [ring[0][0]]
    seq = ring + ([ring[0]] if closed else [])
    for i in range(len(seq)-1):
        A, cA = seq[i]; B, cB = seq[i+1]
        out += bez_seg(A, B, cA, cB)
    if cur is not None: cur['rings'].append(out)
    ring = []
for l in lines:
    p = l.split()
    if not p: continue
    code = p[0]
    if code in ('110','120','130'):
        cur = {'type':code, 'name':' '.join(p[4:]) if code=='110' else ' '.join(p[1:]), 'rings':[]}
        feats.append(cur); ring = []; continue
    if code in ('111','112','113','114','115','116') and cur is not None:
        la, lo = float(p[1]), float(p[2])
        c = (float(p[3]), float(p[4])) if code in ('112','114','116') else None
        ring.append(((la,lo), c))
        if code in ('113','114'): flush_ring(True)
        elif code in ('115','116'): flush_ring(False)
pave = [[[[round(a,6),round(b,6)] for a,b in r] for r in f['rings']] for f in feats if f['type']=='110']
twy = []; hps = []
for f in feats:
    if f['type'] != '120' or not f['rings']: continue
    n = f['name']
    pts = [[round(a,6),round(b,6)] for a,b in f['rings'][0]]
    if n.startswith('HP'): hps.append({'n': n, 'p': pts})
    elif n.startswith('Line') and not n.startswith('Linie'):
        nm = n.replace('Line ','').replace(' lighted','')
        twy.append({'n': nm, 'p': pts})
stands = []
for f in feats:
    if f['type']=='120' and f['name'].startswith('Linie ') and f['rings']:
        nm = f['name'][6:].strip()
        if nm and len(nm) <= 4:
            a = f['rings'][0][-1]; stands.append({'n': nm, 'lat': round(a[0],6), 'lon': round(a[1],6)})
gates = []
for l in lines:
    p = l.split()
    if p and p[0] == '15':
        gates.append({'n': ' '.join(p[4:]), 'lat': float(p[1]), 'lon': float(p[2]), 'hdg': float(p[3])})

data = {
 'ref': {'lat': LAT0, 'lon': LON0}, 'magVar': 5, 'elev': 1234, 'ta': 5000, 'okl': [round(OKL[0],6), round(OKL[1],6)],
 'rwys': rwys, 'fixes': fixes, 'navaids': navaids,
 'ctr': [[round(a,6),round(b,6)] for a,b in build_poly(CTR)],
 'tma': [{'n': n, 'lo': lo, 'hi': hi, 'p': [[round(a,6),round(b,6)] for a,b in build_poly(spec)]} for n,(lo,hi,spec) in TMA.items()],
 'border': border, 'rivers': rivers, 'places': places,
 'ground': {'pave': pave, 'twy': twy, 'hp': hps, 'stands': stands, 'gates': gates, 'tower': [50.106422, 14.265704, 47]},
 'freq': {'ATIS':'122.160','DEL':'120.060','GND':'121.910','TWR':'134.560','APP':'127.580','APP2':'120.530','RADAR':'119.010','INFO':'118.310'},
 'sources': 'AIP CR (ENR 2.1, ENR 4.4, AD 2 LKPR, AIRAC 2026); X-Plane navdata 2013 (GPL, R. A. Peel); Natural Earth (public domain)'
}
js = 'window.LKPR=' + json.dumps(data, separators=(',',':'), ensure_ascii=False) + ';\n'
open(f'{ROOT}/src/data.js','w').write(js)
print('data.js', len(js)//1024, 'KB', 'fixes', len(fixes), 'border', len(border), 'pave rings', sum(len(x) for x in pave), 'pave pts', sum(len(r) for x in pave for r in x), 'twy', len(twy), 'stands', len(stands), 'rivers', {k:len(v) for k,v in rivers.items()}, 'places', len(places))
for t in data['tma']: print(t['n'], len(t['p']))
print('ctr', len(data['ctr']))
for r in rwys: print(r['id'], r['trueHdg'], r['len'])
