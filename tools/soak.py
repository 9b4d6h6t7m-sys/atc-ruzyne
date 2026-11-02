import os as _os, pathlib as _pl
ROOT = _pl.Path(__file__).resolve().parents[1]
WORK = _pl.Path(_os.environ.get('ATC_WORK', ROOT / '.work'))
import asyncio, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1194,'height':834}, device_scale_factor=2, has_touch=True); page = await ctx.new_page()
        errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(f'file://{ROOT}/docs/index.html'); await page.wait_for_timeout(1000)
        r = await page.evaluate("""(() => {
          const sim = App.sim; let nan = 0, maxN = 0, stca = 0, landed = 0, left = 0, ga = 0;
          sim.on('stca', () => stca++); sim.on('landed', () => landed++); sim.on('left', () => left++); sim.on('goaround', () => ga++);
          // auto-controller: clear arrivals for ILS 24 with vectors so the demo exercises the full chain
          for (let t = 0; t < 1800; t += 0.1) {
            sim.step(0.1); App.gt.step(0.1); maintainWorld(); App.comms.tick(); App.comms.speaking = false;
            if (Math.round(t*10) % 50 === 0) for (const a of sim.ac) {
              if (a.ctl === 'pend') App.comms.atc(a, [{type:'assume'}]);
              if (a.kind === 'arr' && !a.ils && Math.hypot(a.x, a.y) < 22) { App.comms.atc(a, [{type:'alt', val:4000}, {type:'ils', rwy:'24'}]); }
              if (a.kind === 'arr' && a.ils && !a.locCap && a.mode === 'hdg' && a.route.length && a.routeIdx >= a.route.length) {}
              if (a.kind === 'dep' && a.alt > 4800 && a.ctl === 'own') App.comms.atc(a, [{type:'xfer', to:'ACC'}]);
            }
            for (const a of sim.ac) if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(a.alt) || !isFinite(a.ias)) nan++;
            maxN = Math.max(maxN, sim.ac.length);
          }
          return {t: Math.round(sim.t - 36000), n: sim.ac.length, maxN, nan, stca, landed, left, ga, log: App.comms.entries.length, ground: App.gt.items.map(i => i.cs + ':' + i.phase)};
        })()""")
        print(json.dumps(r)); print('errors', errs[:5])
        await b.close()
asyncio.run(main())
