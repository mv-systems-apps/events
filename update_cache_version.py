#!/usr/bin/env python3
"""Verhoogt CACHE_VERSION in sw-events.js met 1.

Draai dit na elke wijziging aan events.html, zodat de service
worker zijn oude cache opruimt en iedereen de nieuwe versie krijgt.

    python3 update_cache_version.py
"""

import re
import sys
from pathlib import Path

SW = Path(__file__).with_name("sw-events.js")
PATROON = re.compile(r"(const CACHE_VERSION\s*=\s*)(\d+)(\s*;)")


def main() -> int:
    if not SW.exists():
        print(f"Niet gevonden: {SW}", file=sys.stderr)
        return 1

    tekst = SW.read_text(encoding="utf-8")
    treffer = PATROON.search(tekst)
    if not treffer:
        print("CACHE_VERSION niet gevonden in sw-events.js", file=sys.stderr)
        return 1

    oud = int(treffer.group(2))
    nieuw = oud + 1
    SW.write_text(PATROON.sub(rf"\g<1>{nieuw}\g<3>", tekst, count=1), encoding="utf-8")
    print(f"CACHE_VERSION: {oud} -> {nieuw}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
