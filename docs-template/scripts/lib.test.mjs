import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hasFrontmatterKey,
  headersFile,
  pageUrl,
  plainTitle,
  resolveRelativeLink,
  splitFrontmatter,
  takeFirstHeading,
  titleFromFileName,
} from './lib.mjs';

const build = {
  base: '/codecalc/docs',
  docsPath: 'docs',
  repo: 'The-40-Thieves/codecalc',
  sha: '0123456789abcdef0123456789abcdef01234567',
};

test('pageUrl mirrors the glob loader ids under the base', () => {
  assert.equal(pageUrl(build.base, 'distribution.md'), '/codecalc/docs/distribution/');
  assert.equal(pageUrl(build.base, 'contract/README.md'), '/codecalc/docs/contract/');
  assert.equal(pageUrl(build.base, 'contract/index.md'), '/codecalc/docs/contract/');
  assert.equal(pageUrl(build.base, 'index.md'), '/codecalc/docs/');
  assert.equal(pageUrl(build.base, 'design/2026-08-10-tool-facade.md'), '/codecalc/docs/design/2026-08-10-tool-facade/');
  assert.equal(pageUrl(build.base, 'Guides/My Page.md'), '/codecalc/docs/guides/my-page/');
});

test('resolveRelativeLink leaves absolute, fragment and empty links alone', () => {
  assert.equal(resolveRelativeLink('https://example.com/x', 'a.md', build), null);
  assert.equal(resolveRelativeLink('/already/rooted', 'a.md', build), null);
  assert.equal(resolveRelativeLink('#section', 'a.md', build), null);
  assert.equal(resolveRelativeLink('mailto:x@y.z', 'a.md', build), null);
  assert.equal(resolveRelativeLink('', 'a.md', build), null);
});

test('resolveRelativeLink maps markdown inside the docs tree to page urls', () => {
  assert.equal(resolveRelativeLink('contract/README.md', 'distribution.md', build), '/codecalc/docs/contract/');
  assert.equal(resolveRelativeLink('../distribution.md#already-listed', 'contract/README.md', build), '/codecalc/docs/distribution/#already-listed');
  assert.equal(resolveRelativeLink('provider-v1.md', 'contract/README.md', build), '/codecalc/docs/contract/provider-v1/');
  assert.equal(resolveRelativeLink('./', 'contract/provider-v1.md', build), '/codecalc/docs/contract/');
  assert.equal(resolveRelativeLink('extensions/', 'distribution.md', build), '/codecalc/docs/extensions/');
});

test('resolveRelativeLink points other files at their public copy and keeps images relative', () => {
  assert.equal(resolveRelativeLink('computation-spec-v1.schema.json', 'contract/README.md', build), '/codecalc/docs/contract/computation-spec-v1.schema.json');
  assert.equal(resolveRelativeLink('verify_optimization-sample.png', 'design/x.md', build, { image: true }), null);
  assert.equal(resolveRelativeLink('../design/verify_optimization-sample.png', 'contract/README.md', build), null);
});

test('resolveRelativeLink sends links that leave the docs tree to GitHub at the built commit', () => {
  assert.equal(resolveRelativeLink('../README.md', 'distribution.md', build), `https://github.com/The-40-Thieves/codecalc/blob/${build.sha}/README.md`);
  assert.equal(resolveRelativeLink('../../src/lib.rs#L10', 'design/x.md', build), `https://github.com/The-40-Thieves/codecalc/blob/${build.sha}/src/lib.rs#L10`);
  assert.equal(resolveRelativeLink('../assets/logo.png', 'x.md', build, { image: true }), `https://github.com/The-40-Thieves/codecalc/raw/${build.sha}/assets/logo.png`);
  assert.equal(resolveRelativeLink('../../../outside.md', 'x.md', build), null);
});

test('frontmatter helpers', () => {
  const { frontmatter, body } = splitFrontmatter('---\ntitle: Hi\n---\n\nBody\n');
  assert.equal(frontmatter, 'title: Hi');
  assert.equal(body, '\nBody\n');
  assert.equal(hasFrontmatterKey(frontmatter, 'title'), true);
  assert.equal(hasFrontmatterKey(frontmatter, 'description'), false);
  assert.deepEqual(splitFrontmatter('# No fm\n'), { frontmatter: null, body: '# No fm\n' });
});

test('takeFirstHeading lifts the leading h1 and skips fenced code', () => {
  assert.deepEqual(takeFirstHeading('# Title here\n\nText\n'), { title: 'Title here', body: 'Text\n' });
  assert.deepEqual(takeFirstHeading('```\n# not a heading\n```\n\n# Real\nText'), { title: 'Real', body: '```\n# not a heading\n```\n\nText' });
  assert.equal(takeFirstHeading('Intro paragraph\n\n# Later\n'), null);
  assert.equal(takeFirstHeading('## Only h2\n'), null);
});

test('titles', () => {
  assert.equal(titleFromFileName('docs/tool-selection-eval.md'), 'Tool selection eval');
  assert.equal(plainTitle('`codecalc` **spec** [v1](x.md)'), 'codecalc spec v1');
});

test('headersFile scopes the block to the base and tags the worker', () => {
  const text = headersFile('codecalc', '/codecalc/docs');
  assert.match(text, /^\/codecalc\/docs\/\*\n/);
  assert.match(text, /\n  X-Served-By: codecalc-docs\n$/);
  assert.match(text, /Strict-Transport-Security: max-age=63072000/);
});
