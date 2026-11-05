import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { pageTitle, sync } from './sync-docs.mjs';

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

test('sync keeps a README as the index and generates nothing', () => {
  const tree = docsTree({ 'README.md': '# Home\n', 'one.md': '# One\n' });
  const result = sync(options(tree));
  assert.equal(result.generatedIndex, false);
  assert.equal(result.pages, 2);
  const index = readFileSync(join(tree.out, 'src/content/docs/index.md'), 'utf8');
  assert.match(index, /^title: "Home"$/m);
  assert.equal(existsSync(join(tree.out, 'src/content/docs/README.md')), false);
});
