import os as _os, pathlib as _pl
ROOT = _pl.Path(__file__).resolve().parents[1]
WORK = _pl.Path(_os.environ.get('ATC_WORK', ROOT / '.work'))
import asyncio, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width':1194,'height':834}, device_scale_factor=2, has_touch=True); page = await ctx.new_page()
        await page.goto(f'file://{ROOT}/docs/index.html'); await page.wait_for_timeout(1200)
        await page.evaluate("App.radars[0].select(App.sim.find('TVS35J'), true)"); await page.wait_for_timeout(300)
        r = await page.evaluate("""(() => { const q = s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }; return {menu: q('.cmd-menu'), tabs: q('.cmd-tabs'), body: q('.cmd-body'), canvas: q('.dial-wrap canvas'), wrap: q('.dial-wrap')}; })()""")
        print(r)
        await page.screenshot(path=f'{WORK}/shots/04_menu.png', clip={'x': 200, 'y': 40, 'width': 800, 'height': 600})
        await b.close()
asyncio.run(main())
