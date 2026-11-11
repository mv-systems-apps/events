#!/usr/bin/env python3
"""Verhoogt de cacheteller van Events.

Twee stempels, met een eigen taak -- en maar een ervan hoort in een script:

  Versie <HEX(yyyymmdd)-NNN>      onderaan de cfg-modal in events.html.
                                  Hieraan ziet de app dat er een nieuwe versie
                                  in de offline-kopie staat. Dit stempel gaat
                                  met de HAND omhoog, bij elke wijziging aan de
                                  app. Zo schrijven de gedeelde conventies het
                                  voor, en daar is een reden voor: een script
                                  verhoogt het ook bij een wijziging die niemand
                                  hoeft te zien, en dan staat er een melding
                                  tegenover niets.
  CACHE_VERSION  in sw-events.js  de naam van de cache. Die hoeft alleen omhoog
                                  als sw-events.js zelf wijzigt. Doe je dat
                                  niet, dan vult de nieuwe worker tijdens zijn
                                  installatie dezelfde cache waaruit de oude nog
                                  bedient, en staan er twee uitgaven in een
                                  cache.

De twee lopen dus uiteen, en dat hoort zo.

    python3 update_cache_version.py          verhoogt CACHE_VERSION
"""

import re
import sys
from pathlib import Path

HIER = Path(__file__).parent
WORKER = (HIER / "sw-events.js", re.compile(r"(const CACHE_VERSION\s*=\s*)(\d+)(\s*;)"), "CACHE_VERSION")


def verhoog(pad, patroon, naam) -> int:
    if not pad.exists():
        print(f"Niet gevonden: {pad}", file=sys.stderr)
        return 1
    tekst = pad.read_text(encoding="utf-8")
    treffer = patroon.search(tekst)
    if not treffer:
        print(f"{naam} niet gevonden in {pad.name}", file=sys.stderr)
        return 1
    oud = int(treffer.group(2))
    pad.write_text(patroon.sub(rf"\g<1>{oud + 1}\g<3>", tekst, count=1), encoding="utf-8")
    print(f"{pad.name}: {naam} {oud} -> {oud + 1}")
    return 0


def main() -> int:
    uit = verhoog(*WORKER)
    if uit:
        return uit
    print("Het versiestempel in events.html is NIET aangeraakt: dat gaat met de hand.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
