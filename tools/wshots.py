import os as _os, pathlib as _pl
ROOT = _pl.Path(__file__).resolve().parents[1]
WORK = _pl.Path(_os.environ.get('ATC_WORK', ROOT / '.work'))
import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1194, 'height': 748}, device_scale_factor=1)
        page = await ctx.new_page(); logs = []
        page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await page.goto(f'file://{ROOT}/docs/index.html'); await page.wait_for_timeout(600)
        await page.evaluate("document.getElementById('app').classList.add('nav-hidden'); App.show('ground')"); await page.wait_for_timeout(900)
        await page.evaluate("App.speed = 4"); await page.wait_for_timeout(2500); await page.evaluate("App.speed = 1")
        el = await page.query_selector('.split-v > div')
        W = "TESTS.find(t => t.id === 'ground').wv"
        aim = lambda cs, fov: f"(() => {{ const wv = {W}; const it = App.gt.items.find(i => i.cs === '{cs}'); const p = App.gt.pos(it); const dx = p.x - wv.cam.x, dy = p.y - wv.cam.y; wv.heading = Geo.norm360(Math.atan2(dx, dy) / DEG); const d = Math.hypot(dx, dy); wv.pitch = Math.atan2((it.alt || 0) + 4 - wv.cam.z, d) / DEG; wv.fov = {fov}; return [it.phase, Math.round(d), Math.round(it.alt)]; }})()"
        shots = [
          ('w1_day', f"{W}.tod='day'; {W}.vis=30000; {W}.heading=28; {W}.pitch=-9; {W}.fov=78"),
          ('w2_day_tvs', aim('TVS7K3', 24)),
          ('w3_day_ezs', aim('EZS98KH', 10)),
          ('w4_day_apron', f"{W}.heading=300; {W}.pitch=-14; {W}.fov=78"),
          ('w5_day_east', f"{W}.heading=120; {W}.pitch=-8; {W}.fov=78"),
          ('w6_dusk_sun', f"{W}.tod='dusk'; {W}.heading=250; {W}.pitch=-6; {W}.fov=78"),
          ('w7_night', f"{W}.tod='night'; {W}.heading=28; {W}.pitch=-9; {W}.fov=78"),
          ('w8_night_ezs', aim('EZS98KH', 14)),
          ('w9_night_east', f"{W}.heading=105; {W}.pitch=-3; {W}.fov=60"),
          ('w10_fog', f"{W}.tod='day'; {W}.vis=350; {W}.heading=28; {W}.pitch=-9; {W}.fov=78"),
          ('w11_fog_night', f"{W}.tod='night'; {W}.vis=350"),
        ]
        for name, js in shots:
            r = await page.evaluate(js); await page.wait_for_timeout(500)
            if r: print(name, r)
            await el.screenshot(path=f'{WORK}/shots/{name}.png')
        for l in logs: print(l)
        await b.close()
asyncio.run(main())
