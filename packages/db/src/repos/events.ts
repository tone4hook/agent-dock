import type Database from "better-sqlite3";
import type { AgentProvider, AgentRunEventRecord } from "@agent-dock/shared";

interface AgentRunEventRow {
  id: number;
  run_id: string;
  event_type: string;
  provider: AgentProvider | null;
  payload_json: string;
  created_at: string;
}

function mapAgentRunEvent(row: AgentRunEventRow): AgentRunEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    eventType: row.event_type,
    provider: row.provider,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
  };
}

export interface CreateAgentRunEventInput {
  runId: string;
  eventType: string;
  provider?: AgentProvider | null;
  payload: unknown;
}

export class AgentRunEventsRepo {
  constructor(private readonly db: Database.Database) {}

  listForRun(runId: string, after = 0): AgentRunEventRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_run_events WHERE run_id = ? AND id > ? ORDER BY id ASC")
      .all(runId, after) as AgentRunEventRow[];
    return rows.map(mapAgentRunEvent);
  }

  create(input: CreateAgentRunEventInput): AgentRunEventRecord {
    const result = this.db.prepare(`
      INSERT INTO agent_run_events (run_id, event_type, provider, payload_json)
      VALUES (?, ?, ?, ?)
    `).run(input.runId, input.eventType, input.provider ?? null, JSON.stringify(input.payload));
    const row = this.db
      .prepare("SELECT * FROM agent_run_events WHERE id = ?")
      .get(result.lastInsertRowid) as AgentRunEventRow | undefined;
    if (!row) throw new Error("Failed to create run event");
    return mapAgentRunEvent(row);
  }
}
