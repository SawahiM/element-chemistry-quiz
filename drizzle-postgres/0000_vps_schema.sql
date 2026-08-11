CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "username" text,
  "password_hash" text,
  "account_type" text NOT NULL,
  "guest_credential_hash" text,
  "display_name" text NOT NULL,
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
