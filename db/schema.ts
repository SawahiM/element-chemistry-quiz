import { bigint, boolean, index, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username"),
  passwordHash: text("password_hash"),
  accountType: text("account_type", { enum: ["registered", "guest"] }).notNull(),
  guestCredentialHash: text("guest_credential_hash"),
  displayName: text("display_name").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("idx_users_username").on(table.username),
  uniqueIndex("idx_users_guest_credential").on(table.guestCredentialHash),
]);

export const authSessions = pgTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (table) => [
  index("idx_auth_sessions_user_id").on(table.userId),
  index("idx_auth_sessions_expires_at").on(table.expiresAt),
]);

export const userData = pgTable("user_data", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dataKey: text("data_key").notNull(),
  payload: text("payload").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.dataKey] }),
]);

export const historyRecords = pgTable("history_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientKey: text("client_key").notNull(),
  recordType: text("record_type", { enum: ["exam", "practice"] }).notNull(),
  quizKind: text("quiz_kind", { enum: ["color", "equation"] }).notNull(),
  source: text("source", { enum: ["practice", "exam"] }).notNull(),
  correct: boolean("correct"),
  payload: text("payload").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("idx_history_user_client_key").on(table.userId, table.clientKey),
  index("idx_history_user_created_at").on(table.userId, table.createdAt),
  index("idx_history_user_type_correct").on(table.userId, table.recordType, table.correct),
]);
