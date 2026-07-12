/**
 * Syntax-highlight a single diff line with highlight.js.
 *
 * Diff hunks already carry per-line content, so we highlight each line on its
 * own and return HTML with `hljs-*` token spans (NO wrapping `.hljs`, so the
 * app's existing global light/dark hljs palette colors the tokens while the base
 * text stays on our theme token). `highlight.js/lib/common` covers the languages
 * a coding agent produces without bundling every grammar.
 */
import hljs from "highlight.js/lib/common";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Highlighted HTML for one line, or escaped plain text on any failure. */
export function highlightLine(content: string, language?: string): string {
  if (content === "") return "";
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language, ignoreIllegals: true }).value;
    }
  } catch {
    // fall through to escaped plain text
  }
  return escapeHtml(content);
}
