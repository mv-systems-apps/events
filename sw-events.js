/* Service worker voor Events: stale-while-revalidate. Meteen uit de eigen
   cache bedienen en op de achtergrond verversen; of er een nieuwe versie is,
   beslist de app zelf (checkAppUpdate, met het versiestempel).

   De drie service workers doen hetzelfde, elk in de schrijfstijl van de eigen
   app; de gedeelde regels staan in apps-basis/conventies.md, paragraaf 3.
   Wijzig je hier iets wezenlijks, doe het dan ook daar en in de andere twee.

   CACHE_VERSION is de naam van de cache. update_cache_version.py verhoogt hem,
   en dat hoort zodra dit bestand of de lijst met appbestanden wijzigt: anders
   installeert de nieuwe worker in dezelfde cache waaruit de oude nog bedient.
   Het versiestempel in events.html is een eigen teller en gaat met de hand
   omhoog. */

const CACHE_VERSION = 162;
const CACHE_NAME = 'events-v' + CACHE_VERSION;

/* Zonder dit bestand is er niets om offline te openen, dus dit moet slagen. */
const VERPLICHT = [
  './events.html'
];
/* De rest is gemak: './' en index.html sturen alleen door naar events.html,
   manifest en icoon zijn voor het installeren als app. Ze mogen mislukken:
   niet elke server beantwoordt een kale map, en dan zou die ene de hele
   installatie blokkeren. */
const OPTIONEEL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];
const ASSETS = VERPLICHT.concat(OPTIONEEL);

/* Drie uiterste wachttijden, naar de rol van het verzoek; bij de grens wordt
   het verzoek echt afgebroken (zie metGrens).
   - GRENS: een cachemisser; dan is dit verzoek het antwoord. Ook elke
     ophaalpoging van de installatie: een installatie die blijft hangen loopt
     nooit af, en zolang dat zo is doet registration.update() niets.
   - GRENS_MET_TERUGVAL: een paginaverzoek mist de cache terwijl de app wel
     bewaard is. Lang wachten koopt dan niets: liever na 3 s de bewaarde app.
   - GRENS_ACHTERGROND: een cachetreffer. Het antwoord is al gegeven en dit
     verzoek ververst alleen de kopie; daar wacht niemand op, dus die mag ruim,
     anders wordt de verversing op een trage verbinding afgekapt. */
const GRENS = 10000;
const GRENS_MET_TERUGVAL = 3000;
const GRENS_ACHTERGROND = 60000;

/* De eigen bestanden als pad: de cacheopslag is van de hele origin, en elke
   app staat in een eigen map (mv-systems-apps.github.io/<app>/), dus alleen
   de origin vergelijken is te grof. De zoekstring telt niet mee: de app kan
   met ?cfg=... worden geopend. */
function volledig(u){ return new URL(u, self.location.href); }
const EIGEN_PADEN = ASSETS.map(function(u){ return volledig(u).pathname; });

function isEigen(url){
  return url.origin === self.location.origin && EIGEN_PADEN.indexOf(url.pathname) >= 0;
}
/* De sleutel in de cache: het pad zonder zoekstring, zodat alle varianten van
   een bestand één regel delen. */
function sleutel(url){ return url.origin + url.pathname; }

/* Een geldig antwoord in plaats van undefined aan respondWith: anders toont de
   browser een netwerkfout zonder uitleg. */
function offlineAntwoord(navigatie){
  return new Response(
    navigatie
      ? '<!doctype html><html lang="nl"><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Events offline</title>' +
        '<body style="font:16px system-ui;margin:2rem;color:#222">' +
        '<h1 style="font-size:1.2rem">Events is offline</h1>' +
        '<p>Deze pagina staat nog niet in de offline-kopie. Open de app ' +
        'een keer met verbinding, daarna werkt hij ook zonder.</p>'
      : '',
    { status: 503, statusText: 'offline',
      headers: { 'Content-Type': navigatie ? 'text/html;charset=utf-8' : 'text/plain' } }
  );
}

/* Cachemisser en geen netwerk. Bij een paginaverzoek eerst de bewaarde app,
   zodat een opgeruimde of nog niet gevulde regel niet in een foutpagina eindigt. */
function terugval(cache, navigatie){
  if(!navigatie) return Promise.resolve(offlineAntwoord(false));
  return cache.match(sleutel(volledig('./events.html'))).then(
    function(app){ return app || offlineAntwoord(true); },
    function(){ return offlineAntwoord(true); }
  );
}

/* Het netwerk met een uiterste grens: een verbinding die blijft hangen, geeft
   nooit een antwoord en nooit een fout. Bij de grens wordt het verzoek echt
   afgebroken en niet alleen losgelaten; anders houdt het een verbinding bezet
   terwijl niemand meer op het antwoord wacht. Zonder AbortController (een
   nagemaakte omgeving) blijft het bij de grens zonder afbreken. */
function metGrens(req, ms, init){
  var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
  var opties = {};
  if(init) for(var k in init) opties[k] = init[k];
  if(ctl) opties.signal = ctl.signal;
  return new Promise(function(klaar, mis){
    var af = false;
    var klok = setTimeout(function(){
      if(af) return;
      af = true;
      if(ctl){ try { ctl.abort(); } catch(err){ /* niets aan te doen */ } }
      mis(new Error('netwerk duurde langer dan ' + ms + ' ms'));
    }, ms);
    fetch(req, opties).then(function(res){
      if(af) return;
      af = true; clearTimeout(klok); klaar(res);
    }, function(e){
      if(af) return;
      af = true; clearTimeout(klok); mis(e);
    });
  });
}

/* cache:'reload' zodat de installatie geen verouderde kopie uit de
   browsercache overneemt, en met de grens zodat een hangende verbinding de
   installatie niet eindeloos ophoudt. Een mislukking komt terug als null, zodat
   de aanroeper beslist of dat erg is. */
function haal(u){
  return metGrens(u, GRENS, { cache: 'reload' }).then(
    function(res){ return (res && res.ok) ? res : null; },
    function(){ return null; }
  );
}

/* De cache vullen in drie fasen, in deze volgorde, omdat de installatie
   rechtstreeks in de cache kan schrijven waaruit de oude worker nog bedient
   (als CACHE_VERSION niet omhoog is gegaan).

   1. De verplichte bestanden ophalen en nog niets wegschrijven. Ontbreekt er
      een, dan gooit dit en is er niets veranderd.
   2. De optionele bestanden, elk met zijn eigen vangnet.
   3. Het verplichte bestand als laatste.

   Mislukt er iets in fase 1 of 2, dan staat de vorige, werkende app nog in de
   cache. Dat geldt omdat er één verplicht bestand is en een put per
   cacheregel atomair is. Komt er een tweede verplicht bestand bij, dan kan die
   set half worden weggeschreven en is een tijdelijke cache met promoveren
   nodig. */
function vulCache(c){
  return Promise.all(VERPLICHT.map(function(u){
    return haal(u).then(function(res){ return { u: u, res: res }; });
  })).then(function(uit){
    var mist = uit.filter(function(x){ return !x.res; }).map(function(x){ return x.u; });
    if(mist.length) throw new Error('verplichte bestanden ontbreken: ' + mist.join(', '));
    /* De rest mag mislukken, ook bij het wegschrijven (volle opslag): een icoon
       mag de installatie niet tegenhouden. Wat niet binnenkomt, komt uit de
       vorige eigen cache. */
    return Promise.all(OPTIONEEL.map(function(u){
      return haal(u).then(function(res){
        if(!res) return uitVorigeCache(c, u);
        return c.put(sleutel(volledig(u)), res).catch(function(){ return null; });
      });
    })).then(function(){ return uit; });
  }).then(function(uit){
    return Promise.all(uit.map(function(x){ return c.put(sleutel(volledig(x.u)), x.res); }));
  });
}

/* Een optioneel bestand dat niet binnenkwam, overnemen uit de nieuwste vorige
   eigen cache, zodat het niet ontbreekt tot de achtergrondverversing het
   aanvult. Alleen eigen caches, op nummer gesorteerd (events-v10 is nieuwer
   dan events-v9): caches.match() zou ook in die van Golf Score en Trends
   zoeken. Lukt het niet, dan is er niets verloren. */
function uitVorigeCache(c, u){
  var adres = sleutel(volledig(u));
  return caches.keys().then(function(namen){
    var vorige = namen.filter(function(n){ return n.indexOf('events-v') === 0 && n !== CACHE_NAME; })
      .sort(function(a, b){ return parseInt(b.slice(8), 10) - parseInt(a.slice(8), 10); });
    var i = 0;
    function volgende(){
      if(i >= vorige.length) return null;
      return caches.open(vorige[i++]).then(function(oud){ return oud.match(adres); })
        .then(function(res){ return res ? c.put(adres, res) : volgende(); });
    }
    return volgende();
  }).catch(function(){ return null; });
}

self.addEventListener('install', function(e){
  e.waitUntil(
    /* Bestond deze cache al, dan is CACHE_VERSION niet verhoogd en bedient de
       draaiende worker er nog uit: een mislukte installatie wist hem dan niet,
       anders sloopt een netwerkfout de offline-app. Een cache die hier zelf is
       aangemaakt, wordt bij een mislukking wel opgeruimd: caches.open maakt hem
       aan voordat er iets in staat, en zo'n lege huls gaat anders (ook in
       App-status) door voor een geslaagde installatie. */
    caches.keys().then(function(namen){
      return namen.indexOf(CACHE_NAME) >= 0;
    }, function(){
      /* de cachelijst is niet te bevragen: dan het zekere voor het onzekere
         nemen en niets wissen */
      return true;
    }).then(function(bestond){
      return caches.open(CACHE_NAME).then(vulCache).catch(function(err){
        if(bestond) throw err;
        return caches.delete(CACHE_NAME).then(function(){ throw err; },
                                              function(){ throw err; });
      });
    })
    /* Geen skipWaiting: een nieuwe versie neemt een open app niet onder handen
       terwijl er misschien iets niet is opgeslagen. De app meldt de wachtende
       versie en vraagt er zelf om zodra alles is opgeslagen; zie de
       message-handler. */
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.map(function(k){
          /* Alle apps op deze origin delen dezelfde cacheopslag: alleen eigen
             oude caches opruimen. Pas bij activeren, zodat de vorige cache
             blijft staan tot de nieuwe versie het werkelijk overneemt. */
          return (k.indexOf('events-v') !== 0 || k === CACHE_NAME) ? null : caches.delete(k);
        }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

/* De gebruiker klikte op Herladen en er staat niets meer open: pas dan mag een
   wachtende worker het overnemen. */
self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'nuOverstappen') self.skipWaiting();
});

/* Zeggen dat er een verse kopie van de pagina in de cache staat. De app kijkt
   ook zelf, maar dan is de verversing op een trage verbinding vaak nog
   onderweg; zonder dit bericht komt de melding pas bij het wegschakelen en
   terughalen van de app. */
function meldVerversing(){
  if(!self.clients || typeof self.clients.matchAll !== 'function') return;
  self.clients.matchAll({ type:'window' }).then(function(lijst){
    lijst.forEach(function(c){
      try { c.postMessage({ type:'kopieVernieuwd' }); } catch(err){ /* weg is weg */ }
    });
  }).catch(function(){ /* niets aan te doen */ });
}

/* Stale-while-revalidate: meteen uit de cache bedienen en op de achtergrond
   verversen. */
self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  var url;
  try { url = new URL(e.request.url); } catch(err){ return; }
  /* niet van deze app: laten gaan alsof er geen service worker is */
  if(!isEigen(url)) return;
  var navigatie = e.request.mode === 'navigate';

  /* Een verzoek dat uitdrukkelijk vers wil: altijd het netwerk, nooit de cache,
     niets bewaren. Wel met een grens, en zonder netwerk een foutcode in plaats
     van de oude kopie -- anders meldt App-status 'gevonden' voor een bestand
     dat het niet op de server heeft gezien. */
  if(!navigatie && (e.request.cache === 'reload' || e.request.cache === 'no-store')){
    e.respondWith(metGrens(e.request, GRENS).catch(function(){ return offlineAntwoord(false); }));
    return;
  }

  /* Eén kopie per pad: opzoeken en bewaren onder het pad zonder zoekstring. De
     Cache API neemt de zoekstring anders mee in de sleutel; dan mist
     events.html?cfg=werk.json de cache en faalt het offline, of komt er voor
     elke variant een kopie bij. */
  var bewaarSleutel = sleutel(url);
  var appSleutel = sleutel(volledig('./events.html'));

  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.match(bewaarSleutel).then(function(gecached){
        /* Welke grens geldt, hangt af van de rol van dit verzoek: bij een
           cachetreffer is het alleen de achtergrondverversing, bij een misser
           het antwoord zelf, en dan korter als er een bewaarde app is om op
           terug te vallen. */
        var grens = gecached ? Promise.resolve(GRENS_ACHTERGROND)
          : !navigatie ? Promise.resolve(GRENS)
          : cache.match(appSleutel).then(function(app){ return app ? GRENS_MET_TERUGVAL : GRENS; },
                                         function(){ return GRENS; });
        return grens.then(function(ms){
          /* Bij een cachetreffer op de pagina met no-cache: GitHub Pages laat
             een bestand 10 minuten bewaren, en een gewoon verzoek kan dan
             dezelfde oude bytes terugschrijven, waardoor de melding van een
             nieuwe versie vlak na een push uitblijft. Alleen de pagina: daar
             staat het stempel. */
          var init = (gecached && navigatie) ? { cache: 'no-cache' } : undefined;
          var bewaarKlaar = null;
          var netwerk = metGrens(bewaarSleutel, ms, init).then(function(res){
            if(res && res.status === 200 && res.type === 'basic'){
              /* Mislukt het wegschrijven (geen ruimte, geen toestemming), dan
                 blijft het antwoord staan. */
              bewaarKlaar = cache.put(bewaarSleutel, res.clone())
                /* alleen bij de pagina: daar staat het stempel */
                .then(function(){ if(navigatie) meldVerversing(); })
                .catch(function(){});
            }
            return res;
          }).catch(function(){ return gecached || terugval(cache, navigatie); });

          /* Dit moet vóór het antwoord staan: bij een cachetreffer lost
             respondWith meteen op, het event is dan afgehandeld en een latere
             waitUntil gooit InvalidStateError. Deze ene waitUntil omvat het
             ophalen en het wegschrijven, zodat de browser de worker niet stopt
             voordat de nieuwe kopie in de cache staat. */
          try { e.waitUntil(netwerk.then(function(){ return bewaarKlaar; })); }
          catch(err){ /* geen actief event meer: dan is er niets te verlengen */ }
          return gecached || netwerk;
        });
      });
    }).catch(function(){ return offlineAntwoord(navigatie); })
  );
});
