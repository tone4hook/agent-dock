import type { AdfNode } from "./types.js";

// Node types implemented per Phase 4 spec:
// paragraph, heading, codeBlock, bulletList, orderedList, panel, link (mark),
// mention, emoji, table, inlineCard. Plus text + hardBreak + rule + blockquote
// for sane fallback.

export function adfToMarkdown(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const node = input as AdfNode;
  return renderBlocks(node.content ?? []).trimEnd() + "\n";
}

function renderBlocks(nodes: AdfNode[]): string {
  return nodes.map(renderBlock).join("\n");
}

function renderBlock(node: AdfNode): string {
  switch (node.type) {
    case "paragraph":
      return renderInline(node.content ?? []) + "\n";
    case "heading": {
      const level = clampHeading(node.attrs?.level);
      return `${"#".repeat(level)} ${renderInline(node.content ?? [])}\n`;
    }
    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const body = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `\`\`\`${lang}\n${body}\n\`\`\`\n`;
    }
    case "bulletList":
      return renderList(node.content ?? [], "- ") + "\n";
    case "orderedList":
      return renderOrderedList(node.content ?? []) + "\n";
    case "panel":
      return renderPanel(node) + "\n";
    case "blockquote":
      return prefixLines(renderBlocks(node.content ?? []).trimEnd(), "> ") + "\n";
    case "rule":
      return "---\n";
    case "table":
      return renderTable(node) + "\n";
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return ""; // images/attachments — skipped in v1
    default:
      // Unknown block → render its inline children if any, else empty.
      if (node.content?.length) return renderInline(node.content) + "\n";
      return "";
  }
}

function renderList(items: AdfNode[], prefix: string): string {
  return items
    .map((item) => {
      const inner = renderBlocks(item.content ?? []).trim();
      const lines = inner.split("\n");
      return lines
        .map((ln, i) => (i === 0 ? prefix + ln : "  " + ln))
        .join("\n");
    })
    .join("\n");
}

function renderOrderedList(items: AdfNode[]): string {
  return items
    .map((item, i) => {
      const inner = renderBlocks(item.content ?? []).trim();
      const lines = inner.split("\n");
      const prefix = `${i + 1}. `;
      return lines
        .map((ln, j) => (j === 0 ? prefix + ln : "   " + ln))
        .join("\n");
    })
    .join("\n");
}

function renderPanel(node: AdfNode): string {
  const kind =
    typeof node.attrs?.panelType === "string" ? String(node.attrs.panelType) : "info";
  const inner = renderBlocks(node.content ?? []).trimEnd();
  return prefixLines(`[${kind.toUpperCase()}]\n${inner}`, "> ");
}

function renderTable(node: AdfNode): string {
  const rows = (node.content ?? []).filter((r) => r.type === "tableRow");
  if (rows.length === 0) return "";
  const renderedRows = rows.map((row) =>
    (row.content ?? [])
      .filter((c) => c.type === "tableHeader" || c.type === "tableCell")
      .map((cell) => renderInline(cell.content?.flatMap((n) => n.content ?? [n]) ?? []).replace(/\|/g, "\\|").replace(/\n+/g, " "))
      .join(" | "),
  );
  if (renderedRows.length === 0) return "";
  const headerCells = (rows[0]?.content ?? []).length;
  const sep = Array.from({ length: headerCells }, () => "---").join(" | ");
  const [head, ...body] = renderedRows;
  return [`| ${head} |`, `| ${sep} |`, ...body.map((r) => `| ${r} |`)].join("\n");
}

function renderInline(nodes: AdfNode[]): string {
  return nodes.map(renderInlineNode).join("");
}

function renderInlineNode(node: AdfNode): string {
  switch (node.type) {
    case "text":
      return applyMarks(node.text ?? "", node.marks ?? []);
    case "hardBreak":
      return "  \n";
    case "mention": {
      const text = typeof node.attrs?.text === "string" ? node.attrs.text : "";
      return text ? `@${text.replace(/^@/, "")}` : "@user";
    }
    case "emoji": {
      const shortName =
        typeof node.attrs?.shortName === "string" ? node.attrs.shortName : "";
      const text = typeof node.attrs?.text === "string" ? node.attrs.text : "";
      return text || shortName || "";
    }
    case "inlineCard": {
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      return url ? `[${url}](${url})` : "";
    }
    default:
      // Unknown inline → render its children if any.
      return node.content ? renderInline(node.content) : "";
  }
}

function applyMarks(text: string, marks: NonNullable<AdfNode["marks"]>): string {
  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "strong":
        out = `**${out}**`;
        break;
      case "em":
        out = `*${out}*`;
        break;
      case "code":
        out = `\`${out}\``;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "link": {
        const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
        out = href ? `[${out}](${href})` : out;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((ln) => (ln ? prefix + ln : prefix.trimEnd()))
    .join("\n");
}

function clampHeading(level: unknown): number {
  const n = typeof level === "number" ? level : 1;
  return Math.min(6, Math.max(1, Math.floor(n)));
}

/**
 * Truncate markdown to roughly `bytes` UTF-8 bytes. Aims for whole-line
 * boundaries; appends a "(truncated)" marker if anything was cut.
 */
export function truncate(md: string, bytes: number): string {
  const enc = new TextEncoder();
  if (enc.encode(md).byteLength <= bytes) return md;
  const lines = md.split("\n");
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const next = enc.encode(line + "\n").byteLength;
    if (used + next > bytes) break;
    out.push(line);
    used += next;
  }
  out.push("…(truncated)");
  return out.join("\n");
}

