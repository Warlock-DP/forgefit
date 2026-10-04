// Compile with Netlify's real bundler, without authentication or deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipFunctions } from '@netlify/zip-it-and-ship-it';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'forgefit-netlify-bundle-'));
const results = await zipFunctions(path.join(repo, 'frontend/netlify/functions'), destination, {
  archiveFormat: 'none', basePath: path.join(repo, 'frontend'), repositoryRoot: repo,
  config: { '*': { nodeBundler: 'esbuild', nodeVersion: '22',
    includedFiles: ['../api/coach/prompts/*.md', '../api/coach/library.json'] } }
});
assert.equal(results.length, 3);
const manifest = JSON.parse(await fs.readFile(path.join(destination, 'manifest.json'), 'utf8'));
assert.ok(manifest.functions.find(f => f.name === 'forgefit-api').routes.some(r => r.pattern === '/api/*'));
assert.equal(manifest.functions.find(f => f.name === 'forgefit-worker-background').invocationMode, 'background');
assert.equal(manifest.functions.find(f => f.name === 'forgefit-scheduled').schedule, '*/15 * * * *');
for (const entry of results) {
  assert.equal(entry.runtimeAPIVersion, 2, entry.name + ' must use the Request/Response API');
  // Modern Netlify web functions use NFT tracing with an esbuild transform internally.
  assert.equal(entry.bundler, 'nft');
  assert.ok(!entry.inputs.some(input => /coach[\\/]adapters[\\/](codex|claude)|coach[\\/](jobs|oauth)\.js/.test(input)), 'CLI code must stay out of serverless functions');
  console.log(`${entry.name}: bundled (${entry.runtimeAPIVersion === 2 ? 'web API' : 'legacy API'})`);
}
console.log('Bundles saved in ' + destination);
// Test that the compiled module loads without provider SDKs or any secrets.
const api = results.find(r => r.name === 'forgefit-api');
console.log('API bundle path: ' + api.path);
// Netlify archiveFormat:none puts the entry below the returned function directory.
const files = await fs.readdir(api.path, { recursive: true });
const entryName = files.find(name => path.basename(name) === 'forgefit-api.mjs');
assert.ok(entryName, 'expected ESM function entry');
assert.ok(files.some(name => name.replaceAll('\\', '/').endsWith('api/coach/prompts/common.md')), 'runtime prompts must be included at their original repo path');
assert.ok(files.some(name => name.replaceAll('\\', '/').includes('node_modules/@neondatabase/serverless/')), 'runtime database driver must be traced');
const oldDirectory = process.cwd();
const oldDatabaseUrl = process.env.DATABASE_URL;
try {
  // A developer's local environment must never turn this bundle smoke test into
  // an accidental production database check.
  delete process.env.DATABASE_URL;
  process.chdir(api.path);
  const module = await import(pathToFileURL(path.join(api.path, entryName)));
  const response = await module.default(new Request('https://forgefit-rutvik.netlify.app/api/health'));
  assert.equal(response.status, 503, 'missing secrets must fail closed in the real bundle');
} finally {
  process.chdir(oldDirectory);
  if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldDatabaseUrl;
}
