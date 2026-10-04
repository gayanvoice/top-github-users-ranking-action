import { FLAG_NAMES, FLAG_SVGS } from '../assets/flag-icons.js';

function normalize(value) {
    return typeof value === 'string'
        ? value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')
        : '';
}

const COUNTRY_CODES = new Map(Object.entries(FLAG_NAMES).flatMap(([code, name]) => [
    [normalize(code), code], [normalize(name), code]
]));

const COUNTRY_ALIASES = new Map(Object.entries({
    congo: 'cg',
    congobrazzaville: 'cg',
    democraticrepublicofcongo: 'cd',
    drcongo: 'cd',
    drc: 'cd',
    congokinshasa: 'cd',
    czechia: 'cz',
    palestine: 'ps',
    palestinianterritories: 'ps',
    turkey: 'tr',
    unitedstates: 'us',
    usa: 'us',
    uk: 'gb',
    britain: 'gb',
    greatbritain: 'gb',
    unitedkingdomofgreatbritainandnorthernireland: 'gb',
    republicofkorea: 'kr',
    korearepublicof: 'kr',
    koreasouth: 'kr',
    democraticpeoplesrepublicofkorea: 'kp',
    koreademocraticpeoplesrepublicof: 'kp',
    koreanorth: 'kp',
    macedonia: 'mk',
    ivorycoast: 'ci',
    caboverde: 'cv',
    easttimor: 'tl',
    swaziland: 'sz',
    burma: 'mm',
    brunei: 'bn',
    vatican: 'va',
    vaticancity: 'va',
    russianfederation: 'ru',
    iranislamicrepublicof: 'ir',
    syrianarabrepublic: 'sy',
    unitedrepublicoftanzania: 'tz',
    tanzaniaunitedrepublicof: 'tz',
    laopeoplesdemocraticrepublic: 'la',
    vietnam: 'vn',
    moldovarepublicof: 'md',
    boliviaplurinationalstateof: 'bo',
    venezuelabolivarianrepublicof: 've',
    federatedstatesofmicronesia: 'fm',
    britishvirginislands: 'vg',
    usvirginislands: 'vi',
    unitedstatesvirginislands: 'vi'
}));

export function resolveCountryCode(country, countryName = '') {
    // The cache's country identity wins over a potentially incorrect display label.
    for (const value of [country, countryName]) {
        const key = normalize(value);
        const code = COUNTRY_ALIASES.get(key) ?? COUNTRY_CODES.get(key);
        if (code && code !== 'xx') return code;
    }
    return null;
}

const positionedFlags = new Map();

export function countryFlagSvg(country, countryName = '') {
    const code = resolveCountryCode(country, countryName);
    if (!code) return '';
    if (!positionedFlags.has(code)) {
        // Inline vector paths keep every user badge independent of external images.
        positionedFlags.set(code, FLAG_SVGS[code].replace('<svg ', '<svg x="8" y="6" width="24" height="18" aria-hidden="true" '));
    }
    return positionedFlags.get(code);
}
