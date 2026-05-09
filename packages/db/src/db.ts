import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export function defaultDataDir(): string {
  return process.env.AGENT_DOCK_DATA_DIR ?? join(process.cwd(), ".agent-dock");
}

export function openDatabase(path = join(defaultDataDir(), "agent-dock.sqlite")): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export type { Database };
