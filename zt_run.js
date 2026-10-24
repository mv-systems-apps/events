/* zelftest.html echt in Chromium draaien, via een echte http-server (nodig voor
   een service worker). */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
/* De werkmap van EEN app, niet een gedeelde platte map. De drie apps hebben
   allemaal een index.html, manifest.json, icon.svg en update_cache_version.py
   in hun eigen root; staan die bij elkaar in een map, dan overschrijft de een
   de ander ongemerkt. Deze map is hier ook de webroot van de testserver, dus
   een vreemde index.html zou de serviceworker een bestand van een andere app
   in de events-cache laten bewaren -- precies de fout die de tests moeten
   afvangen. Daarom een pad naar de clone, met een env-schakelaar voor een
   andere app: MAP=../trends node zt_run.js

   Standaard de map waarin dit script zelf staat -- dus de clone van deze app,
   waar die ook terechtkomt. Geen vast pad: in een volgende sessie staat de
   clone ergens anders, en een vast pad wijst dan naar niets. */
const MAP = process.env.MAP ? path.resolve(process.env.MAP) : __dirname;
/* Tweede argument: een mutatie van sw-events.js, zodat 'faalt deze test op de
   vorige versie?' in een echte browser te beantwoorden is. */
const MUT = process.argv[2] || null;
const GROEP = process.env.GROEP || null;
const APPMUT = process.env.APPMUT || null;   /* 'van=>naar' in events.html */   /* naam van een groep om uit te lichten */
const types = { '.html':'text/html;charset=utf-8', '.js':'text/javascript', '.json':'application/json',
                '.svg':'image/svg+xml', '.txt':'text/plain', '.cjs':'text/javascript' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(MAP, p);
  if (!f.startsWith(MAP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('weg');
  }
  let body = fs.readFileSync(f);
  if (APPMUT && p === '/events.html') {
    const [van, naar] = APPMUT.split('=>');
    const txt = body.toString();
    if (!txt.includes(van)) { console.log('!! app-mutatie greep niet aan'); process.exit(1); }
    body = Buffer.from(txt.split(van).join(naar || ''));
  }
  if (MUT && p === '/sw-events.js') {
    const [van, naar] = MUT.split('=>');
    const txt = body.toString();
    if (!txt.includes(van)) { console.log('!! mutatie greep niet aan'); process.exit(1); }
    body = Buffer.from(txt.split(van).join(naar || ''));
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(body);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const poort = server.address().port;
  const basis = 'http://127.0.0.1:' + poort;
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  const fouten = [];
  pg.on('pageerror', e => fouten.push('pageerror: ' + e.message + (e.stack ? ' | ' + String(e.stack).split('\n').slice(1, 4).join(' <- ').trim() : '')));
  pg.on('console', m => { if (m.type() === 'error') fouten.push('console: ' + m.text()); });

  await pg.goto(basis + '/zelftest.html', { waitUntil: 'load' });
  /* De pagina begint niet zelf: er zit een knop op. */
  const knop = pg.locator('button', { hasText: /nakijken/i }).first();
  await knop.waitFor({ timeout: 15000 });
  await knop.click();
  console.log('op "Alles nakijken" geklikt');
  /* wachten tot de totaalregel staat */
  try {
    await pg.waitForFunction(() => {
      const t = document.body.innerText;
      return /van de \d+ controles|alle \d+ controles/i.test(t);
    }, null, { timeout: 180000 });
  } catch (e) {
    console.log('(geen totaalregel binnen de tijd; toon wat er staat)');
  }
  await pg.waitForTimeout(1500);

  const uit = await pg.evaluate(() => {
    const t = document.getElementById('totaal');
    const regels = [...document.querySelectorAll('.samenvattingRegel')].map(e => e.innerText.trim());
    const groepen = [...document.querySelectorAll('h2, .groep')].map(e => e.innerText.trim());
    return {
      totaal: t && !t.hidden ? t.innerText.trim() : '(nog geen totaal)',
      rood: regels,
      laatsteGroep: groepen[groepen.length - 1] || '(geen groep)',
      aantalGroepen: groepen.length,
      staart: document.body.innerText.trim().split('\n').slice(-12).join('\n')
    };
  });
  console.log('eerste run: ' + uit.totaal.split('\n')[0]);
  console.log('groepen gedraaid: ' + uit.aantalGroepen + ', laatste: ' + uit.laatsteGroep);
  if (uit.totaal === '(nog geen totaal)') {
    console.log('--- staart van de pagina ---\n' + uit.staart);
    await browser.close(); server.close(); return;
  }
  if (GROEP) {
    const regels = await pg.evaluate((naam) => {
      const el = [...document.querySelectorAll('.groep')].find(e => e.textContent.trim().toLowerCase() === naam.toLowerCase());
      if (!el) return ['(groep niet gevonden)'];
      const out = [];
      for (let n = el.nextElementSibling; n; n = n.nextElementSibling) {
        if (n.classList.contains('groep')) break;
        const t = n.textContent.trim().replace(/\s+/g, ' ');
        if (t) out.push((n.className.indexOf('fout') >= 0 ? 'FOUT ' : 'ok   ') + t);
      }
      return out;
    }, GROEP);
    console.log('\n--- ' + GROEP + ' (' + regels.length + ') ---');
    regels.forEach(r => console.log('  ' + r));
  }
  uit.rood.forEach(r => console.log('   rood: ' + r.replace(/\n/g, ' | ')));
  /* Twee keer achter elkaar in dezelfde opslag: zo blijkt of een run iets in de
     opslag achterlaat waar de volgende over struikelt. */
  const el = (MUT || APPMUT) ? null : await pg.$('#opnieuw');
  if (el) {
    await pg.evaluate(() => { const t = document.getElementById('totaal'); t.hidden = true; t.innerHTML = ''; });
    await el.click();
    try {
      await pg.waitForFunction(() => {
        const t = document.getElementById('totaal');
        return t && !t.hidden && /controles/.test(t.innerText);
      }, null, { timeout: 180000 });
    } catch (e) { console.log('tweede run: geen uitslag binnen de tijd'); }
    await pg.waitForTimeout(1000);
    const twee = await pg.evaluate(() => {
      const t = document.getElementById('totaal');
      return { kop: t ? t.innerText.split('\n')[0] : '(niets)',
               rood: [...document.querySelectorAll('.samenvattingRegel')].map(e => e.innerText.trim()) };
    });
    console.log('tweede run: ' + twee.kop);
    twee.rood.slice(0, 8).forEach(r => console.log('   rood: ' + r.replace(/\n/g, ' | ')));
  }
  console.log('--- totaalregel ---\n' + uit.totaal);
  console.log('groepen gedraaid: ' + uit.aantalGroepen + ', laatste: ' + uit.laatsteGroep);
  console.log('--- staart van de pagina ---\n' + uit.staart);
  if (uit.rood.length) { console.log('\n--- rode regels ---'); uit.rood.slice(0, 20).forEach(r => console.log('  ' + r)); }
  if (fouten.length) { console.log('\n--- paginafouten ---'); [...new Set(fouten)].slice(0, 10).forEach(f => console.log('  ' + f)); }
  await browser.close(); server.close();
})();
