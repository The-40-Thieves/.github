// Fails the build when dist/ is not a complete docs site for the base it was built for.
// Layout: dist/_headers at the root (the Worker reads it there) and the site itself under
// dist/<project>/docs/, mirroring the route the Worker serves.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsHeaders } from './lib.mjs';

const root = new URL('..', import.meta.url);
const dist = join(fileURLToPath(root), 'dist');
const build = JSON.parse(readFileSync(new URL('.docs-build.json', root), 'utf8'));
const site = join(dist, ...build.base.split('/').filter(Boolean));
const failures = [];

function expectFile(path, why) {
  if (!existsSync(join(site, path))) failures.push(`${build.base}/${path} missing (${why})`);
}

function* walk(directory) {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

expectFile('index.html', 'the docs home page');
expectFile('404.html', 'not_found_handling: 404-page serves it');
expectFile('pagefind/pagefind.js', 'in-page search');
expectFile('pagefind/pagefind-entry.json', 'the search index');
expectFile('sitemap-index.xml', 'the sitemap Starlight emits');
if (!existsSync(join(dist, '_headers'))) failures.push('_headers missing at the dist root (the response headers)');

if (existsSync(dist)) {
  // Only the header file and the project directory may sit at the root: anything else would be
  // served at a path the route never covers, or shadow nothing at all.
  const rootEntries = readdirSync(dist).sort();
  const expected = ['_headers', build.project].sort();
  if (rootEntries.join(',') !== expected.join(',')) failures.push(`dist root holds ${rootEntries.join(', ')}; expected ${expected.join(', ')}`);
}

if (existsSync(join(site, 'index.html'))) {
  const html = readFileSync(join(site, 'index.html'), 'utf8');
  if (!html.includes(`${build.base}/_astro/`)) failures.push(`index.html does not reference assets under ${build.base}/_astro/`);
  if (!html.includes(build.sha.slice(0, 7))) failures.push('index.html lacks the provenance stamp with the commit');
  if (!html.includes(`https://the40thieves.dev/${build.project}/`)) failures.push('index.html lacks the link back to the hub');
  // Anything rooted outside the base would be served by the hub Worker, not this one.
  const escapedBase = build.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const outsideBase = html.match(new RegExp(`href="/(?!${escapedBase.slice(1)}/)[^"]*"`, 'g')) ?? [];
  if (outsideBase.length > 0) failures.push(`index.html links outside the base: ${[...new Set(outsideBase)].join(' ')}`);
}

if (existsSync(join(dist, '_headers'))) {
  const headers = readFileSync(join(dist, '_headers'), 'utf8');
  if (!headers.startsWith(`${build.base}/*\n`)) failures.push(`_headers must start with a ${build.base}/* block`);
  for (const [name, value] of docsHeaders(build.project)) {
    if (!headers.includes(`  ${name}: ${value}\n`)) failures.push(`_headers lacks ${name}`);
  }
}

if (existsSync(dist)) {
  const maps = [...walk(dist)].filter((file) => file.endsWith('.map'));
  if (maps.length > 0) failures.push(`source maps in dist: ${maps.join(', ')}`);
}

if (failures.length > 0) {
  console.error(`check-dist: ${failures.length} problem(s)\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-dist: dist is a complete docs site for ${build.base}`);
