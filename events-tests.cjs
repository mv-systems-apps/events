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
const GROEPEN_VERWACHT = 18;
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
  console.log('focus en toetsenbord, een echte IndexedDB en de leeskopie, de');
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
const vraagVan = (env) => async (url, mode = 'no-cors', method = 'GET', cache = 'default') =>
  vuur(env, 'fetch', { request: { method, url, mode, cache } });
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
    /* Eén kopie per pad, voor elk eigen bestand en niet alleen de pagina: zo
       doen de drie apps het sinds ze gelijk zijn getrokken. Wie echt een verse
       versie wil, vraagt dat met cache:'reload' of 'no-store' (groep 17). */
    const anders = await vraag(ORIGIN + '/icon.svg?v=2');
    ok('een bestand met een zoekstring komt uit de cache, onder het pad',
       !!anders && (await tekst(anders)) === 'ICOON OUD', anders && await tekst(anders));
    await rust();
    ok('en er komt geen tweede kopie met die zoekstring bij',
       sleutels(env).every((k) => k.indexOf('?') < 0),
       sleutels(env).filter((k) => k.indexOf('?') >= 0).join());
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
    const metV = await vraag(ORIGIN + '/icon.svg?v=2');
    ok('ook een bestand met een zoekstring komt offline uit de cache',
       !!metV && metV.status === 200, metV && metV.status);
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
       /gecached \? Promise\.resolve\(GRENS_ACHTERGROND\)/.test(SW));
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
  ok('er is geen niet-opgeslagen toestand meer die herladen tegenhoudt',
     /function magHerladen\(\)\{ return !schrijfBezig; \}/.test(SCRIPT));
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
    ok('en zonder schrijfactie wel',
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
const AANWEZIG = ['regelVan', 'pasToe', 'opslaanWijziging']
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
    haal('sep'), haal('opmaakVan'), 'var bestandOpmaak = opmaakVan("");',
    haal('parse'), haal('parseLijst'), haal('regelVan'), haal('serialize'),
    haal('zonderAccent'), haal('sorteerSleutel'), haal('sorteer'),
    'return { parse:parse, serialize:serialize, regelVan:regelVan, sorteer:sorteer, opmaakVan:opmaakVan,',
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

  /* 1352898-030: de opmaak blijft, commentaar zit vast aan de regel eronder, een
     kopje (---) sorteert op zijn eigen tekst. 'Opslaan' = parse, één event erbij,
     sorteren en terugschrijven met de opmaak van het gelezen bestand. */
  const opslaan = (tekst, nieuw) => {
    const l = app.parse(tekst);
    if (nieuw) l.push(app.parse(nieuw)[0]);
    app.sorteer(l);
    return app.serialize(l, app.opmaakVan(tekst));
  };
  const CR = '\uFEFFAnna;a;Geboren;D20000101;1\r\nBert;b;Geboren;D20000102;1\r\n';
  ok('Windows-regeleindes en BOM blijven zoals ze waren (030)',
     opslaan(CR, 'Cees;c;Geboren;D20000103;1') === '\uFEFFAnna;a;Geboren;D20000101;1\r\nBert;b;Geboren;D20000102;1\r\nCees;c;Geboren;D20000103;1\r\n');
  ok('de BOM hoort niet bij de eerste sleutel', app.parse(CR)[0].sleutel === 'Anna');
  ok('zonder regeleinde aan het eind komt er ook geen bij',
     opslaan('Anna;a;Geboren;D20000101;1') === 'Anna;a;Geboren;D20000101;1');
  /* 1352898-033: geen commentaar en kopjes meer. Een regel die met -- begint is een
     onbegrepen regel (ongewijzigd bewaard, gemeld); lege regels vallen weg. */
  const MET = 'Anna;a;Geboren;D20000101;1\n\n-- oud commentaar\nBert;b;Geboren;D20000102;1\n';
  ok('een --regel is geen commentaar meer maar een onbegrepen regel (033)',
     app.parse(MET).filter((r) => r.raw !== undefined).map((r) => r.raw).join() === '-- oud commentaar');
  ok('hij blijft ongewijzigd in het bestand staan, en lege regels vallen weg',
     opslaan(MET) === '-- oud commentaar\nAnna;a;Geboren;D20000101;1\nBert;b;Geboren;D20000102;1\n');
  ok('de app kent geen kopjes, ankers of commentaar meer',
     !/commentaar:true|\.anker|sorteerPlek|r\.kop\b/.test(SCRIPT));
  {
    const naam = new Function([SCRIPT.match(/^var VERBODEN = .*$/m)[0], SCRIPT.match(/^var GERESERVEERD = .*$/m)[0],
      'var NAAM_MAX = 120, CFG_NAAM = "events_cfg.json";', haal('bestandsnaamFout'), 'return bestandsnaamFout;'].join('\n'))();
    ok('de configuratie kan niet als eventsbestand worden gekozen (030)', naam('events_cfg.json') !== '' && naam('Events_CFG.json') !== '');
    ok('een backupnaam ook niet', naam('events_mark_backup.txt') !== '' && naam('events_mark_backup_buiten.txt') !== '');
    ok('een gewone naam wel', naam('events_mark.txt') === '' && naam('backupplan.txt') === '');
  }
  {
    const lite = fs.readFileSync(path.join(__dirname, 'events_lite.js'), 'utf8');
    ok('de macro slaat --regels niet meer over (033)', !/_SYM_COMMENT/.test(lite) && /if \(record === ''\) \{/.test(lite));
  }
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
  /* 1352898-034: geen samenvoegen meer. pasToe zet één wijziging in een lijst die
     precies het bestand is waartegen hij gemaakt is; staat het event er niet, dan
     null (en opslaanWijziging schrijft dan niets). */
  const maakP = () => new Function([
    'var cfg = { scheidingsteken: ";" };',
    'function regelVan(r){ return r.raw !== undefined ? r.raw : [r.sleutel, r.naam, r.type, r.code, String(r.cat)].join(";"); }',
    haal('sep'), haal('vindIn'), haal('pasToe'),
    'return pasToe;'
  ].join('\n'))();
  const pasToe = maakP();
  const ev = (s, n, t, c) => ({ sleutel: s, naam: n, type: t || 'Geboren', code: c || 'D20000101', cat: 1 });
  const regel = (r) => [r.sleutel, r.naam, r.type, r.code, String(r.cat)].join(';');
  const A = ev('A', 'a'), A2 = ev('A', 'a anders'), B = ev('B', 'b'), JIJ = ev('A', 'a van jou');
  const namen = (l) => l.map((r) => r.naam).join(',');
  let l = [A, B], u = pasToe(l, { soort: 'nieuw', rec: ev('C', 'c') });
  ok('nieuw: erbij', u.ok && namen(l) === 'a,b,c');
  l = [A, B]; u = pasToe(l, { soort: 'wijzig', oud: regel(A), rec: JIJ });
  ok('wijzigen: vervangen', u.ok && u.voor === A && u.rec === JIJ && namen(l) === 'a van jou,b');
  l = [A, B]; u = pasToe(l, { soort: 'weg', oud: regel(A) });
  ok('verwijderen', u.ok && u.voor === A && u.rec === null && namen(l) === 'b');
  l = [A2, B]; u = pasToe(l, { soort: 'wijzig', oud: regel(A), rec: JIJ });
  ok('staat het event er niet: null, en de lijst blijft ongemoeid (034)', u === null && namen(l) === 'a anders,b');
  l = [B]; u = pasToe(l, { soort: 'weg', oud: regel(A) });
  ok('ook bij verwijderen (034)', u === null && namen(l) === 'b');
  l = [A, B]; u = pasToe(l, { soort: 'alles' });
  ok('alles herschrijven verandert niets aan de lijst', u.ok && namen(l) === 'a,b');
  l = [A, B]; u = pasToe(l, { soort: 'nieuw', rec: ev('B', 'b') });
  ok('een bewust dubbel event komt er echt bij (ongedaan maken haalt dan precies dat weg)', u.ok && namen(l) === 'a,b,b');
  ok('er is geen samenvoegen, botsing of Toch meer (034)',
     !/function zelfdeEvent\s*\(|function lijktOp\s*\(|function verschilTekst\s*\(|modalForceer|vervalForceer|w\.vast\b/.test(SCRIPT));
}

{
  /* 1352898-034: opslaan schrijft alleen als het bestand nog precies de tekst is
     waartegen de wijziging is gemaakt. De echte functies uit de app tegen een
     nagemaakte werkmap: één bestand met tekst en stempel. */
  const maak = (o = {}) => {
    const ctx = { tekst: o.tekst === undefined ? 'A;a;Geboren;D20000101;1\nB;b;Geboren;D20000102;1\n' : o.tekst,
                  mtime: 100, geschreven: 0, backups: 0, vragen: 0, bijBackup: o.bijBackup || null };
    const api = new Function('ctx', [
      SCRIPT.match(/^var VELDEN = [^;]*;/m)[0],
      'var VELD_MAX = VELDEN.length, VELD_MIN = VELD_MAX - 1;',
      'var cfg = {}, volgnr = 0, terug = null, records = [];',
      haal('sep'), haal('opmaakVan'), 'var bestandOpmaak = opmaakVan("");',
      haal('parse'), haal('parseLijst'), haal('regelVan'), haal('serialize'),
      haal('zonderAccent'), haal('sorteerSleutel'), haal('sorteer'),
      'var hasFSA = true, bestandsnaam = "ev.txt", fileState = "ok", sepOnafgemaakt = "", sepMist = "";',
      'var schrijfBezig = false, kopieRij = null, laatstGelezen = ctx.tekst === null ? null : 1, laatstGrootte = 1, inleesMelding = "";',
      'var basisTekst = ctx.basis === undefined ? ctx.tekst : ctx.basis;',
      'var GEEN_TOEGANG = { geenToegang:true }, BESTAND_WEG = { bestandWeg:true }, SEPFOUT = { sepFout:true }, NIET_UTF8 = { nietUtf8:true }, nietUtf8 = false;',
      'function zorgVoorToegang(){ return Promise.resolve(); }',
      'function bewaarKopie(){ return Promise.resolve(); }',
      'function maybeBackup(){ ctx.backups++; if(ctx.bijBackup) ctx.bijBackup(ctx); return Promise.resolve(); }',
      /* zoals een echte Blob: text() haalt een BOM weg, arrayBuffer() niet (035) */
      'function bestand(){ return ctx.tekst === null ? null : { lastModified: ctx.mtime, size: ctx.tekst.length,',
      '  text: function(){ return Promise.resolve(ctx.tekst.replace(/^\\uFEFF/, "")); },',
      '  arrayBuffer: function(){ return Promise.resolve(new TextEncoder().encode(ctx.tekst).buffer); } }; }',
      'var dirHandle = { getFileHandle: function(n, opt){ ctx.vragen++;',
      '  if(ctx.tekst === null && !(opt && opt.create)){ var e = new Error("weg"); e.name = "NotFoundError"; return Promise.reject(e); }',
      '  return Promise.resolve({ getFile: function(){ return Promise.resolve(bestand()); },',
      '    createWritable: function(){ var t = ""; return Promise.resolve({ write: function(x){ t = x; return Promise.resolve(); },',
      '      close: function(){ ctx.tekst = t; ctx.mtime++; ctx.geschreven++; return Promise.resolve(); } }); } });',
      '} };',
      haal('telTekst'), haal('leesTekst'), haal('alleOnbegrepen'), 'function zetSepOnafgemaakt(t){ sepOnafgemaakt = t || ""; }', haal('vindIn'), haal('pasToe'), haal('leesVoorSchrijven'), haal('schrijfTekst'),
      haal('neemOver'), 'var laatsteOpslag = null;', haal('nuMs'), haal('opslaanWijziging'),
      'return { op: opslaanWijziging, laatste: function(){ return laatsteOpslag; }, basis: function(){ return basisTekst; }, zetBasis: function(t){ basisTekst = t; },',
      '         zetRecords: function(t){ records = parse(t); },',
      '         lijst: function(){ return records; }, zetSepMist: function(x){ sepMist = x; } };'
    ].join('\n'));
    ctx.basis = o.basis;
    return { ctx, ...api(ctx) };
  };
  const C = { sleutel: 'C', naam: 'c', type: 'Geboren', code: 'D20000103', cat: 1 };
  {
    const t = maak();
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('ongewijzigd bestand: de wijziging wordt geschreven', u.ok && t.ctx.geschreven === 1 && /^C;c;/m.test(t.ctx.tekst));
    ok('en wat er geschreven is, is de nieuwe basis', t.basis() === t.ctx.tekst);
    const u2 = await t.op({ soort: 'weg', oud: 'A;a;Geboren;D20000101;1' });
    ok('dus een volgende opslag gaat ook', u2.ok && t.ctx.geschreven === 2 && !/^A;/m.test(t.ctx.tekst));
  }
  {
    /* 047: op Android is elke vraag aan de map traag; één keer per opslag */
    const t = maak();
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('een opslag vraagt het bestand één keer bij de map op (047)', u.ok && t.ctx.vragen === 1, 'vragen: ' + t.ctx.vragen);
    const l = t.laatste();
    ok('en de duur per stap staat klaar voor App-status (047)',
       !!l && typeof l.totaal === 'number' && l.fout === '' &&
       ['toegang', 'lezen', 'backup', 'controle', 'schrijven'].every((n) => typeof l.stappen[n] === 'number'),
       JSON.stringify(l));
    t.ctx.tekst += 'X;buiten;Geboren;D20000109;1\n';
    await t.op({ soort: 'nieuw', rec: C });
    ok('een geweigerde opslag wordt ook gemeten, met de reden (047)', t.laatste().fout === 'gewijzigd' && !('schrijven' in t.laatste().stappen));
  }
  {
    /* 047: nog geen bestand: de controle vlak voor het schrijven kijkt opnieuw in de map */
    const t = maak({ tekst: null, basis: null });
    let n = 0;
    t.ctx.bijBackup = (c) => { c.tekst = 'Z;gat;Geboren;D20000111;1\n'; };
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('nog geen bestand en er komt er een in het gat: niets geschreven (047)', u.fout === 'gewijzigd' && t.ctx.geschreven === 0 && /^Z;gat/.test(t.ctx.tekst));
  }
  {
    const f = new Function([haal('laatsteOpslagTekst'), 'var laatsteOpslag = null;',
      'return function(x){ laatsteOpslag = x; return laatsteOpslagTekst(); };'].join('\n'))();
    ok('App-status zonder opslag: nog geen (047)', f(null) === 'nog geen in deze sessie');
    ok('App-status: totaal en per stap in seconden (047)',
       f({ totaal: 1840, stappen: { toegang: 0, lezen: 420, schrijven: 1210 }, fout: '' }) ===
       'totaal 1,8 s \u2014 toegang 0,0 s \u00b7 lezen 0,4 s \u00b7 schrijven 1,2 s');
    ok('App-status: een geweigerde opslag zegt waarom (047)', /niet geschreven: gewijzigd/.test(f({ totaal: 300, stappen: {}, fout: 'gewijzigd' })));
  }
  {
    const t = maak();
    t.ctx.tekst += 'X;buiten;Geboren;D20000109;1\n'; t.ctx.mtime = 500;
    const voor = t.ctx.tekst;
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('buiten de app gewijzigd: niets geschreven (034)', u.fout === 'gewijzigd' && t.ctx.geschreven === 0 && t.ctx.tekst === voor);
    ok('met het aantal regels van toen en van nu', u.was === 2 && u.nu === 3, u.was + ' -> ' + u.nu);
    ok('en geen backup gemaakt', t.ctx.backups === 0);
  }
  {
    const t = maak();
    t.ctx.tekst = ''; t.ctx.mtime = 500;
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('een leeg geworden bestand: niets geschreven, 2 -> 0 (034)', u.fout === 'gewijzigd' && u.was === 2 && u.nu === 0 && t.ctx.geschreven === 0);
  }
  {
    const t = maak();
    t.ctx.mtime = 999;
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('dezelfde inhoud met een nieuwe tijd: gewoon schrijven (034)', u.ok && t.ctx.geschreven === 1);
  }
  {
    const t = maak();
    t.ctx.tekst = t.ctx.tekst.replace('B;b;', 'B;bb;'); t.ctx.mtime = 100;
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('andere inhoud met dezelfde tijd en grootte: toch gezien (inhoud, geen datum) (034)',
       u.fout === 'gewijzigd' && t.ctx.geschreven === 0);
  }
  {
    /* het venster vergelijkt met de tekst van het moment van openen */
    const t = maak();
    const oud = t.basis();
    t.ctx.tekst += 'X;buiten;Geboren;D20000109;1\n';
    t.zetBasis(t.ctx.tekst);
    const u = await t.op({ soort: 'nieuw', rec: C, basisTekst: oud });
    ok('het venster geldt tegen de tekst van toen het openging, niet die van nu (034)', u.fout === 'gewijzigd' && t.ctx.geschreven === 0);
    const u2 = await t.op({ soort: 'nieuw', rec: C, basisTekst: oud });
    ok('en opnieuw opslaan geeft opnieuw de melding (Annuleren lost niets op)', u2.fout === 'gewijzigd' && t.ctx.geschreven === 0);
  }
  {
    const t = maak({ basis: undefined });
    t.zetBasis(undefined);
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('een onbekende basis geldt als gewijzigd', u.fout === 'gewijzigd' && t.ctx.geschreven === 0);
  }
  {
    const t = maak({ tekst: null, basis: null });
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('nog geen bestand en het was er ook niet: maken', u.ok && t.ctx.geschreven === 1 && /^C;c;/.test(t.ctx.tekst));
  }
  {
    const t = maak();
    t.ctx.tekst = null;
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('het bestand is weg: niets maken', u.fout === 'weg' && t.ctx.geschreven === 0);
  }
  {
    const t = maak({ bijBackup: (c) => { c.tekst += 'Y;gat;Geboren;D20000110;1\n'; c.mtime++; } });
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('gewijzigd in het gat tussen lezen en schrijven: niets geschreven, geen herhaling (034)',
       u.fout === 'gewijzigd' && t.ctx.geschreven === 0 && /Y;gat/.test(t.ctx.tekst));
  }
  {
    const t = maak();
    const u = await t.op({ soort: 'wijzig', oud: 'Q;q;Geboren;D20000101;1', rec: C });
    ok('het event staat niet in dezelfde tekst: toch niets schrijven', u.fout === 'gewijzigd' && t.ctx.geschreven === 0);
  }
  {
    const t = maak();
    t.zetSepMist(',');
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('past het scheidingsteken niet (meer), dan niets schrijven, met een eigen fout (039)', u.fout === 'sep' && t.ctx.geschreven === 0);
  }
  {
    /* 037: geen enkele regel te lezen (een ander scheidingsteken), dan geen regel
       met het verkeerde teken erbij */
    const t = maak({ tekst: 'A^a^Geboren^D20000101^1\n' });
    t.zetRecords('A^a^Geboren^D20000101^1\n');
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('niets te lezen: opslaan schrijft er geen regel bij (037)', u.fout === 'sep' && t.ctx.geschreven === 0);
  }
  {
    /* 037: _backup_groot wordt nooit door een kleinere versie vervangen */
    const ctx = { fs: { 'ev_backup_groot.txt': 'a\nb\nc\nd\n' } };
    const groot = new Function('ctx', [
      'var NIET_UTF8 = { nietUtf8:true };', haal('pad'), haal('backupNaam'), haal('telTekst'), haal('leesTekst'), haal('datumNaam'), haal('vrijeNaam'), haal('schrijfBestand'),
      'var dirHandle = { getFileHandle: function(n, o){',
      '  if(!(n in ctx.fs) && !(o && o.create)){ var e = new Error("x"); e.name = "NotFoundError"; return Promise.reject(e); }',
      '  if(ctx.fs[n] && ctx.fs[n].vast && !(o && o.create)){ var v = new Error("vast"); v.name = "NotReadableError"; return Promise.reject(v); }',
      '  return Promise.resolve({ getFile: function(){ return Promise.resolve(ctx.fs[n] && ctx.fs[n].onleesbaar',
      '    ? { arrayBuffer: function(){ return Promise.resolve(new Uint8Array([0xE9]).buffer); } }',
      '    : { text: function(){ return Promise.resolve(ctx.fs[n]); } }); },',
      '    createWritable: function(){ var b = ""; return Promise.resolve({ write: function(t){ b = t; return Promise.resolve(); }, close: function(){ ctx.fs[n] = b; return Promise.resolve(); } }); } });',
      '} };',
      haal('bewaarGroot'), 'return bewaarGroot;'].join('\n'))(ctx);
    await groot('ev.txt', 'x\ny\n');
    ok('een grotere _backup_groot blijft staan (037)', ctx.fs['ev_backup_groot.txt'] === 'a\nb\nc\nd\n');
    ok('en de kleinere, recentere komt ernaast, met de datum (039)',
       Object.keys(ctx.fs).some((n) => /^ev_backup_groot_\d{8}-\d{6}(-\d+)?\.txt$/.test(n) && ctx.fs[n] === 'x\ny\n'));
    await groot('ev.txt', '1\n2\n3\n4\n5\n');
    ok('ook een grotere vervangt hem niet: die komt ernaast (042)',
       ctx.fs['ev_backup_groot.txt'] === 'a\nb\nc\nd\n' &&
       Object.keys(ctx.fs).some((n) => /^ev_backup_groot_\d{8}-\d{6}(-\d+)?\.txt$/.test(n) && ctx.fs[n] === '1\n2\n3\n4\n5\n'));
    ok('en twee in dezelfde seconde overschrijven elkaar niet (042)',
       Object.keys(ctx.fs).filter((n) => /^ev_backup_groot_/.test(n)).length === 2);
    /* 041: een bestaande _backup_groot die geen UTF-8 is, wordt niet overschreven */
    ctx.fs['ev_backup_groot.txt'] = { onleesbaar: true };
    await groot('ev.txt', '1\n2\n3\n4\n5\n6\n');
    ok('een onleesbare _backup_groot blijft staan; de nieuwe komt ernaast (041)',
       ctx.fs['ev_backup_groot.txt'].onleesbaar === true &&
       Object.keys(ctx.fs).some((n) => /^ev_backup_groot_\d{8}-\d{6}(-\d+)?\.txt$/.test(n) && ctx.fs[n] === '1\n2\n3\n4\n5\n6\n'));
    ctx.fs['ev_backup_groot.txt'] = { vast: true };
    await groot('ev.txt', 'q\n');
    ok('een _backup_groot die de sync even vasthoudt, wordt niet overschreven (043)',
       ctx.fs['ev_backup_groot.txt'].vast === true && Object.keys(ctx.fs).some((n) => /^ev_backup_groot_/.test(n) && ctx.fs[n] === 'q\n'));
  }
  {
    /* 037: Toch opslaan van de configuratie zet geen ander scheidingsteken of bestand terug */
    const maakCfg = (opSchijf, nietUtf8) => {
      const ctx = { fs: { 'events_cfg.json': opSchijf }, geschreven: 0, nietUtf8: nietUtf8 };
      const f = new Function('ctx', [
        'var CFG_NAAM = "events_cfg.json", cfgCRLF = false, cfgGelezen = 1, cfgGrootte = 1;',
        'var cfg = { bestand: "ev.txt", scheidingsteken: ";" };',
        'var CFGBOTSING = { cfgBotsing:true, onbekend:false }, CFGKERN = { cfgKern:true };',
        'var kopieRij = { bestand: "ev.txt", tekst: "x", mtime: 1, grootte: 1 }; function bewaarKopie(n, t, st){ ctx.kopie = { n: n, t: t, cfg: JSON.parse(JSON.stringify(cfg)) }; return Promise.resolve(); }',
        'function kopieVanBestand(){ return kopieRij && kopieRij.tekst; }',
        'var cfgNietUtf8 = !!ctx.nietUtf8, CFGUTF8 = { cfgUtf8:true };',
        SCRIPT.match(/^var CFG_VOLGORDE = .*$/m)[0], haal('ordenCfg'), haal('zonderStuurtekens'),
        'function cfgGewijzigd(){ return Promise.resolve("anders"); }',
        'function maybeBackup(){ return Promise.resolve(); }',
        'var dirHandle = { getFileHandle: function(n){ return Promise.resolve({',
        '  getFile: function(){ return Promise.resolve(ctx.fs[n] && ctx.fs[n].ansi',
        '    ? { lastModified: 2, size: 3, arrayBuffer: function(){ return Promise.resolve(new Uint8Array([0x7B, 0xE9, 0x7D]).buffer); }, text: function(){ return Promise.resolve("{\\uFFFD}"); } }',
        '    : { lastModified: 2, size: 3, text: function(){ return Promise.resolve(ctx.fs[n]); } }); },',
        '  createWritable: function(){ return Promise.resolve({ write: function(t){ ctx.fs[n] = t; return Promise.resolve(); }, close: function(){ ctx.geschreven++; return Promise.resolve(); } }); } }); } };',
        'var NIET_UTF8 = { nietUtf8:true };', haal('leesTekst'), haal('kernVanSchijf'), haal('schrijfCfg'),
        'return { schrijf: schrijfCfg, KERN: CFGKERN, UTF8: CFGUTF8 };'].join('\n'))(ctx);
      return { ctx, ...f };
    };
    let t = maakCfg('{"bestand":"ev.txt","scheidingsteken":","}');
    let uit = await t.schrijf(true, { bestand: 'ev.txt', scheidingsteken: ';', titel: 'B' }).then(() => 'geschreven', (e) => e === t.KERN ? 'kern' : 'anders: ' + (e && e.message));
    ok('Toch opslaan met een ander teken op schijf: geweigerd (037)', uit === 'kern' && t.ctx.geschreven === 0, uit);
    t = maakCfg('{"bestand":"ev.txt","scheidingsteken":";","titel":"van buiten"}');
    uit = await t.schrijf(true, { bestand: 'ev.txt', scheidingsteken: ';', titel: 'B' }).then(() => 'geschreven', (e) => 'anders: ' + (e && e.message));
    ok('alleen de titel van buiten anders: Toch opslaan gaat wel', uit === 'geschreven' && t.ctx.geschreven === 1, uit);
    const t2 = maakCfg('{"bestand":"ev.txt","scheidingsteken":";"}');
    await t2.schrijf(true, { bestand: 'ev.txt', scheidingsteken: ';', titel: 'met\ttab', types: [{ omschrijving: 'a\u0001b' }] });
    {
      /* 045: ook zonder de vlag: wat nu op schijf staat en geen UTF-8 is, wordt niet overschreven */
      const t5 = maakCfg({ ansi: true });
      const u5 = await t5.schrijf(true, { bestand: 'ev.txt', titel: 'x' }).then(() => 'geschreven', (e) => e === t5.UTF8 ? 'geweigerd' : 'anders: ' + (e && e.message));
      ok('de configuratie op schijf is (weer) geen UTF-8: niet overschreven, ook zonder vlag (045)', u5 === 'geweigerd' && t5.ctx.geschreven === 0, u5);
    }
    const t3 = maakCfg('{"bestand":"ev.txt"}', true);
    const u3 = await t3.schrijf(false, { bestand: 'ev.txt', titel: 'x' }).then(() => 'geschreven', (e) => e === t3.UTF8 ? 'geweigerd' : 'anders');
    ok('een configuratie die geen UTF-8 is, wordt niet overschreven (043)', u3 === 'geweigerd' && t3.ctx.geschreven === 0, u3);
    const t4 = maakCfg('{"bestand":"ev.txt","scheidingsteken":";"}');
    await t4.schrijf(true, { bestand: 'ev.txt', scheidingsteken: '\t', titel: 'a\tb' });
    ok('een tab als scheidingsteken blijft een tab; in de titel wordt hij een spatie (043)',
       JSON.parse(t4.ctx.fs['events_cfg.json']).scheidingsteken === '\t' && JSON.parse(t4.ctx.fs['events_cfg.json']).titel === 'a b');
    ok('stuurtekens in de configuratie worden een spatie (042)',
       /"titel": "met tab"/.test(t2.ctx.fs['events_cfg.json']) && /"omschrijving": "a b"/.test(t2.ctx.fs['events_cfg.json']), t2.ctx.fs['events_cfg.json']);
    ok('en daarna staat de nieuwe configuratie ook in de leeskopie (039)',
       !!t.ctx.kopie && t.ctx.kopie.n === 'ev.txt' && t.ctx.kopie.t === 'x' && t.ctx.kopie.cfg.titel === 'B');
  }
  {
    /* 039: een bestand dat geen UTF-8 is, wordt niet stil gelezen */
    const lees = new Function([ 'var NIET_UTF8 = { nietUtf8:true };', haal('leesTekst'), 'return { lees: leesTekst, N: NIET_UTF8 };'].join('\n'))();
    const fout = await lees.lees({ arrayBuffer: () => Promise.resolve(new Uint8Array([0x52, 0xE9, 0x0A]).buffer), text: () => Promise.resolve('R\uFFFD\n') })
      .then(() => 'gelezen', (e) => e === lees.N ? 'niet utf-8' : 'anders');
    ok('een é als byte E9 (ANSI): leesTekst weigert (039)', fout === 'niet utf-8', fout);
    const goed = await lees.lees({ arrayBuffer: () => Promise.resolve(new TextEncoder().encode('\uFEFFRené\n').buffer) });
    ok('gewone UTF-8 met BOM leest gewoon', goed === '\uFEFFRené\n');
  }
  {
    const t = maak({ tekst: '﻿A;a;Geboren;D20000101;1\r\n' });
    const u = await t.op({ soort: 'nieuw', rec: C });
    ok('CRLF en BOM blijven, ook als de browser de BOM bij text() weghaalt (035)', u.ok && t.ctx.tekst === '﻿A;a;Geboren;D20000101;1\r\nC;c;Geboren;D20000103;1\r\n', JSON.stringify(t.ctx.tekst));
  }
}

{
  /* Het slot rond het opslaan. Een tweede opslag terwijl de eerste loopt wordt
     geweigerd, niet half gedaan; en niets mag het slot laten hangen, ook geen
     synchrone uitzondering -- dan kan er nooit meer worden opgeslagen en blijft
     herladen geblokkeerd. */
  const maakO = (hoe) => {
    const ctx = { geschreven: 0 };
    const fn = new Function('ctx', [
      'var hasFSA = true, bestandsnaam = "events_mark.txt";',
      /* de controle vlak voor het schrijven leest de stempel; hier zonder stempel */
      'var dirHandle = { getFileHandle: function(){ return Promise.resolve({ getFile: function(){ return Promise.resolve(null); } }); } };',
      haal('opmaakVan'), haal('telTekst'), 'function alleOnbegrepen(){ return false; } function zetSepOnafgemaakt(t){ sepOnafgemaakt = t || ""; }',
      'var schrijfBezig = false, fileState = "ok", sepOnafgemaakt = "", sepMist = "", records = [], basisTekst = null;',
      'var GEEN_TOEGANG = { geenToegang:true }, BESTAND_WEG = { bestandWeg:true }, SEPFOUT = { sepFout:true }, NIET_UTF8 = { nietUtf8:true }, nietUtf8 = false;',
      hoe === 'synchroon'
        ? 'function zorgVoorToegang(){ throw new TypeError("kapot"); }'
        : hoe === 'toegang'
          ? 'function zorgVoorToegang(){ return Promise.reject(GEEN_TOEGANG); }'
          : 'function zorgVoorToegang(){ return Promise.resolve(); }',
      hoe === 'leesfout'
        ? 'function leesVoorSchrijven(){ return Promise.reject(new Error("leesfout")); }'
        : 'function leesVoorSchrijven(){ return new Promise(function(r){ setTimeout(function(){ r({ lijst:[], tekst:"", stempel:null, nieuw:true }); }, 5); }); }',
      'function pasToe(l, w){ l.push(w.rec); return { ok:true, rec:w.rec, voor:null }; }',
      'function sorteer(){} function serialize(l){ return l.length + "\\n"; }',
      'function maybeBackup(){ return Promise.resolve(); }',
      'function schrijfTekst(){ ctx.geschreven++; return Promise.resolve({ lastModified:1, size:2 }); }',
      'function neemOver(l){ records = l; }',
      'var laatsteOpslag = null;', haal('nuMs'), haal('opslaanWijziging'),
      'return { op: opslaanWijziging, slot: function(){ return schrijfBezig; } };'
    ].join('\n'))(ctx);
    return { ctx, ...fn };
  };
  {
    const t = maakO('gewoon');
    const een = t.op({ soort: 'nieuw', rec: {} }), twee = t.op({ soort: 'nieuw', rec: {} });
    const [u1, u2] = await Promise.all([een, twee]);
    ok('een opslag schrijft', u1.ok === true && t.ctx.geschreven === 1);
    ok('een tweede tegelijk wordt geweigerd', u2.fout === 'bezig');
    ok('en het slot staat daarna weer open', t.slot() === false);
  }
  {
    const t = maakO('synchroon');
    let viel = false, u = null;
    try { u = await t.op({ soort: 'nieuw', rec: {} }); } catch (e) { viel = true; }
    ok('een synchrone uitzondering ontsnapt niet', viel === false);
    ok('en komt terug als mislukt', u && u.fout === 'mislukt');
    ok('zonder het slot te laten hangen', t.slot() === false);
  }
  {
    const t = maakO('leesfout');
    const u = await t.op({ soort: 'nieuw', rec: {} });
    ok('een leesfout komt terug als mislukt, zonder te schrijven', u.fout === 'mislukt' && t.ctx.geschreven === 0);
    ok('en laat het slot ook niet hangen', t.slot() === false);
  }
  {
    const t = maakO('toegang');
    const u = await t.op({ soort: 'nieuw', rec: {} });
    ok('geweigerde toegang komt terug als toegang', u.fout === 'toegang' && t.slot() === false);
  }
}

{
  /* Geen controle bij terugkeer meer: die gaf te veel onduidelijke meldingen. Wat
     blijft: zelf opnieuw inlezen, en de botsingscontrole bij het opslaan. */
  ok('bij terugkeer naar de app wordt het bestand niet gecontroleerd',
     !/function kijkExtern\s*\(/.test(SCRIPT) && !/kijkExtern\(/.test(SCRIPT) &&
     !/addEventListener\('focus'/.test(SCRIPT));
  ok('App-status vult het versienummer alleen in als het scherm er nog is',
     /if\(document\.contains\(el\)\) el\.innerHTML = html;/.test(haal('statusVersieKopie')));
  ok('voor elke opslag wordt het bestand opnieuw gelezen',
     /leesVoorSchrijven\(w\.leesSep\)/.test(haal('opslaanWijziging')) &&
     /if\(\(v\.nieuw \? null : v\.tekst\) !== verwacht\) throw gewijzigd/.test(haal('opslaanWijziging')));
  ok('de tabel verandert pas als het bestand is geschreven',
     /schrijfTekst\(bestandsnaam, tekst, v\.handle\)[\s\S]{0,700}neemOver\(v\.lijst, tekst, f2\)/.test(haal('opslaanWijziging')));
  ok('er is geen niet-opgeslagen toestand en geen balk boven de tabel meer',
     !/function nietOpgeslagen\s*\(/.test(SCRIPT) && !/id="fToch"/.test(SCRIPT) && !/beforeunload/.test(SCRIPT));
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
  ok('openModal weigert zonder bestand en zonder kopie',
     /if\(!magBewerken\(\)\) return;/.test(poortBron), 'poort aanwezig');
  ok('de verwijderknop ook',
     /if\(editRegel === null \|\| !magBewerken\(\)\) return;/.test(SCRIPT));
  ok('en de knop Ongedaan maken ook',
     /\$\('btnUndo'\)\.onclick = function\(\)\{\s*\n\s*if\(!terug \|\| !magBewerken\(\)\) return;/.test(SCRIPT));
  ok('en magBewerken is magWijzigen of op de kopie met toegang te vragen',
     /function magBewerken\(\)\{ return \(magWijzigen\(\) \|\| kanToegangVragen\(\)\) && !sepOnafgemaakt && !sepMist && !alleOnbegrepen\(\) && !nietUtf8; \}/.test(SCRIPT));
  /* Sinds 1352898-003 mag bewerken op de leeskopie als er om toegang gevraagd
     kan worden; die vraag komt bij het opslaan. De poort blijft openModal zelf
     (magBewerken), dus zonder bestand en zonder kopie wordt er niets bewerkt. */
  ok('btnEdit staat op dezelfde voorwaarde als btnNew',
     /\$\('btnEdit'\)\.disabled = !magBewerken\(\);/.test(SCRIPT) &&
     /\$\('btnNew'\)\.disabled = !magBewerken\(\);/.test(SCRIPT),
     'dit was het gat: alleen btnNew was afgedicht');
  ok('bewerken op de kopie kan alleen met een werkmap en een kopie',
     /function kanToegangVragen\(\)\{ return fileState === 'auth' && !!dirHandle && !!kopieRij && !!bestandsnaam; \}/.test(SCRIPT));
  ok('opslaan zonder toegang vraagt eerst daarom',
     /if\(fileState !== 'auth'\) return Promise\.resolve\(\);[\s\S]{0,200}dirHandle\.requestPermission/.test(haal('zorgVoorToegang')));
  /* De statusregel zegt alleen dat het de leeskopie is en van wanneer; niet
     wanneer er om toegang wordt gevraagd. */
  const status = haal('tekenBestandStatus');
  ok('de statusregel toont zonder toegang het moment van de kopie',
     /tekst = \(kopieRij && kopieRij\.tijd\) \? kopieTijd\(kopieRij\.tijd\) : '';/.test(status));
  let tijdTekst = '(geen kopieTijd)';
  try { tijdTekst = new Function(haal('kopieTijd') + '; return kopieTijd(new Date(2026, 9, 6, 9, 5).getTime());')(); } catch (e) {}
  ok('als dd-mm-jjjj uu:mm', tijdTekst === '06-10-2026 09:05', tijdTekst);
  ok('zonder verdere woorden', !/'leeskopie/.test(status));
  /* vandaag en gisteren, op de kalenderdag (ook rond de zomertijd) */
  const kt = (ms, nu) => { try { return new Function('ms', 'nu', haal('kopieTijd') + '; return kopieTijd(ms, nu);')(ms, nu); } catch (e) { return '(fout)'; } };
  const NU = new Date(2026, 9, 16, 17, 51).getTime();
  ok('vandaag', kt(new Date(2026, 9, 16, 0, 5).getTime(), NU) === 'vandaag 00:05', kt(new Date(2026, 9, 16, 0, 5).getTime(), NU));
  ok('gisteren', kt(new Date(2026, 9, 15, 23, 59).getTime(), NU) === 'gisteren 23:59', kt(new Date(2026, 9, 15, 23, 59).getTime(), NU));
  ok('eergisteren als datum', kt(new Date(2026, 9, 14, 20, 3).getTime(), NU) === '14-10-2026 20:03');
  {
    /* 25 oktober 2026 duurt in Nederland 25 uur: 24 uur terug vanaf middernacht
       op de 26e valt dan niet op het begin van de 25e */
    const tzWas = process.env.TZ; process.env.TZ = 'Europe/Amsterdam';
    const uit = kt(new Date(2026, 9, 25, 23, 30).getTime(), new Date(2026, 9, 26, 23, 50).getTime());
    if (tzWas === undefined) delete process.env.TZ; else process.env.TZ = tzWas;
    ok('gisteren over de wisseling naar wintertijd heen', uit === 'gisteren 23:30', uit);
  }
  ok('gisteren over de maandgrens', kt(new Date(2026, 8, 30, 8, 0).getTime(), new Date(2026, 9, 1, 8, 0).getTime()) === 'gisteren 08:00');
  ok('de statusregel toont altijd het moment, ook met toegang',
     /var tekst = \(kopieRij && kopieRij\.tijd\) \? kopieTijd\(kopieRij\.tijd\) : '';/.test(status) &&
     !/stand\.tekst/.test(status));
  ok('de stapbalk toont naam en actie op een eigen regel',
     /var stapHtml = terugHtml\(\);\s*\n\s*if\(\$\('stapTekst'\)\.innerHTML !== stapHtml\) \$\('stapTekst'\)\.innerHTML = stapHtml;/.test(SCRIPT) && /class="stap-actie"/.test(haal('terugHtml')));
  ok('Opslaan blijft Opslaan: geen verwijderknop of Toch meer (034)',
     !/modalActie|zetBevestig\('mOk'/.test(SCRIPT) && /\$\('mOk'\)\.onclick = bewaarModal;/.test(SCRIPT) &&
     /weg \? 'Verwijderen mislukt\.' : 'Opslaan mislukt\.'/.test(haal('voerVensterUit')));
  ok('tijdens het opslaan gaat een venster niet dicht',
     /if\(vensterBezig && \(id === 'modal' \|\| id === 'cfgModal' \|\| id === 'filterModal'\)\)/.test(haal('sluitBovenste')));
  ok('opslaan maakt de gewone dagbackup, nooit een _buiten (034)',
     /return maybeBackup\(bestandsnaam\)/.test(haal('opslaanWijziging')) && !/forceer/.test(haal('opslaanWijziging')));
  ok('ongedaan maken houdt de stap vast als er eerst om toegang wordt gevraagd',
     /var stap = terug;[\s\S]{0,200}terug = stap;/.test(haal('voerStapUit')));
  ok('tweede review: de scheidingsteken-melding verdwijnt alleen na het herschrijven',
     /if\(w\.soort === 'alles'\)\{ zetSepOnafgemaakt\(''\); sepMist = ''; \}/.test(haal('opslaanWijziging')));
  ok('een nieuw scheidingsteken: eerst het bestand nakijken, dan de configuratie schrijven',
     /voorcontrole\.then\(function\(\)\{ return schrijfCfg\(cfgForceer, nieuw\); \}\)/.test(haal('bewaarCfg')) &&
     /leesVoorSchrijven\(bestandSep\)/.test(haal('bewaarCfg')));
  ok('het venster geeft zijn eigen basis mee (de tekst van het openen) (034)',
     /w\.basisTekst = modalBasisTekst;/.test(haal('voerVensterUit')) && /modalBasisTekst = basisTekst;/.test(haal('openModal')));
  ok('de melding en de knoppen komen in beeld, ook onderaan een lang venster',
     /o\.scrollTop = o\.scrollHeight/.test(haal('toonVensterMelding')));
  ok('buiten de app gewijzigd: Verder bewerken en Opnieuw inlezen in de melding, geen vraagvenster (034/038)',
     /id="mGewAnnuleer">Verder bewerken</.test(haal('voerVensterUit')) &&
     /id="mGewInlezen">' \+ \(res\.fout === 'weg' \? 'Nieuw bestand' : 'Opnieuw inlezen'\)/.test(haal('voerVensterUit')) &&
     /sluitModal\(\);\s*\n\s*opnieuwInlezen\(true\)/.test(haal('voerVensterUit')) &&
     !/vraag\(/.test(haal('voerVensterUit')));
  ok('Annuleren in de configuratie gaat via sluitBovenste (vraagt bij een wijziging)',
     /\$\('cfgCancel'\)\.onclick = function\(\)\{ sluitBovenste\(false\); \};/.test(SCRIPT));
  ok('na het bewaren van een kopie is die ook in beeld',
     /kopieRij = rij; kopieFout = ''; tekenBestandStatus\(\);/.test(haal('bewaarKopie')));
  ok('en niet wanneer er om toegang wordt gevraagd', !/om toegang wordt gevraagd/.test(status));
  ok('een configuratie uit een kopie zonder stempel geldt bij het opslaan als niet na te gaan',
     /if\(cfgGelezen === -1\) return 'onbekend';/.test(SCRIPT));
  /* Sinds 1352898-005 werkt het als in Trends: bij het opstarten zonder toegang
     telt alleen een kopie met stempel. Een oude kopie zonder stempel kon
     achterlopen; dan eerst toegang en het echte bestand. */
  ok('opstarten zonder toegang gebruikt alleen een kopie met stempel',
     /fileState = 'auth';\s*return vulUitKopie\(true\)/.test(SCRIPT) &&
     /if\(metStempel && typeof rij\.mtime !== 'number'\) return false;/.test(haal('vulUitKopie')));
  ok('ook zonder werkmap telt alleen een kopie met stempel',
     /return vulUitKopie\(true\)/.test(haal('leesKopie')));
  ok('de kopie-datums staan overal als dd-mm-jjjj uu:mm',
     !/toLocaleString/.test(SCRIPT) && /kopieTijd\(kopieRij\.tijd\)/.test(haal('kopieTekst')));
  ok('zonder bruikbare kopie vraagt de balk om toegang',
     /toegangGeweigerd \|\| !kopieRij/.test(haal('renderFilebar')) &&
     /'<div class="banner-text">Geen toegang tot ' \+ mapNaam \+ '\.<\/div>'/.test(haal('renderFilebar')));
}

{
  /* C. Een event wordt op inhoud teruggevonden, niet op positie: het venster
     onthoudt de regel uit het bestand, en opslaanWijziging zoekt die in het
     bestand zoals het dan is. */
  ok('het bewerkvenster stuurt de regel uit het bestand mee',
     /\{ soort:'wijzig', oud:editRegel, rec:rec \}/.test(haal('bewaarModal')));
  ok('en het verwijderen ook', /\{ soort:'weg', oud:editRegel \}/.test(haal('verwijderVanuitVenster')));
  ok('de basis is de lijst van toen het venster openging', /modalBasis = records\.slice\(\);/.test(haal('openModal')));
}

{
  /* D. Bij 'Toch opslaan' van de configuratie hoort er een backup te komen, ook
     als er die dag al een is: op schijf staat dan juist de wijziging van buiten. */
  const maakBack = (alGehad, schrijfFaalt) => {
    const ctx = { gelezen: 0, geschreven: 0, namen: [], dagGezet: 0 };
    return new Function('ctx', [
      'var backupDag = {};',
      'function dagsleutel(){ return "2026-10-12"; }',
      'function backupNaam(n, extra){ ctx.namen.push(n + (extra || "") + ".bak"); return n + (extra || "") + ".bak"; }',
      'function idbGet(){ return Promise.resolve(' + (alGehad ? '"2026-10-12"' : 'null') + '); }',
      'function idbPut(){ ctx.dagGezet++; return Promise.resolve(); }',
      'var backupFout = "";',
      'var dirHandle = { getFileHandle: function(n, o){',
      '  if(o && o.create){ ' + (schrijfFaalt ? 'return Promise.reject(new Error("vol")); ' : '') + 'ctx.geschreven++; return Promise.resolve({ createWritable: function(){',
      '    return Promise.resolve({ write: function(){ return Promise.resolve(); },',
      '                             close: function(){ return Promise.resolve(); } }); } }); }',
      '  ctx.gelezen++;',
      '  return Promise.resolve({ getFile: function(){ return Promise.resolve({ text: function(){ return Promise.resolve("INHOUD VAN SCHIJF"); } }); } });',
      '} };',
      'var CFG_NAAM = "events_cfg.json", NIET_UTF8 = { nietUtf8:true };', haal('isKrimp'), haal('leesTekst'), haal('leesRuw'),
      SCRIPT.match(/^var BUITEN_MISLUKT = .*$/m)[0],
      haal('backupBuiten'), haal('maybeBackup'),
      'return { maybeBackup: maybeBackup, ctx: ctx, BUITEN: BUITEN_MISLUKT };'
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
    /* Toch opslaan bestaat alleen nog voor de configuratie (034) */
    const b = maakBack(true);
    await b.maybeBackup('events_cfg.json', true);
    ok('Toch opslaan van de configuratie: eerst een backup van de versie van buiten, ook al is er vandaag al een',
       b.ctx.geschreven === 1,
       'anders staat de wijziging van buiten na het opslaan nergens meer');
    ok('en dan in een eigen bestand (_buiten): de backup van de dag blijft staan (1352898-030)',
       b.ctx.namen.join() === 'events_cfg.json_buiten.bak' && b.ctx.dagGezet === 0, b.ctx.namen.join() + ' / dag gezet: ' + b.ctx.dagGezet);
  }
  {
    const b = maakBack(true, true);
    const uit = await b.maybeBackup('events_cfg.json', true).then(() => 'door', (e) => e === b.BUITEN ? 'gestopt' : 'anders');
    ok('lukt die backup niet, dan stopt het opslaan (042)', uit === 'gestopt', uit);
  }
  /* De reden bij het herschrijven en de focus in de stapmelding worden in de
     zelftest op gedrag getest (039), niet hier op letterlijke code. */
  ok('overal heet het Opnieuw inlezen (035)', !/Opnieuw laden/.test(HTML));
  /* Visueel, en in de zelftest niet te meten (geen echte hover): op een telefoon blijft
     :hover na een tik staan, en dan won .btn-primary:disabled:hover{opacity:.35} (040). */
  ok('het rondje blijft in volle kleur, ook met een blijvende hover (040)',
     /button\.bezig:disabled,button\.bezig:disabled:hover\{opacity:1;/.test(HTML));
  ok('de oude omvang-sleutels worden opgeruimd (035)', /idbDel\('omvang:' \+ bestandsnaam\)/.test(haal('laden')));
  ok('het events-bestand kent geen Toch meer: alleen de dagbackup (034)',
     /return maybeBackup\(bestandsnaam\)/.test(haal('opslaanWijziging')));
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

  /* En wat schrijfCfg met dat antwoord doet: niet schrijven maar de oranje balk,
     net als bij het events-bestand; Toch opslaan (forceer) zet de versie van
     buiten eerst in de backup. */
  const bron = haal('schrijfCfg');
  ok('schrijfCfg vraagt eerst of de configuratie is gewijzigd',
     /return cfgGewijzigd\(\)\.then\(/.test(bron), 'controle aanwezig');
  ok('bij Toch opslaan een backup, ook als er vandaag al een is',
     /maybeBackup\(CFG_NAAM, !!forceer\)/.test(bron));
  ok('wat er is weggeschreven wordt daarna de nieuwe basis',
     /cfgGelezen = f\.lastModified; cfgGrootte = f\.size;/.test(bron),
     'anders zou elke volgende keer opslaan een extra backup maken');
  ok('een wijziging van buiten wordt niet overschreven maar gemeld (CFGBOTSING)',
     /if\(stand !== 'gelijk' && !forceer\)\{ CFGBOTSING\.onbekend = \(stand === 'onbekend'\); throw CFGBOTSING; \}/.test(bron));
  ok('Instellingen en het standaardfilter tonen een botsing in hun eigen venster',
     /zetBevestig\('cfgOk', 'Toch opslaan', 'btn-warn'\)/.test(haal('bewaarCfg')) &&
     /return e === CFGBOTSING \? \{ botsing:true, onbekend:e\.onbekend \} : e === GEEN_TOEGANG \? 'toegang' : e === CFGKERN \? 'kern' : e === CFGNIEUW \? 'nieuw' : e === BUITEN_MISLUKT \? 'buiten' : e === CFGUTF8 \? 'utf8' : false;/.test(haal('bewaarStandaardFilter')) &&
     /zetBevestig\('filterStd', 'Toch opslaan als standaard', 'btn-warn'\)/.test(SCRIPT));
  ok('de configuratie in de app verandert pas als het bestand is geschreven',
     /\.then\(function\(\)\{ cfg = nieuw; \}\)/.test(bron) &&
     /var nieuw = JSON\.parse\(JSON\.stringify\(cfg\)\);/.test(haal('bewaarCfg')));

  /* Het scheidingsteken over twee bestanden. Zolang de cfg al op het nieuwe
     teken staat en het events-bestand nog niet is herschreven, lopen de twee
     uiteen en is bij de volgende start elke regel onbegrepen. */
  ok('bewaarCfg onthoudt het oude teken tot het bestand is herschreven',
     /zetSepOnafgemaakt\(bestandSep\);/.test(SCRIPT));
  ok('het herschrijven leest het bestand met het oude teken',
     /opslaanWijziging\(\{ soort:'alles', leesSep:bestandSep \}\)/.test(haal('bewaarCfg')));
  ok('en opslaanWijziging wist dat weer na een gelukte schrijfactie',
     /zetSepOnafgemaakt\(''\); sepMist = '';/.test(haal('opslaanWijziging')));

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
      haal('sep'), haal('sepLabel'), haal('zoekBeterSep'), haal('parse'), haal('parseLijst'),
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
    /* 1352898-027: een tab kan de configuratie niet bewaren (geen witruimte), dus
       wordt hij ook niet voorgesteld */
    ok('een tab wordt niet voorgesteld', z.zoek(MET_TAB, z.parse(MET_TAB)) === '');
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
    haal('sep'), haal('parse'), haal('parseLijst'),
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
    SCRIPT.match(/^var VERBODEN = .*$/m)[0], SCRIPT.match(/^var GERESERVEERD = .*$/m)[0],
    'var NAAM_MAX = 120, CFG_NAAM = "events_cfg.json";', haal('bestandsnaamFout'),
    haal('isObject'), haal('keurCfg'),
    'return keurCfg;'
  ].join('\n'))();
  const keurCfg = maakKeur();
  {
    const k = [];
    const uit = keurCfg({ bestand: 'events_cfg.json', scheidingsteken: ';' }, k);
    ok('een cfg die met de hand naar zichzelf wijst: "bestand" overgeslagen en gemeld (031)',
       uit && uit.bestand === undefined && k.some((x) => /bestand/.test(x)), JSON.stringify(k));
    const k2 = [];
    ok('een gewone bestandsnaam blijft', keurCfg({ bestand: 'events_mark.txt' }, k2).bestand === 'events_mark.txt' && !k2.length);
  }
  {
    /* 044: als scheidingsteken is van de stuurtekens alleen een tab bruikbaar */
    const k = [];
    const uit = keurCfg({ bestand: 'e.txt', scheidingsteken: '\n', ofteken: '\r' }, k);
    ok('een regelovergang als scheidingsteken of of-teken: overgeslagen en gemeld (044)',
       uit.scheidingsteken === undefined && uit.ofteken === undefined &&
       k.filter((x) => /is een stuurteken en is overgeslagen/.test(x)).length === 2, JSON.stringify(k));
    const k2 = [];
    ok('een tab blijft, zonder klacht (043/044)', keurCfg({ bestand: 'e.txt', scheidingsteken: '\t' }, k2).scheidingsteken === '\t' && !k2.length);
  }
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
       klachten.filter((k) => /4 waarden bevatten een regelovergang of ander stuurteken/.test(k)).length === 1,
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

/* ---------- 17. Gelijk met Golf Score en Trends ---------- */
kop('17. De worker doet hetzelfde als die van Golf Score en Trends');
{
  /* Stap 1: ook de installatie heeft een grens. Een installatie die blijft hangen
     loopt nooit af, en zolang dat zo is doet registration.update() niets: de
     updatecontrole stond dan stil tot de app helemaal werd afgesloten. */
  const env = swOmgeving({ hangt: true });
  env.maakSw(SW.replace(/const GRENS = \d+;/, 'const GRENS = 120;'));
  const fout = await Promise.race([
    vuur(env, 'install').then(() => 'GESLAAGD', (e) => e),
    new Promise((r) => setTimeout(() => r('BLEEF HANGEN'), 2500))
  ]);
  ok('een installatie op een hangend netwerk loopt af', fout !== 'BLEEF HANGEN',
     fout === 'BLEEF HANGEN' ? 'bleef hangen' : '');
  ok('en mislukt', fout instanceof Error, String(fout && fout.message || fout));
  await rust();
  ok('het verzoek is werkelijk afgebroken', env.afgebroken.length >= 1, env.afgebroken.length + ' afgebroken');
  ok('er blijft geen lege huls achter', !env.store.has(CACHE_NAAM), [...env.store.keys()].join());
}
{
  const env = swOmgeving();
  await installeer(env);
  ok('de installatie haalt langs de browsercache',
     env.log.length > 0 && env.log.every((l) => l.cache === 'reload'),
     env.log.map((l) => l.cache).join(','));
}
{
  /* Stap 3: bij een cachetreffer ververst de pagina met no-cache. GitHub Pages
     laat een bestand 10 minuten bewaren; zonder dit kon de verversing dezelfde
     oude bytes terugschrijven en bleef de melding vlak na een push uit. */
  const env = swOmgeving();
  await installeer(env);
  await vuur(env, 'activate');
  env.log.length = 0;
  await vraagVan(env)(ORIGIN + '/events.html', 'navigate');
  ok('de achtergrondverversing van de pagina gebruikt no-cache',
     env.log.length === 1 && env.log[0].cache === 'no-cache', env.log.map((l) => l.cache).join(','));
  env.log.length = 0;
  await vraagVan(env)(ORIGIN + '/icon.svg');
  ok('een bijbestand niet: dat heeft geen stempel',
     env.log.length === 1 && env.log[0].cache !== 'no-cache', env.log.map((l) => l.cache).join(','));
  await rust();
}
{
  /* Stap 5: mist een paginaverzoek de cache terwijl de app er wel staat, dan
     niet de volle grens wachten maar na korte tijd de bewaarde app tonen. */
  const g = /const GRENS_MET_TERUGVAL = (\d+);/.exec(SW);
  ok('de worker kent een kortere grens als er een bewaarde app is', !!g && +g[1] === 3000, g && g[1] + ' ms');
  const env = swOmgeving({ hangt: true });
  env.maakSw(SW.replace(/const GRENS = \d+;/, 'const GRENS = 2000;')
               .replace(/const GRENS_MET_TERUGVAL = \d+;/, 'const GRENS_MET_TERUGVAL = 120;'));
  const c = await env.caches.open(CACHE_NAAM);
  await c.put(ORIGIN + '/events.html', new env.Res('DE APP', { type: 'basic' }));
  const begin = Date.now();
  const res = await vraagVan(env)(ORIGIN + '/', 'navigate');
  const duur = Date.now() - begin;
  ok('een misser met een bewaarde app levert die app', (await tekst(res)) === 'DE APP', await tekst(res));
  ok('na de korte grens, niet de volle', duur < 1000, duur + ' ms');
  await rust();
}
{
  /* Stap 6: een optioneel bestand dat bij de installatie niet binnenkomt,
     overnemen uit de nieuwste vorige eigen cache. Op nummer, niet op tekst:
     events-v10 is nieuwer dan events-v9. Nooit uit de cache van een buurapp. */
  const env = swOmgeving({ server: ['./', './index.html', './events.html'] });
  env.store.set('events-v9', new Map([[ORIGIN + '/icon.svg', new env.Res('icoon v9', { type: 'basic' })]]));
  env.store.set('events-v10', new Map([[ORIGIN + '/icon.svg', new env.Res('icoon v10', { type: 'basic' })]]));
  env.store.set('golf-score-v41', new Map([[ORIGIN + '/manifest.json', new env.Res('van golf', { type: 'basic' })]]));
  const fout = await installeer(env);
  ok('de installatie slaagt', fout === null, fout && fout.message);
  const c = env.store.get(CACHE_NAAM) || new Map();
  const icoon = c.get(ORIGIN + '/icon.svg');
  ok('het ontbrekende icoon komt uit de nieuwste vorige eigen cache',
     !!icoon && icoon.body === 'icoon v10', icoon ? icoon.body : 'ontbreekt');
  ok('en niets uit de cache van een buurapp', !c.has(ORIGIN + '/manifest.json'),
     c.has(ORIGIN + '/manifest.json') ? c.get(ORIGIN + '/manifest.json').body : '');
}
{
  /* Stap 7: een verzoek dat uitdrukkelijk vers wil, gaat langs de cache. App-status
     vraagt het manifest zo op om te zien wat er op de server staat; met de kopie uit
     de cache meldde die 'gevonden', ook offline of als het bestand weg was. */
  const inhoud = { [ORIGIN + '/manifest.json']: 'OUD' };
  const env = swOmgeving({ inhoud });
  await installeer(env);
  await vuur(env, 'activate');
  inhoud[ORIGIN + '/manifest.json'] = 'NIEUW';
  const vraag = vraagVan(env);
  const vers = await vraag(ORIGIN + '/manifest.json', 'cors', 'GET', 'no-store');
  ok('no-store komt van het netwerk', (await tekst(vers)) === 'NIEUW', await tekst(vers));
  await rust();
  const bewaard = (env.store.get(CACHE_NAAM) || new Map()).get(ORIGIN + '/manifest.json');
  ok('en wordt niet bewaard', !!bewaard && bewaard.body === 'OUD', bewaard && bewaard.body);
  /* eigen inhoud, zodat een kopie die de vorige vraag toch bewaarde hier niet slaagt */
  inhoud[ORIGIN + '/manifest.json'] = 'NIEUWER';
  const reload = await vraag(ORIGIN + '/manifest.json', 'cors', 'GET', 'reload');
  ok('ook reload gaat langs de cache', (await tekst(reload)) === 'NIEUWER', await tekst(reload));
  env.zetOffline();
  const off = await vraag(ORIGIN + '/manifest.json', 'cors', 'GET', 'no-store');
  ok('offline geeft no-store een fout en niet de oude kopie', !!off && off.status === 503,
     off && (off.status + ' ' + (await tekst(off))));
}

/* ---------- 18. De balk met de laatste stap ---------- */
kop('18. De laatste stap: een balk met ongedaan maken en bevestigen');
{
  /* Tot 1352897-001 stond er een pil met de tekst van de laatste stap, en een
     losse knop Ongedaan maken in de kopregel. De pil wegtikken liet de knop
     staan, dus nam die ruimte in tot er een volgende stap kwam. Nu staan tekst,
     ongedaan maken en bevestigen samen in een balk; bevestigen vergeet de stap
     en de balk verdwijnt. */
  const kopregel = (HTML.match(/<div class="panel-head">([\s\S]*?)<\/div>/) || [])[1] || '';
  ok('de kopregel heeft geen knop Ongedaan maken meer', !/id="btnUndo"/.test(kopregel));
  ok('de pil bestaat niet meer', !/id="laatste"/.test(HTML));
  const balk = (HTML.match(/<div class="stapbalk" id="stapbalk"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
  ok('er is een balk voor de laatste stap', !!balk);
  const volgorde = ['id="stapTekst"', 'id="btnUndo"', 'id="btnStapOk"'].map((t) => balk.indexOf(t));
  ok('met de tekst, dan ongedaan maken, dan bevestigen',
     volgorde.every((x) => x >= 0) && volgorde[0] < volgorde[1] && volgorde[1] < volgorde[2], volgorde.join(','));
  ok('de tekst wordt voorgelezen als hij verandert', /id="stapTekst"[^>]*aria-live="polite"/.test(balk));
  ok('de tekst is geen knop: wegtikken kan niet per ongeluk', !!balk && !/<button[^>]*id="stapTekst"/.test(balk));
  /* Het vinkje in dezelfde stijl als de pijl van ongedaan maken: zelfde maat,
     zelfde lijndikte, ronde uiteinden. */
  const stijl = (svg) => svg ? [(/width="(\d+)"/.exec(svg) || [])[1], (/stroke-width="([\d.]+)"/.exec(svg) || [])[1],
                                 /stroke-linecap="round"/.test(svg), /stroke-linejoin="round"/.test(svg)].join(' ') : '(geen)';
  const vink = (balk.match(/id="btnStapOk"[^>]*>\s*(<svg[\s\S]*?<\/svg>)/) || [])[1];
  const pijl = (SCRIPT.match(/var ICON_UNDO = '(<svg[\s\S]*?<\/svg>)'/) || [])[1];
  ok('het vinkje heeft de stijl van de pijl', !!vink && stijl(vink) === stijl(pijl), stijl(vink) + ' / ' + stijl(pijl));
  ok('beide zijn een icoonknop van 44 bij 44',
     /<button class="icon-btn" id="btnUndo"/.test(balk) && /<button class="icon-btn" id="btnStapOk"/.test(balk));
  /* Bevestigen vergeet de stap; daarna valt er niets meer terug te draaien. */
  ok('bevestigen vergeet de stap',
     /\$\('btnStapOk'\)\.onclick = function\(\)\{ terug = null; stapMelding = ''; render\(\); \};/.test(SCRIPT));
  ok('de balk staat er zolang er een stap is, behalve als er een melding op zijn plek staat',
     /\$\('stapbalk'\)\.hidden = !terug \|\| !!stapMelding;/.test(SCRIPT));
  ok('en er is geen aparte schakelaar meer om alleen de melding te verbergen', !/pilWeg/.test(SCRIPT));
}

afsluiten();
}
