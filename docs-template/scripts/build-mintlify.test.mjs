import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { build, checkMdx, escapeMdx, pageHref, pagePath, parseOptions, resolveLink, rewriteLinks } from './build-mintlify.mjs';

const SHA = '0'.repeat(40);

function docsTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-mintlify-'));
  const source = join(root, 'docs');
  for (const [file, text] of Object.entries(files)) {
    const full = join(source, file);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  return { source, out: join(root, 'out') };
}

const options = (tree, extra = {}) => ({
  ...tree,
  project: 'demo',
  repo: 'The-40-Thieves/demo',
  sha: SHA,
  docsPath: 'docs',
  title: 'Demo tool',
  description: 'Documentation for Demo tool.',
  exclude: ['superpowers'],
  ...extra,
});

const site = {
  repo: 'The-40-Thieves/demo',
  sha: SHA,
  docsPath: 'docs',
  pages: new Map([
    ['README.md', 'index'],
    ['guide/README.md', 'guide/index'],
    ['guide/one.md', 'guide/one'],
  ]),
  directories: new Map([
    ['', 'index'],
    ['guide', 'guide/index'],
  ]),
  images: new Map([['guide/pic.png', 'guide/pic.png']]),
  files: new Set(['data/sample.json']),
};

test('pagePath slugs every segment the way the Starlight site does and keeps index', () => {
  assert.equal(pagePath('guide/one.md'), 'guide/one');
  assert.equal(pagePath('CODE_REVIEW_2026-10-25.md'), 'code_review_2026-10-25');
  assert.equal(pagePath('Guide/index.md'), 'guide/index');
  assert.equal(pageHref('guide/index'), '/guide');
  assert.equal(pageHref('index'), '/');
  assert.equal(pageHref('guide/one'), '/guide/one');
});

test('resolveLink maps pages, directories, images, other files and paths outside the docs tree', () => {
  assert.equal(resolveLink('guide/one.md#second', 'README.md', site), '/guide/one#second');
  assert.equal(resolveLink('guide/', 'README.md', site), '/guide');
  assert.equal(resolveLink('./', 'guide/one.md', site), '/guide');
  assert.equal(resolveLink('../README.md', 'guide/one.md', site), '/');
  assert.equal(resolveLink('pic.png', 'guide/one.md', site, { image: true }), '/guide/pic.png');
  assert.equal(resolveLink('data/sample.json', 'README.md', site), `https://github.com/The-40-Thieves/demo/blob/${SHA}/docs/data/sample.json`);
  assert.equal(resolveLink('../README.md', 'README.md', site), `https://github.com/The-40-Thieves/demo/blob/${SHA}/README.md`);
  assert.equal(resolveLink('../logo.png', 'README.md', site, { image: true }), `https://github.com/The-40-Thieves/demo/raw/${SHA}/logo.png`);
  assert.equal(resolveLink('https://example.com/x', 'README.md', site), null);
  assert.equal(resolveLink('#here', 'README.md', site), null);
  assert.equal(resolveLink('/absolute', 'README.md', site), null);
  assert.equal(resolveLink('../../outside.md', 'README.md', site), null);
});

test('escapeMdx escapes prose and leaves code, known HTML and fences alone', async () => {
  const source = [
    'A set {a, b} and a generic List<T> with x < y.',
    'Inline `{kept}` and `<T>` stay.',
    'See <https://example.com/a> and a break<br> here.',
    '<!-- a comment',
    'over two lines -->',
    '<details><summary>More</summary>Body</details>',
    '```js',
    'const o = {a: 1}; // <T>',
    '```',
  ].join('\n');
  const escaped = escapeMdx(source);
  assert.match(escaped, /A set \\\{a, b\\\} and a generic List\\<T> with x \\< y\./);
  assert.match(escaped, /Inline `\{kept\}` and `<T>` stay\./);
  assert.match(escaped, /\[https:\/\/example\.com\/a\]\(https:\/\/example\.com\/a\)/);
  assert.match(escaped, /break<br \/> here/);
  assert.doesNotMatch(escaped, /a comment/);
  assert.match(escaped, /<details><summary>More<\/summary>Body<\/details>/);
  assert.match(escaped, /const o = \{a: 1\}; \/\/ <T>/);
  await checkMdx(escaped, 'escaped.md');
  await assert.rejects(checkMdx(source, 'raw.md'), /raw\.md does not parse as MDX/);
});

test('escapeMdx leaves math and already escaped characters as written', async () => {
  const source = [
    'A matrix $\\mathbf{H}_8 = \\frac{1}{\\sqrt{8}}$ and a set $i \\in \\{0..7\\}$, then {prose}.',
    '',
    '$$g_i = 10^{\\frac{-3 \\cdot \\tau_i}{T_{60}}}$$',
    '',
    '$$',
    'x = {a \\over b}',
    '$$',
    '',
    'It costs $5 for {one} and $10 for {two}; `$HOME/{x}` is code.',
    'Escaped by the author: \\{kept\\} and \\<T>, then a raw {brace}.',
  ].join('\n');
  const escaped = escapeMdx(source);
  assert.match(escaped, /\$\\mathbf\{H\}_8 = \\frac\{1\}\{\\sqrt\{8\}\}\$/);
  assert.match(escaped, /\$i \\in \\\{0\.\.7\\\}\$, then \\\{prose\\\}\./);
  assert.match(escaped, /\$\$g_i = 10\^\{\\frac\{-3 \\cdot \\tau_i\}\{T_\{60\}\}\}\$\$/);
  assert.match(escaped, /\$\$\nx = \{a \\over b\}\n\$\$/);
  assert.match(escaped, /costs \$5 for \\\{one\\\} and \$10 for \\\{two\\\}; `\$HOME\/\{x\}` is code\./);
  assert.match(escaped, /author: \\\{kept\\\} and \\<T>, then a raw \\\{brace\\\}\./);
  await checkMdx(escaped, 'math.md');
});

test('build writes pages, navigation and a generated index, and leaves excluded paths out', async () => {
  const tree = docsTree({
    'embedding.md': '# Embedding `Demo`\n\nSee [the contract](contract/README.md) and [a schema](contract/v1.schema.json).\n',
    'contract/README.md': '# The contract\n\nBack to [embedding](../embedding.md). Source: [code](../../src/contract.py).\n',
    'contract/v1.schema.json': '{}\n',
    'contract/pic.png': 'png',
    'superpowers/plan.md': '# Plan\n\nmust not publish\n',
  });
  const result = await build(options(tree));
  assert.deepEqual(result, { pages: 3, images: 1, linkedFiles: 1, excluded: 1, generatedIndex: true });
  const read = (file) => readFileSync(join(tree.out, file), 'utf8');
  assert.match(read('embedding.md'), /^---\ntitle: "Embedding Demo"\n---\n/);
  assert.match(read('embedding.md'), /\[the contract\]\(\/contract\)/);
  assert.match(read('embedding.md'), new RegExp(`\\[a schema\\]\\(https://github.com/The-40-Thieves/demo/blob/${SHA}/docs/contract/v1.schema.json\\)`));
  assert.match(read('contract/index.md'), /\[embedding\]\(\/embedding\)/);
  assert.match(read('contract/index.md'), new RegExp(`\\[code\\]\\(https://github.com/The-40-Thieves/demo/blob/${SHA}/src/contract.py\\)`));
  assert.match(read('index.md'), /- \[The contract\]\(\/contract\)/);
  assert.ok(existsSync(join(tree.out, 'contract/pic.png')));
  assert.ok(!existsSync(join(tree.out, 'superpowers')));
  assert.ok(!existsSync(join(tree.out, 'contract/v1.schema.json')));
  const config = JSON.parse(read('docs.json'));
  assert.deepEqual(config.navigation.groups, [
    { group: 'Overview', pages: ['index'] },
    { group: 'Guides', pages: ['embedding'] },
    { group: 'Contract', pages: ['contract/index'] },
  ]);
});

test('build keeps a root README as the index and fails on a page MDX cannot parse', async () => {
  const withReadme = docsTree({ 'README.md': '# Home\n\n[One](one.md)\n', 'one.md': '# One\n' });
  const result = await build(options(withReadme));
  assert.equal(result.generatedIndex, false);
  assert.match(readFileSync(join(withReadme.out, 'index.md'), 'utf8'), /\[One\]\(\/one\)/);

  const broken = docsTree({ 'bad.md': '# Bad\n\n<div>never closed\n' });
  await assert.rejects(build(options(broken)), /docs\/bad\.md does not parse as MDX/);
});

test('parseOptions validates the project, repository and commit', () => {
  const base = ['--source', '.', '--project', 'demo', '--repo', 'The-40-Thieves/demo', '--sha', SHA];
  assert.equal(parseOptions(base).title, 'demo');
  assert.deepEqual(parseOptions(base).exclude, ['superpowers']);
  assert.throws(() => parseOptions(['--source', '.', '--project', 'Demo', '--repo', 'a/b', '--sha', SHA]), /lowercase slug/);
  assert.throws(() => parseOptions(['--source', '.', '--project', 'demo', '--repo', 'a/b', '--sha', 'abc']), /40-character/);
});

test('rewriteLinks leaves code spans alone and handles reference definitions', () => {
  const body = [
    'Write `[label](guide/one.md)` to link, as in [`one`](guide/one.md).',
    'A [reference][one], an ![image ref][logo] and a ![shot].',
    '',
    '[one]: <guide/one.md>',
    '[logo]: ../logo.png',
    '[shot]: guide/pic.png',
    '',
    '```md',
    '[kept](guide/one.md)',
    '```',
  ].join('\n');
  const out = rewriteLinks(body, 'README.md', site);
  assert.match(out, /Write `\[label\]\(guide\/one\.md\)` to link, as in \[`one`\]\(\/guide\/one\)\./);
  assert.match(out, /^\[one\]: \/guide\/one$/m);
  assert.ok(out.includes(`\n[logo]: https://github.com/The-40-Thieves/demo/raw/${SHA}/logo.png\n`));
  assert.match(out, /^\[shot\]: \/guide\/pic\.png$/m);
  assert.match(out, /^\[kept\]\(guide\/one\.md\)$/m);
});

test('escapeMdx keeps HTML comments that are inside code', () => {
  const out = escapeMdx('Use `<!-- note -->` inline. <!-- gone -->\n\n```html\n<!-- kept -->\n```\n');
  assert.match(out, /Use `<!-- note -->` inline\. \n/);
  assert.match(out, /```html\n<!-- kept -->\n```/);
  assert.doesNotMatch(out, /gone/);
});

test('build refuses two sources at one URL and an output directory that overlaps the docs', async () => {
  const clash = docsTree({ 'foo.md': '# Foo\n', 'foo/README.md': '# Foo index\n' });
  await assert.rejects(build(options(clash)), /both publish at \/foo/);

  const tree = docsTree({ 'one.md': '# One\n' });
  await assert.rejects(build(options(tree, { out: join(tree.source, 'site') })), /must not contain or sit inside/);
  await assert.rejects(build(options(tree, { out: join(tree.source, '..') })), /must not contain or sit inside/);
  assert.ok(existsSync(join(tree.source, 'one.md')));
});

test('a generated index with markup in the site title still parses', async () => {
  const tree = docsTree({ 'one.md': '# One <T> {x}\n' });
  await build(options(tree, { title: 'Docs <tag> {x}' }));
  assert.ok(readFileSync(join(tree.out, 'index.md'), 'utf8').includes(String.raw`Documentation for Docs \<tag> \{x\}, published`));
});
