// Writes wrangler.jsonc and dist/_headers for the docs Worker of the project named in
// .docs-build.json. Assets only (no script): Astro writes the site under dist/<project>/docs/,
// so the asset paths mirror the route and the Worker needs no base_path (a non-root
// assets.base_path is not enabled on the account, Cloudflare error 100343). The route is the one
// path the hub's Custom Domain hands over.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { headersFile } from './lib.mjs';

const build = JSON.parse(readFileSync(new URL('../.docs-build.json', import.meta.url), 'utf8'));

export function wranglerConfig({ project, base }) {
  return {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: `${project}-docs`,
    compatibility_date: '2026-10-26',
    assets: {
      directory: './dist',
      html_handling: 'auto-trailing-slash',
      // The nearest 404.html up the tree: dist/<project>/docs/404.html for every docs URL.
      not_found_handling: '404-page',
    },
    observability: { enabled: true, head_sampling_rate: 1 },
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: `the40thieves.dev${base}*`, zone_name: 'the40thieves.dev' }],
  };
}

const text = JSON.stringify(wranglerConfig(build), null, 2) + '\n';
writeFileSync(new URL('../wrangler.jsonc', import.meta.url), text);
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/_headers', import.meta.url), headersFile(build.project, build.base));
console.log(text);
console.log(`wrote dist/_headers for ${build.base}/*`);
