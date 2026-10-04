import { countryFlagSvg } from './flags.js';
import { countryBadgeTheme } from './badge-theme.js';

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
    const flag = countryFlagSvg(snapshot.country, snapshot.countryName);
    const flagWidth = flag ? 40 : 0;
    const width = Math.max(144, [...title].length * 8 + 28) + flagWidth;
    const theme = countryBadgeTheme(snapshot.country, snapshot.countryName);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30" viewBox="0 0 ${width} 30" role="img" aria-label="${html(title)}"><title>${html(title)}</title><defs><linearGradient id="badge-background" x1="0" y1="0" x2="100%" y2="100%"><stop offset="0" stop-color="${theme.start}"/><stop offset="1" stop-color="${theme.end}"/></linearGradient></defs><rect width="${width}" height="30" rx="5" fill="url(#badge-background)"/><rect x=".5" y=".5" width="${width - 1}" height="29" rx="4.5" fill="none" stroke="${theme.accent}" stroke-opacity=".55"/>${flag}<text x="${(width + flagWidth) / 2}" y="20" text-anchor="middle" fill="${theme.foreground}" font-family="Verdana,DejaVu Sans,sans-serif" font-size="12">${html(title)}</text></svg>\n`;
}

function localBadge(snapshot, user) {
    return `../svg/${snapshot.country}/${user.login.toLowerCase()}.svg`;
}

function absoluteBadge(snapshot, user, options) {
    const repository = options.badgeRepository || BADGE_ALT;
    const branch = options.badgeBranch || 'main';
    return `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(branch)}/svg/${snapshot.country}/${user.login.toLowerCase()}.svg`;
}

function userRankLink(snapshot, user, options) {
    const metric = snapshot.metric ?? 'public_contributions';
    return `${BADGE_LINK}/blob/${encodeURIComponent(options.badgeBranch ?? 'main')}/markdown/${metric}/${snapshot.country}.md#${user.login.toLowerCase()}`;
}

export function badgeMarkdown(snapshot, user, options = {}) {
    return `[![${BADGE_ALT}/${snapshot.country}](${absoluteBadge(snapshot, user, options)})](${userRankLink(snapshot, user, options)})`;
}

function introduction(snapshot) {
    const missing = snapshot.users.filter(user => user.status === 'missing').length;
    return `Ranked by ${METRIC_LABELS[snapshot.metric]}. Current list: **${snapshot.currentUserCount} users**. Retained missing users: **${missing}**.\n\nPreviously cached users absent from this snapshot display \`> ${snapshot.currentUserCount}\`.\n`;
}

export function renderMarkdown(snapshot, options = {}) {
    const rows = snapshot.users.map((user, index) => {
        const login = html(user.login);
        const anchor = html(user.login.toLowerCase());
        // Soft wrap opportunities keep expanded snippets narrow without changing copied text.
        const snippet = badgeMarkdown(snapshot, user, options).match(/.{1,12}/gu).map(html).join('<wbr>');
        return `  <tr>
    <td align="right">${index + 1}</td>
    <td align="center"><img src="${html(user.avatarUrl)}" alt="@${login}" width="36" height="36"></td>
    <td><a name="${anchor}"></a><a href="https://github.com/${login}">@${login}</a></td>
    <td align="center"><a href="#${anchor}"><img src="${html(localBadge(snapshot, user))}" alt="${BADGE_ALT}/${html(snapshot.country)}" height="30"></a></td>
    <td><details><summary>Copy</summary><code>${snippet}</code></details></td>
  </tr>`;
    });
    // HTML table cells support native details/summary blocks in GitHub Markdown.
    return `# GitHub User Rankings: ${markdown(snapshot.countryName)}\n\n${introduction(snapshot)}
<table width="100%">
  <thead>
    <tr>
      <th width="5%">Index</th>
      <th width="8%">Image</th>
      <th width="27%">Username</th>
      <th width="45%">SVG</th>
      <th width="15%">Copy snippet</th>
    </tr>
  </thead>
  <tbody>
${rows.join('\n')}
  </tbody>
</table>
`;
}

export function renderCountryIndex(snapshots, { title = 'Country rankings', linkPrefix = '' } = {}) {
    const countries = [...snapshots].sort((a, b) => a.countryName.localeCompare(b.countryName, 'en') || a.country.localeCompare(b.country, 'en'));
    const currentUsers = countries.reduce((count, snapshot) => count + snapshot.currentUserCount, 0);
    const totalUsers = countries.reduce((count, snapshot) => count + snapshot.users.length, 0);
    const retainedUsers = totalUsers - currentUsers;
    const rows = countries.map((snapshot, index) => `| ${index + 1} | [${markdown(snapshot.countryName)}](${linkPrefix}${snapshot.country}.md) | ${snapshot.currentUserCount} | ${snapshot.users.length - snapshot.currentUserCount} | ${snapshot.users.length} | ${markdown(METRIC_LABELS[snapshot.metric] ?? snapshot.metric)} |`);
    return `# ${markdown(title)}

Country GitHub user rankings, SVG badges and copyable snippets. This README is updated automatically whenever the ranking action runs.

| Countries | Current users | Retained users | Total users |
| ---: | ---: | ---: | ---: |
| ${countries.length} | ${currentUsers} | ${retainedUsers} | ${totalUsers} |

## Countries

| Index | Country | Current users | Retained users | Total users | Ranked by |
| ---: | --- | ---: | ---: | ---: | --- |
${rows.join('\n')}
| | **Total** | **${currentUsers}** | **${retainedUsers}** | **${totalUsers}** | |

**Current users** appear in the latest source snapshot for that country. **Retained users** appeared in earlier cached lists but are absent from that snapshot. Their badges display \`> N\`, where \`N\` is the country's current user count. **Total users** includes both current and retained users.

Totals sum entries across country lists. A username listed in multiple countries is counted in each country. During a run for selected countries, the index also includes the saved snapshots for other countries.
`;
}
