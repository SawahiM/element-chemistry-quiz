import postgres from "postgres";

type QueryParameter = string | number | boolean | null;
type DatabaseClient = {
  query<T extends Record<string, unknown>>(statement: string, params?: QueryParameter[]): Promise<{ rows: T[] }>;
};
type DatabaseGlobal = typeof globalThis & {
  __chemQuizDatabase?: DatabaseClient;
};

function createDatabase(): DatabaseClient {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase())) {
    throw new Error("DATABASE_URL must point to the loopback interface.");
  }
  const sql = postgres(connectionString, { max: 10, idle_timeout: 30, connect_timeout: 5 });
  return {
    async query<T extends Record<string, unknown>>(statement: string, params: QueryParameter[] = []) {
      return { rows: await sql.unsafe(statement, params) as unknown as T[] };
    },
  };
}

export function getDatabase(): DatabaseClient {
  const shared = globalThis as DatabaseGlobal;
  shared.__chemQuizDatabase ??= createDatabase();
  return shared.__chemQuizDatabase;
}
