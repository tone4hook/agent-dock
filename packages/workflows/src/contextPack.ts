import { truncate } from "@agent-dock/atlassian";
import type {
  ContextPack,
  ContextPackArtifact,
  ContextPackConfluenceLink,
  ContextPackInput,
  ContextPackJiraLink,
  ContextPackMetaContext,
  ContextPackProject,
  ContextPackTask,
  RoleDef,
} from "./types.js";

/** ADF-derived markdown is truncated per item to keep ContextPack budget bounded. */
export const ATLASSIAN_ITEM_BYTE_BUDGET = 6 * 1024;

/**
 * Build the Markdown bundle that becomes <sessionWorktree>/.context/PACK.md.
 *
 * Section order (stable, per .plan/findings.md design):
 *   Project → Task → Linked Jira → Linked Confluence → Meta-context →
 *   Upstream artifacts → Role brief
 *
 * Empty sections are omitted. Order never changes.
 */
export function buildContextPack(input: ContextPackInput): ContextPack {
  const sections: string[] = [];
  sections.push(renderProject(input.project));
  sections.push(renderTask(input.task));
  if (input.jiraLinks.length > 0) {
    sections.push(renderJiraLinks(input.jiraLinks));
  }
  if (input.confluenceLinks.length > 0) {
    sections.push(renderConfluenceLinks(input.confluenceLinks));
  }
  if (input.metaContexts.length > 0) {
    sections.push(renderMetaContexts(input.metaContexts));
  }
  if (input.priorStepArtifacts.length > 0) {
    sections.push(renderArtifacts(input.priorStepArtifacts));
  }
  sections.push(renderRoleBrief(input.role));
  return { markdown: sections.join("\n\n") + "\n" };
}

function renderProject(p: ContextPackProject): string {
  return [
    "# Project",
    "",
    `- Name: ${p.name}`,
    `- Root: ${p.rootPath}`,
    `- Default base ref: ${p.defaultBaseRef}`,
  ].join("\n");
}

function renderTask(t: ContextPackTask): string {
  const body = t.descriptionMd.trim();
  return [
    "# Task",
    "",
    `- Title: ${t.title}`,
    `- Status: ${t.status}`,
    "",
    "## Description",
    "",
    body || "(no description)",
  ].join("\n");
}

function renderJiraLinks(links: ContextPackJiraLink[]): string {
  const parts: string[] = ["# Linked Jira issues", ""];
  for (const l of links) {
    parts.push(`## ${l.jiraKey}${l.role ? ` _(role: ${l.role})_` : ""}`);
    parts.push("");
    parts.push(`- Summary: ${l.summary ?? "(unknown)"}`);
    parts.push(`- Status: ${l.status ?? "(unknown)"}`);
    if (l.descriptionMd) {
      parts.push("");
      parts.push("### Description");
      parts.push("");
      parts.push(truncate(l.descriptionMd, ATLASSIAN_ITEM_BYTE_BUDGET));
    }
    if (l.notesMd && l.notesMd.trim()) {
      parts.push("");
      parts.push("### Local notes");
      parts.push("");
      parts.push(l.notesMd.trim());
    }
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

function renderConfluenceLinks(links: ContextPackConfluenceLink[]): string {
  const parts: string[] = ["# Linked Confluence pages", ""];
  for (const l of links) {
    parts.push(`## ${l.title ?? l.pageId}${l.role ? ` _(role: ${l.role})_` : ""}`);
    parts.push("");
    parts.push(`- Page id: ${l.pageId}`);
    if (l.bodyMd) {
      parts.push("");
      parts.push("### Body");
      parts.push("");
      parts.push(truncate(l.bodyMd, ATLASSIAN_ITEM_BYTE_BUDGET));
    }
    if (l.notesMd && l.notesMd.trim()) {
      parts.push("");
      parts.push("### Local notes");
      parts.push("");
      parts.push(l.notesMd.trim());
    }
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

/**
 * Kinds where chronology matters: later entries supersede earlier ones.
 * For these, the renderer pulls the kind out into a dedicated section,
 * sorts newest-first, and labels each entry with a round number so the
 * agent reading the pack can disambiguate conflicting answers.
 */
const SUPERSEDING_KINDS = new Set(["clarification_answers", "reviewer_feedback"]);

function renderMetaContexts(items: ContextPackMetaContext[]): string {
  const parts: string[] = ["# Meta-context notes", ""];

  // Partition: regular meta-context first (untouched ordering), then a
  // dedicated section per superseding kind with explicit round labels.
  const regular: ContextPackMetaContext[] = [];
  const superseding = new Map<string, ContextPackMetaContext[]>();
  for (const m of items) {
    if (SUPERSEDING_KINDS.has(m.kind)) {
      const list = superseding.get(m.kind) ?? [];
      list.push(m);
      superseding.set(m.kind, list);
    } else {
      regular.push(m);
    }
  }

  for (const m of regular) {
    parts.push(`## ${m.scopeType}/${m.scopeId} _(${m.kind})_`);
    parts.push("");
    parts.push(m.bodyMd.trim() || "(empty)");
    parts.push("");
  }

  for (const [kind, list] of superseding) {
    // Sort newest-first by createdAt when available; fall back to
    // input order (which the caller already passes ASC) reversed.
    const sorted = [...list].sort((a, b) => {
      const ta = a.createdAt ?? "";
      const tb = b.createdAt ?? "";
      if (ta && tb) return tb.localeCompare(ta);
      if (ta && !tb) return -1;
      if (!ta && tb) return 1;
      return 0;
    });
    if (!sorted[0]?.createdAt) sorted.reverse();
    parts.push(
      `## ${kind} (most recent first — later rounds supersede earlier)`,
    );
    parts.push("");
    sorted.forEach((m, i) => {
      const round = sorted.length - i;
      const tsLabel = m.createdAt ? ` — ${m.createdAt}` : "";
      parts.push(`### Round ${round}${tsLabel}`);
      parts.push("");
      parts.push(m.bodyMd.trim() || "(empty)");
      parts.push("");
    });
  }

  return parts.join("\n").trimEnd();
}

function renderArtifacts(artifacts: ContextPackArtifact[]): string {
  const parts: string[] = ["# Upstream artifacts", ""];
  for (const a of artifacts) {
    parts.push(`## ${a.kind}`);
    parts.push("");
    parts.push(`- Path: ${a.filePath}`);
    if (a.preview) {
      parts.push("");
      parts.push("```");
      parts.push(a.preview);
      parts.push("```");
    }
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

function renderRoleBrief(role: RoleDef): string {
  return [
    "# Role brief",
    "",
    `- Role: ${role.role}`,
    `- Model: ${role.model}${role.reasoningHint ? ` (reasoning: ${role.reasoningHint})` : ""}`,
    `- Permission mode: ${role.permissionMode}`,
    `- Allowed tools: ${role.allowedTools.join(", ")}`,
    role.expectedArtifacts.length > 0
      ? `- Expected artifacts: ${role.expectedArtifacts.join(", ")}`
      : "- Expected artifacts: (none — return your output as the assistant message)",
  ].join("\n");
}
