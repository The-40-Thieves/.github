// Copies a repository's docs directory into this template so Starlight can build it:
//   Markdown  → src/content/docs/<same path>, README.md as index.md, a title lifted from the
//               first heading when the frontmatter has none, plus sourcePath and editUrl;
//               a docs tree without a README gets a generated index that lists every page
//   images    → src/content/docs (Astro optimises relative images) and public/ (direct links)
//   anything else → public/<same path>, so links to schemas, SQL and samples keep working
//   --exclude     → docs-relative paths (a directory or a file, repeatable or comma-separated)
//                   left out entirely; `superpowers` by default, so planning files stay unpublished
// and writes .docs-build.json (read by astro.config.mjs, the footer and the Worker config).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  hasFrontmatterKey,
  isImage,
  isMarkdown,
  pageUrl,
  plainTitle,
  splitFrontmatter,
  takeFirstHeading,
  titleFromFileName,
  yamlString,
} from './lib.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const SHA = /^[0-9a-f]{40}$/;
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git']);
const DEFAULT_EXCLUDE = 'superpowers';

/** Docs-relative paths to leave out, from repeated or comma-separated values; empty means none. */
export function parseExclude(values) {
  const paths = [];
  for (const value of values) {
    for (const raw of value.split(',')) {
      const trimmed = raw.trim();
      if (trimmed === '') continue;
      const path = trimmed.replace(/^\.?\/+|\/+$/g, '');
      if (path === '' || trimmed.startsWith('/') || path.split('/').includes('..')) {
        throw new Error(`exclude must stay inside the docs directory, got '${trimmed}'`);
      }
      if (!paths.includes(path)) paths.push(path);
    }
  }
  return paths;
}

/** Whether a docs-relative path is one of the excluded paths or sits under an excluded directory. */
export function isExcluded(file, exclude) {
  return exclude.some((path) => file === path || file.startsWith(`${path}/`));
}

export function parseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: 'string' },
      project: { type: 'string' },
      repo: { type: 'string' },
      ref: { type: 'string', default: 'main' },
      sha: { type: 'string' },
      'docs-path': { type: 'string', default: 'docs' },
      title: { type: 'string' },
      out: { type: 'string', default: '.' },
      exclude: { type: 'string', multiple: true, default: [DEFAULT_EXCLUDE] },
    },
  });
  const missing = ['source', 'project', 'repo', 'sha'].filter((key) => !values[key]);
  if (missing.length > 0) throw new Error(`missing --${missing.join(', --')}`);
  if (!SLUG.test(values.project)) throw new Error(`project must be a lowercase slug, got '${values.project}'`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values.repo)) throw new Error(`repo must be owner/name, got '${values.repo}'`);
  if (!SHA.test(values.sha)) throw new Error('sha must be a 40-character commit hash');
  const docsPath = values['docs-path'].replace(/^\.?\/+|\/+$/g, '');
  if (docsPath === '' || docsPath.split('/').includes('..')) throw new Error(`docs-path must stay inside the repository, got '${values['docs-path']}'`);
  return {
    source: resolve(values.source),
    out: resolve(values.out),
    project: values.project,
    repo: values.repo,
    ref: values.ref,
    sha: values.sha,
    docsPath,
    title: values.title ?? values.project,
    exclude: parseExclude(values.exclude),
  };
}

function* walk(directory, root = directory) {
  for (const name of readdirSync(directory).sort()) {
    if (name.startsWith('.') || IGNORED_DIRECTORIES.has(name)) continue;
    const full = join(directory, name);
    if (statSync(full).isDirectory()) yield* walk(full, root);
    else yield relative(root, full).split(sep).join('/');
  }
}

/** The title a page gets: its frontmatter title, else its first heading, else its file name. */
export function pageTitle(text, file) {
  const { frontmatter, body } = splitFrontmatter(text);
  const declared = frontmatter?.match(/^title:[ \t]*(.+?)[ \t]*$/m);
  if (declared) {
    const raw = declared[1];
    if (/^".*"$/.test(raw)) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw.slice(1, -1);
      }
    }
    return /^'.*'$/.test(raw) ? raw.slice(1, -1).replaceAll("''", "'") : raw;
  }
  const heading = takeFirstHeading(body);
  return heading ? plainTitle(heading.title) : titleFromFileName(file);
}

/** The Markdown written to the content directory for one source file. */
export function transformMarkdown(text, file, options) {
  const { frontmatter, body } = splitFrontmatter(text);
  const extra = [];
  let nextBody = body;
  if (!hasFrontmatterKey(frontmatter, 'title')) {
    const heading = takeFirstHeading(body);
    const title = heading ? plainTitle(heading.title) : titleFromFileName(file);
    if (heading) nextBody = heading.body;
    extra.push(`title: ${yamlString(title)}`);
  }
  const sourcePath = posix.join(options.docsPath, file);
  if (!hasFrontmatterKey(frontmatter, 'sourcePath')) extra.push(`sourcePath: ${yamlString(sourcePath)}`);
  if (!hasFrontmatterKey(frontmatter, 'editUrl')) {
    extra.push(`editUrl: ${yamlString(`https://github.com/${options.repo}/edit/${options.ref}/${sourcePath}`)}`);
  }
  const block = [frontmatter, ...extra].filter((line) => line !== null && line !== '').join('\n');
  return `---\n${block}\n---\n${nextBody}`;
}

/** Where a docs-relative Markdown file lands in the content directory. */
export function contentTarget(file, existing) {
  const directory = posix.dirname(file);
  const name = posix.basename(file);
  if (/^readme\.(md|mdx|markdown)$/i.test(name)) {
    const index = posix.join(directory, 'index.md');
    if (!existing.has(index)) return index;
  }
  return file;
}

/**
 * The index page for a docs tree that has no README at its root: the title, where the docs come
 * from, and every page grouped by its top-level directory. Links are absolute under the base, the
 * form the link validator accepts.
 */
export function generatedIndex(options, base, pages) {
  const treeUrl = `https://github.com/${options.repo}/tree/${options.ref}/${options.docsPath}`;
  const lines = [
    '---',
    `title: ${yamlString(options.title)}`,
    'editUrl: false',
    '---',
    '',
    `Documentation for ${options.title}, published from [\`${options.docsPath}\`](${treeUrl}) in ${options.repo}.`,
    '',
  ];
  const groups = new Map();
  for (const page of pages) {
    const top = page.file.includes('/') ? page.file.split('/')[0] : '';
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(page);
  }
  const order = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  for (const top of order) {
    if (top !== '') lines.push(`## ${titleFromFileName(top)}`, '');
    for (const page of groups.get(top)) {
      const label = page.title.replaceAll('[', '\\[').replaceAll(']', '\\]');
      lines.push(`- [${label}](${page.url})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function sync(options) {
  if (!existsSync(options.source) || !statSync(options.source).isDirectory()) {
    throw new Error(`docs directory not found: ${options.source}`);
  }
  const contentDir = join(options.out, 'src', 'content', 'docs');
  const publicDir = join(options.out, 'public');
  for (const directory of [contentDir, publicDir]) {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
  }
  const exclude = options.exclude ?? [];
  const all = [...walk(options.source)];
  const files = all.filter((file) => !isExcluded(file, exclude));
  const existing = new Set(files);
  const counts = { pages: 0, images: 0, files: 0, excluded: all.length - files.length };
  const base = `/${options.project}/docs`;
  const pages = [];
  for (const file of files) {
    const from = join(options.source, file);
    if (isMarkdown(file)) {
      const text = readFileSync(from, 'utf8');
      const target = join(contentDir, contentTarget(file, existing));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, transformMarkdown(text, file, options));
      pages.push({ file, title: pageTitle(text, file), url: pageUrl(base, file) });
      counts.pages += 1;
      continue;
    }
    const pub = join(publicDir, file);
    mkdirSync(dirname(pub), { recursive: true });
    cpSync(from, pub);
    if (isImage(file)) {
      const inContent = join(contentDir, file);
      mkdirSync(dirname(inContent), { recursive: true });
      cpSync(from, inContent);
      counts.images += 1;
    } else {
      counts.files += 1;
    }
  }
  if (counts.pages === 0) throw new Error(`no Markdown found under ${options.source}`);
  const indexTarget = join(contentDir, 'index.md');
  let generated = false;
  if (!existsSync(indexTarget) && !existsSync(join(contentDir, 'index.mdx'))) {
    writeFileSync(indexTarget, generatedIndex(options, base, pages));
    counts.pages += 1;
    generated = true;
  }
  const build = {
    project: options.project,
    title: options.title,
    repo: options.repo,
    ref: options.ref,
    sha: options.sha,
    docsPath: options.docsPath,
    exclude,
    base,
    contentDir: relative(options.out, contentDir).split(sep).join('/'),
    builtAt: new Date().toISOString(),
  };
  writeFileSync(join(options.out, '.docs-build.json'), JSON.stringify(build, null, 2) + '\n');
  return { ...counts, generatedIndex: generated, build };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = sync(parseOptions(process.argv.slice(2)));
  const index = result.generatedIndex ? ' (index generated: no README at the docs root)' : '';
  const excluded = result.excluded > 0 ? `, ${result.excluded} excluded (${result.build.exclude.join(', ')})` : '';
  console.log(`synced ${result.pages} pages, ${result.images} images, ${result.files} files${excluded} for ${result.build.repo}@${result.build.sha.slice(0, 7)} → ${result.build.base}${index}`);
}
