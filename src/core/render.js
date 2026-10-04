export const METRIC_LABELS = {
    public_contributions: 'public contributions',
    total_contributions: 'total contributions (public + private)',
    followers: 'followers'
};

const BADGE_ALT = 'gayanvoice/top-github-users';
const BADGE_LINK = `https://github.com/${BADGE_ALT}`;

function html(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function markdown(value) {
    return String(value).replace(/[\\`*_[\]<>|]/g, '\\$&').replace(/[\r\n]/g, ' ');
}

export function rankLabel(user, currentUserCount) {
    return user.status === 'missing' ? `> ${currentUserCount}` : String(user.rank);
}

export function badgeTitle(snapshot, user) {
    return `${snapshot.countryName} Rank ${rankLabel(user, snapshot.currentUserCount)}`;
}

export function renderSvg(snapshot, user) {
    const title = badgeTitle(snapshot, user);
    const width = Math.max(144, [...title].length * 8 + 28);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30" viewBox="0 0 ${width} 30" role="img" aria-label="${html(title)}"><title>${html(title)}</title><rect width="${width}" height="30" rx="5" fill="#0969da"/><text x="${width / 2}" y="20" text-anchor="middle" fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="12">${html(title)}</text></svg>\n`;
}

function localBadge(snapshot, user) {
    return `../svg/${snapshot.country}/${user.login.toLowerCase()}.svg`;
}

function absoluteBadge(snapshot, user, options) {
    return options.badgeRepository
        ? `https://raw.githubusercontent.com/${options.badgeRepository}/${encodeURIComponent(options.badgeBranch)}/svg/${snapshot.country}/${user.login.toLowerCase()}.svg`
        : localBadge(snapshot, user);
}

function userRankLink(snapshot, user, options) {
    return `${BADGE_LINK}/blob/${encodeURIComponent(options.badgeBranch ?? 'main')}/markdown/${snapshot.country}.md#${user.login.toLowerCase()}`;
}

export function badgeMarkdown(snapshot, user, options = {}) {
    return `[![${BADGE_ALT}](${absoluteBadge(snapshot, user, options)})](${userRankLink(snapshot, user, options)})`;
}

function introduction(snapshot) {
    const missing = snapshot.users.filter(user => user.status === 'missing').length;
    return `Ranked by ${METRIC_LABELS[snapshot.metric]}. Current list: **${snapshot.currentUserCount} users**. Retained missing users: **${missing}**.\n\nPreviously cached users absent from this snapshot display \`> ${snapshot.currentUserCount}\`.\n`;
}

export function renderMarkdown(snapshot, options = {}) {
    const rows = snapshot.users.map(user => `| <a name="${user.login.toLowerCase()}"></a>[@${user.login}](https://github.com/${user.login}) | <img src="${html(user.avatarUrl)}" alt="@${html(user.login)}" width="36" height="36"> | [![${BADGE_ALT}](${localBadge(snapshot, user)})](#${user.login.toLowerCase()}) | <details><summary>Copy</summary><pre>\`${badgeMarkdown(snapshot, user, options)}\`</pre></details> |`);
    return `# GitHub User Rankings: ${markdown(snapshot.countryName)}\n\n${introduction(snapshot)}\n| Username | Image | SVG | Copy snippet |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`;
}

export function renderCountryIndex(snapshots) {
    const countries = [...snapshots].sort((a, b) => a.country.localeCompare(b.country, 'en'));
    return '# Country rankings\n\n| Country | Current users | Retained missing users |\n| --- | ---: | ---: |\n' + countries.map(snapshot => `| [${markdown(snapshot.countryName)}](${snapshot.country}.md) | ${snapshot.currentUserCount} | ${snapshot.users.length - snapshot.currentUserCount} |`).join('\n') + '\n';
}
