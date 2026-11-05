# docs-template

The Starlight site that publishes a project's `docs/` directory to
`https://the40thieves.dev/<project>/docs/` (the40thieves.dev plan, P2-07). Projects do not copy
it: the reusable workflow `.github/workflows/docs-deploy.yml` checks this directory out at the
workflow's own commit, syncs the caller's docs into it, builds, and deploys an assets-only Worker
named `<project>-docs` on the route `the40thieves.dev/<project>/docs*`.

## What a project needs

1. A `docs/` directory of Markdown (any layout; `README.md` becomes the index of its directory;
   a tree without a root `README.md` gets a generated index listing every page by directory).
   Pages need no frontmatter: the first level-one heading becomes the title. Frontmatter, when
   present, wins.
2. `.github/workflows/docs.yml` calling the reusable workflow (example at the top of
   `docs-deploy.yml`), pinned to a commit of this repository.
3. Access to the org secret `CLOUDFLARE_DOCS_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. `"docs_site": true` in the project's `hub.json`, so the product page on the hub links to the
   published docs instead of the repository tree.

## What the sync does

| Source                               | Published as                                                          |
| ------------------------------------ | --------------------------------------------------------------------- |
| `docs/a/b.md`                        | `/<project>/docs/a/b/`                                                |
| `docs/a/README.md`                   | `/<project>/docs/a/`                                                  |
| an image next to a page              | optimised by Astro, also served at `/<project>/docs/<path>`           |
| any other file (schema, SQL, sample) | `/<project>/docs/<path>`, unchanged                                   |
| a relative link to a page or file    | rewritten to the published URL                                        |
| a relative link that leaves `docs/`  | rewritten to GitHub at the built commit (`blob`, or `raw` for images) |

Every page's footer shows the source file, the commit it was built from and the build time, and
links back to the project's page on the hub. Search is Pagefind, built with the site.

## Response headers

The site is built under `dist/<project>/docs/` so the asset paths mirror the route (a non-root
`assets.base_path` is not enabled on the account); `pnpm worker-config` writes `wrangler.jsonc`
and `dist/_headers`. The header file carries the hub's static header set (HSTS, nosniff, referrer
policy, frame denial, permissions policy) scoped to `/<project>/docs/*`, plus `X-Served-By: <project>-docs`,
which the post-deploy check uses to prove the docs route answers from this Worker while
`/<project>/` still answers from the hub. The values are a copy of
`security/headers.policy.json` in the hub repository; change both together.

## Gates

- `pnpm test`: unit tests for the link and title rules (`scripts/lib.test.mjs`).
- `starlight-links-validator`: a broken in-site link fails the build (invalid hashes only warn).
- `pnpm check`: the built site has a home page, a 404 page, the search bundle, the sitemap, the
  headers file, assets under the base, the provenance stamp, and no source maps.
- `pnpm verify` (after a deploy): the live docs answer 200 with the headers and this commit's
  stamp, search assets resolve, an unknown page is a 404, and the hub still owns `/<project>/`.

## Local run

```sh
pnpm install
pnpm fixture        # or: node scripts/sync-docs.mjs --source ../some-repo/docs --project x --repo The-40-Thieves/x --sha <40 hex>
pnpm build
pnpm check
pnpm config         # writes wrangler.jsonc
pnpm exec wrangler dev   # serves the site at http://localhost:8787/<project>/docs/
```
