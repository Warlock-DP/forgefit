/* Free hosts have no persistent disk. Mirror only the managed notification/Coach JSON
 * files into Postgres; never copy the signing secret or the provider-owned Codex cache.
 * SESSION_SECRET remains a stable host environment variable, separate from the database.
 * One process/replica owns these files, just as it owns the account/state cache. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SETTING_KEY = 'runtime-files';
const ROOT_FILES = ['vapid.json', 'coach.json'];
const allowed = name => ROOT_FILES.includes(name) || /^coach\/[a-zA-Z0-9_-]+\.json$/.test(name);
const fingerprint = secret => crypto.createHash('sha256').update(secret).digest('hex');
const MAX_BYTES = 10 * 1024 * 1024;

function names(dataDir) {
  const files = ROOT_FILES.filter(name => fs.existsSync(path.join(dataDir, name)));
  const coachDir = path.join(dataDir, 'coach');
  if (fs.existsSync(coachDir)) {
    const stat = fs.lstatSync(coachDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid Coach data directory');
    for (const name of fs.readdirSync(coachDir)) {
      if (allowed('coach/' + name)) files.push('coach/' + name);
    }
  }
  return files.sort();
}

function snapshot(dataDir, secretHash) {
  const files = {};
  for (const name of names(dataDir)) {
    const file = path.join(dataDir, name);
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
      throw new Error('invalid managed runtime file');
    }
    files[name] = fs.readFileSync(file, 'utf8');
    JSON.parse(files[name]);
  }
  const value = { version: 1, secretHash, files };
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw new Error('runtime settings are too large');
  return value;
}

export async function createRuntimeState({ dataDir, storage, secret, enabled = false }) {
  if (!enabled) return { mode: 'files', async checkpoint() {} };
  if (storage.mode !== 'postgres') throw new Error('EPHEMERAL_CLOUD requires Postgres storage');
  if (!secret || secret.length < 32) throw new Error('EPHEMERAL_CLOUD requires a stable SESSION_SECRET of at least 32 characters');
  const secretHash = fingerprint(secret);
  const stored = await storage.loadSetting(SETTING_KEY);
  let saved = null;
  if (stored !== null) {
    if (stored.version !== 1 || !stored.files || typeof stored.files !== 'object' || Array.isArray(stored.files)) {
      throw new Error('invalid saved runtime settings');
    }
    if (stored.secretHash !== secretHash) throw new Error('SESSION_SECRET does not match saved cloud settings');
    if (Buffer.byteLength(JSON.stringify(stored)) > MAX_BYTES) throw new Error('saved runtime settings are too large');
    // Validate the entire document before writing any file. The database must never be able
    // to turn a restore into an arbitrary filesystem write, even with malformed saved data.
    for (const [name, content] of Object.entries(stored.files)) {
      if (!allowed(name) || typeof content !== 'string') throw new Error('invalid saved runtime file');
      JSON.parse(content);
    }
    // Verify existing managed paths before creating any directory or replacing a file.
    // In particular, mkdir/readFile must not follow a pre-existing Coach directory symlink.
    const existing = names(dataDir);
    for (const name of existing) {
      const stat = fs.lstatSync(path.join(dataDir, name));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid managed runtime file');
    }
    for (const [name, content] of Object.entries(stored.files)) {
      const file = path.join(dataDir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('invalid managed runtime file');
      const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
      fs.writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, file);
    }
    for (const name of existing) {
      if (!Object.hasOwn(stored.files, name)) fs.unlinkSync(path.join(dataDir, name));
    }
    saved = JSON.stringify(stored);
  }

  let writes = Promise.resolve();
  return {
    mode: 'postgres',
    checkpoint() {
      let value;
      try { value = snapshot(dataDir, secretHash); }
      catch (error) { return Promise.reject(error); }
      const serialized = JSON.stringify(value);
      const result = writes.then(async () => {
        if (serialized === saved) return;
        await storage.saveSetting(SETTING_KEY, value);
        saved = serialized;
      });
      // Keep the queue usable after a transient database failure. The caller still receives
      // the rejecting promise; a failed snapshot is never marked saved and is retried.
      writes = result.catch(() => {});
      return result;
    }
  };
}
