// After the deploy: the docs answer from their own Worker under the base with the policy headers,
// search assets resolve under the base, the stamp shows this commit, and the hub still owns the
// project page next door (route precedence over the Custom Domain, PLAN P2-07 risk).
import { readFileSync } from 'node:fs';

import { docsHeaders } from './lib.mjs';

const build = JSON.parse(readFileSync(new URL('../.docs-build.json', import.meta.url), 'utf8'));
const origin = 'https://the40thieves.dev';
const retries = Number(process.env.VERIFY_RETRIES ?? 12);
const delayMs = Number(process.env.VERIFY_DELAY_MS ?? 10_000);

async function get(path) {
  const response = await fetch(`${origin}${path}`, { redirect: 'manual', headers: { 'user-agent': 'the40thieves-docs-verify' } });
  const body = response.headers.get('content-type')?.includes('text/html') ? await response.text() : '';
  return { status: response.status, headers: response.headers, body };
}

function check(failures, condition, message) {
  if (!condition) failures.push(message);
}

async function attempt() {
  const failures = [];
  const home = await get(`${build.base}/`);
  check(failures, home.status === 200, `${build.base}/ answered ${home.status}`);
  for (const [name, value] of docsHeaders(build.project)) {
    check(failures, home.headers.get(name) === value, `${build.base}/ ${name} is ${home.headers.get(name) ?? 'missing'}`);
  }
  check(failures, home.body.includes(build.sha.slice(0, 7)), `${build.base}/ does not show commit ${build.sha.slice(0, 7)} (an older build is still live)`);

  const search = await get(`${build.base}/pagefind/pagefind.js`);
  check(failures, search.status === 200, `${build.base}/pagefind/pagefind.js answered ${search.status}`);

  const missing = await get(`${build.base}/this-page-does-not-exist/`);
  check(failures, missing.status === 404, `${build.base}/this-page-does-not-exist/ answered ${missing.status}`);

  const hub = await get(`/${build.project}/`);
  check(failures, hub.status === 200, `/${build.project}/ answered ${hub.status}`);
  check(failures, hub.headers.get('x-served-by') === null, `/${build.project}/ is served by ${hub.headers.get('x-served-by')}; the docs route shadows the hub`);
  return failures;
}

for (let i = 1; i <= retries; i += 1) {
  const failures = await attempt();
  if (failures.length === 0) {
    console.log(`verify-live: ${origin}${build.base}/ serves ${build.repo}@${build.sha.slice(0, 7)} from ${build.project}-docs`);
    process.exit(0);
  }
  console.log(`attempt ${i}/${retries}: ${failures.join('; ')}`);
  if (i < retries) await new Promise((done) => setTimeout(done, delayMs));
}
process.exit(1);
