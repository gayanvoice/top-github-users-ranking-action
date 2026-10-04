import * as core from '@actions/core';
import createGit from './core/git.js';
import { openSource, readCountries } from './core/source.js';
import { generateRankings } from './core/rankings.js';

function getBooleanInput(name, defaultValue) {
    return core.getInput(name) ? core.getBooleanInput(name) : defaultValue;
}

async function run() {
    const directory = core.getInput('working_directory') || '.';
    const git = createGit(directory);
    const branch = core.getInput('branch');
    const pull = getBooleanInput('pull', false);
    const push = getBooleanInput('push', true);
    const shouldCommit = getBooleanInput('commit', true);

    if (pull) {
        core.info('Git Pull');
        await git.pull(branch);
    }

    core.info('Reading country caches');
    const source = await openSource({
        repository: core.getInput('source_repository') || 'gayanvoice/top-github-users',
        branch: core.getInput('source_branch') || 'main',
        directory: core.getInput('source_directory')
    });
    try {
        const selected = core.getInput('countries').split(',').map(value => value.trim()).filter(Boolean);
        const countries = await readCountries(source.directory, selected);
        const result = await generateRankings(countries, {
            workspace: directory,
            metric: core.getInput('metric') || 'public_contributions',
            source: source.metadata,
            badgeRepository: core.getInput('badge_repository') || process.env.GITHUB_REPOSITORY || '',
            badgeBranch: core.getInput('badge_branch') || branch || process.env.GITHUB_REF_NAME || 'main',
            log: core.info
        });
        core.info(`Generated ${result.countries} countries, ${result.currentUsers} current users and ${result.missingUsers} retained missing users.`);
        core.setOutput('countries', result.countries);
        core.setOutput('current_users', result.currentUsers);
        core.setOutput('missing_users', result.missingUsers);
    } finally {
        await source.close();
    }

    if (!shouldCommit) {
        core.info('Generation complete; commit is disabled.');
        return;
    }

    core.info('Git Commit');
    const commit = await git.commit(
        core.getInput('user_name') || 'github-actions[bot]',
        core.getInput('user_email') || '41898282+github-actions[bot]@users.noreply.github.com',
        core.getInput('commit_message') || 'Update GitHub user rankings'
    );

    if (!commit) {
        core.info('No changes to commit.');
        return;
    }

    core.info(`Created commit ${commit}`);

    if (push) {
        core.info('Git Push');
        await git.push(branch);
    }
}

run().catch(error => {
    core.setFailed(error instanceof Error ? error.message : String(error));
});
