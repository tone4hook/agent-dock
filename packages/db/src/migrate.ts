import type Database from "better-sqlite3";

const migrations: Array<{ id: string; sql: string }> = [
  {
    id: "001_init",
    sql: `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_hint TEXT,
  reasoning_hint TEXT,
  permission_mode TEXT NOT NULL DEFAULT 'bypass',
  working_directory TEXT,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  final_text TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  preview TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id)
);
`
  },
  {
    id: "002_workflows",
    sql: `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  default_base_ref TEXT NOT NULL DEFAULT 'main',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  base_ref_override TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','done','abandoned')),
  current_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_jira_links (
  task_id TEXT NOT NULL,
  jira_key TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, jira_key),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_jira_links_key ON task_jira_links(jira_key);

CREATE TABLE IF NOT EXISTS task_confluence_links (
  task_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, page_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_confluence_links_page ON task_confluence_links(page_id);

CREATE TABLE IF NOT EXISTS jira_issues (
  issue_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jira_issue_context (
  issue_key TEXT PRIMARY KEY,
  notes_md TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issue_key) REFERENCES jira_issues(issue_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS confluence_pages (
  page_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS confluence_page_context (
  page_id TEXT PRIMARY KEY,
  notes_md TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (page_id) REFERENCES confluence_pages(page_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta_contexts (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('project','task','jira','confluence')),
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (kind IN ('manual','haiku_explored')),
  body_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_meta_contexts_scope ON meta_contexts(scope_type, scope_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  branch TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','running','awaiting_approval','paused',
                      'completed','failed','cancelled')),
  current_step_id TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workflow_def_id TEXT NOT NULL DEFAULT 'feature-flow',
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_session ON workflow_runs(session_id);

CREATE TABLE IF NOT EXISTS pipeline_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('investigate','plan','implement','code_review')),
  runner TEXT NOT NULL DEFAULT 'host'
    CHECK (runner IN ('host','docker')),
  thread_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','cancelled')),
  started_at TEXT,
  ended_at TEXT,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_run ON pipeline_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_status ON pipeline_steps(status);

CREATE TABLE IF NOT EXISTS step_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (step_id) REFERENCES pipeline_steps(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_step_events_step ON step_events(step_id);

CREATE TABLE IF NOT EXISTS step_artifacts (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  preview TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (step_id) REFERENCES pipeline_steps(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_step_artifacts_step ON step_artifacts(step_id);
`
  },
  {
    id: "003_notes",
    sql: `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('manual','chat_response')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  -- chat_message_id is a forward reference to a table that lands in
  -- Phase 27 (004_chat). We declare it here as nullable TEXT without
  -- the FK; Phase 27 will add the FK + cascade then.
  chat_message_id TEXT,
  project_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_source ON notes(source);
CREATE INDEX IF NOT EXISTS idx_notes_chat_message ON notes(chat_message_id);

CREATE TABLE IF NOT EXISTS note_jira_links (
  note_id TEXT NOT NULL,
  jira_key TEXT NOT NULL,
  PRIMARY KEY (note_id, jira_key),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS note_confluence_links (
  note_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  PRIMARY KEY (note_id, page_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS note_task_links (
  note_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (note_id, task_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

-- Workspace-scoped quick-reminder notes. Capped at 3 by the service
-- layer (no DB-side trigger; the cap is a UX rule, not a schema invariant).
CREATE TABLE IF NOT EXISTS sticky_notes (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#fff5b8',
  tag TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS todo_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS todo_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  body TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  ord INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_todo_items_list ON todo_items(list_id);
`
  },
  {
    id: "004_chat",
    sql: `
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  model TEXT NOT NULL
    CHECK (model IN ('claude-sonnet-4-6','claude-opus-4-7','claude-haiku-4-5-20251001')),
  reasoning_effort TEXT
    CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('low','medium','high')),
  scope TEXT NOT NULL
    CHECK (scope IN ('general','workspace','project')),
  scope_project_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (scope_project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_threads_created ON chat_threads(created_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  tool_uses TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_thread_ord ON chat_messages(thread_id, ord);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

-- Note on notes.chat_message_id: SQLite cannot retrofit a FOREIGN KEY
-- via ALTER TABLE without a full table rebuild. The forward reference
-- declared in migration 003_notes stays as a soft pointer; the chat
-- service is responsible for nulling notes.chat_message_id when a
-- thread (and therefore its messages) is deleted.
`
  },
  {
    id: "005_meta_context_review_feedback",
    sql: `
-- SQLite cannot ALTER a CHECK constraint, so widen the meta_contexts
-- kind enum (now includes 'review_feedback') by recreating the table.
-- Phase 31 needs this kind so the UI can persist code-review verdicts
-- as task-scoped meta-context that future sessions of the same task
-- pick up via buildContextPack's Meta-context section.
CREATE TABLE meta_contexts_new (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('project','task','jira','confluence')),
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (kind IN ('manual','haiku_explored','review_feedback')),
  body_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO meta_contexts_new (id, scope_type, scope_id, kind, body_md, created_at, updated_at)
  SELECT id, scope_type, scope_id, kind, body_md, created_at, updated_at FROM meta_contexts;
DROP TABLE meta_contexts;
ALTER TABLE meta_contexts_new RENAME TO meta_contexts;
CREATE INDEX IF NOT EXISTS idx_meta_contexts_scope ON meta_contexts(scope_type, scope_id);
`
  },
  {
    id: "006_clarification_loop",
    sql: `
-- Phase 33: widen sessions.status to include 'awaiting_clarification'
-- and meta_contexts.kind to include 'clarification_answers'.
-- SQLite recreate-and-rename pattern (same as 005).
CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  branch TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','running','awaiting_approval','awaiting_clarification',
                      'paused','completed','failed','cancelled')),
  current_step_id TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
INSERT INTO sessions_new (id, task_id, base_ref, branch, worktree_path, status,
                          current_step_id, started_at, ended_at, created_at, updated_at)
  SELECT id, task_id, base_ref, branch, worktree_path, status,
         current_step_id, started_at, ended_at, created_at, updated_at FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

CREATE TABLE meta_contexts_new (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('project','task','jira','confluence')),
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (kind IN ('manual','haiku_explored','review_feedback','clarification_answers')),
  body_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO meta_contexts_new (id, scope_type, scope_id, kind, body_md, created_at, updated_at)
  SELECT id, scope_type, scope_id, kind, body_md, created_at, updated_at FROM meta_contexts;
DROP TABLE meta_contexts;
ALTER TABLE meta_contexts_new RENAME TO meta_contexts;
CREATE INDEX IF NOT EXISTS idx_meta_contexts_scope ON meta_contexts(scope_type, scope_id);

-- Widen pipeline_steps.role CHECK so the new clarify/validate steps
-- can be persisted. Same recreate-and-rename pattern.
CREATE TABLE pipeline_steps_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('investigate','clarify','plan','validate','implement','code_review')),
  runner TEXT NOT NULL DEFAULT 'host'
    CHECK (runner IN ('host','docker')),
  thread_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','cancelled')),
  started_at TEXT,
  ended_at TEXT,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
);
INSERT INTO pipeline_steps_new (id, run_id, ord, role, runner, thread_id, status,
                                 started_at, ended_at, depends_on_json, created_at, updated_at)
  SELECT id, run_id, ord, role, runner, thread_id, status,
         started_at, ended_at, depends_on_json, created_at, updated_at FROM pipeline_steps;
DROP TABLE pipeline_steps;
ALTER TABLE pipeline_steps_new RENAME TO pipeline_steps;
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_run ON pipeline_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_status ON pipeline_steps(status);
`
  }
];

export function migrate(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => (row as { id: string }).id),
  );
  const insert = db.prepare("INSERT INTO schema_migrations (id) VALUES (?)");
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.id);
    })();
  }
}
