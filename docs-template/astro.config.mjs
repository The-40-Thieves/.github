// Built once per docs deploy from the values scripts/sync-docs.mjs wrote to .docs-build.json.
import { readFileSync } from 'node:fs';

import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';

import { remarkRepoLinks } from './src/plugins/remark-repo-links.mjs';

const build = JSON.parse(readFileSync(new URL('./.docs-build.json', import.meta.url), 'utf8'));

export default defineConfig({
  site: 'https://the40thieves.dev',
  base: build.base,
  // The Worker serves dist/ as plain static assets with no base_path (a non-root base_path is
  // not enabled on the account), so the site is written under dist/<project>/docs/ to mirror
  // the route. _headers is written at the dist root by scripts/wrangler-config.mjs.
  outDir: `./dist${build.base}`,
  trailingSlash: 'always',
  markdown: {
    remarkPlugins: [[remarkRepoLinks, build]],
  },
  integrations: [
    starlight({
      title: build.title,
      description: `${build.title} documentation, published from ${build.repo}.`,
      social: [
        { icon: 'github', label: 'Repository', href: `https://github.com/${build.repo}` },
        { icon: 'external', label: 'Back to the40thieves.dev', href: `https://the40thieves.dev/${build.project}/` },
      ],
      components: {
        Footer: './src/components/Footer.astro',
      },
      // The checkout is shallow, so Git dates are meaningless; the footer stamp carries the commit.
      lastUpdated: false,
      credits: false,
      pagefind: true,
      plugins: [
        // Every in-site link must resolve. Hand-written docs carry anchors Starlight cannot
        // always see (headings inside HTML, generated tables), so invalid hashes only warn.
        starlightLinksValidator({ errorOnInvalidHashes: false, errorOnRelativeLinks: true }),
      ],
    }),
  ],
});
