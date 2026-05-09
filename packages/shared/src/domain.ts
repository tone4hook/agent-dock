import { z } from "zod";

// ---------- Enum value tuples ----------

export const taskStatusValues = ["open", "in_progress", "done", "abandoned"] as const;
export const sessionStatusValues = [
  "draft",
  "running",
  "awaiting_approval",
  "awaiting_clarification",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export const stepStatusValues = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export const workflowRunStatusValues = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export const roleValues = ["investigate", "clarify", "plan", "validate", "implement", "code_review"] as const;
export const runnerValues = ["host", "docker"] as const;
export const metaContextScopeValues = ["project", "task", "jira", "confluence"] as const;
export const metaContextKindValues = ["manual", "haiku_explored", "review_feedback", "clarification_answers"] as const;

export type TaskStatus = (typeof taskStatusValues)[number];
export type SessionStatus = (typeof sessionStatusValues)[number];
export type StepStatus = (typeof stepStatusValues)[number];
export type WorkflowRunStatus = (typeof workflowRunStatusValues)[number];
export type Role = (typeof roleValues)[number];
export type Runner = (typeof runnerValues)[number];
export type MetaContextScope = (typeof metaContextScopeValues)[number];
export type MetaContextKind = (typeof metaContextKindValues)[number];

// ---------- Record schemas (DB row shape, camelCase) ----------

export const projectSchema = z.object({
  id: z.string(),
  rootPath: z.string(),
  name: z.string(),
  defaultBaseRef: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  descriptionMd: z.string(),
  baseRefOverride: z.string().nullable(),
  status: z.enum(taskStatusValues),
  currentSessionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const taskJiraLinkSchema = z.object({
  taskId: z.string(),
  jiraKey: z.string(),
  role: z.string(),
  createdAt: z.string(),
});

export const taskConfluenceLinkSchema = z.object({
  taskId: z.string(),
  pageId: z.string(),
  role: z.string(),
  createdAt: z.string(),
});

export const jiraIssueSchema = z.object({
  issueKey: z.string(),
  payloadJson: z.string(),
  fetchedAt: z.string(),
  updatedAt: z.string(),
});

export const jiraIssueContextSchema = z.object({
  issueKey: z.string(),
  notesMd: z.string(),
  updatedAt: z.string(),
});

export const confluencePageSchema = z.object({
  pageId: z.string(),
  payloadJson: z.string(),
  fetchedAt: z.string(),
  updatedAt: z.string(),
});

export const confluencePageContextSchema = z.object({
  pageId: z.string(),
  notesMd: z.string(),
  updatedAt: z.string(),
});

export const metaContextSchema = z.object({
  id: z.string(),
  scopeType: z.enum(metaContextScopeValues),
  scopeId: z.string(),
  kind: z.enum(metaContextKindValues),
  bodyMd: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const sessionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  baseRef: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  status: z.enum(sessionStatusValues),
  currentStepId: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workflowRunSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  workflowDefId: z.string(),
  status: z.enum(workflowRunStatusValues),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const pipelineStepSchema = z.object({
  id: z.string(),
  runId: z.string(),
  ord: z.number().int(),
  role: z.enum(roleValues),
  runner: z.enum(runnerValues),
  threadId: z.string().nullable(),
  status: z.enum(stepStatusValues),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  dependsOn: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const stepEventSchema = z.object({
  id: z.number().int(),
  stepId: z.string(),
  kind: z.string(),
  payloadJson: z.string(),
  createdAt: z.string(),
});

export const stepArtifactSchema = z.object({
  id: z.string(),
  stepId: z.string(),
  kind: z.string(),
  filePath: z.string(),
  preview: z.string().nullable(),
  createdAt: z.string(),
});

/**
 * Compact summary of the latest non-terminal session for a task.
 * Surfaced on `Task` list rows so the UI can render an inline "live"
 * pill without N+1 fetches against `/api/sessions`.
 */
export const liveSessionSummarySchema = z.object({
  sessionId: z.string(),
  status: z.enum(sessionStatusValues),
  currentStepRole: z.enum(roleValues).nullable(),
  currentStepOrd: z.number().int().nullable(),
  totalSteps: z.number().int().nullable(),
});

export type LiveSessionSummary = z.infer<typeof liveSessionSummarySchema>;

export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskJiraLink = z.infer<typeof taskJiraLinkSchema>;
export type TaskConfluenceLink = z.infer<typeof taskConfluenceLinkSchema>;
export type JiraIssue = z.infer<typeof jiraIssueSchema>;
export type JiraIssueContext = z.infer<typeof jiraIssueContextSchema>;
export type ConfluencePage = z.infer<typeof confluencePageSchema>;
export type ConfluencePageContext = z.infer<typeof confluencePageContextSchema>;
export type MetaContext = z.infer<typeof metaContextSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type PipelineStep = z.infer<typeof pipelineStepSchema>;
export type StepEvent = z.infer<typeof stepEventSchema>;
export type StepArtifact = z.infer<typeof stepArtifactSchema>;

// ---------- Input schemas (for routes/services) ----------

export const createProjectInputSchema = z.object({
  rootPath: z.string().min(1),
  name: z.string().min(1),
  defaultBaseRef: z.string().min(1).default("main"),
});

export const updateProjectInputSchema = z.object({
  name: z.string().min(1).optional(),
  defaultBaseRef: z.string().min(1).optional(),
  archived: z.boolean().optional(),
});

export const createTaskInputSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  descriptionMd: z.string().default(""),
  baseRefOverride: z.string().nullable().default(null),
});

export const updateTaskInputSchema = z.object({
  title: z.string().min(1).optional(),
  descriptionMd: z.string().optional(),
  baseRefOverride: z.string().nullable().optional(),
  status: z.enum(taskStatusValues).optional(),
});

export const createMetaContextInputSchema = z.object({
  scopeType: z.enum(metaContextScopeValues),
  scopeId: z.string().min(1),
  kind: z.enum(metaContextKindValues).default("manual"),
  bodyMd: z.string().default(""),
});

export const updateMetaContextInputSchema = z.object({
  bodyMd: z.string(),
});

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
export type CreateMetaContextInput = z.infer<typeof createMetaContextInputSchema>;
export type UpdateMetaContextInput = z.infer<typeof updateMetaContextInputSchema>;

// (Workspace settings live on runtimeSettingsSchema in ./index.ts:
// `workspaceDir` and `maxConcurrentSessions` keep all settings in one shape.)

// ---------- Notes ----------

export const noteSourceValues = ["manual", "chat_response"] as const;
export type NoteSource = (typeof noteSourceValues)[number];

export const STICKY_CAP = 3;
export const TODO_LIST_CAP = 3;

export const noteSchema = z.object({
  id: z.string(),
  source: z.enum(noteSourceValues),
  title: z.string(),
  body: z.string(),
  chatMessageId: z.string().nullable(),
  projectId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const stickyNoteSchema = z.object({
  id: z.string(),
  body: z.string(),
  color: z.string(),
  tag: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const todoListSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const todoItemSchema = z.object({
  id: z.string(),
  listId: z.string(),
  body: z.string(),
  done: z.boolean(),
  ord: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Note = z.infer<typeof noteSchema>;
export type StickyNote = z.infer<typeof stickyNoteSchema>;
export type TodoList = z.infer<typeof todoListSchema>;
export type TodoItem = z.infer<typeof todoItemSchema>;

export const createNoteInputSchema = z.object({
  source: z.enum(noteSourceValues).default("manual"),
  title: z.string().min(1).max(200),
  body: z.string().default(""),
  chatMessageId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  taskIds: z.array(z.string()).optional(),
  jiraKeys: z.array(z.string()).optional(),
  pageIds: z.array(z.string()).optional(),
});

export const updateNoteInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().optional(),
  projectId: z.string().nullable().optional(),
});

export const createNoteFromChatMessageInputSchema = z.object({
  chatMessageId: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  projectId: z.string().nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  taskIds: z.array(z.string()).optional(),
  jiraKeys: z.array(z.string()).optional(),
  pageIds: z.array(z.string()).optional(),
});

export const createStickyNoteInputSchema = z.object({
  body: z.string().min(1).max(500),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#fff5b8"),
  tag: z.string().nullable().optional(),
});

export const updateStickyNoteInputSchema = createStickyNoteInputSchema.partial();

export const createTodoListInputSchema = z.object({
  name: z.string().min(1).max(120),
});

export const updateTodoListInputSchema = z.object({
  name: z.string().min(1).max(120),
});

export const createTodoItemInputSchema = z.object({
  body: z.string().min(1).max(500),
  done: z.boolean().optional(),
  ord: z.number().int().optional(),
});

export const updateTodoItemInputSchema = z.object({
  body: z.string().min(1).max(500).optional(),
  done: z.boolean().optional(),
  ord: z.number().int().optional(),
});

export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;
export type CreateNoteFromChatMessageInput = z.infer<typeof createNoteFromChatMessageInputSchema>;
export type CreateStickyNoteInput = z.infer<typeof createStickyNoteInputSchema>;
export type UpdateStickyNoteInput = z.infer<typeof updateStickyNoteInputSchema>;
export type CreateTodoListInput = z.infer<typeof createTodoListInputSchema>;
export type UpdateTodoListInput = z.infer<typeof updateTodoListInputSchema>;
export type CreateTodoItemInput = z.infer<typeof createTodoItemInputSchema>;
export type UpdateTodoItemInput = z.infer<typeof updateTodoItemInputSchema>;

// ---------- Chat ----------

export const chatModelValues = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-haiku-4-5-20251001",
] as const;
export const chatScopeValues = ["general", "workspace", "project"] as const;
export const reasoningEffortValues = ["low", "medium", "high"] as const;
export const chatRoleValues = ["user", "assistant", "system"] as const;

export type ChatModel = (typeof chatModelValues)[number];
export type ChatScope = (typeof chatScopeValues)[number];
export type ReasoningEffort = (typeof reasoningEffortValues)[number];
export type ChatRole = (typeof chatRoleValues)[number];

export const chatThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  model: z.enum(chatModelValues),
  reasoningEffort: z.enum(reasoningEffortValues).nullable(),
  scope: z.enum(chatScopeValues),
  scopeProjectId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const chatMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  ord: z.number().int(),
  role: z.enum(chatRoleValues),
  content: z.string(),
  toolUses: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: z.string(),
});

export type ChatThread = z.infer<typeof chatThreadSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const createChatThreadInputSchema = z
  .object({
    title: z.string().min(1).max(200).default("New chat"),
    model: z.enum(chatModelValues).default("claude-sonnet-4-6"),
    reasoningEffort: z.enum(reasoningEffortValues).nullable().optional(),
    scope: z.enum(chatScopeValues).default("general"),
    scopeProjectId: z.string().nullable().optional(),
  })
  .refine((v) => v.scope !== "project" || !!v.scopeProjectId, {
    message: "scopeProjectId is required when scope='project'",
    path: ["scopeProjectId"],
  });

export const updateChatThreadInputSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    model: z.enum(chatModelValues).optional(),
    reasoningEffort: z.enum(reasoningEffortValues).nullable().optional(),
    scope: z.enum(chatScopeValues).optional(),
    scopeProjectId: z.string().nullable().optional(),
  })
  .refine(
    (v) =>
      v.scope === undefined ||
      v.scope !== "project" ||
      v.scopeProjectId !== null,
    { message: "scopeProjectId required when scope='project'", path: ["scopeProjectId"] },
  );

export const appendChatMessageInputSchema = z.object({
  content: z.string().min(1),
});

export type CreateChatThreadInput = z.infer<typeof createChatThreadInputSchema>;
export type UpdateChatThreadInput = z.infer<typeof updateChatThreadInputSchema>;
export type AppendChatMessageInput = z.infer<typeof appendChatMessageInputSchema>;
