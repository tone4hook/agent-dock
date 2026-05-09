import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
  AtlassianCacheRepo,
  MetaContextsRepo,
  PipelineStepsRepo,
  ProjectsRepo,
  SessionsRepo,
  StepArtifactsRepo,
  StepEventsRepo,
  TaskLinksRepo,
  TasksRepo,
  WorkflowRunsRepo,
} from "@agent-dock/db";
import type {
  ContextPackConfluenceLink,
  ContextPackInput,
  ContextPackJiraLink,
  ContextPackMetaContext,
  RoleDef,
  WorkflowDef,
} from "@agent-dock/workflows";
import { buildContextPack, validatePlan } from "@agent-dock/workflows";
import { WorktreeManager } from "@agent-dock/worktrees";
import type { StepRunner, StepRunnerEvent } from "@agent-dock/agents";
import { EventBus, type OrchestratorEvent } from "./eventBus.js";
import { PlanWatcher, type PlanWatcherEvent } from "./planWatcher.js";

export interface WorkflowCoordinatorDeps {
  repos: {
    sessions: SessionsRepo;
    tasks: TasksRepo;
    projects: ProjectsRepo;
    taskLinks: TaskLinksRepo;
    atlassianCache: AtlassianCacheRepo;
    metaContexts: MetaContextsRepo;
    workflowRuns: WorkflowRunsRepo;
    pipelineSteps: PipelineStepsRepo;
    stepEvents: StepEventsRepo;
    stepArtifacts: StepArtifactsRepo;
  };
  worktrees: WorktreeManager;
  runner: StepRunner;
  workflow: WorkflowDef;
  eventBus: EventBus;
  /**
   * Where worktrees live — `<workspaceDir>/worktrees/<projectId>/<sessionId>`.
   * Pass either a literal string or a getter so the value can change at
   * runtime when the user updates settings.
   */
  workspaceDir: string | (() => string | null);
  /**
   * Cap on concurrent active sessions (running | awaiting_approval |
   * paused). Default 3. Reading via a getter lets the user adjust the
   * cap at runtime via Settings without a restart.
   */
  maxConcurrentSessions?: number | (() => number);
}

export interface StartSessionOptions {
  /** Override the project's default base ref. */
  baseRefOverride?: string | null;
}

export interface StartSessionResult {
  sessionId: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
}

interface ReviewIssue {
  severity?: string;
  file?: string;
  message?: string;
}

interface ReviewPerIdResult {
  id: string;
  passed: boolean;
  evidence?: string;
}

interface ReviewVerdict {
  passed: boolean;
  summary?: string;
  issues?: ReviewIssue[];
  acceptance_results?: ReviewPerIdResult[];
  phase_results?: ReviewPerIdResult[];
}

interface ClarifyQuestion {
  id: string;
  text: string;
  default?: string;
}

interface ActiveSession {
  abort: AbortController;
  promise: Promise<void>;
  planWatcher: PlanWatcher | null;
  /** Set by pause(); consumed by runStep to differentiate pause from cancel. */
  pausing: boolean;
  /** Optional thread id passed to the next runStep invocation (resume path). */
  pendingResumeThreadId: string | null;
}

/**
 * Drives one session through its workflow. Phase 11 only runs the
 * first pending step (typically `investigate`) and stops; Phase 13
 * adds the awaiting_approval gate that decides when to advance.
 */
export class WorkflowCoordinator {
  private readonly active = new Map<string, ActiveSession>();

  constructor(private readonly deps: WorkflowCoordinatorDeps) {}

  /**
   * Build the full session: create worktree, write .context/PACK.md,
   * create workflow_run + pipeline_step rows, kick off the first step.
   * Returns when setup is done; the run continues asynchronously.
   */
  async start(taskId: string, opts: StartSessionOptions = {}): Promise<StartSessionResult> {
    const task = this.deps.repos.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const project = this.deps.repos.projects.get(task.projectId);
    if (!project) throw new Error(`Project ${task.projectId} not found`);

    const workspaceDir = this.resolveWorkspaceDir();
    if (!workspaceDir) {
      throw new Error("No workspaceDir configured; set one in onboarding/Settings first.");
    }

    const cap = this.resolveMaxConcurrent();
    const activeCount = this.deps.repos.sessions.countActive();
    if (activeCount >= cap) {
      const err: Error & { status?: number; code?: string } = new Error(
        `session cap reached (${activeCount}/${cap})`,
      );
      err.status = 409;
      err.code = "session_cap_reached";
      throw err;
    }

    // Pre-allocate session id so the worktree dir uses it.
    const sessionRow = this.deps.repos.sessions.create({
      taskId: task.id,
      baseRef: "pending", // updated after worktree creation
      branch: "pending",
      worktreePath: "pending",
    });

    let worktreePath = "";
    let branch = "";
    let baseRef = "";
    try {
      const baseRefRequested = opts.baseRefOverride ?? task.baseRefOverride ?? undefined;
      const created = await this.deps.worktrees.create({
        projectRoot: project.rootPath,
        projectId: project.id,
        taskId: task.id,
        sessionId: sessionRow.id,
        workspaceDir,
        baseRef: baseRefRequested,
      });
      worktreePath = created.worktreePath;
      branch = created.branch;
      baseRef = created.baseRef;

      this.deps.repos.sessions.update(sessionRow.id, {
        startedAt: new Date().toISOString(),
        status: "running",
      });
      // Persist the canonical worktree metadata via the dedicated
      // SessionsRepo.setMeta method (clears the type-cast smell from
      // the Phase 11 reviewer's follow-up).
      this.deps.repos.sessions.setMeta(sessionRow.id, { worktreePath, branch, baseRef });
    } catch (err) {
      this.deps.repos.sessions.update(sessionRow.id, {
        status: "failed",
        endedAt: new Date().toISOString(),
      });
      throw err;
    }

    // ContextPack. Atomic write so a killed-mid-write process can never
    // leave an empty file that the runStep guard would then reject.
    const pack = this.buildPackForRole(task.id, this.deps.workflow.steps[0].role);
    const packPath = join(worktreePath, ".context", "PACK.md");
    writeFileAtomic(packPath, pack.markdown);

    // Workflow run + step rows.
    const run = this.deps.repos.workflowRuns.create({
      sessionId: sessionRow.id,
      workflowDefId: this.deps.workflow.id,
    });
    const steps = this.deps.workflow.steps
      .slice()
      .sort((a, b) => a.ord - b.ord)
      .map((step) =>
        this.deps.repos.pipelineSteps.create({
          runId: run.id,
          ord: step.ord,
          role: step.role,
          dependsOn: step.dependsOn ?? [],
          runner: step.runner,
        }),
      );

    this.deps.eventBus.publish(sessionRow.id, "session_status", {
      status: "running",
    });

    // Plan watcher catches edits to .plan/* and .handoff/*.json from
    // any source (agent, human, external editor) and surfaces them
    // as step_events on whichever step is current.
    const planWatcher = new PlanWatcher({
      worktreePath,
      onEvent: (e) => this.handleWatcherEvent(sessionRow.id, e),
    });
    try {
      await planWatcher.start();
    } catch (err) {
      // Watcher start should not block the session — log and continue.
      this.deps.eventBus.publish(sessionRow.id, "session_status", {
        status: "running",
        warning: `plan-watcher failed to start: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Kick off the first step asynchronously; setup returns now.
    // The active entry must be set BEFORE invoking runStep so the
    // sync prelude inside runStep sees its abort/pausing/etc.
    const firstStep = steps[0];
    const active: ActiveSession = {
      abort: new AbortController(),
      promise: Promise.resolve(),
      planWatcher,
      pausing: false,
      pendingResumeThreadId: null,
    };
    this.active.set(sessionRow.id, active);
    active.promise = this.runStep(
      sessionRow.id,
      firstStep.id,
      worktreePath,
      packPath,
    ).catch((err) => {
      this.deps.eventBus.publish(sessionRow.id, "session_status", {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return {
      sessionId: sessionRow.id,
      worktreePath,
      branch,
      baseRef,
    };
  }

  /** Run a single step from `pending` → `running` → terminal. */
  private async runStep(
    sessionId: string,
    stepId: string,
    worktreePath: string,
    contextPackPath: string,
  ): Promise<void> {
    const step = this.deps.repos.pipelineSteps.get(stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);

    const role = this.deps.workflow.roles[step.role] as RoleDef | undefined;
    if (!role) throw new Error(`Workflow has no role definition for ${step.role}`);

    // Mark running.
    this.deps.repos.pipelineSteps.update(stepId, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    this.deps.repos.sessions.update(sessionId, { currentStepId: stepId });
    this.publish(sessionId, stepId, "step_status", { status: "running", role: step.role });

    const active = this.active.get(sessionId);
    const signal = active?.abort.signal ?? new AbortController().signal;

    if (step.role === "plan") {
      this.clearPlanOutputs(stepId, worktreePath);
    }

    // The "prompt" we hand the runner is the rendered ContextPack —
    // the role's systemPromptBuilder wraps it in the role brief.
    const packRead = inspectPackFile(contextPackPath);
    if (packRead.kind !== "ok") {
      // Last-chance recovery: the pack file is missing/unreadable/empty
      // but we have everything we need to rebuild it deterministically
      // from the task + workflow + step row. Try once before failing the
      // session — the original silent-failure mode bit us when an
      // OS-level write hiccup left a 0-byte file behind.
      try {
        const session = this.deps.repos.sessions.get(sessionId);
        if (session) {
          this.refreshContextPack(session.taskId, stepId, worktreePath, contextPackPath);
        }
      } catch {
        // fall through to the hard-fail below
      }
    }
    const packTextFinal = this.readFile(contextPackPath);
    if (!packTextFinal.trim()) {
      // Hard fail — running a role with an empty pack is the silent
      // failure mode that bit us before (clarify role saw "no task
      // description" because the pack file was missing or unreadable).
      // Surface the actual cause so we never debug it via agent prose
      // again — was the file missing? unreadable? truly empty?
      const reason = describePackReadFailure(contextPackPath);
      const msg = `ContextPack at ${contextPackPath} is missing or empty for role ${step.role} (sessionId=${sessionId}, stepId=${stepId}, reason=${reason}). Refusing to run a role with no context.`;
      this.deps.repos.pipelineSteps.update(stepId, {
        status: "failed",
        endedAt: new Date().toISOString(),
      });
      this.deps.repos.stepEvents.append({
        stepId,
        kind: "step_status",
        payload: {
          status: "failed",
          error: msg,
          at: new Date().toISOString(),
        },
      });
      this.publish(sessionId, stepId, "step_status", {
        status: "failed",
        error: msg,
      });
      this.deps.repos.sessions.update(sessionId, {
        status: "failed",
        endedAt: new Date().toISOString(),
      });
      this.publish(sessionId, null, "session_status", {
        status: "failed",
        role: step.role,
        errorMessage: msg,
      });
      await this.stopWatcher(sessionId);
      this.deps.eventBus.closeSession(sessionId);
      return;
    }

    const onEvent = (e: StepRunnerEvent) => {
      this.persistStepEvent(stepId, e.kind, e.payload);
      this.publish(sessionId, stepId, e.kind, e.payload);
    };

    // Resume the SDK thread if we have a stashed id (set by resume()).
    const resumeThreadId = active?.pendingResumeThreadId ?? null;
    if (active) active.pendingResumeThreadId = null;

    const onThreadId = (threadId: string) => {
      this.deps.repos.pipelineSteps.update(stepId, { threadId });
    };

    let result;
    try {
      result = await this.deps.runner.run({
        role,
        workingDirectory: worktreePath,
        prompt: packTextFinal,
        signal,
        onEvent,
        resumeThreadId,
        onThreadId,
      });
    } catch (err) {
      result = {
        status: "failed" as const,
        threadId: null,
        finalText: "",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    // Persist threadId immediately (safe across crashes for resume).
    this.deps.repos.pipelineSteps.update(stepId, {
      threadId: result.threadId ?? null,
    });

    // Materialize expected artifacts. For Phase 11 (investigate), the
    // assistant's final text becomes .plan/findings.md.
    if (result.status === "completed") {
      if (step.role === "code_review" && result.json) {
        const abs = join(worktreePath, ".plan", "review_result.json");
        mkdirSync(dirname(abs), { recursive: true });
        writeFileAtomic(abs, JSON.stringify(result.json, null, 2));
        const verdict = result.json as ReviewVerdict;
        // Preview is the structured JSON itself (truncated by previewOf
        // when long) so the web client can parse `passed/summary/issues`
        // without a separate file-fetch round-trip.
        const preview = previewOf(JSON.stringify(verdict));
        const artifact = this.deps.repos.stepArtifacts.create({
          stepId,
          kind: "review_result",
          filePath: abs,
          preview,
        });
        this.publish(sessionId, stepId, "artifact", {
          kind: artifact.kind,
          path: abs,
          preview,
        });
      }
      for (const relPath of role.expectedArtifacts) {
        if (step.role === "plan" && relPath.endsWith("plan.json")) {
          continue;
        }
        const abs = join(worktreePath, relPath);
        // For outputSchema-driven JSON artifacts the structured output
        // (`result.json`) is the canonical source — `result.finalText`
        // can be a confirmation prose message that came BEFORE the
        // StructuredOutput tool call (which then has no text after it),
        // so writing finalText to plan.json was producing non-JSON
        // bodies that the post-completion router couldn't parse. Always
        // overwrite outputSchema JSON paths from `result.json`.
        const isOutputSchemaJson =
          role.outputSchema && relPath.endsWith(".json");
        if (isOutputSchemaJson) {
          if (result.json === undefined) {
            this.deps.repos.stepEvents.append({
              stepId,
              kind: "structured_output_missing",
              payload: {
                role: step.role,
                relPath,
                at: new Date().toISOString(),
              },
            });
            continue;
          }
          writeFileAtomic(abs, JSON.stringify(result.json, null, 2));
        } else if (!existsSync(abs)) {
          mkdirSync(dirname(abs), { recursive: true });
          writeFileAtomic(abs, result.finalText);
        }
        const preview = previewOf(this.readFile(abs));
        const artifact = this.deps.repos.stepArtifacts.create({
          stepId,
          kind: kindForArtifact(relPath),
          filePath: abs,
          preview,
        });
        this.publish(sessionId, stepId, "artifact", {
          kind: artifact.kind,
          path: abs,
          preview,
        });
      }
    }

    // Pause path: aborted because pause() was invoked. Keep the step
    // row mid-flight (status reverted to pending so resume picks it
    // up via findNextPendingStep / direct id) and transition the
    // session to `paused`. The watcher and event bus remain live so
    // the UI keeps streaming.
    const isPausing = active?.pausing === true;
    if (result.status === "cancelled" && isPausing) {
      this.deps.repos.pipelineSteps.update(stepId, {
        status: "pending",
        endedAt: null,
      });
      this.publish(sessionId, stepId, "step_status", {
        status: "pending",
        reason: "paused",
      });
      this.deps.repos.sessions.update(sessionId, { status: "paused" });
      this.publish(sessionId, null, "session_status", { status: "paused" });
      if (active) active.pausing = false;
      return;
    }

    // Phase 34: clarify fail-soft. An LLM hiccup in clarify (non-JSON
    // final text, network blip, schema parse error) should not hard-fail
    // the session — clarify is an optimization step, not a gate. Treat
    // a failed clarify as if the verdict were `all_clear`: log the
    // diagnostic in step_events for audit, mark the step completed,
    // and let the post-completion router auto-advance to plan.
    if (step.role === "clarify" && result.status === "failed") {
      this.deps.repos.stepEvents.append({
        stepId,
        kind: "clarify_failed_softfall",
        payload: {
          errorMessage: result.errorMessage ?? null,
          finalText: result.finalText ?? "",
          at: new Date().toISOString(),
        },
      });
      this.deps.repos.pipelineSteps.update(stepId, {
        status: "completed",
        endedAt: new Date().toISOString(),
      });
      this.publish(sessionId, stepId, "step_status", {
        status: "completed",
        reason: "clarify_failsoft",
        error: result.errorMessage ?? null,
      });
      // Fall through to the post-completion router below; clarify case
      // sees no verdict.json AND no clarify_questions artifact, so it
      // takes the all_clear branch and kicks off plan.
      result = {
        ...result,
        status: "completed" as const,
      };
    }

    // Hotfix — plan fail-soft. The SDK's outputSchema validator rejects
    // non-JSON final text with `result.status="failed"`; without this,
    // every retry hits the same wall and the session has no escape.
    // Mirror the clarify fail-soft pattern: log the diagnostic, mark
    // the step completed, persist a synthetic `plan_gaps` step_artifact
    // so PlanGapsPanel renders the parse error, and let the
    // post-completion router land the session in `awaiting_approval`.
    // The user can then Reject-with-prompt to send the planner concrete
    // feedback ("emit only the JSON object, no prose"). This avoids the
    // unrecoverable failure-loop the user reported on 2026-05-06.
    if (step.role === "plan" && result.status === "failed") {
      this.deps.repos.stepEvents.append({
        stepId,
        kind: "plan_failed_softfall",
        payload: {
          errorMessage: result.errorMessage ?? null,
          finalText: result.finalText ?? "",
          at: new Date().toISOString(),
        },
      });
      // Synthesize a plan_gaps artifact so the existing UI path renders
      // the parse error in the Gaps panel and pre-fills the Reject
      // textarea. The body_md format mirrors validatePlan's output.
      const gapLines = [
        `- Plan role failed: ${result.errorMessage ?? "unknown error"}`,
      ];
      const trimmedFinal = (result.finalText ?? "").trim();
      if (trimmedFinal.length > 0) {
        gapLines.push(
          `- Planner final text (first 200 chars): ${trimmedFinal.slice(0, 200)}`,
        );
      }
      gapLines.push(
        `- Reject-with-prompt to send the planner specific feedback (e.g. "emit only the JSON object — no prose, no markdown fences").`,
      );
      this.deps.repos.stepArtifacts.create({
        stepId,
        kind: "plan_gaps",
        filePath: join(worktreePath, ".plan", "plan.json"),
        preview: previewOf(gapLines.join("\n")),
      });
      this.deps.repos.pipelineSteps.update(stepId, {
        status: "completed",
        endedAt: new Date().toISOString(),
      });
      this.publish(sessionId, stepId, "step_status", {
        status: "completed",
        reason: "plan_failsoft",
        error: result.errorMessage ?? null,
      });
      this.deps.repos.sessions.update(sessionId, { status: "awaiting_approval" });
      this.publish(sessionId, null, "session_status", {
        status: "awaiting_approval",
        reason: "plan_failsoft",
      });
      await this.stopWatcher(sessionId);
      return;
    }

    // Final step status.
    this.deps.repos.pipelineSteps.update(stepId, {
      status: result.status,
      endedAt: new Date().toISOString(),
    });
    this.deps.repos.stepEvents.append({
      stepId,
      kind: "step_status",
      payload: {
        status: result.status,
        error: result.errorMessage ?? null,
        at: new Date().toISOString(),
      },
    });
    this.publish(sessionId, stepId, "step_status", {
      status: result.status,
      error: result.errorMessage ?? null,
    });

    if (result.status !== "completed") {
      // Failure / cancelled — close the session.
      const sessionStatus = result.status === "cancelled" ? "cancelled" : "failed";
      this.deps.repos.sessions.update(sessionId, {
        status: sessionStatus,
        endedAt: new Date().toISOString(),
      });
      // Phase 34: enrich the failure SSE with role + errorMessage so UI
      // consumers see the diagnostic without a separate DB read. The
      // cancelled path keeps the bare shape (cancellation is user-initiated
      // and self-explanatory).
      const failurePayload: Record<string, unknown> = { status: sessionStatus };
      if (sessionStatus === "failed") {
        failurePayload.role = step.role;
        failurePayload.errorMessage = result.errorMessage ?? null;
      }
      this.publish(sessionId, null, "session_status", failurePayload);
      await this.stopWatcher(sessionId);
      this.deps.eventBus.closeSession(sessionId);
      return;
    }

    // Post-completion branching by role (Phase 13 gate logic + Phase 33):
    //   investigate → auto-advance to clarify
    //   clarify     → all_clear: auto-advance; needs_input: pause for user
    //   plan        → session enters awaiting_approval; user gates
    //   implement   → auto-advance to code_review
    //   code_review → session completes or routes back via handleReviewFailure
    // (Phase 33's `validate` step was reverted; the case is gone.)
    //
    // For every auto-advance branch the pack MUST be refreshed before
    // kicking off the next step — without that the next role reads the
    // pack we wrote for the FIRST step (its role brief, no prior step
    // artifacts) and sees no task description / no findings / nothing.
    // The manual paths (approve/reject/submitClarification/retry) all
    // already call refreshContextPack; the auto-advance paths used to
    // skip it.
    const session = this.deps.repos.sessions.get(sessionId);
    if (!session) {
      // Defensive — sessions row should always exist at this point.
      return;
    }
    const advanceTo = (next: { id: string }) => {
      this.refreshContextPack(session.taskId, next.id, worktreePath, contextPackPath);
      this.kickoffStep(sessionId, next.id, worktreePath, contextPackPath);
    };

    switch (step.role) {
      case "investigate": {
        const next = this.findNextPendingStep(sessionId);
        if (next) {
          advanceTo(next);
        } else {
          this.completeSession(sessionId);
        }
        return;
      }
      case "clarify": {
        const verdict = result.json as
          | { status: "all_clear" }
          | { status: "needs_input"; questions: ClarifyQuestion[] }
          | undefined;
        if (verdict?.status === "needs_input" && Array.isArray(verdict.questions) && verdict.questions.length > 0) {
          // Persist questions as a step_artifact so the API + UI can
          // surface them; the orchestrator's expectedArtifacts fallback
          // already wrote .plan/clarify.json with the role's finalText,
          // but the artifact created by that path uses kind="artifact"
          // (kindForArtifact's fallthrough). Re-create with the
          // descriptive kind="clarify_questions" so consumers can find
          // it without parsing.
          const abs = join(worktreePath, ".plan", "clarify.json");
          this.deps.repos.stepArtifacts.create({
            stepId,
            kind: "clarify_questions",
            filePath: abs,
            preview: previewOf(JSON.stringify(verdict.questions)),
          });
          this.deps.repos.sessions.update(sessionId, {
            status: "awaiting_clarification",
          });
          this.publish(sessionId, stepId, "session_status", {
            status: "awaiting_clarification",
            reason: "needs_clarification",
          });
          await this.stopWatcher(sessionId);
          return;
        }
        // all_clear (or unparseable) — auto-advance to plan.
        const next = this.findNextPendingStep(sessionId);
        if (next) {
          advanceTo(next);
        } else {
          this.completeSession(sessionId);
        }
        return;
      }
      case "plan": {
        // Phase 37 — plan-completion three-way router driven by the
        // structured plan.json contract from Phase 36.
        //
        //   ok=true                          → awaiting_approval (existing path)
        //   ok=false, gapsKind='open_questions' → auto-route to clarify
        //   ok=false, gapsKind='other'        → awaiting_approval + plan_gaps
        //
        // The runner's structured output is the canonical plan. The
        // file is a durable artifact, not the control-flow source.
        const planJsonPath = join(worktreePath, ".plan", "plan.json");
        const planJson = result.json;
        if (planJson === undefined) {
          await this.planSoftFall(
            sessionId,
            stepId,
            "plan role produced no structured JSON",
            "",
            worktreePath,
          );
          return;
        }
        const validation = validatePlan(planJson);
        writeFileAtomic(planJsonPath, JSON.stringify(planJson, null, 2));
        const structuredPreview = previewOf(JSON.stringify(planJson));
        const structuredArtifact = this.deps.repos.stepArtifacts.create({
          stepId,
          kind: "plan_structured",
          filePath: planJsonPath,
          preview: structuredPreview,
        });
        this.publish(sessionId, stepId, "artifact", {
          kind: structuredArtifact.kind,
          path: planJsonPath,
          preview: structuredPreview,
        });

        // Hotfix — the plan role is JSON-only (no Edit/Write tools).
        // The orchestrator renders the human-readable task_plan.md
        // companion from the parsed plan whenever the plan parsed at
        // all (ok OR gapsKind:"other") so the UI's PlanReview fallback
        // path and downstream code_review have a markdown view.
        if (validation.plan) {
          const md = renderTaskPlanMarkdown(validation.plan);
          const mdPath = join(worktreePath, ".plan", "task_plan.md");
          writeFileAtomic(mdPath, md);
          this.deps.repos.stepArtifacts.create({
            stepId,
            kind: "plan",
            filePath: mdPath,
            preview: previewOf(md),
          });
        }

        if (validation.ok) {
          this.deps.repos.sessions.update(sessionId, { status: "awaiting_approval" });
          this.publish(sessionId, stepId, "session_status", {
            status: "awaiting_approval",
          });
          return;
        }

        if (validation.gapsKind === "open_questions" && validation.plan) {
          const clarifyStep = this.findLatestStepByRole(sessionId, "clarify");
          if (clarifyStep) {
            const questions = validation.plan.open_questions.map(
              (text: string, i: number) => ({
                id: `q${i + 1}`,
                text,
              }),
            );
            // Replace any prior clarify_questions on this clarify step
            // so submitClarificationAnswers picks up the new set.
            this.deps.repos.stepArtifacts.deleteByKind(
              clarifyStep.id,
              "clarify_questions",
            );
            const abs = join(worktreePath, ".plan", "clarify.json");
            writeFileAtomic(abs, JSON.stringify({ questions }, null, 2));
            this.deps.repos.stepArtifacts.create({
              stepId: clarifyStep.id,
              kind: "clarify_questions",
              filePath: abs,
              preview: previewOf(JSON.stringify(questions)),
            });
            // Reset plan step to pending so submitClarificationAnswers's
            // next-pending-kickoff re-runs the planner with the answers
            // in scope (via the meta_context the answers create).
            this.deps.repos.pipelineSteps.update(stepId, {
              status: "pending",
              startedAt: null,
              endedAt: null,
            });
            this.deps.repos.sessions.update(sessionId, {
              status: "awaiting_clarification",
            });
            this.publish(sessionId, stepId, "session_status", {
              status: "awaiting_clarification",
              reason: "plan_open_questions_route",
            });
            this.publish(sessionId, clarifyStep.id, "step_status", {
              reason: "plan_open_questions_route",
            });
            await this.stopWatcher(sessionId);
            return;
          }
          // Workflow has no clarify step — fall through to gaps-blocked.
        }

        // gapsKind === "other" (or open_questions on a workflow without
        // clarify): persist plan_gaps artifact, await human approval.
        const gapsBody = validation.errors.map((e: string) => `- ${e}`).join("\n");
        this.deps.repos.stepArtifacts.create({
          stepId,
          kind: "plan_gaps",
          filePath: planJsonPath,
          preview: previewOf(gapsBody),
        });
        this.deps.repos.sessions.update(sessionId, { status: "awaiting_approval" });
        this.publish(sessionId, stepId, "session_status", {
          status: "awaiting_approval",
          reason: "plan_has_gaps",
        });
        return;
      }
      case "implement": {
        const next = this.findNextPendingStep(sessionId);
        if (next) {
          advanceTo(next);
        } else {
          this.completeSession(sessionId);
        }
        return;
      }
      case "code_review": {
        const verdict = result.json as ReviewVerdict | undefined;
        // Phase 39 — deterministic override. Final pass is true ONLY when
        // every acceptance_results entry passed AND no high-severity
        // issues. The LLM's self-reported `passed` is treated as a hint;
        // the per-AC verdicts + issue list are the contract. If the two
        // disagree, append a `review_passed_overridden` step_event so
        // the divergence is auditable.
        const acceptanceResults = verdict?.acceptance_results ?? [];
        const phaseResults = verdict?.phase_results ?? [];
        const issues = verdict?.issues ?? [];
        const hasBlockingIssue = issues.some(
          (i) => i?.severity === "blocker" || i?.severity === "major",
        );
        const allACsPassed =
          acceptanceResults.length === 0
            ? verdict?.passed === true // no per-AC data: defer to LLM
            : acceptanceResults.every((r) => r.passed === true);
        const derivedPassed = !hasBlockingIssue && allACsPassed;

        if (verdict && derivedPassed !== (verdict.passed === true)) {
          this.deps.repos.stepEvents.append({
            stepId,
            kind: "review_passed_overridden",
            payload: {
              llm_passed: verdict.passed === true,
              derived_passed: derivedPassed,
              failed_acceptance_ids: acceptanceResults
                .filter((r) => !r.passed)
                .map((r) => r.id),
              failed_phase_ids: phaseResults
                .filter((r) => !r.passed)
                .map((r) => r.id),
              has_blocking_issue: hasBlockingIssue,
              at: new Date().toISOString(),
            },
          });
          this.publish(sessionId, stepId, "step_status", {
            reason: "review_passed_overridden",
            derived_passed: derivedPassed,
          });
        }

        if (verdict && !derivedPassed) {
          // Build a richer failure summary that names the unmet ACs so
          // the planner can address them explicitly on the next round.
          const unmet = acceptanceResults.filter((r) => !r.passed);
          const summary =
            unmet.length > 0
              ? `${verdict.summary ?? "Code review rejected the implementation."} Unmet acceptance criteria: ${unmet
                  .map((r) => `${r.id} (${r.evidence ?? "no evidence"})`)
                  .join("; ")}.`
              : verdict.summary ?? "Code review rejected the implementation.";
          await this.handleReviewFailure(
            sessionId,
            summary,
            worktreePath,
            contextPackPath,
          );
        } else {
          this.completeSession(sessionId);
        }
        return;
      }
      default: {
        // Unknown role — treat like a no-op terminal.
        this.completeSession(sessionId);
        return;
      }
    }
  }

  private kickoffStep(
    sessionId: string,
    stepId: string,
    worktreePath: string,
    contextPackPath: string,
  ): void {
    let active = this.active.get(sessionId);
    if (!active) {
      active = {
        abort: new AbortController(),
        promise: Promise.resolve(),
        planWatcher: null,
        pausing: false,
        pendingResumeThreadId: null,
      };
      this.active.set(sessionId, active);
    }
    active.promise = this.runStep(sessionId, stepId, worktreePath, contextPackPath).catch(
      (err) => {
        this.deps.eventBus.publish(sessionId, "session_status", {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
  }

  /**
   * Hotfix — soft-fall for post-completion plan failures (missing
   * plan.json, unparseable JSON). The step is already marked completed
   * by the artifact-materialization loop; failing the session here
   * leaves the user with no escape (Retry-step re-runs and likely
   * hits the same SDK quirk). Mirror the runStep-level
   * plan_failed_softfall: append a diagnostic step_event, persist a
   * synthetic plan_gaps artifact, and land the session in
   * awaiting_approval so Reject-with-prompt is the user's escape.
   */
  private async planSoftFall(
    sessionId: string,
    stepId: string,
    errorMessage: string,
    rawText: string,
    worktreePath: string,
  ): Promise<void> {
    this.deps.repos.stepEvents.append({
      stepId,
      kind: "plan_failed_softfall",
      payload: {
        errorMessage,
        finalText: rawText.slice(0, 1000),
        at: new Date().toISOString(),
        source: "post_completion_router",
      },
    });
    const gapLines = [
      `- Plan output failed validation: ${errorMessage}`,
    ];
    const trimmed = rawText.trim();
    if (trimmed.length > 0) {
      gapLines.push(
        `- Planner output (first 200 chars): ${trimmed.slice(0, 200)}`,
      );
    }
    gapLines.push(
      `- Reject-with-prompt to send the planner specific feedback (e.g. "emit only the JSON object — no prose, no markdown fences").`,
    );
    this.deps.repos.stepArtifacts.create({
      stepId,
      kind: "plan_gaps",
      filePath: join(worktreePath, ".plan", "plan.json"),
      preview: previewOf(gapLines.join("\n")),
    });
    this.publish(sessionId, stepId, "step_status", {
      status: "completed",
      reason: "plan_failsoft_post_completion",
      error: errorMessage,
    });
    this.deps.repos.sessions.update(sessionId, { status: "awaiting_approval" });
    this.publish(sessionId, null, "session_status", {
      status: "awaiting_approval",
      reason: "plan_failsoft",
    });
    await this.stopWatcher(sessionId);
  }

  private async completeSession(sessionId: string): Promise<void> {
    this.deps.repos.sessions.update(sessionId, {
      status: "completed",
      endedAt: new Date().toISOString(),
    });
    this.publish(sessionId, null, "session_status", { status: "completed" });
    await this.stopWatcher(sessionId);
    this.deps.eventBus.closeSession(sessionId);
  }

  /**
   * Find the step with the lowest ord and status='pending' within the
   * session's workflow runs. Used by approve() and post-completion
   * auto-advance to pick what to run next.
   */
  private findNextPendingStep(sessionId: string): { id: string } | null {
    const runs = this.deps.repos.workflowRuns.listForSession(sessionId);
    let best: { id: string; ord: number } | null = null;
    for (const run of runs) {
      for (const step of this.deps.repos.pipelineSteps.listForRun(run.id)) {
        if (step.status !== "pending") continue;
        if (!best || step.ord < best.ord) best = { id: step.id, ord: step.ord };
      }
    }
    return best;
  }

  /** Find the most recent pipeline_step row for a given role in this session. */
  private findLatestStepByRole(
    sessionId: string,
    role: RoleDef["role"],
  ): { id: string; runId: string } | null {
    const runs = this.deps.repos.workflowRuns.listForSession(sessionId);
    let best: { id: string; runId: string; ord: number; createdAt: string } | null = null;
    for (const run of runs) {
      for (const step of this.deps.repos.pipelineSteps.listForRun(run.id)) {
        if (step.role !== role) continue;
        if (!best || step.createdAt > best.createdAt) {
          best = { id: step.id, runId: run.id, ord: step.ord, createdAt: step.createdAt };
        }
      }
    }
    return best ? { id: best.id, runId: best.runId } : null;
  }

  /** Approve the current awaiting_approval gate; advance to the next step. */
  /**
   * Phase 33: user has answered the clarify role's questions. Persist
   * the Q&A pairs as a task-scoped meta-context (so future sessions of
   * the same task auto-pick them up via buildContextPack), mark the
   * clarify step completed, and kick off the next pending step (plan).
   *
   * Throws when:
   * - Session not found / wrong status (HTTP 404 / 409)
   * - The clarify_questions step_artifact is missing (HTTP 500 — orchestrator bug)
   * - Any question id from the artifact lacks an answer in `answers` (HTTP 400)
   */
  async submitClarificationAnswers(
    sessionId: string,
    answers: Record<string, string>,
  ): Promise<void> {
    const session = this.deps.repos.sessions.get(sessionId);
    if (!session) {
      const err: Error & { status?: number } = new Error("Session not found");
      err.status = 404;
      throw err;
    }
    if (session.status !== "awaiting_clarification") {
      const err: Error & { status?: number } = new Error(
        `Session is ${session.status}, not awaiting_clarification`,
      );
      err.status = 409;
      throw err;
    }

    const clarifyStep = this.findLatestStepByRole(sessionId, "clarify");
    if (!clarifyStep) {
      throw new Error("No clarify step found for session");
    }
    const artifacts = this.deps.repos.stepArtifacts.listForStep(clarifyStep.id);
    const questionsArtifact = artifacts.find((a) => a.kind === "clarify_questions");
    if (!questionsArtifact) {
      throw new Error("Clarify step has no clarify_questions artifact");
    }
    // Read from the artifact's filePath first — that's the full JSON.
    // The artifact's `preview` is `previewOf(...)`-truncated to 400 chars
    // for the UI, so when the questions array is large it gets clipped
    // mid-string and JSON.parse rejects it. Fall back to preview only
    // when the file is unreadable (older sessions, manual cleanup).
    const questions = parseClarifyQuestions(questionsArtifact.filePath, questionsArtifact.preview);
    if (!questions) {
      throw new Error("clarify_questions artifact has no valid JSON in file or preview");
    }

    // Validate every question has a non-empty answer.
    for (const q of questions) {
      const ans = answers[q.id];
      if (typeof ans !== "string" || ans.trim().length === 0) {
        const err: Error & { status?: number; code?: string } = new Error(
          `Missing answer for question ${q.id}: "${q.text}"`,
        );
        err.status = 400;
        err.code = "missing_answer";
        throw err;
      }
    }

    // Render the Q&A as markdown and persist as a task-scoped
    // meta-context. Future sessions of the same task auto-pick it up.
    const lines = ["## Clarification answers", ""];
    for (const q of questions) {
      lines.push(`### ${q.text}`);
      lines.push("");
      lines.push((answers[q.id] ?? "").trim());
      lines.push("");
    }
    this.deps.repos.metaContexts.create({
      scopeType: "task",
      scopeId: session.taskId,
      kind: "clarification_answers",
      bodyMd: lines.join("\n").trimEnd(),
    });

    // Mark the clarify step completed (it was paused at "running" or
    // "completed" depending on prior state — pin it to completed now).
    this.deps.repos.pipelineSteps.update(clarifyStep.id, {
      status: "completed",
      endedAt: new Date().toISOString(),
    });
    this.publish(sessionId, clarifyStep.id, "step_status", {
      status: "completed",
      reason: "clarification_answered",
    });

    // Resume: transition to running and kick off the next pending step
    // (plan). Refresh the pack so plan sees the new meta-context.
    this.deps.repos.sessions.update(sessionId, { status: "running" });
    this.publish(sessionId, null, "session_status", { status: "running" });

    const next = this.findNextPendingStep(sessionId);
    if (!next) {
      await this.completeSession(sessionId);
      return;
    }
    const worktreePath = session.worktreePath;
    const packPath = join(worktreePath, ".context", "PACK.md");
    this.refreshContextPack(session.taskId, next.id, worktreePath, packPath);
    this.kickoffStep(sessionId, next.id, worktreePath, packPath);
  }

  async approve(sessionId: string): Promise<void> {
    const session = this.deps.repos.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.status !== "awaiting_approval") {
      throw new Error(`Session is ${session.status}, not awaiting_approval`);
    }

    // Phase 37 — server-side schema guard. The UI gates Approve when a
    // plan_gaps artifact exists, but a stale tab could still POST
    // approve. Re-validate plan.json here so an invalid plan can never
    // reach the implementer.
    const planJsonPath = join(session.worktreePath, ".plan", "plan.json");
    let planJsonRaw: string;
    try {
      planJsonRaw = readFileSync(planJsonPath, "utf8");
    } catch {
      const err: Error & { status?: number; gaps?: string[] } = new Error(
        "Plan validation precheck failed: plan.json is missing",
      );
      err.status = 409;
      err.gaps = ["plan.json missing"];
      throw err;
    }
    let planJson: unknown;
    try {
      planJson = JSON.parse(planJsonRaw);
    } catch {
      const err: Error & { status?: number; gaps?: string[] } = new Error(
        "Plan validation precheck failed: plan.json is not valid JSON",
      );
      err.status = 409;
      err.gaps = ["plan.json invalid JSON"];
      throw err;
    }
    const validation = validatePlan(planJson);
    if (!validation.ok) {
      const err: Error & { status?: number; gaps?: string[] } = new Error(
        "Plan failed schema validation; reject-with-prompt to fix gaps",
      );
      err.status = 409;
      err.gaps = validation.errors;
      throw err;
    }

    this.deps.repos.sessions.update(sessionId, { status: "running" });
    this.publish(sessionId, null, "session_status", { status: "running" });

    const next = this.findNextPendingStep(sessionId);
    if (!next) {
      await this.completeSession(sessionId);
      return;
    }

    const worktreePath = session.worktreePath;
    const packPath = join(worktreePath, ".context", "PACK.md");
    // Refresh the ContextPack so the next role sees prior artifacts.
    this.refreshContextPack(session.taskId, next.id, worktreePath, packPath);
    this.kickoffStep(sessionId, next.id, worktreePath, packPath);
  }

  /**
   * Reject the current plan gate. Records the comment as a step_event,
   * resets the plan step to pending, and re-runs it. The role's prompt
   * builder picks up the rejection feedback via `findRejectionFeedback`.
   */
  async reject(sessionId: string, comment: string): Promise<void> {
    const session = this.deps.repos.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.status !== "awaiting_approval") {
      throw new Error(`Session is ${session.status}, not awaiting_approval`);
    }
    const planStep = this.findLatestStepByRole(sessionId, "plan");
    if (!planStep) throw new Error("No plan step found to retry");

    this.deps.repos.stepEvents.append({
      stepId: planStep.id,
      kind: "rejection",
      payload: { comment, at: new Date().toISOString() },
    });

    // Reset plan + downstream (implement/code_review). Validate was
    // reverted — leaving the role in the reset list is harmless if no
    // such step row exists, but trim for clarity.
    for (const role of ["plan", "implement", "code_review"] as const) {
      const s = this.findLatestStepByRole(sessionId, role);
      if (!s) continue;
      this.deps.repos.pipelineSteps.update(s.id, {
        status: "pending",
        startedAt: null,
        endedAt: null,
      });
    }
    this.deps.repos.sessions.update(sessionId, { status: "running" });
    this.publish(sessionId, planStep.id, "session_status", { status: "running" });
    this.publish(sessionId, planStep.id, "step_status", {
      status: "pending",
      reason: "rejected",
      comment,
    });

    const worktreePath = session.worktreePath;
    const packPath = join(worktreePath, ".context", "PACK.md");
    this.refreshContextPack(session.taskId, planStep.id, worktreePath, packPath);
    this.kickoffStep(sessionId, planStep.id, worktreePath, packPath);
  }

  /**
   * Code-review returned passed=false. Treat the summary as a planner-
   * facing rejection: append it to the latest plan step's events, reset
   * plan/implement/code_review steps to pending, and gate on the user
   * via awaiting_approval (same UX as a manual reject).
   */
  private async handleReviewFailure(
    sessionId: string,
    summary: string,
    worktreePath: string,
    contextPackPath: string,
  ): Promise<void> {
    const planStep = this.findLatestStepByRole(sessionId, "plan");
    if (!planStep) {
      // featureFlow always provisions plan@ord=1 before code_review@ord=3,
      // so reaching this branch means the pipeline_step row was deleted out
      // from under us — a real bug. Throw so the outer runStep catch
      // surfaces it as session=failed with the diagnostic message
      // instead of silently swallowing the verdict and the user's run.
      throw new Error(
        `Cannot recover from review failure: no plan step found for session ${sessionId}`,
      );
    }

    this.deps.repos.stepEvents.append({
      stepId: planStep.id,
      kind: "rejection",
      payload: { comment: summary, source: "code_review", at: new Date().toISOString() },
    });

    // Reset plan + downstream steps so approve() picks plan as next.
    for (const role of ["plan", "implement", "code_review"] as const) {
      const s = this.findLatestStepByRole(sessionId, role);
      if (!s) continue;
      this.deps.repos.pipelineSteps.update(s.id, {
        status: "pending",
        startedAt: null,
        endedAt: null,
      });
      this.publish(sessionId, s.id, "step_status", {
        status: "pending",
        reason: role === "plan" ? "review_failed" : "awaiting_replan",
      });
    }

    this.deps.repos.sessions.update(sessionId, { status: "awaiting_approval" });
    this.publish(sessionId, null, "session_status", {
      status: "awaiting_approval",
      reason: "review_failed",
      summary,
    });

    this.refreshContextPack(
      this.deps.repos.sessions.get(sessionId)!.taskId,
      planStep.id,
      worktreePath,
      contextPackPath,
    );
  }

  /** Rewrite .context/PACK.md to reflect the role + accumulated feedback. */
  private refreshContextPack(
    taskId: string,
    stepId: string,
    _worktreePath: string,
    packPath: string,
  ): void {
    const step = this.deps.repos.pipelineSteps.get(stepId);
    if (!step) return;
    const pack = this.buildPackForRole(taskId, step.role, {
      stepId,
      runId: step.runId,
    });
    writeFileAtomic(packPath, pack.markdown);
  }

  /** Forward a PlanWatcher event into step_events + the EventBus. */
  private handleWatcherEvent(sessionId: string, e: PlanWatcherEvent): void {
    const session = this.deps.repos.sessions.get(sessionId);
    const stepId = session?.currentStepId ?? null;
    const payload = {
      relPath: e.relPath,
      preview: e.preview,
      parsed: e.parsed,
    };
    if (stepId) {
      this.deps.repos.stepEvents.append({ stepId, kind: e.kind, payload });
    }
    this.publish(sessionId, stepId, e.kind, payload);
  }

  private async stopWatcher(sessionId: string): Promise<void> {
    const active = this.active.get(sessionId);
    if (active?.planWatcher) {
      try {
        await active.planWatcher.stop();
      } catch {
        // best-effort
      }
      active.planWatcher = null;
    }
  }

  /**
   * Every plan attempt replaces the prior plan contract completely.
   * Clearing both DB rows and durable files up front prevents stale
   * `plan_gaps` from disabling approval after a successful re-plan and
   * prevents an old plan.json from being read if the new structured
   * output goes missing.
   */
  private clearPlanOutputs(stepId: string, worktreePath: string): void {
    for (const kind of ["plan_gaps", "plan", "plan_structured"]) {
      this.deps.repos.stepArtifacts.deleteByKind(stepId, kind);
    }
    for (const rel of [".plan/plan.json", ".plan/task_plan.md"]) {
      try {
        rmSync(join(worktreePath, rel), { force: true });
      } catch {
        // best-effort cleanup; the next artifact write is authoritative
      }
    }
  }

  /**
   * Pause: SIGINT the active runner, keep the step row's thread_id and
   * worktree intact, transition session→paused. The same step row
   * stays "pending" so resume() picks it up.
   */
  async pause(sessionId: string): Promise<void> {
    const session = this.deps.repos.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.status !== "running") {
      throw new Error(`Session is ${session.status}, cannot pause`);
    }
    const active = this.active.get(sessionId);
    if (!active) {
      // No in-flight runner — synthesize a paused state anyway so the
      // UI reflects the user's intent.
      this.deps.repos.sessions.update(sessionId, { status: "paused" });
      this.publish(sessionId, null, "session_status", { status: "paused" });
      return;
    }
    active.pausing = true;
    active.abort.abort();
    // Replace the controller so resume() has a fresh one to give to
    // the next runStep invocation.
    active.abort = new AbortController();
    await Promise.race([
      active.promise.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }

  /**
   * Resume: re-run the current step using its persisted thread_id so
   * Claude continues the same SDK session. If no step is in-flight,
   * pick the next pending step.
   */
  async resume(sessionId: string): Promise<void> {
    const session = this.deps.repos.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.status !== "paused") {
      throw new Error(`Session is ${session.status}, cannot resume`);
    }

    let stepId = session.currentStepId ?? null;
    if (stepId) {
      const step = this.deps.repos.pipelineSteps.get(stepId);
      if (!step || step.status !== "pending") {
        stepId = null;
      }
    }
    if (!stepId) {
      const next = this.findNextPendingStep(sessionId);
      if (!next) {
        await this.completeSession(sessionId);
        return;
      }
      stepId = next.id;
    }

    const step = this.deps.repos.pipelineSteps.get(stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);

    this.deps.repos.sessions.update(sessionId, { status: "running" });
    this.publish(sessionId, null, "session_status", { status: "running" });

    const worktreePath = session.worktreePath;
    const packPath = join(worktreePath, ".context", "PACK.md");

    let active = this.active.get(sessionId);
    if (!active) {
      active = {
        abort: new AbortController(),
        promise: Promise.resolve(),
        planWatcher: null,
        pausing: false,
        pendingResumeThreadId: null,
      };
      this.active.set(sessionId, active);
    }
    active.pendingResumeThreadId = step.threadId ?? null;
    // Refresh the pack so a wiped/truncated worktree (system restart,
    // dev cleanup, manual rm) doesn't trip the empty-pack guard inside
    // runStep. Mirrors the auto-advance / approve / reject paths.
    this.refreshContextPack(session.taskId, stepId, worktreePath, packPath);
    this.kickoffStep(sessionId, stepId, worktreePath, packPath);
  }

  /**
   * Phase 34: re-run the most recently failed step in the same session
   * and worktree. Right tool for transient errors (LLM hiccup, network
   * blip, schema parse) where forking would just re-run the whole
   * pipeline against the same vague task.
   *
   * Throws when:
   * - Session not in `failed` status (HTTP 409)
   * - No failed step found (HTTP 400)
   */
  async retryStep(sessionId: string): Promise<void> {
    const session = this.deps.repos.sessions.get(sessionId);
    if (!session) {
      const err: Error & { status?: number } = new Error("Session not found");
      err.status = 404;
      throw err;
    }
    if (session.status !== "failed") {
      const err: Error & { status?: number } = new Error(
        `Session is ${session.status}, not failed`,
      );
      err.status = 409;
      throw err;
    }

    // Find the latest failed step across all runs of this session.
    const runs = this.deps.repos.workflowRuns.listForSession(sessionId);
    let latestFailed: { id: string; runId: string; createdAt: string } | null = null;
    for (const run of runs) {
      for (const step of this.deps.repos.pipelineSteps.listForRun(run.id)) {
        if (step.status === "failed") {
          if (!latestFailed || step.createdAt > latestFailed.createdAt) {
            latestFailed = { id: step.id, runId: run.id, createdAt: step.createdAt };
          }
        }
      }
    }
    if (!latestFailed) {
      const err: Error & { status?: number } = new Error("No failed step to retry");
      err.status = 400;
      throw err;
    }

    // Reset the step. Re-mark the workflow_run as running so listings
    // reflect the resurrection.
    this.deps.repos.pipelineSteps.update(latestFailed.id, {
      status: "pending",
      startedAt: null,
      endedAt: null,
    });
    this.deps.repos.workflowRuns.updateStatus(latestFailed.runId, "running");

    this.deps.repos.sessions.update(sessionId, { status: "running", endedAt: null });
    this.publish(sessionId, null, "session_status", { status: "running" });
    this.publish(sessionId, latestFailed.id, "step_status", {
      status: "pending",
      reason: "retried",
    });

    const worktreePath = session.worktreePath;
    const packPath = join(worktreePath, ".context", "PACK.md");
    this.refreshContextPack(session.taskId, latestFailed.id, worktreePath, packPath);
    this.kickoffStep(sessionId, latestFailed.id, worktreePath, packPath);
  }

  async cancel(sessionId: string): Promise<void> {
    const active = this.active.get(sessionId);
    active?.abort.abort();
    if (active) {
      await Promise.race([
        active.promise.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    await this.stopWatcher(sessionId);
    const session = this.deps.repos.sessions.get(sessionId);
    if (session && session.status !== "cancelled" && !isTerminal(session.status)) {
      this.deps.repos.sessions.update(sessionId, {
        status: "cancelled",
        endedAt: new Date().toISOString(),
      });
      this.publish(sessionId, null, "session_status", { status: "cancelled" });
    }
  }

  async shutdown(timeoutMs = 5000): Promise<void> {
    const all = [...this.active.entries()];
    for (const [, entry] of all) entry.abort.abort();
    await Promise.race([
      Promise.allSettled(all.map(([, e]) => e.promise)),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    await Promise.allSettled(all.map(([sid]) => this.stopWatcher(sid)));
  }

  // ---------- internals ----------

  private resolveWorkspaceDir(): string | null {
    const v = this.deps.workspaceDir;
    return typeof v === "function" ? v() : v;
  }

  private resolveMaxConcurrent(): number {
    const v = this.deps.maxConcurrentSessions;
    if (v === undefined) return 3;
    return typeof v === "function" ? v() : v;
  }

  private buildPackForRole(
    taskId: string,
    roleId: string,
    opts: { stepId?: string; runId?: string } = {},
  ): { markdown: string } {
    const task = this.deps.repos.tasks.get(taskId);
    if (!task) throw new Error("Task not found");
    const project = this.deps.repos.projects.get(task.projectId);
    if (!project) throw new Error("Project not found");
    const role = this.deps.workflow.roles[roleId as keyof typeof this.deps.workflow.roles];
    if (!role) throw new Error(`Role ${roleId} not in workflow`);

    const jiraLinks: ContextPackJiraLink[] = this.deps.repos.taskLinks
      .listJira(taskId)
      .map((link) => {
        const cached = this.deps.repos.atlassianCache.getJiraIssue(link.jiraKey);
        const ctx = this.deps.repos.atlassianCache.getJiraIssueContext(link.jiraKey);
        const detail = (safeParse(cached?.payloadJson) as
          | { detail?: { summary?: string; status?: string; descriptionMd?: string } }
          | null)?.detail;
        return {
          jiraKey: link.jiraKey,
          role: link.role,
          summary: detail?.summary ?? null,
          status: detail?.status ?? null,
          descriptionMd: detail?.descriptionMd ?? null,
          notesMd: ctx?.notesMd ?? null,
        };
      });

    const confluenceLinks: ContextPackConfluenceLink[] = this.deps.repos.taskLinks
      .listConfluence(taskId)
      .map((link) => {
        const cached = this.deps.repos.atlassianCache.getConfluencePage(link.pageId);
        const ctx = this.deps.repos.atlassianCache.getConfluencePageContext(link.pageId);
        const detail = (safeParse(cached?.payloadJson) as
          | { detail?: { title?: string; bodyMd?: string } }
          | null)?.detail;
        return {
          pageId: link.pageId,
          role: link.role,
          title: detail?.title ?? null,
          bodyMd: detail?.bodyMd ?? null,
          notesMd: ctx?.notesMd ?? null,
        };
      });

    const metaContexts: ContextPackMetaContext[] = [
      ...this.deps.repos.metaContexts.listForScope("project", project.id),
      ...this.deps.repos.metaContexts.listForScope("task", taskId),
    ].map((m) => ({
      scopeType: m.scopeType,
      scopeId: m.scopeId,
      kind: m.kind,
      bodyMd: m.bodyMd,
      createdAt: m.createdAt,
    }));

    // Upstream artifacts: any artifacts produced by earlier steps in
    // the same workflow run, so the planner sees findings, the
    // implementer sees the plan, etc.
    const priorStepArtifacts = opts.runId
      ? this.collectPriorArtifacts(opts.runId, opts.stepId)
      : [];

    // Reviewer feedback: appended at the end of meta-context so the
    // planner reads it before re-emitting task_plan.md. Each entry
    // carries its createdAt so renderMetaContexts can render them
    // newest-first with round labels (later supersedes earlier).
    const feedbackBlocks = opts.stepId
      ? this.collectRejectionFeedback(opts.stepId)
      : [];
    const metaContextsAugmented = feedbackBlocks.length
      ? [
          ...metaContexts,
          ...feedbackBlocks.map((entry) => ({
            scopeType: "session" as const,
            scopeId: opts.stepId ?? "",
            kind: "reviewer_feedback",
            bodyMd: entry.comment,
            createdAt: entry.createdAt,
          })),
        ]
      : metaContexts;

    const input: ContextPackInput = {
      project: {
        name: project.name,
        rootPath: project.rootPath,
        defaultBaseRef: project.defaultBaseRef,
      },
      task: {
        title: task.title,
        descriptionMd: task.descriptionMd,
        status: task.status,
      },
      jiraLinks,
      confluenceLinks,
      metaContexts: metaContextsAugmented,
      priorStepArtifacts,
      role,
    };
    return buildContextPack(input);
  }

  private collectPriorArtifacts(
    runId: string,
    excludeStepId?: string,
  ): Array<{ kind: string; filePath: string; preview: string | null }> {
    const out: Array<{ kind: string; filePath: string; preview: string | null }> = [];
    for (const step of this.deps.repos.pipelineSteps.listForRun(runId)) {
      if (excludeStepId && step.id === excludeStepId) continue;
      for (const a of this.deps.repos.stepArtifacts.listForStep(step.id)) {
        out.push({ kind: a.kind, filePath: a.filePath, preview: a.preview });
      }
    }
    return out;
  }

  private collectRejectionFeedback(
    stepId: string,
  ): Array<{ comment: string; createdAt: string }> {
    const events = this.deps.repos.stepEvents.listForStep(stepId);
    return events
      .filter((e) => e.kind === "rejection")
      .map((e) => {
        try {
          const parsed = JSON.parse(e.payloadJson) as { comment?: string };
          const comment =
            typeof parsed.comment === "string" ? parsed.comment : "";
          return { comment, createdAt: e.createdAt };
        } catch {
          return { comment: "", createdAt: e.createdAt };
        }
      })
      .filter((entry) => entry.comment.trim().length > 0);
  }

  private persistStepEvent(stepId: string, kind: string, payload: unknown): void {
    this.deps.repos.stepEvents.append({ stepId, kind, payload });
  }

  private publish(
    sessionId: string,
    stepId: string | null,
    kind: OrchestratorEvent["kind"],
    payload: unknown,
  ): void {
    this.deps.eventBus.publish(sessionId, kind, payload, stepId);
  }

  private readFile(path: string): string {
    // The original lazy `require("node:fs")` was a silent failure in
    // production: the orchestrator package is `"type": "module"` so
    // `require` is undefined, every call threw ReferenceError, the
    // catch swallowed it, and readFile returned "" indistinguishably
    // from a real empty file. Vitest polyfills `require` so tests
    // never caught this. Use the top-level ESM import instead.
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  }
}

function safeParse(json: string | undefined | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Render a structured plan into the human-readable companion the UI
 * renders as a fallback (when PlanApprovalCard's parse path fails) and
 * the code_review role reads alongside .plan/plan.json. The role no
 * longer writes this file directly — it emits JSON only — so the
 * orchestrator owns the rendering to guarantee the markdown stays in
 * lockstep with the JSON.
 */
function renderTaskPlanMarkdown(plan: {
  task_summary: string;
  acceptance_criteria: Array<{ id: string; text: string }>;
  phases: Array<{
    id: string;
    title: string;
    goal: string;
    files: string[];
    done_when: string;
    covers_acceptance: string[];
  }>;
  open_questions: string[];
  out_of_scope: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# Plan: ${plan.task_summary}`, "");
  lines.push("## Acceptance criteria", "");
  for (const ac of plan.acceptance_criteria) {
    lines.push(`- [${ac.id}] ${ac.text}`);
  }
  lines.push("", "## Phases", "");
  for (const p of plan.phases) {
    lines.push(`- [ ] Phase ${p.id}: ${p.title}`);
    lines.push(`  - Goal: ${p.goal}`);
    lines.push(`  - Files: ${p.files.join(", ")}`);
    lines.push(`  - Done when: ${p.done_when}`);
    lines.push(`  - Covers: ${p.covers_acceptance.join(", ")}`);
  }
  if (plan.out_of_scope.length > 0) {
    lines.push("", "## Out of scope", "");
    for (const s of plan.out_of_scope) lines.push(`- ${s}`);
  }
  if (plan.open_questions.length > 0) {
    lines.push("", "## Open questions", "");
    for (const q of plan.open_questions) lines.push(`- ${q}`);
  }
  lines.push("", "## Review sign-off", "");
  lines.push("- [ ] code-reviewer pass 1 (spec compliance)");
  lines.push("- [ ] code-reviewer pass 2 (code quality)");
  return lines.join("\n") + "\n";
}

function previewOf(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
}

function writeFileAtomic(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

/**
 * Inspect a pack file with structured outcomes so the empty-pack guard
 * can distinguish "file doesn't exist" from "file exists but empty"
 * from "read errored." The original readFile swallowed all three into
 * an empty string, which made the failure undebuggable in the field.
 */
type PackReadResult =
  | { kind: "ok"; content: string }
  | { kind: "missing" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

function inspectPackFile(path: string): PackReadResult {
  try {
    const content = readFileSync(path, "utf8");
    if (!content.trim()) return { kind: "empty" };
    return { kind: "ok", content };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { kind: "missing" };
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Parse the questions array out of a clarify_questions artifact, accepting
 * both shapes the orchestrator writes:
 *   - `{status, questions:[...]}`  — clarify role's structured output
 *   - `{questions:[...]}`          — plan→clarify auto-route synthesis
 *   - `[...]`                       — bare-array preview written before
 *                                     either shape was canonicalized
 * Reads the artifact's filePath first (full JSON), falls back to the
 * truncated `preview` field if the file is unreadable.
 */
function parseClarifyQuestions(
  filePath: string | null | undefined,
  preview: string | null | undefined,
): ClarifyQuestion[] | null {
  const candidates: string[] = [];
  if (filePath) {
    try {
      const body = readFileSync(filePath, "utf8");
      if (body.trim()) candidates.push(body);
    } catch {
      // file missing or unreadable — try preview
    }
  }
  if (preview && preview.trim()) candidates.push(preview);
  for (const raw of candidates) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as ClarifyQuestion[];
      }
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown }).questions)) {
        return (parsed as { questions: ClarifyQuestion[] }).questions;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function describePackReadFailure(path: string): string {
  const r = inspectPackFile(path);
  switch (r.kind) {
    case "ok":
      return "non-empty (race?)";
    case "missing":
      return "file does not exist";
    case "empty":
      return "file exists but is empty (size 0)";
    case "error":
      return `read failed: ${r.message}`;
  }
}

function kindForArtifact(relPath: string): string {
  if (relPath.endsWith("findings.md")) return "findings";
  if (relPath.endsWith("plan.json")) return "plan_structured";
  if (relPath.endsWith("task_plan.md")) return "plan";
  if (relPath.endsWith("implement_summary.md")) return "implement_summary";
  if (relPath.endsWith("validate.json")) return "validate_result";
  if (relPath.endsWith(".json")) return "handoff";
  return "artifact";
}

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
