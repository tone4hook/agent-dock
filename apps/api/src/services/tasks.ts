import type {
  AtlassianCacheRepo,
  PipelineStepsRepo,
  ProjectsRepo,
  SessionsRepo,
  TaskLinksRepo,
  TasksRepo,
  WorkflowRunsRepo,
} from "@agent-dock/db";
import type { WorkflowCoordinator } from "@agent-dock/orchestrator";
import type { WorktreeManager } from "@agent-dock/worktrees";
import type {
  CreateTaskInput,
  LiveSessionSummary,
  Session,
  Task,
  TaskConfluenceLink,
  TaskJiraLink,
  TaskStatus,
  UpdateTaskInput,
} from "@agent-dock/shared";

export interface TasksServiceDeps {
  tasks: TasksRepo;
  links: TaskLinksRepo;
  sessions: SessionsRepo;
  projects: ProjectsRepo;
  atlassianCache: AtlassianCacheRepo;
  workflowCoordinator: WorkflowCoordinator;
  worktrees: WorktreeManager;
  workflowRuns: WorkflowRunsRepo;
  pipelineSteps: PipelineStepsRepo;
}

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

export class TasksService {
  constructor(private readonly deps: TasksServiceDeps) {}

  list(filter: { projectId?: string; status?: TaskStatus } = {}): TaskWithCounts[] {
    return this.deps.tasks.list(filter).map((t) => this.augment(t));
  }

  get(id: string): TaskDetail | null {
    const task = this.deps.tasks.get(id);
    if (!task) return null;
    const enriched = this.augment(task);

    const jiraLinks = this.deps.links.listJira(id).map((link) => {
      const cached = this.deps.atlassianCache.getJiraIssue(link.jiraKey);
      const payload = cached ? safeParse(cached.payloadJson) : null;
      const detail = (payload as { detail?: { summary?: string; status?: string } } | null)?.detail;
      return {
        ...link,
        summary: detail?.summary,
        status: detail?.status,
      };
    });

    const confluenceLinks = this.deps.links.listConfluence(id).map((link) => {
      const cached = this.deps.atlassianCache.getConfluencePage(link.pageId);
      const payload = cached ? safeParse(cached.payloadJson) : null;
      const detail = (payload as { detail?: { title?: string } } | null)?.detail;
      return {
        ...link,
        title: detail?.title,
      };
    });

    return { ...enriched, jiraLinks, confluenceLinks };
  }

  create(input: CreateTaskInput): TaskDetail {
    if (!this.deps.projects.get(input.projectId)) {
      throw new Error(`Project ${input.projectId} not found`);
    }
    const created = this.deps.tasks.create({
      projectId: input.projectId,
      title: input.title,
      descriptionMd: input.descriptionMd ?? "",
      baseRefOverride: input.baseRefOverride ?? null,
    });
    const detail = this.get(created.id);
    if (!detail) throw new Error("Failed to load created task");
    return detail;
  }

  update(id: string, patch: UpdateTaskInput): TaskDetail {
    this.deps.tasks.update(id, patch);
    const detail = this.get(id);
    if (!detail) throw new Error("Task not found");
    return detail;
  }

  /**
   * Delete a task and cascade-clean its session-side state:
   *   1. Cancel any in-flight session (the coordinator drains the
   *      runner and tears down the watcher).
   *   2. Remove each session's worktree+branch via WorktreeManager.
   *   3. Drop the task row; FKs cascade-delete sessions, links, runs,
   *      steps, events, artifacts. Atlassian cache rows are NOT
   *      attached to the task FK so they stay intact.
   */
  async delete(id: string): Promise<void> {
    const task = this.deps.tasks.get(id);
    if (!task) {
      this.deps.tasks.delete(id);
      return;
    }
    const project = this.deps.projects.get(task.projectId);
    const sessions = this.deps.sessions.listForTask(id);
    for (const s of sessions) {
      if (s.status === "running" || s.status === "awaiting_approval" || s.status === "paused") {
        try {
          await this.deps.workflowCoordinator.cancel(s.id);
        } catch {
          // best-effort — fall through to worktree cleanup
        }
      }
      if (project && s.worktreePath && s.worktreePath !== "pending") {
        try {
          await this.deps.worktrees.remove({
            projectRoot: project.rootPath,
            worktreePath: s.worktreePath,
            branch: s.branch,
          });
        } catch {
          // best-effort — git may have already pruned the worktree
        }
      }
    }
    this.deps.tasks.delete(id);
  }

  addJiraLink(taskId: string, jiraKey: string, role: string): TaskDetail {
    if (!this.deps.tasks.get(taskId)) throw new Error("Task not found");
    if (!this.deps.atlassianCache.getJiraIssue(jiraKey)) {
      throw new Error(`Jira issue ${jiraKey} is not saved locally`);
    }
    this.deps.links.addJira({ taskId, jiraKey, role });
    return this.requireDetail(taskId);
  }

  removeJiraLink(taskId: string, jiraKey: string): TaskDetail {
    this.deps.links.removeJira(taskId, jiraKey);
    return this.requireDetail(taskId);
  }

  addConfluenceLink(taskId: string, pageId: string, role: string): TaskDetail {
    if (!this.deps.tasks.get(taskId)) throw new Error("Task not found");
    if (!this.deps.atlassianCache.getConfluencePage(pageId)) {
      throw new Error(`Confluence page ${pageId} is not saved locally`);
    }
    this.deps.links.addConfluence({ taskId, pageId, role });
    return this.requireDetail(taskId);
  }

  removeConfluenceLink(taskId: string, pageId: string): TaskDetail {
    this.deps.links.removeConfluence(taskId, pageId);
    return this.requireDetail(taskId);
  }

  /**
   * All sessions for a task, any status, most-recent first. Powers the
   * Sessions section on TaskDetail.
   */
  listSessionsForTask(taskId: string): Session[] {
    return this.deps.sessions.listForTask(taskId);
  }

  private augment(task: Task): TaskWithCounts {
    const sessions = this.deps.sessions.listForTask(task.id);
    return {
      ...task,
      sessionsCount: sessions.length,
      jiraLinksCount: this.deps.links.listJira(task.id).length,
      confluenceLinksCount: this.deps.links.listConfluence(task.id).length,
      liveSession: this.summarizeLiveSession(sessions),
    };
  }

  private summarizeLiveSession(sessions: Session[]): LiveSessionSummary | null {
    // sessions are pre-sorted by createdAt DESC; pick the most recent
    // non-terminal one. (At most one is expected, but sorting by recency
    // keeps the surface deterministic if invariants ever drift.)
    const live = sessions.find(
      (s) => s.status === "running" || s.status === "awaiting_approval" || s.status === "paused",
    );
    if (!live) return null;
    let currentStepRole: LiveSessionSummary["currentStepRole"] = null;
    let currentStepOrd: LiveSessionSummary["currentStepOrd"] = null;
    let totalSteps: LiveSessionSummary["totalSteps"] = null;
    if (live.currentStepId) {
      const step = this.deps.pipelineSteps.get(live.currentStepId);
      if (step) {
        currentStepRole = step.role;
        currentStepOrd = step.ord;
        totalSteps = this.deps.pipelineSteps.listForRun(step.runId).length;
      }
    } else {
      // No current step yet — totalSteps still useful if the run exists.
      const runs = this.deps.workflowRuns.listForSession(live.id);
      const run = runs[runs.length - 1];
      if (run) totalSteps = this.deps.pipelineSteps.listForRun(run.id).length;
    }
    return {
      sessionId: live.id,
      status: live.status,
      currentStepRole,
      currentStepOrd,
      totalSteps,
    };
  }

  private requireDetail(id: string): TaskDetail {
    const detail = this.get(id);
    if (!detail) throw new Error("Task not found");
    return detail;
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
