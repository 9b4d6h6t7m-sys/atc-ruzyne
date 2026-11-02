#!/usr/bin/env python3
"""Build the single-file web app: src/*.js + src/style.css -> docs/index.html (GitHub Pages root).

Also writes the concatenated bundle to .work/bundle.js so it can be syntax-checked with
`node --check .work/bundle.js`. docs/ is build output: edit src/, never docs/index.html.
"""
import os, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = pathlib.Path(os.environ.get('ATC_WORK', ROOT / '.work'))
SRC = ROOT / 'src'

# Order matters: every file defines globals used by the files after it.
ORDER = ['data.js', 'core.js', 'sim.js', 'phrase.js', 'audio.js', 'voicepack.js', 'radar.js',
         'ground.js', 'window.js', 'strips.js', 'tests.js', 'app.js']

js = '\n'.join(f'/* ---- {n} ---- */\n' + (SRC / n).read_text() for n in ORDER)
if '</script' in js.lower():
    sys.exit('JS contains </script')
html = (SRC / 'template.html').read_text().replace('/*__CSS__*/', (SRC / 'style.css').read_text()).replace('/*__JS__*/', js)
out = ROOT / 'docs' / 'index.html'
out.write_text(html)
WORK.mkdir(parents=True, exist_ok=True)
(WORK / 'bundle.js').write_text(js)
print('built', out.relative_to(ROOT), len(html) // 1024, 'KB')
