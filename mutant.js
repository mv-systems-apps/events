/* Bijt events-tests.cjs? Per eigenschap de bron slopen en kijken welke controles
   rood worden. Een controle die nergens rood wordt, test niets. */
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
/* De werkmap van de app zelf (de clone), niet de gedeelde platte map: zie de
   toelichting in zt_run.js. De mutaties draaien toch al in een verse tijdelijke
   map, dus hier wordt alleen gelezen. */
const UIT = process.env.MAP ? path.resolve(process.env.MAP) : __dirname;
const SW = fs.readFileSync(UIT + '/sw-events.js', 'utf8');
const HTML = fs.readFileSync(UIT + '/events.html', 'utf8');
const PY = fs.readFileSync(UIT + '/update_cache_version.py', 'utf8');
const LITE = fs.readFileSync(UIT + '/events_lite.js', 'utf8');

/* Een mutatie moet landen in de functie die hij bedoelt. String.replace pakt in JS
   alleen de eerste treffer, en die zat bij '}).catch(function(){ return false; });'
   in een heel andere functie -- de mutatie sloopte toen iets anders dan de naam
   beloofde en de test leek niet te bijten. Daarom hier eerst de functie uitsnijden. */
const inFunctie = (bron, naam, f) => {
  const kop = new RegExp('^function ' + naam + '\\s*\\(', 'm').exec(bron);
  if (!kop) throw new Error('functie niet gevonden: ' + naam);
  const eind = bron.indexOf('\n}', kop.index) + 2;
  const stuk = bron.slice(kop.index, eind);
  const nieuw = f(stuk);
  if (nieuw === stuk) throw new Error('mutatie greep niet aan binnen ' + naam);
  return bron.slice(0, kop.index) + nieuw + bron.slice(eind);
};

const MUTANTEN = [
  ['zoekstring: opzoeken en bewaren onder de volle URL', 'sw', s => s.replace('var bewaarSleutel = sleutel(url);', 'var bewaarSleutel = e.request.url;')],
  ['netwerk-eerst in plaats van cache-eerst', 'sw', s => s.replace('return gecached || netwerk;', 'return netwerk.catch(function(){ return gecached; });')],
  ['achtergrondverversing eruit', 'sw', s => s.replace(/            bewaarKlaar = cache\.put\(bewaarSleutel, res\.clone\(\)\)[\s\S]*?\.catch\(function\(\)\{\}\);/, '            bewaarKlaar = Promise.resolve();')],
  ['opruimen pakt alle caches', 'sw', s => s.replace("(k.indexOf('events-v') !== 0 || k === CACHE_NAME)", '(k === CACHE_NAME)')],
  ['andere apps ook afhandelen', 'sw', s => s.replace('if(!isEigen(url)) return;', "if(url.origin !== self.location.origin) return;")],
  ['lege huls blijft na mislukte installatie', 'sw', s => s.replace('if(bestond) throw err;', 'throw err;')],
  ['mislukte installatie wist ook een bestaande cache', 'sw', s => s.replace('if(bestond) throw err;', '')],
  ['installatie kijkt niet of de cache al bestond', 'sw', s => s.replace('return namen.indexOf(CACHE_NAME) >= 0;', 'return false;')],
  ['geen afbreeksignaal mee met het verzoek', 'sw', s => s.replace('  if(ctl) opties.signal = ctl.signal;\n', '')],
  ['wel een signaal maar nooit afbreken', 'sw', s => s.replace('if(ctl){ try { ctl.abort(); } catch(err){ /* niets aan te doen */ } }', '')],
  ['een grens voor beide rollen', 'sw', s => s.replace('var grens = gecached ? Promise.resolve(GRENS_ACHTERGROND)', 'var grens = gecached ? Promise.resolve(GRENS)')],
  ['achtergrondgrens bestaat niet', 'sw', s => s.replace(/const GRENS_ACHTERGROND = \d+;/, 'const GRENS_TRAAG = 60000;').replace('GRENS_ACHTERGROND :', 'GRENS_TRAAG :')],
  ['achtergrondgrens niet ruimer', 'sw', s => s.replace(/const GRENS_ACHTERGROND = \d+;/, 'const GRENS_ACHTERGROND = 1000;')],
  ['optionele bestanden verplicht', 'sw', s => s.replace('        if(!res) return uitVorigeCache(c, u);', '        if(!res) throw new Error(u);')],
  ['halve deploy: per bestand wegschrijven', 'sw', s => s.replace(/var mist = uit\.filter[\s\S]*?join\(', '\)\);\n/, '')],
  ['terugval naar de app eruit', 'sw', s => s.replace(/return cache\.match\(sleutel\(volledig\('\.\/events\.html'\)\)\)\.then\([\s\S]*?\);\n\}/, 'return Promise.resolve(offlineAntwoord(true));\n}')],
  ['geen uiterste wachttijd', 'sw', s => s.replace('var netwerk = metGrens(bewaarSleutel, ms, init).then', 'var netwerk = fetch(bewaarSleutel, init).then')],
  ['undefined uit respondWith', 'sw', s => s.replace('.catch(function(){ return gecached || terugval(cache, navigatie); })', '')],
  ['skipWaiting bij installeren', 'sw', s => s.replace("self.addEventListener('install', function(e){", "self.addEventListener('install', function(e){\n  self.skipWaiting();")],
  ['offlinepagina als platte tekst', 'sw', s => s.replace("navigatie ? 'text/html;charset=utf-8' : 'text/plain'", "'text/plain'")],
  ['versiecontrole: groter-of-gelijk', 'html', s => inFunctie(s, 'checkAppUpdate', f => f.replace('!(uit.stempel > eigen)', '!(uit.stempel >= eigen)'))],
  ['versiecontrole zonder vangnet', 'html', s => s.replace(/(function checkAppUpdate\([\s\S]*?)\n\}/, (m) => m.replace(/\.catch\(function\([^)]*\)\{[^}]*\}\)/g, ''))],

  ['updatecontrole zonder rem', 'html', s => s.replace(/(function vraagSwUpdate\(reg\)\{\n)/, '$1  if(true){ try { (reg||{}).update(); } catch(e){} return true; }\n')],
  ['herladen zonder eenmaal-slot', 'html', s => s.replace(/(function magHerladenEenmaal\(\)\{\n)/, '$1  return true;\n')],
  ['overstap zonder bericht aan de worker', 'html', s => s.replace(/(function stapOverNaarNieuweVersie\(\)\{\n)/, '$1  herlaadEenmaal(); return;\n')],
  ['bewaren onder de volle URL met zoekstring', 'sw', s => s.replace('bewaarKlaar = cache.put(bewaarSleutel, res.clone())', 'bewaarKlaar = cache.put(e.request.url, res.clone())')],
  ['alleen de pagina negeert de zoekstring', 'sw', s => s.replace('return cache.match(bewaarSleutel).then', 'return cache.match(navigatie ? bewaarSleutel : e.request.url).then')],
  ['niets laten gaan: alles afhandelen', 'sw', s => s.replace('if(!isEigen(url)) return;', '')],
  ['ook POST afhandelen', 'sw', s => s.replace("if(e.request.method !== 'GET') return;", '')],
  ['buitenste vangnet eruit', 'sw', s => s.replace('}).catch(function(){ return offlineAntwoord(navigatie); })', '})')],
  ['icoon niet meer in de cache', 'sw', s => s.replace("  './icon.svg'\n", '')],
  ['opruimen bij activeren eruit', 'sw', s => s.replace(/return \(k\.indexOf\('events-v'\) !== 0 \|\| k === CACHE_NAME\) \? null : caches\.delete\(k\);/, 'return null;')],
  ['mislukte installatie wist alle eigen caches', 'sw', s => s.replace('return caches.delete(CACHE_NAME).then', "return caches.keys().then(function(ks){ return Promise.all(ks.filter(function(k){ return k.indexOf('events-v') === 0; }).map(function(k){ return caches.delete(k); })); }).then")],
  ['volle opslag stil wegslikken', 'sw', s => s
     .replace('return Promise.all(uit.map(function(x){ return c.put(sleutel(volledig(x.u)), x.res); }));', 'return Promise.all(uit.map(function(x){ return c.put(sleutel(volledig(x.u)), x.res).catch(function(){}); }));')
     .replace('if(res) return c.put(sleutel(volledig(u)), res);', 'if(res) return c.put(sleutel(volledig(u)), res).catch(function(){});')],
  ['wachttijd veel te kort', 'sw', s => s.replace('const GRENS = 10000;', 'const GRENS = 300;')],
  ['cachenaam zonder events-', 'sw', s => s.replace("const CACHE_NAME = 'events-v' + CACHE_VERSION;", "const CACHE_NAME = 'cache-v' + CACHE_VERSION;")],
  ['overstapbericht niet afgehandeld', 'sw', s => s.replace("if(e.data && e.data.type === 'nuOverstappen') self.skipWaiting();", 'return;')],
  ['versiecontrole meldt nooit iets', 'html', s => s.replace('if(!uit.stempel || !eigen || !(uit.stempel > eigen)) return false;', 'return false;')],
  ['versiecontrole vergelijkt op ongelijk', 'html', s => s.replace('if(!uit.stempel || !eigen || !(uit.stempel > eigen)) return false;', 'if(!uit.stempel || uit.stempel === eigen) return false;')],
  /* Zonder de guard op het eigen stempel is '' kleiner dan elke tekst, en meldt
     een pagina zonder stempel bij ELKE kopie een nieuwe versie. */
  ['versiecontrole zonder guard op het eigen stempel', 'html', s => s.replace('if(!uit.stempel || !eigen || !(uit.stempel > eigen)) return false;', 'if(!uit.stempel || !(uit.stempel > eigen)) return false;')],
  /* De guard op het stempel in de kopie, samen met het vangnet eromheen. Los
     van elkaar zijn die twee niet te betrappen: valt de guard weg, dan werpt
     m[1] op een kopie van voor de overstap en vangt de catch dat af tot
     'false' -- precies wat er zonder de fout ook uit zou komen. Pas zonder
     beide blijft er een afgewezen belofte over, en die is wel te zien. */
  /* Zonder de eis dat er werkelijk een stempel in de kopie staat: dan geldt de
     ruwe tekst als stempel. Die begint met 'var ...' en is in tekstvergelijking
     groter dan elk stempel, dus een kopie van voor de overstap meldt zich als
     nieuwer -- precies de melding die niemand moet krijgen. */
  ['een kopie zonder stempel telt als stempel', 'html',
   s => inFunctie(s, 'nieuwsteStempelUitCache', f => f.replace(
     'if(m && (nieuwste === null || m[1] > nieuwste)) nieuwste = m[1];',
     'var k = m ? m[1] : t; if(nieuwste === null || k > nieuwste) nieuwste = k;'))],

  ['versiecontrole zonder vangnet', 'html', s => inFunctie(s, 'checkAppUpdate', f => f.replace('.catch(function(){ return false; });', ';'))],
  /* Terug naar het oude gedrag: alleen de hoogst genummerde eigen cache lezen.
     Dat is precies waar conventies.md 'van alle treffers het nieuwste stempel'
     tegenover zet, en waar een lege huls of een stukke cache de melding liet
     vervallen. */
  ['alleen de hoogste cache lezen, zoals voorheen', 'html',
   s => inFunctie(s, 'nieuwsteStempelUitCache', f => f.replace(
     "var eigen = namen.filter(function(n){ return n.indexOf('events-') === 0; });",
     "var eigen = namen.filter(function(n){ return n.indexOf('events-') === 0; })\n      .sort(function(a, b){ return (parseInt(a.replace(/^events-v?/, ''), 10) || 0) - (parseInt(b.replace(/^events-v?/, ''), 10) || 0); }).slice(-1);"))],
  /* Niet het nieuwste maar het eerst gevonden stempel nemen. */
  ['het eerste stempel in plaats van het nieuwste', 'html',
   s => inFunctie(s, 'nieuwsteStempelUitCache', f => f.replace(
     'if(m && (nieuwste === null || m[1] > nieuwste)) nieuwste = m[1];',
     'if(m && nieuwste === null) nieuwste = m[1];'))],
  /* Of juist het laatst gevonden stempel, ongeacht of dat het nieuwste is. */
  ['het laatste stempel in plaats van het nieuwste', 'html',
   s => inFunctie(s, 'nieuwsteStempelUitCache', f => f.replace(
     'if(m && (nieuwste === null || m[1] > nieuwste)) nieuwste = m[1];',
     'if(m) nieuwste = m[1];'))],
  /* De guard op een missend bestand, samen met het vangnet per cache. Los van
     elkaar zijn ze niet te betrappen: valt de guard weg, dan werpt res.text()
     en vangt het vangnet dat af; valt het vangnet weg, dan werpt er niets
     omdat de guard er nog staat. Samen zijn ze wat een lege huls in een
     hogere cache onschadelijk maakt. */
  ['versiecontrole zonder guard op een missend bestand', 'html',
   s => inFunctie(s, 'nieuwsteStempelUitCache', f => f
     .replace('return res ? res.text() : null;', 'return res.text();')
     .replace(".catch(function(){ /* een stukke cache telt niet mee, de rest wel */ });", ';'))],
  /* Het vangnet per cache eruit: dan breekt een stukke cache de hele zoektocht
     af en vervalt de melding, ook als het nieuwe stempel ernaast staat. */
  ['een stukke cache breekt de hele zoektocht af', 'html',
   s => inFunctie(s, 'nieuwsteStempelUitCache', f => f.replace(
     ".catch(function(){ /* een stukke cache telt niet mee, de rest wel */ });", ';'))],
  ['updatecontrole-interval naar vijf minuten', 'html', s => s.replace('var SW_UPDATE_INTERVAL = 30 * 60 * 1000', 'var SW_UPDATE_INTERVAL = 5 * 60 * 1000')],
  ['updatecontrole zonder vangnet op update()', 'html', s => s.replace(/(function vraagSwUpdate\(reg\)\{\n)/, '$1  r = reg; if(!r || !r.update) return false; swUpdateLaatst = Date.now(); r.update(); return true;\n')],
  ['overstap zonder slot op niet-opgeslagen werk', 'html', s => s.replace('  if(!magHerladen()) return;\n', '')],
  ['het versiestempel weg uit het scherm', 'html', s => s.replace(/<div id="appVersieStempel">[^<]*<\/div>/, '')],
  /* Het volgnummer korter dan drie cijfers: dan zet tekstvergelijking -002
     boven -010 en loopt de meldingsvolgorde door de war. */
  ['volgnummer zonder vaste lengte', 'html', s => s.replace(/(<div id="appVersieStempel">Versie [0-9A-F]{7}-)0*([0-9A-F]+)(<\/div>)/, '$1$2$3')],
  /* Het stempel niet uit het scherm maar uit een vaste tekst: dan kan het in
     het scherm iets anders gaan zeggen dan de app vergelijkt. */
  ['het stempel staat vast in de code', 'html', s => inFunctie(s, 'appStempel', f => f.replace('return m ? m[1] : \'\';', 'return \'0000000-000\';'))],
  ['installatie slaat niets op', 'sw', s => s.replace('caches.open(CACHE_NAME).then(vulCache).catch', 'caches.open(CACHE_NAME).then(function(){}).catch')],
  ['verplicht bestand dat niet bestaat', 'sw', s => s.replace("  './events.html'\n", "  './events.html',\n  './bestaat-niet.js'\n")],
  ['geen netwerk naast de cache', 'sw', s => s.replace('var netwerk = metGrens(bewaarSleutel, ms, init).then', 'var netwerk = Promise.resolve(gecached).then')],
  ['ook vreemde antwoorden bewaren', 'sw', s => s.replace('if(!isEigen(url)) return;', '').replace("res.type === 'basic'", 'true')],
  ['wachttijd helemaal weg uit de bron', 'sw', s => s.replace(/const GRENS = \d+;/, '')],
  ['CACHE_VERSION niet als getal', 'sw', s => s.replace(/const CACHE_VERSION = (\d+);/, "const CACHE_VERSION = '$1';")],
  ['update_cache_version.py kent de cacheteller niet', 'py', s => s.replace(/CACHE_VERSION/g, 'IETS_ANDERS')],
  /* Het script weer aan het stempel laten zitten. De conventies schrijven voor
     dat dat met de hand gaat; dit moet dus rood worden. */
  ['update_cache_version.py verhoogt het stempel toch', 'py',
   s => s.replace('WORKER = (', 'APP = (HIER / "events.html", re.compile(r"(APP_VERSIE\\s*=\\s*)(\\d+)"), "APP_VERSIE")\nWORKER = (')],
  ['versiecontrole zonder guards en zonder vangnet', 'html', s => inFunctie(
     inFunctie(s, 'checkAppUpdate', f => f.replace('.catch(function(){ return false; });', ';')),
     'nieuwsteStempelUitCache', f => f
       .replace("if(!eigen.length) return { stempel: null, reden: 'geen eigen cache' };\n", '')
       .replace('return vak ? vak.match(sleutel, { ignoreSearch: true }) : null;', 'return vak.match(sleutel, { ignoreSearch: true });')
       .replace('return res ? res.text() : null;', 'return res.text();'))],
  ['versiecontrole zonder guard op een lege cachelijst', 'html', s => inFunctie(
     inFunctie(s, 'checkAppUpdate', f => f.replace('.catch(function(){ return false; });', ';')),
     'nieuwsteStempelUitCache', f => f
       .replace("if(!eigen.length) return { stempel: null, reden: 'geen eigen cache' };\n", ''))],
  ['updatecontrole vraagt nooit iets', 'html', s => s.replace(/(function vraagSwUpdate\(reg\)\{\n)/, '$1  return false;\n')],
  ['overstap herlaadt meteen ook', 'html', s => s.replace("nieuweVersie.postMessage({ type:'nuOverstappen' });", "nieuweVersie.postMessage({ type:'nuOverstappen' }); location.reload();")],
  ['verplicht bestand weer als eerste schrijven', 'sw', s => s
     .replace("    return Promise.all(OPTIONEEL.map(function(u){",
              "    return Promise.all(uit.map(function(x){ return c.put(sleutel(volledig(x.u)), x.res); })).then(function(){\n    return Promise.all(OPTIONEEL.map(function(u){")
     .replace("    })).then(function(){ return uit; });",
              "    })); }).then(function(){ return uit; });")
     .replace("    return Promise.all(uit.map(function(x){ return c.put(sleutel(volledig(x.u)), x.res); }));\n  });",
              "    return uit;\n  });")],
  ['optionele schrijffout weer fataal', 'sw', s => s.replace("return c.put(sleutel(volledig(u)), res).catch(function(){ return null; });", "return c.put(sleutel(volledig(u)), res);")],
  ['categorie weer stil naar 2', 'html', s => s
     .replace('    var catGetal = /^\\d+$/.test(catRuw);', '    var catGetal = /^[1-9]\\d*$/.test(catRuw);')],
  ['serialize met eigen opmaak naast regelVan', 'html', s => s
     .replace('  var regels = (lijst || records).map(regelVan);', "  var regels = (lijst || records).map(function(r){ return r.raw !== undefined ? r.raw : [r.sleutel, r.naam, r.type, r.code].join(sep()); });")],
  ['poort op openModal eruit', 'html', s => inFunctie(s, 'openModal', f => f.replace('  if(!magBewerken()) return;\n', ''))],
  ['btnEdit weer zonder disabled', 'html', s => s.replace("  $('btnEdit').disabled = !magBewerken();\n", '')],
  ['bewerken op de kopie ook zonder kopie', 'html', s => s.replace("function kanToegangVragen(){ return fileState === 'auth' && !!dirHandle && !!kopieRij && !!bestandsnaam; }", "function kanToegangVragen(){ return fileState === 'auth' && !!dirHandle; }")],
  ['opstarten zonder toegang neemt weer elke kopie', 'html', s => s.replace("        return vulUitKopie(true).then(render, render);", "        return vulUitKopie().then(render, render);")],
  ['kopie zonder stempel telt weer mee', 'html', s => s.replace("    if(metStempel && typeof rij.mtime !== 'number') return false;\n", '')],
  ['geen toegangsvraag zonder kopie', 'html', s => s.replace("    el.innerHTML = (toegangGeweigerd || !kopieRij", "    el.innerHTML = (toegangGeweigerd")],
  ['zonder werkmap weer elke kopie', 'html', s => s.replace("  return vulUitKopie(true).then(function(gelukt){", "  return vulUitKopie().then(function(gelukt){")],
  ['geen gisteren', 'html', s => s.replace("  if(dag(d) === gisteren) return 'gisteren ' + tijd;\n", '')],
  ['gisteren als 24 uur terug', 'html', s => s.replace("  var gisteren = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime();", "  var gisteren = dag(n) - 86400000;")],
  ['kopie in beeld niet bijgewerkt na bewaren', 'html', s => s.replace("    .then(function(){ kopieRij = rij; kopieFout = ''; tekenBestandStatus(); },", "    .then(function(){ kopieFout = ''; tekenBestandStatus(); },")],
  ['Annuleren in de configuratie weer zonder vraag', 'html', s => s.replace("$('cfgCancel').onclick = function(){ sluitBovenste(false); };", "$('cfgCancel').onclick = function(){ bergModaal('cfgModal'); };")],
  ['stapbalk weer als platte tekst', 'html', s => s.replace("if($('stapTekst').innerHTML !== stapHtml) $('stapTekst').innerHTML = stapHtml;", "$('stapTekst').textContent = terugTekst();")],
  ['App-status schrijft weer naar een verdwenen element', 'html', s => s.replace("  var zet = function(html){ if(document.contains(el)) el.innerHTML = html; };", "  var zet = function(html){ $('stKopie').innerHTML = html; };")],
    ['verlenging weer na het antwoord', 'sw', s => s
     .replace("          try { e.waitUntil(netwerk.then(function(){ return bewaarKlaar; })); }\n          catch(err){ /* geen actief event meer: dan is er niets te verlengen */ }\n", '')],
  /* Gelijkgetrokken met Golf Score en Trends (groep 17). */
  ['installatie zonder grens', 'sw', s => inFunctie(s, 'haal', f => f.replace("return metGrens(u, GRENS, { cache: 'reload' }).then(", "return fetch(u, { cache: 'reload' }).then("))],
  ['verversing zonder no-cache', 'sw', s => s.replace("var init = (gecached && navigatie) ? { cache: 'no-cache' } : undefined;", 'var init = undefined;')],
  ['no-cache ook op bijbestanden', 'sw', s => s.replace("var init = (gecached && navigatie) ? { cache: 'no-cache' } : undefined;", "var init = gecached ? { cache: 'no-cache' } : undefined;")],
  ['geen korte grens met een bewaarde app', 'sw', s => s.replace('return app ? GRENS_MET_TERUGVAL : GRENS;', 'return GRENS;')],
  ['niets overnemen uit de vorige cache', 'sw', s => s.replace('        if(!res) return uitVorigeCache(c, u);', '        if(!res) return null;')],
  ['vorige caches op tekst gesorteerd', 'sw', s => inFunctie(s, 'uitVorigeCache', f => f.replace(".sort(function(a, b){ return parseInt(b.slice(8), 10) - parseInt(a.slice(8), 10); });", '.sort().reverse();'))],
  ['ook overnemen uit de cache van een buurapp', 'sw', s => inFunctie(s, 'uitVorigeCache', f => f.replace("n.indexOf('events-v') === 0 && n !== CACHE_NAME", 'n !== CACHE_NAME'))],
  ['no-store gewoon uit de cache', 'sw', s => s.replace("if(!navigatie && (e.request.cache === 'reload' || e.request.cache === 'no-store')){", 'if(false){')],
  /* De balk met de laatste stap (groep 18). */
  ['bevestigen laat de stap staan', 'html', s => s.replace("$('btnStapOk').onclick = function(){ terug = null; stapMelding = ''; render(); };", "$('btnStapOk').onclick = function(){ render(); };")],
  ['de balk staat er ook zonder stap', 'html', s => s.replace("$('stapbalk').hidden = !terug || !!stapMelding;", "$('stapbalk').hidden = false;")],
  ['reload niet langs de cache', 'sw', s => s.replace("(e.request.cache === 'reload' || e.request.cache === 'no-store')", "(e.request.cache === 'no-store')")],
  ['magHerladen altijd waar', 'html', s => inFunctie(s, 'magHerladen', f => f.replace('return !schrijfBezig;', 'return true;'))],
  /* Opslaan: eerst het bestand, dan de tabel (groep 12). */
      /* na de review (1352898-024) */
      /* tweede review (1352898-025) */
    ['scheidingsteken-vlaggen bij elke opslag gewist', 'html', s => inFunctie(s, 'opslaanWijziging', f => f.replace("if(w.soort === 'alles'){ zetSepOnafgemaakt(''); sepMist = ''; }", "sepOnafgemaakt = ''; sepMist = '';"))],
  ['bewerken terwijl het scheidingsteken niet klopt', 'html', s => s.replace(' && !sepOnafgemaakt && !sepMist && !alleOnbegrepen() && !nietUtf8; }', ' && !alleOnbegrepen() && !nietUtf8; }')],
  ['configuratie geschreven zonder het bestand na te kijken', 'html', s => inFunctie(s, 'bewaarCfg', f => f.replace('voorcontrole.then(function(){ return schrijfCfg(cfgForceer, nieuw); })', 'schrijfCfg(cfgForceer, nieuw)'))],
        ['venster gaat dicht tijdens het opslaan', 'html', s => inFunctie(s, 'sluitBovenste', f => f.replace("if(vensterBezig && (id === 'modal'", "if(false && (id === 'modal'"))],
    ['ongedaan maken vergeet de stap na de toegangsvraag', 'html', s => inFunctie(s, 'voerStapUit', f => f.replace('    terug = stap;\n    if(res.fout', '    if(res.fout'))],
  ['opslaan zonder toegang te vragen', 'html', s => inFunctie(s, 'zorgVoorToegang', f => f.replace("  if(fileState !== 'auth') return Promise.resolve();", '  return Promise.resolve();'))],
  ['opslaan leest het bestand niet opnieuw', 'html', s => inFunctie(s, 'opslaanWijziging', f => f.replace('return leesVoorSchrijven(w.leesSep);', "return { lijst: records.slice(), tekst: '', stempel: null };"))],
  ['een tweede opslag tegelijk gaat er toch door', 'html', s => inFunctie(s, 'opslaanWijziging', f => f.replace("  if(schrijfBezig) return Promise.resolve({ fout:'bezig' });\n", ''))],
  ['versiecontrole op een verkeerde sleutel', 'html', s => inFunctie(s, 'nieuwsteStempelUitCache', f => f.replace("new URL('events.html', location.href).href", "new URL('bestaat-niet.html', location.href).href"))],
  ['versiecontrole zonder ignoreSearch', 'html', s => inFunctie(s, 'nieuwsteStempelUitCache', f => f.replace(", { ignoreSearch: true })", ")"))],
  ['versiecontrole filtert de buren niet weg', 'html', s => inFunctie(s, 'nieuwsteStempelUitCache', f => f.replace("var eigen = namen.filter(function(n){ return n.indexOf('events-') === 0; });", 'var eigen = namen.slice();'))],
  /* De terugval op alle caches die conventies.md nog voorschrijft, maar die
     trends er juist uit heeft gehaald: dan beslist een kopie van een buurapp
     mee over de melding. */
  ['terugval op alle caches erbij', 'html', s => inFunctie(s, 'nieuwsteStempelUitCache', f => f.replace(
     "if(!eigen.length) return { stempel: null, reden: 'geen eigen cache' };",
     'if(!eigen.length) eigen = namen.slice();'))],
  ['elk antwoord mag de cache in', 'sw', s => s.replace("if(res && res.status === 200 && res.type === 'basic'){", 'if(res){')],
  ['status niet gecontroleerd', 'sw', s => s.replace("if(res && res.status === 200 && res.type === 'basic'){", "if(res && res.type === 'basic'){")],
  ['type niet gecontroleerd', 'sw', s => s.replace("if(res && res.status === 200 && res.type === 'basic'){", 'if(res && res.status === 200){')],
  ['isEigen kijkt alleen naar het pad', 'sw', s => inFunctie(s, 'isEigen', f => f.replace('return url.origin === self.location.origin && EIGEN_PADEN.indexOf(url.pathname) >= 0;', 'return EIGEN_PADEN.indexOf(url.pathname) >= 0;'))],
  ['bij een onbevraagbare cachelijst wel wissen', 'sw', s => s.replace("      /* de cachelijst is niet te bevragen: dan het zekere voor het onzekere\n         nemen en niets wissen */\n      return true;", '      return false;')],
];

const groen = s => [...s.matchAll(/^  OK   (.+?)(?:  —.*)?$/gm)].map(m => m[1]);
const rood  = s => [...s.matchAll(/^  FOUT (.+?)(?:  —.*)?$/gm)].map(m => m[1]);

const draai = (sw, html, py, lite) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-'));
  fs.writeFileSync(d + '/sw-events.js', sw);
  fs.writeFileSync(d + '/events.html', html);
  if (py === undefined) fs.copyFileSync(UIT + '/update_cache_version.py', d + '/update_cache_version.py');
  else fs.writeFileSync(d + '/update_cache_version.py', py);
  fs.writeFileSync(d + '/events_lite.js', lite === undefined ? LITE : lite);
  fs.copyFileSync(UIT + '/events-tests.cjs', d + '/events-tests.cjs');
  let uit;
  try { uit = cp.execSync('node events-tests.cjs 2>&1', { cwd: d, timeout: 60000 }).toString(); }
  catch (e) { uit = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : ''); }
  fs.rmSync(d, { recursive: true, force: true });
  return uit;
};

const basis = draai(SW, HTML);
const alle = groen(basis);
console.log('ongewijzigd: ' + alle.length + ' geslaagd, ' + rood(basis).length + ' mislukt\n');

/* Het vangnet rond een SYNCHRONE uitzondering bij het opslaan: anders bleef het
   slot hangen en werd er tot herladen niet meer opgeslagen. */
MUTANTEN.push(['opslaan zonder vangnet om de toegangsvraag', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f
    .replace('  try { uit = zorgVoorToegang(); } catch(e){ uit = Promise.reject(e); }', '  uit = zorgVoorToegang();'))]);

/* De configuratie en het scheidingsteken: groep 14. */
MUTANTEN.push(['cfg schrijven zonder botsingscontrole', 'html',
  s => inFunctie(s, 'schrijfCfg', f => f
    .replace("    if(stand !== 'gelijk' && !forceer){ CFGBOTSING.onbekend = (stand === 'onbekend'); throw CFGBOTSING; }\n", ''))]);
MUTANTEN.push(['cfg: geen extra backup bij een wijziging van buiten', 'html',
  s => inFunctie(s, 'schrijfCfg', f => f
    .replace('maybeBackup(CFG_NAAM, !!forceer)', 'maybeBackup(CFG_NAAM)'))]);
MUTANTEN.push(['cfg: de basis wordt niet bijgewerkt', 'html',
  s => inFunctie(s, 'schrijfCfg', f => f
    .replace('cfgGelezen = f.lastModified; cfgGrootte = f.size;', ''))]);
MUTANTEN.push(['cfg: alleen de tijd vergelijken, niet de grootte', 'html',
  s => inFunctie(s, 'cfgGewijzigd', f => f
    .replace('if(cfgGrootte !== null && f.size !== cfgGrootte) return \'anders\';', ''))]);
MUTANTEN.push(['cfg: een mislukte controle heet ongewijzigd', 'html',
  s => inFunctie(s, 'cfgGewijzigd', f => f
    .replace("      return 'onbekend';", "      return 'gelijk';"))]);
MUTANTEN.push(['het halve scheidingsteken wordt niet onthouden', 'html',
  s => inFunctie(s, 'bewaarCfg', f => f.replace('zetSepOnafgemaakt(bestandSep);', ''))]);
MUTANTEN.push(['en niet gewist na een gelukte schrijfactie', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace("zetSepOnafgemaakt(''); sepMist = '';", ''))]);
MUTANTEN.push(['herschrijven leest het bestand met het nieuwe teken', 'html',
  s => inFunctie(s, 'bewaarCfg', f => f.replace("opslaanWijziging({ soort:'alles', leesSep:bestandSep })", "opslaanWijziging({ soort:'alles' })"))]);
MUTANTEN.push(['zoekBeterSep noemt het eerste teken zonder te kijken', 'html',
  s => inFunctie(s, 'zoekBeterSep', f => f
    .replace('if(goed) vondst = SEP_KANDIDATEN[k];', 'vondst = SEP_KANDIDATEN[k];'))]);
MUTANTEN.push(['zoekBeterSep praat ook over een leesbaar bestand', 'html',
  s => inFunctie(s, 'zoekBeterSep', f => f
    .replace('for(var i = 0; i < gelezen.length; i++){ if(gelezen[i].raw === undefined) return \'\'; }', ''))]);
MUTANTEN.push(['een tab blijft onzichtbaar in de melding', 'html',
  s => inFunctie(s, 'sepLabel', f => f.replace("t === '\\t' ? 'tab' : ", ''))]);

MUTANTEN.push(['zoekBeterSep parseert ook een leeg bestand', 'html',
  s => inFunctie(s, 'zoekBeterSep', f => f.replace("if(!gelezen.length) return '';", ''))]);

/* Groep 15: een record is altijd een regel, en de afspraak staat twee keer
   woordelijk gelijk. */
MUTANTEN.push(['regelVan zonder de garantie van een regel', 'html',
  s => inFunctie(s, 'regelVan', f => f
    .replace("return /[\\r\\n]/.test(regel) ? regel.replace(/[\\r\\n]+/g, ' ') : regel;",
             'return regel;'))]);
MUTANTEN.push(['regelovergang eruit zonder spatie', 'html',
  s => inFunctie(s, 'regelVan', f => f
    .replace("regel.replace(/[\\r\\n]+/g, ' ')", "regel.replace(/[\\r\\n]+/g, '')"))]);
MUTANTEN.push(['alleen de nieuwe regelovergang, niet de oude Mac', 'html',
  s => inFunctie(s, 'regelVan', f => f
    .replace('/[\\r\\n]/.test(regel)', '/\\n/.test(regel)')
    .replace("regel.replace(/[\\r\\n]+/g, ' ')", "regel.replace(/\\n+/g, ' ')"))]);
MUTANTEN.push(['de configuratie wordt niet platgeslagen', 'html',
  s => inFunctie(s, 'keurCfg', f => f
    .replace("    if(typeof t !== 'string' || !/[\\x00-\\x1F\\x7F]/.test(t)) return t;",
             '    return t;'))]);
MUTANTEN.push(['parse onthoudt niet wat er in het categorieveld stond', 'html',
  s => inFunctie(s, 'parseLijst', f => f.replace('if(!catGetal) rec.catRuw = catRuw;', ''))]);
MUTANTEN.push(['een getypte nul krijgt alsnog een klacht', 'html',
  s => inFunctie(s, 'parseLijst', f => f.replace('if(!catGetal) rec.catRuw = catRuw;',
                                            'rec.catRuw = catRuw;'))]);
MUTANTEN.push(['het rapport zwijgt over een onleesbare categorie', 'html',
  s => s.replace("  voeg('Categorie niet te lezen, geldt als 1', records.filter(function(r){",
                 "  if(false) voeg('weg', records.filter(function(r){")]);
MUTANTEN.push(['de afspraak in de macro wijkt af', 'lite',
  s => s.replace('// Een record is altijd precies een regel.',
                 '// Een record is in de regel precies een regel.')]);
MUTANTEN.push(['de regel over een record per regel verdwijnt uit de app', 'html',
  s => s.replace('   Een record is altijd precies een regel. Beide lezers delen het bestand op',
                 '   Beide lezers delen het bestand op')]);
MUTANTEN.push(['de macro leest het categorieveld anders', 'lite',
  s => s.replace("event['category'] = (fields[4] !== undefined) ? +fields[4].trim() : 0;",
                 "event['category'] = (fields[4] !== undefined) ? parseInt(fields[4].trim(), 10) || 0 : 0;")]);

MUTANTEN.push(['onleesbare categorie weer op 2', 'html',
  s => inFunctie(s, 'parseLijst', f => f.replace('cat: catGetal ? +catRuw : 1,',
                                            'cat: catGetal ? +catRuw : 2,'))]);

MUTANTEN.push(['nieuw event weer op categorie 2', 'html',
  s => s.replace('var cat = 1;              /* een nieuw event begint op de eerste categorie */',
                 'var cat = 2;')
        .replace('cat = r ? r.cat : 1;', 'cat = r ? r.cat : 2;')]);

/* Groep 16: de worker meldt een verse kopie. */
MUTANTEN.push(['de worker meldt niets', 'sw',
  s => s.replace('.then(function(){ if(navigatie) meldVerversing(); })', '')]);
MUTANTEN.push(['de worker meldt ook bij gewone bestanden', 'sw',
  s => s.replace('if(navigatie) meldVerversing();', 'meldVerversing();')]);
MUTANTEN.push(['melden voordat het wegschrijven is gelukt', 'sw',
  s => s.replace("bewaarKlaar = cache.put(bewaarSleutel, res.clone())",
                 "meldVerversing(); bewaarKlaar = cache.put(bewaarSleutel, res.clone())")]);
MUTANTEN.push(['ook workers aanschrijven', 'sw',
  s => s.replace("self.clients.matchAll({ type:'window' })", 'self.clients.matchAll({})')]);
MUTANTEN.push(['de pagina luistert niet naar het bericht', 'html',
  s => s.replace("      if(e.data && e.data.type === 'kopieVernieuwd') checkAppUpdate();", '')]);
MUTANTEN.push(['geen vangnet na een paar seconden', 'html',
  s => s.replace('setTimeout(function(){ checkAppUpdate(); }, 4000);', '')]);

MUTANTEN.push(['de worker weer uit de browsercache', 'html',
  s => s.split("serviceWorker.register('sw-events.js', { updateViaCache: 'none' })")
        .join("serviceWorker.register('sw-events.js')")]);
MUTANTEN.push(['de offline-kopie weer te vroeg vullen', 'html',
  s => s.replace('      statusVersieKopie();\n', '')
        .replace('  statusOpslagVast();\n', '  statusOpslagVast();\n  statusVersieKopie();\n')]);
/* Een tweede 'Versie X-Y' hoger in het bestand. De app leest de EERSTE
   treffer, dus dan leest hij het verkeerde stempel uit de offline-kopie. */
MUTANTEN.push(['een tweede stempel hoger in het bestand', 'html',
  s => s.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n<!-- Versie FFFFFFF-FFF -->')]);
/* De overgangsregel eruit: dan ziet een toestel dat nog op de vorige versie
   draait juist de overstap zelf niet. */
MUTANTEN.push(['de overgangsregel voor de vorige versie weg', 'html',
  s => s.replace(/var APP_VERSIE = \d+;/, '')]);

/* App-status weer met een eigen kopie van de zoektocht, zodat de statusregel
   een ander stempel kan tonen dan de app vergelijkt. */
MUTANTEN.push(['App-status zoekt weer zelf in de caches', 'html',
  s => inFunctie(s, 'statusVersieKopie', f => f.replace(
    'nieuwsteStempelUitCache(c).then(function(uit){',
    "c.keys().then(function(namen){\n    var eig = namen.filter(function(n){ return n.indexOf('events-') === 0; }).sort();\n    if(!eig.length) throw new Error('geen eigen cache');\n    return c.open(eig[eig.length - 1]).then(function(vak){\n      return vak.match(new URL('events.html', location.href).href, { ignoreSearch: true });\n    }).then(function(res){\n      if(!res) throw new Error('events.html staat er niet in');\n      return res.text();\n    }).then(function(t){\n      var mm = /Versie\\s+([0-9A-F]+-[0-9A-F]+)/.exec(t);\n      if(!mm) throw new Error('geen versiestempel in de kopie');\n      return { stempel: mm[1], reden: null };\n    });\n  }).then(function(uit){"))]);

/* Opslaan alleen op een ongewijzigd bestand (034-038). */
MUTANTEN.push(['034: opslaan vergelijkt de inhoud niet', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace('if((v.nieuw ? null : v.tekst) !== verwacht) throw gewijzigd(v.lijst.length);', ''))]);
MUTANTEN.push(['034: het venster geeft zijn eigen basis niet mee', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace("var verwacht = ('basisTekst' in w) ? w.basisTekst : basisTekst;", 'var verwacht = basisTekst;'))]);
MUTANTEN.push(['034: geen stempelcontrole vlak voor het schrijven', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace('if(veranderd) throw gewijzigd(null);', ''))]);
MUTANTEN.push(['034: het aantal regels van toen niet in de uitkomst', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace("if(e && e.gewijzigd) return { fout:'gewijzigd', was:e.was, nu:e.nu };", "if(e && e.gewijzigd) return { fout:'gewijzigd' };"))]);
MUTANTEN.push(['034: pasToe schrijft ook als het event er niet staat', 'html',
  s => inFunctie(s, 'pasToe', f => f.replace('if(i < 0) return null;', 'if(i < 0){ lijst.push(w.rec); return { ok:true, rec:w.rec, voor:null }; }'))]);
MUTANTEN.push(['034: na een eigen opslag is dat niet de basis', 'html',
  s => inFunctie(s, 'neemOver', f => f.replace('  basisTekst = tekst;\n', ''))]);
MUTANTEN.push(['034: opslaan maakt een backup voor de controle', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace("    return leesVoorSchrijven(w.leesSep);", "    return maybeBackup(bestandsnaam).then(function(){ return leesVoorSchrijven(w.leesSep); });"))]);
MUTANTEN.push(['035: een verdwenen bestand wordt stil opnieuw gemaakt', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace("if(v.nieuw && typeof verwacht === 'string') throw BESTAND_WEG;", ''))]);
MUTANTEN.push(['035: lezen met text() (de BOM verdwijnt)', 'html',
  s => inFunctie(s, 'leesTekst', f => f.replace("if(typeof f.arrayBuffer !== 'function' || typeof TextDecoder !== 'function') return f.text();", 'return f.text();'))]);
MUTANTEN.push(['037: bewerken mag ook als niets te lezen is', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace("(sepMist || sepOnafgemaakt || alleOnbegrepen())", '(sepMist || sepOnafgemaakt)'))]);
MUTANTEN.push(['037: _backup_groot ook door een kleinere vervangen', 'html',
  s => inFunctie(s, 'bewaarGroot', f => f.replace('if(bestaand === null) return schrijfBestand(gn, tekst)', 'if(true) return schrijfBestand(gn, tekst)'))]);
MUTANTEN.push(['037: Toch opslaan van de configuratie kijkt niet naar het teken op schijf', 'html',
  s => inFunctie(s, 'schrijfCfg', f => f.replace('throw CFGKERN;', 'return;'))]);

MUTANTEN.push(['039: de leeskopie houdt de oude configuratie', 'html',
  s => inFunctie(s, 'schrijfCfg', f => f.replace('return bewaarKopie(kopieRij.bestand, kopieRij.tekst, { mtime:kopieRij.mtime, grootte:kopieRij.grootte });', 'return;'))]);
MUTANTEN.push(['039: ongeldige UTF-8 stil vervangen', 'html',
  s => inFunctie(s, 'leesTekst', f => f.replace("{ ignoreBOM:true, fatal:true }", "{ ignoreBOM:true }"))]);
MUTANTEN.push(['039: een recentere grote versie overslaan', 'html',
  s => inFunctie(s, 'bewaarGroot', f => f.replace("return vrijeNaam(backupNaam(naam, '_groot_' + datumNaam())).then(function(dn){", "return Promise.resolve(gn).then(function(dn){ return dn; }).then(function(dn){ if(dn) return dn;"))]);
MUTANTEN.push(['039: een scheidingstekenprobleem heet een wijziging van buiten', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace('|| alleOnbegrepen())) throw SEPFOUT;', '|| alleOnbegrepen())) throw gewijzigd(null);'))]);

MUTANTEN.push(['040: het rondje half doorzichtig bij hover', 'html',
  s => s.replace('button.bezig:disabled,button.bezig:disabled:hover{opacity:1;', 'button.bezig:disabled{opacity:1;')]);

MUTANTEN.push(['041: een onleesbare _backup_groot overschrijven', 'html',
  s => inFunctie(s, 'bewaarGroot', f => f.replace("return (e && e.name === 'NotFoundError') ? null : ONLEESBAAR;", "return e === 'nooit' ? ONLEESBAAR : null;"))]);

MUTANTEN.push(['042: een grotere versie overschrijft _backup_groot toch', 'html',
  s => inFunctie(s, 'bewaarGroot', f => f.replace('if(bestaand === null) return schrijfBestand(gn, tekst)', 'if(bestaand === null || (bestaand !== ONLEESBAAR && telTekst(bestaand) <= telTekst(tekst))) return schrijfBestand(gn, tekst)'))]);
MUTANTEN.push(['042: twee in dezelfde seconde overschrijven elkaar', 'html',
  s => inFunctie(s, 'vrijeNaam', f => f.replace('function(){ return vrijeNaam(naam, (n || 1) + 1); }', 'function(){ return kandidaat; }'))]);
MUTANTEN.push(['042: stuurtekens blijven in de configuratie', 'html',
  s => inFunctie(s, 'schrijfCfg', f => f.replace('nieuw = ordenCfg(zonderStuurtekens(nieuw || cfg));', 'nieuw = ordenCfg(nieuw || cfg);'))]);
MUTANTEN.push(['042: Toch opslaan gaat door als de backup van buiten mislukt', 'html',
  s => inFunctie(s, 'maybeBackup', f => f.replace('if(!gelukt) throw BUITEN_MISLUKT;', ''))]);

MUTANTEN.push(['043: een configuratie die geen UTF-8 is, toch overschrijven', 'html',
  s => inFunctie(s, 'schrijfCfg', f => f.replace('  if(cfgNietUtf8) return Promise.reject(CFGUTF8);\n', ''))]);
MUTANTEN.push(['043: een vastgehouden _backup_groot telt als afwezig', 'html',
  s => inFunctie(s, 'bewaarGroot', f => f.replace("return (e && e.name === 'NotFoundError') ? null : ONLEESBAAR;", "return e === NIET_UTF8 ? ONLEESBAAR : null;"))]);
MUTANTEN.push(['043: een tab als scheidingsteken wordt een spatie', 'html',
  s => inFunctie(s, 'zonderStuurtekens', f => f.replace("  if((sleutel === 'scheidingsteken' || sleutel === 'ofteken') && x === '\\t') return x;\n", ''))]);

MUTANTEN.push(['044: een regelovergang als scheidingsteken toelaten', 'html',
  s => inFunctie(s, 'keurCfg', f => f.replace("if(typeof c[k] === 'string' && c[k] !== '\\t' && /[\\x00-\\x1F\\x7F]/.test(c[k])){", "if(false){"))]);

MUTANTEN.push(['045: niet kijken wat er nu op schijf staat', 'html',
  s => inFunctie(s, 'schrijfCfg', f => f.replace("if(e === NIET_UTF8){ cfgNietUtf8 = true; throw CFGUTF8; }", ''))]);

MUTANTEN.push(['047: schrijven vraagt de map opnieuw', 'html',
  s => inFunctie(s, 'schrijfTekst', f => f.replace("(handle ? Promise.resolve(handle) : dirHandle.getFileHandle(naam, { create:true }))", "dirHandle.getFileHandle(naam, { create:true })"))]);
MUTANTEN.push(['047: zonder bestand niet opnieuw in de map kijken', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace("(v.handle ? v.handle.getFile() : dirHandle.getFileHandle(bestandsnaam).then(function(h){ return h.getFile(); }))", "(v.handle ? v.handle.getFile() : Promise.resolve(null))"))]);
MUTANTEN.push(['047: de reden van een geweigerde opslag kwijt', 'html',
  s => inFunctie(s, 'opslaanWijziging', f => f.replace("fout: res && res.fout || ''", "fout: ''"))]);
MUTANTEN.push(['047: App-status in milliseconden', 'html',
  s => inFunctie(s, 'laatsteOpslagTekst', f => f.replace("(ms / 1000).toFixed(1)", "ms.toFixed(0)"))]);

/* Een filter op de naam, zodat een losse mutatie is na te rekenen zonder de
   hele loop (die duurt een kwartier): node mutant.js "zonder guard op de kopie" */
const FILTER = process.argv[2] || null;
const gedekt = new Set();
/* Wat er mis is met de mutaties zelf: die horen de run te laten mislukken, anders
   meldt het script geslaagd terwijl er niets is nagerekend (039). */
const nietAangegrepen = [], nietGevangen = [], bronKapot = [];
for (const [naam, waar, f] of MUTANTEN) {
  if (FILTER && naam.indexOf(FILTER) < 0) continue;
  let nSw, nHtml, nPy, nLite;
  try {
    nSw = waar === 'sw' ? f(SW) : SW;
    nHtml = waar === 'html' ? f(HTML) : HTML;
    nPy = waar === 'py' ? f(PY) : undefined;
    nLite = waar === 'lite' ? f(LITE) : undefined;
  } catch (e) {
    /* Een mutatie die niet meer aangrijpt (de bron is onder hem veranderd) mag
       de loop niet afbreken: dan wordt er na de eerste verouderde mutatie
       niets meer nagerekend en staat er alleen een stacktrace in het logboek. */
    console.log('!! mutatie greep niet aan: ' + naam + ' (' + e.message + ')');
    nietAangegrepen.push(naam);
    continue;
  }
  if (nSw === SW && nHtml === HTML && nPy === undefined && nLite === undefined) { console.log('!! mutatie greep niet aan: ' + naam); nietAangegrepen.push(naam); continue; }
  const uit = draai(nSw, nHtml, nPy, nLite);
  const r = rood(uit);
  const gedraaid = groen(uit).length + r.length;
  /* Een mutatie die de testrun laat crashen is geen 'nul rood' maar een gemiste
     afhandeling: de controles na de crash hebben niet gedraaid. Zonder deze
     vergelijking leest een stacktrace als een niet-bijtende test. */
  const afgebroken = gedraaid < alle.length;
  const stuk = /SyntaxError|functie niet gevonden|greep te ruim/.test(uit);
  r.forEach(x => gedekt.add(x));
  if (stuk) bronKapot.push(naam);
  else if (!r.length && !afgebroken) nietGevangen.push(naam);
  console.log((naam + ' '.repeat(44)).slice(0, 44) +
              (stuk ? 'BRON KAPOT' : afgebroken ? 'AFGEBROKEN na ' + gedraaid + ', ' + r.length + ' rood'
                                                : r.length + ' rood') +
              (r.length ? '  | ' + r.slice(0, 3).join(' / ').slice(0, 90) : ''));
}

const ongedekt = alle.filter(x => !gedekt.has(x));
console.log('\n' + gedekt.size + ' van de ' + alle.length + ' controles is door minstens een mutatie rood gemaakt.');
if (ongedekt.length) { console.log('niet rood te krijgen met deze mutaties:'); ongedekt.forEach(x => console.log('   ' + x)); }
if (nietAangegrepen.length) console.log('\nNIET AANGEGREPEN (bijwerken of weghalen): ' + nietAangegrepen.join(' / '));
if (bronKapot.length) console.log('BRON KAPOT: ' + bronKapot.join(' / '));
if (nietGevangen.length) console.log('NIET GEVANGEN door events-tests.cjs: ' + nietGevangen.join(' / '));
const mis = nietAangegrepen.length + bronKapot.length + nietGevangen.length;
console.log(mis ? '\n' + mis + ' FOUT(EN)' : '\nGEEN FOUTEN');
process.exitCode = mis ? 1 : 0;
