// Assembles a repository's docs directory into a Mintlify site (a docs.json and its pages) that
// the docs hub pulls in under https://docs.the40thieves.dev/<project>/ with
// mintlify/multirepo-action. The same sources the Starlight build takes, with the same rules:
//   Markdown  → <slugged path>.md, README.md as index.md, the title lifted from the first heading
//               when the frontmatter has none; a tree without a root README gets a generated index
//   images    → copied next to the pages, linked root-relative
//   a relative link to a page         → the page's root-relative URL (the hub prefixes the project)
//   a relative link to any other file → GitHub at the built commit (`blob`, or `raw` for images
//                                       that sit outside the docs tree)
//   --exclude → docs-relative paths left out entirely; `superpowers` by default
// Mintlify parses .md as MDX, so prose is escaped where MDX would read it as JSX or an expression.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { compile } from '@mdx-js/mdx';
import remarkMath from 'remark-math';

import {
  hasFrontmatterKey,
  isImage,
  isMarkdown,
  plainTitle,
  slugSegment,
  splitFrontmatter,
  takeFirstHeading,
  titleFromFileName,
  yamlString,
} from './lib.mjs';
import { contentTarget, isExcluded, pageTitle, parseExclude } from './sync-docs.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const SHA = /^[0-9a-f]{40}$/;
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git']);
const ABSOLUTE_OR_FRAGMENT = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;
const FENCE = /^\s*(```|~~~)/;
// HTML that GitHub-flavoured Markdown authors use in prose and MDX accepts as JSX.
const HTML_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'ol', 'p', 'pre', 'picture', 's', 'source', 'span', 'strong',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'source']);

export function parseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: 'string' },
      project: { type: 'string' },
      repo: { type: 'string' },
      sha: { type: 'string' },
      'docs-path': { type: 'string', default: 'docs' },
      title: { type: 'string' },
      description: { type: 'string' },
      out: { type: 'string', default: 'dist-mintlify' },
      exclude: { type: 'string', multiple: true, default: ['superpowers'] },
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
    sha: values.sha,
    docsPath,
    title: values.title || values.project,
    description: values.description || `Documentation for ${values.title || values.project}.`,
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

/**
 * The Mintlify page path (no extension) a docs-relative Markdown file gets: every segment slugged
 * the way the Starlight site slugs it, so a page keeps the path it had under /<project>/docs/.
 */
export function pagePath(target) {
  const segments = target.replace(/\.[^./]+$/, '').split('/').filter(Boolean);
  return segments.map((segment) => (/^index$/i.test(segment) ? 'index' : slugSegment(segment))).join('/');
}

/** The root-relative URL of a page path: `a/index` → `/a`, `index` → `/`. */
export function pageHref(path) {
  const folded = path.replace(/(^|\/)index$/, '');
  return `/${folded}`;
}

/**
 * Resolve one relative link found in `file` (docs-relative source path). Returns the replacement
 * URL, or null when the link stays as written.
 */
export function resolveLink(url, file, site, { image = false } = {}) {
  if (url === '' || ABSOLUTE_OR_FRAGMENT.test(url)) return null;
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  let path = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = path.indexOf('?');
  if (queryAt !== -1) path = path.slice(0, queryAt);
  if (path === '') return null;
  try {
    path = decodeURI(path);
  } catch {
    return null;
  }
  let target = posix.normalize(posix.join(posix.dirname(file), path));
  if (target.endsWith('/')) target = target.slice(0, -1);
  if (target === '.') target = '';
  const github = (kind, repoPath) => `https://github.com/${site.repo}/${kind}/${site.sha}/${encodeURI(repoPath)}${hash}`;
  if (target === '..' || target.startsWith('../')) {
    const repoPath = posix.normalize(posix.join(site.docsPath, target));
    if (repoPath === '..' || repoPath.startsWith('../')) return null;
    return github(image ? 'raw' : 'blob', repoPath);
  }
  if (target === '') return '/' + hash;
  const page = site.pages.get(target) ?? site.directories.get(target);
  if (page !== undefined) return `${pageHref(page)}${hash}`;
  if (site.images.has(target)) return `/${site.images.get(target)}`;
  const inRepo = posix.join(site.docsPath, target);
  return github(site.files.has(target) || isMarkdown(target) ? 'blob' : 'tree', inRepo);
}

/** Apply `fn` to each run of lines that is outside a fenced code block. */
function outsideFences(body, fn) {
  const out = [];
  let buffer = [];
  let inFence = false;
  const flush = () => {
    if (buffer.length > 0) out.push(fn(buffer.join('\n')));
    buffer = [];
  };
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) {
      if (!inFence) flush();
      out.push(line);
      inFence = !inFence;
    } else if (inFence) {
      out.push(line);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return out.join('\n');
}

const CODE_SPAN = '`+[^`\\n]*`+';

// LaTeX math, which Mintlify renders with KaTeX: a `$$ … $$` block without a blank line in it, or
// a `$…$` span on one line. The span follows a strict rule, so that prices and `$VAR` stay prose:
// no space after the opening `$`, none before the closing one, no letter or digit right outside
// either, and no backtick inside.
const MATH =
  '(?<!\\\\)\\$\\$(?:(?!\\n[ \\t]*\\n)[\\s\\S])+?\\$\\$|(?<![\\\\$\\w])\\$(?=[^\\s$])(?:\\\\.|[^$\\\\\\n`])+?(?<=\\S)\\$(?![\\w$])';

/** Apply `fn` to the parts of a text that are not inside an inline code span or math. */
function outsideCodeSpans(text, fn) {
  const parts = text.split(new RegExp(`(${CODE_SPAN}|${MATH})`));
  return parts.map((part, i) => (i % 2 === 1 ? part : fn(part))).join('');
}

const INLINE_LINK = '(!?)(\\[(?:[^\\]\\\\]|\\\\.|\\][^(])*\\])\\(\\s*(<[^>]*>|[^)\\s]+)((?:\\s+"[^"]*")?\\s*)\\)';

/** The labels (lower case) that a body uses as reference-style images: `![alt][id]`, `![id]`. */
function imageReferences(body) {
  const labels = new Set();
  for (const match of body.matchAll(/!\[([^\]]*)\](?:\[([^\]]*)\])?(?!\()/g)) {
    labels.add((match[2] || match[1]).trim().toLowerCase());
  }
  return labels;
}

/** Rewrite the relative links and images of a Markdown body. Code spans and fences are left alone. */
export function rewriteLinks(body, file, site) {
  const images = imageReferences(body);
  const inline = new RegExp(`(${CODE_SPAN})|${INLINE_LINK}`, 'g');
  return outsideFences(body, (text) =>
    text
      .replace(/^(\s{0,3}\[([^\]]+)\]:\s*)(<[^>]*>|\S+)(.*)$/gm, (all, pre, label, rawUrl, rest) => {
        const bracketed = rawUrl.startsWith('<');
        const next = resolveLink(bracketed ? rawUrl.slice(1, -1) : rawUrl, file, site, { image: images.has(label.trim().toLowerCase()) });
        return next === null ? all : `${pre}${next}${rest}`;
      })
      .replace(inline, (all, code, bang, label, rawUrl, rest) => {
        if (code !== undefined) return all;
        const url = rawUrl.startsWith('<') ? rawUrl.slice(1, -1) : rawUrl;
        const next = resolveLink(url, file, site, { image: bang === '!' });
        return next === null ? all : `${bang}${label}(${next}${rest})`;
      }),
  );
}

/**
 * Escape prose so MDX reads it as text: braces, angle brackets that are not known HTML tags,
 * autolinks and HTML comments. Code fences, inline code spans, math and characters the author
 * already escaped with a backslash are left alone.
 */
export function escapeMdx(body) {
  const comments = new RegExp(`(${CODE_SPAN})|<!--[\\s\\S]*?-->`, 'g');
  return outsideFences(body, (block) =>
    outsideCodeSpans(block.replace(comments, (all, code) => code ?? ''), (text) =>
      text
        .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (_, url) => `[${url.replace(/^mailto:/, '')}](${url})`)
        .replace(/\\[\s\S]|<(\/?)([A-Za-z][A-Za-z0-9-]*)([^<>]*)>|[<{}]/g, (match, close, name, attributes) => {
          if (match[0] === '\\') return match;
          if (name === undefined) return `\\${match}`;
          const tag = name.toLowerCase();
          if (!HTML_TAGS.has(tag)) return `\\<${close}${name}${attributes.replace(/[{}]/g, '\\$&')}>`;
          if (VOID_TAGS.has(tag) && close === '' && !attributes.trimEnd().endsWith('/')) return `<${tag}${attributes.trimEnd()} />`;
          return `<${close}${tag}${attributes}>`;
        }),
    ),
  );
}

/** The page written for one Markdown source. */
export function transformPage(text, file, site) {
  const { frontmatter, body } = splitFrontmatter(text);
  const extra = [];
  let nextBody = body;
  if (!hasFrontmatterKey(frontmatter, 'title')) {
    const heading = takeFirstHeading(body);
    if (heading) nextBody = heading.body;
    extra.push(`title: ${yamlString(heading ? plainTitle(heading.title) : titleFromFileName(file))}`);
  }
  const block = [frontmatter, ...extra].filter((line) => line !== null && line !== '').join('\n');
  return `---\n${block}\n---\n${escapeMdx(rewriteLinks(nextBody, file, site))}`;
}

/** The index page for a docs tree with no README at its root: every page, by top-level directory. */
export function generatedIndex(options, groups) {
  const treeUrl = `https://github.com/${options.repo}/tree/${options.sha}/${options.docsPath}`;
  const lines = [
    '---',
    `title: ${yamlString(options.title)}`,
    `description: ${yamlString(options.description)}`,
    '---',
    '',
    `Documentation for ${escapeMdx(options.title)}, published from [\`${options.docsPath}\`](${treeUrl}) in ${options.repo}.`,
    '',
  ];
  for (const group of groups) {
    if (group.pages.length === 0) continue;
    lines.push(`## ${group.name}`, '');
    for (const page of group.pages) {
      const label = page.title.replace(/[[\]{}<]/g, '\\$&');
      lines.push(`- [${label}](${pageHref(page.path)})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Fail on a page MDX cannot parse; Mintlify would refuse the whole site for it. Math is read the
 * way Mintlify reads it, so its braces are not taken for expressions.
 */
export async function checkMdx(text, file) {
  try {
    await compile(splitFrontmatter(text).body, { format: 'mdx', remarkPlugins: [remarkMath] });
  } catch (error) {
    throw new Error(`${file} does not parse as MDX: ${error.message}`);
  }
}

export async function build(options) {
  if (!existsSync(options.source) || !statSync(options.source).isDirectory()) {
    throw new Error(`docs directory not found: ${options.source}`);
  }
  const inside = (parent, child) => !relative(parent, child).startsWith('..') && !isAbsolute(relative(parent, child));
  if (inside(options.out, options.source) || inside(options.source, options.out)) {
    throw new Error(`the output directory must not contain or sit inside the docs directory: ${options.out}`);
  }
  rmSync(options.out, { recursive: true, force: true });
  mkdirSync(options.out, { recursive: true });
  const all = [...walk(options.source)];
  const files = all.filter((file) => !isExcluded(file, options.exclude));
  const existing = new Set(files);
  const site = { repo: options.repo, sha: options.sha, docsPath: options.docsPath, pages: new Map(), directories: new Map(), images: new Map(), files: new Set() };
  const taken = new Map();
  for (const file of files) {
    if (isMarkdown(file)) {
      const path = pagePath(contentTarget(file, existing));
      const href = pageHref(path);
      if (taken.has(href)) throw new Error(`${file} and ${taken.get(href)} both publish at ${href}`);
      taken.set(href, file);
      site.pages.set(file, path);
      if (path === 'index' || path.endsWith('/index')) site.directories.set(posix.dirname(file) === '.' ? '' : posix.dirname(file), path);
    } else if (isImage(file)) {
      const directory = posix.dirname(file) === '.' ? [] : posix.dirname(file).split('/').map(slugSegment);
      site.images.set(file, [...directory, posix.basename(file)].join('/'));
    } else {
      site.files.add(file);
    }
  }
  if (site.pages.size === 0) throw new Error(`no Markdown found under ${options.source}`);

  const pages = [];
  for (const [file, path] of site.pages) {
    const text = readFileSync(join(options.source, file), 'utf8').replace(/\r\n/g, '\n');
    const target = join(options.out, `${path}.md`);
    mkdirSync(dirname(target), { recursive: true });
    const page = transformPage(text, file, site);
    await checkMdx(page, posix.join(options.docsPath, file));
    writeFileSync(target, page);
    pages.push({ file, path, title: pageTitle(text, file) });
  }
  for (const [file, target] of site.images) {
    mkdirSync(dirname(join(options.out, target)), { recursive: true });
    cpSync(join(options.source, file), join(options.out, target));
  }

  const byGroup = new Map();
  for (const page of pages) {
    if (page.path === 'index') continue;
    const top = page.path.includes('/') ? page.path.split('/')[0] : '';
    if (!byGroup.has(top)) byGroup.set(top, []);
    byGroup.get(top).push(page);
  }
  const order = [...byGroup.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  const indexFirst = (a, b) => Number(b.path.endsWith('/index')) - Number(a.path.endsWith('/index')) || a.path.localeCompare(b.path);
  const groups = order.map((top) => ({ name: top === '' ? 'Guides' : titleFromFileName(top), pages: byGroup.get(top).sort(indexFirst) }));

  let generated = false;
  if (!taken.has('/')) {
    const index = generatedIndex(options, groups);
    await checkMdx(index, 'the generated index');
    writeFileSync(join(options.out, 'index.md'), index);
    generated = true;
  }
  const navigation = [{ group: 'Overview', pages: ['index'] }, ...groups.map((group) => ({ group: group.name, pages: group.pages.map((page) => page.path) }))];
  const config = {
    $schema: 'https://mintlify.com/docs.json',
    theme: 'mint',
    name: options.title,
    description: options.description,
    colors: { primary: '#7C3AED', light: '#A78BFA', dark: '#6D28D9' },
    navigation: { groups: navigation },
  };
  writeFileSync(join(options.out, 'docs.json'), JSON.stringify(config, null, 2) + '\n');
  return { pages: pages.length + Number(generated), images: site.images.size, linkedFiles: site.files.size, excluded: all.length - files.length, generatedIndex: generated };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseOptions(process.argv.slice(2));
  const result = await build(options);
  const index = result.generatedIndex ? ' (index generated: no README at the docs root)' : '';
  console.log(`built ${result.pages} pages, ${result.images} images, ${result.linkedFiles} files linked to GitHub, ${result.excluded} excluded for ${options.repo}@${options.sha.slice(0, 7)} → ${options.out}${index}`);
}
