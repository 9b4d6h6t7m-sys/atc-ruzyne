import os as _os, pathlib as _pl
ROOT = _pl.Path(__file__).resolve().parents[1]
WORK = _pl.Path(_os.environ.get('ATC_WORK', ROOT / '.work'))
import asyncio, sys
from playwright.async_api import async_playwright
URL = f'file://{ROOT}/docs/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1194, 'height': 748}, device_scale_factor=1, has_touch=True)
        page = await ctx.new_page(); logs = []
        page.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await page.goto(URL); await page.wait_for_timeout(800)
        await page.evaluate("App.show('ground')"); await page.wait_for_timeout(1500)
        T = "TESTS.find(t => t.id === 'ground')"
        async def snap(name, js='', wait=900):
            if js: await page.evaluate(js)
            await page.wait_for_timeout(wait)
            await page.screenshot(path=f'{WORK}/shots/{name}.png')
        await snap('g_day')
        await snap('g_day_thr24', f"{T}.wv.heading = 35; {T}.wv.pitch = -5; {T}.wv.fov = 40")
        await snap('g_day_apron', f"{T}.wv.heading = 120; {T}.wv.pitch = -16; {T}.wv.fov = 78")
        await snap('g_day_sun', f"{T}.wv.heading = 175; {T}.wv.pitch = 2; {T}.wv.fov = 78")
        await snap('g_dusk', f"{T}.wv.tod = 'dusk'; {T}.wv.heading = 28; {T}.wv.pitch = -9; {T}.wv.fov = 78")
        await snap('g_night', f"{T}.wv.tod = 'night'")
        await snap('g_night_thr24', f"{T}.wv.heading = 40; {T}.wv.pitch = -4; {T}.wv.fov = 36")
        await snap('g_night_east', f"{T}.wv.heading = 105; {T}.wv.pitch = -3; {T}.wv.fov = 60")
        await snap('g_fog', f"{T}.wv.tod = 'day'; {T}.wv.vis = 400; {T}.wv.heading = 28; {T}.wv.pitch = -9; {T}.wv.fov = 78")
        await snap('g_fog_night', f"{T}.wv.tod = 'night'; {T}.wv.vis = 400")
        await snap('g_bino', f"{T}.wv.tod = 'day'; {T}.wv.vis = 30000; {T}.wv.heading = 50; {T}.wv.pitch = -2.5; {T}.wv.fov = 14")
        fps = await page.evaluate("App.fps"); print('fps', fps)
        await page.evaluate("App.show('radar')"); await page.wait_for_timeout(900)
        await page.screenshot(path=f'{WORK}/shots/r_radar.png')
        for l in logs: print(l)
        await b.close()
asyncio.run(main())
