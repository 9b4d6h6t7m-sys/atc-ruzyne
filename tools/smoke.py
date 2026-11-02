import os as _os, pathlib as _pl
ROOT = _pl.Path(__file__).resolve().parents[1]
WORK = _pl.Path(_os.environ.get('ATC_WORK', ROOT / '.work'))
import asyncio, json, sys
from playwright.async_api import async_playwright
URL = f'file://{ROOT}/docs/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1194, 'height': 834}, device_scale_factor=2, has_touch=True)
        page = await ctx.new_page()
        logs = []
        page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await page.goto(URL)
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f'{WORK}/shots/01_radar.png')
        info = await page.evaluate('''() => ({n: App.sim.ac.length, t: App.sim.t, acs: App.sim.ac.map(a => [a.cs, a.x.toFixed(1), a.y.toFixed(1), Math.round(a.alt), Math.round(a.hdg), a.mode, a.ctl]), fps: App.fps})''')
        print(json.dumps(info, indent=0))
        for l in logs: print(l)
        await b.close()
asyncio.run(main())
