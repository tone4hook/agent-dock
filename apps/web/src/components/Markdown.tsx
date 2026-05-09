import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown content as styled HTML using react-markdown +
 * remark-gfm (tables, strikethrough, autolinks, task lists). The
 * Tailwind `prose` classes come from `@tailwindcss/typography`,
 * already registered in `app.css` via `@plugin`.
 *
 * Used by JiraDetail and ConfluenceDetail to render `descriptionMd` /
 * `bodyMd` / comment bodies — replaces the plain `<pre>` blocks that
 * showed `#` and `*` characters literally.
 */
export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        // Override the default <a> color so it picks up the theme's
        // primary color rather than typography's blue.
        "prose-a:text-primary prose-a:underline-offset-2",
        // Constrain code blocks to the available width and let them
        // scroll horizontally instead of overflowing the card.
        "prose-pre:overflow-auto",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
