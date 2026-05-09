import type Database from "better-sqlite3";
import { runtimeSettingsSchema, type RuntimeSettingsRecord } from "@agent-dock/shared";

interface SettingsRow {
  value: string;
}

export class SettingsRepo {
  constructor(private readonly db: Database.Database) {}

  getRuntime(): RuntimeSettingsRecord {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = ?").get("runtime") as SettingsRow | undefined;
    const raw = row ? (JSON.parse(row.value) as unknown) : {};
    return runtimeSettingsSchema.parse(raw);
  }

  setRuntime(settings: RuntimeSettingsRecord): RuntimeSettingsRecord {
    const parsed = runtimeSettingsSchema.parse(settings);
    this.db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('runtime', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(parsed));
    return parsed;
  }
}
