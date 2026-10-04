import { simpleGit } from 'simple-git';

export default function createGit(directory = process.cwd()) {
    const git = simpleGit({ baseDir: directory });

    async function getBranch(branch) {
        const target = branch || (await git.raw(['branch', '--show-current'])).trim();

        if (!target || target === 'HEAD') {
            throw new Error('Set the branch input when using a detached HEAD.');
        }

        await git.raw(['check-ref-format', '--branch', target]);
        return target;
    }

    return {
        async pull(branch) {
            await git.pull('origin', await getBranch(branch), ['--ff-only']);
        },

        async commit(username, email, message) {
            await git.add('--all');

            if (!(await git.diff(['--cached', '--name-only'])).trim()) {
                return null;
            }

            await git.addConfig('user.name', username);
            await git.addConfig('user.email', email);
            const result = await git.commit(message);
            return result.commit;
        },

        async push(branch) {
            const target = await getBranch(branch);
            await git.push('origin', `HEAD:refs/heads/${target}`);
        }
    };
}
