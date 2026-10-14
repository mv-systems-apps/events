#!/usr/bin/env python3
"""Verhoogt het versienummer van Events.

Twee tellers, met een eigen taak:

  APP_VERSIE     in events.html   -- het stempel waaraan de app ziet dat er een
                                     nieuwe versie in de offline-kopie staat.
                                     Verhoog dit bij elke wijziging aan de app.
  CACHE_VERSION  in sw-events.js  -- de naam van de cache. Die hoeft alleen
                                     omhoog als sw-events.js zelf wijzigt. Doe je
                                     dat niet, dan vult de nieuwe worker tijdens
                                     zijn installatie dezelfde cache waaruit de
                                     oude nog bedient, en staan er twee deploys
                                     in een cache.

De twee tellers lopen dus uiteen, en dat hoort zo.

    python3 update_cache_version.py              alleen APP_VERSIE
    python3 update_cache_version.py --worker     ook CACHE_VERSION
"""

import re
import sys
from pathlib import Path

HIER = Path(__file__).parent
APP = (HIER / "events.html", re.compile(r"(var APP_VERSIE\s*=\s*)(\d+)(\s*;)"), "APP_VERSIE")
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
    ook_worker = "--worker" in sys.argv[1:]
    uit = verhoog(*APP)
    if uit:
        return uit
    if ook_worker:
        return verhoog(*WORKER)
    print("sw-events.js niet aangeraakt. Wijzigde die wel? Draai met --worker.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
