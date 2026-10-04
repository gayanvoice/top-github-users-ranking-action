import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readCountries } from './core/source.js';
import { generateRankings, rankCountry } from './core/rankings.js';
import { renderSvg } from './core/render.js';

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
    assert.match(renderSvg(snapshot, missing), /fill="#0969da"/);
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
    const markdown = readFileSync(join(workspace, 'markdown/sri_lanka.md'), 'utf8');
    assert.match(markdown, /\| Username \| Image \| SVG \| Copy snippet \|/);
    assert.ok(markdown.includes('| <a name="old-user"></a>[@old-user]'));
    const snippet = '[![gayanvoice/top-github-users](https://raw.githubusercontent.com/test/rankings/main/svg/sri_lanka/old-user.svg)](https://github.com/gayanvoice/top-github-users/blob/main/markdown/sri_lanka.md#old-user)';
    assert.ok(markdown.includes(`| <details><summary>Copy</summary><pre>\`${snippet}\`</pre></details> |`));
    assert.ok(markdown.includes('[![gayanvoice/top-github-users](../svg/sri_lanka/old-user.svg)](#old-user)'));
    const israel = readFileSync(join(workspace, 'markdown/israel.md'), 'utf8');
    assert.ok(israel.includes('<a name="arthurzam"></a>[@ArthurZam](https://github.com/ArthurZam)'));
    assert.ok(israel.includes('https://github.com/gayanvoice/top-github-users/blob/main/markdown/israel.md#arthurzam'));
    assert.ok(israel.includes('[![gayanvoice/top-github-users](../svg/israel/arthurzam.svg)](#arthurzam)'));
    assert.doesNotMatch(markdown, /copy\//);
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
    await generateRankings([countries[0]], { ...options, badgeBranch: 'feature/rankings' });
    assert.match(readFileSync(join(workspace, 'markdown/README.md'), 'utf8'), /Israel/);
    const migrated = readFileSync(join(workspace, 'markdown/israel.md'), 'utf8');
    assert.match(migrated, /\| Username \| Image \| SVG \| Copy snippet \|/);
    assert.ok(migrated.includes('<a name="arthurzam"></a>'));
    assert.ok(migrated.includes('https://github.com/gayanvoice/top-github-users/blob/feature%2Frankings/markdown/israel.md#arthurzam'));
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
