import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('HTTP server keeps passkey/config/error responses working with asynchronous persistence', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgefit-server-'));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    env: {
      ...process.env, PORT: String(port), DATA_DIR: dataDir, DATABASE_URL: '',
      EPHEMERAL_CLOUD: 'false', SESSION_SECRET: 'a'.repeat(64), COACH_DISABLED: 'true',
      RP_ID: 'forgefit-rutvik.netlify.app', ORIGIN: 'https://forgefit-rutvik.netlify.app'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', data => {
      if (data.toString().includes('ForgeFit on')) { clearTimeout(timer); resolve(); }
    });
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited: ' + code)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  const health = await fetch(origin + '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, app: 'ForgeFit', users: 0, storage: 'files', runtimeStorage: 'files' });
  const config = await (await fetch(origin + '/api/config')).json();
  assert.equal(config.coach, undefined, 'disabled AI is not advertised');
  assert.equal((await fetch(origin + '/api/me')).status, 401);
  const invalid = await fetch(origin + '/api/register/options', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(invalid.status, 400);
  const registration = await fetch(origin + '/api/register/options', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Test"}'
  });
  assert.equal(registration.status, 200);
  const options = await registration.json();
  assert.equal(options.options.rp.id, 'forgefit-rutvik.netlify.app');
  assert.equal(options.options.rp.name, 'ForgeFit');
  assert.ok(options.cid);
});

test('host-disabled AI prevents even the administrator test from calling a provider', async () => {
  process.env.COACH_DISABLED = 'true';
  const jobs = await import('../coach/jobs.js');
  assert.deepEqual(await jobs.testRun(), { ok: false, error: 'AI is disabled by the host configuration' });
});
