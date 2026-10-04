import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readCountries } from './core/source.js';
import { generateRankings, rankCountry } from './core/rankings.js';
import { renderSvg } from './core/render.js';
import { resolveCountryCode } from './core/flags.js';
import { FLAG_NAMES } from './assets/flag-icons.js';
import { FLAG_PALETTES } from './assets/flag-palettes.js';
import { countryBadgeTheme } from './core/badge-theme.js';

function temporary(t) {
    const directory = mkdtempSync(join(tmpdir(), 'country-rankings-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}

function user(login, publicContributions = 0, privateContributions = 0, followers = 0) {
    return { login, publicContributions, privateContributions, followers };
}

function country(users, slug = 'sri_lanka', name = 'Sri Lanka') {
    return { slug, name, users };
}

test('ranks every unique user by public contributions, with deterministic ties', () => {
    const snapshot = rankCountry(country([
        user('bob', 20, 0, 100), user('carol', 50, 0, 2), user('alice', 50, 5, 1),
        user('ALICE', 1, 0, 1000), user('dave', 20, 0, 100)
    ]), null);
    assert.deepEqual(snapshot.users.map(row => [row.rank, row.login]), [[1, 'alice'], [2, 'carol'], [3, 'bob'], [4, 'dave']]);
    assert.equal(snapshot.currentUserCount, 4);
});

test('supports total contributions and followers as the ranking metric', () => {
    const input = country([user('alice', 100, 0, 1), user('bob', 20, 200, 10)]);
    assert.equal(rankCountry(input, null, 'total_contributions').users[0].login, 'bob');
    assert.equal(rankCountry(input, null, 'followers').users[0].login, 'bob');
    assert.throws(() => rankCountry(input, null, 'unknown'), /Unknown ranking metric/);
});

test('the previously ranked 950 user displays greater than the current count of 1000', () => {
    const previous = { users: [{ ...user('missing-user'), rank: 950, status: 'ranked' }] };
    const current = Array.from({ length: 1000 }, (_, index) => user(`user${index + 1}`, 1000 - index));
    const snapshot = rankCountry(country(current), previous);
    const missing = snapshot.users.find(row => row.login === 'missing-user');
    assert.equal(snapshot.currentUserCount, 1000);
    assert.equal(missing.rank, null);
    assert.equal(missing.lastKnownRank, 950);
    assert.match(renderSvg(snapshot, missing), /Sri Lanka Rank &gt; 1000/);
    assert.match(renderSvg(snapshot, missing), /fill="url\(#badge-background\)"/);
});

test('retains missing users across runs, updates their cutoff and restores returning users', () => {
    const previous = { users: [{ ...user('returning-user'), rank: 950 }] };
    const first = rankCountry(country([user('alice', 100), user('bob', 50)]), previous);
    const second = rankCountry(country([user('alice', 100)]), first);
    const missing = second.users.find(row => row.login === 'returning-user');
    assert.equal(missing.lastKnownRank, 950);
    assert.match(renderSvg(second, missing), /Rank &gt; 1/);
    const third = rankCountry(country([user('returning-user', 200), user('alice', 100)]), second);
    assert.equal(third.users[0].login, 'returning-user');
    assert.equal(third.users[0].rank, 1);
    assert.equal(third.users[0].status, 'ranked');
    assert.equal(third.users.filter(row => row.login === 'returning-user').length, 1);
});

test('supports empty current lists and legacy local user arrays', () => {
    const snapshot = rankCountry(country([]), [user('old-user')]);
    assert.equal(snapshot.currentUserCount, 0);
    assert.equal(snapshot.users[0].lastKnownRank, 1);
    assert.match(renderSvg(snapshot, snapshot.users[0]), /Rank &gt; 0/);
});

test('resolves country slugs, names, codes and aliases to the correct flags', () => {
    for (const [code, name] of Object.entries(FLAG_NAMES)) {
        if (code === 'xx') {
            assert.equal(resolveCountryCode(code), null);
            continue;
        }
        assert.equal(resolveCountryCode(code), code, code);
        assert.equal(resolveCountryCode('', name), code, name);
    }
    for (const [name, code] of [
        ['sri_lanka', 'lk'], ['united_states', 'us'], ['united_kingdom', 'gb'],
        ['czechia', 'cz'], ['turkey', 'tr'], ['palestine', 'ps'], ['congo', 'cg'],
        ['democratic_republic_of_congo', 'cd'], ['ivory_coast', 'ci'],
        ['south-korea', 'kr'], ['north_korea', 'kp'], ['new_zealand', 'nz']
    ]) {
        assert.equal(resolveCountryCode(name), code, name);
    }
    assert.equal(resolveCountryCode('zimbabwe', 'Zambia'), 'zw');
    assert.equal(resolveCountryCode('unknown', 'Sri Lanka'), 'lk');
    assert.equal(resolveCountryCode('unknown'), null);
});

test('embeds country-specific vector flags for both ranked and retained users', () => {
    for (const [slug, name, code] of [
        ['sri_lanka', 'Sri Lanka', 'lk'], ['algeria', 'Algeria', 'dz'],
        ['united_states', 'United States', 'us'], ['japan', 'Japan', 'jp']
    ]) {
        const snapshot = rankCountry(country([user('alice', 100)], slug, name), [user('missing-user')]);
        for (const row of snapshot.users) {
            const svg = renderSvg(snapshot, row);
            assert.ok(svg.includes(`id="flag-icons-${code}"`), slug);
            assert.match(svg, /x="8" y="6" width="24" height="18"/);
            const theme = countryBadgeTheme(slug, name);
            assert.ok(svg.includes(`stop-color="${theme.start}"`));
            assert.ok(svg.includes(`stop-color="${theme.end}"`));
            assert.doesNotMatch(svg, /<image\b|<script\b|(?:xlink:)?href="https?:/);
        }
        assert.match(renderSvg(snapshot, snapshot.users[1]), /Rank &gt; 1/);
    }
    const unknown = rankCountry(country([user('alice')], 'unknown', 'Unknown'), null);
    assert.match(renderSvg(unknown, unknown.users[0]), /Unknown Rank 1/);
    assert.doesNotMatch(renderSvg(unknown, unknown.users[0]), /flag-icons-/);
});

test('every flag palette produces readable text throughout its badge gradient', () => {
    const luminance = color => {
        const channels = color.match(/[a-f0-9]{2}/gi).map(hex => {
            const value = Number.parseInt(hex, 16) / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const code of Object.keys(FLAG_NAMES).filter(code => code !== 'xx')) {
        assert.ok(FLAG_PALETTES[code], `Missing palette: ${code}`);
        const theme = countryBadgeTheme(code);
        const from = theme.start.match(/[a-f0-9]{2}/gi).map(hex => Number.parseInt(hex, 16));
        const to = theme.end.match(/[a-f0-9]{2}/gi).map(hex => Number.parseInt(hex, 16));
        const text = luminance(theme.foreground);
        for (let step = 0; step <= 100; step++) {
            const color = '#' + from.map((value, index) => Math.round(value + (to[index] - value) * step / 100)
                .toString(16).padStart(2, '0')).join('');
            const background = luminance(color);
            const ratio = (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
            assert.ok(ratio >= 4.5, `${code}: text contrast ${ratio.toFixed(2)} at ${step}%`);
        }
    }
    assert.notDeepEqual(countryBadgeTheme('sri_lanka'), countryBadgeTheme('algeria'));
    assert.deepEqual(countryBadgeTheme('zimbabwe', 'Zambia'), countryBadgeTheme('zw'));
});

test('reads every country cache, including countries absent from source configuration', async t => {
    const source = temporary(t);
    mkdirSync(join(source, 'cache'));
    writeFileSync(join(source, 'config.json'), '\uFEFF' + JSON.stringify({ locations: [
        { country: 'sri lanka', geoName: 'Sri Lanka' }, { country: 'zimbabwe', geoName: 'Zambia' }
    ] }));
    writeFileSync(join(source, 'cache/sri_lanka.json'), '\uFEFF' + JSON.stringify([user('alice', 100)]));
    writeFileSync(join(source, 'cache/lebanon.json'), JSON.stringify([user('bob', 50)]));
    writeFileSync(join(source, 'cache/zimbabwe.json'), JSON.stringify([user('carol', 10)]));
    assert.deepEqual((await readCountries(source)).map(row => [row.slug, row.name]), [['lebanon', 'Lebanon'], ['sri_lanka', 'Sri Lanka'], ['zimbabwe', 'Zimbabwe']]);
    assert.equal((await readCountries(source, ['Sri Lanka'])).length, 1);
    await assert.rejects(readCountries(source, ['unknown']), /Country cache not found/);
});

test('generates Markdown rankings with user anchors and removes legacy outputs', async t => {
    const workspace = temporary(t);
    mkdirSync(join(workspace, 'cache'));
    mkdirSync(join(workspace, 'markdown/copy'), { recursive: true });
    writeFileSync(join(workspace, 'markdown/copy/sri_lanka.md'), 'Old copy page');
    mkdirSync(join(workspace, 'docs'));
    for (const filename of ['sri_lanka.html', 'israel.html', 'index.html', 'styles.css', 'rankings.js']) {
        writeFileSync(join(workspace, 'docs', filename), 'Old generated HTML asset');
    }
    writeFileSync(join(workspace, 'cache/sri_lanka.json'), JSON.stringify({ users: [{ ...user('old-user'), rank: 950 }] }));
    const countries = [country([user('alice', 100), user('bob', 50)]), country([user('ArthurZam', 10)], 'israel', 'Israel')];
    const options = { workspace, badgeRepository: 'test/rankings', badgeBranch: 'main' };
    const summary = await generateRankings(countries, options);
    assert.deepEqual(summary, { countries: 2, currentUsers: 3, missingUsers: 1 });
    const svg = readFileSync(join(workspace, 'svg/sri_lanka/old-user.svg'), 'utf8');
    assert.match(svg, /Sri Lanka Rank &gt; 2/);
    assert.match(svg, /id="flag-icons-lk"/);
    const markdown = readFileSync(join(workspace, 'markdown/sri_lanka.md'), 'utf8');
    assert.match(markdown, /<table width="100%">/);
    assert.match(markdown, /<th[^>]*>Index<\/th>\s*<th[^>]*>Image<\/th>\s*<th[^>]*>Username<\/th>\s*<th[^>]*>SVG<\/th>\s*<th[^>]*>Copy snippet<\/th>/);
    assert.ok(markdown.includes('<td align="right">3</td>'));
    assert.ok(markdown.includes('<a name="old-user"></a><a href="https://github.com/old-user">@old-user</a>'));
    const snippet = '[![gayanvoice/top-github-users/sri_lanka](https://raw.githubusercontent.com/test/rankings/main/svg/sri_lanka/old-user.svg)](https://github.com/gayanvoice/top-github-users/blob/main/markdown/public_contributions/sri_lanka.md#old-user)';
    assert.ok(markdown.replaceAll('<wbr>', '').includes(`<details><summary>Copy</summary><code>${snippet}</code></details>`));
    assert.ok(markdown.includes('<a href="#old-user"><img src="../svg/sri_lanka/old-user.svg" alt="gayanvoice/top-github-users/sri_lanka" height="30"></a>'));
    assert.doesNotMatch(markdown, /<details[^>]*\bopen\b/);
    const israel = readFileSync(join(workspace, 'markdown/israel.md'), 'utf8');
    assert.ok(israel.includes('<a name="arthurzam"></a><a href="https://github.com/ArthurZam">@ArthurZam</a>'));
    assert.ok(israel.replaceAll('<wbr>', '').includes('https://github.com/gayanvoice/top-github-users/blob/main/markdown/public_contributions/israel.md#arthurzam'));
    assert.ok(israel.includes('<a href="#arthurzam"><img src="../svg/israel/arthurzam.svg" alt="gayanvoice/top-github-users/israel" height="30"></a>'));
    assert.doesNotMatch(markdown, /copy\//);
    const readme = readFileSync(join(workspace, 'README.md'), 'utf8');
    assert.match(readme, /^# GitHub User Rankings/);
    assert.ok(readme.includes('| 2 | 3 | 1 | 4 |'));
    assert.ok(readme.includes('| 1 | [Israel](markdown/israel.md) | 1 | 0 | 1 | public contributions |'));
    assert.ok(readme.includes('| 2 | [Sri Lanka](markdown/sri_lanka.md) | 2 | 1 | 3 | public contributions |'));
    assert.ok(readme.includes('| | **Total** | **3** | **1** | **4** | |'));
    const countryIndex = readFileSync(join(workspace, 'markdown/README.md'), 'utf8');
    assert.ok(countryIndex.includes('[Israel](israel.md)'));
    assert.ok(countryIndex.includes('[Sri Lanka](sri_lanka.md)'));
    assert.equal(existsSync(join(workspace, 'markdown/copy')), false);
    assert.equal(existsSync(join(workspace, 'docs')), false);
    const cacheBefore = readFileSync(join(workspace, 'cache/sri_lanka.json'), 'utf8');
    await generateRankings(countries, options);
    assert.equal(readFileSync(join(workspace, 'cache/sri_lanka.json'), 'utf8'), cacheBefore);
    assert.equal(existsSync(join(workspace, 'docs')), false);
    const unselectedCache = readFileSync(join(workspace, 'cache/israel.json'), 'utf8');
    mkdirSync(join(workspace, 'markdown/copy'));
    writeFileSync(join(workspace, 'markdown/copy/israel.md'), 'Old copy page');
    writeFileSync(join(workspace, 'markdown/israel.md'), '[Copy SVG](copy/israel.md#arthurzam)');
    mkdirSync(join(workspace, 'docs'));
    writeFileSync(join(workspace, 'docs/israel.html'), 'Old generated country page');
    writeFileSync(join(workspace, 'docs/notes.md'), 'Unrelated documentation');
    await generateRankings([countries[0]], { ...options, badgeBranch: 'feature/rankings', metric: 'followers' });
    assert.match(readFileSync(join(workspace, 'markdown/README.md'), 'utf8'), /Israel/);
    const filteredReadme = readFileSync(join(workspace, 'README.md'), 'utf8');
    assert.ok(filteredReadme.includes('| 2 | 3 | 1 | 4 |'));
    assert.ok(filteredReadme.includes('| 1 | [Israel](markdown/israel.md) | 1 | 0 | 1 | public contributions |'));
    assert.ok(filteredReadme.includes('| 2 | [Sri Lanka](markdown/sri_lanka.md) | 2 | 1 | 3 | followers |'));
    const migrated = readFileSync(join(workspace, 'markdown/israel.md'), 'utf8');
    assert.match(migrated, /<th[^>]*>Index<\/th>\s*<th[^>]*>Image<\/th>\s*<th[^>]*>Username<\/th>\s*<th[^>]*>SVG<\/th>\s*<th[^>]*>Copy snippet<\/th>/);
    assert.ok(migrated.includes('<a name="arthurzam"></a>'));
    assert.ok(migrated.replaceAll('<wbr>', '').includes('https://github.com/gayanvoice/top-github-users/blob/feature%2Frankings/markdown/public_contributions/israel.md#arthurzam'));
    assert.equal(readFileSync(join(workspace, 'cache/israel.json'), 'utf8'), unselectedCache);
    assert.equal(existsSync(join(workspace, 'markdown/copy')), false);
    assert.equal(existsSync(join(workspace, 'docs/israel.html')), false);
    assert.equal(readFileSync(join(workspace, 'docs/notes.md'), 'utf8'), 'Unrelated documentation');
});

test('invalid fresh or historical data fails before replacing any local cache', async t => {
    const workspace = temporary(t);
    mkdirSync(join(workspace, 'cache'));
    const oldFile = join(workspace, 'cache/sri_lanka.json');
    const old = JSON.stringify({ users: [{ ...user('old-user'), rank: 950 }] });
    writeFileSync(oldFile, old);
    await assert.rejects(generateRankings([
        country([user('alice', 100)]), country([user('../unsafe')], 'lebanon', 'Lebanon')
    ], { workspace }), /Invalid GitHub username/);
    assert.equal(readFileSync(oldFile, 'utf8'), old);
    assert.equal(existsSync(join(workspace, 'svg')), false);
    writeFileSync(oldFile, '{"unexpected":true}');
    await assert.rejects(generateRankings([country([user('alice', 100)])], { workspace }), /Local cache.*users array/);
    assert.equal(readFileSync(oldFile, 'utf8'), '{"unexpected":true}');
});

test('escapes country text in SVG markup and rejects unsafe country paths', () => {
    const snapshot = rankCountry(country([user('alice')], 'example', '<script>alert("x")</script>'), null);
    assert.doesNotMatch(renderSvg(snapshot, snapshot.users[0]), /<script>/);
    assert.match(renderSvg(snapshot, snapshot.users[0]), /&lt;script&gt;/);
    assert.throws(() => rankCountry(country([], '../unsafe'), null), /Invalid country slug/);
});
