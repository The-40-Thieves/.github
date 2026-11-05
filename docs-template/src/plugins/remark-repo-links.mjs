// Rewrites relative links in the synced Markdown so they work on the published site: see
// resolveRelativeLink in scripts/lib.mjs for the rules.
import { relative, resolve, sep } from 'node:path';

import { visit } from 'unist-util-visit';

import { resolveRelativeLink } from '../../scripts/lib.mjs';

export function remarkRepoLinks(build) {
  const contentRoot = resolve(build.contentDir);
  return (tree, file) => {
    if (!file.path) return;
    const fromFile = relative(contentRoot, file.path).split(sep).join('/');
    if (fromFile.startsWith('..')) return;
    visit(tree, (node) => {
      if (node.type !== 'link' && node.type !== 'definition' && node.type !== 'image') return;
      const next = resolveRelativeLink(node.url, fromFile, build, { image: node.type === 'image' });
      if (next !== null) node.url = next;
    });
  };
}
