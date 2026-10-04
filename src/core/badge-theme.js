import { FLAG_PALETTES } from '../assets/flag-palettes.js';
import { resolveCountryCode } from './flags.js';

function rgb(color) {
    return [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
}

function blend(left, right, weight) {
    const first = rgb(left);
    const second = rgb(right);
    return '#' + first.map((value, index) => Math.round(value * (1 - weight) + second[index] * weight)
        .toString(16).padStart(2, '0')).join('');
}

function luminance(color) {
    const values = rgb(color).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function minimumContrast(start, end, foreground) {
    const text = luminance(foreground);
    let minimum = Infinity;
    for (let step = 0; step <= 16; step++) {
        const background = luminance(blend(start, end, step / 16));
        minimum = Math.min(minimum, (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05));
    }
    return minimum;
}

const themes = new Map();
const FALLBACK = Object.freeze({ start: '#374151', end: '#4b5563', foreground: '#ffffff', accent: '#9ca3af' });

export function countryBadgeTheme(country, countryName = '') {
    const code = resolveCountryCode(country, countryName);
    const palette = FLAG_PALETTES[code];
    if (!palette) return FALLBACK;
    if (!themes.has(code)) {
        let start = palette.primary;
        let end = blend(palette.primary, palette.secondary, 0.22);
        const foreground = luminance(start) > 0.45 ? '#111827' : '#ffffff';
        const adjustment = foreground === '#ffffff' ? '#000000' : '#ffffff';
        // Preserve the flag's hues while making small tonal changes for readable text.
        for (let step = 0; step < 32 && minimumContrast(start, end, foreground) < 4.6; step++) {
            start = blend(start, adjustment, 0.04);
            end = blend(end, adjustment, 0.04);
        }
        themes.set(code, Object.freeze({ start, end, foreground, accent: palette.secondary }));
    }
    return themes.get(code);
}
