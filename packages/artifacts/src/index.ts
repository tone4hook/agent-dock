import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface StoredArtifact {
  filePath: string;
  preview: string | null;
}

export class ArtifactStore {
  constructor(private readonly rootDir = process.env.AGENT_DOCK_ARTIFACT_DIR ?? join(process.cwd(), ".agent-dock", "artifacts")) {}

  async ensureRun(runId: string): Promise<string> {
    const dir = join(this.rootDir, runId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async writeText(runId: string, fileName: string, body: string): Promise<StoredArtifact> {
    const dir = await this.ensureRun(runId);
    const filePath = join(dir, fileName);
    await writeFile(filePath, body);
    return {
      filePath,
      preview: preview(body),
    };
  }
}

function preview(body: string): string | null {
  const compact = body.trim().replace(/\s+/g, " ");
  if (!compact) return null;
  return compact.slice(0, 280);
}
