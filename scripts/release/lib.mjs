// Pure helpers for the release workflow: x.y versioning and commit-based release notes.

/** Releases are tagged with the plain version: "1.4", never "v1.4". Returns null for any other tag. */
export function parseVersion(tag) {
  const match = /^(\d+)\.(\d+)$/.exec(String(tag).trim());
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

const compare = (a, b) => a.major - b.major || a.minor - b.minor;

/** The newest x.y tag, or null when there has never been a release. */
export function latestTag(tags) {
  const versions = tags
    .map((tag) => ({ tag: tag.trim(), version: parseVersion(tag) }))
    .filter((entry) => entry.version)
    .sort((a, b) => compare(a.version, b.version));
  return versions.at(-1)?.tag ?? null;
}

/**
 * Each release adds 0.1, and the minor digit never passes 9:
 * none → 0.1 → 0.2 … 0.9 → 1.0 → 1.1 … 1.9 → 2.0.
 */
export function nextVersion(tags) {
  const tag = latestTag(tags);
  if (!tag) return '0.1';
  const { major, minor } = parseVersion(tag);
  return minor >= 9 ? `${major + 1}.0` : `${major}.${minor + 1}`;
}

const SECTIONS = [
  ['breaking', 'Breaking changes'],
  ['features', 'New features'],
  ['fixes', 'Fixes'],
  ['improvements', 'Improvements'],
  ['docs', 'Documentation'],
  ['maintenance', 'Maintenance'],
  ['other', 'Other changes'],
];

const CONVENTIONAL = {
  feat: 'features',
  feature: 'features',
  fix: 'fixes',
  bugfix: 'fixes',
  revert: 'fixes',
  perf: 'improvements',
  refactor: 'improvements',
  style: 'improvements',
  ui: 'improvements',
  i18n: 'improvements',
  docs: 'docs',
  doc: 'docs',
  test: 'maintenance',
  tests: 'maintenance',
  build: 'maintenance',
  ci: 'maintenance',
  chore: 'maintenance',
  deps: 'maintenance',
};

const LEADING_VERBS = [
  [/^(add|adds|added|implement|introduce|support|create|new|allow|enable)\b/i, 'features'],
  [/^(fix|fixes|fixed|correct|resolve|repair|prevent|handle)\b/i, 'fixes'],
  [
    /^(improve|update|refactor|polish|tweak|speed|optimi[sz]e|rework|simplify|translate|localize|redesign)\b/i,
    'improvements',
  ],
  [/^(docs?|document|readme)\b/i, 'docs'],
  [/^(bump|upgrade|ci|build|test|tests|release|chore|lint|format)\b/i, 'maintenance'],
];

/** Sorts a commit into a release-notes section and tidies its subject. */
export function classifyCommit(subject, body = '') {
  const conventional = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject.trim());
  let section = 'other';
  let text = subject.trim();
  let breaking = /BREAKING[ -]CHANGE:/.test(body);
  if (conventional) {
    const [, type, scope, bang, rest] = conventional;
    section = CONVENTIONAL[type.toLowerCase()] ?? 'other';
    text = scope ? `**${scope}:** ${rest}` : rest;
    breaking ||= Boolean(bang);
  } else {
    for (const [re, name] of LEADING_VERBS) {
      if (re.test(text)) {
        section = name;
        break;
      }
    }
  }
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return { section: breaking ? 'breaking' : section, text };
}

const TRAILER = /^(co-authored-by|signed-off-by|reviewed-by|change-id|closes|fixes|refs?):/i;

/** Commit body → the lines worth showing: no trailers, no release-control markers. */
export function commitDetails(body) {
  return body
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !TRAILER.test(line.trim()) && !/\[skip release\]/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @typedef {{ hash: string, subject: string, body?: string, author?: string }} Commit
 * @typedef {{ status: string, path: string }} ChangedFile
 */

/**
 * Markdown release notes. Commits are newest first.
 * @param {{ version: string, previous: string | null, commits: Commit[], files?: ChangedFile[], stats?: string, repo?: string }} options
 * @returns {string}
 */
export function buildReleaseNotes({ version, previous, commits, files = [], stats = '', repo }) {
  const grouped = new Map(SECTIONS.map(([key]) => [key, []]));
  for (const commit of commits) {
    const { section, text } = classifyCommit(commit.subject, commit.body);
    grouped.get(section).push({ ...commit, text, details: commitDetails(commit.body ?? '') });
  }

  const authors = [...new Set(commits.map((c) => c.author).filter(Boolean))];
  const lines = [];
  const since = previous ? ` since ${previous}` : '';
  const count = commits.length === 1 ? '1 change' : `${commits.length} changes`;
  lines.push(`**${count}${since}**${authors.length ? ` by ${authors.join(', ')}` : ''}.`, '');

  for (const [key, title] of SECTIONS) {
    const items = grouped.get(key);
    if (!items.length) continue;
    lines.push(`### ${title}`, '');
    for (const item of items) {
      const link = repo
        ? `[\`${item.hash.slice(0, 7)}\`](https://github.com/${repo}/commit/${item.hash})`
        : `\`${item.hash.slice(0, 7)}\``;
      lines.push(`- ${item.text} (${link})`);
      if (item.details) {
        for (const detail of item.details.split('\n')) lines.push(detail ? `  ${detail}` : '');
        lines.push('');
      }
    }
    lines.push('');
  }

  if (files.length) {
    const shown = files.slice(0, 80);
    lines.push(`<details><summary>Files changed${stats ? `: ${stats}` : ''}</summary>`, '');
    lines.push('| Change | File |', '| --- | --- |');
    const labels = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied' };
    for (const file of shown) lines.push(`| ${labels[file.status[0]] ?? file.status} | \`${file.path}\` |`);
    if (files.length > shown.length) lines.push(`| … | ${files.length - shown.length} more |`);
    lines.push('', '</details>', '');
  }

  if (repo) {
    lines.push(
      previous
        ? `**Full changelog:** https://github.com/${repo}/compare/${previous}...${version}`
        : `**Full history:** https://github.com/${repo}/commits/${version}`,
      '',
    );
  }

  lines.push(
    '### Install or update',
    '',
    '- **HACS:** open HACS, search for *Light Control Card* and choose **Download** (or **Update**). Reload your browser afterwards.',
    `- **Manual:** download \`ha-light-control.js\` from the assets below into \`config/www/\`, then add \`/local/ha-light-control.js\` as a JavaScript module under *Settings → Dashboards → Resources*.`,
  );
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}
