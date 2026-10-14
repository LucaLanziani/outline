// @vitest-isolate true
import { Node } from "prosemirror-model";
import { v4 } from "uuid";
import { EditorState } from "prosemirror-state";
import {
  createKanbanBoard,
  findKanbanNode,
  moveKanbanCard,
  moveKanbanColumn,
} from "@shared/editor/commands/kanban";
import EDITOR_VERSION from "@shared/editor/version";
import { parser, schema, serializer } from "@server/editor";
import { Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

it("persists, reloads, presents and exports all board fields through the document API", async () => {
  const user = await buildUser();
  const board = createKanbanBoard(schema);
  const cardId = v4();
  const firstColumn = board.child(0);
  const lastColumn = board.child(4);
  const card = schema.nodes.kanban_card.create(
    { id: cardId, title: "API card title", tags: ["Design", "Release"] },
    schema.nodes.paragraph.create(
      null,
      schema.text("Rich persisted body", [schema.marks.strong.create()])
    )
  );
  const columns = Array.from({ length: board.childCount }, (_, index) =>
    index === 0
      ? firstColumn.copy(schema.nodes.kanban_column.create(null, card).content)
      : board.child(index)
  );
  const original = schema.nodes.doc.create(
    null,
    board.copy(schema.nodes.container_kanban.create(null, columns).content)
  );
  const headers = { "x-api-version": "3", "x-editor-version": EDITOR_VERSION };
  const create = await server.post("/api/documents.create", user, {
    headers,
    body: {
      title: "Kanban persistence verification",
      text: serializer.serialize(original),
    },
  });
  expect(create.status).toBe(200);
  const created = await create.json();
  const stored = await Document.findByPk(created.data.id, {
    rejectOnEmpty: true,
  });
  expect(DocumentHelper.toProsemirror(stored).toJSON()).toEqual(
    original.toJSON()
  );
  let state = EditorState.create({ doc: DocumentHelper.toProsemirror(stored) });
  const move = moveKanbanCard(state, cardId, lastColumn.attrs.id);
  if (!move) {
    throw new Error("Missing card move");
  }
  state = state.apply(move);
  const reorder = moveKanbanColumn(state, lastColumn.attrs.id, -1);
  if (!reorder) {
    throw new Error("Missing column move");
  }
  state = state.apply(reorder);
  const location = findKanbanNode(state.doc, cardId, "kanban_card");
  if (!location) {
    throw new Error("Missing card");
  }
  state = state.apply(
    state.tr
      .setNodeAttribute(location.pos, "title", "Updated API title")
      .setNodeAttribute(location.pos, "tags", ["Testing"])
  );
  const update = await server.post("/api/documents.update", user, {
    headers,
    body: { id: stored.id, text: serializer.serialize(state.doc) },
  });
  expect(update.status).toBe(200);
  await stored.reload();
  expect(DocumentHelper.toProsemirror(stored).toJSON()).toEqual(
    state.doc.toJSON()
  );
  const info = await server.post("/api/documents.info", user, {
    headers,
    body: { id: stored.id },
  });
  expect(info.status).toBe(200);
  const presented = await info.json();
  expect(Node.fromJSON(schema, presented.data.document.data).toJSON()).toEqual(
    state.doc.toJSON()
  );
  const exported = await server.post("/api/documents.export", user, {
    body: { id: stored.id },
  });
  expect(exported.status).toBe(200);
  const markdown = await exported.json();
  const imported = parser.parse(markdown.data);
  expect(
    findKanbanNode(imported, cardId, "kanban_card")?.node.toJSON()
  ).toEqual(findKanbanNode(state.doc, cardId, "kanban_card")?.node.toJSON());
  const html = await DocumentHelper.toHTML(stored, { includeTitle: false });
  expect(html).toContain("Updated API title");
  expect(html).toContain("Rich persisted body");
  expect(html).toContain("Testing");
  expect(html).not.toContain("Add tags");
});
