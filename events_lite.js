//
// EventsLiteINT -- -- pure JavaScript data engine (integer based)
//
// Author:
//	m.j.vandervelden@gmail.com
//
// Usage as API-call:
// 	1: read events_lite.js to js
// 	2: new Function('data', 'qry', 'return (' + js + ')(data, qry);')
// 	3: js is inserted in a template literal, so \\ instead of \ as escape character
//


(function (in_text, in_qry='', in_cfg='') {

	
	//////////
	// begin of the configuration
	//
	// The app writes the configuration, this macro only reads it. Whatever is
	// missing falls back to the value in the constants below.
	//
	
	const cfgRead = (text) => {
		try {
			const c = JSON.parse(text);
			return (c && (typeof c === 'object')) ? c : {};
		} catch (e) {
			return {};
		}
	};
	
	const _CFG = cfgRead(in_cfg);
	
	const cfgChar = (key, fallback) => {
		const c = _CFG[key];
		return ((typeof c === 'string') && (c.length === 1)) ? c : fallback;
	};
	
	//
	// end of the configuration
	//////////
	
	
	//////////
	// begin of general constants & variables
	//	
	
	const _STR_DATECODE = /^D(\\d{8})$/;
	const _STR_LINEBREAK = /\\r?\\n/;
	const _STR_NL = '\\n';
	const _STR_NL2 = '\\n\\n';
	const _STR_TAB = '\\t';
	
	const _SYM_TODAY = '>>';		
	const _SYM_OR = cfgChar('ofteken', '|');
	const _SYM_SEP = cfgChar('scheidingsteken', ';');
	const _SYM_COMMENT = '--';
	const _SYM_CMD = '@';
	const _SYM_HELP = '?';
	const _SYM_NOTE = '*';
	const _SYM_NOTE_ONLY = '**';
	const _SYM_NOTIFY = '!';
	const _SYM_UNKNOWN = '?';
	const _SYM_LONG = 'l'; // an empty command means the same, for short typing
	const _SYM_ALL = 'a'; // every event, whatever its date
	const _SYM_TYPE = 't'; // @t& is a wedding, @t+& is a birth or a wedding
	const _SYM_DATA = '=';
	const _SYM_RANGE = '-';
	
	const _STR_YEAR = /^\\d{4}$/;
	const _STR_YEAR_REL = /^[+-]\\d{1,2}$/;
	const _STR_CAT = /^\\d$/;
	const _STR_CAT_RANGE = /^\\d-\\d$/;
	const _STR_MONTH_NR = /^m\\d{1,2}$/;
	
	// more dots is a longer period
	const _QRY_DAY = '.'; // today & tomorrow
	const _QRY_WEEK = '..'; // three days back until sunday next week
	const _QRY_MONTH = '...'; // three days back until the end of next month
	const _QRY_YEAR = '....'; // today until the same date next year
	
	const _CAT_FIRST = 1; // the default range, a wider one is asked for with @c-c
	const _CAT_LAST = 2;
	
	const _CMD_NONE = 1;
	const _CMD_DATA = 2;
	const _CMD_YEAR = 3; // not used, for clarity only
	const _CMD_LONG_NAME = 4;
	
	const _CLR_REGULAR = 'white';
	const _CLR_TODAY = 'green';
	const _CLR_TOMORROW = 'yellow';
	const _CLR_ERROR = 'red';

	const cfgCatMax = () => {
		const cats = _CFG['categorieen'];
		if (!Array.isArray(cats) || (cats.length === 0)) {
			return 4;
		}
		return cats.reduce((max, c) => { return Math.max(max, +c['nr'] || 0) }, 0) || 4;
	};
	
	const _CAT_MAX = cfgCatMax();
	
	// naam, korte naam, type, datumcode, categorie -- de notitie is optioneel
	const _FLD_MAX = 6;
	const _FLD_MIN = _FLD_MAX - 1;

	const _WEEKDAYS = [
		'maandag',
		'dinsdag',
		'woensdag',
		'donderdag',
		'vrijdag',
		'zaterdag',
		'zondag'
	];

	const _MONTHS = [
		'januari',
		'februari',
		'maart',
		'april',
		'mei',
		'juni',
		'juli', 
		'augustus',
		'september',
		'oktober',
		'november',
		'december'
	];
	
    //
	// end of general constants & variables
	//////////
	
		
	//////////
	// begin of d8 library
	//
	
	const d8_year = (d8) => {
		return Math.floor(d8/10000);
	};
    
	const d8_month = (d8) => {
		return Math.floor(d8/100) % 100;
	};

	const d8_day = (d8) => {
		return d8 % 100;
	};

	const d8_fromYMD = (y, m, d) => {
		return y*10000 + m*100 + d;
	};

	const d8_toD8 = (date) => {
        const y = date.getFullYear();
        const m = date.getMonth() + 1;
        const d = date.getDate();
        return y*10000 + m*100 + d;
    };
    
   const d8_today = () => {
        return d8_toD8(new Date());
    }; 
    
	// de letters a..g komen uit de standaardformule voor het Juliaanse
	// dagnummer, zodat de code naast de bron te leggen is
	const d8_toJulian = (d8) => {
		const year = d8_year(d8);
		const month = d8_month(d8);
		const day = d8_day(d8);

		const a = Math.floor((14 - month)/12);
		const b = year + 4800 - a;
		const c = month + 12*a - 3;
		const d = Math.floor((153*c + 2)/5);
		const e = Math.floor(b/4);
		const f = Math.floor(b/100);
		const g = Math.floor(b/400);
		return day + d + 365*b + e - f + g - 32045;
	};
 
	const d8_fromJulian =  (jd) => {
		const a = jd + 32044;
		const b = Math.floor((4*a + 3)/146097);
		const c = a - Math.floor((146097*b)/4);
		const d = Math.floor((4*c + 3)/1461);
		const e = c - Math.floor((1461*d)/4);
		const f = Math.floor((5*e + 2)/153);
		const day = e - Math.floor((153*f + 2)/5) + 1;
		const month = f + 3 - 12*Math.floor(f/10);
		const year = 100*b + d - 4800 + Math.floor(f/10);
		return year*10000 + month*100 + day;
	};

	// needs a complete date: a d8 with a month or day of 0 is a description and
	// not a day on the calendar, so there is nothing to count from
	const d8_add = (d8, n) => {
		return d8_fromJulian(d8_toJulian(d8) + n);
	};
	
	// needs two complete dates, see d8_add
    const d8_days = (d8a, d8b) => {
        return d8_toJulian(d8a) - d8_toJulian(d8b);
    };
		
	// only the year is filled in, because that is the recurrence; a missing month
	// or day is not filled in, so an event never lands on a day that is not known
	const d8_between = (d8, first, last, year) => {
		const y = d8_year(d8) || year;
		const target = d8_fromYMD(y, d8_month(d8), d8_day(d8));
		return (target >= first) && (target <= last);
	};
	
	// an event of which the month or the day is not known
	const d8_isPartial = (d8) => {
		return (d8_month(d8) === 0) || (d8_day(d8) === 0);
	};
	
	// het Juliaanse dagnummer telt door over de weken heen, dus de weekdag zit
	// er al in; 1 = maandag, 7 = zondag
	const d8_weekDay = (d8) => {
		return (d8_toJulian(d8) % 7) + 1;
	};
	
	// the day before the first of the next month
	const d8_endOfMonth = (y, m) => {
		const first = (m >= 12) ? d8_fromYMD(y + 1, 1, 1) : d8_fromYMD(y, m + 1, 1);
		return d8_add(first, -1);
	};
  
    // Het Juliaanse dagnummer bevat de weekdag, 
    // (jd % 7) + 1 komt exact overeen met d8_weekDay. 
    // Needs a complete date, see d8_add.
    const d8_findWeekDay = (d8, wd, cnt, inc) => {
    	if (cnt <= 0) {
           return d8;
        }
    	const jd = d8_toJulian(d8);
    	const cur = (jd % 7) + 1;
	    const step = (inc > 0) ? ((wd - cur + 7) % 7) : ((cur - wd + 7) % 7);
	    return d8_fromJulian(jd + inc*(step + 7*(cnt - 1)));
    };  
 
	const d8_lastWeekDay = (y, m, wd) => {
		return d8_findWeekDay(d8_endOfMonth(y, m), wd, 1, -1);
	};
	
	const d8_endOfNextWeek = (d8) => {
		return d8_findWeekDay(d8, 7, 2, 1);
	};
	
	const d8_isYear = (y) => {
		return (y >= 1000) && (y <= 9999);
	};
  
    const d8_isMonth = (m) => {
		return (m >= 1) && (m <= 12);
	};

	const d8_daysInMonth = (y, m) => {
		return d8_day(d8_endOfMonth(y, m));
	};
 
	const d8_isDay = (d, y, m) => {
		return (d >= 1) && (d <= d8_daysInMonth(y, m));
	};
    
	const d8_isDate = (d8) => {
		const y = d8_year(d8);
		const m = d8_month(d8);
		const d = d8_day(d8);
		return d8_isYear(y) && d8_isMonth(m) && d8_isDay(d, y, m);
	};
   	
	const d8_isLeapYear = (y) => {
		return (((y % 4) === 0) && ((y % 100) !== 0)) || ((y % 400) === 0);
	};
	 
	// de anonieme Gregoriaanse rekenwijze; ook hier houden de letters de vorm van
	// de gepubliceerde formule aan
	const d8_easter = (year) => {
		const a = year % 19;
		const b = Math.floor(year/100);
		const c = Math.floor(b/4);
		const d = Math.floor((8*b + 13)/25);
		const e = (b - c - d + 19*a + 15) % 30;
		const f = Math.floor(e/28);
		const g = Math.floor(29/(e + 1));
		const h = Math.floor((21 - a)/11);
		const i = e - f*(1 - g*h);
		const j = Math.floor(year/4);
		const k = Math.floor(b/4);
		const l = (year + j + i + 2 - b + k) % 7;
		const m = i - l;
		const month = 3 + Math.floor((m + 40)/44);
		const day = m + 28 - 31*Math.floor(month/4);
		return year*10000 + month*100 + day;
	};
	
	const d8_fromCodeStr = (codeStr) => {
		const m = codeStr.match(_STR_DATECODE);
		return (m && m[1]) ? +m[1] : NaN;
	};
	
	const d8_decode = (code, year) => {
		const y = d8_year(code);
		const m = d8_month(code);
		const d = d8_day(code);

		if ((y >= 1) && (y <= 7)) {
			if (d === 99) {
				return d8_lastWeekDay(year, m, y);
			} else {
				const d8 = d8_fromYMD(year, m, 1);
				return d8_findWeekDay(d8, y, d, 1);
			}
		} else if (y === 8) {
			const easter = d8_easter(year);
			return d8_add(easter, m - d);
		} else {
			return d8_fromYMD(year, m, d);
		}
	};
    
     	
	//////////
	// begin of main constants & variables
	//	
	
	const _MONTHS_SHORT = [
		'jan',
		'feb',
		'mrt',
		'apr',
		'mei',
		'jun',
		'jul',
		'aug',
		'sep',
		'okt',
		'nov',
		'dec'
	];
	
	const _EVENT_TYPE_FALLBACK = {
		'Geboren': '+',
		'Overleden': '-',
		'Getrouwd': '&',
		'Gescheiden': '/',
		'Feestdag': 'F',
		'Gedenkdag': 'G',
		'Gebeurtenis': 'E' // event
	};
	
	// the types the app knows, with the sign that stands for them
	const cfgTypes = () => {
		const types = _CFG['types'];
		if (!Array.isArray(types) || (types.length === 0)) {
			return _EVENT_TYPE_FALLBACK;
		}
		const out = {};
		for (const t of types) {
			if (t && t['omschrijving']) {
				out[t['omschrijving']] = t['teken'] || '';
			}
		}
		return out;
	};
	
	const _EVENT_TYPE = cfgTypes();
	
	// alleen de fouten van de opdrachtregel worden hier verzameld; de lijsten met
	// events, met fouten uit het bestand en met het resultaat worden doorgegeven
	// van functie naar functie, zodat elke stap op zichzelf te proberen is
	const _cmdErrors = [];
	
	const _today = d8_today();
	
	// Alles wat een vraag over zichzelf bijhoudt, in een object dat main maakt en
	// dat aan elke functie wordt meegegeven. Zo staat in de aanroep wie wat leest
	// en wie wat zet, en is geen enkele stap afhankelijk van iets dat ergens
	// anders al gebeurd moet zijn.
	const newState = () => {
		return {
			'qry': '',
			'cmd': _CMD_NONE,
			
			'date': _today,
			'year': d8_year(_today),
			'cat1': 1,
			'catN': 0,
			'date1': _today,
			'dateN': _today,
			'pattern': '',
			'note': false,
			
			// wat de gebruiker zelf heeft opgegeven; wordt toegepast nadat de
			// vraag zijn eigen standaard heeft gezet, zodat een opgave wint
			'optCat1': 0,
			'optCatN': 0,
			'optNote': false,
			'optNoteOnly': false,
			'optNotify': false,
			'optMonth': 0,
			'optPeriod': '',
			'optUnknown': false,
			'optAll': false,
			'optTypes': ''
		};
	};
	
	//
	// end of main constants & variables	
	//////////

	
	//////////
	// begin of utilities
	//
	
	// accent folding
	const fold = (s) => {
		const t = ((s === undefined) || (s === null)) ? '' : s.toString();
		const n = t.normalize ? t.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '') : t;
		return n.toLowerCase();
	};	
		
	const searchText = (event) => {
		const txt = [];
		txt.push(event['date']);
		txt.push(event['date_origin']);
		txt.push(event['date_verbose']);
		txt.push(event['find_year']);
		txt.push(event['find_origin']);
		txt.push(event['age']);	
		txt.push(event['long_name']);
		txt.push(event['short_name']);
		txt.push(event['event_type']);
		txt.push(event['type_code']);	
		txt.push(event['category']);
		txt.push(event['note']);
		txt.push(event['has_note']);
		return fold(_SYM_SEP + txt.join(_SYM_SEP) + _SYM_SEP);
	};

	// het patroon een keer klaarzetten in plaats van bij elk event opnieuw: de
	// delen tussen de of-tekens, gevouwen en zonder lege
	const prepare = (pattern) => {
		return pattern.split(_SYM_OR)
			.map(pat => fold(pat.trimEnd()))
			.filter(pat => pat !== '');
	};
	
	const find = (parts, event) => {
		const text = searchText(event);
		for (const part of parts) {
			if (text.indexOf(part) >= 0) {
				return true;
			}
		}
		return false;
	};
	
	const cmpStr = (a, b) => {
		const fa = fold(a);
		const fb = fold(b);
		if (fa < fb) { return -1; }
		if (fa > fb) { return 1; }
		if (a < b) { return -1; }
		if (a > b) { return 1; }
		return 0;
	};	
	
	// an event of which the day is not known has no place inside the month, so it
	// is put behind the days that are known
	const sortDate = (event) => {
		const d8 = event['date'];
		return d8_fromYMD(d8_year(d8), d8_month(d8) || 12, d8_day(d8) || 99);
	};
	
	// the categories that are used, also when they were not asked for; the header
	// shows them, so what counts is never hidden
	const fmtCat = (st) => {
		const last = st.catN || _CAT_MAX;
		return (st.cat1 === last) ? '' + st.cat1 : st.cat1 + _SYM_RANGE + last;
	};
	
	// everything that counts, behind one @ and separated by a space: that reads
	// more easily than a row of @ signs
	// a @ in the search text is shown as @@, so the header can be typed back in
	const fmtQry = (st) => {
		return st.qry.split(_SYM_CMD).join(_SYM_CMD + _SYM_CMD);
	};
	
	const fmtCmds = (st) => {
		const cmds = [];
		if (st.optPeriod !== '') {
			cmds.push(st.optPeriod);
		}
		if (st.optMonth > 0) {
			cmds.push(_MONTHS_SHORT[st.optMonth - 1]);
		}
		if (st.optUnknown) {
			cmds.push(_SYM_UNKNOWN);
		}
		cmds.push(fmtCat(st));
		if (st.optTypes !== '') {
			cmds.push(_SYM_TYPE + st.optTypes);
		}
		if (st.optNote) {
			cmds.push(st.optNoteOnly ? _SYM_NOTE_ONLY : _SYM_NOTE);
		}
		if (st.cmd === _CMD_LONG_NAME) {
			cmds.push(_SYM_LONG);
		}
		if (st.cmd === _CMD_DATA) {
			cmds.push(_SYM_DATA);
		}
		if (st.year !== d8_year(_today)) {
			cmds.push('' + st.year);
		}
		return _SYM_CMD + cmds.join(' ');
	};
	
	const cmpDateLongName = (a, b) => {
		const a1 = sortDate(a);
		const b1 = sortDate(b);
		if (a1 < b1) { return -1; }
		if (a1 > b1) { return 1; }

		return cmpStr(a['long_name'], b['long_name']);
	};

	const cmpLongNameDate = (a, b) => {
		const c = cmpStr(a['long_name'], b['long_name']);
		if (c !== 0) { return c; }

		const a2 = sortDate(a);
		const b2 = sortDate(b);
		if (a2 < b2) { return -1; }
		if (a2 > b2) { return 1; }

		return 0;
	};	
    
	const fmtN = (n, zero='0') => {
		if (n === 0) {
			return '' + zero;
		} else {
			return (n > 0) ? '+' + n : '' + n;
		}
	};

	const fmtNN = (n, prefix='0') => {
		return (n < 10) ? prefix + n : '' + n;
	};
	
	const fmtDay = (wd, n=0) => {
		const day = _WEEKDAYS[wd - 1];
		return (n === 0) ? day : day.slice(0, n);
	};
	
	const fmtMonth = (m) => {
		return _MONTHS[m - 1];
	};
	
	const fmtDelta = (delta) => {
		return fmtN(delta, _SYM_TODAY);
	};
		
	const fmtAge = (d8, d8code) => {
		const origin = d8_year(d8code);
		return (d8_isYear(origin)) ? (d8_year(d8) - origin) + 'jr' : '';
	};	
	
	// the first year from y on in which this day exists; only 29 february is not
	// in every year, so the search never runs far
	const yearWithDate = (d, m, y) => {
		for (let i = 0; i < 8; i++) {
			if (d8_isDate(d8_fromYMD(y + i, m, d))) {
				return y + i;
			}
		}
		return y;
	};
	
	const fmtDate = (date, year, sep=' ') => {
		const d = d8_day(date);
		const m = d8_month(date);
		const ymd = d8_fromYMD(year, m, d);

		const txt = [];
		txt.push((d === 0) ? '??' : fmtNN(d));
		txt.push('-');
		txt.push((m === 0) ? '??' : fmtNN(m));
		if (d8_isYear(year)) {
			txt.push('-');
			txt.push(year);
		}
		if (d8_isDate(ymd)) {
			txt.push(sep);
			const wd = d8_weekDay(ymd);
			txt.push(fmtDay(wd, 2));
		}
		return txt.join('');		
	}; 
	
	const fmtCode = (d8code) => {
		const y = d8_year(d8code);
		const m = d8_month(d8code);
		const d = d8_day(d8code);

        if (((y >= 1) && (y <= 7)) && ((m >= 1) && (m <= 12))) {
            const day = fmtDay(y);
            const month = fmtMonth(m);
            if (d === 99) {
                return 'laatste ' + day + ' in ' + month;
            } else {
                return d + 'e ' + day + ' in ' + month;
            }
        } else if (y === 8) {
            const n = m - d;
            if ((n === 0) || (n === 1)) {
                return (n + 1) + 'e paasdag';
            } else if (n > 0) {
                return '1e paasdag + ' + n + ' dagen' ;
            } else if (n < 0) {
                return '1e paasdag - '  + (-n) + ' dagen';
            }
        } else {
            return '';
        }
	};

	const fmtColor = (delta) => {
		if (delta === 0) {
			return _CLR_TODAY;
		} else if (delta === 1) {
			return _CLR_TOMORROW;
		} else {
			return _CLR_REGULAR;
		}
	};

	const fmtData = (event) => {
		const txt = [];
		const clr = fmtColor(event['delta']);
		txt.push('<span style=color:' + clr + '>');		
		txt.push(event['long_name']);
		txt.push('</span>');
		txt.push(_STR_NL);
		txt.push(event['short_name']);
		txt.push(_STR_NL);
		txt.push(event['event_type']);
		txt.push(_STR_NL);
		txt.push(event['date_code']);
		txt.push(_STR_NL);
		txt.push(event['category']);
		txt.push(_STR_NL);
		if (event['has_note']) {
			txt.push('<i>');
			txt.push(event['note']);
			txt.push('</i>');
			txt.push(_STR_NL);
		}
		return txt.join('');
	};

	const fmtEvent = (event, note, lang) => {
		const txt = [];
		
		// delta name age
		const clr = fmtColor(event['delta']);
		txt.push('<span style=color:' + clr + '>');
		txt.push('<b>');
		
		if (event['delta_nice'] !== '') {
			txt.push(event['delta_nice']);
			txt.push(' ');
		}
		txt.push(event['short_name']);
		txt.push('</b>');
		txt.push('</span>');
		
		// long name
		if (lang) {
			if (event['long_name'] !== event['short_name']) {
				txt.push(_STR_NL);	
				txt.push(event['long_name']);
			}
		}
		
		// date
		txt.push(_STR_NL);
		txt.push(event['date_year']);
		if (event['age'] !== '') {
			txt.push(' ');
			txt.push(event['age']);
		}	

		// date type
		txt.push(_STR_NL);	
		txt.push(event['date_origin']);
		txt.push(' ');
		txt.push(event['event_type']);
		
		// code
		if (event['date_verbose']) {
			txt.push(_STR_NL);
			txt.push(event['date_verbose']);
		}
	
		// note
		if (note && event['has_note']) {
			txt.push(_STR_NL);
			txt.push('<i>');
			txt.push(event['note']);
			txt.push('</i>');
		}
		txt.push(_STR_NL);
		
		return txt.join('');
	};
	
	const fmtResult = (event, opmaak) => {
		if (opmaak['data']) {
			return fmtData(event);
		} else {
			return fmtEvent(event, opmaak['note'], opmaak['long']);
		}
	};  
	
	//
	// end of utilities
	//////////
 

	//////////
	// main
	//
	
	// alles wat de vraag oplevert, op een plek bij elkaar; executeQry heeft
	// verder niets nodig en is daarmee los te proberen
	const qryFilter = (st) => {
		return {
			'year': st.year,
			'first': st.date1,
			'last': st.dateN,
			'cat1': st.cat1,
			'catN': st.catN,
			'pattern': st.pattern,
			'types': st.optTypes,
			'noteOnly': st.optNoteOnly,
			'month': st.optMonth,
			'unknown': st.optUnknown,
			'all': st.optAll,
			'data': (st.cmd === _CMD_DATA)
		};
	};
	
	// --- welke events doen mee, en op welke dag vallen ze ---

	// de categorie, het type en de notitie, los van de datum
	const matchFields = (event, f) => {
		if (f['noteOnly'] && (event['note'] === '')) {
			return false;
		}
		if (f['types'] !== '') {
			const code = _EVENT_TYPE[event['event_type']] || '';
			if ((code === '') || (f['types'].indexOf(code) < 0)) {
				return false;
			}
		}
		const cat = event['category'] || 0;
		return (cat >= f['cat1']) && ((f['catN'] === 0) || (cat <= f['catN']));
	};

	// de dag waarop dit event valt, of null als het buiten de vraag valt. Rond de
	// jaarwisseling kan die dag in het vorige of het volgende jaar liggen; een
	// onvolledige datum heeft geen dag en telt alleen mee bij @? of in zijn maand
	const matchDate = (d8code, f) => {
		let d8 = d8_decode(d8code, f['year']);

		if (f['all']) {
			return d8;
		}
		if (d8_isPartial(d8)) {
			const inMonth = (f['month'] > 0) && (d8_month(d8) === f['month']);
			return (f['unknown'] || inMonth) ? d8 : null;
		}
		if (f['unknown']) {
			return null;
		}

		for (const y of [f['year'], f['year'] - 1, f['year'] + 1]) {
			d8 = d8_decode(d8code, y);
			if (d8_between(d8, f['first'], f['last'], y)) {
				// 29 februari bestaat niet in elk jaar; dan is er geen dag
				const schrikkel = (d8_day(d8) === 29) && (d8_month(d8) === 2);
				if (schrikkel && !d8_isLeapYear(d8_year(d8))) {
					return null;
				}
				return d8;
			}
		}
		return null;
	};

	// alles wat uit de datumcode volgt op het event zetten
	const decorate = (event, d8, d8code, f) => {
		event['type_code'] = _EVENT_TYPE[event['event_type']] || '';
		event['date'] = d8;

		if (d8_isDate(d8)) {
			event['delta'] = d8_days(d8, _today);
			event['delta_nice'] = fmtDelta(event['delta']);
		} else {
			event['delta'] = NaN;
			event['delta_nice'] = '';
		}

		event['origin'] = d8_year(d8code);
		event['age'] = fmtAge(d8, d8code);
		event['date_origin'] = fmtDate(d8, event['origin']);

		// een dag die dit jaar niet bestaat wordt getoond in het eerste jaar dat
		// hij wel bestaat, zodat de regel geen datum claimt die er niet is
		const dy = d8_day(d8);
		const my = d8_month(d8);
		event['date_year'] = fmtDate(d8, (dy && my) ? yearWithDate(dy, my, f['year']) : f['year']);
		event['date_verbose'] = fmtCode(d8code);
		event['find_origin'] = fmtDate(d8, event['origin'], _SYM_SEP);
		event['find_year'] = fmtDate(d8, f['year'], _SYM_SEP);
		event['has_note'] = (event['note'] !== '') ? '*' : '';
		return event;
	};

	const executeQry = (events, f) => {
		const parts = prepare(f['pattern']);
		const result = [];

		for (const event of events) {
			if (!matchFields(event, f)) {
				continue;
			}
			const d8code = d8_fromCodeStr(event['date_code']);
			const d8 = matchDate(d8code, f);
			if (d8 === null) {
				continue;
			}

			// de zoektekst kan pas nadat de datumvelden gevuld zijn
			decorate(event, d8, d8code, f);
			if ((parts.length > 0) && (!find(parts, event))) {
				continue;
			}
			result.push(event);
		}

		result.sort(f['data'] ? cmpLongNameDate : cmpDateLongName);
		return result;
	};
	
	const evaluateErrors = (st, result, events, errors) => {
		if (st.optNotify) {
			return errors.length + ' errors(s) ' + st.qry;
		} else {
			const y = fmtCmds(st);
			const txt = [];
			txt.push(result.length + '/' + events.length + ' ' + fmtQry(st) + y);
			txt.push(_STR_NL);
			txt.push('<b>');
			txt.push('<span style=color:' + _CLR_ERROR + '>');
			txt.push(errors.length + ' error(s)');
			txt.push('</span>');
			txt.push('</b>');
			txt.push(_STR_NL2);
			txt.push(errors.join(_STR_NL2));
			return txt.join('');
		}	
	};
	
	const evaluateResult = (st, result, events) => {
		const opmaak = {
			'data': st.cmd === _CMD_DATA,
			'long': st.cmd === _CMD_LONG_NAME,
			'note': st.note
		};
		const lines = result.map(ev => fmtResult(ev, opmaak));
		const n0 = result.reduce((sum, ev) => 
            { return sum + ((ev['delta'] === 0) ? 1 : 0) }, 0);
		const n1 = result.reduce((sum, ev) => 
            { return sum + ((ev['delta'] === 1) ? 1 : 0) }, 0);

		if (st.optNotify) {
			return '| ' + n0 + ' | ' + n1 + ' | event(s) ' + st.qry ;
		} else {
			const clr0 = fmtColor((n0 > 0) ? 0 : -1);
			const clr1 = fmtColor((n1 > 0) ? 1 : -1);
			const y = fmtCmds(st);
			const txt = [];
			txt.push('<b>');
			txt.push(result.length + '/' + events.length + ' ' + fmtQry(st) + y);
			txt.push(_STR_NL);
			txt.push('<span style=color:' + clr0 + '>');
			txt.push(n0 + ' vandaag');
			txt.push('</span>');
			txt.push(_STR_TAB);
			txt.push('<span style=color:' + clr1 + '>');
			txt.push(n1 + ' morgen');
			txt.push('</span>');
			txt.push('</b>');
			txt.push(_STR_NL2);
			txt.push(lines.join(_STR_NL));
			return txt.join('');			
		}		
	};
	
	const evaluateQry = (st, result, events, errors) => {
		if (errors.length === 0) {
			return evaluateResult(st, result, events);
		} else if (st.optNotify) {
			return evaluateErrors(st, result, events, errors);
		} else {
			return evaluateErrors(st, result, events, errors) + _STR_NL2 +
				evaluateResult(st, result, events);
		}	
	};
	
	// every period uses the same categories and shows no notes; both can be
	// changed with a command, so the period says nothing but the period
	const qryPeriod = (st, first, last) => {
		st.cat1 = _CAT_FIRST;
		st.catN = _CAT_LAST;
		st.date1 = first;
		st.dateN = last;
		st.pattern = '';
		st.note = false;
	};
	
	const qryDay = (st) => {
		qryPeriod(st, _today, d8_add(_today, 1));
	};
	

	
	const qryWeek = (st) => {
		qryPeriod(st, d8_add(st.date, -3), d8_endOfNextWeek(st.date));
	};
	
	const qryMonth = (st) => {
		const y = d8_year(st.date);
		const m = d8_month(st.date);
		const last = (m >= 12) ? d8_endOfMonth(y + 1, 1) : d8_endOfMonth(y, m + 1);
		qryPeriod(st, d8_add(st.date, -3), last);
	};
	
	const qryYear = (st) => {
		const over = d8_fromYMD(d8_year(st.date) + 1, d8_month(st.date), d8_day(st.date));
		qryPeriod(st, st.date, d8_add(over, -1));
	};
	
	const qryPattern = (st, pattern) => {
		qryPeriod(st, d8_fromYMD(st.year, 1, 1), d8_fromYMD(st.year, 12, 31));
		st.cat1 = 1;
		st.catN = 0;
		st.pattern = pattern;
	};
	
	const setYear = (st, y) => {
		setDate(st, y, d8_month(_today), d8_day(_today));
	};
	
	// a month is given as its number with an m in front, or as three letters;
	// both the short name and the first three letters of the full name are taken
	const monthNr = (c) => {
		if (_STR_MONTH_NR.test(c)) {
			const n = +c.slice(1);
			return (n >= 1) && (n <= 12) ? n : 0;
		}
		if (c.length !== 3) {
			return 0;
		}
		for (let i = 0; i < 12; i++) {
			if ((c === _MONTHS_SHORT[i]) || (c === _MONTHS[i].slice(0, 3))) {
				return i + 1;
			}
		}
		return 0;
	};
	
	// dots always mean a period, whether they stand in front of the @ or behind it
	const isPeriod = (c) => {
		return (c === _QRY_DAY) || (c === _QRY_WEEK) ||
		       (c === _QRY_MONTH) || (c === _QRY_YEAR);
	};
	
	// the letters and signs behind a t are type codes; an unknown one is reported
	const typeCodes = (c) => {
		const codes = c.slice(1).toUpperCase();
		const known = Object.keys(_EVENT_TYPE).map(k => _EVENT_TYPE[k]).join('');
		for (const code of codes) {
			if (known.indexOf(code) < 0) {
				return '';
			}
		}
		return codes;
	};
	
	const setCat = (st, c1, cN) => {
		st.optCat1 = Math.min(c1, cN);
		st.optCatN = Math.max(c1, cN);
	};
	
	// pattern[@command][@command]...  every part behind an @ is its own command
	// and the order does not matter, so a year and a format can be combined
	// The filter the app has saved, as the starting point. The app applies it
	// when it opens and every choice overrides it from there; here a command
	// does the same, and typing something of your own sets it aside.
	const applyCfgFilter = (st) => {
		const f = _CFG['filter'];
		if (!f || (typeof f !== 'object')) {
			return;
		}
		
		const p = String(f['periode'] || '');
		if (p === '~dag') {
			st.optPeriod = _QRY_DAY;
		} else if (p === '~week') {
			st.optPeriod = _QRY_WEEK;
		} else if (p === '~maand') {
			st.optPeriod = _QRY_MONTH;
		} else if (p === 'jaar') {
			st.optPeriod = _QRY_YEAR;
		} else if (p === 'onbekend') {
			st.optUnknown = true;
		} else if (/^\\d{1,2}$/.test(p) && (+p >= 1) && (+p <= 12)) {
			st.optMonth = +p;
		}
		
		const c = f['categorie'];
		if (Array.isArray(c)) {
			setCat(st, +c[0] || 0, +c[1] || 0);
		} else if (+c > 0) {
			setCat(st, +c, +c);
		}
		
		const t = _EVENT_TYPE[f['type']];
		if (t) {
			st.optTypes = t;
		}
		if (f['notitie'] === true) {
			st.optNote = true;
			st.optNoteOnly = true;
		}
		if (+f['jaar']) {
			setYear(st, d8_year(_today) + (+f['jaar']));
		}
	};
	
	const parseQry = (st, qry) => {
		// One @ separates the search text from the commands, and behind it the
		// commands are separated by a space. A double @@ is a plain @ and turns
		// off the separator, so an email address can be searched for.
		const at = qry.indexOf(_SYM_CMD);
		const escaped = (at >= 0) && (qry[at + 1] === _SYM_CMD);
		const q = (at < 0) ? qry.trimEnd()
			: (escaped ? (qry.slice(0, at) + qry.slice(at + 1)).trimEnd()
			           : qry.slice(0, at).trimEnd());
		
		const cmds = ((at < 0) || escaped) ? [] : qry.slice(at + 1).trim().split(' ')
			.filter((c, i, all) => { return (c !== '') || (all.length === 1); });
		
		st.qry = (q === '') ? _QRY_WEEK : q;
		
		applyCfgFilter(st);
		if (q !== '') {
			// a period of your own replaces the one from the configuration
			st.optPeriod = '';
			st.optMonth = 0;
			st.optUnknown = false;
			
			// a search pattern sets the whole filter aside, as in the app
			if (!isPeriod(q)) {
				st.optCat1 = 0;
				st.optCatN = 0;
				st.optTypes = '';
				st.optNote = false;
				st.optNoteOnly = false;
			}
		}
		
		for (const c of cmds) {
			if ((c === '') || (c === _SYM_LONG)) {
				st.cmd = _CMD_LONG_NAME;
			} else if (c === _SYM_DATA) {
				st.cmd = _CMD_DATA;
			} else if (isPeriod(c)) {
				st.optPeriod = c;
			} else if (c === _SYM_NOTE) {
				st.optNote = true;
			} else if (c === _SYM_NOTE_ONLY) {
				st.optNote = true;
				st.optNoteOnly = true;
			} else if (c === _SYM_NOTIFY) {
				st.optNotify = true;
			} else if (c === _SYM_UNKNOWN) {
				st.optUnknown = true;
			} else if (c === _SYM_ALL) {
				st.optAll = true;
			} else if ((c.length > 1) && (c[0].toLowerCase() === _SYM_TYPE) && (typeCodes(c) !== '')) {
				st.optTypes += typeCodes(c);
			} else if (_STR_YEAR.test(c) && d8_isYear(c)) {
				setYear(st, +c);
			} else if (_STR_YEAR_REL.test(c)) {
				setYear(st, d8_year(_today) + (+c));
			} else if (_STR_CAT.test(c)) {
				setCat(st, +c, +c);
			} else if (_STR_CAT_RANGE.test(c)) {
				const r = c.split(_SYM_RANGE);
				setCat(st, +r[0], +r[1]);
			} else if (monthNr(c.toLowerCase()) > 0) {
				st.optMonth = monthNr(c.toLowerCase());
			} else {
				_cmdErrors.push('? command ' + _SYM_CMD + c);
			}
		}
	};
			
	const buildQry = (st, qry) => {
		parseQry(st, qry);
		
		// a period behind the @ works on top of a search pattern in front of it
		const period = st.optPeriod || (isPeriod(st.qry) ? st.qry : '');
		const pattern = isPeriod(st.qry) ? '' : st.qry;
		
		if (period === _QRY_DAY) {
			qryDay(st);
		} else if (period === _QRY_MONTH) {
			qryMonth(st);
		} else if (period === _QRY_YEAR) {
			qryYear(st);
		} else if (period === _QRY_WEEK) {
			qryWeek(st);
		} else {
			qryPattern(st, '');
		}
		st.pattern = pattern;
		
		// searching alone looks at the whole year and at every category, and so
		// does @?: asking what is incomplete should not hide half of it
		if (st.optAll || st.optUnknown || ((pattern !== '') && (st.optPeriod === '') && (!isPeriod(st.qry)))) {
			st.cat1 = 1;
			st.catN = 0;
		}
		
		// what the user asked for beats the default of the query
		if (st.optCat1 > 0) {
			st.cat1 = st.optCat1;
			st.catN = st.optCatN;
		}
		if (st.optNote) {
			st.note = true;
		}
		if (st.optMonth > 0) {
			st.date1 = d8_fromYMD(st.year, st.optMonth, 1);
			st.dateN = d8_endOfMonth(st.year, st.optMonth);
		}
		
		// without a pattern the period is the query itself, so the header shows
		// it once instead of twice; @? has no period at all
		if (pattern === '') {
			st.qry = st.optUnknown ? '' : (st.optAll ? _SYM_ALL : period);
			st.optPeriod = '';
		}
	};

	// welke fouten deze regel heeft, als lijst
	const checkSyntax = (event) => {
		event['errors'] = [];
		if (!_EVENT_TYPE[event['event_type']]) {
			event['errors'].push('? event_type');
		} 
		const dc = event['date_code'];
		if ((dc !== 'D00000000') && (!d8_fromCodeStr(dc))) {
			event['errors'].push('? date_code');
		}
		const cat = event['category'] || 0;
		if ((cat < 1) || (cat > _CAT_MAX)) {
			event['errors'].push('? category');
		}
		if ((event['field_cnt'] < _FLD_MIN) || (event['field_cnt'] > _FLD_MAX)) {
			event['errors'].push('? #fields');
		}
		
		return event['errors'];
	};
	
	// de fouten van alle regels, met de naam erboven
	const collectErrors = (events) => {
		const errors = [];
		for (const event of events) {
			if (event['errors'].length > 0) {
				errors.push([event['long_name']].concat(event['errors']).join(_STR_NL));
			}
		}
		return errors;
	};
	
	const loadEvents = (lines) => {
		const events = [];
		
		// process event lines
		for (const line of lines) {
			const record = line.trim();
		
			// check if line should be skipped
			if ((record === '') || (record.startsWith(_SYM_COMMENT))) {
				continue;
			}
		
			// build event
			const event = {};
			const fields = record.split(_SYM_SEP);
			event['long_name'] = (fields[0] !== undefined) ? fields[0].trim()  : '?';
			event['short_name'] = (fields[1] !== undefined) ? fields[1].trim()  : '?';
			event['event_type'] = (fields[2] !== undefined) ? fields[2].trim()  : '?';
			event['date_code'] = (fields[3] !== undefined) ? fields[3].trim()  : '?';
			event['category'] = (fields[4] !== undefined) ? +fields[4].trim() : 0;
			event['note'] = (fields[_FLD_MIN] !== undefined) ? fields[_FLD_MIN].trim() : '';
			event['field_cnt'] = fields.length;
			
			// register events
			checkSyntax(event);
			events.push(event);
		}	
		return events;
	};
	
	const loadEventText = (text) => {
		return loadEvents(text.toString().split(_STR_LINEBREAK));
	};
	
	const setDate = (st, y, m, d) => {
		// date		
		if ((d === 29) && (m === 2) && (!d8_isLeapYear(y))) {
			st.date = d8_fromYMD(y, 2, 28);
		} else {
			st.date = d8_fromYMD(y, m, d);
		}
		
		// year
		st.year = y;	
	};
	
	const help = () => {
		const txt = [] ;
		txt.push('[<b>period</b>|<b>pattern</b>][@<b>command</b> <b>command</b>...]');
		txt.push('');
		txt.push('<b>period</b>');
		txt.push('. : today & tomorrow');
		txt.push('.. : week, three days back until sunday next week');
		txt.push('... : month, three days back until the end of next month');
		txt.push('.... : year, until the same date next year');
		txt.push('empty : week');
		txt.push('');
		txt.push('abc : search abc, not case sensitive, whitespace at the end is removed');
		txt.push('| : OR symbol in search text');
		txt.push('@@ : a plain @, so sandra@@example.com is a search text');
		txt.push('searching without a period looks at the whole year');
		txt.push('');
		txt.push('<b>command</b>');
		txt.push('behind the @ several commands are allowed, separated by a');
		txt.push('space and in any order: @1-4 t+ *');
		txt.push('. .. ... .... : a period, so abc@.. searches in the week');
		txt.push('mmm or mn : a month, so @mei and @m5 are the same');
		txt.push('yyyy : use yyyy instead of current year');
		txt.push('+n -n : n years from now, so +1 is next year');
		txt.push('c : only category c');
		txt.push('c-c : category range, so 1-2 is 1 and 2');
		txt.push('t<codes> : only these types, so @t& is a wedding and @t+& a birth or a wedding');
		txt.push('* : show the notes');
		txt.push('** : only events with a note');
		txt.push('l : show long name');
		txt.push('= : show original data');
		txt.push('! : one line, for a notification');
		txt.push('? : only events of which the date is not complete');
		txt.push('a : every event, whatever its date');
		txt.push('');
		txt.push('<b>search examples</b>');
		txt.push('*;             : has note?');
		txt.push('-mm-  : search month mm');
		txt.push('-yyyy;  : search year yyyy');
		txt.push('njr : search age of n years');
		txt.push(';dd;  : search ma ... zo');
		txt.push('');
		txt.push('? : help');
		return txt.join(_STR_NL);
	} ;
	
	// main
	const qry = ((in_qry === undefined) || (in_qry === null)) ? '' : in_qry.toString();
	if (qry.startsWith(_SYM_HELP)) {
		return help();
	}
	
	const y = d8_year(_today);
	const m = d8_month(_today);
	const d = d8_day(_today);
	
	const st = newState();
	setDate(st, y, m, d);

	const events = loadEventText(in_text);
	buildQry(st, qry);
	const result = executeQry(events, qryFilter(st));
	const errors = _cmdErrors.concat(collectErrors(events));
	return evaluateQry(st, result, events, errors);
})
