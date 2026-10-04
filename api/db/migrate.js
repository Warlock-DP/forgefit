import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log('database: no DATABASE_URL; file storage needs no migrations');
} else {
  // Neon recommends the direct connection for migrations. Runtime traffic continues to use
  // DATABASE_URL, which should be the pooled connection string.
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10000 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)) });
    console.log('database: migrations are current');
  } catch {
    // Netlify build logs can be public. Driver errors may contain private connection details.
    console.error('database: migration failed; check the direct database URL and migration on an isolated branch');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
