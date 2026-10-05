#!/usr/bin/env node
// Deploys OmniLaya to Cloudflare Workers on the free plan, end to end:
//   pnpm deploy:free path/to/omnilaya-secrets.env
//
// The secrets file is the one deploy/server/setup.sh writes, or any KEY=value file with
// SEARCH1API_API_KEY or SEARXNG_*, and LAYA_* settings. The only manual step is the first
// `wrangler login`, which opens a browser so you can allow access to your Cloudflare account.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const path = (p) => new URL(p, ROOT);
const KV_TITLE = 'omnilaya-search-cache';
const PLACEHOLDER_KV = 'replace-with-your-kv-namespace-id';
const ALLOWED = [
  'LAYA_PROVIDERS', 'LAYA_BASE_URL', 'LAYA_API_KEY', 'HF_ENDPOINT_URL', 'HF_TOKEN',
  'SEARCH_PROVIDER', 'SEARCH1API_API_KEY', 'SEARXNG_BASE_URL', 'SEARXNG_API_KEY',
];

const say = (text) => console.log(`\n==> ${text}`);
const fail = (text) => {
  console.error(`\nStopped: ${text}`);
  process.exit(1);
};

function run(cmd, args, { capture = false, allowFail = false } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    shell: process.platform === 'win32',
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.status !== 0 && !allowFail) {
    if (capture) console.error(out);
    fail(`${cmd} ${args.join(' ')} exited with ${res.status}`);
  }
  return { ok: res.status === 0, out };
}
const wrangler = (args, opts) => run('pnpm', ['exec', 'wrangler', ...args], opts);

function readSecrets(file) {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2] && ALLOWED.includes(m[1])) values[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const search = (values.SEARCH_PROVIDER ?? 'search1api').toLowerCase();
  if (search === 'searxng' && !values.SEARXNG_BASE_URL) fail('SEARCH_PROVIDER=searxng needs SEARXNG_BASE_URL in the secrets file');
  if (search !== 'searxng' && !values.SEARCH1API_API_KEY) fail('the secrets file needs SEARCH1API_API_KEY, or SEARCH_PROVIDER=searxng with SEARXNG_BASE_URL');
  if (!values.LAYA_BASE_URL && !values.HF_ENDPOINT_URL) fail('the secrets file needs LAYA_BASE_URL (or HF_ENDPOINT_URL and HF_TOKEN)');
  return values;
}

function ensureKvNamespace() {
  const config = readFileSync(path('wrangler.jsonc'), 'utf8');
  if (!config.includes(PLACEHOLDER_KV)) return;
  say(`Creating the KV namespace "${KV_TITLE}" for the result cache`);
  const created = wrangler(['kv', 'namespace', 'create', KV_TITLE], { capture: true, allowFail: true });
  let id = /"id":\s*"([0-9a-f]{32})"/.exec(created.out)?.[1];
  if (!id) {
    // Already created by an earlier run: look it up.
    const listed = wrangler(['kv', 'namespace', 'list'], { capture: true });
    const json = listed.out.slice(listed.out.indexOf('['));
    id = JSON.parse(json).find((ns) => ns.title === KV_TITLE || ns.title.endsWith(`-${KV_TITLE}`))?.id;
  }
  if (!id) fail(`could not create or find the KV namespace. Output:\n${created.out}`);
  writeFileSync(path('wrangler.jsonc'), config.replace(PLACEHOLDER_KV, id));
  console.log(`KV namespace ${id} written to wrangler.jsonc`);
}

function buildAndDeploy() {
  run('pnpm', ['run', 'build']);
  const deployed = wrangler(['deploy'], { capture: true, allowFail: true });
  process.stdout.write(deployed.out);
  if (!deployed.ok) {
    if (/rate.?limit/i.test(deployed.out)) {
      console.error('\nIf your plan does not allow the rate-limit binding, remove the "ratelimits" block from wrangler.jsonc and run again.');
    }
    fail('wrangler deploy failed');
  }
  return /https:\/\/[\w.-]+\.workers\.dev/.exec(deployed.out)?.[0];
}

function setOrigin(origin) {
  let changed = false;
  const swap = (file, pattern, value) => {
    const text = readFileSync(path(file), 'utf8');
    const next = text.replace(pattern, value);
    if (next !== text) {
      writeFileSync(path(file), next);
      changed = true;
    }
  };
  const current = /SITE_ORIGIN = '([^']+)'/.exec(readFileSync(path('src/lib/seo.ts'), 'utf8'))?.[1];
  if (!current || current === origin) return false;
  swap('src/lib/seo.ts', `SITE_ORIGIN = '${current}'`, `SITE_ORIGIN = '${origin}'`);
  swap('public/robots.txt', `${current}/sitemap.xml`, `${origin}/sitemap.xml`);
  swap('public/sitemap.xml', `<loc>${current}/</loc>`, `<loc>${origin}/</loc>`);
  return changed;
}

async function smokeTest(origin) {
  say(`Running one search against ${origin}`);
  const res = await fetch(`${origin}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ q: 'Rust async runtimes on Hacker News this month' }),
  });
  const text = await res.text();
  const first = text.split('\n').find(Boolean);
  const event = first ? JSON.parse(first) : null;
  if (event?.type === 'intent') {
    const done = text.includes('"type":"done"');
    console.log(`Laya read it: window ${event.window}, sources ${event.sources.join(', ')}${done ? '; search finished.' : '.'}`);
    return true;
  }
  console.log(`Unexpected answer (HTTP ${res.status}): ${text.slice(0, 300)}`);
  return false;
}

async function main() {
  const file = process.argv[2];
  if (!file) fail('pass the secrets file, e.g. pnpm deploy:free ./omnilaya-secrets.env');
  const secrets = readSecrets(file);

  say('Checking the Cloudflare login');
  if (!wrangler(['whoami'], { capture: true, allowFail: true }).out.match(/associated with the email|account id/i)) {
    say('Opening the browser for `wrangler login` (allow access, then come back here)');
    wrangler(['login']);
  }

  ensureKvNamespace();

  say('Building and deploying the Worker');
  const origin = buildAndDeploy();
  if (!origin) fail('deployed, but could not read the workers.dev address from the output');

  say('Uploading secrets');
  const dir = mkdtempSync(join(tmpdir(), 'omnilaya-'));
  const json = join(dir, 'secrets.json');
  try {
    writeFileSync(json, JSON.stringify(secrets), { mode: 0o600 });
    wrangler(['secret', 'bulk', json]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (setOrigin(origin)) {
    say(`Pointing canonical links, robots.txt and the sitemap at ${origin}, then redeploying`);
    buildAndDeploy();
  }

  const ok = await smokeTest(origin).catch((error) => {
    console.log(`Search check failed: ${error.message}`);
    return false;
  });
  say(ok ? `Live: ${origin}` : `Deployed to ${origin}, but the test search did not complete. Check the secrets and your Laya server.`);
}

main();
