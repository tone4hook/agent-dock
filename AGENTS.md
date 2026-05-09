# AGENTS.md — workflow customization guide for coding agents

This file maps Agent\*Dock's pipeline-customization surface end-to-end so a coding agent can land changes without spelunking the whole codebase. **Read `CONTEXT.md` first** for the domain vocabulary (Session, WorkflowRun, PipelineStep, ContextPack, etc.) — every term here is defined there.

If a recipe below says "edit X", the file path is the source of truth — verify it still exists before editing.

---

## Mental model in 90 seconds

```
User clicks Start on a Task
    │
    ▼
SessionsService.create()  ─►  WorktreeManager.create()      ─►  WorkflowCoordinator.start(taskId)
                                                                      │
                                                                      ▼
                                                  one Session row ─┬─ pipeline_steps rows (one per role)
                                                                  │
                                                                  ▼
                                              for each step (in `dependsOn` order):
                                                  ContextPack.build(role) → PACK.md
                                                  StepRunner.run(role, prompt, cwd)
                                                          │
                                                          ▼
                                                  ProviderAdapter (claude/gemini/codex)
                                                          │
                                                          ▼
                                                  @tone4hook/headless-coding-agent-sdk
                                                          │
                                                          ▼
                                                  step_events stream → SSE → UI
                                                  artifacts → step_artifacts table + disk
                                                          │
                                                          ▼
                                              gates: clarify (auto), plan-approval (human), code_review (auto)
```

The hot loop is **WorkflowCoordinator → ContextPack → StepRunner → ProviderAdapter → SDK**. Almost every customization touches one of those five.

---

## The default pipeline (`featureFlow`)

Defined in `packages/workflows/src/featureFlow/index.ts`:

| ord | role | model | tools | output | gate |
|---|---|---|---|---|---|
| 0 | `investigate` | sonnet-4-6 | Read, Grep, Glob | `findings.md` | none |
| 1 | `clarify` | sonnet-4-6 | Read, Grep, Glob | `clarification_questions` artifact | auto-routes from plan if `open_questions[]` is non-empty |
| 2 | `plan` | opus-4-7 (medium reasoning) | Read, Grep, Glob | **JSON-only** via `outputSchema` (`plan.json`) | **human approval** required before implement |
| 3 | `implement` | sonnet-4-6 | full edit set | code edits + commits in worktree | none |
| 4 | `code_review` | opus-4-7 (medium reasoning) | Read, Grep, Glob | **JSON-only** via `outputSchema` (verdict + per-AC findings) | auto-route back to plan on fail |

Each role lives in its own file under `packages/workflows/src/featureFlow/roles/`.

> **Important constraint** — the `plan` role has **no Edit/Write tools**. Its only output is the JSON object validated against `outputSchema`. The orchestrator deterministically renders `task_plan.md` from that JSON. Mixing tool writes with structured-output mode confused the SDK validator (planner emitting "Plan written" prose after Edit calls). Same pattern for `code_review`.

---

## Layer-by-layer map

### 1. Shared types (`packages/shared/src/domain.ts`)

Single source of truth for enums. **Add a new role/status here first**, then everywhere else.

- `roleValues` — all role names. Already includes a slot for `validate` (kept after Phase-33 reverted it; future workflows can opt back in).
- `sessionStatusValues` — `pending | running | awaiting_clarification | awaiting_approval | completed | failed | cancelled | paused`.
- `stepStatusValues` — pipeline step lifecycle.
- `metaContextScopeValues` / `metaContextKindValues` — categories for the `meta_contexts` table that ContextPack pulls from.
- `runnerValues` — currently `host | docker`. Only `host` is wired today; `docker` is a research seam.

### 2. Database (`packages/db/src/migrate.ts`)

All tables in one file, idempotent migrations. Workflow-relevant tables:

- `sessions` — one row per Session. Holds `worktree_path`, `status`, `workflow_run_id`.
- `workflow_runs` — links a Session to a `workflow_id` (the def's `id`).
- `pipeline_steps` — one row per role-instance in a run. `status`, `started_at`, `finished_at`, `thread_id` (Claude resume), `error_message`.
- `step_events` — append-only event log per step. SSE replays these.
- `step_artifacts` — files the role produced; `kind`, `file_path`, `preview`. The `artifacts` repo writes both the row and the file via `ArtifactStore`.
- `meta_contexts` — scoped free-form context (`project | task | jira | confluence`) × kind (`manual | haiku_explored | review_feedback | clarification_answers`). ContextPack pulls these per-step.
- `task_jira_links`, `task_confluence_links`, `jira_issues`, `confluence_pages` — Atlassian linkage. ContextPack pulls these too.

**Adding a column or table** — append a new migration entry to the `migrations` array (with a unique `id`). Don't edit existing migration SQL. The runner skips applied IDs.

### 3. Workflow definitions (`packages/workflows/`)

```
packages/workflows/src/
├── types.ts                     ← RoleDef, WorkflowDef, ContextPack types, validation
├── contextPack.ts               ← buildContextPack(input) → markdown
├── index.ts                     ← exports featureFlow + types
└── featureFlow/
    ├── index.ts                 ← workflow definition (steps + roles map)
    ├── roles/
    │   ├── investigate.ts
    │   ├── clarify.ts
    │   ├── plan.ts
    │   ├── implement.ts
    │   └── codeReview.ts
    └── schemas/
        └── plan.ts              ← PLAN_OUTPUT_SCHEMA (JSON schema for the planner)
```

Every `RoleDef` has:

```ts
{
  role: Role;                    // matches roleValues
  model: string;                 // SDK model id
  reasoningHint?: string;        // "medium" for opus
  permissionMode: PermissionMode;
  allowedTools: string[];        // SDK whitelist
  systemPromptBuilder: (pack: ContextPack) => string;
  expectedArtifacts: string[];   // paths the planWatcher subscribes to
  outputSchema?: Record<string, unknown>; // forces JSON-only output
}
```

**Workflow registration is validated at module load** by `assertWorkflowDef()`: enforces unique ords, every step's role exists in `roles`, every role's shape passes Zod, and the role-table key matches its `def.role`.

### 4. Orchestration (`packages/orchestrator/`)

```
packages/orchestrator/src/
├── coordinator.ts               ← WorkflowCoordinator (the brain)
├── eventBus.ts                  ← in-process pub/sub for step_events
├── planWatcher.ts               ← chokidar watch on session worktree's .plan/ + .handoff/
├── postToolUseHook.ts           ← Claude Code hook handler — surfaces tool calls as events
└── index.ts
```

`WorkflowCoordinator` ([packages/orchestrator/src/coordinator.ts](packages/orchestrator/src/coordinator.ts)) is the only object that touches Session lifecycle. Public methods:

- `start(taskId, opts)` — creates session + worktree + workflow run + pipeline steps; kicks off step 0.
- `approve(sessionId)` — transitions `awaiting_approval` → `running`, advances past plan.
- `reject(sessionId, comment)` — appends `meta_contexts(kind=review_feedback)` and re-runs plan.
- `pause(sessionId)`, `resume(sessionId)`, `cancel(sessionId)` — lifecycle control.
- private `runStep(...)` — the per-step loop (build ContextPack → render PACK.md → run StepRunner → record events + artifacts → schema-validate → next).
- private `handleReviewFailure(...)` — code-review verdict-fail flow: surfaces issues as `review_feedback` meta-context, routes back to plan.
- private `handleWatcherEvent(...)` — turns plan-watcher fs events into `step_events`.

### 5. Headless-agent bridge (`packages/agents/`)

```
packages/agents/src/
├── stepRunner.ts                ← bridges RoleDef + ProviderAdapter + SDK
├── runner.ts                    ← legacy single-shot runner (chat surface, not workflow)
├── chatRunner.ts                ← chat-page runner
├── haikuExplore.ts              ← Haiku auto-context injection (Jira/Confluence reference)
├── types.ts                     ← ProviderAdapter, StepRunnerInput, StepRunnerResult
└── providers/
    ├── base.ts                  ← shared baseStartOpts() — env, signal, allowedTools
    ├── claude.ts                ← Claude adapter (delegates to base)
    ├── gemini.ts
    ├── codex.ts
    └── index.ts                 ← providerRegistry + getProviderAdapter()
```

**ProviderAdapter** is one method: `buildStartOpts(input) → SharedStartOpts` for `@tone4hook/headless-coding-agent-sdk`. Each adapter is a single file; cross-provider differences (Claude resumes threads, others don't; reasoning hint shape varies) live in those files, not in the orchestrator.

**StepRunner** consumes a *locally-declared* `StepRunnerRoleDef` subset of the workflows package's `RoleDef` to keep `agents → workflows` dep-free. It detects Claude's structured-output via a lenient `isStructuredOutputToolName()` matcher.

### 6. API (`apps/api/`)

```
apps/api/src/
├── buildContainer.ts            ← composition root: db → repos → ArtifactStore → RunCoordinator → WorkflowCoordinator
├── index.ts                     ← Express + SSE wiring; imports buildContainer
├── runCoordinator.ts            ← single-shot runs (chat / explore); not the workflow path
├── routes/
│   ├── sessions.ts              ← REST surface for the workflow lifecycle (see below)
│   ├── tasks.ts                 ← Task CRUD + Atlassian linking
│   ├── projects.ts              ← workspace-discovered repos
│   ├── atlassian.ts, exploration.ts, chat.ts, notes.ts, …
│   └── workspace.ts             ← workspace dir + folder picker
└── services/
    ├── sessions.ts              ← SessionsService: list, detail, history; delegates to WorkflowCoordinator for actions
    ├── tasks.ts, atlassian.ts, …
    └── explorationCoordinator.ts
```

**`POST /api/sessions/:id` actions** (in `routes/sessions.ts`):

| route | method | calls |
|---|---|---|
| `/sessions/:id/pause` | POST | `coordinator.pause(id)` |
| `/sessions/:id/resume` | POST | `coordinator.resume(id)` |
| `/sessions/:id/cancel` | POST | `coordinator.cancel(id)` |
| `/sessions/:id/approve` | POST | `coordinator.approve(id)` — passes plan-gate |
| `/sessions/:id/reject` | POST | `coordinator.reject(id, comment)` — re-runs plan with feedback |
| `/sessions/:id/clarify` | POST | inserts `clarification_answers` meta-context, re-runs plan |
| `/sessions/:id/retry-step` | POST | re-runs the failing step in place |
| `/sessions/:id/events` | GET (SSE) | replays `step_events`, then streams new ones |

### 7. UI (`apps/web/`)

Workflow-relevant components:

- `apps/web/src/views/SessionsList.tsx` — workspace-wide list.
- `apps/web/src/views/SessionDetail.tsx` — per-session step timeline + actions. Renders the plan-approval gate when `session.status === "awaiting_approval"`.
- `apps/web/src/components/PlanApprovalCard.tsx` — Approve / Reject UI.
- `apps/web/src/components/PlanReview.tsx` — renders the parsed `plan.json` for human review.
- `apps/web/src/components/PlanGapsPanel.tsx` — shown when plan validation fails coverage / done-when checks.
- `apps/web/src/components/ReviewIssues.tsx` — code-review verdict surface + "use as rejection feedback" handoff.

The session detail subscribes to `/api/sessions/:id/events` (SSE) and renders each step's events as a typed timeline. Action buttons POST to the routes above.

---

## Customization recipes

### Recipe A — change a role's model, tools, or prompt

**Files**: `packages/workflows/src/featureFlow/roles/<role>.ts`

That's the entire change. The `RoleDef` object exposes `model`, `reasoningHint`, `permissionMode`, `allowedTools`, `systemPromptBuilder`, and `outputSchema`. Edit and rebuild — no schema migration, no orchestrator change.

If you switch a role to/from JSON-only output, also add or remove its `outputSchema` and update `expectedArtifacts` (the planWatcher won't expect a `.md` if you've moved to JSON). The orchestrator's ContextPack of the *next* step pulls in `priorStepArtifacts` — make sure the artifact kind it surfaces still makes sense to the next role's prompt.

### Recipe B — add a new pipeline step (e.g. a `validate` role)

1. **Shared enum**: ensure `validate` (or your new name) is in `roleValues` at `packages/shared/src/domain.ts`. (`validate` is already there from Phase 33.)
2. **Role file**: create `packages/workflows/src/featureFlow/roles/validate.ts` exporting a `RoleDef`.
3. **Workflow wiring**: in `packages/workflows/src/featureFlow/index.ts`, add the `{ role: "validate", ord: N, dependsOn: [...] }` step *and* the corresponding entry in the `roles` map.
4. **(Optional) outputSchema**: if validate emits JSON, add a schema under `packages/workflows/src/featureFlow/schemas/<name>.ts`.
5. **(Optional) coordinator routing**: if the new role needs custom routing logic (e.g. "on validate failure, do X"), extend `WorkflowCoordinator.runStep` / `handleReviewFailure` in `packages/orchestrator/src/coordinator.ts`. For most new roles the default sequential flow works.
6. **(Optional) UI**: if the role has a status the user must see/act on, add a status branch in `SessionDetail.tsx` and a component under `apps/web/src/components/`.

`assertWorkflowDef()` will reject the workflow at startup if any of the wiring is incomplete — no silent failures.

### Recipe C — define a brand-new workflow alongside `featureFlow`

1. Create `packages/workflows/src/myFlow/index.ts` (and a `roles/` directory).
2. Export `myFlow: WorkflowDef` with a unique `id` ("my-flow"), a `steps` array, and a `roles` lookup. Run `assertWorkflowDef(def)`.
3. Export it from `packages/workflows/src/index.ts`.
4. Wire selection in `apps/api/src/buildContainer.ts` — currently hard-codes `workflow: featureFlow`. To support multiple, either pass the workflow id from the route into `WorkflowCoordinator.start`, or build a workflow registry keyed by id and look up at start time.
5. Add a workflow picker in the UI (Task creation flow) if users get to choose.

### Recipe D — add a coding-agent provider

1. **Enum**: add the id to `agentProviderValues` in `packages/shared/src/index.ts`.
2. **Adapter**: create `packages/agents/src/providers/<id>.ts` exporting a `ProviderAdapter` with `buildStartOpts(input)`. Reuse `baseStartOpts(input)` from `./base.js` and override only the differences.
3. **Register**: add the adapter to `providerRegistry` in `packages/agents/src/providers/index.ts`.
4. **Done.** `getProviderAdapter(id)` is the only consumer; the orchestrator picks adapter per-step from the role's `model` / runtime settings.

### Recipe E — change ContextPack content (what the role sees)

`packages/workflows/src/contextPack.ts` is the single renderer. Section order is:

```
Project → Task → Linked Jira → Linked Confluence → Meta-context → Upstream artifacts → Role brief
```

Empty sections are omitted. To add a section: extend `ContextPackInput` in `types.ts`, add a `renderXxx()` helper, and wire it in `buildContextPack()`. To change *which* meta-context kinds get pulled, edit `WorkflowCoordinator.runStep` where it queries `metaContextsRepo` per-step.

### Recipe F — surface a new event in the UI

1. Emit it from the orchestrator: `eventBus.emit({ type: "my-event", payload: ... })` in `coordinator.ts`. The bus persists it via `step_events` and SSE replays it.
2. The SSE route in `routes/sessions.ts` already streams every event for the session — no route change.
3. In `SessionDetail.tsx`, render the new event kind in the step timeline.

### Recipe G — add a new artifact kind

1. **Disk**: extend `ArtifactStore` in `packages/artifacts/src/` (the only place that decides on-disk paths and previews).
2. **DB**: `step_artifacts.kind` is a free-text column — no migration needed, but add the new kind to any client-side type union if one exists.
3. **Producer**: have the role write to its `expectedArtifacts` path (the planWatcher catches it) or the `runStep` loop record it directly.
4. **Consumer**: ContextPack's `priorStepArtifacts` will pick it up automatically when the next role runs.

---

## Constraints / gotchas

- **JSON-only roles can't use Edit/Write.** Mixing tool writes with structured-output mode causes the SDK validator to reject the run. The orchestrator renders any human-readable companion (e.g. `task_plan.md`) deterministically from the JSON.
- **`assertWorkflowDef()` runs at module load.** Don't construct workflows lazily/dynamically — failures should surface at boot, not at first run.
- **Circular dep guard**: `packages/agents` declares its own `StepRunnerRoleDef` instead of importing from `packages/workflows`. Don't add a workflows dep to agents — the dep graph is `agents → sdk` and `orchestrator → agents + workflows`.
- **Pause/resume uses Claude `thread_id`.** Other providers don't support resume; pausing a Gemini/Codex step ends the thread. The runner's `resumeThreadId` parameter is Claude-only.
- **Plan validation is server-side.** The planner returns JSON; the orchestrator runs schema + AC↔phase coverage + done-when text checks. If the plan fails coverage, the user sees `PlanGapsPanel` and the session goes to `awaiting_approval` blocked until the plan is re-run with fixes (via reject + clarify).
- **Migrations are append-only.** Never edit a committed migration. Add a new entry with a unique id; the runner skips applied ids by id, not by content hash.
- **`WorkflowCoordinator` is the only Session-lifecycle owner.** Routes call its public methods; no other service mutates `sessions.status` or `pipeline_steps.status` directly. Keep this invariant — it's the difference between a working orchestrator and a state-corruption bug.

---

## Hot files index

| Concern | File |
|---|---|
| Pipeline definition | `packages/workflows/src/featureFlow/index.ts` |
| Role definitions | `packages/workflows/src/featureFlow/roles/*.ts` |
| Plan output JSON schema | `packages/workflows/src/featureFlow/schemas/plan.ts` |
| ContextPack rendering | `packages/workflows/src/contextPack.ts` |
| Workflow / role types + validation | `packages/workflows/src/types.ts` |
| Orchestration brain | `packages/orchestrator/src/coordinator.ts` |
| Plan-watcher (artifact handoff) | `packages/orchestrator/src/planWatcher.ts` |
| Step runner (role ↔ provider) | `packages/agents/src/stepRunner.ts` |
| Provider adapter registry | `packages/agents/src/providers/index.ts` |
| Domain enums | `packages/shared/src/domain.ts` |
| Migrations | `packages/db/src/migrate.ts` |
| Composition root | `apps/api/src/buildContainer.ts` |
| Session REST surface | `apps/api/src/routes/sessions.ts` |
| Sessions service | `apps/api/src/services/sessions.ts` |
| Session UI (timeline + gates) | `apps/web/src/views/SessionDetail.tsx` |
| Plan-approval components | `apps/web/src/components/Plan*.tsx`, `ReviewIssues.tsx` |
