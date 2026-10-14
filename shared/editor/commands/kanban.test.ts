import { Node, DOMSerializer, DOMParser } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import * as Y from "yjs";
import {
  prosemirrorToYDoc,
  yDocToProsemirrorJSON,
  ySyncPlugin,
} from "y-prosemirror";
import { EditorView } from "prosemirror-view";
import {
  schema,
  parser,
  serializer,
  createEditorState,
} from "../../test/editor";
import { ProsemirrorHelper } from "../../utils/ProsemirrorHelper";
import textBetween from "../lib/textBetween";
import { KanbanCardNode, Kanban } from "../nodes/Kanban";
import {
  createKanbanBoard,
  findKanbanNode,
  moveKanbanCard,
  moveKanbanColumn,
  deleteKanbanColumn,
  normalizeKanbanTags,
} from "./kanban";

function fixture() {
  const paragraph = schema.nodes.paragraph.create(
    null,
    schema.text("Existing rich body", [schema.marks.strong.create()])
  );
  const card = schema.nodes.kanban_card.create(
    { id: "card-a", title: "Independent title", tags: ["Design", "Urgent"] },
    paragraph
  );
  const second = schema.nodes.kanban_card.create(
    { id: "card-b", title: "Second" },
    schema.nodes.paragraph.create(null, schema.text("Other body"))
  );
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("Reading width")),
    schema.nodes.container_kanban.create({ id: "board" }, [
      schema.nodes.kanban_column.create({ id: "left", title: "Backlog" }, [
        card,
        second,
      ]),
      schema.nodes.kanban_column.create({ id: "right", title: "Done" }),
    ]),
  ]);
}

it("creates the five default columns", () => {
  const board = createKanbanBoard(schema);
  expect(
    Array.from(
      { length: board.childCount },
      (_, index) => board.child(index).attrs.title
    )
  ).toEqual(["Backlog", "To do", "In progress", "Review", "Done"]);
});

it("trims tags and prevents case-insensitive duplicates", () => {
  expect(
    normalizeKanbanTags([" Design ", "design", "", "Urgent", " urgent ", "New"])
  ).toEqual(["Design", "Urgent", "New"]);
});

it("moves and reorders complete cards with undoable document steps", () => {
  let state = createEditorState(fixture());
  const original = findKanbanNode(state.doc, "card-a", "kanban_card")?.node;
  const reorder = moveKanbanCard(state, "card-b", "left", "card-a");
  expect(reorder).toBeDefined();
  if (reorder) {
    state = state.apply(reorder);
  }
  expect(
    findKanbanNode(state.doc, "left", "kanban_column")?.node.firstChild?.attrs
      .id
  ).toBe("card-b");
  const move = moveKanbanCard(state, "card-a", "right");
  expect(move).toBeDefined();
  if (move) {
    state = state.apply(move);
  }
  expect(
    findKanbanNode(state.doc, "right", "kanban_column")?.node.firstChild?.eq(
      original ?? schema.nodes.paragraph.create()
    )
  ).toBe(true);
  expect(
    findKanbanNode(state.doc, "left", "kanban_column")?.node.childCount
  ).toBe(1);
});

it("rejects stale, cross-board, and invalid insertion targets", () => {
  const doc = fixture();
  const extra = createKanbanBoard(schema);
  const state = createEditorState(
    schema.nodes.doc.create(null, [
      ...Array.from({ length: doc.childCount }, (_, i) => doc.child(i)),
      extra,
    ])
  );
  expect(moveKanbanCard(state, "missing", "left")).toBeUndefined();
  expect(moveKanbanCard(state, "card-a", "left", "card-a")).toBeUndefined();
  expect(moveKanbanCard(state, "card-a", "right", "card-b")).toBeUndefined();
  expect(
    moveKanbanCard(state, "card-a", extra.firstChild?.attrs.id)
  ).toBeUndefined();
});

it("reorders columns and requires a destination to delete nonempty columns", () => {
  const state = createEditorState(fixture());
  expect(deleteKanbanColumn(state, "left")).toBeUndefined();
  expect(deleteKanbanColumn(state, "left", "left")).toBeUndefined();
  const reorder = moveKanbanColumn(state, "right", -1);
  expect(reorder?.doc.child(1).firstChild?.attrs.id).toBe("right");
  const remove = deleteKanbanColumn(state, "left", "right");
  expect(remove?.doc.child(1).childCount).toBe(1);
  expect(
    findKanbanNode(remove?.doc ?? state.doc, "right", "kanban_column")?.node
      .childCount
  ).toBe(2);
  if (remove) {
    expect(deleteKanbanColumn(state.apply(remove), "right")).toBeUndefined();
  }
});

it("round-trips JSON and Markdown including titles, tags, empty columns and rich text", () => {
  const doc = fixture();
  expect(
    Node.fromJSON(schema, JSON.parse(JSON.stringify(doc.toJSON()))).eq(doc)
  ).toBe(true);
  const markdown = serializer.serialize(doc);
  const restored = parser.parse(markdown);
  expect(restored.toJSON()).toEqual(doc.toJSON());
  expect(
    parser.parse(serializer.serialize(doc, { commonMark: true })).toJSON()
  ).toEqual(doc.toJSON());
});

it("preserves legacy card bodies when title and tags are absent", () => {
  const restored = Node.fromJSON(schema, {
    type: "kanban_card",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Keep this content", marks: [{ type: "em" }] },
        ],
      },
    ],
  });
  expect(restored.attrs.title).toBe("");
  expect(restored.attrs.tags).toEqual([]);
  expect(restored.textContent).toBe("Keep this content");
  expect(restored.firstChild?.firstChild?.marks[0].type.name).toBe("em");
});

it("keeps select-all and boundary deletion in a card body", () => {
  let state = createEditorState(fixture());
  const card = findKanbanNode(state.doc, "card-a", "kanban_card");
  if (!card) {
    throw new Error("Missing fixture");
  }
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, card.pos + 2))
  );
  const keys = new KanbanCardNode().keys();
  expect(keys.Backspace(state)).toBe(true);
  keys["Mod-a"](state, (tr) => {
    state = state.apply(tr);
  });
  const cleared = state.apply(state.tr.deleteSelection());
  expect(
    findKanbanNode(cleared.doc, "card-a", "kanban_card")?.node.attrs.title
  ).toBe("Independent title");
  expect(
    findKanbanNode(cleared.doc, "card-b", "kanban_card")?.node.textContent
  ).toBe("Other body");
});

it("repairs missing or duplicated identities without altering bodies", () => {
  const doc = fixture();
  const state = createEditorState(
    schema.nodes.doc.create(null, [doc.child(1), doc.child(1)]),
    new Kanban().plugins
  );
  const repaired = state.applyTransaction(state.tr.insertText("x", 4)).state;
  const ids: string[] = [];
  repaired.doc.descendants((node) => {
    if (node.attrs.id) {
      ids.push(node.attrs.id);
    }
  });
  expect(new Set(ids).size).toBe(ids.length);
  expect(repaired.doc.textContent).toContain("Existing rich body");
});

it.runIf(typeof document !== "undefined")(
  "synchronizes attribute edits and moves via the existing Y.js binding",
  async () => {
    if (typeof document === "undefined") {
      return;
    }
    const first = prosemirrorToYDoc(fixture());
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    first.on("update", (update: Uint8Array) => Y.applyUpdate(second, update));
    second.on("update", (update: Uint8Array) => Y.applyUpdate(first, update));
    const element = document.createElement("div");
    document.body.append(element);
    const view = new EditorView(element, {
      state: createEditorState(fixture(), [
        ySyncPlugin(first.getXmlFragment("prosemirror")),
      ]),
    });
    const remoteElement = document.createElement("div");
    document.body.append(remoteElement);
    const remoteView = new EditorView(remoteElement, {
      state: createEditorState(
        Node.fromJSON(schema, yDocToProsemirrorJSON(second)),
        [ySyncPlugin(second.getXmlFragment("prosemirror"))]
      ),
    });
    const remoteCard = findKanbanNode(
      remoteView.state.doc,
      "card-b",
      "kanban_card"
    );
    if (!remoteCard) {
      throw new Error("Missing remote card");
    }
    remoteView.dispatch(
      remoteView.state.tr.insertText("Collaborative ", remoteCard.pos + 2)
    );
    expect(
      findKanbanNode(view.state.doc, "card-b", "kanban_card")?.node.textContent
    ).toBe("Collaborative Other body");
    const card = findKanbanNode(view.state.doc, "card-a", "kanban_card");
    if (!card) {
      throw new Error("Missing fixture");
    }
    view.dispatch(
      view.state.tr
        .setNodeAttribute(card.pos, "title", "Synced title")
        .setNodeAttribute(card.pos, "tags", ["Synced"])
    );
    const move = moveKanbanCard(view.state, "card-a", "right");
    if (move) {
      view.dispatch(move);
    }
    expect(
      Node.fromJSON(schema, yDocToProsemirrorJSON(second)).toJSON()
    ).toEqual(view.state.doc.toJSON());
    expect(remoteView.state.doc.toJSON()).toEqual(view.state.doc.toJSON());
    const saved = Y.encodeStateAsUpdate(second);
    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, saved);
    expect(
      Node.fromJSON(schema, yDocToProsemirrorJSON(reloaded)).toJSON()
    ).toEqual(view.state.doc.toJSON());
    view.destroy();
    remoteView.destroy();
    element.remove();
    remoteElement.remove();
    first.destroy();
    second.destroy();
    reloaded.destroy();
  }
);

it.runIf(typeof document !== "undefined")(
  "round-trips static HTML without exposing edit controls",
  () => {
    if (typeof document === "undefined") {
      return;
    }
    const element = document.createElement("div");
    element.append(
      DOMSerializer.fromSchema(schema).serializeFragment(fixture().content)
    );
    expect(element.querySelectorAll("input, button")).toHaveLength(0);
    expect(element.querySelector(".kanban-title")?.textContent).toBe(
      "Independent title"
    );
    expect(DOMParser.fromSchema(schema).parse(element).toJSON()).toEqual(
      fixture().toJSON()
    );
  }
);

it("round-trips delimiter text and multiline metadata without confusing card fields", () => {
  const source = fixture();
  const card = findKanbanNode(source, "card-a", "kanban_card");
  if (!card) {
    throw new Error("Missing fixture");
  }
  let state = createEditorState(source);
  state = state.apply(
    state.tr
      .setNodeAttribute(card.pos, "title", 'Title with "quotes"\nnext line')
      .insert(
        card.pos + 1,
        schema.nodes.paragraph.create(null, schema.text("%%%%%%%%%%%"))
      )
  );
  expect(parser.parse(serializer.serialize(state.doc)).toJSON()).toEqual(
    state.doc.toJSON()
  );
});

it("includes metadata in full-document text but preserves body-only copying", () => {
  const doc = fixture();
  const card = findKanbanNode(doc, "card-a", "kanban_card");
  if (!card) {
    throw new Error("Missing fixture");
  }
  expect(textBetween(doc, 0, doc.content.size)).toContain("Independent title");
  expect(textBetween(doc, 0, doc.content.size)).toContain("Design, Urgent");
  expect(textBetween(doc, card.pos + 2, card.pos + 7)).toBe("Exist");
});

it("treats an empty board as content for autosave and preserves it when trimming", () => {
  const board = createKanbanBoard(schema);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(),
    board,
  ]);
  expect(ProsemirrorHelper.isEmpty(doc)).toBe(false);
  expect(ProsemirrorHelper.isEmpty(doc, schema)).toBe(false);
  expect(ProsemirrorHelper.trim(doc).firstChild?.type.name).toBe(
    "container_kanban"
  );
});
