export interface WelcomeTab {
  id: string;
  label: string;
  title: string;
  body: string;
}

export const WELCOME_TABS: ReadonlyArray<WelcomeTab> = [
  {
    id: "workflows",
    label: "Workflows",
    title: "Run a task end-to-end",
    body: [
      "Tasks are how you ship code with agent-dock.",
      "",
      "1. **Pick or create a Task** from the Tasks board (or a Jira ticket you saved locally).",
      "2. **Start a session** from the task detail. agent-dock creates a per-session git worktree so your main checkout is never touched.",
      "3. **The four-role pipeline runs in order:** Investigate → Plan → Implement → Review.",
      "4. **Approve at each gate.** Review the plan, accept or reject with feedback. Code review either passes (session completes) or sends the work back to Plan with the reviewer's notes.",
      "",
      "Sessions live under your workspace at `worktrees/<projectId>/<sessionId>/`. Cancel any session at any time from the session detail page.",
    ].join("\n"),
  },
  {
    id: "chat-notes",
    label: "Chat & Notes",
    title: "Chat is for thinking, not coding",
    body: [
      "**Chat** is for ideation, Q&A, and capturing ideas — it does **not** edit your code or run workflows.",
      "",
      "- Default scope is *General* (no project context). Switch to *Workspace* or *Project* to give the model a working directory for read-only context.",
      "- Hover any assistant reply for **Save as note**, **Copy**, or **Regenerate**.",
      "",
      "**Notes** are your durable memory. Save useful chat replies, link them to tasks or Jira issues, and pin sticky notes to a project. Anything code-changing belongs in a Task — not a chat.",
    ].join("\n"),
  },
  {
    id: "atlassian",
    label: "Atlassian setup",
    title: "Connect your Jira & Confluence",
    body: [
      "Most of agent-dock's context comes from Atlassian. To enable it:",
      "",
      "1. In **Settings → Atlassian**, paste your **site URL** (e.g. `https://yourco.atlassian.net`), your **email**, and an **API token**.",
      "2. Generate a token at *Atlassian → Account settings → Security → API tokens*.",
      "3. Your token is stored in the macOS Keychain, never in the database.",
      "4. The Sprint tab also needs a **Jira board id** (set it in the same Settings section).",
      "",
      "Once connected, you can search Jira and Confluence, save tickets/pages locally, and link them to tasks for richer context packs.",
    ].join("\n"),
  },
];
