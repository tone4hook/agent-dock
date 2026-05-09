import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { StepArtifact, StepEvent } from "@agent-dock/shared";

// --- StepEvents (append-only) ---

interface StepEventRow {
  id: number;
  step_id: string;
  kind: string;
  payload_json: string;
  created_at: string;
}

function mapStepEvent(row: StepEventRow): StepEvent {
  return {
    id: row.id,
    stepId: row.step_id,
    kind: row.kind,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
  };
}

export interface CreateStepEventInput {
  stepId: string;
  kind: string;
  payload: unknown;
}

export class StepEventsRepo {
  constructor(private readonly db: Database.Database) {}

  listForStep(stepId: string, after = 0): StepEvent[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM step_events WHERE step_id = ? AND id > ? ORDER BY id ASC",
        )
        .all(stepId, after) as StepEventRow[]
    ).map(mapStepEvent);
  }

  append(input: CreateStepEventInput): StepEvent {
    const result = this.db
      .prepare(
        `INSERT INTO step_events (step_id, kind, payload_json) VALUES (?, ?, ?)`,
      )
      .run(input.stepId, input.kind, JSON.stringify(input.payload));
    const row = this.db
      .prepare("SELECT * FROM step_events WHERE id = ?")
      .get(result.lastInsertRowid) as StepEventRow | undefined;
    if (!row) throw new Error("Failed to append step event");
    return mapStepEvent(row);
  }
}

// --- StepArtifacts ---

interface StepArtifactRow {
  id: string;
  step_id: string;
  kind: string;
  file_path: string;
  preview: string | null;
  created_at: string;
}

function mapStepArtifact(row: StepArtifactRow): StepArtifact {
  return {
    id: row.id,
    stepId: row.step_id,
    kind: row.kind,
    filePath: row.file_path,
    preview: row.preview,
    createdAt: row.created_at,
  };
}

export interface CreateStepArtifactInput {
  stepId: string;
  kind: string;
  filePath: string;
  preview?: string | null;
}

export class StepArtifactsRepo {
  constructor(private readonly db: Database.Database) {}

  listForStep(stepId: string): StepArtifact[] {
    return (
      this.db
        .prepare("SELECT * FROM step_artifacts WHERE step_id = ? ORDER BY created_at ASC")
        .all(stepId) as StepArtifactRow[]
    ).map(mapStepArtifact);
  }

  create(input: CreateStepArtifactInput): StepArtifact {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO step_artifacts (id, step_id, kind, file_path, preview)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.stepId, input.kind, input.filePath, input.preview ?? null);
    const row = this.db
      .prepare("SELECT * FROM step_artifacts WHERE id = ?")
      .get(id) as StepArtifactRow | undefined;
    if (!row) throw new Error("Failed to create step artifact");
    return mapStepArtifact(row);
  }

  /**
   * Phase 37 — clear stale artifacts of a given kind on a step, used
   * when the orchestrator needs to replace (not append) an artifact:
   *   - clarify_questions when the planner re-emits open_questions on
   *     a re-run, so submitClarificationAnswers finds the new set.
   */
  deleteByKind(stepId: string, kind: string): number {
    const info = this.db
      .prepare("DELETE FROM step_artifacts WHERE step_id = ? AND kind = ?")
      .run(stepId, kind);
    return info.changes;
  }
}
