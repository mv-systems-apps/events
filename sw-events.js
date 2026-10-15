/* Service worker voor Events.

   Dezelfde opzet als sw-golf-score.js en sw-trends.js: de drie werken
   hetzelfde, alleen in de schrijfstijl van hun eigen app. Wat ze gemeen
   hebben staat in apps-basis/conventies.md, paragraaf 3; wijzig je hier iets
   wezenlijks, doe het dan ook daar en in de andere twee.
   Strategie: stale-while-revalidate.

   - Staat een bestand in de cache, dan komt het daaruit en wacht niemand op het
     netwerk. Starten is daarmee onafhankelijk van de snelheid en de
     beschikbaarheid van de verbinding.
   - Daarnaast loopt een verzoek naar het netwerk, zodat de cache zich ververst
     en events.html bij een volgende start de nieuwe versie kan melden. De
     worker oordeelt dus niet zelf over versies; dat doet checkAppUpdate in de
     app, aan de hand van APP_VERSIE in de bewaarde kopie.
   - Staat het bestand er niet in en is er geen netwerk, dan volgt bij een
     paginaverzoek de bewaarde app, en anders een nette offlinepagina. Er komt
     nooit undefined uit respondWith.
   - Alles wat niet van deze app is: niet aankomen. Elke app staat in een eigen
     map op deze origin (mv-systems-apps.github.io/<app>/), dus het bereik van
     deze worker is die map. De cacheopslag is wel van de hele origin, en een
     controle op alleen de origin is daarom te grof: er wordt op pad vergeleken.
   - Een verzoek dat uitdrukkelijk vers wil (cache 'reload' of 'no-store'), gaat
     altijd naar het netwerk en wordt niet bewaard. App-status vraagt zo op wat
     er op de server staat.

   De installatie slaagt alleen als events.html binnen is. De rest mag mislukken;
   wat ontbreekt wordt overgenomen uit de vorige eigen cache, en anders later
   door de achtergrondverversing aangevuld.

   Over de twee tellers: CACHE_VERSION hieronder is de naam van de cache en
   hoeft alleen omhoog als dit bestand zelf wijzigt -- doe je dat niet, dan vult
   de nieuwe worker tijdens zijn installatie dezelfde cache waaruit de oude nog
   bedient, en staan er twee deploys in een cache. Voor een wijziging aan
   events.html is verhogen niet nodig: de cache ververst zichzelf. Het forceert
   dan alleen een directe verversing in plaats van uiterlijk een bezoek later.
   Het stempel waaraan de app een nieuwe versie herkent is APP_VERSIE in
   events.html; dat is een eigen teller. Zie update_cache_version.py. */

const CACHE_VERSION = 161;
const CACHE_NAME = 'events-v' + CACHE_VERSION;

/* Dit ene bestand is de app. Zonder dit is er niets om offline te openen, dus
   dit moet slagen. */
const VERPLICHT = [
  './events.html'
];
/* De rest is gemak: './' en index.html sturen alleen door naar events.html, en
   manifest en icoon zijn voor het installeren als app. Ze worden geprobeerd en
   mogen mislukken -- niet elke server beantwoordt een kale map, en dan zou die
   ene de hele installatie blokkeren. Wat ontbreekt wordt later alsnog
   aangevuld zodra het er wel is. */
const OPTIONEEL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];
const ASSETS = VERPLICHT.concat(OPTIONEEL);

/* Drie uiterste wachttijden, want hetzelfde netwerkverzoek heeft meer rollen.
   GRENS geldt als de cache een gat heeft: dan is dit verzoek het antwoord en
   staat de pagina erop te wachten, dus mag het niet lang duren. Ook de
   installatie haalt met deze grens op: een installatie die blijft hangen loopt
   nooit af, en zolang dat zo is doet registration.update() niets.
   GRENS_MET_TERUGVAL geldt als een paginaverzoek de cache mist terwijl de app
   er wel staat: lang wachten koopt dan niets, liever na 3 s de bewaarde app.
   GRENS_ACHTERGROND geldt bij een cachetreffer: het antwoord is dan al gegeven
   en dit verzoek ververst alleen de kopie. Daar wacht niemand op, dus die mag
   ruimer -- met de krappe grens werd op een trage verbinding de verversing
   afgekapt en bleef de app op de oude versie, zonder dat dat iemand hielp.
   Beide breken het verzoek werkelijk af; zie metGrens. */
const GRENS = 10000;
const GRENS_MET_TERUGVAL = 3000;
const GRENS_ACHTERGROND = 60000;

/* De eigen bestanden als pad, want alleen daarop wordt vergeleken. De
   zoekstring hoort er niet bij, voor geen enkel eigen bestand: de app kan met
   ?cfg=... worden geopend, en anders gold events.html?cfg=werk.json als een
   ander bestand dat nooit uit de cache kwam. Elk pad heeft één kopie. */
function volledig(u){ return new URL(u, self.location.href); }
const EIGEN_PADEN = ASSETS.map(function(u){ return volledig(u).pathname; });

function isEigen(url){
  return url.origin === self.location.origin && EIGEN_PADEN.indexOf(url.pathname) >= 0;
}
/* Het pad is de sleutel in de cache, zonder zoekstring: alle varianten van
   een bestand delen daardoor een regel. */
function sleutel(url){ return url.origin + url.pathname; }

/* Een net antwoord in plaats van undefined aan respondWith: dat laatste gaf de
   pagina een netwerkfout zonder uitleg. */
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

/* Het netwerk met een uiterste grens. Zonder die grens bleef een verbinding die
   blijft hangen het tabblad vasthouden tot de browser zelf opgaf.
   Het verzoek wordt ook werkelijk afgebroken en niet alleen losgelaten: een
   losgelaten fetch blijft lopen en houdt een verbinding bezet tot de browser er
   zelf een eind aan maakt, terwijl er niemand meer op het antwoord wacht.
   AbortController hoort bij elke browser die service workers heeft, maar de
   controle erop kost niets en houdt de worker ook in een nagemaakte omgeving
   zonder die klasse werkend. */
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

/* cache:'reload' zodat de installatie niet een oude kopie uit de browsercache
   overneemt, en met de grens zodat een hangende verbinding de installatie niet
   eindeloos ophoudt. Een mislukking komt terug als null, zodat de aanroeper
   beslist of dat erg is. */
function haal(u){
  return metGrens(u, GRENS, { cache: 'reload' }).then(
    function(res){ return (res && res.ok) ? res : null; },
    function(){ return null; }
  );
}

/* De cache vullen met de huidige deploy, in drie fasen en in deze volgorde,
   omdat de installatie rechtstreeks in de levende cache schrijft: bij een
   wijziging aan alleen events.html hoeft CACHE_VERSION niet omhoog, en dan is
   dit dezelfde cache waaruit de oude worker nog bedient.

   1. Alle verplichte bestanden ophalen en nog niets wegschrijven. Ontbreekt er
      een, dan gooit dit en is er niets veranderd.
   2. De optionele bestanden, elk met zijn eigen vangnet.
   3. Het verplichte bestand als laatste.

   Die laatste volgorde is het hele punt: mislukt er iets in fase 1 of 2, dan
   staat de vorige, werkende app nog in de cache. En events.html IS de
   applicatie -- het is een app van één bestand.

   De grens van die garantie, expliciet: per cacheregel is een put atomair, dus
   met dit ene verplichte bestand is de app oud of nieuw en nooit halverwege.
   Komt er ooit een tweede verplicht bestand bij, dan kan die set wél half
   worden weggeschreven; dan is een tijdelijke cache met promoveren nodig en
   klopt deze opzet niet meer. */
function vulCache(c){
  return Promise.all(VERPLICHT.map(function(u){
    return haal(u).then(function(res){ return { u: u, res: res }; });
  })).then(function(uit){
    var mist = uit.filter(function(x){ return !x.res; }).map(function(x){ return x.u; });
    if(mist.length) throw new Error('verplichte bestanden ontbreken: ' + mist.join(', '));
    /* De rest mag mislukken -- dat was altijd de bedoeling, maar gold alleen
       voor een mislukte download. Een geweigerde schrijfactie (volle opslag)
       sleepte de hele installatie mee, zodat die kon mislukken om een icoon
       terwijl de app zelf al binnen was. Nu heeft elk optioneel bestand zijn
       eigen vangnet: wat niet lukt blijft staan zoals het was en wordt later
       door de achtergrondverversing aangevuld. */
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
    /* Eerst nagaan of deze cache er al was. Dat is niet theoretisch: voor een
       wijziging aan alleen events.html hoeft CACHE_VERSION niet omhoog, en dan
       installeert de nieuwe worker in precies de cache waaruit de draaiende
       worker nog bedient. Die mag een mislukte installatie nooit wissen -- dan
       sloopt een netwerkfout de offline-app.
       Een cache die hier zelf is aangemaakt wordt bij een mislukking wel
       opgeruimd: caches.open maakt hem aan voordat er iets in staat, en zo'n
       lege huls zou anders in App-status voor een geslaagde installatie
       doorgaan. */
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
       terwijl er misschien iets niet is opgeslagen. De app ziet dat er een
       nieuwe versie wacht, meldt dat, en vraagt er zelf om zodra alles is
       opgeslagen -- zie de message-handler hieronder. */
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.map(function(k){
          /* Alle apps op deze origin delen dezelfde cacheopslag, dus hier
             alleen de oude caches van Events opruimen en die van de andere
             apps met rust laten. Dit gebeurt pas bij activeren, dus de vorige
             cache blijft staan tot de nieuwe versie het werkelijk overneemt. */
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

/* Zeggen dat er een nieuwe kopie van de pagina staat. De pagina kijkt daar bij
   het laden zelf naar, maar op dat moment is deze verversing nog onderweg:
   gemeten in Chromium stond de nieuwe kopie er bij 800 ms netwerkvertraging pas
   na 1,0 s en bij 2500 ms pas na 3,6 s. Zonder dit bericht zag je de melding
   over een nieuwe versie dus pas als je de app wegschakelde en terughaalde.
   Hier wordt het exacte moment doorgegeven, zodat er niets te gokken valt. */
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

  /* Eén kopie per pad: opzoeken en bewaren gebeurt onder het pad zonder
     zoekstring. De Cache API neemt de zoekstring anders mee in de sleutel, en
     dan mist events.html?cfg=werk.json de cache en faalt het offline, of komt
     er voor elke variant een kopie bij. */
  var bewaarSleutel = sleutel(url);
  var appSleutel = sleutel(volledig('./events.html'));

  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.match(bewaarSleutel).then(function(gecached){
        /* Welke grens geldt, hangt af van de rol van dit verzoek: bij een
           cachetreffer is het alleen een verversing waar niemand op wacht, bij
           een misser is het het antwoord zelf -- en dan korter als er een
           bewaarde app is om op terug te vallen. */
        var grens = gecached ? Promise.resolve(GRENS_ACHTERGROND)
          : !navigatie ? Promise.resolve(GRENS)
          : cache.match(appSleutel).then(function(app){ return app ? GRENS_MET_TERUGVAL : GRENS; },
                                         function(){ return GRENS; });
        return grens.then(function(ms){
          /* Bij een treffer op de pagina zelf met no-cache: GitHub Pages laat een
             bestand 10 minuten bewaren, en een gewoon verzoek kon dan dezelfde
             oude bytes terugschrijven. Dan bleef de melding over een nieuwe
             versie vlak na een push uit. Alleen de pagina: daar staat het stempel. */
          var init = (gecached && navigatie) ? { cache: 'no-cache' } : undefined;
          var bewaarKlaar = null;
          var netwerk = metGrens(bewaarSleutel, ms, init).then(function(res){
            if(res && res.status === 200 && res.type === 'basic'){
              /* Mislukt het wegschrijven (geen ruimte, geen toestemming), dan
                 blijft het antwoord staan. */
              bewaarKlaar = cache.put(bewaarSleutel, res.clone())
                /* alleen bij de pagina zelf: daar staat het versienummer in, en
                   alleen daarover valt iets te melden */
                .then(function(){ if(navigatie) meldVerversing(); })
                .catch(function(){});
            }
            return res;
          }).catch(function(){ return gecached || terugval(cache, navigatie); });

          /* Dit moet VOOR het antwoord staan. Hier stond een waitUntil binnen de
             then hierboven, en die kwam bij een cachetreffer altijd te laat:
             respondWith is dan al opgelost met de bewaarde kopie, het event is niet
             meer actief, en de browser weigert waitUntil met InvalidStateError --
             gemeten in Chromium. Deze ene waitUntil omvat het ophalen en het
             wegschrijven. */
          try { e.waitUntil(netwerk.then(function(){ return bewaarKlaar; })); }
          catch(err){ /* geen actief event meer: dan is er niets te verlengen */ }
          return gecached || netwerk;
        });
      });
    }).catch(function(){ return offlineAntwoord(navigatie); })
  );
});
