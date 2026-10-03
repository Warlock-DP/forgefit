CREATE TABLE IF NOT EXISTS "forgefit_app_meta" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forgefit_user_states" (
  "user_id" text PRIMARY KEY NOT NULL,
  "state" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
