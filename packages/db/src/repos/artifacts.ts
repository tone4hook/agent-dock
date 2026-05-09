import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ArtifactRecord } from "@agent-dock/shared";

interface ArtifactRow {
  id: string;
  run_id: string;
  artifact_type: string;
  title: string;
  file_path: string;
  preview: string | null;
  created_at: string;
}

function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    runId: row.run_id,
    artifactType: row.artifact_type,
    title: row.title,
    filePath: row.file_path,
    preview: row.preview,
    createdAt: row.created_at,
  };
}

export interface CreateArtifactInput {
  runId: string;
  artifactType: string;
  title: string;
  filePath: string;
  preview?: string | null;
}

export class ArtifactsRepo {
  constructor(private readonly db: Database.Database) {}

  listForRun(runId: string): ArtifactRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as ArtifactRow[];
    return rows.map(mapArtifact);
  }

  create(input: CreateArtifactInput): ArtifactRecord {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO artifacts (id, run_id, artifact_type, title, file_path, preview)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.runId, input.artifactType, input.title, input.filePath, input.preview ?? null);
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
    if (!row) throw new Error("Failed to create artifact");
    return mapArtifact(row);
  }
}
