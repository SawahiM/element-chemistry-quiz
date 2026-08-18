CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "username" text,
  "password_hash" text,
  "account_type" text NOT NULL,
  "guest_credential_hash" text,
  "display_name" text NOT NULL,
  "role" text DEFAULT 'user' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_login_at" bigint,
  "login_count" bigint DEFAULT 0 NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_username" ON "users" ("username");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_guest_credential" ON "users" ("guest_credential_hash");

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "token_hash" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "expires_at" bigint NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_auth_sessions_user_id" ON "auth_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_expires_at" ON "auth_sessions" ("expires_at");

CREATE TABLE IF NOT EXISTS "login_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "ip_address" text NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_login_events_user_created_at" ON "login_events" ("user_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "user_data" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "data_key" text NOT NULL,
  "payload" text NOT NULL,
  "updated_at" bigint NOT NULL,
  PRIMARY KEY ("user_id", "data_key")
);

CREATE TABLE IF NOT EXISTS "history_records" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "client_key" text NOT NULL,
  "record_type" text NOT NULL,
  "quiz_kind" text NOT NULL,
  "source" text NOT NULL,
  "correct" boolean,
  "payload" text NOT NULL,
  "created_at" bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_history_user_client_key" ON "history_records" ("user_id", "client_key");
CREATE INDEX IF NOT EXISTS "idx_history_user_created_at" ON "history_records" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_history_user_type_correct" ON "history_records" ("user_id", "record_type", "correct");

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
