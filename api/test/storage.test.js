import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../storage.js';

test('file fallback persists account metadata and workout state across restarts', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rj-storage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; });

  const first = await createStorage({ dataDir: dir });
  assert.equal(first.mode, 'files');
  const core = { users: [{ id: 'u1', name: 'RJ' }], creds: [], subs: [], invites: [] };
  const state = { _ts: 42, workouts: [{ id: 'w1' }], routines: [] };
  await first.saveDatabase(core);
  await first.saveState('u1', state);

  const restarted = await createStorage({ dataDir: dir });
  assert.deepEqual(await restarted.loadDatabase(), core);
  assert.deepEqual(restarted.readState('u1'), state);
});
