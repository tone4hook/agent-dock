import { describe, expect, it } from "vitest";
import { adfToMarkdown, truncate } from "../src/adf.js";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const p = (...inline: unknown[]) => ({ type: "paragraph", content: inline });
const t = (text: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});

describe("adfToMarkdown", () => {
  it("renders paragraph with marks", () => {
    const out = adfToMarkdown(
      doc(p(t("hello "), t("bold", [{ type: "strong" }]), t(" and "), t("em", [{ type: "em" }]))),
    );
    expect(out).toBe("hello **bold** and *em*\n");
  });

  it("renders headings, code blocks, and links", () => {
    const out = adfToMarkdown(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [t("Title")] },
        p(t("see "), t("docs", [{ type: "link", attrs: { href: "https://example.com" } }])),
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [t("const x = 1;")],
        },
      ),
    );
    expect(out).toBe(
      "## Title\n\nsee [docs](https://example.com)\n\n```ts\nconst x = 1;\n```\n",
    );
  });

  it("renders bullet and ordered lists with nesting", () => {
    const li = (...content: unknown[]) => ({ type: "listItem", content });
    const out = adfToMarkdown(
      doc(
        {
          type: "bulletList",
          content: [li(p(t("alpha"))), li(p(t("beta")))],
        },
        {
          type: "orderedList",
          content: [li(p(t("first"))), li(p(t("second")))],
        },
      ),
    );
    expect(out).toBe("- alpha\n- beta\n\n1. first\n2. second\n");
  });

  it("renders panel as blockquote with type prefix", () => {
    const out = adfToMarkdown(
      doc({
        type: "panel",
        attrs: { panelType: "warning" },
        content: [p(t("careful"))],
      }),
    );
    expect(out).toBe("> [WARNING]\n> careful\n");
  });

  it("renders mention, emoji, and inlineCard inline nodes", () => {
    const out = adfToMarkdown(
      doc(
        p(
          t("ping "),
          { type: "mention", attrs: { text: "@alice" } },
          t(" "),
          { type: "emoji", attrs: { text: "🔥", shortName: ":fire:" } },
          t(" "),
          { type: "inlineCard", attrs: { url: "https://example.com/card" } },
        ),
      ),
    );
    expect(out).toBe("ping @alice 🔥 [https://example.com/card](https://example.com/card)\n");
  });

  it("renders a basic table", () => {
    const cell = (text: string) => ({
      type: "tableCell",
      content: [p(t(text))],
    });
    const header = (text: string) => ({
      type: "tableHeader",
      content: [p(t(text))],
    });
    const row = (...cells: unknown[]) => ({ type: "tableRow", content: cells });

    const out = adfToMarkdown(
      doc({
        type: "table",
        content: [row(header("a"), header("b")), row(cell("1"), cell("2"))],
      }),
    );
    expect(out).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
  });

  it("returns empty for unknown / non-object input", () => {
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown(undefined)).toBe("");
    expect(adfToMarkdown("nope")).toBe("");
  });
});

describe("truncate", () => {
  it("returns input unchanged when under the byte budget", () => {
    expect(truncate("short", 100)).toBe("short");
  });

  it("truncates on whole-line boundary and appends marker", () => {
    const md = "line1\nline2\nline3\nline4\n";
    const out = truncate(md, 14); // 6 + 6 = 12 < 14, but 12 + 6 > 14
    expect(out).toBe("line1\nline2\n…(truncated)");
  });
});
