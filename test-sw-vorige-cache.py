"""Service worker: een optioneel bestand dat bij de installatie niet binnenkomt, wordt
overgenomen uit de nieuwste vorige eigen cache, op nummer gesorteerd (review thuis,
24-11-2026). Drie oude caches, in de volgorde v20, v11, v12 aangemaakt (zo zegt de volgorde
van caches.keys() niets), elk met een eigen icon.svg; het icoon komt bij de installatie
niet binnen. Daarna moet de nieuwe cache het icoon uit v20 hebben. Met de fout uit thuis
(slice één teken te ver) wordt v20 als 0 gelezen, v11 als 1 en v12 als 2, en komt het uit v12. Ook een cache van een
andere app met een hoger nummer mag niet meetellen.

  python3 test-sw-vorige-cache.py            (vanuit de map van de app)
  APP=<map> python3 test-sw-vorige-cache.py  (een andere versie van de app)
"""
import asyncio, http.server, threading, functools, os, re, sys
from playwright.async_api import async_playwright

MAP = os.environ.get('APP') or os.path.dirname(os.path.abspath(__file__))
if os.path.basename(MAP) == 'tests': MAP = os.path.dirname(MAP)
SW = next(f for f in os.listdir(MAP) if re.fullmatch(r'sw-[\w-]+\.js', f))
STAM = SW[3:-3]
APP_HTML = f'{STAM}.html'
_sw = open(os.path.join(MAP, SW), encoding='utf-8').read()
VOOR = re.search(r"""['"]([\w-]+-v)['"]""", _sw).group(1)
NIEUW = VOOR + re.search(r'const CACHE_VERSION\s*=\s*(\d+)', _sw).group(1)

fouten = []
def check(naam, echt, verwacht):
    ok = echt == verwacht
    print(f"  {'ok  ' if ok else 'FOUT'} {naam}: {echt!r}" + ('' if ok else f" — verwacht {verwacht!r}"))
    if not ok: fouten.append(naam)

H = type('S', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None})
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=MAP))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASIS = f'http://127.0.0.1:{srv.server_address[1]}/'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context()
        # het icoon komt bij de installatie niet binnen
        await ctx.route('**/icon.svg', lambda r: r.abort())
        pg = await ctx.new_page()
        await pg.goto(BASIS + 'manifest.json')   # een pagina van dezelfde origin, zonder de app (die registreert zelf)
        await pg.evaluate("""async ([basis, voor]) => {
          const adres = basis + 'icon.svg';
          for (const [naam, inhoud] of [[voor + '20', 'v20'], [voor + '11', 'v11'], [voor + '12', 'v12'], ['andere-app-v99', 'ander']]) {
            const c = await caches.open(naam); await c.put(adres, new Response(inhoud)); }
        }""", [BASIS, VOOR])
        res = await pg.evaluate("""async ([sw, nieuw]) => {
          const reg = await navigator.serviceWorker.register(sw);
          const w = reg.installing || reg.waiting || reg.active;
          await new Promise(ok => { if (w.state !== 'installing') return ok(); w.addEventListener('statechange', () => { if (w.state !== 'installing') ok(); }); });
          const r = (await caches.has(nieuw)) ? await (await caches.open(nieuw)).match(new URL('icon.svg', location.href).href) : null;
          return [w.state, await caches.keys(), r ? await r.text() : null];
        }""", [SW, NIEUW])
        check('de installatie slaagt zonder het icoon', res[0] in ('installed', 'activated', 'activating'), True)
        check('de nieuwe cache heeft het icoon uit de nieuwste vorige eigen cache (v20)', res[2], 'v20')
        await b.close()
    srv.shutdown()
    print("\n" + ("GEEN FOUTEN" if not fouten else f"{len(fouten)} FOUT(EN): " + ', '.join(fouten)))
    sys.exit(1 if fouten else 0)

asyncio.run(main())
