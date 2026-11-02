import os as _os, pathlib as _pl
ROOT = _pl.Path(__file__).resolve().parents[1]
WORK = _pl.Path(_os.environ.get('ATC_WORK', ROOT / '.work'))
import asyncio, json, re, sys, threading, functools, http.server
from playwright.async_api import async_playwright
MODELS = WORK / 'models'  # pinned Whisper files fetched by tools/asr_eval/browser.js; the ASR end-to-end check needs tiny.en


def serve_docs():
    """Serve docs/ over HTTP on a free port (the app fetches voices/*.json, which file:// cannot)."""
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT / 'docs')))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{srv.server_port}/index.html'


URL = serve_docs()
(WORK / 'shots').mkdir(parents=True, exist_ok=True)
FAIL = []
def check(name, cond, info=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''))
    if not cond: FAIL.append(name)

async def drain(page):
    # radio is real-time: keep stepping until every queued readback has been transmitted
    for _ in range(200):
        busy = await page.evaluate("(() => { for (let i=0;i<10;i++){ App.sim.step(0.1); App.comms.tick(); } return App.comms.speaking || App.comms.queue.some(q => q.due <= App.sim.t + 5); })()")
        if not busy: return
        await page.wait_for_timeout(100)

MODEL_JS = r'''() => {
  const out = {};
  // A: ILS capture and landing on RWY 24
  { const s = new Sim({sweep: 1}); const R = RWY['24'];
    const back = Geo.norm360(R.crs + 180); let p = Geo.move(R, back, 14); const nrm = Geo.norm360(R.crs + 90); p = Geo.move(p, nrm, 3);
    const a = s.add({cs:'TST1', type:'A320', kind:'arr', x:p.x, y:p.y, alt:4000, cfl:4000, hdg:0, ias:200});
    const g = a.locGeom('24'); a.hdg = Geo.norm360(R.crs + (g.e > 0 ? -30 : 30)); a.tgtHdg = a.hdg; a.mode = 'hdg';
    a.command({type:'ils', rwy:'24'}, s);
    let tl=null, tg=null, t=0, maxE=0; const e0 = g.e;
    for (; t < 900 && !a.done; t += 0.1) { s.step(0.1); if (a.locCap && tl===null) tl=t; if (a.gsCap && tg===null) tg=t; if (a.locCap) maxE=Math.max(maxE, Math.abs(a.locGeom('24').e)); }
    out.ils = {e0, tl, tg, landed: a.done, t: Math.round(t), maxE, finalIas: Math.round(a.ias)}; }
  // B: forced turn direction
  { const s = new Sim(); const a = s.add({cs:'TST2', type:'A320', x:0, y:0, alt:8000, hdg:toTrue(90), ias:220});
    a.command({type:'hdg', val:270, dir:1}, s); for (let i=0;i<100;i++) s.step(0.1); const h1 = toMag(a.hdg);
    const b = s.add({cs:'TST3', type:'A320', x:5, y:0, alt:8000, hdg:toTrue(90), ias:220});
    b.command({type:'hdg', val:270, dir:-1}, s); for (let i=0;i<100;i++) s.step(0.1); const h2 = toMag(b.hdg);
    for (let i=0;i<1500;i++) s.step(0.1);
    out.turn = {rightAfter10s: Math.round(h1), leftAfter10s: Math.round(h2), finalA: Math.round(toMag(a.hdg)), finalB: Math.round(toMag(b.hdg))}; }
  // C: descent and speed
  { const s = new Sim(); const a = s.add({cs:'TST4', type:'B38M', x:0, y:20, alt:10000, hdg:180, ias:250});
    a.command({type:'alt', val:6000}, s); a.command({type:'spd', val:200}, s);
    let tReach = null; for (let t=0; t<400; t+=0.1) { s.step(0.1); if (tReach===null && Math.abs(a.alt-6000)<1) tReach = t; }
    out.desc = {tReach: tReach && Math.round(tReach), alt: Math.round(a.alt), ias: Math.round(a.ias)}; }
  // D: direct to fix
  { const s = new Sim(); const f = FIX['ERASU']; const a = s.add({cs:'TST5', type:'A320', x:f.x-20, y:f.y-10, alt:9000, hdg:0, ias:250});
    a.command({type:'dct', fix:'ERASU'}, s); let dmin = 99; for (let t=0;t<600;t+=0.1){ s.step(0.1); dmin = Math.min(dmin, Math.hypot(a.x-f.x, a.y-f.y)); }
    out.dct = {dmin: +dmin.toFixed(2), mode: a.mode}; }
  // E: STCA
  { const s = new Sim(); spawnConflict(s); let tS = null; for (let t=0;t<120;t+=0.1){ s.step(0.1); if (tS===null && s.ac.some(a=>a.stca)) tS=t; }
    out.stca = {t: tS && Math.round(tS)}; }
  // F: demo world has no STCA at start
  { const s = new Sim(); demoTraffic(s); let n=0; for (let t=0;t<60;t+=0.1){ s.step(0.1); if (s.ac.some(a=>a.stca)) n++; } out.demoStca = n; }
  return out;
}'''

PARSE_JS = r'''() => {
  const s = new Sim(); demoTraffic(s);
  const cases = [
    ['35J L270', 'TVS35J', 'hdg:270:-1'],
    ['TVS35J F80 S180', 'TVS35J', 'alt:8000,spd:180'],
    ['AFR1083 D ERASU', 'AFR1083', 'dct:ERASU'],
    ['KLM1355 AS', 'KLM1355', 'assume'],
    ['RYR8YD I24', 'RYR8YD', 'ils:24'],
    ['Skytravel three five Juliett, turn left heading two seven zero, descend flight level eight zero', 'TVS35J', 'hdg:270:-1,alt:8000'],
    ['Sky travel 35 Juliet turn right heading 090', 'TVS35J', 'hdg:90:1'],
    ['Air France one zero eight three, descend flight level eight zero', 'AFR1083', 'alt:8000'],
    ['Ryanair eight Yankee Delta, reduce speed one eight zero knots', 'RYR8YD', 'spd:180'],
    ['KLM one three five five, proceed direct Erasu', 'KLM1355', 'dct:ERASU'],
    ['Emirates one three niner, cleared ILS approach runway two four', 'UAE139', 'ils:24'],
    ['Emirates 139 descend to altitude 4000 feet', 'UAE139', 'alt:4000'],
    ['Lufthansa one three nine five, climb flight level one two zero', 'DLH1395', 'alt:12000'],
    ['Wizz Air two two one niner contact Praha control', 'WZZ2219', 'xfer:ACC'],
    ['Skytravel 35J contact tower', 'TVS35J', 'xfer:TWR'],
    ['skytravel three five juliet descend altitude three thousand five hundred feet', 'TVS35J', 'alt:3500'],
  ];
  return cases.map(([txt, cs, exp]) => { const r = Parser.parse(txt, s.ac); const got = r.cmds.map(c => c.type + (c.val!==undefined && c.val!==null ? ':' + c.val : '') + (c.dir ? ':' + c.dir : '') + (c.fix ? ':' + c.fix : '') + (c.rwy ? ':' + c.rwy : '') + (c.to ? ':' + c.to : '')).join(','); return {txt, wantCs: cs, gotCs: r.ac && r.ac.cs, exp, got, err: r.error || null}; });
}'''

async def main():
    async with async_playwright() as p:
        # fake microphone (a beep) so push-to-talk capture runs headless; permission granted without a prompt
        b = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        ctx = await b.new_context(viewport={'width': 1194, 'height': 834}, device_scale_factor=2, has_touch=True, permissions=['microphone'])
        async def hf_route(route):  # model downloads from the hub are served from .work/models (no network in tests)
            m = re.match(r'^https://huggingface\.co/(.+?)/resolve/([^/]+)/([^?]+)', route.request.url)
            f = MODELS / m.group(1) / m.group(3) if m else None
            if f and f.exists(): await route.fulfill(status=200, path=str(f), headers={'access-control-allow-origin': '*'})
            else: await route.fulfill(status=404, body='not found')
        await ctx.route('https://huggingface.co/**', hf_route)
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'Failed to load resource' not in m.text else None)
        await page.goto(URL); await page.wait_for_timeout(1500)
        m = await page.evaluate(MODEL_JS); print(json.dumps(m))
        check('ILS: localizer captured', m['ils']['tl'] is not None, m['ils'])
        check('ILS: glideslope captured', m['ils']['tg'] is not None)
        check('ILS: landed', m['ils']['landed'] == 'landed')
        check('ILS: overshoot < 0.6 NM', m['ils']['maxE'] < 0.6, m['ils']['maxE'])
        check('Turn right goes through 1xx', 100 < m['turn']['rightAfter10s'] < 140, m['turn'])
        check('Turn left goes through 0xx/3xx', m['turn']['leftAfter10s'] < 80 or m['turn']['leftAfter10s'] > 350, m['turn'])
        check('Turns end on 270', abs(m['turn']['finalA'] - 270) <= 1 and abs(m['turn']['finalB'] - 270) <= 1, m['turn'])
        check('Descent reaches 6000', m['desc']['alt'] == 6000 and m['desc']['tReach'] is not None and m['desc']['tReach'] < 200, m['desc'])
        check('Speed 200', abs(m['desc']['ias'] - 200) <= 1, m['desc'])
        check('Direct to ERASU passes within 1 NM', m['dct']['dmin'] < 1.0, m['dct'])
        check('STCA fires within 60 s', m['stca']['t'] is not None and m['stca']['t'] < 60, m['stca'])
        check('Demo traffic: no STCA in first minute', m['demoStca'] == 0, m['demoStca'])
        pr = await page.evaluate(PARSE_JS)
        for c in pr:
            check(f"Parse '{c['txt'][:48]}'", c['gotCs'] == c['wantCs'] and c['got'] == c['exp'], f"cs={c['gotCs']} got={c['got']} exp={c['exp']} err={c['err']}")
        await page.evaluate('App.fastRadio = true')
        # ---------- UI: tap label opens menu, issue level ----------
        await page.evaluate("App.show('radar')"); await page.wait_for_timeout(400)
        box = await page.evaluate("(() => { const r = App.radars[0]; const h = r.hits.find(h => h.kind==='label' && h.ac.cs==='TVS35J'); const b = r.canvas.getBoundingClientRect(); return h ? {x: b.left + h.x + 10, y: b.top + h.y + 6} : null; })()")
        check('Label hit box exists', box is not None, box)
        if box:
            await page.touchscreen.tap(box['x'], box['y']); await page.wait_for_timeout(300)
            vis = await page.evaluate("getComputedStyle(document.querySelector('.cmd-menu')).display")
            check('Tap on label opens command menu', vis == 'grid', vis)
            menuTxt = await page.evaluate("document.querySelector('.cmd-menu').textContent")
            import re as _re
            check('Command menu is English (no Czech letters)', not _re.search('[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]', menuTxt), menuTxt[:80])
            await page.get_by_role('button', name='CFL').first.click(); await page.wait_for_timeout(100)
            await page.get_by_role('button', name='FL080').first.click(); await page.wait_for_timeout(100)
            await page.evaluate("for (let i=0;i<40;i++){ App.sim.step(0.1); App.comms.tick(); }")
            st = await page.evaluate("(() => { const a = App.sim.find('TVS35J'); return {tgt: a.tgtAlt, log: App.comms.entries.slice(-3).map(e=>e.who+': '+e.text)}; })()")
            check('Menu FL080 executed after readback', st['tgt'] == 8000, st)
            # heading dial tap: right side of dial = 090
            dial = await page.evaluate("(() => { const t=[...document.querySelectorAll('.cmd-tabs button')].find(b=>b.textContent==='HDG'); t.click(); return true; })()")
            await page.wait_for_timeout(150)
            dbox = await page.evaluate("(() => { const c = document.querySelector('.dial-wrap canvas'); const r = c.getBoundingClientRect(); return {x: r.left + r.width*0.92, y: r.top + r.height/2}; })()")
            await page.mouse.move(dbox['x'], dbox['y']); await page.mouse.down(); await page.mouse.up(); await page.wait_for_timeout(100)
            await page.evaluate("for (let i=0;i<40;i++){ App.sim.step(0.1); App.comms.tick(); }")
            st = await page.evaluate("(() => { const a = App.sim.find('TVS35J'); return {mode: a.mode, tgt: Math.round(toMag(a.tgtHdg))}; })()")
            check('Dial tap issues heading ~090', st['mode'] == 'hdg' and abs(st['tgt'] - 90) <= 10, st)
        # drag a label with the mouse
        lb = await page.evaluate("(() => { const r = App.radars[0]; r.select(null); const h = r.hits.find(h => h.kind==='label' && h.ac.cs==='RYR8YD'); const b = r.canvas.getBoundingClientRect(); return h ? {x: b.left + h.x + 8, y: b.top + h.y + 6, off: {...h.ac.labelOff}} : null; })()")
        if lb:
            await page.mouse.move(lb['x'], lb['y']); await page.mouse.down(); await page.mouse.move(lb['x'] + 40, lb['y'] + 30, steps=6); await page.mouse.up()
            off = await page.evaluate("({...App.sim.find('RYR8YD').labelOff})")
            check('Mouse drag moves label', abs(off['dx'] - lb['off']['dx'] - 40) < 4, (lb['off'], off))
        sc0 = await page.evaluate("App.radars[0].scale"); await page.mouse.move(600, 400); await page.mouse.wheel(0, -300); await page.wait_for_timeout(100)
        sc1 = await page.evaluate("App.radars[0].scale"); check('Wheel zooms in', sc1 > sc0, (sc0, sc1))
        # keyboard: type with nothing focused -> command line gets focus
        await page.evaluate("document.activeElement && document.activeElement.blur()")
        await page.keyboard.type('35J L200'); await page.keyboard.press('Enter'); await page.wait_for_timeout(100)
        await page.evaluate("for (let i=0;i<40;i++){ App.sim.step(0.1); App.comms.tick(); }")
        st = await page.evaluate("(() => { const a = App.sim.find('TVS35J'); return {tgt: Math.round(toMag(a.tgtHdg)), dir: a.turnDir, f: App.features.autoFocus && App.features.autoFocus.n}; })()")
        check('Keyboard auto-focus + shorthand executes', st['tgt'] == 200 and st['f'], st)
        await page.screenshot(path=f'{WORK}/shots/02_radar_after.png')
        # ---------- all tests mount without error ----------
        ids = await page.evaluate("TESTS.map(t=>t.id)")
        for i, tid in enumerate(ids):
            await page.evaluate(f"App.show('{tid}')"); await page.wait_for_timeout(500)
            await page.screenshot(path=f'{WORK}/shots/t{i+1:02d}_{tid}.png')
            bad = await page.evaluate(f"!!document.querySelector('.view.active p[style*=\"ff5c57\"]')")
            check(f'Test view mounts: {tid}', not bad)

        # ---------- audio unlock by a real click ----------
        ab = await page.evaluate("(() => { const r = App.audioBtn.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()")
        await page.mouse.click(ab['x'], ab['y']); await page.wait_for_timeout(400)
        au = await page.evaluate("({st: Sound.status(), ctx: Sound.ctx && Sound.ctx.state, media: Sound.diag.media, session: Sound.diag.session})")
        check('Sound unlocks on click (context running)', au['ctx'] == 'running', au)
        await page.evaluate("Sound.ctx.suspend()"); await page.wait_for_timeout(200)
        st1 = await page.evaluate("Sound.status()")
        await page.mouse.click(600, 300); await page.wait_for_timeout(300)
        st2 = await page.evaluate("Sound.status()")
        check('Suspended audio resumes on next gesture', st1 == 'paused' and st2 == 'on', (st1, st2))
        # ---------- window view in all conditions ----------
        await page.evaluate("App.show('ground')"); await page.wait_for_timeout(300)
        wr = await page.evaluate("""(() => { const T = TESTS.find(t => t.id === 'ground'); const wv = T.wv; const out = {}; for (const tod of ['day', 'dusk', 'night']) for (const vis of [30000, 1500, 300]) { wv.tod = tod; wv.vis = vis; const t0 = performance.now(); for (let i = 0; i < 5; i++) wv.draw(performance.now()); out[tod + vis] = Math.round((performance.now() - t0) / 5 * 10) / 10; } wv.tod = 'day'; wv.vis = 30000; return out; })()""")
        check('Window view renders in day/dusk/night and fog', all(v < 60 for v in wr.values()), wr)
        seq = await page.evaluate("(() => { const T = TESTS.find(t => t.id === 'ground'); const h = T.gv.hits.find(h => h.seq); if (!h) return null; const b = T.gv.canvas.getBoundingClientRect(); return {x: b.left + h.x + 30, y: b.top + h.y, cs: h.it.cs}; })()")
        if seq:
            await page.mouse.click(seq['x'], seq['y']); await page.wait_for_timeout(200)
            sel = await page.evaluate("(() => { const T = TESTS.find(t => t.id === 'ground'); return T.gv.sel && T.gv.sel.cs; })()")
            check('Sequence list row selects target', sel == seq['cs'], (seq['cs'], sel))
        else: check('Sequence list has rows', False)
        inst = await page.evaluate("(() => { const i = document.querySelector('#checks .instr'); return !!i && i.getBoundingClientRect().bottom < innerHeight; })()")
        check('Instructor controls visible without scrolling', inst)
        # ---------- ground RIMCAS ----------
        await page.evaluate("App.show('ground')")
        r = await page.evaluate("""(() => { App.gt.spawnBird(); const seen = new Set(); let ga = false; for (let t=0; t<90; t+=0.1) { App.gt.step(0.1); for (const a of App.gt.alerts) seen.add(a.stage); const e = App.gt.items.find(i=>i.cs==='EZS98KH'); if (e && e.phase==='ga') ga = true; } return {stages: [...seen], ga}; })()""")
        check('RIMCAS stage 1 and 2', 1 in r['stages'] and 2 in r['stages'], r)
        check('Arrival goes around', r['ga'], r)
        await page.wait_for_timeout(300); await page.screenshot(path=f'{WORK}/shots/03_ground.png')
        # ---------- strips drag with mouse ----------
        await page.evaluate("App.show('strips')"); await page.wait_for_timeout(300)
        src = await page.evaluate("(() => { const s=[...document.querySelectorAll('.strip')].find(e=>e.textContent.includes('RYR5TR')); const r=s.getBoundingClientRect(); const g=document.querySelector('[data-col=gnd]').getBoundingClientRect(); return {x:r.left+60,y:r.top+20,tx:g.left+60,ty:g.top+200}; })()")
        await page.mouse.move(src['x'], src['y']); await page.mouse.down(); await page.mouse.move(src['tx'], src['ty'], steps=10); await page.mouse.up(); await page.wait_for_timeout(200)
        col = await page.evaluate("(() => { const s=[...document.querySelectorAll('.strip')].find(e=>e.textContent.includes('RYR5TR')); return s.parentElement.getAttribute('data-col'); })()")
        check('Strip moved to GROUND with mouse', col == 'gnd', col)
        # ---------- voice control: parser + radio policy (no speech recognition needed) ----------
        await page.evaluate("App.show('voice')"); await page.wait_for_timeout(300)
        VOICE_JS = '''(txt) => { const n0 = App.comms.entries.length; Voice.handle({ text: txt, wall: 1 }, Voice.onFreq(), 2.0);
          for (let i = 0; i < 40; i++) { App.sim.step(0.1); App.comms.tick(); }
          return { outcome: Voice.last.outcome, log: App.comms.entries.slice(n0).map(e => e.who + ': ' + e.text + (e.note ? ' ' + e.note : '')) }; }'''
        r = await page.evaluate(VOICE_JS, 'Skytravel three five Juliett, turn left heading two seven zero, descend flight level eight zero')
        st = await page.evaluate("(() => { const a = App.sim.find('TVS35J'); return {hdg: Math.round(toMag(a.tgtHdg)), alt: a.tgtAlt}; })()")
        check('Voice: instruction executed after readback', r['outcome'] == 'TVS35J L270 FL080' and st == {'hdg': 270, 'alt': 8000} and any(l.startswith('plt:') for l in r['log']), (r, st))
        r = await page.evaluate(VOICE_JS, 'Skytravel three five Juliett, banana split please')
        check('Voice: unclear instruction -> pilot says again', r['outcome'] == 'TVS35J SAY AGAIN' and any('say again, Skytravel 35J' in l for l in r['log']), r)
        await page.evaluate("App.sim.add({cs: 'TVS35K', type: 'A320', kind: 'arr', x: 5, y: 20, alt: 9000, hdg: 180, ias: 250, ctl: 'own'})")
        r = await page.evaluate(VOICE_JS, 'Skytravel three five, descend flight level seven zero')
        check('Voice: ambiguous callsign -> say again', 'CALLSIGN' in r['outcome'] and any(l == 'plt: Praha Radar, say again' for l in r['log']), r)
        await page.evaluate("App.sim.ac = App.sim.ac.filter(a => a.cs !== 'TVS35K')")
        r = await page.evaluate(VOICE_JS, 'descend flight level seven zero, reduce speed two two zero knots')
        check('Voice: no callsign -> say again', r['outcome'] == 'CALLSIGN ?' and any('say again' in l for l in r['log']), r)
        r = await page.evaluate(VOICE_JS, '')
        check('Voice: empty transcript is ignored', r['outcome'] == 'NO SPEECH' and not r['log'], r)
        # ---------- push-to-talk: Space holds the frequency, fake microphone is captured, P pauses ----------
        await page.evaluate("ASR.setPref('model', 'tiny.en'); ASR.setPref('device', 'wasm')")
        await page.mouse.click(400, 300); b0 = await page.evaluate("Mic.diag.blocks"); await page.keyboard.down('Space'); await page.wait_for_timeout(400)
        # a pilot call that falls due while the controller transmits must wait (the frame loop keeps ticking meanwhile)
        await page.evaluate("window.__n0 = App.comms.entries.length; App.comms.pilot(App.sim.ac[0], 'test call, frequency was busy', 'test call', 0)"); await page.wait_for_timeout(500)
        held = await page.evaluate("(() => { for (let i = 0; i < 5; i++) { App.sim.step(0.1); App.comms.tick(); } return {phase: Voice.phase, atcTx: App.comms.atcTx, logged: App.comms.entries.slice(window.__n0).map(e => e.text), paused: App.paused}; })()")
        await page.keyboard.up('Space'); await page.wait_for_timeout(300)
        after = await page.evaluate("(() => { for (let i = 0; i < 5; i++) { App.sim.step(0.1); App.comms.tick(); } return {atcTx: App.comms.atcTx, blocks: Mic.diag.blocks, rate: Mic.diag.rate, open: Mic.open, tx: Voice.stats.tx, calls: App.comms.entries.slice(window.__n0).map(e => e.text)}; })()")
        after['sec'] = round((after['blocks'] - b0) * 2048 / max(1, after['rate']), 2)  # headless audio timing is unreliable under load: only require some audio
        check('PTT (Space) transmits and holds the frequency', held['phase'] == 'tx' and held['atcTx'] and not held['logged'] and not held['paused'], held)
        check('PTT release frees the frequency, microphone captured and closed', not after['atcTx'] and after['sec'] > 0 and not after['open'] and after['tx'] >= 1 and any(c.startswith('test call') for c in after['calls']), after)
        await page.evaluate("App.comms.speaking = true"); await page.keyboard.down('Space'); await page.wait_for_timeout(500); await page.keyboard.up('Space'); await page.wait_for_timeout(300)
        bl = await page.evaluate("(() => { App.comms.speaking = false; return {blocked: Voice.stats.blocked, last: App.comms.entries.slice(-1)[0].text}; })()")
        check('PTT over a pilot transmission is blocked', bl['blocked'] == 1 and bl['last'].startswith('BLOCKED'), bl)
        p0 = await page.evaluate("App.paused"); await page.keyboard.press('p'); p1 = await page.evaluate("App.paused"); await page.keyboard.press('p')
        check('Key P toggles pause (Space is PTT)', p0 is False and p1 is True, (p0, p1))
        # ---------- speech recognition end to end: voice pack -> Whisper tiny.en (WASM) -> parser -> readback ----------
        if (MODELS / 'onnx-community/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx').exists():
            sr = await page.evaluate("(async () => { try { await ASR.load(); const r = await Voice.selfTest('AFR1083'); for (let i = 0; i < 40; i++) { App.sim.step(0.1); App.comms.tick(); } return {...r, dev: ASR.device, err: null}; } catch (e) { return {err: e.message}; } })()")
            check('ASR self-test (tiny.en WASM) recognises the instruction', not sr.get('err') and sr.get('got') == sr.get('expect'), sr)
        else:
            print('SKIP ASR self-test: no local model (node tools/asr_eval/browser.js tiny.en gb --limit 1 downloads it)')
        await page.screenshot(path=f'{WORK}/shots/04_voice.png')
        txt = await page.evaluate("App.resultText()"); check('Result text builds', 'ATC Ruzyně' in txt and '[1] Radar APP' in txt and 'Hlasové ovládání: model' in txt)
        print('\n'.join(txt.split('\n')[:8]))
        print('ERRORS:', errs[:10])
        check('No page errors', len(errs) == 0, errs[:3])
        await b.close()
    print('\nFAILED:', FAIL)
asyncio.run(main())
