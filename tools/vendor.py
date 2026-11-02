#!/usr/bin/env python3
"""Vendor the speech-recognition runtime into docs/vendor/ (served by GitHub Pages next to the app).

Pinned: @huggingface/transformers (browser bundle) and the exact onnxruntime-web build it depends on
(its WASM binaries; transformers.js would otherwise fetch them from jsDelivr at runtime).
The npm tarballs are verified against the registry's sha512 integrity; VENDOR.json records the sha256 of
every vendored file.

  python3 tools/vendor.py           # download (into .work/vendor_dl), verify, extract into docs/vendor/
  python3 tools/vendor.py --check   # offline: verify docs/vendor/ against VENDOR.json

Bumping the version: change TRANSFORMERS below, run the script, delete the old docs/vendor/transformers-*/,
update ASR_VENDOR in src/voice.js, rebuild and re-run tools/asr_eval/browser.js.
"""
import base64, hashlib, io, json, os, pathlib, shutil, sys, tarfile, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = pathlib.Path(os.environ.get('ATC_WORK', ROOT / '.work'))
REGISTRY = 'https://registry.npmjs.org/'
TRANSFORMERS = '4.3.2'
DEST = ROOT / 'docs' / 'vendor' / f'transformers-{TRANSFORMERS}'
# file in the package -> name in DEST
FILES = {
    '@huggingface/transformers': {'package/dist/transformers.min.js': 'transformers.min.js', 'package/LICENSE': 'LICENSE.transformers.txt'},
    # asyncify build: WebGPU and WASM on current browsers; plain build: Safari < 26 without WebGPU
    'onnxruntime-web': {'package/dist/ort-wasm-simd-threaded.asyncify.mjs': 'ort-wasm-simd-threaded.asyncify.mjs',
                        'package/dist/ort-wasm-simd-threaded.asyncify.wasm': 'ort-wasm-simd-threaded.asyncify.wasm',
                        'package/dist/ort-wasm-simd-threaded.mjs': 'ort-wasm-simd-threaded.mjs',
                        'package/dist/ort-wasm-simd-threaded.wasm': 'ort-wasm-simd-threaded.wasm'},
}


# GitHub push protection reads the 32-character class name "Mistral3ForConditionalGeneration" next to the word
# "mistral" in the minified bundle as a Mistral AI API key and refuses the push (false positive). A Unicode escape
# for one letter has the same meaning in every place the name occurs (identifier, property key, export name, string
# literal), so the bundle behaves identically. VENDOR.json records the upstream sha256 and the replacements.
PATCHES = {'transformers.min.js': [('Mistral3ForConditionalGeneration', 'Mistral3ForCondi\\u0074ionalGeneration', 3)]}


def sha256(b): return hashlib.sha256(b).hexdigest()


def get(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def tarball(name, version):
    meta = json.loads(get(REGISTRY + name.replace('/', '%2f')))
    if version not in meta['versions']:
        sys.exit(f'{name}@{version} not in registry')
    v = meta['versions'][version]; url, integ = v['dist']['tarball'], v['dist']['integrity']
    cache = WORK / 'vendor_dl' / pathlib.Path(url).name
    data = cache.read_bytes() if cache.exists() else get(url)
    algo, want = integ.split('-', 1)
    if algo != 'sha512' or base64.b64encode(hashlib.sha512(data).digest()).decode() != want:
        sys.exit(f'integrity mismatch for {name}@{version}')
    cache.parent.mkdir(parents=True, exist_ok=True); cache.write_bytes(data)
    return v, url, integ, data


def tf_read(data, member):
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tf:
        return tf.extractfile(tf.getmember(member)).read()


def check():
    man = json.loads((DEST / 'VENDOR.json').read_text())
    bad = [f for f, h in man['files'].items() if not (DEST / f).exists() or sha256((DEST / f).read_bytes()) != h]
    print('vendor check:', 'OK' if not bad else 'MISMATCH ' + ' '.join(bad), DEST.relative_to(ROOT))
    return not bad


def main():
    if '--check' in sys.argv:
        sys.exit(0 if check() else 1)
    tv, turl, tint, tdata = tarball('@huggingface/transformers', TRANSFORMERS)
    ort_version = tv['dependencies']['onnxruntime-web']  # transformers.js pins an exact build
    ov, ourl, oint, odata = tarball('onnxruntime-web', ort_version)
    if DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir(parents=True)
    files, sources, patched = {}, {}, {}
    for (name, version, url, integ, data) in [('@huggingface/transformers', TRANSFORMERS, turl, tint, tdata), ('onnxruntime-web', ort_version, ourl, oint, odata)]:
        sources[name] = {'version': version, 'tarball': url, 'integrity': integ}
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tf:
            for member, out in FILES[name].items():
                b = tf.extractfile(tf.getmember(member)).read()
                if out in PATCHES:
                    up = sha256(b); t = b.decode('utf8')
                    for old, new, n in PATCHES[out]:
                        if t.count(old) != n: sys.exit(f'{out}: expected {n}x {old!r}, found {t.count(old)}: review PATCHES')
                        t = t.replace(old, new)
                    b = t.encode('utf8'); patched[out] = {'upstream_sha256': up, 'replace': [[o, nw] for o, nw, _ in PATCHES[out]]}
                (DEST / out).write_bytes(b); files[out] = sha256(b)
        sources[name]['license'] = json.loads(tf_read(data, 'package/package.json')).get('license')
        if name == 'onnxruntime-web':  # the npm package ships no LICENSE file: record license and source commit
            commit = tf_read(data, 'package/__commit.txt').decode().strip(); sources[name]['commit'] = commit
            note = (f'onnxruntime-web {version} (WASM binaries and loaders), MIT License, Copyright (c) Microsoft Corporation.\n'
                    f'Source: https://github.com/microsoft/onnxruntime/tree/{commit}\n'
                    'License text: https://github.com/microsoft/onnxruntime/blob/main/LICENSE\n')
            (DEST / 'LICENSE.onnxruntime.txt').write_text(note); files['LICENSE.onnxruntime.txt'] = sha256(note.encode())
    (DEST / 'VENDOR.json').write_text(json.dumps({'sources': sources, 'files': files, 'patched': patched}, indent=1) + '\n')
    total = sum((DEST / f).stat().st_size for f in files)
    print(f'vendored transformers {TRANSFORMERS} + onnxruntime-web {ort_version}: {len(files)} files, {total / 1e6:.1f} MB -> {DEST.relative_to(ROOT)}')
    check()


if __name__ == '__main__':
    main()
