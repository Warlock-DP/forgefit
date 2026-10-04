import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRuntimeState } from '../runtime-state.js';

const SECRET = 'a'.repeat(64);
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgefit-runtime-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fakePostgres() {
  let stored = null;
  const writes = [];
  return {
    mode: 'postgres', writes,
    async loadSetting(key) { assert.equal(key, 'runtime-files'); return structuredClone(stored); },
    async saveSetting(key, value) {
      assert.equal(key, 'runtime-files');
      stored = structuredClone(value);
      writes.push(stored);
    },
    seed(value) { stored = structuredClone(value); }
  };
}

test('free-host restart restores managed JSON, without copying the signing secret or Codex credentials', async t => {
  const first = tempDir(t), restarted = tempDir(t), storage = fakePostgres();
  fs.mkdirSync(path.join(first, 'coach'));
  fs.mkdirSync(path.join(first, 'codex'));
  const config = { enabled: false, auth: { data: 'already-encrypted' } };
  const vapid = { publicKey: 'push-public', privateKey: 'push-private' };
  fs.writeFileSync(path.join(first, 'coach.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(first, 'vapid.json'), JSON.stringify(vapid));
  fs.writeFileSync(path.join(first, 'coach/u1.json'), JSON.stringify({ daily: { count: 2 }, pending: { id: 'p1' } }));
  fs.writeFileSync(path.join(first, 'secret'), SECRET);
  fs.writeFileSync(path.join(first, 'codex/auth.json'), 'provider-owned-private-cache');
  fs.writeFileSync(path.join(first, 'state-u1.json'), 'workout-state-is-stored-separately');
  const runtime = await createRuntimeState({ dataDir: first, storage, secret: SECRET, enabled: true });
  await runtime.checkpoint();
  await runtime.checkpoint();
  assert.equal(storage.writes.length, 1, 'read-only requests do not repeatedly write unchanged settings');
  assert.deepEqual(Object.keys(storage.writes[0].files).sort(), ['coach.json', 'coach/u1.json', 'vapid.json']);
  assert.ok(!JSON.stringify(storage.writes).includes(SECRET));
  assert.ok(!JSON.stringify(storage.writes).includes('provider-owned-private-cache'));

  const restored = await createRuntimeState({ dataDir: restarted, storage, secret: SECRET, enabled: true });
  assert.equal(restored.mode, 'postgres');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restarted, 'coach.json'))), config);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restarted, 'vapid.json'))), vapid);
  assert.equal(JSON.parse(fs.readFileSync(path.join(restarted, 'coach/u1.json'))).pending.id, 'p1');
  assert.equal(fs.existsSync(path.join(restarted, 'secret')), false);
});

test('serialized checkpoints preserve the newest update and profile forgetting across restarts', async t => {
  const first = tempDir(t), restarted = tempDir(t), storage = fakePostgres();
  fs.mkdirSync(path.join(first, 'coach'));
  fs.writeFileSync(path.join(first, 'coach/u1.json'), '{"pending":{"id":"p1"}}');
  const runtime = await createRuntimeState({ dataDir: first, storage, secret: SECRET, enabled: true });
  const old = runtime.checkpoint();
  fs.unlinkSync(path.join(first, 'coach/u1.json'));
  fs.writeFileSync(path.join(first, 'coach.json'), '{"enabled":false}');
  await Promise.all([old, runtime.checkpoint()]);
  assert.equal(Object.hasOwn(storage.writes.at(-1).files, 'coach/u1.json'), false);
  fs.mkdirSync(path.join(restarted, 'coach'));
  fs.writeFileSync(path.join(restarted, 'coach/u1.json'), '{"pending":{"id":"obsolete-local-copy"}}');
  await createRuntimeState({ dataDir: restarted, storage, secret: SECRET, enabled: true });
  assert.equal(fs.existsSync(path.join(restarted, 'coach/u1.json')), false, 'a forgotten profile is not restored from stale local files');
});

test('database failure rejects the checkpoint and unchanged data is retried', async t => {
  const dataDir = tempDir(t), storage = fakePostgres();
  const save = storage.saveSetting.bind(storage);
  storage.saveSetting = async () => { throw new Error('database unavailable'); };
  fs.writeFileSync(path.join(dataDir, 'vapid.json'), '{}');
  const runtime = await createRuntimeState({ dataDir, storage, secret: SECRET, enabled: true });
  await assert.rejects(runtime.checkpoint(), /database unavailable/);
  storage.saveSetting = save;
  await runtime.checkpoint();
  assert.equal(storage.writes.length, 1);
});

test('restore refuses path traversal, malformed JSON and a changed signing secret before writing', async t => {
  for (const files of [{ '../secret': '"bad"' }, { 'vapid.json': 'invalid JSON' }]) {
    const dataDir = tempDir(t), storage = fakePostgres();
    storage.seed({ version: 1, secretHash: crypto.createHash('sha256').update(SECRET).digest('hex'), files });
    await assert.rejects(createRuntimeState({ dataDir, storage, secret: SECRET, enabled: true }));
    assert.deepEqual(fs.readdirSync(dataDir), []);
  }
  const dataDir = tempDir(t), storage = fakePostgres();
  storage.seed({ version: 1, secretHash: 'different-secret', files: { 'vapid.json': '{}' } });
  await assert.rejects(createRuntimeState({ dataDir, storage, secret: SECRET, enabled: true }), /SESSION_SECRET/);
  assert.deepEqual(fs.readdirSync(dataDir), []);
});

test('ephemeral hosting requires Postgres and a stable secret; normal file deployments remain unchanged', async t => {
  const dataDir = tempDir(t);
  await assert.rejects(createRuntimeState({ dataDir, storage: { mode: 'files' }, secret: SECRET, enabled: true }), /Postgres/);
  await assert.rejects(createRuntimeState({ dataDir, storage: fakePostgres(), secret: 'short', enabled: true }), /SESSION_SECRET/);
  const runtime = await createRuntimeState({ dataDir, storage: { mode: 'files' } });
  await runtime.checkpoint();
  assert.equal(runtime.mode, 'files');
  assert.deepEqual(fs.readdirSync(dataDir), []);
});
