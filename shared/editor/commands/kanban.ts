import { t } from "i18next";
import type { Node, Schema } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { v4 } from "uuid";

/** A document node and its current position. */
export interface KanbanLocation {
  node: Node;
  pos: number;
}

/**
 * Normalize tags without changing the spelling of the first occurrence.
 *
 * @param tags the tags to normalize.
 * @return trimmed, nonempty, case-insensitively unique tags.
 */
export function normalizeKanbanTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

/**
 * Create an empty board with the default workflow.
 *
 * @param schema the document schema.
 * @return a board with five columns.
 */
export function createKanbanBoard(schema: Schema): Node {
  return schema.nodes.container_kanban.create(
    { id: v4() },
    [
      t("Backlog") || "Backlog",
      t("To do") || "To do",
      t("In progress") || "In progress",
      t("Review") || "Review",
      t("Done") || "Done",
    ].map((title) => schema.nodes.kanban_column.create({ id: v4(), title }))
  );
}

/**
 * Find a current node by identity, including after collaborative edits.
 *
 * @param doc the current document.
 * @param id the node identity.
 * @param type the expected node type.
 * @return the node and position, if it still exists.
 */
export function findKanbanNode(
  doc: Node,
  id: string,
  type: string
): KanbanLocation | undefined {
  let result: KanbanLocation | undefined;
  doc.descendants((node, pos) => {
    if (node.type.name === type && node.attrs.id === id) {
      result = { node, pos };
      return false;
    }
    return !result;
  });
  return result;
}

/**
 * Move a card using current positions, preserving all its content and attributes.
 *
 * @param state the latest editor state.
 * @param cardId the card to move.
 * @param columnId the destination column.
 * @param beforeId the destination card, or undefined to append.
 * @return a transaction, or undefined for a stale or invalid destination.
 */
export function moveKanbanCard(
  state: EditorState,
  cardId: string,
  columnId: string,
  beforeId?: string
): Transaction | undefined {
  const card = findKanbanNode(state.doc, cardId, "kanban_card");
  const column = findKanbanNode(state.doc, columnId, "kanban_column");
  if (!card || !column || cardId === beforeId) {
    return undefined;
  }
  const sourceBoard = state.doc.resolve(card.pos).node(-1);
  const targetBoard = state.doc.resolve(column.pos).parent;
  if (sourceBoard !== targetBoard) {
    return undefined;
  }
  const before = beforeId
    ? findKanbanNode(state.doc, beforeId, "kanban_card")
    : undefined;
  if (
    beforeId &&
    (!before || state.doc.resolve(before.pos).parent !== column.node)
  ) {
    return undefined;
  }
  const destination = before?.pos ?? column.pos + column.node.nodeSize - 1;
  const tr = state.tr.delete(card.pos, card.pos + card.node.nodeSize);
  return tr.insert(tr.mapping.map(destination, -1), card.node);
}

/**
 * Move a column one position in its board.
 *
 * @param state the latest editor state.
 * @param columnId the column to reorder.
 * @param direction the offset, negative for left and positive for right.
 * @return a transaction if an adjacent column exists.
 */
export function moveKanbanColumn(
  state: EditorState,
  columnId: string,
  direction: -1 | 1
): Transaction | undefined {
  const column = findKanbanNode(state.doc, columnId, "kanban_column");
  if (!column) {
    return undefined;
  }
  const $pos = state.doc.resolve(column.pos);
  const index = $pos.index();
  const adjacent = $pos.parent.maybeChild(index + direction);
  if (!adjacent) {
    return undefined;
  }
  const target =
    direction < 0
      ? column.pos - adjacent.nodeSize
      : column.pos + column.node.nodeSize + adjacent.nodeSize;
  const tr = state.tr.delete(column.pos, column.pos + column.node.nodeSize);
  return tr.insert(tr.mapping.map(target, -1), column.node);
}

/**
 * Delete a column, requiring an explicit destination for any remaining cards.
 *
 * @param state the latest editor state.
 * @param columnId the column to delete.
 * @param destinationId the column that will receive remaining cards.
 * @return a transaction if deletion can preserve all cards and at least one column.
 */
export function deleteKanbanColumn(
  state: EditorState,
  columnId: string,
  destinationId?: string
): Transaction | undefined {
  const column = findKanbanNode(state.doc, columnId, "kanban_column");
  if (!column || state.doc.resolve(column.pos).parent.childCount <= 1) {
    return undefined;
  }
  const destination = destinationId
    ? findKanbanNode(state.doc, destinationId, "kanban_column")
    : undefined;
  if (
    column.node.childCount &&
    (!destination ||
      destinationId === columnId ||
      state.doc.resolve(column.pos).parent !==
        state.doc.resolve(destination.pos).parent)
  ) {
    return undefined;
  }
  const tr = state.tr.delete(column.pos, column.pos + column.node.nodeSize);
  if (column.node.childCount && destination) {
    tr.insert(
      tr.mapping.map(destination.pos + destination.node.nodeSize - 1, -1),
      column.node.content
    );
  }
  return tr;
}
