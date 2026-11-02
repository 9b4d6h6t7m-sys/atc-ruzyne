# ATC trenažér Ruzyně

Výcviková hra řízení letového provozu pro letiště Praha Ruzyně (LKPR): pracoviště APP a TWR.
Statická webová aplikace pro iPad (Safari, ideálně přidaná na plochu), hostovaná přes GitHub Pages.

Hra: https://9b4d6h6t7m-sys.github.io/atc-ruzyne/

Aktuální stav: v0.3.1 – test funkcí (radar APP, A‑SMGCS a výhled z věže, stripy, hlasy pilotů,
zadávání povelů, výstrahy). Připravuje se hlasové ovládání a AI piloti.

## Struktura

- `src/` – zdrojový kód (JavaScript bez frameworku)
- `docs/` – sestavená aplikace, kterou servíruje GitHub Pages (needitovat ručně)
- `tools/` – sestavení, testy v prohlížeči, generátor hlasových balíčků, vyhodnocení rozpoznávání řeči
- `CLAUDE.md` – technické poznámky a plán práce

Sestavení: `python3 tools/build.py`, test: `python3 tools/functest.py`.

Data jsou zjednodušená pro výcvikovou hru a nejsou určena k navigaci.
