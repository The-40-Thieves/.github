import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { pageTitle, parseOptions, sync } from './sync-docs.mjs';

function docsTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-sync-'));
  const source = join(root, 'docs');
  for (const [file, text] of Object.entries(files)) {
    const full = join(source, file);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return { source, out: join(root, 'out') };
}

const options = (tree) => ({
  ...tree,
  project: 'demo',
  repo: 'The-40-Thieves/demo',
  ref: 'main',
  sha: '0'.repeat(40),
  docsPath: 'docs',
  title: 'Demo tool',
});

test('pageTitle prefers the frontmatter, then the first heading, then the file name', () => {
  assert.equal(pageTitle('---\ntitle: "Setup: fast"\n---\n# Other\n', 'a.md'), 'Setup: fast');
  assert.equal(pageTitle("---\ntitle: 'It''s here'\n---\n", 'a.md'), "It's here");
  assert.equal(pageTitle('---\ntitle: Plain words\n---\n', 'a.md'), 'Plain words');
  assert.equal(pageTitle('# Intro `code`\n\nHello.\n', 'a.md'), 'Intro code');
  assert.equal(pageTitle('No heading here.\n', 'guide/tool-selection.md'), 'Tool selection');
});

test('sync generates an index that lists every page when the docs root has no README', () => {
  const tree = docsTree({
    'intro.md': '# Intro\n\nHello.\n',
    'guide/setup.md': '---\ntitle: "Setup: fast"\n---\nSteps.\n',
    'guide/README.md': '# Guide\n',
    'data/sample.json': '{}\n',
  });
  const result = sync(options(tree));
  const index = readFileSync(join(tree.out, 'src/content/docs/index.md'), 'utf8');
  assert.equal(result.generatedIndex, true);
  assert.equal(result.pages, 4);
  assert.match(index, /^title: "Demo tool"$/m);
  assert.match(index, /^editUrl: false$/m);
  assert.match(index, /\[`docs`\]\(https:\/\/github\.com\/The-40-Thieves\/demo\/tree\/main\/docs\)/);
  assert.match(index, /^- \[Intro\]\(\/demo\/docs\/intro\/\)$/m);
  assert.match(index, /^## Guide$/m);
  assert.match(index, /^- \[Guide\]\(\/demo\/docs\/guide\/\)$/m);
  assert.match(index, /^- \[Setup: fast\]\(\/demo\/docs\/guide\/setup\/\)$/m);
  assert.ok(index.indexOf('[Intro]') < index.indexOf('## Guide'), 'root pages come first');
});

const argv = (...extra) => ['--source', 'docs', '--project', 'demo', '--repo', 'The-40-Thieves/demo', '--sha', '0'.repeat(40), ...extra];

test('parseOptions excludes superpowers by default and accepts repeated or comma-separated --exclude', () => {
  assert.deepEqual(parseOptions(argv()).exclude, ['superpowers']);
  assert.deepEqual(parseOptions(argv('--exclude', '')).exclude, []);
  assert.deepEqual(parseOptions(argv('--exclude', 'drafts/, internal/notes.md', '--exclude', 'superpowers')).exclude, [
    'drafts',
    'internal/notes.md',
    'superpowers',
  ]);
  assert.throws(() => parseOptions(argv('--exclude', '../secrets')), /exclude must stay inside the docs directory/);
  assert.throws(() => parseOptions(argv('--exclude', '/etc')), /exclude must stay inside the docs directory/);
});

test('sync leaves excluded paths out of the content, the public files and the generated index', () => {
  const tree = docsTree({
    'intro.md': '# Intro\n',
    'superpowers/plans/2026-01-01-plan.md': '# Plan\n',
    'superpowers/specs/design.md': '# Design\n',
    'superpowers/data.json': '{}\n',
    'superstar/page.md': '# Superstar\n',
    'notes/private.md': '# Private\n',
    'notes/public.md': '# Public\n',
  });
  const result = sync({ ...options(tree), exclude: ['superpowers', 'notes/private.md'] });
  assert.equal(result.pages, 4, 'intro, superstar, notes/public and the generated index');
  assert.equal(result.files, 0);
  assert.equal(result.excluded, 4);
  const content = join(tree.out, 'src/content/docs');
  assert.equal(existsSync(join(content, 'superpowers')), false);
  assert.equal(existsSync(join(content, 'notes/private.md')), false);
  assert.equal(existsSync(join(content, 'notes/public.md')), true);
  assert.equal(existsSync(join(content, 'superstar/page.md')), true, 'a prefix matches whole path segments only');
  assert.equal(existsSync(join(tree.out, 'public/superpowers')), false);
  const index = readFileSync(join(content, 'index.md'), 'utf8');
  assert.doesNotMatch(index, /superpowers|Plan|Design|Private/);
  assert.match(index, /^- \[Superstar\]\(\/demo\/docs\/superstar\/page\/\)$/m);
});

test('sync keeps a README as the index and generates nothing', () => {
  const tree = docsTree({ 'README.md': '# Home\n', 'one.md': '# One\n' });
  const result = sync(options(tree));
  assert.equal(result.generatedIndex, false);
  assert.equal(result.pages, 2);
  const index = readFileSync(join(tree.out, 'src/content/docs/index.md'), 'utf8');
  assert.match(index, /^title: "Home"$/m);
  assert.equal(existsSync(join(tree.out, 'src/content/docs/README.md')), false);
});
