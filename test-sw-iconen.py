"""Service worker: elk icoon dat manifest.json noemt (ook de PNG's van de snelkoppelingen)
staat na de installatie in de cache, zodat ze ook offline te laden zijn (review thuis,
24-11-2026; daar ontbraken icon-192.png en icon-512.png). Eerst de lijst in de service
worker tegen het manifest, dan echt: installeren en in de nieuwe cache kijken.

  python3 test-sw-iconen.py            (vanuit de map van de app)
  APP=<map> python3 test-sw-iconen.py  (een andere versie van de app)
"""
import asyncio, http.server, threading, functools, json, os, re, sys
from urllib.parse import urljoin
from playwright.async_api import async_playwright

MAP = os.environ.get('APP') or os.path.dirname(os.path.abspath(__file__))
if os.path.basename(MAP) == 'tests': MAP = os.path.dirname(MAP)
SW = next(f for f in os.listdir(MAP) if re.fullmatch(r'sw-[\w-]+\.js', f))
_sw = open(os.path.join(MAP, SW), encoding='utf-8').read()
NIEUW = re.search(r"""const CACHE_NAME\s*=\s*['"]([\w-]+)['"]""", _sw).group(1) + re.search(r'const CACHE_VERSION\s*=\s*(\d+)', _sw).group(1)
man = json.load(open(os.path.join(MAP, 'manifest.json'), encoding='utf-8'))
ICONEN = sorted({i['src'] for i in man.get('icons', [])} | {i['src'] for s in man.get('shortcuts', []) for i in s.get('icons', [])})

fouten = []
def check(naam, echt, verwacht):
    ok = echt == verwacht
    print(f"  {'ok  ' if ok else 'FOUT'} {naam}: {echt!r}" + ('' if ok else f" — verwacht {verwacht!r}"))
    if not ok: fouten.append(naam)

def norm(p): return './' + p[2:] if p.startswith('./') else './' + p
check('de iconen uit manifest.json bestaan', [i for i in ICONEN if not os.path.exists(os.path.join(MAP, norm(i)[2:]))], [])
check('elk icoon uit manifest.json staat in de lijst van de service worker', [i for i in ICONEN if f"'{norm(i)}'" not in _sw and f'"{norm(i)}"' not in _sw], [])

H = type('S', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None})
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=MAP))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASIS = f'http://127.0.0.1:{srv.server_address[1]}/'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        await pg.goto(BASIS + 'manifest.json')
        weg = await pg.evaluate("""async ([sw, nieuw, iconen]) => {
          const reg = await navigator.serviceWorker.register(sw);
          const w = reg.installing || reg.waiting || reg.active;
          await new Promise(ok => { if (w.state !== 'installing') return ok(); w.addEventListener('statechange', () => { if (w.state !== 'installing') ok(); }); });
          const c = await caches.open(nieuw), uit = [];
          for (const i of iconen) if (!(await c.match(new URL(i, location.href).href))) uit.push(i);
          return uit; }""", [SW, NIEUW, ICONEN])
        check('na de installatie staan alle iconen in de cache (dus ook offline)', weg, [])
        await b.close()
    srv.shutdown()
    print("\n" + ("GEEN FOUTEN" if not fouten else f"{len(fouten)} FOUT(EN): " + ', '.join(fouten)))
    sys.exit(1 if fouten else 0)

asyncio.run(main())
