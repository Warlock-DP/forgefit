import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// The existing app treats account metadata and each profile's workout state as atomic
// documents. Keeping that contract makes the cloud migration safe while Postgres gives us
// durable backups, concurrent access, and a clean path to normalized tables later.
export const appMeta = pgTable('forgefit_app_meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const userStates = pgTable('forgefit_user_states', {
  userId: text('user_id').primaryKey(),
  state: jsonb('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});
