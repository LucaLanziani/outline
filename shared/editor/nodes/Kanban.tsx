import type Token from "markdown-it/lib/token.mjs";
import { t } from "i18next";
import type { NodeSpec, Node as ProsemirrorNode } from "prosemirror-model";
import { NodeSelection, TextSelection, Plugin } from "prosemirror-state";
import type { Command, Transaction } from "prosemirror-state";
import type { CommandFactory } from "../lib/Extension";
import { v4 } from "uuid";
import {
  createKanbanBoard,
  findKanbanNode,
  normalizeKanbanTags,
} from "../commands/kanban";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import { kanbanRule } from "../rules/kanban";
import Node from "./Node";

/** A collaborative board stored within the document. */
export class Kanban extends Node {
  get name() {
    return "container_kanban";
  }
  get allowComponentInStaticHTML() {
    return false;
  }
  get schema(): NodeSpec {
    return {
      group: "block",
      content: "kanban_column+",
      isolating: true,
      attrs: { id: { default: null } },
      parseDOM: [
        {
          tag: "section[data-kanban]",
          contentElement: ".kanban-columns",
          getAttrs: (dom) => ({ id: dom.getAttribute("data-id") }),
        },
      ],
      toDOM: (node) => [
        "section",
        { "data-kanban": "", "data-id": node.attrs.id, class: "kanban-board" },
        ["div", { class: "kanban-columns" }, 0],
      ],
    };
  }
  get plugins() {
    const repair = (doc: ProsemirrorNode, tr: Transaction) => {
      const ids = new Set<string>();
      doc.descendants((node, pos) => {
        if (
          !["container_kanban", "kanban_column", "kanban_card"].includes(
            node.type.name
          )
        ) {
          return true;
        }
        if (!node.attrs.id || ids.has(node.attrs.id)) {
          tr.setNodeAttribute(pos, "id", v4());
        } else {
          ids.add(node.attrs.id);
        }
        return true;
      });
      return tr.steps.length ? tr : null;
    };
    return [
      new Plugin({
        appendTransaction: (transactions, oldState, state) => {
          if (!transactions.some((tr) => tr.docChanged)) {
            return null;
          }
          const tr = repair(state.doc, state.tr) ?? state.tr;
          const { $from } = oldState.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const previous = $from.node(depth);
            if (previous.type.name !== "kanban_card") {
              continue;
            }
            const card = findKanbanNode(
              tr.doc,
              previous.attrs.id,
              "kanban_card"
            );

            // A moved body selection would otherwise map into a different
            // card while the original card's details are being hidden.
            if (
              card?.node.attrs.collapsed === true &&
              previous.attrs.collapsed !== true
            ) {
              tr.setSelection(NodeSelection.create(tr.doc, card.pos));
            }
            break;
          }
          return tr.steps.length || tr.selectionSet ? tr : null;
        },
        view: (view) => {
          const timer = setTimeout(() => {
            if (!view.editable || view.isDestroyed) {
              return;
            }
            const tr = repair(view.state.doc, view.state.tr);
            if (tr) {
              view.dispatch(tr);
            }
          }, 0);
          return { destroy: () => clearTimeout(timer) };
        },
      }),
    ];
  }

  get rulePlugins() {
    return [kanbanRule];
  }

  /**
   * Insert a default board outside existing boards.
   *
   * @return the insertion command.
   */
  commands(): CommandFactory {
    return () => (state, dispatch) => {
      for (let depth = state.selection.$from.depth; depth > 0; depth--) {
        if (state.selection.$from.node(depth).type.name === this.name) {
          return false;
        }
      }
      dispatch?.(
        state.tr.replaceSelectionWith(createKanbanBoard(state.schema))
      );
      return true;
    };
  }

  /**
   * Serialize a board without losing field metadata.
   *
   * @param state the Markdown serializer.
   * @param node the board.
   * @return nothing.
   */
  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    writeContainer(state, node, "kanban", 7);
  }
  parseMarkdown() {
    return { block: this.name, getAttrs: readMetadata };
  }
  get markdownToken() {
    return "container_kanban";
  }
}

/** A named, ordered column containing cards. */
export class KanbanColumnNode extends Node {
  get name() {
    return "kanban_column";
  }
  get allowComponentInStaticHTML() {
    return false;
  }
  get schema(): NodeSpec {
    return {
      content: "kanban_card*",
      isolating: true,
      attrs: {
        id: { default: null },
        title: { default: "" },
        collapseCards: { default: false },
      },
      parseDOM: [
        {
          tag: "section[data-kanban-column]",
          contentElement: ".kanban-cards",
          getAttrs: (dom) => ({
            id: dom.getAttribute("data-id"),
            title: dom.getAttribute("data-title") ?? "",
            collapseCards: dom.getAttribute("data-collapse-cards") === "true",
          }),
        },
      ],
      toDOM: (node) => [
        "section",
        {
          "data-kanban-column": "",
          "data-id": node.attrs.id,
          "data-title": node.attrs.title,
          "data-collapse-cards": String(node.attrs.collapseCards === true),
          class: "kanban-column",
        },
        [
          "header",
          {},
          ["strong", {}, node.attrs.title],
          ["span", {}, ` (${node.childCount})`],
        ],
        ["div", { class: "kanban-cards" }, 0],
      ],
    };
  }

  /**
   * Serialize a column and its cards.
   *
   * @param state the Markdown serializer.
   * @param node the column.
   * @return nothing.
   */
  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    writeContainer(state, node, this.name, 5);
  }
  parseMarkdown() {
    return { block: this.name, getAttrs: readMetadata };
  }
  get markdownToken() {
    return "container_kanban_column";
  }
}

/** A card with an independent title, tags, and a native rich-text body. */
export class KanbanCardNode extends Node {
  get name() {
    return "kanban_card";
  }
  get allowComponentInStaticHTML() {
    return false;
  }
  get schema(): NodeSpec {
    return {
      content: "block+",
      isolating: true,
      defining: true,
      attrs: {
        id: { default: null },
        title: { default: "" },
        tags: { default: [] },
        collapsed: { default: false },
      },
      parseDOM: [
        {
          tag: "article[data-kanban-card]",
          contentElement: ".kanban-body",
          getAttrs: (dom) => ({
            id: dom.getAttribute("data-id"),
            title: dom.getAttribute("data-title") ?? "",
            tags: parseTags(dom.getAttribute("data-tags")),
            collapsed: dom.getAttribute("data-collapsed") === "true",
          }),
        },
      ],
      toDOM: (node) => [
        "article",
        {
          "data-kanban-card": "",
          "data-id": node.attrs.id,
          "data-title": node.attrs.title,
          "data-tags": JSON.stringify(node.attrs.tags),
          "data-collapsed": String(node.attrs.collapsed === true),
          class: "kanban-card",
        },
        [
          "details",
          { open: node.attrs.collapsed === true ? null : "" },
          [
            "summary",
            {},
            [
              "strong",
              { class: "kanban-title" },
              node.attrs.title || t("Untitled card"),
            ],
          ],
          ["div", { class: "kanban-body" }, 0],
          [
            "div",
            { class: "kanban-tags" },
            ...normalizeKanbanTags(node.attrs.tags).map((tag) => [
              "span",
              {},
              tag,
            ]),
          ],
        ],
      ],
    };
  }

  /**
   * Keep body select-all and boundary deletion inside this card.
   *
   * @return keyboard commands scoped to a card body.
   */
  keys(): Record<string, Command> {
    const boundary =
      (direction: -1 | 1): Command =>
      (state) => {
        if (!state.selection.empty) {
          return false;
        }
        const { $from } = state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type.name === this.name) {
            return direction < 0
              ? $from.pos === $from.start(depth) + 1
              : $from.pos === $from.end(depth) - 1;
          }
        }
        return false;
      };
    return {
      Backspace: boundary(-1),
      Delete: boundary(1),
      "Mod-a": (state, dispatch) => {
        const { $from } = state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type.name === this.name) {
            dispatch?.(
              state.tr.setSelection(
                TextSelection.between(
                  state.doc.resolve($from.start(depth)),
                  state.doc.resolve($from.end(depth))
                )
              )
            );
            return true;
          }
        }
        return false;
      },
    };
  }

  /**
   * Serialize title, tags, and rich content independently.
   *
   * @param state the Markdown serializer.
   * @param node the card.
   * @return nothing.
   */
  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    writeContainer(state, node, this.name, 3);
  }
  parseMarkdown() {
    return { block: this.name, getAttrs: readMetadata };
  }
  get markdownToken() {
    return "container_kanban_card";
  }
}

function writeContainer(
  state: MarkdownSerializerState,
  node: ProsemirrorNode,
  name: string,
  size: number
) {
  let longest = 0;
  for (const match of node.textContent.matchAll(/%+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  const fence = "%".repeat(size + longest);
  state.write(`${fence} ${name} ${JSON.stringify(node.attrs)}\n`);
  state.renderContent(node);
  state.ensureNewLine();
  state.write(fence);
  state.closeBlock(node);
}

function readMetadata(token: Token) {
  const start = token.info.indexOf("{");
  try {
    const metadata: {
      id?: string;
      title?: string;
      tags?: string[];
      collapseCards?: boolean;
      collapsed?: boolean;
    } = JSON.parse(token.info.slice(start));
    return {
      id: typeof metadata.id === "string" ? metadata.id : v4(),
      title: typeof metadata.title === "string" ? metadata.title : "",
      collapseCards: metadata.collapseCards === true,
      collapsed: metadata.collapsed === true,
      tags:
        Array.isArray(metadata.tags) &&
        metadata.tags.every((tag) => typeof tag === "string")
          ? normalizeKanbanTags(metadata.tags)
          : [],
    };
  } catch {
    return { id: v4() };
  }
}

function parseTags(value: string | null): string[] {
  try {
    const tags: string[] = JSON.parse(value ?? "[]");
    return Array.isArray(tags) && tags.every((tag) => typeof tag === "string")
      ? normalizeKanbanTags(tags)
      : [];
  } catch {
    return [];
  }
}
