"""Service worker: een trage 404 houdt de installatie niet op (review thuis, 24-11-2026).
Een eigen server stuurt voor één bijbestand (icon.svg) eerst de 404-kop en daarna de
inhoud met 1 byte per seconde. Een fout antwoord moet worden afgebroken met
body.cancel(); uitlezen (arrayBuffer) wacht tot de hele inhoud binnen is, en een grens
van 10 s helpt maar half. De installatie moet binnen 3 s klaar zijn.

  python3 test-sw-trage-404.py            (vanuit de map van de app)
  APP=<map> python3 test-sw-trage-404.py  (een andere versie van de app)
"""
import asyncio, http.server, threading, functools, os, re, sys, time
from playwright.async_api import async_playwright

MAP = os.environ.get('APP') or os.path.dirname(os.path.abspath(__file__))
if os.path.basename(MAP) == 'tests': MAP = os.path.dirname(MAP)
SW = next(f for f in os.listdir(MAP) if re.fullmatch(r'sw-[\w-]+\.js', f))
TRAAG = 'icon.svg'
LENGTE = 60   # bytes, dus een minuut als iemand alles uitleest

fouten = []
def check(naam, echt, verwacht):
    ok = echt == verwacht
    print(f"  {'ok  ' if ok else 'FOUT'} {naam}: {echt!r}" + ('' if ok else f" — verwacht {verwacht!r}"))
    if not ok: fouten.append(naam)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def do_GET(self):
        if self.path.split('?')[0].endswith('/' + TRAAG):
            self.send_response(404); self.send_header('Content-Type', 'text/plain'); self.send_header('Content-Length', str(LENGTE)); self.end_headers()
            try:
                for _ in range(LENGTE):
                    self.wfile.write(b'x'); self.wfile.flush(); time.sleep(1)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        return super().do_GET()
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=MAP)); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASIS = f'http://127.0.0.1:{srv.server_address[1]}/'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        await pg.goto(BASIS + 'manifest.json')
        try:
            r = await asyncio.wait_for(pg.evaluate("""async (sw) => { const t0 = Date.now(); const reg = await navigator.serviceWorker.register(sw);
              const w = reg.installing || reg.waiting || reg.active;
              await new Promise(ok => { if (w.state !== 'installing') return ok(); w.addEventListener('statechange', () => { if (w.state !== 'installing') ok(); }); });
              return [w.state, Date.now() - t0]; }""", SW), 75)
        except asyncio.TimeoutError:
            r = ['nog bezig na 75 s', 75000]
        check('de installatie slaagt zonder het trage bijbestand', r[0] in ('installed', 'activating', 'activated'), True)
        check(f'binnen 3 s, ook al komt de 404 met 1 byte per seconde (duurde {r[1]} ms)', r[1] < 3000, True)
        await b.close()
    srv.shutdown()
    print("\n" + ("GEEN FOUTEN" if not fouten else f"{len(fouten)} FOUT(EN): " + ', '.join(fouten)))
    sys.exit(1 if fouten else 0)

asyncio.run(main())
