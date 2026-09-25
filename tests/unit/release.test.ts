import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildReleaseNotes,
  classifyCommit,
  commitDetails,
  latestTag,
  nextVersion,
  parseVersion,
} from '../../scripts/release/lib.mjs';

describe('x.y versioning', () => {
  it('starts at 0.1', () => {
    assert.equal(nextVersion([]), '0.1');
  });

  it('adds 0.1 per release and rolls 0.9 over to 1.0', () => {
    assert.equal(nextVersion(['0.1']), '0.2');
    assert.equal(nextVersion(['0.8']), '0.9');
    assert.equal(nextVersion(['0.9']), '1.0');
    assert.equal(nextVersion(['1.0']), '1.1');
    assert.equal(nextVersion(['1.9']), '2.0');
    assert.equal(nextVersion(['12.9']), '13.0');
  });

  it('compares numerically, not alphabetically', () => {
    assert.equal(latestTag(['0.9', '1.0', '0.10']), '1.0');
    assert.equal(nextVersion(['2.3', '10.1', '9.9']), '10.2');
  });

  it('ignores tags that are not x.y', () => {
    assert.equal(parseVersion('1.2.3'), null);
    assert.equal(parseVersion('latest'), null);
    assert.deepEqual(parseVersion('1.4'), { major: 1, minor: 4 });
    assert.equal(nextVersion(['latest', '1.2.3', 'nightly']), '0.1');
  });

  it('ignores v-prefixed tags, so versions stay plain', () => {
    assert.equal(parseVersion('v1.4'), null);
    assert.equal(nextVersion(['v0.1']), '0.1');
    assert.equal(latestTag(['v0.3', '0.1']), '0.1');
  });
});

describe('release notes', () => {
  it('sorts commits into sections', () => {
    assert.deepEqual(classifyCommit('feat(tile): slide to dim'), {
      section: 'features',
      text: '**tile:** slide to dim',
    });
    assert.equal(classifyCommit('fix: undo restores color').section, 'fixes');
    assert.equal(classifyCommit('docs: screenshots').section, 'docs');
    assert.equal(classifyCommit('ci: cache browsers').section, 'maintenance');
    assert.equal(classifyCommit('Add outlet sparkline').section, 'features');
    assert.equal(classifyCommit('Fix house layout on phones').section, 'fixes');
    assert.equal(classifyCommit('Tidy things').section, 'other');
    assert.equal(classifyCommit('feat!: rename options').section, 'breaking');
    assert.equal(classifyCommit('feat: x', 'BREAKING CHANGE: removed y').section, 'breaking');
  });

  it('keeps commit details but drops trailers', () => {
    assert.equal(
      commitDetails('Tiles now dim live.\n\nCo-Authored-By: Someone <a@b.c>\n[skip release]'),
      'Tiles now dim live.',
    );
  });

  it('writes notes with details, files and links', () => {
    const notes = buildReleaseNotes({
      version: '1.0',
      previous: '0.9',
      repo: 'kedube/ha-light-control',
      stats: '2 files changed, 10 insertions(+)',
      commits: [
        {
          hash: 'a'.repeat(40),
          subject: 'feat: glowing windows',
          body: 'Rooms light up in their real color.',
          author: 'Katherine',
        },
        { hash: 'b'.repeat(40), subject: 'fix: phone layout', body: '', author: 'Katherine' },
      ],
      files: [
        { status: 'M', path: 'src/components/lc-house.ts' },
        { status: 'A', path: 'docs/images/house.png' },
      ],
    });
    assert.match(notes, /\*\*2 changes since 0\.9\*\* by Katherine\./);
    assert.match(
      notes,
      /### New features\n\n- Glowing windows \(\[`aaaaaaa`\]\(https:\/\/github\.com\/kedube\/ha-light-control\/commit\/a{40}\)\)\n  Rooms light up in their real color\./,
    );
    assert.match(notes, /### Fixes\n\n- Phone layout/);
    assert.match(notes, /\| Modified \| `src\/components\/lc-house\.ts` \|/);
    assert.match(notes, /compare\/0\.9\.\.\.1\.0/);
    assert.match(notes, /### Install or update/);
    assert.doesNotMatch(notes, /\bv\d/, 'versions are written without a v');
  });

  it('links the first release to its full history', () => {
    const notes = buildReleaseNotes({ version: '0.1', previous: null, commits: [], repo: 'kedube/ha-light-control' });
    assert.match(notes, /\*\*Full history:\*\* https:\/\/github\.com\/kedube\/ha-light-control\/commits\/0\.1\n/);
  });
});
