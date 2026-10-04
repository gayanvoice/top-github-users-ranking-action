import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { test } from 'node:test';
import createGit from './core/git.js';

function git(directory, ...args) {
    return execFileSync('git', args, {
        cwd: directory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function fixture(t, withRemote = false) {
    const root = mkdtempSync(join(tmpdir(), 'git-commit-action-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const directory = join(root, 'repository');
    mkdirSync(directory);
    git(directory, 'init', '--initial-branch=main');
    git(directory, 'config', 'user.name', 'Test User');
    git(directory, 'config', 'user.email', 'test@example.com');
    git(directory, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(directory, '.gitignore'), '.env\n');
    writeFileSync(join(directory, 'tracked.txt'), 'initial\n');
    writeFileSync(join(directory, 'obsolete.txt'), 'delete me\n');
    git(directory, 'add', '--all');
    git(directory, 'commit', '-m', 'Initial commit');

    const remote = join(root, 'remote.git');
    if (withRemote) {
        git(root, 'init', '--bare', '--initial-branch=main', remote);
        git(directory, 'remote', 'add', 'origin', remote);
        git(directory, 'push', '--set-upstream', 'origin', 'main');
    }

    return { root, directory, remote, operations: createGit(directory) };
}

function sourceFixture(root) {
    const source = join(root, 'source');
    mkdirSync(join(source, 'cache'), { recursive: true });
    writeFileSync(join(source, 'config.json'), JSON.stringify({ locations: [{ country: 'sri lanka', geoName: 'Sri Lanka' }] }));
    writeFileSync(join(source, 'cache/sri_lanka.json'), JSON.stringify([
        { login: 'alice', publicContributions: 100, privateContributions: 20, followers: 1 },
        { login: 'bob', publicContributions: 50, privateContributions: 0, followers: 100 }
    ]));
    return source;
}

test('commits additions, modifications, dotfiles and deletions while respecting ignored files', async t => {
    const { directory, operations } = fixture(t);
    writeFileSync(join(directory, 'tracked.txt'), 'updated\n');
    writeFileSync(join(directory, 'new.txt'), 'new\n');
    writeFileSync(join(directory, '.hidden-file'), 'hidden\n');
    writeFileSync(join(directory, '.env'), 'IGNORED=true\n');
    rmSync(join(directory, 'obsolete.txt'));

    assert.ok(await operations.commit('Commit Bot', 'bot@example.com', 'Update files'));
    assert.equal(git(directory, 'log', '-1', '--format=%s|%an|%ae'), 'Update files|Commit Bot|bot@example.com');
    const files = git(directory, 'show', '--format=', '--name-status');
    assert.match(files, /A\s+new\.txt/);
    assert.match(files, /M\s+tracked\.txt/);
    assert.match(files, /A\s+\.hidden-file/);
    assert.match(files, /D\s+obsolete\.txt/);
    assert.doesNotMatch(git(directory, 'ls-files'), /\.env/);
    assert.equal(git(directory, 'status', '--porcelain'), '');
});

test('skips an empty commit', async t => {
    const { directory, operations } = fixture(t);
    const before = git(directory, 'rev-parse', 'HEAD');
    assert.equal(await operations.commit('Commit Bot', 'bot@example.com', 'No changes'), null);
    assert.equal(git(directory, 'rev-parse', 'HEAD'), before);
});

test('pushes the current main branch', async t => {
    const { directory, remote, operations } = fixture(t, true);
    writeFileSync(join(directory, 'new.txt'), 'new\n');
    await operations.commit('Commit Bot', 'bot@example.com', 'Commit on main');
    await operations.push();
    assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), git(directory, 'rev-parse', 'HEAD'));
});

test('pulls remote updates with a fast-forward', async t => {
    const { root, directory, remote, operations } = fixture(t, true);
    const other = join(root, 'other');
    git(root, 'clone', remote, other);
    git(other, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(other, 'remote.txt'), 'remote update\n');
    await createGit(other).commit('Other Bot', 'other@example.com', 'Remote update');
    git(other, 'push', 'origin', 'main');

    await operations.pull();
    assert.equal(git(directory, 'rev-parse', 'HEAD'), git(other, 'rev-parse', 'HEAD'));
});

test('requires an explicit branch for detached HEAD and pushes the current commit', async t => {
    const { directory, remote, operations } = fixture(t, true);
    git(directory, 'checkout', '--detach');
    writeFileSync(join(directory, 'new.txt'), 'detached change\n');
    await operations.commit('Commit Bot', 'bot@example.com', 'Detached commit');
    await assert.rejects(operations.push(), /branch input.*detached HEAD/);
    await operations.push('main');
    assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), git(directory, 'rev-parse', 'HEAD'));
});

test('propagates a failed push', async t => {
    const { operations } = fixture(t);
    await assert.rejects(operations.push(), /origin/);
});

for (const entry of ['index.js', '../dist/index.cjs']) {
    const script = fileURLToPath(new URL(entry, import.meta.url));

    test(`${entry} commits and pushes through the action inputs`, t => {
        const { root, directory, remote } = fixture(t, true);
        const source = sourceFixture(root);
        const standalone = entry.endsWith('.cjs') ? join(root, 'action.cjs') : script;
        if (standalone !== script) copyFileSync(script, standalone);
        writeFileSync(join(directory, 'generated.txt'), 'generated\n');
        const result = spawnSync(process.execPath, [standalone], {
            cwd: root,
            encoding: 'utf8',
            env: {
                ...process.env,
                INPUT_WORKING_DIRECTORY: directory,
                INPUT_SOURCE_DIRECTORY: source,
                INPUT_SOURCE_REPOSITORY: 'gayanvoice/top-github-users',
                INPUT_SOURCE_BRANCH: 'main',
                INPUT_BADGE_REPOSITORY: 'test/rankings',
                INPUT_BADGE_BRANCH: 'main',
                INPUT_METRIC: 'public_contributions',
                INPUT_COUNTRIES: '',
                INPUT_COMMIT: 'true',
                INPUT_BRANCH: '',
                INPUT_PULL: 'false',
                INPUT_PUSH: 'true',
                INPUT_COMMIT_MESSAGE: 'Action commit',
                INPUT_USER_NAME: 'Action Bot',
                INPUT_USER_EMAIL: 'action@example.com'
            }
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /Created commit/);
        assert.equal(git(directory, 'log', '-1', '--format=%s'), 'Action commit');
        assert.match(git(directory, 'show', '--format=', '--name-only'), /svg\/sri_lanka\/alice.svg/);
        assert.match(readFileSync(join(directory, 'svg/sri_lanka/alice.svg'), 'utf8'), /Sri Lanka Rank 1/);
        assert.match(readFileSync(join(directory, 'markdown/sri_lanka.md'), 'utf8'), /Username \| Image \| SVG \| Copy snippet/);
        assert.equal(JSON.parse(readFileSync(join(directory, 'cache/sri_lanka.json'), 'utf8')).currentUserCount, 2);
        assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), git(directory, 'rev-parse', 'HEAD'));
    });

    test(`${entry} exits with failure for an invalid repository`, t => {
        const { root } = fixture(t);
        const source = sourceFixture(root);
        const result = spawnSync(process.execPath, [script], {
            cwd: root,
            encoding: 'utf8',
            env: {
                ...process.env, INPUT_WORKING_DIRECTORY: root, INPUT_PULL: 'false', INPUT_COMMIT: 'true',
                INPUT_SOURCE_DIRECTORY: source, INPUT_METRIC: 'public_contributions', INPUT_COUNTRIES: '', INPUT_BADGE_REPOSITORY: ''
            }
        });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stdout, /::error::.*not a git repository/);
    });
}
