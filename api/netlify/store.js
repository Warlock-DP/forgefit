// No account/state caches: every function invocation reads the authoritative database.
// Advisory transaction locks also protect missing rows, unlike SELECT FOR UPDATE alone.
import { neon, Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { drizzle as httpDrizzle } from 'drizzle-orm/neon-http';
import { drizzle as socketDrizzle } from 'drizzle-orm/neon-serverless';
import { and, eq, like, lt, sql } from 'drizzle-orm';
import { appMeta, userStates } from '../db/schema.js';

neonConfig.webSocketConstructor = ws;

function view(db) {
  return {
    async get(key) {
      const [row] = await db.select({ value: appMeta.value }).from(appMeta).where(eq(appMeta.key, key));
      return row?.value ?? null;
    },
    async set(key, value) {
      await db.insert(appMeta).values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: new Date() } });
    },
    async remove(key) { await db.delete(appMeta).where(eq(appMeta.key, key)); },
    async take(key) {
      const [row] = await db.delete(appMeta).where(eq(appMeta.key, key)).returning({ value: appMeta.value });
      return row?.value ?? null;
    },
    async state(uid) {
      const [row] = await db.select({ state: userStates.state }).from(userStates).where(eq(userStates.userId, uid));
      return row?.state ?? null;
    },
    async saveState(uid, state) {
      await db.insert(userStates).values({ userId: uid, state, updatedAt: new Date() })
        .onConflictDoUpdate({ target: userStates.userId, set: { state, updatedAt: new Date() } });
    },
    async states() { return db.select().from(userStates); },
    async cleanup() {
      // Challenges/rate limits are short-lived. Never prune accounts, workout data, or AI results.
      for (const prefix of ['challenge:%', 'rate:%']) {
        await db.delete(appMeta).where(and(like(appMeta.key, prefix), lt(appMeta.updatedAt, new Date(Date.now() - 86400000))));
      }
    }
  };
}

export function createNeonStore(url) {
  const reader = view(httpDrizzle(neon(url)));
  return {
    ...reader,
    async tx(keys, work) {
      const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10000 });
      try {
        return await socketDrizzle(pool).transaction(async db => {
          await db.execute(sql`set local statement_timeout = '15s'`);
          await db.execute(sql`set local lock_timeout = '10s'`);
          for (const key of [...new Set(keys)].sort()) {
            await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`forgefit:${key}`}, 0))`);
          }
          return work(view(db));
        });
      } finally { await pool.end(); }
    }
  };
}
