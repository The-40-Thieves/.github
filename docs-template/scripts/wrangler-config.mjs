// Writes wrangler.jsonc for the docs Worker of the project named in .docs-build.json.
// Assets only (no script): the files stay at the root of dist/ and assets.base_path mounts them
// under /<project>/docs; the route is the one path the hub's Custom Domain hands over.
import { readFileSync, writeFileSync } from 'node:fs';

const build = JSON.parse(readFileSync(new URL('../.docs-build.json', import.meta.url), 'utf8'));

export function wranglerConfig({ project, base }) {
  return {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: `${project}-docs`,
    compatibility_date: '2026-10-26',
    assets: {
      directory: './dist',
      base_path: base,
      html_handling: 'auto-trailing-slash',
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
console.log(text);
