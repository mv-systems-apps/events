#!/usr/bin/env node
/* Regressietests voor Events.
   Draaien met:  node events-tests.cjs   (vanuit dezelfde map als events.html en sw-events.js)

   De tests halen de functies letterlijk uit events.html en sw-events.js, zodat ze niet uit
   de pas kunnen lopen met de app. Browsergedrag (de DOM, focus, scrollen, een echte
   IndexedDB, de datumlaag en de macro) wordt hier NIET getest; daarvoor is zelftest.html,
   die de app in een echt venster laadt. */

const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, 'events.html'), 'utf8');
const SW = fs.readFileSync(path.join(__dirname, 'sw-events.js'), 'utf8');
/* De macro leest hetzelfde bestand. Hij draait hier niet -- daarvoor is
   zelftest.html, die hem echt uitvoert -- maar de afspraak over het formaat
   staat in beide bestanden en moet gelijk blijven; dat is hieronder na te lezen. */
const LITE = fs.existsSync(path.join(__dirname, 'events_lite.js'))
  ? fs.readFileSync(path.join(__dirname, 'events_lite.js'), 'utf8') : null;
const SCRIPT = HTML.match(/<script>([\s\S]*)<\/script>/)[1];

/* Een functie letterlijk uit de app halen. De app schrijft de sluitaccolade van een
   functie met meer regels op kolom 0; een functie van een regel sluit op die regel
   zelf. Beide gevallen apart, want een greep tot de volgende '\n}' slokt bij een
   functie van een regel de hele volgende functie mee -- dat ging eerder mis. De
   controle erna vangt zo'n misgreep: in het stuk mag maar een functiekop staan. */
const haal = (naam) => {
  const kop = new RegExp('^(?:async )?function ' + naam + '\\s*\\(', 'm').exec(SCRIPT);
  if (!kop) throw new Error('functie niet gevonden in events.html: ' + naam);
  const eersteRegel = SCRIPT.slice(kop.index, SCRIPT.indexOf('\n', kop.index));
  const tel = (s, c) => s.split(c).length - 1;
  const stuk = (tel(eersteRegel, '{') > 0 && tel(eersteRegel, '{') === tel(eersteRegel, '}'))
    ? eersteRegel
    : SCRIPT.slice(kop.index, SCRIPT.indexOf('\n}', kop.index) + 2);
  const koppen = (stuk.match(/^(?:async )?function (\w+)/gm) || []);
  if (koppen.length !== 1) throw new Error('greep te ruim bij ' + naam + ': ' + koppen.join(', '));
  return stuk;
};

/* Een afgewezen belofte die niemand opvangt, sluit node af met een stacktrace en
   laat de rest van de bundel niet draaien. In een browser is het stiller, maar het
   is daar net zo goed een gebrek: de achtergrondverversing hoort haar eigen
   mislukkingen af te handelen. Hier wordt het geteld en aan het eind gemeld.
   Let op wat deze handler óók doet: hij houdt node overeind. Zonder het vangnet
   verderop betekende dat dat een fout in de bundel zelf de run stil beeindigde --
   geen enkele FOUT-regel, geen samenvatting, en afsluitcode 0. */
const losseFouten = [];
process.on('unhandledRejection', (e) => losseFouten.push(e && e.message ? e.message : String(e)));
process.on('uncaughtException', (e) => { afbreken('uncaughtException', e); });

/* Hoeveel groepen er horen te draaien. Een sectie die stil wordt overgeslagen of
   halverwege afbreekt, valt hiermee op -- anders print de bundel domweg minder
   regels en lijkt alles in orde. Voeg je een groep toe, dan hoort dit getal mee
   omhoog; de controle aan het eind zegt het als je dat vergeet. */
const GROEPEN_VERWACHT = 16;
let groepen = 0;

let goed = 0, fout = 0;
const ok = (naam, voorwaarde, extra = '') => {
  if (voorwaarde) { goed++; console.log('  OK   ' + naam + (extra ? '  — ' + extra : '')); }
  else { fout++; console.log('  FOUT ' + naam + (extra ? '  — ' + extra : '')); }
};
const kop = (t) => { groepen++; console.log('\n' + t); };

/* Eén plek die afsluit, en die hoort ALTIJD te draaien -- ook als de bundel zelf
   omvalt. Daarom controleert hij of alle groepen hebben gedraaid en of er geen
   uitzondering is ontsnapt; zonder dat kon de run stil ophouden met code 0 en las
   een afsluitcode of een grep op FOUT dat als 'alles groen'. */
let afgesloten = false;
function afsluiten(){
  if (afgesloten) return;
  afgesloten = true;
  ok('alle ' + GROEPEN_VERWACHT + ' groepen hebben gedraaid', groepen === GROEPEN_VERWACHT,
     groepen + ' van ' + GROEPEN_VERWACHT +
     (groepen < GROEPEN_VERWACHT ? ' -- de bundel is ergens afgebroken of een groep is overgeslagen'
                                 : groepen > GROEPEN_VERWACHT ? ' -- werk GROEPEN_VERWACHT bij' : ''));
  console.log('\n' + '='.repeat(62));
  console.log(goed + ' geslaagd, ' + fout + ' mislukt');
  console.log('NIET getest (vereist een browser of toestel): de DOM en de meldingen,');
  console.log('focus en toetsenbord, een echte IndexedDB en de herstelbuffer, de');
  console.log('datumlaag, de macro, en of de serviceworker werkelijk een nieuwe versie');
  console.log('ophaalt. Daarvoor is zelftest.html.');
  process.exit(fout ? 1 : 0);
}

/* Een uitzondering die uit de bundel ontsnapt is zelf een mislukking: hij wordt
   een rode regel met de plek erbij, en daarna sluit de bundel netjes af. */
function afbreken(waar, e){
  ok('de bundel liep door tot het eind', false,
     waar + ': ' + ((e && e.stack) ? String(e.stack).split('\n').slice(0, 3).join(' | ') : e));
  afsluiten();
}

/* ---------- nagemaakte serviceworker-omgeving ----------
   Met de semantiek die ertoe doet: relatieve sleutels worden tegen de scope opgelost,
   de zoekstring hoort bij de sleutel tenzij er met ignoreSearch wordt gezocht, en een
   netwerkantwoord heeft een status en een type. Zonder die drie toetsen de tests iets
   anders dan de browser doet. */
const ORIGIN = 'https://mv-systems-apps.github.io';
const SCOPE = ORIGIN + '/';

function swOmgeving(opties = {}) {
  const abs = (u) => new URL(u && u.url ? u.url : u, SCOPE).href;
  const zonderQuery = (u) => String(u).split('?')[0];
  const store = new Map();
  const log = [];
  const schrijfLog = [];
  let online = opties.online !== false;

  class Res {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status === undefined ? 200 : init.status;
      this.ok = this.status >= 200 && this.status < 300;
      this.statusText = init.statusText || '';
      this.type = init.type || 'basic';
      this._headers = init.headers || {};
      this.headers = { get: (k) => this._headers[k] ?? this._headers[String(k).toLowerCase()] };
    }
    clone() { return new Res(this.body, { status: this.status, type: this.type, headers: this._headers }); }
    async text() { return this.body; }
  }

  const caches = {
    async keys() {
      /* De worker heeft een tak voor een cachelijst die niet te bevragen is --
         'het zekere voor het onzekere, niets wissen'. Zonder deze mogelijkheid
         was die tak in de tests dood en kon hij worden omgedraaid zonder dat er
         iets rood werd. */
      if (opties.keysStuk) throw new Error('cachelijst niet te bevragen');
      return [...store.keys()];
    },
    async delete(n) { return store.delete(n); },
    async open(n) {
      if (opties.cacheStuk) throw new Error('cacheopslag geweigerd');
      if (!store.has(n)) store.set(n, new Map());
      const c = store.get(n);
      return {
        async match(r, o) {
          const url = abs(r);
          if (c.has(url)) return c.get(url);
          if (o && o.ignoreSearch) {
            for (const k of c.keys()) if (zonderQuery(k) === zonderQuery(url)) return c.get(k);
          }
          return undefined;
        },
        async put(r, resp) {
          if (opties.putStuk) throw new Error('geen ruimte');
          const u = abs(r);
          /* Per bestand kunnen weigeren is nodig om de schrijfvolgorde te
             toetsen: een opslag die alles weigert laat niet zien of het
             verplichte bestand voor of na de optionele wordt weggezet. */
          if (opties.weigerPut && opties.weigerPut.some((eind) => u.endsWith(eind))) {
            schrijfLog.push('geweigerd ' + u.replace(ORIGIN, ''));
            const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
          }
          schrijfLog.push(u.replace(ORIGIN, ''));
          c.set(u, resp);
        },
        async keys() { return [...c.keys()]; }
      };
    }
  };

  const server = new Set(
    (opties.server || ['./', './index.html', './events.html', './manifest.json', './icon.svg']).map(abs)
  );
  const inhoud = opties.inhoud || {};
  /* Afgebroken verzoeken, met het moment waarop dat gebeurde. Zonder dit is niet
     te zien of een vastgelopen verzoek werkelijk wordt afgebroken of alleen
     wordt losgelaten -- en dat tweede houdt een verbinding bezet. */
  const afgebroken = [];
  const netwerk = (req, init) => {
    const url = abs(req);
    const begin = Date.now();
    log.push({ url, method: (init && init.method) || 'GET', cache: init && init.cache,
               signaal: !!(init && init.signal) });
    const sein = init && init.signal;
    if (opties.hangt) {
      /* antwoordt nooit, maar reageert wel op afbreken, zoals een echte fetch */
      return new Promise((_, mis) => {
        if (!sein) return;
        sein.addEventListener('abort', () => {
          afgebroken.push({ url, na: Date.now() - begin });
          const e = new Error('afgebroken'); e.name = 'AbortError'; mis(e);
        });
      });
    }
    return (async () => {
    if (!online) throw new Error('offline');
    if (new URL(url).origin !== ORIGIN) return new Res('extern', { status: 200, type: 'cors' });
    /* Een statische server bedient op pad en trekt zich van de zoekstring niets
       aan: events.html?cfg=werk.json levert gewoon events.html. De cache doet dat
       juist wel, en dat verschil is de hele reden dat de worker ignoreSearch
       gebruikt -- een server die op de volle URL zocht, maakte dat ontoetsbaar. */
    const pad = zonderQuery(url);
    if (!server.has(pad)) return new Res('weg', { status: 404 });
    /* Een eigen pad met een niet-basic antwoord: dat gebeurt bij een omleiding
       naar een ander domein. De worker hoort zoiets niet te bewaren, en zonder
       deze mogelijkheid was die voorwaarde in de tests niet te raken. */
    if (opties.corsVoor && opties.corsVoor.some((e) => pad.endsWith(e))) {
      return new Res('van elders', { status: 200, type: 'cors' });
    }
    return new Res(inhoud[pad] || ('inhoud ' + pad), { status: 200, type: 'basic' });
    })();
  };

  const handlers = {};
  const self_ = {
    location: { origin: ORIGIN, href: SCOPE },
    addEventListener: (t, f) => { (handlers[t] ||= []).push(f); },
    skipWaiting() { self_.skipWaitingAangeroepen = true; },
    /* De worker schrijft de open vensters aan zodra hij een verse kopie van de
       pagina heeft weggeschreven. Hier worden die berichten opgevangen, zodat
       na te rekenen is wat er wanneer wordt gemeld. */
    clients: {
      claim() {},
      matchAll(opties) {
        self_.matchAllOpties = opties;
        return Promise.resolve(self_.vensters);
      }
    },
    vensters: [],
    berichten: []
  };
  self_.vensters = [{ postMessage: (m) => self_.berichten.push(m) },
                    { postMessage: (m) => self_.berichten.push(m) }];

  return {
    ORIGIN, SCOPE, abs, store, caches, handlers, log, Res, self: self_, afgebroken, schrijfLog,
    zetOffline() { online = false; },
    zetOnline() { online = true; },
    maakSw(bron = SW) {
      new Function('self', 'caches', 'fetch', 'Response', 'URL', 'setTimeout', 'clearTimeout', bron)(
        self_, caches, netwerk, Res, URL, setTimeout, clearTimeout);
    }
  };
}

const SW_TELLER = /const CACHE_VERSION = (\d+);/.exec(SW);
const CACHE_NAAM = 'events-v' + (SW_TELLER ? SW_TELLER[1] : '?');

/* Een worker die gooit of een afgewezen belofte aan respondWith geeft, laat de
   browser de pagina met een netwerkfout zitten. Hier wordt dat een herkenbare
   waarde in plaats van een crash van de testrun, zodat het een rode controle
   oplevert en niet een stacktrace die als 'geen enkele controle mislukt' leest. */
const STUK = { status: 0, stuk: true, headers: { get: () => '' }, text: async () => '' };
const vuur = async (env, naam, ev = {}) => {
  const wacht = [];
  ev.waitUntil = (p) => wacht.push(p);
  let antwoord;
  ev.respondWith = (p) => { antwoord = p; };
  try { for (const f of (env.handlers[naam] || [])) f(ev); }
  catch (e) { if (naam === 'fetch') return STUK; throw e; }
  try { await Promise.all(wacht); }
  catch (e) { if (naam !== 'fetch') throw e; }
  if (!antwoord) return undefined;
  try { return await antwoord; } catch (e) { return STUK; }
};
const installeer = async (env) => {
  env.maakSw();
  try { await vuur(env, 'install'); return null; } catch (e) { return e; }
};
const vraagVan = (env) => async (url, mode = 'no-cors', method = 'GET') =>
  vuur(env, 'fetch', { request: { method, url, mode } });
const rust = () => new Promise((r) => setTimeout(r, 20));
/* Een gesloopte worker of app mag deze bundel niet laten crashen: dan draaien de
   controles erna niet en leest een stacktrace als 'niets mislukt'. Daarom nergens
   rechtstreeks .keys() of .text() op iets wat kan ontbreken. */
const sleutels = (env, naam = CACHE_NAAM) => [...(env.store.get(naam) || new Map()).keys()];
const tekst = async (res) => (res && typeof res.text === 'function') ? await res.text() : '(geen antwoord)';
const uitkomst = async (p) => { try { return await p; } catch (e) { return 'uitzondering: ' + e.message; } };

/* ---------- 1. de twee tellers ---------- */
kop('1. De twee versietellers');
{
  /* Het stempel staat in het SCHERM, niet in het script: de app leest het daar
     uit, en de offline-kopie draagt het daardoor woordelijk mee. Daarom hier op
     HTML gezocht en niet op SCRIPT. */
  const app = /Versie ([0-9A-F]+-[0-9A-F]+)/.exec(HTML);
  const sw = /const CACHE_VERSION = (\d+);/.exec(SW);
  ok('events.html heeft een versiestempel', !!app, app && app[1]);
  /* Vaste lengtes, want daarop rust de hele vergelijking: 7 hex-cijfers voor de
     datum, 3 voor het volgnummer. Een stempel van 2 cijfers zou 1352896-002
     boven 1352896-010 zetten. */
  ok('en dat stempel heeft de voorgeschreven vorm',
     !!app && /^[0-9A-F]{7}-[0-9A-F]{3}$/.test(app[1]), app && app[1]);
  ok('het stempel staat onderaan de cfg-modal, waar de conventies het willen',
     /<div id="appVersieStempel">Versie [0-9A-F]{7}-[0-9A-F]{3}<\/div>/.test(HTML));
  /* De app leest het stempel uit de offline-kopie met dezelfde regex, en die
     pakt de EERSTE treffer in het bestand. Komt er ooit ergens hoger in het
     bestand een tweede 'Versie X-Y' te staan -- in een commentaarregel, in een
     voorbeeld -- dan leest de app dat in plaats van het echte stempel, en kan
     er een melding komen voor een versie die niet bestaat. */
  const treffers = HTML.match(/Versie\s+[0-9A-F]+-[0-9A-F]+/g) || [];
  ok('en het staat maar een keer in het bestand', treffers.length === 1,
     treffers.join(' | ') || 'geen');
  /* Overgangsregel, bedoeld voor precies een uitgave: de vorige versie van de
     app zoekt in de offline-kopie naar APP_VERSIE. Staat die er niet meer in,
     dan ziet een toestel dat nog op die versie draait juist de overstap zelf
     niet. Deze controle mag weg zodra iedereen een stempel heeft. */
  const over = /var APP_VERSIE = (\d+);/.exec(HTML);
  ok('de overgangsregel voor de vorige versie staat er nog',
     !!over && +over[1] > 179, over && over[1]);
  ok('sw-events.js heeft CACHE_VERSION', !!sw, sw && sw[1]);
  ok('de cachenaam begint met events-', /const CACHE_NAME = 'events-v' \+ CACHE_VERSION/.test(SW));
  if (!SW_TELLER) console.log('  (zonder CACHE_VERSION kan de rest niets toetsen)');
  /* Het stempel gaat met de HAND omhoog -- zo schrijven de gedeelde conventies
     het voor, en daar is een reden voor: een script dat het nummer verhoogt,
     verhoogt het ook bij een wijziging die niemand hoeft te zien, en dan staat
     er een melding tegenover niets. Het hulpscript mag dus alleen nog aan de
     cachenaam zitten. */
  const hulp = fs.existsSync(path.join(__dirname, 'update_cache_version.py'))
    ? fs.readFileSync(path.join(__dirname, 'update_cache_version.py'), 'utf8') : '';
  ok('update_cache_version.py kent de cacheteller', /CACHE_VERSION/.test(hulp));
  ok('en raakt het versiestempel niet aan',
     !!hulp && !/APP_VERSIE/.test(hulp) && !/appVersieStempel/.test(hulp));
  ok('geen skipWaiting bij het installeren',
     !/self\.skipWaiting\(\)/.test(SW.split("addEventListener('message'")[0]));
  ok('skipWaiting alleen op verzoek van de app', /'nuOverstappen'\) self\.skipWaiting\(\)/.test(SW));
}

/* ---------- 2. installatie, isolatie en opruimen ---------- */
kop('2. Installatie, cache-isolatie en opruimen');
(async () => {
  {
    const env = swOmgeving();
    env.store.set('golf-score-v41', new Map([[ORIGIN + '/golf-score.html', 'golf']]));
    env.store.set('trends-v17', new Map([[ORIGIN + '/trends.html', 'trends']]));
    env.store.set('events-v1', new Map([[ORIGIN + '/events.html', 'heel oud']]));
    ok('installatie slaagt', (await installeer(env)) === null);
    await vuur(env, 'activate');
    const over = [...env.store.keys()];
    ok('de cache van Golf Score blijft staan', over.includes('golf-score-v41'));
    ok('die van Trends ook', over.includes('trends-v17'));
    ok('een oude cache van Events wordt opgeruimd', !over.includes('events-v1'));
    ok('en de eigen cache staat er', over.includes(CACHE_NAAM), CACHE_NAAM);
    const inCache = sleutels(env).map((u) => u.replace(ORIGIN, ''));
    ok('alle vijf de eigen bestanden zijn bewaard', inCache.length === 5, inCache.sort().join(' '));

    const vraag = vraagVan(env);
    ok('een bestand van Golf Score wordt niet afgehandeld',
       (await vraag(ORIGIN + '/golf-score.html', 'navigate')) === undefined);
    ok('een bestand van Trends ook niet',
       (await vraag(ORIGIN + '/trends.html', 'navigate')) === undefined);
    ok('een ander domein ook niet', (await vraag('https://cdn.example.com/x.js')) === undefined);
    ok('en niet-GET gaat de worker voorbij',
       (await vraag(ORIGIN + '/events.html', 'navigate', 'POST')) === undefined);
    await rust();   /* een achtergrondschrijfactie landt na het antwoord */
    ok('er staat niets van buiten in de cache van Events',
       sleutels(env).every((k) => /\/(index\.html|events\.html|manifest\.json|icon\.svg)$|\/$/.test(k)));
  }

  /* ---------- 3. stale-while-revalidate ---------- */
  kop('3. Stale-while-revalidate: meteen uit de cache, daarnaast verversen');
  {
    const inhoud = { [ORIGIN + '/events.html']: 'APP v1' };
    const env = swOmgeving({ inhoud });
    await installeer(env);
    await vuur(env, 'activate');
    inhoud[ORIGIN + '/events.html'] = 'APP v2';          // nieuwe deploy
    env.log.length = 0;
    const res = await vraagVan(env)(ORIGIN + '/events.html', 'navigate');
    ok('het antwoord komt uit de cache, niet van het netwerk', (await tekst(res)) === 'APP v1', await tekst(res));
    ok('en het netwerk wordt er wel naast bevraagd', env.log.length === 1, env.log.length + ' verzoeken');
    await rust();
    const bewaard = await (await env.caches.open(CACHE_NAAM)).match(ORIGIN + '/events.html');
    ok('de kopie is op de achtergrond ververst', bewaard && bewaard.body === 'APP v2', bewaard && bewaard.body);
    const res2 = await vraagVan(env)(ORIGIN + '/events.html', 'navigate');
    ok('de volgende keer komt de nieuwe versie uit de cache', (await tekst(res2)) === 'APP v2');
  }

  /* ---------- 4. offline starten en de zoekstring ---------- */
  kop('4. Offline starten en navigeren met een zoekstring');
  {
    /* Online, met een gewijzigde server: een treffer levert de bewaarde kopie, een
       misser het verse netwerkantwoord. Offline zijn die twee niet te onderscheiden,
       want een misser valt daar terug op diezelfde bewaarde app. */
    const inhoud = { [ORIGIN + '/events.html']: 'UIT DE CACHE', [ORIGIN + '/icon.svg']: 'ICOON OUD' };
    const env = swOmgeving({ inhoud });
    await installeer(env);
    await vuur(env, 'activate');
    inhoud[ORIGIN + '/events.html'] = 'VAN HET NETWERK';
    inhoud[ORIGIN + '/icon.svg'] = 'ICOON NIEUW';
    const vraag = vraagVan(env);
    const q = await vraag(ORIGIN + '/events.html?cfg=werk.json', 'navigate');
    ok('navigatie met ?cfg= komt uit de cache en niet van het netwerk',
       (await tekst(q)) === 'UIT DE CACHE', await tekst(q));
    await rust();
    ok('en de verversing schrijft onder het pad zonder zoekstring',
       sleutels(env).every((k) => k.indexOf('?') < 0),
       sleutels(env).filter((k) => k.indexOf('?') >= 0).join());
    /* Bij een gewoon bestand blijft de zoekstring onderscheidend: ?v=2 hoort een
       nieuwe ophaalactie te zijn en niet de oude kopie uit de cache. */
    const anders = await vraag(ORIGIN + '/icon.svg?v=2');
    ok('een bestand met een andere zoekstring haalt wel van het netwerk',
       !!anders && (await tekst(anders)) === 'ICOON NIEUW', anders && await tekst(anders));
    ok('en zonder zoekstring komt het wel uit de cache',
       (await tekst(await vraag(ORIGIN + '/icon.svg'))) === 'ICOON OUD');
    ok('alleen navigaties negeren de zoekstring', /navigatie \? \{ ignoreSearch: true \}/.test(SW));
  }
  {
    const env = swOmgeving();
    await installeer(env);
    await vuur(env, 'activate');
    env.zetOffline();
    const vraag = vraagVan(env);
    const offApp = await vraag(ORIGIN + '/events.html', 'navigate');
    ok('gewone navigatie levert offline de app', !!offApp && offApp.status === 200,
       offApp && offApp.status);
    const metQuery = await vraag(ORIGIN + '/events.html?cfg=werk.json', 'navigate');
    ok('navigatie met ?cfg= werkt offline', !!metQuery && metQuery.status === 200, metQuery && metQuery.status);
    const offMap = await vraag(ORIGIN + '/?x=1', 'navigate');
    ok('ook de map-URL met een zoekstring', !!offMap && offMap.status === 200, offMap && offMap.status);
    ok('een bestand zonder zoekstring komt offline uit de cache',
       ((await vraag(ORIGIN + '/icon.svg')) || {}).status === 200);
    const weg = await vraag(ORIGIN + '/icon.svg?v=2');
    ok('een bestand met een andere zoekstring valt niet terug op de oude kopie',
       !!weg && weg.status === 503, weg && weg.status);
  }

  /* ---------- 5. mislukte en halve installatie ---------- */
  kop('5. Mislukte installatie en ontbrekende bestanden');
  {
    const env = swOmgeving({ server: ['./', './index.html', './manifest.json', './icon.svg'] });
    env.store.set('events-v1', new Map([[ORIGIN + '/events.html', 'vorige versie']]));
    const fail = await installeer(env);
    ok('een ontbrekend verplicht bestand laat de installatie mislukken', fail !== null, fail && fail.message);
    ok('er blijft geen lege huls in de cache achter', !env.store.has(CACHE_NAAM), [...env.store.keys()].join());
    ok('de vorige versie blijft staan', env.store.has('events-v1'));
  }
  {
    const env = swOmgeving({ server: ['./', './index.html', './events.html', './manifest.json'] });
    const fail = await installeer(env);
    ok('een ontbrekend optioneel bestand blokkeert de installatie niet', fail === null, fail && fail.message);
    const c = env.store.get(CACHE_NAAM) || new Map();
    ok('de app staat in de cache en het ontbrekende bestand is overgeslagen',
       c.has(ORIGIN + '/events.html') && !c.has(ORIGIN + '/icon.svg'), c.size + ' sleutels');
  }
  {
    const env = swOmgeving({ putStuk: true });
    ok('volle opslag laat de installatie mislukken in plaats van half',
       (await installeer(env)) !== null);
  }
  {
    /* Het geval dat er werkelijk toe doet: voor een wijziging aan alleen
       events.html hoeft CACHE_VERSION niet omhoog, dus installeert de nieuwe
       worker in dezelfde cache waaruit de oude nog bedient. Een mislukking mag
       die dan niet wissen -- anders sloopt een netwerkfout de offline-app. */
    const env = swOmgeving({ server: ['./', './index.html', './manifest.json', './icon.svg'] });
    const c = await env.caches.open(CACHE_NAAM);
    await c.put(ORIGIN + '/events.html', new env.Res('DE WERKENDE APP', { type: 'basic' }));
    await c.put(ORIGIN + '/', new env.Res('INDEX', { type: 'basic' }));
    const fail = await installeer(env);
    ok('een mislukte installatie in een bestaande cache mislukt nog steeds', fail !== null);
    ok('maar laat die cache staan', env.store.has(CACHE_NAAM),
       [...env.store.keys()].join() || 'geen enkele cache meer');
    const app = await (await env.caches.open(CACHE_NAAM)).match(ORIGIN + '/events.html');
    ok('en de offline-kopie erin is nog bruikbaar', (await tekst(app)) === 'DE WERKENDE APP',
       await tekst(app));
    env.zetOffline();
    const nav = await vraagVan(env)(ORIGIN + '/events.html', 'navigate');
    ok('de app opent daarna offline nog', !!nav && nav.status === 200, nav && nav.status);
  }

  /* ---------- 6. offline terugval: nooit undefined ---------- */
  kop('6. De installatie beschadigt de bestaande cache niet');
  {
    /* De tien scenario's uit de opdracht draaien hier tegen een levende cache
       onder DEZELFDE naam, want dat is het geval waarin de installatie in de
       cache schrijft waaruit de oude worker nog bedient. */
    /* Kleine letters in beide woorden, zodat replace ze allebei raakt: met
       'APP OUD' greep die niet en was 'nieuw' stilletjes gelijk aan 'oud'. */
    const OUD = { './': 'index oud', './index.html': 'index oud', './events.html': 'app oud',
                  './manifest.json': '{"v":1}', './icon.svg': 'icoon oud' };
    const NIEUW = {};
    Object.keys(OUD).forEach((u) => { NIEUW[ORIGIN + u.replace('./', '/').replace('//', '/')] =
                                        OUD[u].replace('oud', 'nieuw').replace('"v":1', '"v":2'); });
    const metVorige = async (opties) => {
      const env = swOmgeving(Object.assign({ inhoud: NIEUW }, opties));
      await env.caches.open(CACHE_NAAM);
      const c = env.store.get(CACHE_NAAM);
      Object.keys(OUD).forEach((u) => {
        c.set(new URL(u, SCOPE).href, new env.Res(OUD[u], { type: 'basic' }));
      });
      /* de buren erbij, anders toetst de controle daarop niets */
      env.store.set('golf-score-v41', new Map([[ORIGIN + '/golf-score.html', 'golf']]));
      env.store.set('trends-v17', new Map([[ORIGIN + '/trends.html', 'trends']]));
      env.schrijfLog.length = 0;
      const fout = await installeer(env);
      return { env, fout, app: async () => tekst(await (await env.caches.open(CACHE_NAAM)).match(ORIGIN + '/events.html')) };
    };

    {
      const { env, fout, app } = await metVorige({});
      ok('een update met een bestaande cache slaagt', fout === null, fout && fout.message);
      ok('en de app is daarna de nieuwe', (await app()) === 'app nieuw', await app());
      ok('het verplichte bestand wordt als laatste weggeschreven',
         env.schrijfLog[env.schrijfLog.length - 1] === '/events.html', env.schrijfLog.join(' '));
      const c = env.store.get(CACHE_NAAM);
      ok('er is niets van de vorige deploy overgebleven',
         [...c.values()].every((r) => !/oud|"v":1/i.test(r.body)),
         [...c.entries()].filter(([, r]) => /oud/i.test(r.body)).map(([k]) => k).join());
      await vuur(env, 'activate');
      env.zetOffline();
      const nav = await vraagVan(env)(ORIGIN + '/events.html', 'navigate');
      ok('offline starten na een geslaagde update geeft de nieuwe app',
         (await tekst(nav)) === 'app nieuw', await tekst(nav));
    }
    {
      /* Het gebrek dat de meting blootlegde: een geweigerde schrijfactie op een
         optioneel bestand liet de hele installatie mislukken. */
      const { env, fout, app } = await metVorige({ weigerPut: ['/icon.svg'] });
      ok('een geweigerde schrijfactie op een optioneel bestand laat de installatie slagen',
         fout === null, fout && fout.message);
      ok('en de app is toch bijgewerkt', (await app()) === 'app nieuw', await app());
      const icoon = await (await env.caches.open(CACHE_NAAM)).match(ORIGIN + '/icon.svg');
      ok('het bestand dat niet lukte staat er nog in zijn oude vorm',
         (await tekst(icoon)) === 'icoon oud', await tekst(icoon));
    }
    {
      /* En het geval dat echt kwaad zou kunnen: de app zelf is niet te
         schrijven. Dan moet de vorige app onaangeroerd blijven. */
      const { env, fout, app } = await metVorige({ weigerPut: ['/events.html'] });
      ok('kan de app niet worden weggeschreven, dan mislukt de installatie', fout !== null,
         fout && fout.name);
      /* Eerst kijken of de cache er nog is en pas daarna de inhoud lezen: lezen
         gaat via caches.open, en dat maakt een ontbrekende cache opnieuw aan.
         Andersom neutraliseerde de meting haar eigen bewijs. */
      const nogDaar = env.store.has(CACHE_NAAM);
      ok('de cache is niet gewist', nogDaar, [...env.store.keys()].join());
      ok('en blijft de vorige werkende app in de cache staan', (await app()) === 'app oud',
         await app());
      env.zetOffline();
      const nav = await vraagVan(env)(ORIGIN + '/events.html', 'navigate');
      ok('offline starten na een mislukte installatie geeft de oude, werkende app',
         (await tekst(nav)) === 'app oud', await tekst(nav));
    }
    {
      const { fout, app } = await metVorige({ server: ['./', './index.html', './manifest.json', './icon.svg'] });
      ok('een mislukte download van de app laat de installatie mislukken', fout !== null);
      ok('en ook dan blijft de vorige app staan', (await app()) === 'app oud', await app());
    }
    {
      const { env, fout, app } = await metVorige({ server: ['./', './index.html', './events.html', './manifest.json'] });
      ok('een mislukte download van een optioneel bestand blokkeert niets', fout === null);
      ok('en de app wordt gewoon bijgewerkt', (await app()) === 'app nieuw', await app());
      ok('de caches van de buren blijven ongemoeid',
         env.store.has('golf-score-v41') && env.store.has('trends-v17'),
         [...env.store.keys()].join());
    }
  }

  {
    /* Gat 4: alleen een geldig, eigen antwoord mag de cache in. Deze voorwaarde
       was nergens gedekt -- je kon 'res.status === 200 && res.type === basic'
       helemaal weghalen zonder dat er iets rood werd, en dan belandt een 404
       als cacheregel en wordt die daarna permanent als treffer geleverd. */
    const env = swOmgeving({ server: ['./', './index.html', './events.html', './manifest.json'] });
    await installeer(env);
    await vuur(env, 'activate');
    const res = await vraagVan(env)(ORIGIN + '/icon.svg');
    ok('een 404 wordt wel doorgegeven', !!res && res.status === 404,
       res ? res.status : 'niet afgehandeld');
    await rust();
    ok('maar belandt niet in de cache',
       !sleutels(env).some((k) => k.endsWith('/icon.svg')),
       sleutels(env).filter((k) => k.endsWith('/icon.svg')).join());
    const nog = await vraagVan(env)(ORIGIN + '/icon.svg');
    /* nog kan undefined zijn als het bestand niet meer bij de app hoort; dan
       handelt de worker het niet af en is er ook geen cachetreffer */
    ok('en wordt dus niet daarna als cachetreffer geleverd',
       !nog || nog.status === 404, nog ? nog.status : 'niet afgehandeld');
  }
  {
    const env = swOmgeving({ corsVoor: ['/icon.svg'] });
    await installeer(env);
    await vuur(env, 'activate');
    /* niet rechtstreeks lezen: bij een gesloopte worker bestaat deze cache niet
       en dan crashte de hele bundel in plaats van rood te worden */
    (env.store.get(CACHE_NAAM) || new Map()).delete(ORIGIN + '/icon.svg');
    const res = await vraagVan(env)(ORIGIN + '/icon.svg');
    ok('een antwoord van elders wordt doorgegeven', !!res && res.status === 200,
       res ? res.status : 'niet afgehandeld');
    await rust();
    ok('maar niet bewaard, want het is geen eigen antwoord',
       !sleutels(env).some((k) => k.endsWith('/icon.svg')),
       sleutels(env).filter((k) => k.endsWith('/icon.svg')).join());
  }
  {
    /* Gat 5: de origincontrole werd gemaskeerd door de padcontrole. Elk vreemd
       domein in de tests had ook een vreemd pad, dus de controle slaagde ook
       zonder die origincontrole. Dit is een vreemd domein met een EIGEN padnaam. */
    const env = swOmgeving();
    await installeer(env);
    await vuur(env, 'activate');
    const vraag = vraagVan(env);
    ok('een vreemd domein met onze eigen padnaam wordt niet afgehandeld',
       (await vraag('https://kwaad.example.com/events.html', 'navigate')) === undefined,
       'anders bedient de worker van Events een pagina van elders');
    ok('ook niet voor een gewoon bestand',
       (await vraag('https://kwaad.example.com/icon.svg')) === undefined);
    await rust();
    ok('en er staat niets van dat domein in de cache',
       !sleutels(env).some((k) => k.indexOf('kwaad.example.com') >= 0), sleutels(env).join());
  }
  {
    /* Gat 6: de tak voor een cachelijst die niet te bevragen is. Die stond er
       bewust -- het zekere voor het onzekere, niets wissen -- maar was in de
       tests dood en kon worden omgedraaid zonder gevolg. */
    const env = swOmgeving({ keysStuk: true,
                             server: ['./', './index.html', './manifest.json', './icon.svg'] });
    await env.caches.open(CACHE_NAAM).catch(() => {});
    (env.store.get(CACHE_NAAM) || new Map())
      .set(ORIGIN + '/events.html', new env.Res('DE WERKENDE APP'));
    const fout = await installeer(env);
    ok('een onbevraagbare cachelijst laat de installatie mislukken', fout !== null,
       fout && fout.message);
    ok('maar wist de bestaande cache niet', env.store.has(CACHE_NAAM),
       'bij twijfel niets wissen');
    const app = await (await env.caches.open(CACHE_NAAM)).match(ORIGIN + '/events.html');
    ok('en de offline-kopie staat er nog', (await tekst(app)) === 'DE WERKENDE APP');
  }

  kop('7. Offline terugval');
  {
    const env = swOmgeving();
    await installeer(env);
    await vuur(env, 'activate');
    env.zetOffline();
    (env.store.get(CACHE_NAAM) || new Map()).clear();     // browser ruimde de cache op
    const nav = await vraagVan(env)(ORIGIN + '/events.html', 'navigate');
    ok('lege cache offline geeft geen undefined of fout', nav !== undefined && !nav.stuk);
    ok('maar een offlinepagina', !!nav && nav.status === 503, nav && nav.status);
    ok('met uitleg in het Nederlands', /Events is offline/.test(await tekst(nav)));
    ok('als HTML, zodat de browser hem toont', !!nav && !!nav.headers && /text\/html/.test(nav.headers.get('Content-Type') || ''));
    const bestand = await vraagVan(env)(ORIGIN + '/icon.svg');
    ok('een gewoon bestand krijgt geen HTML-pagina', !!bestand && !!bestand.headers && !/text\/html/.test(bestand.headers.get('Content-Type') || ''));
  }
  {
    /* Eén cacheregel is weg, events.html staat er nog: dan valt een navigatie terug op
       de bewaarde app in plaats van op de offlinepagina. */
    const env = swOmgeving({ inhoud: { [ORIGIN + '/events.html']: 'DE APP' } });
    await installeer(env);
    await vuur(env, 'activate');
    (env.store.get(CACHE_NAAM) || new Map()).delete(ORIGIN + '/');
    env.zetOffline();
    const map = await vraagVan(env)(ORIGIN + '/', 'navigate');
    ok('een pad zonder cacheregel valt terug op de bewaarde app',
       !!map && map.status === 200, map && map.status);
    ok('en dat is werkelijk de app', (await tekst(map)) === 'DE APP');
  }
  {
    const env = swOmgeving({ cacheStuk: true });
    env.maakSw();
    const res = await vraagVan(env)(ORIGIN + '/events.html', 'navigate');
    ok('geweigerde cacheopslag geeft toch een antwoord',
       res !== undefined && !res.stuk && res.status === 503,
       res && (res.stuk ? 'de worker gooide' : res.status));
  }
  {
    /* Een netwerk dat blijft hangen mag het tabblad niet vasthouden. De grens staat in
       de worker op 10 s; hier op 120 ms, want het gaat om het mechanisme. */
    const g = /const GRENS = (\d+);/.exec(SW);
    ok('de worker kent een uiterste wachttijd', !!g, g && g[1] + ' ms');
    ok('en die is ruim genoeg voor een trage verbinding', !!g && +g[1] >= 2000);
    const env = swOmgeving({ hangt: true });
    env.maakSw(SW.replace(/const GRENS = \d+;/, 'const GRENS = 120;'));
    const begin = Date.now();
    const res = await Promise.race([
      vraagVan(env)(ORIGIN + '/events.html', 'navigate'),
      new Promise((r) => setTimeout(() => r('BLEEF HANGEN'), 2500))
    ]);
    ok('een hangend netwerk levert toch een antwoord',
       res !== 'BLEEF HANGEN' && res !== undefined, res === 'BLEEF HANGEN' ? 'bleef hangen' : '');
    ok('en dat is de offlinepagina', !!res && res !== 'BLEEF HANGEN' && res.status === 503,
       res && res.status);
    ok('binnen de grens', Date.now() - begin < 2500, (Date.now() - begin) + ' ms');
    ok('het verzoek is meegegeven met een afbreeksignaal',
       env.log.length > 0 && env.log[env.log.length - 1].signaal === true);
    await rust();
    ok('en het is werkelijk afgebroken, niet alleen losgelaten',
       env.afgebroken.length === 1, env.afgebroken.length + ' afgebroken');
  }

  kop('8. Twee grenzen: het blokkerende pad kort, de verversing ruim');
  {
    const g = /const GRENS = (\d+);/.exec(SW);
    const ga = /const GRENS_ACHTERGROND = (\d+);/.exec(SW);
    ok('de worker kent een aparte grens voor de achtergrondverversing', !!ga, ga && ga[1] + ' ms');
    ok('en die is ruimer dan het blokkerende pad', !!ga && !!g && +ga[1] > +g[1],
       ga && g ? ga[1] + ' > ' + g[1] : '');
    ok('de keuze hangt af van een cachetreffer',
       /metGrens\(e\.request, gecached \? GRENS_ACHTERGROND : GRENS\)/.test(SW));
  }
  {
    /* Gedrag, niet alleen de bron: met een cachetreffer en een netwerk dat
       blijft hangen moet het afbreken op de RUIME grens vallen en niet op de
       krappe. Beide getallen hier omlaag, want het gaat om het mechanisme. */
    const env = swOmgeving({ hangt: true });
    env.maakSw(SW.replace(/const GRENS = \d+;/, 'const GRENS = 60;')
                 .replace(/const GRENS_ACHTERGROND = \d+;/, 'const GRENS_ACHTERGROND = 500;'));
    const c = await env.caches.open(CACHE_NAAM);
    await c.put(ORIGIN + '/events.html', new env.Res('UIT DE CACHE', { type: 'basic' }));
    const begin = Date.now();
    const res = await vraagVan(env)(ORIGIN + '/events.html', 'navigate');
    ok('bij een cachetreffer komt het antwoord meteen', (await tekst(res)) === 'UIT DE CACHE',
       await tekst(res));
    ok('en niemand wacht op het netwerk', Date.now() - begin < 60, (Date.now() - begin) + ' ms');
    await new Promise((r) => setTimeout(r, 900));
    ok('de verversing is afgebroken', env.afgebroken.length === 1, env.afgebroken.length + '');
    const na = env.afgebroken[0] ? env.afgebroken[0].na : -1;
    ok('maar pas op de ruime grens, niet op de krappe', na >= 400, na + ' ms');
  }

  await deel7();
})().catch((e) => afbreken('onverwachte uitzondering', e));

/* ---------- 7. de app: versiecontrole en herladen ---------- */
async function deel7() {
kop('9. De versiecontrole in de app');
{
  /* Deze namaak negeerde eerst zijn argumenten: match() had geen parameters, dus
     noch de URL noch { ignoreSearch: true } kwam aan. Een verkeerde cachesleutel
     in checkAppUpdate bleef daardoor onzichtbaar. Nu wordt er werkelijk op
     sleutel gezocht, met dezelfde zoekstringregel als de Cache API. */
  const nepCache = (naam, tekst, extra) => {
    const geopend = [];
    const inhoud = {};
    if (naam && tekst !== null) inhoud[(extra && extra.sleutel) || (ORIGIN + '/events.html')] = tekst;
    const namen = naam
      ? [naam].concat((Array.isArray(extra) ? extra : []), ['trends-v17', 'golf-score-v41'])
      : ['trends-v17'];
    return {
      geopend,
      keys: async () => namen,
      open: async (n) => {
        geopend.push(n);
        return {
          match: async (sleutel, o) => {
            if (n !== naam) return undefined;
            const url = new URL(String(sleutel), SCOPE).href;
            if (inhoud[url] !== undefined) return { text: async () => inhoud[url] };
            if (o && o.ignoreSearch) {
              const pad = url.split('?')[0];
              for (const k of Object.keys(inhoud)) {
                if (k.split('?')[0] === pad) return { text: async () => inhoud[k] };
              }
            }
            return undefined;
          }
        };
      }
    };
  };
  /* Een opslag met per cache zijn EIGEN inhoud. nepCache hierboven geeft maar
     een cache inhoud; voor 'welk stempel wint er tussen twee caches' is dat
     niet genoeg, want dan komt er bij elke keuze hetzelfde uit. Waarde null =
     de cache bestaat maar bevat geen events.html, 'stuk' = de cache is niet te
     openen. */
  const nepCaches = (kaarten) => {
    const geopend = [];
    const namen = Object.keys(kaarten).concat(['trends-v17', 'golf-score-v41']);
    return {
      geopend,
      keys: async () => namen,
      open: async (n) => {
        geopend.push(n);
        const v = kaarten[n];
        if (v === 'stuk') throw new Error('cache niet te openen');
        return { match: async () => (v === null || v === undefined)
                   ? undefined : { text: async () => v } };
      }
    };
  };

  /* HEX(20261014) en HEX(20261015): twee opeenvolgende dagen. st(n) maakt daar
     een volledig stempel van, zodat de gevallen hieronder met gewone getallen
     te lezen blijven; een tekst wordt ongemoeid doorgegeven. */
  const DAG = '1352896', MORGEN = '1352897';
  const st = (n) => typeof n === 'number'
    ? DAG + '-' + ('00' + n.toString(16).toUpperCase()).slice(-3) : n;
  /* De app leest zijn eigen stempel uit het scherm, dus hier een nagemaakt
     document dat alleen dat ene element kent. null = geen stempel, zoals een
     pagina van voor de overstap. */
  const bouw = (eigen) => {
    const ctx = { nieuweInhoud: false, getekend: 0 };
    const fn = new Function('ctx', 'location', 'document', [
      'var nieuweInhoud = false;',
      'function render(){ ctx.getekend++; ctx.nieuweInhoud = nieuweInhoud; }',
      'var window = { caches: null };',
      haal('appStempel'),
      haal('cacheOpslag'),
      haal('nieuwsteStempelUitCache'),
      haal('checkAppUpdate'),
      'return { checkAppUpdate: checkAppUpdate, lees: function(){ return nieuweInhoud; },',
      '         eigenStempel: appStempel };'
    ].join('\n'))(ctx, { href: SCOPE + 'events.html' }, {
      getElementById: (id) => id === 'appVersieStempel'
        ? { textContent: eigen === null ? '' : 'Versie ' + st(eigen) } : null
    });
    return { ctx, ...fn };
  };
  const app_ = (n) => 'Versie ' + st(n) + '\n/* verder niets */';

  const a = bouw(100);
  ok('de app leest zijn eigen stempel uit het scherm',
     a.eigenStempel() === st(100), a.eigenStempel());
  ok('een hoger stempel in de kopie is een nieuwe versie',
     (await uitkomst(a.checkAppUpdate(nepCache('events-v100', app_(101))))) === true);
  ok('en dat wordt gemeld', a.lees() === true && a.ctx.getekend === 1);

  const b = bouw(100);
  ok('hetzelfde stempel is geen nieuwe versie',
     (await uitkomst(b.checkAppUpdate(nepCache('events-v100', app_(100))))) === false);
  ok('een lager volgnummer ook niet',
     (await uitkomst(b.checkAppUpdate(nepCache('events-v100', app_(99))))) === false);
  /* De dag weegt zwaarder dan het volgnummer -- dat is de hele reden dat beide
     delen een vaste lengte hebben. Volgnummer FFF van vandaag is ouder dan 001
     van morgen, en een gewone tekstvergelijking hoort dat zo te zien. */
  ok('een hoog volgnummer van een eerdere dag is ouder',
     (await uitkomst(bouw(MORGEN + '-001')
        .checkAppUpdate(nepCache('events-v100', app_(DAG + '-FFF'))))) === false);
  ok('en een laag volgnummer van een latere dag is nieuwer',
     (await uitkomst(bouw(DAG + '-FFF')
        .checkAppUpdate(nepCache('events-v100', app_(MORGEN + '-001'))))) === true);
  /* Een kopie van voor de overstap draagt geen stempel maar wel een APP_VERSIE,
     en moet als ouder gelden -- anders meldt de app bij iedereen die nog zo'n
     kopie heeft staan een "nieuwe" versie die juist de oude is. */
  ok('een kopie van voor de overstap is geen nieuwe versie',
     (await uitkomst(b.checkAppUpdate(nepCache('events-v100', 'var APP_VERSIE = 999;')))) === false);
  ok('een kopie zonder stempel ook niet',
     (await uitkomst(b.checkAppUpdate(nepCache('events-v100', 'niets hierin')))) === false);
  /* En omgekeerd: een pagina zonder eigen stempel meldt niets, in plaats van
     alles te melden omdat '' kleiner is dan elke tekst. */
  ok('zonder eigen stempel wordt er niets gemeld',
     (await uitkomst(bouw(null).checkAppUpdate(nepCache('events-v100', app_(MORGEN + '-001'))))) === false);
  ok('een cache zonder events.html ook niet',
     (await uitkomst(b.checkAppUpdate(nepCache('events-v100', null)))) === false);
  ok('en zonder eigen cache evenmin', (await uitkomst(b.checkAppUpdate(nepCache(null, null)))) === false);
  ok('een stukke cacheopslag levert geen uitzondering',
     (await uitkomst(b.checkAppUpdate({ keys: async () => { throw new Error('stuk'); } }))) === false);
  ok('er is niets gemeld dat niet waar is', b.lees() === false);

  /* Twee eigen caches naast elkaar. Niet 'de hoogste cachenaam wint' maar 'het
     nieuwste stempel wint', zoals conventies.md het voorschrijft en trends het
     al doet. De cachenaam gaat namelijk alleen omhoog als sw-events.js wijzigt,
     dus het nieuwste stempel staat niet per se in de hoogst genummerde cache. */
  const twee = nepCaches({ 'events-v160': app_(99), 'events-v99': app_(101) });
  ok('tussen twee eigen caches wint het nieuwste stempel, niet de hoogste naam',
     (await uitkomst(b.checkAppUpdate(twee))) === true,
     'events-v99 draagt het nieuwste stempel');
  ok('en alleen eigen caches worden geopend',
     twee.geopend.every((n) => n.indexOf('events-') === 0) && twee.geopend.length === 2,
     twee.geopend.join());
  /* Een afgebroken installatie laat een lege huls achter: de cache bestaat, met
     een hoger nummer, maar zonder events.html. Daarop viel de melding eerder
     weg, terwijl het nieuwe stempel in de cache ernaast stond. */
  const huls = nepCaches({ 'events-v161': null, 'events-v160': app_(101) });
  ok('een lege huls met een hoger nummer laat de melding niet vervallen',
     (await uitkomst(b.checkAppUpdate(huls))) === true,
     'events-v161 is leeg, events-v160 heeft het nieuwe stempel');
  /* En hetzelfde als die cache niet te openen is. */
  const stuk = nepCaches({ 'events-v161': 'stuk', 'events-v160': app_(101) });
  ok('een stukke cache telt niet mee, de rest wel',
     (await uitkomst(b.checkAppUpdate(stuk))) === true,
     'events-v161 werpt, events-v160 heeft het nieuwe stempel');
  /* Dezelfde twee caches, maar nu staat het nieuwste stempel VOORAAN. Zonder
     dit geval kon 'nieuwste' worden vervangen door 'de laatste die ik tegenkom'
     zonder dat er iets rood werd, want hierboven komt het nieuwste stempel
     toevallig als laatste langs. */
  const omgekeerd = nepCaches({ 'events-v99': app_(101), 'events-v160': app_(99) });
  ok('ook als het nieuwste stempel vooraan staat wint het',
     (await uitkomst(b.checkAppUpdate(omgekeerd))) === true,
     'events-v99 komt als eerste langs en draagt het nieuwste stempel');
  ok('twee oude kopieen leveren geen melding',
     (await uitkomst(b.checkAppUpdate(
        nepCaches({ 'events-v160': app_(99), 'events-v99': app_(98) })))) === false);

  /* Zonder eigen cache hoort er geen enkele cache te worden geopend. Hier doet
     de filter op 'events-' werkelijk iets: zonder die filter zou de app de
     caches van de buurapps openen en daarin naar events.html zoeken, en kon
     een vreemde kopie meebeslissen over de melding. */
  const geen = nepCache(null, null);
  ok('zonder eigen cache wordt er geen nieuwe versie gemeld',
     (await uitkomst(b.checkAppUpdate(geen))) === false);
  ok('en wordt er geen enkele cache geopend', geen.geopend.length === 0,
     geen.geopend.join() || 'geen');

  /* Een cache die door een oudere worker is gevuld, met de zoekstring nog in de
     sleutel. Daar is de ignoreSearch in checkAppUpdate voor; zonder dat geval
     doet die optie niets, want een relatieve URL laat de zoekstring toch al
     vallen. Op een toestel dat lang niet is bijgewerkt kan zo'n cache er nog
     staan. */
  const oudeSleutel = nepCache('events-v100', app_(101),
                               { sleutel: ORIGIN + '/events.html?cfg=werk.json' });
  ok('een kopie die onder een oude sleutel met zoekstring staat wordt gevonden',
     (await uitkomst(b.checkAppUpdate(oudeSleutel))) === true,
     'daar is de ignoreSearch voor');
}

kop('10. Afknijpen van de serviceworker-update');
{
  const fn = new Function([
    'var SW_UPDATE_INTERVAL = ' + (/var SW_UPDATE_INTERVAL = ([^;]+);/.exec(SCRIPT)[1]) + ';',
    'var swUpdateLaatst = 0, swRegistratie = null;',
    haal('vraagSwUpdate'),
    'return { vraagSwUpdate: vraagSwUpdate,',
    '         zetLaatst: function(t){ swUpdateLaatst = t; },',
    '         interval: SW_UPDATE_INTERVAL };'
  ].join('\n'))();
  let aangeroepen = 0;
  const reg = { update: () => { aangeroepen++; return Promise.resolve(); } };
  ok('zonder bruikbare registratie geen aanroep', fn.vraagSwUpdate({}) === false);
  ok('eerste aanroep gaat door', fn.vraagSwUpdate(reg) === true && aangeroepen === 1);
  ok('tweede aanroep er meteen achteraan niet', fn.vraagSwUpdate(reg) === false && aangeroepen === 1);
  fn.zetLaatst(Date.now() - fn.interval - 1);
  ok('na het interval mag het weer', fn.vraagSwUpdate(reg) === true && aangeroepen === 2);
  fn.zetLaatst(0);
  ok('een mislukte update werpt niet',
     fn.vraagSwUpdate({ update: () => Promise.reject(new Error('offline')) }) === true);
  ok('het interval is een half uur', fn.interval === 30 * 60 * 1000, fn.interval + ' ms');
}

kop('11. Herladen met een wachtende worker');
{
  const bouw = (opzet) => {
    const ctx = { berichten: [], herladen: 0, klokken: [] };
    const fn = new Function('ctx', [
      'var overstapGevraagd = ' + (opzet.gevraagd ? 'true' : 'false') + ';',
      'var nieuweVersie = ' + (opzet.wachtend
        ? '{ postMessage: function(m){ ctx.berichten.push(m && m.type); } }' : 'null') + ';',
      'var nieuweInhoud = ' + (opzet.inhoud ? 'true' : 'false') + ';',
      'var location = { reload: function(){ ctx.herladen++; } };',
      /* De echte functie, niet een stub. Hier stond 'return true/false', dus de
         app kon magHerladen kwijtraken -- of alleen de schrijfBezig-term -- zonder
         dat er iets rood werd. En dat is juist de poort die voorkomt dat een
         nieuwe versie middenin een schrijfactie herlaadt. */
      'var schrijfBezig = ' + (opzet.schrijfBezig ? 'true' : 'false') + ';',
      'var wijzigVersie = ' + (opzet.magNiet ? '2' : '1') + ', bewaardeVersie = 1;',
      haal('nietOpgeslagen'),
      haal('magHerladen'),
      'function setTimeout(f){ ctx.klokken.push(f); return 0; }',
      haal('magHerladenEenmaal'),
      haal('herlaadEenmaal'),
      haal('stapOverNaarNieuweVersie'),
      'return { stapOver: stapOverNaarNieuweVersie, eenmaal: herlaadEenmaal,',
      '         magEenmaal: magHerladenEenmaal };'
    ].join('\n'))(ctx);
    return { ctx, ...fn };
  };

  {
    const t = bouw({ wachtend: true });
    t.stapOver();
    ok('met een wachtende worker wordt er eerst om de overstap gevraagd',
       t.ctx.berichten.join() === 'nuOverstappen', t.ctx.berichten.join());
    ok('en nog niet herladen', t.ctx.herladen === 0);
    t.eenmaal();                                   // alsof controllerchange afgaat
    ok('zodra de worker het overneemt wordt er herladen', t.ctx.herladen === 1);
    t.ctx.klokken.forEach((f) => f());             // en dan ook nog de terugvalklok
    ok('en niet twee keer', t.ctx.herladen === 1);
  }
  {
    const t = bouw({ wachtend: true });
    t.stapOver();
    t.ctx.klokken.forEach((f) => f());             // de worker reageert niet
    ok('reageert de worker niet, dan herlaadt de terugvalklok', t.ctx.herladen === 1);
    t.eenmaal();
    ok('en ook dan maar een keer', t.ctx.herladen === 1);
  }
  {
    const t = bouw({ inhoud: true });
    t.stapOver();
    ok('zonder wachtende worker is herladen genoeg', t.ctx.herladen === 1 && t.ctx.berichten.length === 0);
  }
  {
    const t = bouw({ wachtend: true, magNiet: true });
    t.stapOver();
    ok('met iets dat niet is opgeslagen gebeurt er niets',
       t.ctx.herladen === 0 && t.ctx.berichten.length === 0);
  }
  {
    const t = bouw({ gevraagd: false });
    ok('zonder verzoek om over te stappen nooit herladen', t.magEenmaal() === false);
  }
  {
    /* De twee voorwaarden van magHerladen apart. Zonder deze controles kon de
       schrijfBezig-term verdwijnen zonder dat er iets rood werd, en dan herlaadt
       een nieuwe versie middenin een schrijfactie. */
    const t = bouw({ wachtend: true, schrijfBezig: true });
    t.stapOver();
    ok('tijdens een schrijfactie wordt er niet overgestapt',
       t.ctx.herladen === 0 && t.ctx.berichten.length === 0,
       'alles is opgeslagen, maar er wordt nog geschreven');
    const u = bouw({ wachtend: true });
    u.stapOver();
    ok('en zonder schrijfactie en zonder eigen wijziging wel',
       u.ctx.berichten.join() === 'nuOverstappen');
  }
}

await rust();
/* Dit telt zowel een losse belofte uit de worker als een uit de bundel zelf. De
   tekst noemt daarom niet alleen de worker: hem aan de worker toeschrijven was
   misleidend zodra de fout uit de testcode kwam. */
ok('er is geen afgewezen belofte onbehandeld gebleven (worker of bundel)',
   losseFouten.length === 0, losseFouten.slice(0, 3).join(' / '));

/* ---------- 12. Het bestand buiten de app gewijzigd ---------- */
kop('12. Externe wijzigingen aan het gegevensbestand');
/* Eerst kijken of de functies er zijn. Zonder deze controle crasht de bundel op
   een oudere events.html en krijg je een stacktrace in plaats van te zien wat
   er mist -- dan lijkt er niets te zijn mislukt. */
const AANWEZIG = ['regelVan', 'kijkExtern', 'herleesExtern', 'externGewijzigd']
  .filter((n) => !new RegExp('^function ' + n + '\\s*\\(', 'm').test(SCRIPT));
if (AANWEZIG.length) {
  AANWEZIG.forEach((n) => ok('events.html heeft de functie ' + n, false, 'ontbreekt'));
} else {
{
  /* De parser en serializer letterlijk uit de app, met de echte veldnamen. Het
     ontwerpprincipe is dat het bestand ook met een teksteditor te bewerken is,
     dus deze controles gaan over wat er met handwerk gebeurt. */
  const bouw = () => new Function([
    SCRIPT.match(/^var VELDEN = [^;]*;/m)[0],
    'var VELD_MAX = VELDEN.length;',
    'var VELD_MIN = VELD_MAX - 1;',
    'var cfg = {}, volgnr = 0, terug = null, records = [];',
    haal('sep'), haal('parse'), haal('regelVan'), haal('serialize'),
    haal('zonderAccent'), haal('sorteerSleutel'), haal('sorteer'),
    'return { parse:parse, serialize:serialize, regelVan:regelVan, sorteer:sorteer,',
    '         zet:function(r){ records = r; }, lees:function(){ return records; } };'
  ].join('\n'))();

  const app = bouw();
  const rond = (tekst) => { app.zet(app.parse(tekst)); return app.serialize(); };
  const onbegrepen = (tekst) => app.parse(tekst).filter((r) => r.raw !== undefined).length;

  const BASIS = '15;Sinka Arvenlo;verjaardag;D19780315;1\n' +
                '03;Jan de Vries;verjaardag;D19650703;2;met notitie\n' +
                '21;Huwelijk;jubileum;D20010921;3\n';

  ok('een onveranderd bestand komt letterlijk hetzelfde terug', rond(BASIS) === BASIS);
  const bij = BASIS + '09;Nieuw Persoon;verjaardag;D19900409;2\n';
  ok('een met de hand toegevoegd event blijft heel', rond(bij) === bij);
  const anders = BASIS.replace('Sinka Arvenlo', 'Sinka Arvenlo-Dreskwo');
  ok('een met de hand gewijzigd event blijft heel', rond(anders) === anders);
  const minder = BASIS.split('\n').filter((_, i) => i !== 1).join('\n');
  ok('een met de hand verwijderd event verdwijnt en de rest blijft heel',
     rond(minder) === minder && app.parse(minder).length === 2);
  const omgekeerd = BASIS.split('\n').filter(Boolean).reverse().join('\n') + '\n';
  ok('een andere regelvolgorde kost niets', rond(omgekeerd) === omgekeerd);
  const metEigen = BASIS + '# mijn eigen aantekening, geen event\n';
  ok('een onbekende regel blijft letterlijk staan', rond(metEigen) === metEigen);
  ok('en wordt als onbegrepen geteld', onbegrepen(metEigen) === 1);
  const middenin = '15;Sinka Arvenlo;verjaardag;D19780315;1\nzomaar iets\n' +
                   '03;Jan de Vries;verjaardag;D19650703;2;met notitie\n';
  ok('ook middenin het bestand', rond(middenin) === middenin);
  const puntkomma = '15;Sinka;verjaardag;D19780315;1;eerst dit; daarna dat\n';
  ok('een puntkomma in de notitie maakt de regel onbegrepen maar laat hem staan',
     rond(puntkomma) === puntkomma && onbegrepen(puntkomma) === 1);

  /* Hier zat een stille herschrijving: parseInt(f[4],10) || 2 maakte van een 0,
     van een leeg veld en van tekst een 2. */
  const nul = '15;Sinka Arvenlo;verjaardag;D19780315;0\n';
  ok('een categorie 0 blijft staan zoals getypt', rond(nul) === nul, rond(nul).trim());
  ok('en wordt niet stil een 2', app.parse(nul)[0].cat === 0, app.parse(nul)[0].cat);
  /* Een leeg of niet-numeriek categorieveld blijft een event. Zulke regels als
     onbegrepen behandelen zou bestaande events uit de lijst laten verdwijnen --
     de zelftest heeft er zelf twee. Ze krijgen categorie 1, de eerste, die er
     altijd is; het rapport noemt ze apart onder "Categorie niet te lezen". */
  const leegCat = '15;Sinka Arvenlo;verjaardag;D19780315;\n';
  ok('een leeg categorieveld blijft een event', onbegrepen(leegCat) === 0);
  ok('en krijgt de eerste categorie', app.parse(leegCat)[0].cat === 1,
     app.parse(leegCat)[0].cat);
  const tekstCat = '15;Sinka Arvenlo;verjaardag;D19780315;twee\n';
  ok('tekst in het categorieveld ook', app.parse(tekstCat)[0].cat === 1);
  /* Hier stond alleen regelVan tegen de ingevoerde regel; serialize kwam in de
     assertie niet voor, terwijl de naam dat wel beweerde. Nu werkelijk de twee
     tegen elkaar. */
  {
    const r = app.parse(BASIS);
    app.zet(r);
    ok('serialize zet precies de regels van regelVan achter elkaar',
       app.serialize() === r.map(app.regelVan).join('\n') + '\n');
  }
}

{
  /* De botsingscontrole: drie uitkomsten, want 'de controle kon niet worden
     uitgevoerd' is iets anders dan 'niet gewijzigd'. */
  const maak = (bestand, gelezen, grootte) => {
    const ctx = {};
    const fn = new Function('ctx', [
      'var laatstGelezen = ' + (gelezen === null ? 'null' : gelezen) + ';',
      'var laatstGrootte = ' + (grootte === null ? 'null' : grootte) + ';',
      'var bestandsnaam = "events_mark.txt";',
      'var dirHandle = { getFileHandle: function(){ return ctx.geef(); } };',
      haal('externGewijzigd'),
      'return externGewijzigd;'
    ].join('\n'))(ctx);
    ctx.geef = bestand;
    return fn;
  };
  const bestand = (lm, size) => () => Promise.resolve({ getFile: () => Promise.resolve({ lastModified: lm, size: size }) });
  const werpt = (naam) => () => { const e = new Error(naam); e.name = naam; return Promise.reject(e); };

  ok('zelfde tijd en grootte is niet gewijzigd',
     (await maak(bestand(1000, 50), 1000, 50)()) === 'gelijk');
  ok('een andere wijzigingstijd is wel gewijzigd',
     (await maak(bestand(2000, 50), 1000, 50)()) === 'anders');
  ok('en een andere grootte bij dezelfde tijd ook',
     (await maak(bestand(1000, 77), 1000, 50)()) === 'anders', 'metadata, geen inhoud');
  ok('een bestand dat niet bestaat valt er niets te overschrijven',
     (await maak(werpt('NotFoundError'), 1000, 50)()) === 'gelijk');
  ok('een ingetrokken machtiging geldt niet als ongewijzigd',
     (await maak(werpt('NotAllowedError'), 1000, 50)()) === 'onbekend');
  ok('een willekeurige leesfout ook niet',
     (await maak(werpt('AbortError'), 1000, 50)()) === 'onbekend');
  ok('nog nooit gelezen levert geen botsing',
     (await maak(bestand(1000, 50), null, null)()) === 'gelijk');
}

{
  /* De tweede aanroeper van externGewijzigd, vlak voor het schrijven. Die was ik
     bij het veranderen van het retourtype vergeten: 'gelijk' is een
     waarheidachtige string, dus zag elke schrijfactie een botsing en mislukte
     vijftien van de zestien. De browsertest vond het; hier staat het nu vast,
     waar het in een seconde draait. */
  const maakHer = (stand) => {
    const ctx = {};
    return new Function('ctx', [
      'var BOTSING = { botsing:true, onbekend:false };',
      'function externGewijzigd(){ return Promise.resolve("' + stand + '"); }',
      haal('hercontroleer'),
      'return function(negeer){ return hercontroleer(negeer).then(function(){ return "door"; },',
      '  function(e){ return e === BOTSING ? (BOTSING.onbekend ? "onbekend" : "botsing") : "fout"; }); };'
    ].join('\n'))(ctx);
  };
  ok('een ongewijzigd bestand laat de schrijfactie door', (await maakHer('gelijk')()) === 'door');
  ok('een gewijzigd bestand houdt de schrijfactie tegen',
     (await maakHer('anders')()) === 'botsing');
  ok('en een mislukte controle ook, als onbekend',
     (await maakHer('onbekend')()) === 'onbekend');
  ok('Toch opslaan gaat er langs', (await maakHer('anders')(true)) === 'door');
}

{
  /* Het slot rond het opslaan. Dat gaat om voordat de botsingscontrole op het
     bestandssysteem wacht, want in dat venster kwam een tweede bewaar() er
     anders langs. Maar daarmee hangt alles wat daarna synchroon omvalt het slot
     op: er kan dan tot een herlaadactie niet meer worden opgeslagen, en
     magHerladen() blijft onwaar omdat de app denkt dat er nog geschreven wordt. */
  const maakB = (hoe) => {
    const ctx = { geschreven: 0, negeerDoorgegeven: null, getekend: 0, botsing: null };
    const fn = new Function('ctx', [
      'var hasFSA = true, dirHandle = {}, bestandsnaam = "events_mark.txt";',
      'var schrijfBezig = false, negeerBotsing = ' + (hoe.negeer ? 'true' : 'false') + ';',
      'var saveState = "";',
      hoe.gooit === 'synchroon'
        ? 'function externGewijzigd(){ throw new TypeError("geen getFileHandle"); }'
        : hoe.gooit === 'belofte'
          ? 'function externGewijzigd(){ return Promise.reject(new TypeError("leesfout")); }'
          : 'function externGewijzigd(){ return Promise.resolve("' + (hoe.stand || 'gelijk') + '"); }',
      'function schrijfEvents(n){ ctx.geschreven++; ctx.negeerDoorgegeven = n;',
      '  schrijfBezig = false; return Promise.resolve(); }',
      'function vraagBotsing(onbekend){ ctx.botsing = onbekend; schrijfBezig = false; }',
      'function render(){ ctx.getekend++; ctx.saveState = saveState; }',
      'function schrijfKlaar(){ schrijfBezig = false; }',
      haal('bewaar'),
      'return { bewaar:bewaar, slot:function(){ return schrijfBezig; } };'
    ].join('\n'))(ctx);
    return { ctx, ...fn };
  };

  {
    const t = maakB({ stand: 'gelijk' });
    t.bewaar();
    await new Promise((r) => setTimeout(r, 10));
    ok('bij een ongewijzigd bestand wordt er gewoon geschreven', t.ctx.geschreven === 1);
    ok('en het slot staat daarna weer open', t.slot() === false);
  }
  {
    const t = maakB({ gooit: 'synchroon' });
    let viel = false;
    try { t.bewaar(); } catch(e){ viel = true; }
    ok('een synchrone uitzondering in de botsingscontrole ontsnapt niet', viel === false);
    await new Promise((r) => setTimeout(r, 10));
    ok('en laat het slot niet hangen', t.slot() === false,
       'met een hangend slot kan er nooit meer worden opgeslagen');
    ok('terwijl er niets is weggeschreven', t.ctx.geschreven === 0);
    ok('en de gebruiker het te zien krijgt', t.ctx.saveState === 'fout', t.ctx.saveState);
    t.bewaar();
    await new Promise((r) => setTimeout(r, 10));
    ok('een tweede poging komt wel langs het slot', t.ctx.getekend >= 2);
  }
  {
    /* Dezelfde fout, maar via de belofte: die kant was al gedekt en moet zo
       blijven, zodat de twee wegen niet uiteen gaan lopen. */
    const t = maakB({ gooit: 'belofte' });
    t.bewaar();
    await new Promise((r) => setTimeout(r, 10));
    ok('een mislukte belofte laat het slot ook niet hangen', t.slot() === false);
    ok('en meldt het net zo', t.ctx.saveState === 'fout', t.ctx.saveState);
  }
  {
    const t = maakB({ negeer: true });
    t.bewaar();
    await new Promise((r) => setTimeout(r, 10));
    ok('Toch opslaan slaat de controle over', t.ctx.geschreven === 1);
    ok('en geeft dat door aan schrijfEvents', t.ctx.negeerDoorgegeven === true);
  }
}

{
  /* kijkExtern: wanneer wordt er gekeken, en wat gebeurt er met het antwoord? */
  const maak = (opzet) => {
    const ctx = { geladen: 0, getekend: 0, gemeld: 0, saveState: '' };
    const fn = new Function('ctx', [
      'var EXTERN_INTERVAL = ' + /var EXTERN_INTERVAL = (\d+);/.exec(SCRIPT)[1] + ';',
      'var externLaatst = 0, externGemeld = false, externBezig = false, externOnbekend = false;',
      'var hasFSA = ' + (opzet.hasFSA === false ? 'false' : 'true') + ';',
      'var dirHandle = ' + (opzet.handle === false ? 'null' : '{}') + ';',
      'var bestandsnaam = ' + (opzet.naam === false ? '""' : '"events_mark.txt"') + ';',
      'var fileState = "' + (opzet.fileState || 'ok') + '";',
      'var schrijfBezig = ' + (opzet.schrijfBezig ? 'true' : 'false') + ';',
      'var herstelRij = ' + (opzet.herstelRij ? '{ tekst:"x" }' : 'null') + ';',
      'var selIndex = -1, records = [], wijzigVersie = 0, saveState = "' + (opzet.saveState || '') + '";',
      'var modalStapel = ' + (opzet.modalOpen ? '["modal"]' : '[]') + ';',
      'var window = { scrollY: 0, scrollTo: function(){} };',
      'function nietOpgeslagen(){ return ' + (opzet.vuil ? 'true' : 'false') + '; }',
      'function render(){ ctx.getekend++; ctx.saveState = saveState; if(externGemeld) ctx.gemeld++; }',
      'function regelVan(){ return ""; }',
      'function laden(){ ctx.geladen++; ' + (opzet.tijdensLezen || '') +
      '  return new Promise(function(r){ setTimeout(r, ' + (opzet.laadDuur || 0) + '); }); }',
      'ctx.stand = "' + (opzet.stand || 'gelijk') + '";',
      opzet.gooit
        ? 'function externGewijzigd(){ throw new TypeError("geen getFileHandle"); }'
        : 'function externGewijzigd(){ return new Promise(function(r){ setTimeout(function(){ r(ctx.stand); }, ' +
          (opzet.controleDuur || 0) + '); }); }',
      'var echteTimeout = setTimeout;',
      haal('kijkExtern'), haal('herleesExtern'),
      'return { kijkExtern:kijkExtern, laatst:function(v){ externLaatst = v; },',
      '         onbekend:function(){ return externOnbekend; },',
      '         zetHerstel:function(v){ herstelRij = v; },',
      '         wijzig:function(){ wijzigVersie++; },',
      '         zetStand:function(v){ ctx.stand = v; } };'
    ].join('\n'))(ctx);
    return { ctx, ...fn };
  };
  const rust2 = () => new Promise((r) => setTimeout(r, 10));

  {
    const t = maak({ stand: 'gelijk' });
    ok('er wordt gekeken als er een bestand gekoppeld is', t.kijkExtern() === true);
    await rust2();
    ok('en bij een ongewijzigd bestand gebeurt er niets',
       t.ctx.geladen === 0 && t.ctx.saveState === '');
  }
  {
    const t = maak({ stand: 'gelijk' });
    t.kijkExtern();
    ok('een tweede controle er meteen achteraan wordt overgeslagen',
       t.kijkExtern() === false, 'focus en visibilitychange vlak na elkaar');
    await rust2();                       /* de eerste controle laten aflopen */
    /* De afgeronde controle laat het slot los, maar de tijdrem moet het dan nog
       tegenhouden -- dat is het geval waarin focus en visibilitychange na een
       snelle controle alsnog allebei afgaan. Zonder deze controle zou alleen het
       slot worden getoetst en de rem niet. */
    ok('ook na een afgeronde controle houdt de tijdrem het nog tegen',
       t.kijkExtern() === false);
    t.laatst(0);
    ok('en na de tijdrem mag het weer', t.kijkExtern() === true);
  }
  {
    ok('zonder File System Access wordt er niet gekeken',
       maak({ hasFSA: false }).kijkExtern() === false);
    ok('zonder gekoppelde map ook niet', maak({ handle: false }).kijkExtern() === false);
    ok('zonder bestandsnaam ook niet', maak({ naam: false }).kijkExtern() === false);
    ok('en niet terwijl de app aan het schrijven is',
       maak({ schrijfBezig: true }).kijkExtern() === false);
    ok('en niet zolang er een toegangsprobleem is',
       maak({ fileState: 'auth' }).kijkExtern() === false);
  }
  {
    const t = maak({ stand: 'anders' });
    t.kijkExtern(); await rust2();
    ok('een gewijzigd bestand wordt opnieuw ingelezen', t.ctx.geladen === 1);
    ok('en dat wordt gemeld', t.ctx.getekend > 0);
  }
  {
    const t = maak({ stand: 'anders', vuil: true });
    t.kijkExtern(); await rust2();
    ok('met een eigen wijziging wordt er NIET overheen gelezen', t.ctx.geladen === 0);
    ok('en er wordt niets gemeld zolang de app zelf nog gaat opslaan',
       t.ctx.saveState !== 'extern',
       'anders blokkeert die melding juist die schrijfactie');
  }
  {
    const t = maak({ stand: 'anders', vuil: true, saveState: 'fout' });
    t.kijkExtern(); await rust2();
    ok('lukt opslaan niet, dan wordt het wel gemeld', t.ctx.saveState === 'extern',
       t.ctx.saveState);
    ok('en nog steeds niet overheen gelezen', t.ctx.geladen === 0);
  }
  {
    const t = maak({ stand: 'anders', herstelRij: true });
    t.kijkExtern(); await rust2();
    ok('met herstelgegevens evenmin', t.ctx.geladen === 0);
    ok('en ook dan volgt de melding', t.ctx.saveState === 'extern', t.ctx.saveState);
  }
  {
    /* 'onbekend' is geen vaststelling dat het bestand is gewijzigd. Dus niet
       opnieuw inlezen: dat zou de stap terug weggooien en een melding geven die
       niet waar is. */
    const t = maak({ stand: 'onbekend' });
    t.kijkExtern(); await rust2();
    ok('een mislukte controle leidt niet tot opnieuw inlezen', t.ctx.geladen === 0,
       t.ctx.geladen + ' keer');
    ok('en niet tot de melding dat er iets is ingelezen', t.ctx.gemeld === 0);
    ok('maar wel tot een eigen melding dat het niet na te gaan was', t.onbekend() === true);
    const tekeningen = t.ctx.getekend;
    t.laatst(0); t.kijkExtern(); await rust2();
    ok('een tweede mislukte controle meldt niet opnieuw', t.ctx.getekend === tekeningen,
       'anders komt bij elke keer terugschakelen dezelfde melding');
    ok('en de melding blijft wel staan', t.onbekend() === true);
  }
  {
    const t = maak({ stand: 'onbekend', vuil: true, saveState: 'fout' });
    t.kijkExtern(); await rust2();
    ok('ook met een eigen wijziging wordt er niets overheen gelezen', t.ctx.geladen === 0);
    ok('en wordt er niet gedaan alsof er een botsing is vastgesteld',
       t.ctx.saveState !== 'extern', t.ctx.saveState);
  }
  {
    /* En zodra een controle wel lukt, hoort die melding weg te zijn. */
    const t = maak({ stand: 'onbekend' });
    t.kijkExtern(); await rust2();
    ok('de melding staat er na een mislukte controle', t.onbekend() === true);
    t.laatst(0);
    t.zetStand('gelijk'); t.kijkExtern(); await rust2();
    ok('en verdwijnt zodra een controle wel lukt', t.onbekend() === false);
  }
  {
    /* Het slot: een tweede controle terwijl de eerste nog loopt. De tijdrem
       beperkt de frequentie, niet de overlap -- duurt een controle langer dan
       het interval, dan startte de volgende er gewoon bovenop. */
    const t = maak({ stand: 'anders', controleDuur: 60 });
    ok('de eerste controle wordt aanvaard', t.kijkExtern() === true);
    t.laatst(0);
    ok('een tweede terwijl de eerste nog loopt niet', t.kijkExtern() === false);
    await new Promise((r) => setTimeout(r, 200));
    ok('en er is één keer opnieuw ingelezen', t.ctx.geladen === 1, t.ctx.geladen + ' keer');
    t.laatst(0);
    ok('daarna mag er weer worden gekeken', t.kijkExtern() === true);
  }
  {
    /* Een slot dat blijft hangen. externGewijzigd leest het bestandssysteem; valt
       dat SYNCHROON om -- een ingetrokken machtiging, een handle die geen
       getFileHandle meer heeft -- dan ontsnapt die uitzondering aan de .catch op
       de belofte. Het slot ging dan nooit meer open en er werd tot de volgende
       herlaadactie niet meer naar het bestand gekeken. */
    const t = maak({ gooit: true });
    let viel = false;
    try { t.kijkExtern(); } catch(e){ viel = true; }
    ok('een struikelende controle komt niet bij de aanroeper terecht', viel === false,
       'anders valt de focus-handler om');
    t.laatst(0);
    ok('en het slot staat daarna weer open', t.kijkExtern() === true,
       'met een hangend slot wordt er nooit meer naar het bestand gekeken');
  }
  {
    /* Herstelgegevens die tijdens de controle binnenkomen moeten gezien worden.
       Dat gaat goed omdat kijkExtern ze pas op het moment van beslissen leest
       en niet bij het starten -- dit legt dat vast. */
    const t = maak({ stand: 'anders', controleDuur: 40 });
    t.kijkExtern();
    await new Promise((r) => setTimeout(r, 10));
    t.zetHerstel({ tekst: 'van de vorige sessie' });
    await new Promise((r) => setTimeout(r, 200));
    ok('herstelgegevens die tijdens de controle binnenkomen worden gezien',
       t.ctx.geladen === 0, t.ctx.geladen + ' keer ingelezen');
    ok('en dan volgt de melding in plaats van een herlaadactie',
       t.ctx.saveState === 'extern', t.ctx.saveState);
  }
  {
    /* Getypt tijdens het inlezen: de buffer heeft het, dus niet melden dat
       alles netjes is ingelezen. */
    const t = maak({ stand: 'anders', laadDuur: 30, tijdensLezen: 'wijzigVersie++;' });
    t.kijkExtern();
    await new Promise((r) => setTimeout(r, 200));
    ok('een wijziging tijdens het inlezen levert geen onterechte bevestiging',
       t.ctx.gemeld === 0, t.ctx.gemeld + ' bevestigingen');
    ok('maar de melding over de botsing', t.ctx.saveState === 'extern', t.ctx.saveState);
  }
}

}
/* ---------- 13. De vier reparaties uit de koude review ---------- */
kop('13. Reparaties na de koude review');
{
  /* A. Wijzigen mag alleen met een echt gekoppeld bestand. btnNew stond op
     disabled maar btnEdit niet, en een rij is in de leeskopie-toestand gewoon
     selecteerbaar -- dus kon er wel worden bewerkt. De poort staat nu in
     openModal zelf. */
  /* De poort zelf, letterlijk uit de app: de eerste twee regels van openModal. */
  const poortBron = haal('openModal');
  ok('openModal weigert zonder een gekoppeld bestand',
     /if\(!magWijzigen\(\)\) return;/.test(poortBron), 'poort aanwezig');
  ok('de verwijderknop ook',
     /if\(editIndex < 0 \|\| !magWijzigen\(\)\) return;/.test(SCRIPT));
  ok('en de knop Ongedaan maken ook',
     /\$\('btnUndo'\)\.onclick = function\(\)\{\s*\n\s*if\(!magWijzigen\(\)\) return;/.test(SCRIPT));
  ok('btnEdit wordt nu ook op disabled gezet, net als btnNew',
     /\$\('btnEdit'\)\.disabled = !magWijzigen\(\);/.test(SCRIPT),
     'dit was het gat: alleen btnNew was afgedicht');
}

{
  /* C. Een record wordt op inhoud teruggevonden, niet alleen op index. */
  const fn = new Function([
    'var records = [];',
    'function regelVan(r){ return r.regel; }',
    haal('vindRegel'),
    'return { vindRegel: vindRegel, zet: function(r){ records = r; } };'
  ].join('\n'))();
  const lijst = (a) => a.map((x) => ({ regel: x }));
  fn.zet(lijst(['a', 'b', 'c']));
  ok('een onveranderde index wordt gewoon gebruikt', fn.vindRegel('b', 1) === 1);
  ok('een verschoven record wordt op inhoud gevonden', fn.vindRegel('c', 0) === 2,
     'parse deelt de posities opnieuw uit, dus de index kan verouderd zijn');
  ok('een index buiten de lijst ook', fn.vindRegel('a', 99) === 0);
  ok('een verdwenen record levert geen vervanger op', fn.vindRegel('weg', 1) === -1,
     'anders werd op die index een ander event geraakt');
  fn.zet(lijst(['x', 'b', 'b']));
  ok('bij twee identieke regels blijft de index beslissen', fn.vindRegel('b', 2) === 2,
     'zodat een dubbel event zich gedraagt zoals voorheen');
  ok('en zonder identiteit wordt er niets gevonden', fn.vindRegel(null, 0) === -1);
  ok('bewaarModal overschrijft niet op een verouderde index',
     /var doel = vindRegel\(editRegel, editIndex\);[\s\S]{0,400}?records\[doel\] = rec;/.test(SCRIPT));
  ok('en de verwijderactie verwijdert niet op een verouderde index',
     /var doel = vindRegel\(regel, editIndex\);[\s\S]{0,200}?records\.splice\(doel,1\)/.test(SCRIPT));
}

{
  /* C-vervolg: geen automatische herlaadactie terwijl er een modal openstaat. */
  const bouwKijk = (modalOpen) => {
    const ctx = { geladen: 0 };
    return new Function('ctx', [
      'var EXTERN_INTERVAL = 1500, externLaatst = 0, externBezig = false, externOnbekend = false;',
      'var externGemeld = false, hasFSA = true, dirHandle = {}, bestandsnaam = "e.txt";',
      'var fileState = "ok", schrijfBezig = false, saveState = "", herstelRij = null;',
      'var selIndex = -1, records = [], wijzigVersie = 0;',
      'var modalStapel = ' + (modalOpen ? '["modal"]' : '[]') + ';',
      'var window = { scrollY: 0, scrollTo: function(){} };',
      'function nietOpgeslagen(){ return false; }',
      'function render(){} function regelVan(){ return ""; }',
      'function laden(){ ctx.geladen++; return Promise.resolve(); }',
      'function externGewijzigd(){ return Promise.resolve("anders"); }',
      haal('kijkExtern'), haal('herleesExtern'),
      'return { kijkExtern: kijkExtern, ctx: ctx };'
    ].join('\n'))(ctx);
  };
  ok('met een open modal wordt er niet gekeken', bouwKijk(true).kijkExtern() === false,
     'daar wordt een record over gebruikerstijd heen vastgehouden');
  const u = bouwKijk(false);
  ok('en zonder open modal wel', u.kijkExtern() === true);
  await new Promise((r) => setTimeout(r, 20));
  ok('waarbij er dan ook werkelijk opnieuw is ingelezen', u.ctx.geladen === 1);
}

{
  /* D. Bij 'Toch opslaan' hoort er een backup te komen, ook als er die dag al
     een is: op schijf staat dan juist de wijziging van buiten. */
  const maakBack = (alGehad) => {
    const ctx = { gelezen: 0, geschreven: 0 };
    return new Function('ctx', [
      'var backupDag = {};',
      'function dagsleutel(){ return "2026-10-12"; }',
      'function backupNaam(n){ return n + ".bak"; }',
      'function idbGet(){ return Promise.resolve(' + (alGehad ? '"2026-10-12"' : 'null') + '); }',
      'function idbPut(){ return Promise.resolve(); }',
      'var dirHandle = { getFileHandle: function(n, o){',
      '  if(o && o.create){ ctx.geschreven++; return Promise.resolve({ createWritable: function(){',
      '    return Promise.resolve({ write: function(){ return Promise.resolve(); },',
      '                             close: function(){ return Promise.resolve(); } }); } }); }',
      '  ctx.gelezen++;',
      '  return Promise.resolve({ getFile: function(){ return Promise.resolve({ text: function(){ return Promise.resolve("INHOUD VAN SCHIJF"); } }); } });',
      '} };',
      haal('maybeBackup'),
      'return { maybeBackup: maybeBackup, ctx: ctx };'
    ].join('\n'))(ctx);
  };
  {
    const b = maakBack(false);
    await b.maybeBackup('events.txt');
    ok('zonder backup van vandaag wordt er een gemaakt', b.ctx.geschreven === 1);
  }
  {
    const b = maakBack(true);
    await b.maybeBackup('events.txt');
    ok('met een backup van vandaag niet nog een keer', b.ctx.geschreven === 0,
       'zo bleef het, en dat is bij normaal opslaan juist');
  }
  {
    const b = maakBack(true);
    await b.maybeBackup('events.txt', true);
    ok('maar bij Toch opslaan wel, ook al is er vandaag al een',
       b.ctx.geschreven === 1,
       'anders staat de wijziging van buiten na het opslaan nergens meer');
  }
  ok('en schrijfEvents geeft dat door bij Toch opslaan',
     /return maybeBackup\(bestandsnaam, negeer\)/.test(SCRIPT));
}

{
  /* B. De worker houdt zich in leven vóór het antwoord. */
  ok('de verlenging staat voor het antwoord en omvat het wegschrijven',
     /e\.waitUntil\(netwerk\.then\(function\(\)\{ return bewaarKlaar; \}\)\);[\s\S]{0,200}?return gecached \|\| netwerk;/.test(SW),
     'een waitUntil na het antwoord weigert de browser met InvalidStateError');
  ok('en er staat geen waitUntil meer binnen de netwerk-then',
     !/var bewaren = cache\.put[\s\S]{0,120}?e\.waitUntil\(bewaren\)/.test(SW));
  const env = swOmgeving({ inhoud: { [ORIGIN + '/events.html']: 'VERS' } });
  await installeer(env);
  await vuur(env, 'activate');
  const c = await env.caches.open(CACHE_NAAM);
  await c.put(ORIGIN + '/events.html', new env.Res('OUD', { type: 'basic' }));

  /* Wat ertoe doet is niet het moment waarop respondWith wordt AANGEROEPEN --
     dat is synchroon, nog voor cache.match klaar is -- maar of de verlenging is
     aangevraagd voordat die belofte OPLOST. Daarna is het event niet meer actief
     en weigert de browser waitUntil. */
  const wacht = [];
  let antwoord = null, bijOplossen = -1;
  const ev = { request: { method: 'GET', url: ORIGIN + '/events.html', mode: 'navigate' },
               waitUntil: (p) => wacht.push(p),
               respondWith: (p) => { antwoord = p; } };
  for (const f of env.handlers.fetch) f(ev);
  const res = await antwoord;
  bijOplossen = wacht.length;
  ok('het antwoord komt uit de cache', (await tekst(res)) === 'OUD');
  ok('en de verlenging was al aangevraagd toen dat antwoord oploste',
     bijOplossen >= 1, bijOplossen + ' verlengingen');
  await Promise.all(wacht);
  const na = await (await env.caches.open(CACHE_NAAM)).match(ORIGIN + '/events.html');
  ok('de verlenging dekt ook het wegschrijven, dus de verse kopie staat erin',
     (await tekst(na)) === 'VERS', await tekst(na));
}

/* ---------- 14. De configuratie: botsingen en het scheidingsteken ---------- */
kop('14. De configuratie en het scheidingsteken');
{
  /* Het events-bestand was al sinds lang beschermd tegen een wijziging van
     buiten, de configuratie niet: wie de instellingen op de pc aanpaste en
     daarna in de app op Opslaan drukte, zag die aanpassing zonder melding
     verdwijnen. Dezelfde drie uitkomsten als bij externGewijzigd, want het is
     dezelfde vraag over een ander bestand. */
  const maakCfg = (bestand, gelezen, grootte) => {
    const ctx = {};
    const fn = new Function('ctx', [
      'var cfgGelezen = ' + (gelezen === null ? 'null' : gelezen) + ';',
      'var cfgGrootte = ' + (grootte === null ? 'null' : grootte) + ';',
      'var CFG_NAAM = "events_cfg.json";',
      'var dirHandle = { getFileHandle: function(){ return ctx.geef(); } };',
      haal('cfgGewijzigd'),
      'return cfgGewijzigd;'
    ].join('\n'))(ctx);
    ctx.geef = bestand;
    return fn;
  };
  const bestand = (lm, size) => () => Promise.resolve({ getFile: () => Promise.resolve({ lastModified: lm, size: size }) });
  const werpt = (naam) => () => { const e = new Error(naam); e.name = naam; return Promise.reject(e); };

  ok('zelfde tijd en grootte: de configuratie is niet gewijzigd',
     (await maakCfg(bestand(1000, 40), 1000, 40)()) === 'gelijk');
  ok('een andere wijzigingstijd wel',
     (await maakCfg(bestand(2000, 40), 1000, 40)()) === 'anders');
  ok('en een andere grootte bij dezelfde tijd ook',
     (await maakCfg(bestand(1000, 99), 1000, 40)()) === 'anders', 'metadata, geen inhoud');
  ok('een configuratie die nog niet bestaat valt niets te overschrijven',
     (await maakCfg(werpt('NotFoundError'), 1000, 40)()) === 'gelijk');
  ok('een ingetrokken machtiging geldt niet als ongewijzigd',
     (await maakCfg(werpt('NotAllowedError'), 1000, 40)()) === 'onbekend');
  ok('nog nooit gelezen levert geen botsing',
     (await maakCfg(bestand(1000, 40), null, null)()) === 'gelijk');

  /* En wat schrijfCfg met dat antwoord doet: niet weigeren -- dan kom je met een
     half ingevuld formulier zonder herladen niet meer verder -- maar de versie
     van buiten eerst apart wegzetten, net als bij Toch opslaan. */
  const bron = haal('schrijfCfg');
  ok('schrijfCfg vraagt eerst of de configuratie is gewijzigd',
     /return cfgGewijzigd\(\)\.then\(/.test(bron), 'controle aanwezig');
  ok('en forceert dan een backup, ook als er vandaag al een is',
     /maybeBackup\(CFG_NAAM, cfgOverschreven\)/.test(bron));
  ok('wat er is weggeschreven wordt daarna de nieuwe basis',
     /cfgGelezen = f\.lastModified; cfgGrootte = f\.size;/.test(bron),
     'anders zou elke volgende keer opslaan een extra backup maken');
  ok('en de melding is een toestand, geen gebeurtenis',
     /cfgOverschreven = stand !== 'gelijk';/.test(bron));

  /* Het scheidingsteken over twee bestanden. Zolang de cfg al op het nieuwe
     teken staat en het events-bestand nog niet is herschreven, lopen de twee
     uiteen en is bij de volgende start elke regel onbegrepen. */
  ok('bewaarCfg onthoudt het oude teken tot het bestand is herschreven',
     /sepOnafgemaakt = oudeSep;/.test(SCRIPT));
  ok('en schrijfEvents wist dat weer na een gelukte schrijfactie',
     /sepOnafgemaakt = ''; sepMist = '';/.test(haal('schrijfEvents')),
     'zodat de melding ook via Toch opslaan van het scherm gaat');

  /* zoekBeterSep: welk teken zou wel passen? Een losse functie met een echte
     parse eronder, dus hier na te rekenen zonder browser. */
  const maakZoek = () => {
    const fn = new Function([
      'var cfg = { scheidingsteken: ";" };',
      'var volgnr = 0, terug = null;',
      /* de veldnamen letterlijk uit de app, zodat VELD_MIN en VELD_MAX hier
         dezelfde waarde hebben als daar */
      /var VELDEN = \[[^\]]*\];/.exec(SCRIPT)[0],
      'var VELD_MAX = VELDEN.length, VELD_MIN = VELD_MAX - 1;',
      /* en de kandidaten ook letterlijk: anders zou deze test een andere lijst
         nakijken dan de app gebruikt */
      /var SEP_KANDIDATEN = \[[^\]]*\];/.exec(SCRIPT)[0],
      haal('sep'), haal('sepLabel'), haal('zoekBeterSep'), haal('parse'),
      /* parse wordt geteld. De twee bewakingen aan het begin van zoekBeterSep
         zijn er niet voor het antwoord -- zonder die bewakingen komt er voor een
         leesbaar bestand ook niets uit, want geen enkel ander teken past dan --
         maar voor de kosten: anders wordt een bestand van 237 records bij elke
         start zeven keer extra geparseerd. Dat is wat hier wordt nagekeken. */
      'var echteParse = parse, parseTellen = 0;',
      'parse = function(t){ parseTellen++; return echteParse(t); };',
      'return { zoek:zoekBeterSep, parse:echteParse, label:sepLabel,',
      '         tel:function(){ return parseTellen; },',
      '         nul:function(){ parseTellen = 0; },',
      '         zet:function(t){ cfg.scheidingsteken = t; } };'
    ].join('\n'))();
    return fn;
  };
  let z = null;
  let zFout = '';
  try { z = maakZoek(); } catch (e) { zFout = e.message; }
  ok('de functies voor het scheidingsteken zijn uit te snijden', !!z,
     z ? 'ja' : 'niet gelukt: ' + zFout);
  if (z) {
    const MET_PUNTKOMMA = 'A;aap;Gebeurtenis;D20260101;1\nB;beer;Gebeurtenis;D20260202;2\n';
    const proef = (tekst) => { const g = z.parse(tekst); z.nul(); return z.zoek(tekst, g); };
    z.zet('#');
    ok('past geen enkele regel, dan wordt het teken genoemd dat wel past',
       proef(MET_PUNTKOMMA) === ';');
    ok('en daarvoor is wel geparseerd', z.tel() >= 1, z.tel() + ' keer');
    z.zet(';');
    ok('een leesbaar bestand levert geen suggestie', proef(MET_PUNTKOMMA) === '',
       'anders zou de app op de normale weg onzin melden');
    ok('en kost op die normale weg geen enkele extra parse', z.tel() === 0,
       z.tel() + ' keer -- bij 237 records is dat zeven keer de hele lijst');
    const ROMMEL = 'dit is geen regel\nen dit ook niet\n';
    z.zet('#');
    ok('bij echte rommel wordt er niets beweerd', proef(ROMMEL) === '');
    ok('een leeg bestand ook niet', proef('') === '');
    ok('en dat kost ook niets', z.tel() === 0, z.tel() + ' keer');
    const MET_TAB = 'A\taap\tGebeurtenis\tD20260101\t1\n';
    ok('een tab wordt ook gevonden', z.zoek(MET_TAB, z.parse(MET_TAB)) === '\t');
    ok('en leesbaar opgeschreven, want een tab is onzichtbaar', z.label('\t') === 'tab');
    ok('een gewoon teken staat tussen aanhalingstekens', z.label(';') === '"' + ';' + '"');
  }
}

/* ---------- 15. Een record is altijd precies een regel ---------- */
kop('15. Een record is een regel, en de afspraak staat twee keer gelijk');
{
  /* De afspraak over het formaat zegt van zichzelf dat hij woordelijk in beide
     bestanden staat. Dat was niet meer zo: elf verschillen, waarvan een
     inhoudelijke over wat er met een onbegrepen regel gebeurt. Een tekst die
     drift moet voorkomen en zelf uit de pas loopt, doet precies het omgekeerde. */
  const blokApp = (bron) => {
    const i = bron.indexOf('DE AFSPRAAK OVER HET FORMAAT');
    if (i < 0) return null;
    const j = bron.indexOf('*/', i);
    return bron.slice(i, j);
  };
  const blokMacro = (bron) => {
    const regels = bron.split('\n');
    let i = regels.findIndex((r) => r.includes('DE AFSPRAAK OVER HET FORMAAT'));
    if (i < 0) return null;
    const uit = [];
    for (let k = i; k < regels.length; k++) {
      const t = regels[k].trim();
      if (!t.startsWith('//')) break;
      uit.push(regels[k].replace(/^\s*\/\/ ?/, ''));
    }
    return uit.join('\n');
  };
  /* Alleen de opmaak van het commentaar wegnemen, niets anders: de woorden en de
     indeling moeten echt gelijk zijn, anders betekent 'woordelijk' niets. */
  const kaal = (t) => t.split('\n')
    .map((r) => r.replace(/^\s*(?:\*|=+)?\s?/, '').replace(/\s+$/, ''))
    .filter((r) => r !== '' && !/^=+$/.test(r))
    .join('\n');

  const a = blokApp(SCRIPT);
  ok('de afspraak staat in events.html', !!a);
  if (LITE === null) {
    ok('events_lite.js staat naast de tests', false,
       'zonder dat bestand is deze vergelijking niet te maken');
  } else {
    const m = blokMacro(LITE);
    ok('en in events_lite.js', !!m);
    if (a && m) {
      const ka = kaal(a), km = kaal(m);
      let eerste = '';
      const ra = ka.split('\n'), rm = km.split('\n');
      for (let k = 0; k < Math.max(ra.length, rm.length); k++) {
        if (ra[k] !== rm[k]) {
          eerste = 'regel ' + (k + 1) + ': app "' + (ra[k] === undefined ? '(einde)' : ra[k]) +
                   '" / macro "' + (rm[k] === undefined ? '(einde)' : rm[k]) + '"';
          break;
        }
      }
      ok('en dat woordelijk hetzelfde', ka === km, eerste || (ra.length + ' regels gelijk'));
      ok('met de regel dat een record altijd een regel is',
         /Een record is altijd precies een regel/.test(ka));
      ok('en met het categorieveld als bewust verschil', /\? categorie/.test(ka));
    }
  }

  /* De garantie zelf. regelVan is de enige plek waar een record een
     bestandsregel wordt; de rest van de app gaat daar langs. */
  const maakRegel = () => new Function([
    'var cfg = { scheidingsteken: ";" };',
    haal('sep'), haal('regelVan'),
    'return regelVan;'
  ].join('\n'))();
  const regelVan = maakRegel();
  const rec = (extra) => Object.assign(
    { sleutel: 'A', naam: 'aap', type: 'Gebeurtenis', code: 'D20260101', cat: 1, notitie: '' },
    extra);
  const aantalRegels = (t) => t.split('\n').length;

  ok('een gewoon record is een regel', aantalRegels(regelVan(rec())) === 1);
  ok('een regelovergang in de naam ook',
     aantalRegels(regelVan(rec({ naam: 'aap\nbeer' }))) === 1,
     'ongemoeid gaf dit 2 regels voor 1 record');
  ok('in het type ook', aantalRegels(regelVan(rec({ type: 'Ge\nboren' }))) === 1,
     'een type komt uit de configuratie, en die kan met de hand zijn bewerkt');
  ok('in de notitie ook',
     aantalRegels(regelVan(rec({ notitie: 'een\ntwee' }))) === 1);
  /* Een losse \r maakt geen tweede regel bij een deling op \n, dus het aantal
     regels bewijst daar niets. Wat er wel toe doet: er blijft geen stuurteken in
     een veld staan, want dan staat er in het bestand iets anders dan je ziet. */
  ok('er blijft geen enkel stuurteken in de regel staan',
     !/[\r\n]/.test(regelVan(rec({ naam: 'aap\rbeer', notitie: 'een\r\ntwee' }))),
     JSON.stringify(regelVan(rec({ naam: 'aap\rbeer' }))));
  ok('ook een oude Mac-regelovergang wordt een spatie',
     regelVan(rec({ naam: 'aap\rbeer' })).split(';')[1] === 'aap beer');
  ok('en \\r\\n samen worden een spatie, niet twee',
     regelVan(rec({ naam: 'aap\r\nbeer' })).split(';')[1] === 'aap beer',
     JSON.stringify(regelVan(rec({ naam: 'aap\r\nbeer' })).split(';')[1]));
  ok('de overgang wordt een spatie, geen niets',
     regelVan(rec({ naam: 'aap\nbeer' })).split(';')[1] === 'aap beer',
     regelVan(rec({ naam: 'aap\nbeer' })).split(';')[1]);
  ok('en wie geen overgang heeft houdt precies zijn eigen tekst',
     regelVan(rec({ naam: 'aap beer' })) === 'A;aap beer;Gebeurtenis;D20260101;1');
  ok('een onbegrepen regel blijft letterlijk staan',
     regelVan({ raw: 'dit is geen regel' }) === 'dit is geen regel');

  /* En wat parse van een categorieveld maakt dat geen getal is. De macro meldt
     dat als "? categorie"; de app vulde stil 2 in en zei er niets over. */
  const maakParse = () => new Function([
    'var cfg = { scheidingsteken: ";" };',
    'var volgnr = 0, terug = null;',
    /var VELDEN = \[[^\]]*\];/.exec(SCRIPT)[0],
    'var VELD_MAX = VELDEN.length, VELD_MIN = VELD_MAX - 1;',
    haal('sep'), haal('parse'),
    'return parse;'
  ].join('\n'))();
  const parse = maakParse();
  const een = (regel) => parse(regel + '\n')[0];

  ok('een getal blijft dat getal', een('A;a;Gebeurtenis;D20260101;3').cat === 3);
  ok('en zonder klacht', een('A;a;Gebeurtenis;D20260101;3').catRuw === undefined);
  ok('een getypte nul blijft nul', een('A;a;Gebeurtenis;D20260101;0').cat === 0);
  ok('en ook zonder klacht', een('A;a;Gebeurtenis;D20260101;0').catRuw === undefined);
  ok('een leeg categorieveld geldt als 1', een('A;a;Gebeurtenis;D20260101;').cat === 1,
     'de eerste categorie, die er altijd is');
  ok('en wordt onthouden voor het rapport',
     een('A;a;Gebeurtenis;D20260101;').catRuw === '',
     'anders zie je die klacht alleen in het macrorapport');
  ok('tekst in het categorieveld geldt ook als 1',
     een('A;a;Gebeurtenis;D20260101;hoog').cat === 1);
  ok('en wordt ook onthouden, met wat er stond',
     een('A;a;Gebeurtenis;D20260101;hoog').catRuw === 'hoog');
  /* En een nieuw event begint op diezelfde eerste categorie. Dat stond op 2, en
     2 hoeft niet in de configuratie te staan. */
  ok('de beginwaarde van de categorie is de eerste', /var cat = 1;/.test(SCRIPT));
  ok('en een nieuw event krijgt die ook',
     /cat = r \? r\.cat : 1;/.test(SCRIPT), 'in openModal');

  ok('het rapport heeft er een eigen kop voor',
     /Categorie niet te lezen, geldt als 1/.test(SCRIPT));

  /* En het platslaan van de configuratie. keurCfg is zuiver, dus dat hoeft niet
     op de browser te wachten: een type met een regelovergang zou van elk record
     met dat type twee regels maken. */
  const maakKeur = () => new Function([
    'var CFG_VERBODEN = ' + JSON.stringify(JSON.parse(
       /var CFG_VERBODEN = (\[[^\]]*\]);/.exec(SCRIPT)[1].replace(/'/g, '"'))) + ';',
    /var CFG_TEKST = \[[^\]]*\];/.exec(SCRIPT)[0],
    /var CFG_LIJST = \[[^\]]*\];/.exec(SCRIPT)[0],
    haal('isObject'), haal('keurCfg'),
    'return keurCfg;'
  ].join('\n'))();
  const keurCfg = maakKeur();
  {
    const klachten = [];
    const uit = keurCfg({
      bestand: 'e.txt', titel: 'Twee\nregels',
      velden: ['Event', 'Naam\nhier', 'Type', 'Datum', 'Categorie', 'Notitie'],
      types: [{ omschrijving: 'Ge\nboren' }, { omschrijving: 'Gebeurtenis' }],
      categorieen: [{ nr: 1, omschrijving: 'eerste\r\nregel' }]
    }, klachten);
    ok('de titel komt op een regel', uit.titel === 'Twee regels', JSON.stringify(uit.titel));
    ok('een veldnaam ook', uit.velden[1] === 'Naam hier', JSON.stringify(uit.velden[1]));
    ok('een type ook', uit.types[0].omschrijving === 'Ge boren',
       JSON.stringify(uit.types[0].omschrijving));
    ok('een categorie-omschrijving ook', uit.categorieen[0].omschrijving === 'eerste regel',
       JSON.stringify(uit.categorieen[0].omschrijving));
    ok('en wat al op een regel stond blijft ongemoeid',
       uit.types[1].omschrijving === 'Gebeurtenis');
    ok('en het wordt gemeld, met het aantal',
       klachten.filter((k) => /4 waarde\(n\) stonden over meer dan een regel/.test(k)).length === 1,
       klachten.join(' | '));
    const schoon = [];
    keurCfg({ bestand: 'e.txt', titel: 'Een regel' }, schoon);
    ok('een schone configuratie levert die melding niet op',
       !/over meer dan een regel/.test(schoon.join(' ')));
  }

  if (LITE !== null) {
    ok('en de macro leest datzelfde veld nog met +veld',
       /event\['category'\] = \(fields\[4\] !== undefined\) \? \+fields\[4\]\.trim\(\) : 0;/.test(LITE),
       'verandert dat, dan verandert het bewust verschil mee');
  }
}

/* ---------- 16. De worker meldt een verse kopie ---------- */
kop('16. De worker meldt wanneer er een nieuwe kopie staat');
{
  /* De pagina kijkt bij het laden in de cache of daar een nieuwer versienummer
     staat, maar op dat moment is de achtergrondverversing nog onderweg. Gemeten
     in Chromium: bij 800 ms netwerkvertraging stond de verse kopie er pas na
     1,0 s, bij 2500 ms pas na 3,6 s -- en zonder bericht bleef de melding over
     een nieuwe versie binnen 12 s helemaal uit, ook al stond de nieuwe kopie
     allang in de cache. Pas bij het wegschakelen en terughalen zag je hem. */
  const env = swOmgeving({ inhoud: { [ORIGIN + '/events.html']: 'VERS' } });
  env.maakSw();
  const CACHE_NAAM = 'events-v' + (/const CACHE_VERSION = (\d+);/.exec(SW) || [0, 0])[1];
  const c = await env.caches.open(CACHE_NAAM);
  await c.put(ORIGIN + '/events.html', new env.Res('OUD', { type: 'basic' }));

  /* meldVerversing schrijft de vensters aan in een eigen belofte, dus na het
     wegschrijven is er nog een ronde nodig voordat de berichten er zijn. Zonder
     dit wachtje kon 'er wordt niets gemeld' kloppen omdat het bericht nog in de
     wachtrij stond, en dan toetst die controle niets. */
  const bezinken = () => new Promise((r) => setTimeout(r, 0));

  const vraag = (url, mode) => {
    const wacht = [];
    let antwoord = null;
    const ev = { request: { method: 'GET', url, mode },
                 waitUntil: (p) => wacht.push(p), respondWith: (p) => { antwoord = p; } };
    for (const f of env.handlers.fetch) f(ev);
    return { antwoord, wacht };
  };

  env.self.berichten.length = 0;
  {
    const { antwoord, wacht } = vraag(ORIGIN + '/events.html', 'navigate');
    ok('het antwoord komt nog steeds meteen uit de cache', (await tekst(await antwoord)) === 'OUD');
    await Promise.all(wacht); await bezinken();
    ok('zodra de verse kopie is weggeschreven, worden de vensters aangeschreven',
       env.self.berichten.length === 2, env.self.berichten.length + ' berichten voor 2 vensters');
    ok('met een bericht dat de pagina herkent',
       env.self.berichten.every((m) => m && m.type === 'kopieVernieuwd'),
       JSON.stringify(env.self.berichten[0]));
    ok('en alleen vensters, geen workers', env.self.matchAllOpties &&
       env.self.matchAllOpties.type === 'window', JSON.stringify(env.self.matchAllOpties));
    const na = await (await env.caches.open(CACHE_NAAM)).match(ORIGIN + '/events.html');
    ok('en in de cache staat dan werkelijk de verse kopie', (await tekst(na)) === 'VERS');
  }
  {
    /* Een gewoon bestand draagt geen versienummer, dus daar valt niets te
       melden; anders zou elk plaatje een controle uitlokken. */
    env.self.berichten.length = 0;
    const { wacht } = vraag(ORIGIN + '/icon.svg', 'no-cors');
    await Promise.all(wacht); await bezinken();
    ok('bij een gewoon bestand wordt er niets gemeld',
       env.self.berichten.length === 0, env.self.berichten.length + ' berichten');
  }
  {
    /* Een mislukte schrijfactie mag niets melden: dan staat die kopie er niet. */
    const opt2 = { inhoud: { [ORIGIN + '/events.html']: 'VERS' }, weigerPut: [] };
    const env2 = swOmgeving(opt2);
    env2.maakSw();
    const c2 = await env2.caches.open(CACHE_NAAM);
    await c2.put(ORIGIN + '/events.html', new env2.Res('OUD', { type: 'basic' }));
    opt2.weigerPut = ['/events.html'];      /* vanaf nu mislukt het wegschrijven */
    env2.self.berichten.length = 0;
    const wacht = [];
    let antwoord = null;
    const ev = { request: { method: 'GET', url: ORIGIN + '/events.html', mode: 'navigate' },
                 waitUntil: (p) => wacht.push(p), respondWith: (p) => { antwoord = p; } };
    for (const f of env2.handlers.fetch) f(ev);
    await antwoord;
    await Promise.all(wacht); await bezinken();
    ok('een mislukte schrijfactie meldt niets', env2.self.berichten.length === 0,
       env2.self.berichten.length + ' berichten');
  }
  {
    /* Een browser zonder clients.matchAll mag de verversing niet omver halen. */
    const env3 = swOmgeving({ inhoud: { [ORIGIN + '/events.html']: 'VERS' } });
    env3.self.clients = { claim() {} };
    env3.maakSw();
    const c3 = await env3.caches.open(CACHE_NAAM);
    await c3.put(ORIGIN + '/events.html', new env3.Res('OUD', { type: 'basic' }));
    const wacht = [];
    let antwoord = null;
    const ev = { request: { method: 'GET', url: ORIGIN + '/events.html', mode: 'navigate' },
                 waitUntil: (p) => wacht.push(p), respondWith: (p) => { antwoord = p; } };
    for (const f of env3.handlers.fetch) f(ev);
    ok('zonder clients.matchAll komt het antwoord gewoon', (await tekst(await antwoord)) === 'OUD');
    await Promise.all(wacht);
    const na3 = await (await env3.caches.open(CACHE_NAAM)).match(ORIGIN + '/events.html');
    ok('en de verversing gaat gewoon door', (await tekst(na3)) === 'VERS');
  }

  /* De browser mag de controle op een nieuwe sw-events.js niet beantwoorden uit
     zijn eigen HTTP-cache. Zonder updateViaCache: 'none' mag dat tot 24 uur, en
     dan staat er een nieuwe worker op de server terwijl de app "niets
     veranderd" te horen krijgt -- de cache bleef op het oude nummer staan. */
  ok('de worker wordt geregistreerd zonder tussenkomst van de browsercache',
     (SCRIPT.match(/serviceWorker\.register\('sw-events\.js', \{ updateViaCache: 'none' \}\)/g) || []).length === 2,
     'beide aanroepen, ook die in App-status');
  ok('en nergens meer zonder die instelling',
     !/serviceWorker\.register\('sw-events\.js'\)/.test(SCRIPT));

  /* De regel in App-status over de offline-kopie werd gevuld voordat zijn eigen
     element bestond, en bleef daardoor voor altijd op "bezig..." staan. */
  {
    const bron = haal('statusServiceWorker');
    const maak = bron.indexOf('<div id="stKopie">');
    const vul = bron.indexOf('statusVersieKopie();');
    ok('de regel over de offline-kopie wordt gemaakt en gevuld in dezelfde functie',
       maak >= 0 && vul >= 0, 'maken ' + maak + ', vullen ' + vul);
    ok('en in die volgorde', maak >= 0 && vul > maak,
       'anders vindt die functie zijn element nog niet');
  }
  ok('en niet meer vanuit vulAppStatus', !/statusOpslagVast\(\);\s*\n\s*statusVersieKopie\(\);/.test(SCRIPT));
  /* Beide lezers gebruiken EEN functie. Eerder stond in App-status een eigen
     kopie van die zoektocht, en dan kon de statusregel een ander stempel tonen
     dan de app vergeleek -- juist de twee die het met elkaar eens moeten zijn.
     Een gedeelde functie maakt dat onmogelijk in plaats van alleen onwaar. */
  ok('er is een functie die het nieuwste stempel uit de eigen caches haalt',
     /^function nieuwsteStempelUitCache\(c\)\{/m.test(SCRIPT));
  ok('en checkAppUpdate en App-status gebruiken allebei die ene functie',
     (SCRIPT.match(/nieuwsteStempelUitCache\(c\)\.then/g) || []).length === 2,
     (SCRIPT.match(/nieuwsteStempelUitCache\(c\)\.then/g) || []).length + ' aanroepen');
  ok('en geen van beide sorteert zelf nog op cachenaam',
     !/parseInt\(a\.replace\(\/\^events-v\?\//.test(SCRIPT));
  ok('alleen de eigen caches, en uitdrukkelijk geen terugval op alle caches',
     /namen\.filter\(function\(n\)\{ return n\.indexOf\('events-'\) === 0; \}\)/.test(SCRIPT) &&
     /if\(!eigen\.length\) return \{ stempel: null, reden: 'geen eigen cache' \};/.test(SCRIPT));

  /* De pagina: luistert ze naar dat bericht, en is er een vangnet? */
  ok('de pagina luistert naar het bericht van de worker',
     /navigator\.serviceWorker\.addEventListener\('message', function\(e\)\{\s*\n\s*if\(e\.data && e\.data\.type === 'kopieVernieuwd'\) checkAppUpdate\(\);/.test(SCRIPT),
     'anders komt het bericht nergens aan');
  ok('en kijkt daarnaast nog een keer na een paar seconden',
     /setTimeout\(function\(\)\{ checkAppUpdate\(\); \}, 4000\);/.test(SCRIPT),
     'vangnet voor een worker van een vorige versie, die dit bericht nog niet kent');
}

afsluiten();
}
