import { ArtifactStore } from "@agent-dock/artifacts";
import {
  AgentRunEventsRepo,
  AgentRunsRepo,
  ArtifactsRepo,
  AtlassianCacheRepo,
  ChatMessagesRepo,
  ChatThreadsRepo,
  MetaContextsRepo,
  NotesRepo,
  PipelineStepsRepo,
  ProjectsRepo,
  SessionsRepo,
  SettingsRepo,
  StepArtifactsRepo,
  StepEventsRepo,
  StickyNotesRepo,
  TaskLinksRepo,
  TasksRepo,
  TodoListsRepo,
  WorkflowRunsRepo,
  migrate,
  openDatabase,
} from "@agent-dock/db";
import { SdkAgentRunner, SdkStepRunner } from "@agent-dock/agents";
import { EventBus, WorkflowCoordinator } from "@agent-dock/orchestrator";
import { featureFlow } from "@agent-dock/workflows";
import { WorktreeManager } from "@agent-dock/worktrees";
import { RunCoordinator } from "./runCoordinator.js";
import { WorkspaceService } from "./services/workspace.js";
import { AtlassianService } from "./services/atlassian.js";
import { ExplorationCoordinator } from "./services/explorationCoordinator.js";
import { TasksService } from "./services/tasks.js";
import { StartupService } from "./services/startup.js";
import { DashboardService } from "./services/dashboard.js";
import { SessionsService } from "./services/sessions.js";
import { NotesService } from "./services/notes.js";
import { ChatService } from "./services/chat.js";

export interface AppContainer {
  repos: {
    settings: SettingsRepo;
    runs: AgentRunsRepo;
    events: AgentRunEventsRepo;
    artifacts: ArtifactsRepo;
    projects: ProjectsRepo;
    tasks: TasksRepo;
    taskLinks: TaskLinksRepo;
    atlassianCache: AtlassianCacheRepo;
    metaContexts: MetaContextsRepo;
    sessions: SessionsRepo;
    workflowRuns: WorkflowRunsRepo;
    pipelineSteps: PipelineStepsRepo;
    stepEvents: StepEventsRepo;
    stepArtifacts: StepArtifactsRepo;
    notes: NotesRepo;
    stickies: StickyNotesRepo;
    todoLists: TodoListsRepo;
    chatThreads: ChatThreadsRepo;
    chatMessages: ChatMessagesRepo;
  };
  artifactStore: ArtifactStore;
  runCoordinator: RunCoordinator;
  workspace: WorkspaceService;
  atlassian: AtlassianService;
  exploration: ExplorationCoordinator;
  tasks: TasksService;
  startup: StartupService;
  dashboard: DashboardService;
  sessionsService: SessionsService;
  notes: NotesService;
  chat: ChatService;
  workflows: {
    coordinator: WorkflowCoordinator;
    eventBus: EventBus;
    worktrees: WorktreeManager;
  };
}

export function buildContainer(): AppContainer {
  const db = openDatabase();
  migrate(db);

  const repos = {
    settings: new SettingsRepo(db),
    runs: new AgentRunsRepo(db),
    events: new AgentRunEventsRepo(db),
    artifacts: new ArtifactsRepo(db),
    projects: new ProjectsRepo(db),
    tasks: new TasksRepo(db),
    taskLinks: new TaskLinksRepo(db),
    atlassianCache: new AtlassianCacheRepo(db),
    metaContexts: new MetaContextsRepo(db),
    sessions: new SessionsRepo(db),
    workflowRuns: new WorkflowRunsRepo(db),
    pipelineSteps: new PipelineStepsRepo(db),
    stepEvents: new StepEventsRepo(db),
    stepArtifacts: new StepArtifactsRepo(db),
    notes: new NotesRepo(db),
    stickies: new StickyNotesRepo(db),
    todoLists: new TodoListsRepo(db),
    chatThreads: new ChatThreadsRepo(db),
    chatMessages: new ChatMessagesRepo(db),
  };
  const artifactStore = new ArtifactStore();
  const runCoordinator = new RunCoordinator({
    repos: { settings: repos.settings, runs: repos.runs, events: repos.events, artifacts: repos.artifacts },
    artifactStore,
    runner: new SdkAgentRunner(),
  });

  const workspace = new WorkspaceService({ settings: repos.settings, projects: repos.projects });
  const atlassian = new AtlassianService();
  const exploration = new ExplorationCoordinator({
    atlassianCache: repos.atlassianCache,
  });

  // Workflow orchestration. workspaceDir is read lazily so it picks up
  // any change the user makes via the Onboarding/Settings UI.
  const eventBus = new EventBus();
  const worktrees = new WorktreeManager();
  const stepRunner = new SdkStepRunner();
  const workflowCoordinator = new WorkflowCoordinator({
    repos: {
      sessions: repos.sessions,
      tasks: repos.tasks,
      projects: repos.projects,
      taskLinks: repos.taskLinks,
      atlassianCache: repos.atlassianCache,
      metaContexts: repos.metaContexts,
      workflowRuns: repos.workflowRuns,
      pipelineSteps: repos.pipelineSteps,
      stepEvents: repos.stepEvents,
      stepArtifacts: repos.stepArtifacts,
    },
    worktrees,
    runner: stepRunner,
    workflow: featureFlow,
    eventBus,
    workspaceDir: () => repos.settings.getRuntime().workspaceDir,
    maxConcurrentSessions: () => repos.settings.getRuntime().maxConcurrentSessions,
  });

  const tasks = new TasksService({
    tasks: repos.tasks,
    links: repos.taskLinks,
    sessions: repos.sessions,
    projects: repos.projects,
    atlassianCache: repos.atlassianCache,
    workflowCoordinator,
    worktrees,
    workflowRuns: repos.workflowRuns,
    pipelineSteps: repos.pipelineSteps,
  });

  const startup = new StartupService({
    sessions: repos.sessions,
    projects: repos.projects,
    worktrees,
  });

  const dashboard = new DashboardService({
    db,
    sessions: repos.sessions,
    tasks: repos.tasks,
    projects: repos.projects,
    pipelineSteps: repos.pipelineSteps,
    workflowRuns: repos.workflowRuns,
  });

  const sessionsService = new SessionsService({
    db,
    pipelineSteps: repos.pipelineSteps,
    workflowRuns: repos.workflowRuns,
  });

  const notes = new NotesService({
    notes: repos.notes,
    stickies: repos.stickies,
    todoLists: repos.todoLists,
  });

  const chat = new ChatService({
    threads: repos.chatThreads,
    messages: repos.chatMessages,
    projects: repos.projects,
    workspaceDir: () => repos.settings.getRuntime().workspaceDir,
  });

  return {
    repos,
    artifactStore,
    runCoordinator,
    workspace,
    atlassian,
    exploration,
    tasks,
    startup,
    dashboard,
    sessionsService,
    notes,
    chat,
    workflows: { coordinator: workflowCoordinator, eventBus, worktrees },
  };
}
