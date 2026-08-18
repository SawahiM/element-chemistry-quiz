CREATE TABLE IF NOT EXISTS "login_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "ip_address" text NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_login_events_user_created_at"
ON "login_events" ("user_id", "created_at" DESC);
