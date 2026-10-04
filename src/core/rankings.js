import { mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';
import { readJson, validateRepository } from './source.js';
import { METRIC_LABELS, renderSvg, renderMarkdown, renderCountryIndex } from './render.js';

function number(value, field, login) {
    if (value === undefined || value === null) return 0;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${field} for ${login}.`);
    return value;
}

function normalizeUser(user) {
    const login = user?.login ?? user?.username;
    if (typeof login !== 'string' || !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(login)) {
        throw new Error(`Invalid GitHub username: ${String(login)}`);
    }
    let avatarUrl = `https://github.com/${login}.png?size=72`;
    if (typeof user.avatarUrl === 'string') {
        try {
            const url = new URL(user.avatarUrl);
            if (url.protocol === 'https:') avatarUrl = url.href;
        } catch { /* Use the GitHub avatar fallback. */ }
    }
    return {
        login,
        avatarUrl,
        publicContributions: number(user.publicContributions, 'public contributions', login),
        privateContributions: number(user.privateContributions, 'private contributions', login),
        followers: number(user.followers, 'followers', login)
    };
}

function total(user) {
    return user.publicContributions + user.privateContributions;
}

function usernameOrder(a, b) {
    const left = a.login.toLowerCase();
    const right = b.login.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
}

export function rankCountry(country, previous, metric = 'public_contributions', source = null) {
    if (!Object.hasOwn(METRIC_LABELS, metric)) throw new Error(`Unknown ranking metric: ${metric}`);
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(country.slug)) throw new Error('Invalid country slug.');
    if (typeof country.name !== 'string' || !country.name.trim()) throw new Error('Country name is required.');
    if (!Array.isArray(country.users)) throw new Error('Country users must be an array.');

    const score = user => metric === 'followers' ? user.followers : metric === 'total_contributions' ? total(user) : user.publicContributions;
    const compare = (a, b) => score(b) - score(a) || total(b) - total(a) ||
        b.publicContributions - a.publicContributions || b.followers - a.followers || usernameOrder(a, b);
    const current = new Map();
    for (const user of country.users.map(normalizeUser).sort(compare)) {
        if (!current.has(user.login.toLowerCase())) current.set(user.login.toLowerCase(), user);
    }
    const users = [...current.values()].map((user, index) => ({ ...user, rank: index + 1, status: 'ranked' }));
    const oldUsers = previous === null ? [] : Array.isArray(previous) ? previous : previous.users;
    if (!Array.isArray(oldUsers)) throw new Error(`Local cache for ${country.slug} must contain a users array.`);
    const missing = new Map();
    oldUsers.forEach((oldUser, index) => {
        const user = normalizeUser(oldUser);
        const key = user.login.toLowerCase();
        if (current.has(key) || missing.has(key)) return;
        const oldRank = oldUser.rank ?? oldUser.lastKnownRank ?? (Array.isArray(previous) ? index + 1 : null);
        missing.set(key, {
            ...user,
            rank: null,
            status: 'missing',
            lastKnownRank: Number.isSafeInteger(oldRank) && oldRank > 0 ? oldRank : null
        });
    });
    users.push(...[...missing.values()].sort((a, b) =>
        (a.lastKnownRank ?? Infinity) - (b.lastKnownRank ?? Infinity) || usernameOrder(a, b)
    ));

    return {
        schemaVersion: 1,
        country: country.slug,
        countryName: country.name,
        metric,
        source,
        currentUserCount: current.size,
        users
    };
}

export async function generateRankings(countries, {
    workspace = process.cwd(), metric = 'public_contributions', source = null,
    badgeRepository = '', badgeBranch = 'main', log = () => {}
} = {}) {
    if (!Object.hasOwn(METRIC_LABELS, metric)) throw new Error(`Unknown ranking metric: ${metric}`);
    if (!countries.length) throw new Error('No country caches selected.');
    if (badgeRepository) validateRepository(badgeRepository);
    const directory = resolve(workspace);
    const options = { badgeRepository, badgeBranch };
    const snapshots = [];
    const seen = new Set();

    // Validate every fresh and historical country before changing local output.
    for (const country of countries) {
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(country.slug)) throw new Error('Invalid country slug.');
        if (seen.has(country.slug)) throw new Error(`Duplicate country: ${country.slug}`);
        seen.add(country.slug);
        let previous = null;
        try {
            previous = await readJson(join(directory, 'cache', `${country.slug}.json`));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        snapshots.push(rankCountry(country, previous, metric, source));
    }

    // Keep country indexes complete during a filtered run.
    let existing = [];
    try {
        existing = await readdir(join(directory, 'cache'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const indexSnapshots = [...snapshots];
    for (const filename of existing.filter(name => name.endsWith('.json') && !seen.has(name.slice(0, -5))).sort()) {
        const cached = await readJson(join(directory, 'cache', filename));
        if (cached?.schemaVersion === 1) {
            if (cached.country !== filename.slice(0, -5) || !/^[a-z0-9][a-z0-9_-]*$/.test(cached.country) ||
                typeof cached.countryName !== 'string' || !Array.isArray(cached.users) ||
                !Number.isSafeInteger(cached.currentUserCount) || cached.currentUserCount < 0 ||
                cached.currentUserCount > cached.users.length) {
                throw new Error(`Invalid local country snapshot: ${filename}`);
            }
            cached.users.forEach(normalizeUser);
            indexSnapshots.push(cached);
        }
    }

    for (const folder of ['cache', 'svg', 'markdown']) {
        await mkdir(join(directory, folder), { recursive: true });
    }

    for (const snapshot of snapshots) {
        const svgDirectory = join(directory, 'svg', snapshot.country);
        await mkdir(svgDirectory, { recursive: true });
        for (let offset = 0; offset < snapshot.users.length; offset += 64) {
            await Promise.all(snapshot.users.slice(offset, offset + 64).map(user =>
                writeFile(join(svgDirectory, `${user.login.toLowerCase()}.svg`), renderSvg(snapshot, user))
            ));
        }
        await writeFile(join(directory, 'cache', `${snapshot.country}.json`), JSON.stringify(snapshot, null, 2) + '\n');
        log(`${snapshot.countryName}: ${snapshot.currentUserCount} ranked, ${snapshot.users.length - snapshot.currentUserCount} retained missing users`);
    }

    // Migrate existing country tables too, including during a filtered run.
    for (const snapshot of indexSnapshots) {
        await writeFile(join(directory, 'markdown', `${snapshot.country}.md`), renderMarkdown(snapshot, options));
    }
    await rm(join(directory, 'markdown', 'copy'), { recursive: true, force: true });

    await writeFile(join(directory, 'markdown', 'README.md'), renderCountryIndex(indexSnapshots));

    // Remove legacy generated HTML assets while preserving other documentation.
    for (const filename of [...indexSnapshots.map(snapshot => `${snapshot.country}.html`), 'index.html', 'styles.css', 'rankings.js']) {
        await rm(join(directory, 'docs', filename), { force: true });
    }
    try {
        await rmdir(join(directory, 'docs'));
    } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    }
    return {
        countries: snapshots.length,
        currentUsers: snapshots.reduce((count, snapshot) => count + snapshot.currentUserCount, 0),
        missingUsers: snapshots.reduce((count, snapshot) => count + snapshot.users.length - snapshot.currentUserCount, 0)
    };
}
