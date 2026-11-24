"""Service worker: ontbreken er online een paar bijbestanden (hier de iconen van de
snelkoppelingen), dan blijft een update toch snel (review thuis, 24-11-2026). Een fout
antwoord (404) dat niet wordt uitgelezen, houdt een verbinding bezet; met een paar
ontbrekende bestanden wachtte de rest van de installatie dan op de grens van 10 s, en
duurde een update in Golf zo'n 20 s.

  python3 test-sw-ontbrekend-bijbestand.py            (vanuit de map van de app)
  APP=<map> python3 test-sw-ontbrekend-bijbestand.py  (een andere versie van de app)
"""
import asyncio, http.server, threading, functools, os, re, sys, shutil, tempfile
from playwright.async_api import async_playwright

MAP = os.environ.get('APP') or os.path.dirname(os.path.abspath(__file__))
if os.path.basename(MAP) == 'tests': MAP = os.path.dirname(MAP)
SW = next(f for f in os.listdir(MAP) if re.fullmatch(r'sw-[\w-]+\.js', f))
STAM = SW[3:-3]

fouten = []
def check(naam, echt, verwacht):
    ok = echt == verwacht
    print(f"  {'ok  ' if ok else 'FOUT'} {naam}: {echt!r}" + ('' if ok else f" — verwacht {verwacht!r}"))
    if not ok: fouten.append(naam)

# de app zoals online, maar zonder de map snelkoppelingen
wortel = tempfile.mkdtemp(); doel = os.path.join(wortel, STAM); os.makedirs(doel)
for naam in os.listdir(MAP):
    if os.path.isfile(os.path.join(MAP, naam)): shutil.copy2(os.path.join(MAP, naam), doel)
def zet(n):
    p = os.path.join(doel, SW); t = open(p, encoding='utf-8').read()
    open(p, 'w', encoding='utf-8').write(re.sub(r'const CACHE_VERSION\s*=\s*\d+;', f'const CACHE_VERSION = {n};', t))

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=wortel))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/{STAM}/{STAM}.html'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        zet(900)
        await pg.goto(URL); await pg.evaluate("navigator.serviceWorker.ready"); await pg.wait_for_timeout(1000); await pg.reload(); await pg.wait_for_timeout(500)
        zet(901)
        r = await pg.evaluate("""async () => { const reg = await navigator.serviceWorker.getRegistration(); const t0 = Date.now(); await reg.update();
          const w = reg.installing || reg.waiting; if (!w) return ['geen nieuwe versie', 0];
          await new Promise(ok => { if (w.state !== 'installing') return ok(); w.addEventListener('statechange', () => { if (w.state !== 'installing') ok(); }); });
          return [w.state, Date.now() - t0]; }""")
        check('de nieuwe versie is geïnstalleerd en wacht', r[0], 'installed')
        check(f'binnen 3 s, ook al ontbreken de iconen van de snelkoppelingen (was {r[1]} ms)', r[1] < 3000, True)
        await b.close()
    srv.shutdown(); shutil.rmtree(wortel, ignore_errors=True)
    print("\n" + ("GEEN FOUTEN" if not fouten else f"{len(fouten)} FOUT(EN): " + ', '.join(fouten)))
    sys.exit(1 if fouten else 0)

asyncio.run(main())
