// Pure helpers shared by the sync script and the remark plugin. No I/O here, so node --test
// covers them without a docs tree.
import { posix } from 'node:path';

import GithubSlugger from 'github-slugger';

const slugger = new GithubSlugger();

export const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.mdown', '.mkdn', '.mkd', '.mdwn']);
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif']);

export function isMarkdown(file) {
  return MARKDOWN_EXTENSIONS.has(posix.extname(file).toLowerCase());
}

export function isImage(file) {
  return IMAGE_EXTENSIONS.has(posix.extname(file).toLowerCase());
}

/** One path segment the way Astro's glob loader slugs it (github-slugger, lowercased). */
export function slugSegment(segment) {
  slugger.reset();
  return slugger.slug(segment, false).toLowerCase();
}

/**
 * The page URL a docs-relative Markdown path gets under `base`, mirroring Astro's default
 * `generateId`: every segment slugged, the extension dropped, a trailing `index` (or the
 * `README` the sync step renames to it) folded into its directory, trailing slash always.
 */
export function pageUrl(base, docsRelativeMarkdownPath) {
  const withoutExt = docsRelativeMarkdownPath.replace(/\.[^./]+$/, '');
  const segments = withoutExt.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (last !== undefined && /^(index|readme)$/i.test(last)) segments.pop();
  const path = segments.map(slugSegment).join('/');
  return path === '' ? `${base}/` : `${base}/${path}/`;
}

const ABSOLUTE_OR_FRAGMENT = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;

/**
 * Resolve one relative link found in `fromFile` (docs-relative path of the Markdown source).
 * Returns the replacement URL, or null when the link should stay as written.
 *
 * - Markdown inside the docs tree becomes its page URL under `base`.
 * - Images inside the docs tree stay relative; Astro resolves and optimises them.
 * - Other files inside the docs tree point at their copy under `base` (the sync step mirrors
 *   them into `public/`).
 * - Anything that escapes the docs tree but stays in the repository points at GitHub at the
 *   built commit (`blob` for links, `raw` for images), so the docs never 404 on a sibling file.
 */
export function resolveRelativeLink(url, fromFile, build, { image = false } = {}) {
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
  const directoryLink = path.endsWith('/');
  let target = posix.normalize(posix.join(posix.dirname(fromFile), path));
  if (target === '.') target = '';
  if (directoryLink && target !== '') target = `${target}/index.md`;
  if (target === '') return `${pageUrl(build.base, 'index.md')}${hash}`;

  if (target === '..' || target.startsWith('../')) {
    const repoPath = posix.normalize(posix.join(build.docsPath, target));
    if (repoPath === '..' || repoPath.startsWith('../')) return null;
    const kind = image ? 'raw' : 'blob';
    return `https://github.com/${build.repo}/${kind}/${build.sha}/${encodeURI(repoPath)}${hash}`;
  }
  if (isMarkdown(target)) return `${pageUrl(build.base, target)}${hash}`;
  if (isImage(target)) return null;
  return `${build.base}/${encodeURI(target)}${hash}`;
}

/** Split a Markdown document into its YAML frontmatter block (without fences) and body. */
export function splitFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { frontmatter: null, body: text };
  return { frontmatter: match[1], body: text.slice(match[0].length) };
}

export function hasFrontmatterKey(frontmatter, key) {
  if (frontmatter === null) return false;
  return new RegExp(`^${key}\\s*:`, 'm').test(frontmatter);
}

/**
 * The first level-one heading of a Markdown body and the body with that heading removed
 * (Starlight renders the title itself, so leaving it would show twice). Null when absent.
 */
export function takeFirstHeading(body) {
  const lines = body.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      lines.splice(i, 1);
      if (lines[i] === '' || lines[i] === '\r') lines.splice(i, 1);
      return { title: match[1].trim(), body: lines.join('\n') };
    }
    if (line.trim() !== '') break;
  }
  return null;
}

/** A readable fallback title from a file name: `tool-selection-eval.md` → `Tool selection eval`. */
export function titleFromFileName(file) {
  const stem = posix.basename(file).replace(/\.[^.]+$/, '');
  const words = stem.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Strip inline Markdown from a heading so the title reads plainly in the sidebar and tab. */
export function plainTitle(markdown) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .trim();
}

/** A YAML double-quoted scalar (JSON strings are valid YAML). */
export function yamlString(value) {
  return JSON.stringify(value);
}

/** The response headers every docs page carries; the hub's static class, plus the Worker tag. */
export function docsHeaders(project) {
  return [
    ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['X-Frame-Options', 'DENY'],
    ['Content-Security-Policy', "frame-ancestors 'none'"],
    [
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    ],
    ['X-Served-By', `${project}-docs`],
  ];
}

/** The Cloudflare `_headers` file for a docs Worker; paths are public URLs, so they carry the base. */
export function headersFile(project, base) {
  const lines = docsHeaders(project).map(([name, value]) => `  ${name}: ${value}`);
  return [`${base}/*`, ...lines].join('\n') + '\n';
}
