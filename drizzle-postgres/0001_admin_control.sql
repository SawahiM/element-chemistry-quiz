ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" bigint;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "login_count" bigint DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "app_settings" (
  "setting_key" text PRIMARY KEY NOT NULL,
  "setting_value" text NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "admin_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "action" text NOT NULL,
  "target_user_id" text,
  "details" text NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_admin_audit_created_at" ON "admin_audit_logs" ("created_at");
INSERT INTO "app_settings" ("setting_key", "setting_value", "updated_at")
VALUES ('registration_enabled', 'true', EXTRACT(EPOCH FROM NOW())::bigint)
ON CONFLICT ("setting_key") DO NOTHING;
