import type { EditorView } from "prosemirror-view";
import { moveKanbanCard } from "@shared/editor/commands/kanban";

/**
 * Animate existing cards into their new positions after a document move.
 *
 * @param view the editor view.
 * @param move the document mutation.
 * @return nothing.
 */
export function animateKanbanPlacement(
  view: EditorView,
  move: () => void
): void {
  const positions = new Map<string, DOMRect>();
  view.dom
    .querySelectorAll<HTMLElement>("[data-kanban-card]")
    .forEach((card) => {
      if (card.dataset.id) {
        positions.set(card.dataset.id, card.getBoundingClientRect());
      }
    });
  move();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      view.dom
        .querySelectorAll<HTMLElement>("[data-kanban-card]")
        .forEach((card) => {
          const previous = card.dataset.id
            ? positions.get(card.dataset.id)
            : undefined;
          if (!previous) {
            return;
          }
          const next = card.getBoundingClientRect();
          if (previous.x === next.x && previous.y === next.y) {
            return;
          }
          card.animate?.(
            [
              {
                transform: `translate(${previous.x - next.x}px, ${previous.y - next.y}px)`,
              },
              { transform: "translate(0, 0)" },
            ],
            { duration: 180, easing: "ease-out" }
          );
        });
    })
  );
}

/**
 * Drag a complete card with mouse, touch, or pen, resolving positions at drop.
 *
 * @param event the initiating pointer event.
 * @param view the editor view.
 * @param handle the drag handle.
 * @return cleanup for cancellation or unmount.
 */
export function startKanbanDrag(
  event: PointerEvent,
  view: EditorView,
  handle: HTMLElement
): () => void {
  const source = handle.closest<HTMLElement>("[data-kanban-card]");
  const board = handle.closest<HTMLElement>("[data-kanban]");
  const scroll = board?.querySelector<HTMLElement>(".kanban-scroll");
  if (!source || !board || !scroll || !source.dataset.id) {
    return () => undefined;
  }
  const cardId = source.dataset.id;
  const rect = source.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  let pointerX = event.clientX;
  let pointerY = event.clientY;
  let active = false;
  let finished = false;
  let frame = 0;
  let preview: HTMLElement | undefined;
  let indicator: HTMLElement | undefined;
  let destination: { columnId: string; beforeId?: string } | undefined;

  const update = () => {
    if (!active || !preview || !source.isConnected || !view.editable) {
      cleanup();
      return;
    }
    preview.style.transform = `translate(${pointerX - offsetX}px, ${pointerY - offsetY}px)`;
    const bounds = scroll.getBoundingClientRect();
    if (pointerY < 48 || pointerY > window.innerHeight - 48) {
      const distance = pointerY < 48 ? -14 : 14;
      let ancestor: HTMLElement | null = board.parentElement;
      while (
        ancestor &&
        !(
          ancestor.scrollHeight > ancestor.clientHeight &&
          /auto|scroll/.test(getComputedStyle(ancestor).overflowY)
        )
      ) {
        ancestor = ancestor.parentElement;
      }
      if (ancestor) {
        ancestor.scrollTop += distance;
      } else {
        window.scrollBy(0, distance);
      }
    }
    if (
      pointerY >= bounds.top &&
      pointerY <= bounds.bottom &&
      pointerX >= bounds.left &&
      pointerX <= bounds.right
    ) {
      const edge = 48;
      scroll.scrollLeft +=
        pointerX < bounds.left + edge
          ? -14
          : pointerX > bounds.right - edge
            ? 14
            : 0;
    }
    const target = document.elementFromPoint(pointerX, pointerY);
    const column = target?.closest<HTMLElement>("[data-kanban-column]");
    destination = undefined;
    indicator?.remove();
    if (column && board.contains(column) && column.dataset.id) {
      const cards = Array.from(
        column.querySelectorAll<HTMLElement>("[data-kanban-card]")
      ).filter((card) => card !== source);
      const before = cards.find(
        (card) =>
          pointerY <
          card.getBoundingClientRect().top +
            card.getBoundingClientRect().height / 2
      );
      destination = {
        columnId: column.dataset.id,
        beforeId: before?.dataset.id,
      };
      const columnRect = column.getBoundingClientRect();
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.className = "kanban-insertion";
        indicator.setAttribute("aria-hidden", "true");
        indicator.style.cssText =
          "position:fixed;height:3px;border-radius:3px;pointer-events:none;z-index:10001;background:currentColor";
        indicator.style.color =
          getComputedStyle(board).getPropertyValue("--kanban-accent");
      }
      indicator.style.left = `${columnRect.left + 10}px`;
      indicator.style.width = `${columnRect.width - 20}px`;
      const last = cards.at(-1);
      indicator.style.top = `${before ? before.getBoundingClientRect().top - 6 : last ? last.getBoundingClientRect().bottom + 6 : (column.querySelector("header")?.getBoundingClientRect().bottom ?? columnRect.top + 50)}px`;
      document.body.append(indicator);
    }
    frame = requestAnimationFrame(update);
  };
  const begin = () => {
    active = true;
    const clone = source.cloneNode(true);
    preview = clone instanceof HTMLElement ? clone : undefined;
    if (!(preview instanceof HTMLElement)) {
      cleanup();
      return;
    }
    copyStyles(source, preview);
    preview
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea"
      )
      .forEach((input) => {
        const text = document.createElement("strong");
        text.textContent = input.value;
        text.style.cssText = input.style.cssText;
        input.replaceWith(text);
      });
    preview
      .querySelectorAll("button, [role='menu'], select")
      .forEach((control) => control.remove());
    preview.removeAttribute("data-kanban-card");
    preview.classList.add("kanban-preview");
    preview.setAttribute("aria-hidden", "true");
    preview.style.cssText += `;position:fixed;top:0;left:0;margin:0;width:${rect.width}px;max-height:none;pointer-events:none;z-index:10000;box-shadow:0 12px 36px #0003;opacity:0.95;`;
    document.body.append(preview);
    source.style.opacity = "0.35";
    update();
  };
  const handleMove = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) {
      return;
    }
    pointerX = next.clientX;
    pointerY = next.clientY;
    if (
      !active &&
      Math.hypot(pointerX - event.clientX, pointerY - event.clientY) > 5
    ) {
      begin();
    }
    if (active) {
      next.preventDefault();
    }
  };
  const handleDrop = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) {
      return;
    }
    if (active) {
      pointerX = next.clientX;
      pointerY = next.clientY;
      cancelAnimationFrame(frame);
      update();
    }
    if (active && destination && view.editable) {
      const tr = moveKanbanCard(
        view.state,
        cardId,
        destination.columnId,
        destination.beforeId
      );
      cleanup();
      if (tr) {
        animateKanbanPlacement(view, () => view.dispatch(tr));
      }
      return;
    }
    cleanup();
  };
  const handleCancel = () => cleanup();
  const handleKey = (key: globalThis.KeyboardEvent) => {
    if (key.key === "Escape") {
      key.preventDefault();
      cleanup();
    }
  };
  const handleLeave = (leave: globalThis.PointerEvent) => {
    if (!leave.relatedTarget) {
      cleanup();
    }
  };
  const handleVisibility = () => {
    if (document.hidden) {
      cleanup();
    }
  };
  function cleanup() {
    if (finished) {
      return;
    }
    finished = true;
    cancelAnimationFrame(frame);
    preview?.remove();
    indicator?.remove();
    source?.style.removeProperty("opacity");
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleDrop);
    window.removeEventListener("pointercancel", handleCancel);
    window.removeEventListener("keydown", handleKey, true);
    window.removeEventListener("blur", handleCancel);
    document.removeEventListener("pointerout", handleLeave);
    document.removeEventListener("visibilitychange", handleVisibility);
    handle.removeEventListener("lostpointercapture", handleCancel);
    if (handle.hasPointerCapture?.(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  }
  handle.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", handleMove, { passive: false });
  window.addEventListener("pointerup", handleDrop);
  window.addEventListener("pointercancel", handleCancel);
  window.addEventListener("keydown", handleKey, true);
  window.addEventListener("blur", handleCancel);
  document.addEventListener("pointerout", handleLeave);
  document.addEventListener("visibilitychange", handleVisibility);
  handle.addEventListener("lostpointercapture", handleCancel);
  return cleanup;
}

function copyStyles(source: HTMLElement, target: HTMLElement) {
  const style = getComputedStyle(source);
  for (const property of [
    "display",
    "font",
    "line-height",
    "color",
    "background",
    "border",
    "border-radius",
    "padding",
    "margin",
    "gap",
    "flex",
    "flex-wrap",
    "align-items",
    "white-space",
    "overflow-wrap",
    "text-decoration",
    "box-sizing",
  ]) {
    target.style.setProperty(property, style.getPropertyValue(property));
  }
  Array.from(source.children).forEach((child, index) => {
    const copy = target.children[index];
    if (child instanceof HTMLElement && copy instanceof HTMLElement) {
      copyStyles(child, copy);
    }
  });
}
