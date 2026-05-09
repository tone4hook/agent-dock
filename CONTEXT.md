# Agent*Dock Domain Glossary

This file is the project's shared vocabulary. New modules should use these names; new domain concepts should be added here as terse entries (1–3 sentences) before they spread through the code.

## AgentRun
A single invocation of a coding-agent CLI: one prompt, one provider, one working directory, one lifecycle. Persisted in `agent_runs`. Has a `status` (`queued` → `running` → one of `completed`/`failed`/`cancelled`/`timeout`).

## AgentRunEvent
An append-only record produced during an AgentRun's lifetime. Carries a typed `eventType` (`status`, `agent`, `stderr`, `shutdown`) and a JSON payload. Stored in `agent_run_events` and replayed to SSE subscribers via `/api/runs/:id/events`.

## Artifact
A file persisted on disk after an AgentRun completes (final text, stdout log, stderr log, …) plus a row in `artifacts` linking it to the run. The set of artifact types is defined in `apps/api/src/artifactRecorder.ts` — that is the only place to extend it.

## Provider
The id of an underlying coding-agent CLI (`claude`, `gemini`, `codex`). The canonical list lives in `@agent-dock/shared` as `agentProviderValues`.

## ProviderAdapter
The seam between Agent*Dock and a specific Provider. Implements `buildStartOpts(input)` to translate an `AgentRunInput` into options for `@tone4hook/headless-coding-agent-sdk`. Lives in `packages/agents/src/providers/<id>.ts` and is registered in `providers/index.ts`. To support a new Provider: add one file, register it.

## RunCoordinator
The in-process owner of AgentRun lifecycle. Exposes commands (`create`, `cancel`, `shutdown`) and a `subscribe(runId, listener)` event stream. Knows nothing about HTTP — transports (the SSE adapter in `sse.ts`) sit in front of it.

## RuntimeSettings
User-configurable defaults applied to a new AgentRun when the request omits a field (default provider, model hint, reasoning hint, working directory, permission mode). Stored as a single JSON blob in `app_settings` under key `runtime`. Schema and defaults are defined exactly once in `runtimeSettingsSchema` (`@agent-dock/shared`); `SettingsRepo` parses through that schema on read and write.

## ArtifactStore
The filesystem-side counterpart to the `artifacts` table. Owns the on-disk layout under `AGENT_DOCK_ARTIFACT_DIR` (default `.agent-dock/artifacts/<runId>/`) and produces the `filePath` + `preview` that the artifacts repo records.

## Composition root
The single function (`buildContainer()` in `apps/api/src/buildContainer.ts`) that opens the database, runs migrations, and instantiates repos, the artifact store, and the run coordinator. Imported only by `apps/api/src/index.ts`. No module elsewhere should construct these dependencies as import-time side effects.

## Project
A cloned repository that the user has registered with Agent*Dock. Auto-discovered by scanning the configured workspace directory one level deep for any directory that contains a `.git/`. Persisted in `projects`. The active Project drives which repo a Task, Session, or WorkflowRun targets.

## Task
A unit of work owned by a Project. Has a status (`backlog`/`in_progress`/`done`/`archived`) and may be linked to one or more Jira issues (`task_jira_links`) and Confluence pages (`task_confluence_links`). The Tasks Kanban view groups tasks by status; selecting a Task opens its TaskDetail with its current Session, links, and notes.

## Session
A single attempt to execute a Task end-to-end through the feature flow. Persisted in `sessions`. Holds the WorkflowRun reference, the worktree path, and the lifecycle status (`pending`/`running`/`awaiting_clarification`/`awaiting_approval`/`completed`/`failed`).

## WorkflowRun
A concrete invocation of a workflow definition (currently the feature flow: `investigate` → `clarify` → `plan` → `validate` → `implement` → `code_review`). Persisted in `workflow_runs` with one row per pipeline step in `pipeline_steps`. The Coordinator orchestrates step transitions.

## PipelineStep
One node in a WorkflowRun: a typed role with an LLM provider, model, permission mode, allowed tools, expected artifacts, and an optional output schema. Persisted in `pipeline_steps`; emits typed `step_events` consumed by the Coordinator and the SessionDetail UI.

## ContextPack
The structured prompt context assembled before each PipelineStep runs: linked Jira issues, linked Confluence pages, prior plan/clarify artifacts, and any MetaContexts in scope. Built fresh per step so changes mid-run propagate.

## WorktreeManager
Owns Git worktree lifecycle for Sessions. Creates a worktree per Session under `worktrees/`, returns the absolute path, and cleans up on session completion or cancellation. Lives in `@agent-dock/worktrees`.

## MetaContext
Free-form scoped context (notes, clarification answers, planning hints) that a user attaches to a Project, Task, or Session. Persisted in `meta_contexts` keyed by `(scope_type, scope_id, kind)`. ContextPack pulls these in alongside Atlassian data.
