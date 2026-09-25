// Prints the next release version and the previous tag as GitHub Actions outputs:
//   version=0.4
//   tag=0.4              (the plain version; tags like v0.3 are ignored)
//   previous=0.3         (empty on the first release)
//   changed=true|false   (false when HEAD is already released)
import { execFileSync } from 'node:child_process';
import { latestTag, nextVersion } from './lib.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const tags = git('tag', '--list').split('\n').filter(Boolean);
const previous = latestTag(tags);
const version = nextVersion(tags);
const changed = !previous || git('rev-list', '--count', `${previous}..HEAD`) !== '0';

console.log(`version=${version}`);
console.log(`tag=${version}`);
console.log(`previous=${previous ?? ''}`);
console.log(`changed=${changed}`);
