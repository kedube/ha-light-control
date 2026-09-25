// Builds dist/ha-light-control.js (the file HACS installs) and, with --demo, the demo page.
//   node scripts/build.mjs            production bundle
//   node scripts/build.mjs --demo     also build demo/build/* (used by e2e tests and screenshots)
//   node scripts/build.mjs --serve    rebuild on change and serve http://localhost:5173/demo/
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const args = new Set(process.argv.slice(2));
const version = process.env.RELEASE_VERSION || devVersion();

function devVersion() {
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return `${tag.replace(/^v/, '')}-dev`;
  } catch {
    return 'dev';
  }
}

/**
 * esbuild leaves template literals alone, so the CSS inside Lit's css`` tags ships with all its
 * indentation. Collapse it. Blocks with ${} interpolations are left untouched.
 */
function minifyCss(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};])\s*/g, '$1')
    .replace(/([a-z-]):\s+/g, '$1:')
    .replace(/,\s+/g, ',')
    .replace(/;}/g, '}')
    .trim();
}

const minifyCssLiterals = {
  name: 'minify-css-literals',
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const contents = source.replace(/css`([^`]*)`/g, (match, body) =>
        body.includes('${') ? match : `css\`${minifyCss(body)}\``,
      );
      return { contents, loader: 'ts' };
    });
  },
};

const card = {
  entryPoints: ['src/index.ts'],
  plugins: [minifyCssLiterals],
  bundle: true,
  format: 'esm',
  target: 'es2021',
  minify: true,
  // ES modules are always decoded as UTF-8; keeps translated strings readable and small.
  charset: 'utf8',
  legalComments: 'none',
  outfile: 'dist/ha-light-control.js',
  define: { __VERSION__: JSON.stringify(version) },
  banner: {
    js: `/*! Light Control Card ${version} | GPL-3.0-or-later | https://github.com/kedube/ha-light-control */`,
  },
  logLevel: 'info',
};

const demo = {
  entryPoints: ['demo/demo.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2021',
  outfile: 'demo/build/demo.js',
  minify: true,
  logLevel: 'info',
};

/** One self-contained HTML file (card + mock Home Assistant) for sharing the demo. */
async function writeStandalone() {
  const page = await readFile('demo/index.html', 'utf8');
  const inline = async (file) => (await readFile(file, 'utf8')).replaceAll('</script', '<\\/script');
  const cardJs = await inline('dist/ha-light-control.js');
  const demoJs = await inline('demo/build/demo.js');
  // The published demo gets its document wrapper from the host page, so drop ours.
  const html = page
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<\/?(html|head|body)\b[^>]*>\s*/gi, '')
    .replace(/<meta (charset|name="viewport")[^>]*>\s*/gi, '')
    .replace(
      /<script type="module" src="\.\.\/dist\/ha-light-control\.js"><\/script>/,
      () => `<script type="module">${cardJs}</script>`,
    )
    .replace(
      /<script type="module" src="\.\/build\/demo\.js"><\/script>/,
      () => `<script type="module">${demoJs}</script>`,
    );
  await writeFile('demo/build/standalone.html', html);
  console.log('  demo/build/standalone.html');
}

if (args.has('--serve')) {
  const cardCtx = await esbuild.context({ ...card, minify: false, sourcemap: 'inline' });
  const demoCtx = await esbuild.context(demo);
  await Promise.all([cardCtx.watch(), demoCtx.watch()]);
  const { port } = await demoCtx.serve({ servedir: '.', port: 5173 });
  console.log(`\nDemo: http://localhost:${port}/demo/\n`);
} else {
  await mkdir('dist', { recursive: true });
  await esbuild.build(card);
  if (args.has('--demo')) {
    await mkdir('demo/build', { recursive: true });
    await esbuild.build(demo);
    await writeStandalone();
  }
  console.log(`Built Light Control Card ${version}`);
}
