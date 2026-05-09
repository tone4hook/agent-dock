import type { ArtifactStore } from "@agent-dock/artifacts";
import type { ArtifactsRepo } from "@agent-dock/db";

interface RecordRunArtifactsArgs {
  artifactStore: ArtifactStore;
  artifactsRepo: ArtifactsRepo;
  runId: string;
  finalText: string;
  stdout: string;
  stderr: string;
}

const ARTIFACTS = [
  { type: "final_text", title: "Final Text", fileName: "final-text.md", body: (a: RecordRunArtifactsArgs) => a.finalText },
  { type: "stdout", title: "Stdout", fileName: "stdout.log", body: (a: RecordRunArtifactsArgs) => a.stdout },
  { type: "stderr", title: "Stderr", fileName: "stderr.log", body: (a: RecordRunArtifactsArgs) => a.stderr },
] as const;

export async function recordRunArtifacts(args: RecordRunArtifactsArgs): Promise<void> {
  for (const spec of ARTIFACTS) {
    const stored = await args.artifactStore.writeText(args.runId, spec.fileName, spec.body(args));
    args.artifactsRepo.create({
      runId: args.runId,
      artifactType: spec.type,
      title: spec.title,
      filePath: stored.filePath,
      preview: stored.preview,
    });
  }
}
