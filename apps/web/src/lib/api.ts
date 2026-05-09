import type {
  AgentRunEventRecord,
  AgentRunRecord,
  ArtifactRecord,
  LiveSessionSummary,
  MetaContext,
  MetaContextKind,
  MetaContextScope,
  PipelineStep,
  Project,
  RuntimeSettingsRecord,
  Session,
  SessionStatus,
  StepArtifact,
  Task,
  TaskConfluenceLink,
  TaskJiraLink,
  TaskStatus,
  WorkflowRun,
  CreateNoteFromChatMessageInput,
  CreateNoteInput,
  CreateStickyNoteInput,
  CreateTodoItemInput,
  CreateTodoListInput,
  Note,
  NoteSource,
  StickyNote,
  TodoItem,
  TodoList,
  UpdateNoteInput,
  UpdateStickyNoteInput,
  UpdateTodoItemInput,
  UpdateTodoListInput,
  ChatMessage,
  ChatThread,
  CreateChatThreadInput,
  UpdateChatThreadInput,
} from "@agent-dock/shared";

export interface WorkspaceState {
  workspaceDir: string | null;
  projects: Project[];
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8792";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export interface RunDetail {
  run: AgentRunRecord;
  events: AgentRunEventRecord[];
  artifacts: ArtifactRecord[];
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(await errorText(res));
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json() as Promise<T>;
}

export async function loadHome() {
  const [settings, runs] = await Promise.all([
    apiGet<{ settings: RuntimeSettingsRecord }>("/api/settings/runtime"),
    apiGet<{ runs: AgentRunRecord[] }>("/api/runs"),
  ]);
  return { settings: settings.settings, runs: runs.runs };
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json() as Promise<T>;
}

export async function getWorkspaceState(): Promise<WorkspaceState> {
  return apiGet<WorkspaceState>("/api/workspace");
}

export async function setWorkspaceDir(dir: string): Promise<WorkspaceState> {
  return apiPut<WorkspaceState>("/api/workspace", { workspaceDir: dir });
}

export async function rescanProjects(): Promise<WorkspaceState> {
  return apiPost<WorkspaceState>("/api/workspace/rescan", {});
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  const result = await apiPost<{ path: string | null }>("/api/workspace/pick-folder", {});
  return result.path;
}

export async function getRuntimeSettings(): Promise<RuntimeSettingsRecord> {
  return (await apiGet<{ settings: RuntimeSettingsRecord }>("/api/settings/runtime")).settings;
}

export async function updateRuntimeSettings(
  patch: RuntimeSettingsRecord,
): Promise<RuntimeSettingsRecord> {
  return (await apiPut<{ settings: RuntimeSettingsRecord }>("/api/settings/runtime", patch)).settings;
}

export async function listProjects(includeArchived = false): Promise<Project[]> {
  const r = await apiGet<{ projects: Project[] }>(
    `/api/projects${includeArchived ? "?includeArchived=true" : ""}`,
  );
  return r.projects;
}

// --- Atlassian ---

export interface AtlassianStatus {
  connected: boolean;
  email: string | null;
  siteUrl: string | null;
  boardId: string | null;
}

export interface AtlassianCredsInput {
  siteUrl: string;
  email: string;
  apiToken: string;
  boardId?: string | null;
}

export async function getAtlassianStatus(): Promise<AtlassianStatus> {
  return apiGet<AtlassianStatus>("/api/atlassian/status");
}

export async function saveAtlassianCreds(creds: AtlassianCredsInput): Promise<AtlassianStatus> {
  return apiPut<AtlassianStatus>("/api/atlassian/creds", creds);
}

export async function clearAtlassianCreds(): Promise<AtlassianStatus> {
  const res = await fetch(apiUrl("/api/atlassian/creds"), { method: "DELETE" });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json() as Promise<AtlassianStatus>;
}

// --- Atlassian search/detail ---

export interface JiraSearchHit {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  updated: string;
}

export interface JiraIssueDetail {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  reporter: string | null;
  updated: string;
  descriptionMd: string;
  comments: Array<{ id: string; author: string | null; bodyMd: string; createdAt: string }>;
  saved: boolean;
}

export interface JiraSearchResponse {
  issues: JiraSearchHit[];
  nextPageToken: string | null;
  isLast: boolean;
}

export type JiraChipKind = "project" | "status" | "assignee" | "updated" | "type";

export interface JiraSearchChip {
  kind: JiraChipKind;
  value: string;
}

export async function searchJira(
  jql: string,
  opts: { nextPageToken?: string; maxResults?: number } = {},
): Promise<JiraSearchResponse> {
  const u = new URLSearchParams({ jql });
  if (opts.nextPageToken) u.set("nextPageToken", opts.nextPageToken);
  if (opts.maxResults !== undefined) u.set("maxResults", String(opts.maxResults));
  return apiGet<JiraSearchResponse>(`/api/atlassian/jira/search?${u}`);
}

export async function searchJiraChips(
  q: string,
  filters: JiraSearchChip[],
  opts: { nextPageToken?: string; maxResults?: number } = {},
): Promise<JiraSearchResponse> {
  const u = new URLSearchParams();
  if (q) u.set("q", q);
  if (filters.length > 0) u.set("filters", JSON.stringify(filters));
  if (opts.nextPageToken) u.set("nextPageToken", opts.nextPageToken);
  if (opts.maxResults !== undefined) u.set("maxResults", String(opts.maxResults));
  return apiGet<JiraSearchResponse>(`/api/atlassian/jira/search?${u}`);
}

export async function listMyJiraIssues(
  opts: { nextPageToken?: string; maxResults?: number } = {},
): Promise<JiraSearchResponse> {
  const u = new URLSearchParams();
  if (opts.nextPageToken) u.set("nextPageToken", opts.nextPageToken);
  if (opts.maxResults !== undefined) u.set("maxResults", String(opts.maxResults));
  const qs = u.toString();
  return apiGet<JiraSearchResponse>(`/api/atlassian/jira/my-issues${qs ? `?${qs}` : ""}`);
}

export interface JiraSprintSummary {
  id: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
}

export interface JiraSprintIssue extends JiraSearchHit {
  priority: string | null;
  storyPoints: number | null;
  statusCategory: "todo" | "indeterminate" | "done" | null;
}

export interface JiraSprintResponse {
  sprint: JiraSprintSummary | null;
  issues: JiraSprintIssue[];
}

export async function getJiraSprint(): Promise<JiraSprintResponse> {
  return apiGet<JiraSprintResponse>("/api/atlassian/jira/sprint");
}

export async function getJiraIssue(key: string): Promise<JiraIssueDetail> {
  return apiGet<JiraIssueDetail>(`/api/atlassian/jira/issues/${encodeURIComponent(key)}`);
}

export async function listSavedJira(): Promise<string[]> {
  return (await apiGet<{ keys: string[] }>("/api/atlassian/jira/saved")).keys;
}

export async function saveJiraIssue(key: string): Promise<void> {
  await apiPost<{ saved: boolean }>(`/api/atlassian/jira/issues/${encodeURIComponent(key)}/save`, {});
}

export async function unsaveJiraIssue(key: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/atlassian/jira/issues/${encodeURIComponent(key)}/save`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorText(res));
}

export interface ConfluenceSearchHit {
  id: string;
  title: string;
  spaceKey: string | null;
  updatedAt: string;
}

export interface ConfluencePageDetail {
  id: string;
  title: string;
  spaceKey: string | null;
  updatedAt: string;
  bodyMd: string;
  saved: boolean;
}

export type ConfluenceChipKind = "space" | "author" | "updated" | "label";

export interface ConfluenceSearchChip {
  kind: ConfluenceChipKind;
  value: string;
}

export interface ConfluenceSearchResponse {
  total: number;
  results: ConfluenceSearchHit[];
}

export async function searchConfluence(
  cql: string,
  opts: { startAt?: number; maxResults?: number } = {},
): Promise<ConfluenceSearchResponse> {
  const u = new URLSearchParams({ cql });
  if (opts.startAt !== undefined) u.set("startAt", String(opts.startAt));
  if (opts.maxResults !== undefined) u.set("maxResults", String(opts.maxResults));
  return apiGet<ConfluenceSearchResponse>(`/api/atlassian/confluence/search?${u}`);
}

export async function searchConfluenceChips(
  q: string,
  filters: ConfluenceSearchChip[],
  opts: { startAt?: number; maxResults?: number } = {},
): Promise<ConfluenceSearchResponse> {
  const u = new URLSearchParams();
  if (q) u.set("q", q);
  if (filters.length > 0) u.set("filters", JSON.stringify(filters));
  if (opts.startAt !== undefined) u.set("startAt", String(opts.startAt));
  if (opts.maxResults !== undefined) u.set("maxResults", String(opts.maxResults));
  return apiGet<ConfluenceSearchResponse>(`/api/atlassian/confluence/search?${u}`);
}

export async function getConfluencePage(id: string): Promise<ConfluencePageDetail> {
  return apiGet<ConfluencePageDetail>(`/api/atlassian/confluence/pages/${encodeURIComponent(id)}`);
}

export interface SavedConfluencePage {
  id: string;
  title: string;
  updatedAt: string;
}

export async function listSavedConfluence(): Promise<SavedConfluencePage[]> {
  return (await apiGet<{ pages: SavedConfluencePage[] }>("/api/atlassian/confluence/saved")).pages;
}

export async function saveConfluencePage(id: string): Promise<void> {
  await apiPost<{ saved: boolean }>(
    `/api/atlassian/confluence/pages/${encodeURIComponent(id)}/save`,
    {},
  );
}

export async function unsaveConfluencePage(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/atlassian/confluence/pages/${encodeURIComponent(id)}/save`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorText(res));
}

// --- Meta-contexts ---

export async function listMetaContexts(scope: MetaContextScope, scopeId: string): Promise<MetaContext[]> {
  const u = new URLSearchParams({ scope, scopeId });
  return (await apiGet<{ items: MetaContext[] }>(`/api/meta-contexts?${u}`)).items;
}

export async function createMetaContext(input: {
  scopeType: MetaContextScope;
  scopeId: string;
  kind?: MetaContextKind;
  bodyMd: string;
}): Promise<MetaContext> {
  return (await apiPost<{ item: MetaContext }>("/api/meta-contexts", input)).item;
}

export async function updateMetaContext(id: string, bodyMd: string): Promise<MetaContext> {
  return (await apiPatch<{ item: MetaContext }>(`/api/meta-contexts/${id}`, { bodyMd })).item;
}

export async function deleteMetaContext(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/meta-contexts/${id}`), { method: "DELETE" });
  if (!res.ok) throw new Error(await errorText(res));
}

// --- Haiku exploration ---

export interface ExplorationSnapshot {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  scopeType: MetaContextScope;
  scopeId: string;
  prompt: string;
  workingDirectory: string;
  markdown: string;
  errorMessage: string | null;
}

export async function startExploration(input: {
  prompt: string;
  scopeType: MetaContextScope;
  scopeId: string;
  projectId: string;
}): Promise<ExplorationSnapshot> {
  return apiPost<ExplorationSnapshot>("/api/exploration/haiku", input);
}

export async function getExploration(id: string): Promise<ExplorationSnapshot> {
  return apiGet<ExplorationSnapshot>(`/api/exploration/haiku/${id}`);
}

export async function cancelExploration(id: string): Promise<ExplorationSnapshot> {
  return apiPost<ExplorationSnapshot>(`/api/exploration/haiku/${id}/cancel`, {});
}

export async function forgetExploration(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/exploration/haiku/${id}`), { method: "DELETE" });
  if (!res.ok) throw new Error(await errorText(res));
}

export function explorationEventStreamUrl(id: string): string {
  return apiUrl(`/api/exploration/haiku/${id}/events`);
}

// --- Sessions ---

export interface SessionFailureInfo {
  role: string;
  errorMessage: string | null;
  stepId: string;
}

export interface SessionDetail {
  session: Session;
  runs: WorkflowRun[];
  steps: PipelineStep[];
  artifacts: StepArtifact[];
  /**
   * Phase 34: structured failure summary for failed sessions.
   * Populated by the GET /api/sessions/:id endpoint reading the latest
   * step with status='failed' and its most recent step_status event's
   * `error` payload field. null when session is not failed.
   */
  failureInfo?: SessionFailureInfo | null;
}

export async function startSession(
  taskId: string,
  body: { baseRefOverride?: string | null } = {},
): Promise<{ sessionId: string; worktreePath: string; branch: string; baseRef: string }> {
  return apiPost(`/api/tasks/${taskId}/sessions`, body);
}

export async function getSession(id: string): Promise<SessionDetail> {
  return apiGet<SessionDetail>(`/api/sessions/${id}`);
}

export async function approveSession(id: string): Promise<Session> {
  return (await apiPost<{ session: Session }>(`/api/sessions/${id}/approve`, {})).session;
}

export async function rejectSession(id: string, comment: string): Promise<Session> {
  return (await apiPost<{ session: Session }>(`/api/sessions/${id}/reject`, { comment })).session;
}

export interface ClarifyQuestion {
  id: string;
  text: string;
  default?: string;
}

/**
 * Phase 33: submit user answers to the clarify role's questions. Server
 * validates every question id has a non-empty answer and persists a
 * task-scoped `clarification_answers` meta-context before kicking off
 * the plan step.
 */
export async function submitClarificationAnswers(
  id: string,
  answers: Record<string, string>,
): Promise<Session> {
  return (
    await apiPost<{ session: Session }>(`/api/sessions/${id}/clarify`, { answers })
  ).session;
}

export async function pauseSession(id: string): Promise<Session> {
  return (await apiPost<{ session: Session }>(`/api/sessions/${id}/pause`, {})).session;
}

export async function resumeSession(id: string): Promise<Session> {
  return (await apiPost<{ session: Session }>(`/api/sessions/${id}/resume`, {})).session;
}

export async function getArtifactContent(
  sessionId: string,
  artifactId: string,
): Promise<{ content: string; kind: string; bytes: number }> {
  return apiGet<{ content: string; kind: string; bytes: number }>(
    `/api/sessions/${sessionId}/artifacts/${artifactId}/content`,
  );
}

export async function cancelSession(id: string): Promise<Session> {
  return (await apiPost<{ session: Session }>(`/api/sessions/${id}/cancel`, {})).session;
}

/**
 * Phase 34: re-run the most recently failed step in the same session
 * and worktree. Right tool for transient errors (LLM hiccup, network
 * blip) where forking would just re-run the whole pipeline.
 */
export async function retryStep(id: string): Promise<Session> {
  return (await apiPost<{ session: Session }>(`/api/sessions/${id}/retry-step`, {})).session;
}

export function sessionEventStreamUrl(id: string): string {
  return apiUrl(`/api/sessions/${id}/events`);
}

// --- Tasks ---

export interface TaskWithCounts extends Task {
  sessionsCount: number;
  jiraLinksCount: number;
  confluenceLinksCount: number;
  liveSession: LiveSessionSummary | null;
}

export interface TaskDetail extends TaskWithCounts {
  jiraLinks: Array<TaskJiraLink & { summary?: string; status?: string }>;
  confluenceLinks: Array<TaskConfluenceLink & { title?: string }>;
}

export async function listTaskSessions(taskId: string): Promise<Session[]> {
  return (await apiGet<{ sessions: Session[] }>(`/api/tasks/${taskId}/sessions`)).sessions;
}

export async function listTasks(filter: { projectId?: string; status?: TaskStatus } = {}): Promise<TaskWithCounts[]> {
  const u = new URLSearchParams();
  if (filter.projectId) u.set("projectId", filter.projectId);
  if (filter.status) u.set("status", filter.status);
  const qs = u.toString();
  return (await apiGet<{ tasks: TaskWithCounts[] }>(`/api/tasks${qs ? `?${qs}` : ""}`)).tasks;
}

export async function getTask(id: string): Promise<TaskDetail> {
  return (await apiGet<{ task: TaskDetail }>(`/api/tasks/${id}`)).task;
}

export async function createTask(input: {
  projectId: string;
  title: string;
  descriptionMd?: string;
  baseRefOverride?: string | null;
}): Promise<TaskDetail> {
  return (await apiPost<{ task: TaskDetail }>("/api/tasks", input)).task;
}

export async function updateTask(id: string, patch: {
  title?: string;
  descriptionMd?: string;
  baseRefOverride?: string | null;
  status?: TaskStatus;
}): Promise<TaskDetail> {
  return (await apiPatch<{ task: TaskDetail }>(`/api/tasks/${id}`, patch)).task;
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/tasks/${id}`), { method: "DELETE" });
  if (!res.ok) throw new Error(await errorText(res));
}

export async function addTaskJiraLink(taskId: string, jiraKey: string, role = ""): Promise<TaskDetail> {
  return (await apiPost<{ task: TaskDetail }>(
    `/api/tasks/${taskId}/jira-links/${encodeURIComponent(jiraKey)}`,
    { role },
  )).task;
}

export async function removeTaskJiraLink(taskId: string, jiraKey: string): Promise<TaskDetail> {
  const res = await fetch(
    apiUrl(`/api/tasks/${taskId}/jira-links/${encodeURIComponent(jiraKey)}`),
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json() as { task: TaskDetail }).task;
}

export async function addTaskConfluenceLink(taskId: string, pageId: string, role = ""): Promise<TaskDetail> {
  return (await apiPost<{ task: TaskDetail }>(
    `/api/tasks/${taskId}/confluence-links/${encodeURIComponent(pageId)}`,
    { role },
  )).task;
}

export async function removeTaskConfluenceLink(taskId: string, pageId: string): Promise<TaskDetail> {
  const res = await fetch(
    apiUrl(`/api/tasks/${taskId}/confluence-links/${encodeURIComponent(pageId)}`),
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json() as { task: TaskDetail }).task;
}

// ----- dashboard -----

export type DashboardActivityKind =
  | "task_created"
  | "session_started"
  | "session_completed"
  | "session_failed"
  | "session_cancelled"
  | "session_paused"
  | "step_completed"
  | "step_started"
  | "review_passed"
  | "review_failed"
  | "plan_updated"
  | "haiku_saved";

export type DashboardActivitySeverity = "info" | "warn" | "bad" | "ok";

export interface DashboardRunningSession {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  status: "running" | "paused" | "awaiting_approval";
  currentStepRole: "investigate" | "plan" | "implement" | "code_review" | null;
  currentStepOrd: number | null;
  totalSteps: number | null;
}

export interface DashboardProject {
  id: string;
  name: string;
  defaultBaseRef: string;
  openTasks: number;
  activeSessions: number;
}

export interface DashboardActivity {
  ts: string;
  kind: DashboardActivityKind;
  title: string;
  sub: string;
  severity: DashboardActivitySeverity;
}

export interface DashboardSummary {
  activeSessions: number;
  awaitingApproval: number;
  /** Subset of `awaitingApproval` whose latest review_result has passed=false. */
  reviewFailed: number;
  openTasks: number;
  notesCount: number;
  runningSessions: DashboardRunningSession[];
  projects: DashboardProject[];
  recentActivity: DashboardActivity[];
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const r = await apiGet<{ summary: DashboardSummary }>("/api/dashboard");
  return r.summary;
}

// ----- sessions list -----

export interface SessionListItem {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  status: SessionStatus;
  branch: string;
  baseRef: string;
  currentStepRole: "investigate" | "plan" | "implement" | "code_review" | null;
  currentStepOrd: number | null;
  totalSteps: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface SessionListResult {
  items: SessionListItem[];
  total: number;
}

export async function listSessions(
  opts: { status?: SessionStatus; limit?: number; offset?: number } = {},
): Promise<SessionListResult> {
  const u = new URLSearchParams();
  if (opts.status) u.set("status", opts.status);
  if (opts.limit !== undefined) u.set("limit", String(opts.limit));
  if (opts.offset !== undefined) u.set("offset", String(opts.offset));
  const qs = u.toString();
  return apiGet<SessionListResult>(`/api/sessions${qs ? `?${qs}` : ""}`);
}

// ----- notes / stickies / todo lists -----

export interface NoteWithRelations extends Note {
  tags: string[];
  jiraKeys: string[];
  pageIds: string[];
  taskIds: string[];
}

export interface TodoListWithItems extends TodoList {
  items: TodoItem[];
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function expectOk(res: Response): Promise<void> {
  if (res.ok) return;
  let body: { error?: string } | null = null;
  try {
    body = (await res.json()) as { error?: string };
  } catch {
    /* ignore */
  }
  throw new ApiError(body?.error ?? res.statusText, res.status);
}

export async function listNotes(
  filter: { source?: NoteSource; projectId?: string; q?: string; tag?: string } = {},
): Promise<NoteWithRelations[]> {
  const u = new URLSearchParams();
  if (filter.source) u.set("source", filter.source);
  if (filter.projectId) u.set("projectId", filter.projectId);
  if (filter.q) u.set("q", filter.q);
  if (filter.tag) u.set("tag", filter.tag);
  const qs = u.toString();
  return (await apiGet<{ notes: NoteWithRelations[] }>(`/api/notes${qs ? `?${qs}` : ""}`)).notes;
}

export async function getNote(id: string): Promise<NoteWithRelations> {
  return (await apiGet<{ note: NoteWithRelations }>(`/api/notes/${id}`)).note;
}

export async function createNote(input: CreateNoteInput): Promise<NoteWithRelations> {
  const res = await fetch(apiUrl("/api/notes"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await expectOk(res);
  return ((await res.json()) as { note: NoteWithRelations }).note;
}

export async function createNoteFromChatMessage(
  input: CreateNoteFromChatMessageInput,
): Promise<NoteWithRelations> {
  const res = await fetch(apiUrl("/api/notes/from-chat-message"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await expectOk(res);
  return ((await res.json()) as { note: NoteWithRelations }).note;
}

export async function updateNote(id: string, patch: UpdateNoteInput): Promise<NoteWithRelations> {
  const res = await fetch(apiUrl(`/api/notes/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await expectOk(res);
  return ((await res.json()) as { note: NoteWithRelations }).note;
}

export async function deleteNote(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/notes/${id}`), { method: "DELETE" });
  await expectOk(res);
}

export async function addNoteJiraLink(id: string, key: string): Promise<NoteWithRelations> {
  const res = await fetch(
    apiUrl(`/api/notes/${id}/jira-links/${encodeURIComponent(key)}`),
    { method: "POST" },
  );
  await expectOk(res);
  return ((await res.json()) as { note: NoteWithRelations }).note;
}

export async function removeNoteJiraLink(id: string, key: string): Promise<NoteWithRelations> {
  const res = await fetch(
    apiUrl(`/api/notes/${id}/jira-links/${encodeURIComponent(key)}`),
    { method: "DELETE" },
  );
  await expectOk(res);
  return ((await res.json()) as { note: NoteWithRelations }).note;
}

export async function addNoteTaskLink(id: string, taskId: string): Promise<NoteWithRelations> {
  const res = await fetch(apiUrl(`/api/notes/${id}/task-links/${taskId}`), { method: "POST" });
  await expectOk(res);
  return ((await res.json()) as { note: NoteWithRelations }).note;
}

export async function removeNoteTaskLink(id: string, taskId: string): Promise<NoteWithRelations> {
  const res = await fetch(apiUrl(`/api/notes/${id}/task-links/${taskId}`), { method: "DELETE" });
  await expectOk(res);
  return ((await res.json()) as { note: NoteWithRelations }).note;
}

export async function addNoteTag(id: string, tag: string): Promise<NoteWithRelations> {
  const res = await fetch(apiUrl(`/api/notes/${id}/tags`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag }),
  });
  await expectOk(res);
  return ((await res.json()) as { note: NoteWithRelations }).note;
}

export async function removeNoteTag(id: string, tag: string): Promise<NoteWithRelations> {
  const res = await fetch(apiUrl(`/api/notes/${id}/tags/${encodeURIComponent(tag)}`), {
    method: "DELETE",
  });
  await expectOk(res);
  return ((await res.json()) as { note: NoteWithRelations }).note;
}

// stickies

export async function listStickies(): Promise<StickyNote[]> {
  return (await apiGet<{ stickies: StickyNote[] }>("/api/sticky-notes")).stickies;
}
export async function createSticky(input: CreateStickyNoteInput): Promise<StickyNote> {
  const res = await fetch(apiUrl("/api/sticky-notes"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await expectOk(res);
  return ((await res.json()) as { sticky: StickyNote }).sticky;
}
export async function updateSticky(id: string, patch: UpdateStickyNoteInput): Promise<StickyNote> {
  const res = await fetch(apiUrl(`/api/sticky-notes/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await expectOk(res);
  return ((await res.json()) as { sticky: StickyNote }).sticky;
}
export async function deleteSticky(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/sticky-notes/${id}`), { method: "DELETE" });
  await expectOk(res);
}

// todo lists

export async function listTodoLists(): Promise<TodoListWithItems[]> {
  return (await apiGet<{ lists: TodoListWithItems[] }>("/api/todo-lists")).lists;
}
export async function createTodoList(input: CreateTodoListInput): Promise<TodoListWithItems> {
  const res = await fetch(apiUrl("/api/todo-lists"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await expectOk(res);
  return ((await res.json()) as { list: TodoListWithItems }).list;
}
export async function updateTodoList(
  id: string,
  patch: UpdateTodoListInput,
): Promise<TodoListWithItems> {
  const res = await fetch(apiUrl(`/api/todo-lists/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await expectOk(res);
  return ((await res.json()) as { list: TodoListWithItems }).list;
}
export async function deleteTodoList(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/todo-lists/${id}`), { method: "DELETE" });
  await expectOk(res);
}
export async function createTodoItem(
  listId: string,
  input: CreateTodoItemInput,
): Promise<TodoItem> {
  const res = await fetch(apiUrl(`/api/todo-lists/${listId}/items`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await expectOk(res);
  return ((await res.json()) as { item: TodoItem }).item;
}
export async function updateTodoItem(
  listId: string,
  itemId: string,
  patch: UpdateTodoItemInput,
): Promise<TodoItem> {
  const res = await fetch(apiUrl(`/api/todo-lists/${listId}/items/${itemId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await expectOk(res);
  return ((await res.json()) as { item: TodoItem }).item;
}
export async function deleteTodoItem(listId: string, itemId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/todo-lists/${listId}/items/${itemId}`), {
    method: "DELETE",
  });
  await expectOk(res);
}

// ----- chat -----

export type { ChatModel, ChatScope, ChatThread, ChatMessage, ReasoningEffort } from "@agent-dock/shared";

export async function listChatThreads(): Promise<ChatThread[]> {
  return (await apiGet<{ threads: ChatThread[] }>("/api/chat/threads")).threads;
}

export async function createChatThread(input: Partial<CreateChatThreadInput> = {}): Promise<ChatThread> {
  const res = await fetch(apiUrl("/api/chat/threads"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await expectOk(res);
  return ((await res.json()) as { thread: ChatThread }).thread;
}

export async function getChatThread(
  id: string,
): Promise<{ thread: ChatThread; messages: ChatMessage[] }> {
  return apiGet(`/api/chat/threads/${id}`);
}

export async function updateChatThread(
  id: string,
  patch: UpdateChatThreadInput,
): Promise<ChatThread> {
  const res = await fetch(apiUrl(`/api/chat/threads/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await expectOk(res);
  return ((await res.json()) as { thread: ChatThread }).thread;
}

export async function deleteChatThread(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/chat/threads/${id}`), { method: "DELETE" });
  await expectOk(res);
}

export async function sendChatMessage(
  threadId: string,
  content: string,
): Promise<{ userMessage: ChatMessage; assistantMessageId: string }> {
  const res = await fetch(apiUrl(`/api/chat/threads/${threadId}/messages`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  await expectOk(res);
  return (await res.json()) as { userMessage: ChatMessage; assistantMessageId: string };
}

export async function interruptChat(threadId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/chat/threads/${threadId}/interrupt`), { method: "POST" });
  await expectOk(res);
}

export function chatEventStreamUrl(threadId: string): string {
  return apiUrl(`/api/chat/threads/${threadId}/events`);
}

async function errorText(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
