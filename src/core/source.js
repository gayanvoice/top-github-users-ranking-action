import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { simpleGit } from 'simple-git';

export function validateRepository(repository) {
    if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9_.-]*$/i.test(repository)) {
        throw new Error('Repository must be in owner/repository format.');
    }
    return repository;
}

export async function readJson(filename) {
    return JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
}

export async function openSource({ repository, branch = 'main', directory = '' }) {
    validateRepository(repository);
    let temporary;
    const sourceDirectory = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), 'github-ranking-source-'));
    if (!directory) temporary = sourceDirectory;

    try {
        if (temporary) {
            const git = simpleGit();
            await git.raw(['check-ref-format', '--branch', branch]);
            await git.clone(`https://github.com/${repository}.git`, sourceDirectory, [
                '--depth=1', '--filter=blob:none', '--sparse', '--single-branch', '--branch', branch
            ]);
            await simpleGit(sourceDirectory).raw(['sparse-checkout', 'set', 'cache']);
        }

        const git = simpleGit(sourceDirectory);
        const commit = await git.checkIsRepo() ? (await git.revparse(['HEAD'])).trim() : null;
        return {
            directory: sourceDirectory,
            metadata: { repository, branch, commit },
            close: () => temporary ? rm(temporary, { recursive: true, force: true }) : Promise.resolve()
        };
    } catch (error) {
        if (temporary) await rm(temporary, { recursive: true, force: true });
        throw error;
    }
}

function countryName(slug) {
    return slug.replace(/_/g, ' ').trim().split(/\s+/).map(word =>
        ['and', 'of', 'the'].includes(word) ? word : word[0].toUpperCase() + word.slice(1)
    ).join(' ');
}

export async function readCountries(directory, requested = []) {
    const names = new Map();
    try {
        const config = await readJson(join(directory, 'config.json'));
        if (!Array.isArray(config.locations)) throw new Error('Source config.json must contain a locations array.');
        for (const location of config.locations) {
            if (typeof location.country === 'string' && typeof location.geoName === 'string') {
                const slug = location.country.trim().toLowerCase().replace(/\s+/g, '_');
                const mapName = location.geoName.trim().toLowerCase().replace(/\s+/g, '_');
                // Map labels may be abbreviated or incorrect; country identity wins.
                names.set(slug, mapName === slug ? location.geoName : countryName(slug));
            }
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const entries = await readdir(join(directory, 'cache'), { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name).sort();
    if (!files.length) throw new Error('The source cache directory contains no country JSON files.');
    const selected = new Set(requested.map(country => country.trim().toLowerCase().replace(/\s+/g, '_')));
    for (const country of selected) {
        if (!files.includes(`${country}.json`)) throw new Error(`Country cache not found: ${country}`);
    }

    return Promise.all(files.filter(filename => !selected.size || selected.has(filename.slice(0, -5))).map(async filename => {
        const slug = filename.slice(0, -5);
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw new Error(`Invalid country filename: ${filename}`);
        const users = await readJson(join(directory, 'cache', filename));
        if (!Array.isArray(users)) throw new Error(`Country cache must be a user array: ${filename}`);
        return { slug, name: names.get(slug) || countryName(slug), users };
    }));
}
