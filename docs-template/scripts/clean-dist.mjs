// Empties dist/ before a build. Astro only clears its own outDir (dist/<project>/docs/), so a
// previous build for another project, or a stale _headers, would otherwise survive at the root
// and the Worker would upload it.
import { rmSync } from 'node:fs';

rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
