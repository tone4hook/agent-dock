import { z } from "zod";
import { roleValues, runnerValues, type Role, type Runner } from "@agent-dock/shared";

// ---------- Permission mode (mirrors the SDK's claude options) ----------

export const permissionModeValues = [
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
] as const;

export type PermissionMode = (typeof permissionModeValues)[number];

// ---------- ContextPack ----------

export interface ContextPackProject {
  name: string;
  rootPath: string;
  defaultBaseRef: string;
}

export interface ContextPackTask {
  title: string;
  descriptionMd: string;
  status: string;
}

export interface ContextPackJiraLink {
  jiraKey: string;
  role: string;
  summary: string | null;
  status: string | null;
  descriptionMd: string | null;
  notesMd: string | null;
}

export interface ContextPackConfluenceLink {
  pageId: string;
  role: string;
  title: string | null;
  bodyMd: string | null;
  notesMd: string | null;
}

export interface ContextPackMetaContext {
  scopeType: string;
  scopeId: string;
  kind: string;
  bodyMd: string;
  /**
   * Optional ISO timestamp. When present, the renderer can sort entries
   * of the same kind chronologically (newest-first for kinds where
   * later supersedes earlier — e.g. `clarification_answers`,
   * `reviewer_feedback`).
   */
  createdAt?: string;
}

export interface ContextPackArtifact {
  kind: string;
  filePath: string;
  preview: string | null;
}

export interface ContextPackInput {
  project: ContextPackProject;
  task: ContextPackTask;
  jiraLinks: ContextPackJiraLink[];
  confluenceLinks: ContextPackConfluenceLink[];
  metaContexts: ContextPackMetaContext[];
  priorStepArtifacts: ContextPackArtifact[];
  role: RoleDef;
}

export interface ContextPack {
  markdown: string;
}

// ---------- Roles + Workflow ----------

/**
 * A role module. Output of `systemPromptBuilder` is what gets passed
 * to the SDK's `appendSystemPrompt`. The orchestrator reads
 * `expectedArtifacts` to decide which paths to watch for handoff
 * events (Phase 12).
 */
export interface RoleDef {
  role: Role;
  /** Claude model id, e.g. claude-sonnet-4-6, claude-opus-4-7. */
  model: string;
  /** Optional reasoning hint, e.g. "medium" for opus. */
  reasoningHint?: string;
  permissionMode: PermissionMode;
  /** SDK allowedTools whitelist — anything else is unavailable. */
  allowedTools: string[];
  /** Builds the system-prompt extension from the assembled ContextPack. */
  systemPromptBuilder: (pack: ContextPack) => string;
  /**
   * Handoff paths the role is expected to write. Phase 12's plan
   * watcher subscribes to `<sessionWorktree>/<expectedArtifact>`
   * for each entry and surfaces edits as `step_events`.
   */
  expectedArtifacts: string[];
  /**
   * If set, the orchestrator passes this to the SDK as `outputSchema`
   * so the assistant must return JSON conforming to it (Phase 14).
   */
  outputSchema?: Record<string, unknown>;
}

export interface PipelineStepDef {
  role: Role;
  ord: number;
  dependsOn?: string[];
  runner?: Runner;
}

export interface WorkflowDef {
  id: string;
  steps: PipelineStepDef[];
  /**
   * Lookup table keyed by role for fast access at run time. Only roles
   * actually used by `steps` need an entry — Phase 33's `validate` was
   * reverted so workflows can omit it; future workflows may declare any
   * subset of the global Role enum.
   */
  roles: Partial<Record<Role, RoleDef>>;
}

// ---------- Zod schemas (used at workflow-registration time) ----------

export const pipelineStepDefSchema = z.object({
  role: z.enum(roleValues),
  ord: z.number().int().min(0),
  dependsOn: z.array(z.string()).optional(),
  runner: z.enum(runnerValues).optional(),
});

export const roleDefShapeSchema = z.object({
  role: z.enum(roleValues),
  model: z.string().min(1),
  reasoningHint: z.string().optional(),
  permissionMode: z.enum(permissionModeValues),
  allowedTools: z.array(z.string()).min(1),
  expectedArtifacts: z.array(z.string()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});

/** Validates that a WorkflowDef is internally consistent. */
export function assertWorkflowDef(def: WorkflowDef): void {
  if (def.steps.length === 0) throw new Error(`Workflow ${def.id} has no steps`);

  const seenOrd = new Set<number>();
  for (const step of def.steps) {
    pipelineStepDefSchema.parse(step);
    if (seenOrd.has(step.ord)) {
      throw new Error(`Workflow ${def.id} has duplicate ord ${step.ord}`);
    }
    seenOrd.add(step.ord);
    if (!def.roles[step.role]) {
      throw new Error(`Workflow ${def.id} references missing role ${step.role}`);
    }
  }

  for (const role of roleValues) {
    if (def.roles[role]) {
      const r = def.roles[role];
      roleDefShapeSchema.parse({
        role: r.role,
        model: r.model,
        reasoningHint: r.reasoningHint,
        permissionMode: r.permissionMode,
        allowedTools: r.allowedTools,
        expectedArtifacts: r.expectedArtifacts,
        outputSchema: r.outputSchema,
      });
      if (r.role !== role) {
        throw new Error(`Workflow ${def.id} role key ${role} does not match its def.role ${r.role}`);
      }
    }
  }
}

export type { Role, Runner } from "@agent-dock/shared";
