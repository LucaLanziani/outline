import { DOMSerializer } from "prosemirror-model";
import { EditorView } from "prosemirror-view";
import { schema, createEditorState } from "@shared/test/editor";
import { findKanbanNode } from "@shared/editor/commands/kanban";
import { startKanbanDrag } from "./kanbanDrag";

let view: EditorView;
let handle: HTMLButtonElement;
let source: HTMLElement;
let target: HTMLElement;
let cleanup: (() => void) | undefined;

function pointer(type: string, x: number, y: number) {
  return Object.assign(
    new MouseEvent(type, {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
    {
      pointerId: 1,
      persistentDeviceId: 0,
      pointerType: "touch",
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: 0.5,
      tangentialPressure: 0,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      altitudeAngle: 0,
      azimuthAngle: 0,
      getCoalescedEvents: () => [],
      getPredictedEvents: () => [],
    }
  );
}

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  const card = schema.nodes.kanban_card.create(
    { id: "card", title: "Whole title", tags: ["Important"] },
    schema.nodes.paragraph.create(
      null,
      schema.text("Rich body", [schema.marks.strong.create()])
    )
  );
  const doc = schema.nodes.doc.create(
    null,
    schema.nodes.container_kanban.create({ id: "board" }, [
      schema.nodes.kanban_column.create({ id: "left", title: "Backlog" }, card),
      schema.nodes.kanban_column.create({ id: "right", title: "Done" }),
    ])
  );
  const element = document.createElement("div");
  document.body.append(element);
  view = new EditorView(element, {
    state: createEditorState(doc),
    nodeViews: {
      container_kanban: (node) => {
        const dom = document.createElement("section");
        dom.setAttribute("data-kanban", "");
        dom.dataset.id = node.attrs.id;
        const scroll = document.createElement("div");
        scroll.className = "kanban-scroll";
        const contentDOM = document.createElement("div");
        scroll.append(contentDOM);
        dom.append(scroll);
        return { dom, contentDOM };
      },
      kanban_card: (node) => {
        const result = DOMSerializer.renderSpec(
          document,
          schema.nodes.kanban_card.spec.toDOM?.(node) ?? ["article", 0]
        );
        handle = document.createElement("button");
        result.dom.insertBefore(handle, result.dom.firstChild);
        return { dom: result.dom, contentDOM: result.contentDOM };
      },
    },
  });
  const first = view.dom.querySelector<HTMLElement>("[data-kanban-card]");
  const right = view.dom.querySelector<HTMLElement>("[data-id='right']");
  if (!first || !right) {
    throw new Error("Missing fixture DOM");
  }
  source = first;
  target = right;
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => target),
  });
  cleanup = startKanbanDrag(pointer("pointerdown", 40, 40), view, handle);
});

afterEach(() => {
  cleanup?.();
  view.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("previews the complete title, rich body and tags while dimming the source", () => {
  source.id = "card-disclosure";
  const body = source.querySelector(".kanban-body");
  if (body) {
    body.id = "body-disclosure";
  }
  window.dispatchEvent(pointer("pointermove", 90, 90));
  const preview = document.querySelector(".kanban-preview");
  expect(preview?.getAttribute("id")).toBeNull();
  expect(preview?.querySelectorAll("[id]")).toHaveLength(0);
  expect(preview instanceof HTMLElement && preview.inert).toBe(true);
  expect(preview?.textContent).toContain("Whole title");
  expect(preview?.textContent).toContain("Rich body");
  expect(preview?.textContent).toContain("Important");
  expect(preview?.querySelector("strong")).not.toBeNull();
  expect(source.style.opacity).toBe("0.35");
  expect(document.querySelector(".kanban-insertion")).not.toBeNull();
});

it("moves one complete card and removes the preview and indicator on drop", () => {
  window.dispatchEvent(pointer("pointermove", 90, 90));
  window.dispatchEvent(pointer("pointerup", 90, 90));
  expect(
    findKanbanNode(view.state.doc, "right", "kanban_column")?.node.firstChild
      ?.attrs.id
  ).toBe("card");
  expect(
    document.querySelectorAll(".kanban-preview, .kanban-insertion")
  ).toHaveLength(0);
  expect(source.style.opacity).toBe("");
});

it.each(["escape", "pointercancel", "blur", "leave", "unmount"])(
  "cleans up %s without changing content",
  (kind) => {
    const original = view.state.doc;
    window.dispatchEvent(pointer("pointermove", 90, 90));
    if (kind === "escape") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    } else if (kind === "leave") {
      document.dispatchEvent(
        new MouseEvent("pointerout", { relatedTarget: null })
      );
    } else if (kind === "unmount") {
      cleanup?.();
    } else {
      window.dispatchEvent(new Event(kind));
    }
    expect(view.state.doc.eq(original)).toBe(true);
    expect(source.style.opacity).toBe("");
    expect(
      document.querySelectorAll(".kanban-preview, .kanban-insertion")
    ).toHaveLength(0);
  }
);

it("leaves a simple tap unchanged and allows another drag after cancellation", () => {
  window.dispatchEvent(pointer("pointerup", 40, 40));
  expect(document.querySelector(".kanban-preview")).toBeNull();
  cleanup = startKanbanDrag(pointer("pointerdown", 40, 40), view, handle);
  window.dispatchEvent(pointer("pointermove", 90, 90));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  cleanup = startKanbanDrag(pointer("pointerdown", 40, 40), view, handle);
  window.dispatchEvent(pointer("pointermove", 90, 90));
  window.dispatchEvent(pointer("pointerup", 90, 90));
  expect(
    findKanbanNode(view.state.doc, "right", "kanban_column")?.node.childCount
  ).toBe(1);
});

it("rejects a destination outside this board", () => {
  const other = document.createElement("section");
  other.setAttribute("data-kanban-column", "");
  other.dataset.id = "right";
  document.body.append(other);
  target = other;
  window.dispatchEvent(pointer("pointermove", 90, 90));
  window.dispatchEvent(pointer("pointerup", 90, 90));
  expect(
    findKanbanNode(view.state.doc, "left", "kanban_column")?.node.childCount
  ).toBe(1);
});

it("keeps a collapsed drag preview compact without removing its stored body", () => {
  source.querySelector("details")?.removeAttribute("open");
  window.dispatchEvent(pointer("pointermove", 90, 90));
  expect(
    document.querySelector(".kanban-preview details")?.hasAttribute("open")
  ).toBe(false);
  expect(
    document.querySelector(".kanban-preview .kanban-body")?.textContent
  ).toContain("Rich body");
});
