import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { appMeta, userStates } from './db/schema.js';

const EMPTY_DB = { users: [], creds: [], subs: [], invites: [] };
const safe = uid => String(uid).replace(/[^a-zA-Z0-9_-]/g, '');

function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function fileStorage(dataDir) {
  const dbFile = path.join(dataDir, 'db.json');
  const stateFile = uid => path.join(dataDir, 'state-' + safe(uid) + '.json');
  const states = new Map();

  return {
    mode: 'files',
    async loadDatabase() {
      try { return { ...EMPTY_DB, ...JSON.parse(fs.readFileSync(dbFile, 'utf8')) }; }
      catch { return { ...EMPTY_DB }; }
    },
    readState(uid) {
      if (states.has(uid)) return states.get(uid);
      try {
        const state = JSON.parse(fs.readFileSync(stateFile(uid), 'utf8'));
        states.set(uid, state);
        return state;
      } catch { return null; }
    },
    async saveDatabase(value) { atomicWrite(dbFile, JSON.stringify(value, null, 2)); },
    async saveState(uid, state) {
      states.set(uid, state);
      atomicWrite(stateFile(uid), JSON.stringify(state));
    },
    async close() {}
  };
}

async function postgresStorage(connectionString) {
  const pool = new pg.Pool({ connectionString, max: +(process.env.DB_POOL_SIZE || 5) });
  const database = drizzle(pool);
  const states = new Map();
  let writes = Promise.resolve();
  const enqueueWrite = work => {
    const result = writes.then(work, work);
    writes = result.catch(() => {});
    return result;
  };
  const rows = await database.select().from(userStates);
  for (const row of rows) states.set(row.userId, row.state);

  return {
    mode: 'postgres',
    async loadDatabase() {
      const rows = await database.select().from(appMeta).where(eq(appMeta.key, 'core')).limit(1);
      return { ...EMPTY_DB, ...(rows[0]?.value || {}) };
    },
    readState(uid) { return states.get(uid) || null; },
    async saveDatabase(value) {
      const snapshot = structuredClone(value);
      await enqueueWrite(() => database.insert(appMeta).values({ key: 'core', value: snapshot, updatedAt: new Date() })
        .onConflictDoUpdate({ target: appMeta.key, set: { value: snapshot, updatedAt: new Date() } }));
    },
    async saveState(uid, state) {
      const snapshot = structuredClone(state);
      await enqueueWrite(async () => {
        await database.insert(userStates).values({ userId: uid, state: snapshot, updatedAt: new Date() })
          .onConflictDoUpdate({ target: userStates.userId, set: { state: snapshot, updatedAt: new Date() } });
        states.set(uid, snapshot);
      });
    },
    async close() { await writes; await pool.end(); }
  };
}

export async function createStorage({ dataDir }) {
  if (!process.env.DATABASE_URL) return fileStorage(dataDir);
  return postgresStorage(process.env.DATABASE_URL);
}
