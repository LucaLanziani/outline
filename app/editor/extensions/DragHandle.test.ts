import { EditorView } from "prosemirror-view";
import { createEditorState, doc, p, schema } from "@shared/test/editor";
import DragHandle from "./DragHandle";

let view: EditorView;

function rect(
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect {
  return new DOMRect(left, top, width, height);
}

function setupBoard(empty = false) {
  const board = schema.nodes.container_kanban.create({ id: "board" }, [
    schema.nodes.kanban_column.create(
      { id: "column", title: "Backlog" },
      empty
        ? []
        : [schema.nodes.kanban_card.create({ id: "card" }, p("Card body"))]
    ),
  ]);
  const wrapper = document.createElement("div");
  wrapper.className = "component-container_kanban";
  const frame = document.createElement("section");
  frame.className = "kanban-board";
  const header = document.createElement("header");
  const label = document.createElement("span");
  label.className = "kanban-label";
  label.textContent = "Kanban";
  header.appendChild(label);
  const contentDOM = document.createElement("div");
  frame.append(header, contentDOM);
  wrapper.appendChild(frame);
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  view = new EditorView(mount, {
    state: createEditorState(doc([board]), new DragHandle().plugins),
    nodeViews: {
      container_kanban: () => ({ dom: wrapper, contentDOM }),
    },
  });
  vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(
    rect(400, 0, 750, 900)
  );
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(
    rect(400, 90, 750, 800)
  );
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(
    rect(32, 114, 1536, 776)
  );
  vi.spyOn(label, "getBoundingClientRect").mockReturnValue(
    rect(42, 126, 80, 20)
  );
  vi.spyOn(view, "posAtCoords").mockReturnValue({
    pos: empty ? 1 : 4,
    inside: 0,
  });
  const textCoords = vi.spyOn(view, "coordsAtPos").mockReturnValue({
    left: 50,
    right: 50,
    top: 250,
    bottom: 270,
  });
  return { wrapper, frame, label, textCoords };
}

function hover(clientX = 500, clientY = 250) {
  view.dom.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX, clientY })
  );
  const handle = document.querySelector<HTMLElement>(".block-drag-handle");
  if (!handle) {
    throw new Error("Drag handle was not mounted");
  }
  expect(handle.classList.contains("visible")).toBe(true);
  return handle;
}

afterEach(() => {
  view?.destroy();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("aligns the board handle with its label and visible frame rather than a card body", () => {
  const { textCoords } = setupBoard();
  const handle = hover();
  expect(handle.style.top).toBe("122px");
  expect(handle.style.left).toBe("8px");
  expect(textCoords).not.toHaveBeenCalled();
});

it("aligns empty boards with the same header", () => {
  setupBoard(true);
  expect(hover().style.top).toBe("122px");
});

it("finds a wide board outside the reading column and keeps its gutter reachable", () => {
  setupBoard();
  const handle = hover(44, 136);
  expect(handle.style.top).toBe("122px");
  expect(hover(20, 136)).toBe(handle);
});

it("follows the board header when scrolling", () => {
  const { frame, label } = setupBoard();
  const handle = hover();
  vi.mocked(frame.getBoundingClientRect).mockReturnValue(
    rect(32, 14, 1536, 776)
  );
  vi.mocked(label.getBoundingClientRect).mockReturnValue(rect(42, 26, 80, 20));
  window.dispatchEvent(new Event("scroll"));
  expect(handle.style.top).toBe("22px");
  expect(handle.style.left).toBe("8px");
});

it("mirrors the gutter at the visible board edge for RTL", () => {
  const { wrapper } = setupBoard();
  wrapper.style.direction = "rtl";
  expect(hover().style.left).toBe("1568px");
});

it("keeps ordinary paragraph handles centered on their first line", () => {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  view = new EditorView(mount, {
    state: createEditorState(
      doc([p("Ordinary text")]),
      new DragHandle().plugins
    ),
  });
  vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(
    rect(400, 0, 750, 900)
  );
  vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: 1, inside: 0 });
  vi.spyOn(view, "coordsAtPos").mockReturnValue({
    left: 400,
    right: 400,
    top: 20,
    bottom: 40,
  });
  const paragraph = view.dom.querySelector("p");
  if (!paragraph) {
    throw new Error("Paragraph was not mounted");
  }
  vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(
    rect(400, 15, 750, 35)
  );
  const handle = hover();
  expect(handle.style.top).toBe("16px");
  expect(handle.style.left).toBe("376px");
});
