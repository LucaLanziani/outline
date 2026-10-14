import type MarkdownIt from "markdown-it";
import customFence from "markdown-it-container";

/**
 * Register document-native Kanban containers in Markdown imports.
 *
 * @param md the Markdown parser.
 * @return nothing.
 */
export function kanbanRule(md: MarkdownIt): void {
  for (const name of ["kanban", "kanban_column", "kanban_card"]) {
    customFence(md, name, {
      marker: "%",
      validate: (info: string) => info.trim().split(" ")[0] === name,
    });
  }
}
