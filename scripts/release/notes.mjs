// Writes release notes for everything since the previous release tag.
//   node scripts/release/notes.mjs --version 0.4 [--previous 0.3] [--repo owner/name]
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { buildReleaseNotes } from './lib.mjs';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    previous: { type: 'string', default: '' },
    repo: { type: 'string', default: process.env.GITHUB_REPOSITORY ?? '' },
  },
});
if (!values.version) throw new Error('--version is required');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const range = values.previous ? [`${values.previous}..HEAD`] : ['HEAD'];
const base = values.previous || EMPTY_TREE;

const commits = git('log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1f%an%x1e', ...range)
  .split('\x1e')
  .map((record) => record.trim())
  .filter(Boolean)
  .map((record) => {
    const [hash, subject, body, author] = record.split('\x1f');
    return { hash, subject, body: body ?? '', author };
  });

const files = git('diff', '--name-status', base, 'HEAD')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [status, ...paths] = line.split('\t');
    return { status, path: paths.at(-1) };
  });

const stats = git('diff', '--shortstat', base, 'HEAD').trim();

process.stdout.write(
  buildReleaseNotes({
    version: values.version,
    previous: values.previous || null,
    commits,
    files,
    stats,
    repo: values.repo,
  }),
);
