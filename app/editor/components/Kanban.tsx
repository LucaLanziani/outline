import { useState, useCallback } from "react";
import type { ChangeEvent, KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { v4 } from "uuid";
import { TextSelection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import styled from "styled-components";
import { MoreIcon, PlusIcon, TrashIcon } from "outline-icons";
import { ArrowLeftIcon, ArrowRightIcon } from "~/components/Icons/ArrowIcon";
import type { ComponentProps } from "@shared/editor/types";
import {
  deleteKanbanColumn,
  moveKanbanColumn,
  moveKanbanCard,
  normalizeKanbanTags,
  findKanbanNode,
} from "@shared/editor/commands/kanban";
import Button, { Inner } from "~/components/Button";
import Input, {
  Outline,
  NativeInput,
  NativeTextarea,
} from "~/components/Input";
import Badge from "~/components/Badge";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuButton,
} from "~/components/primitives/Menu";

/**
 * Render the board and mount its ProseMirror column content.
 *
 * @param props the current node view.
 * @return the board.
 */
export function KanbanBoard({
  node,
  view,
  getPos,
  contentRef,
  isEditable,
}: ComponentProps) {
  const { t } = useTranslation();
  const handleAddColumn = () => {
    const pos = getPos();
    const board = pos === undefined ? undefined : view.state.doc.nodeAt(pos);
    if (!view.editable || pos === undefined || !board) {
      return;
    }
    view.dispatch(
      view.state.tr.insert(
        pos + board.nodeSize - 1,
        view.state.schema.nodes.kanban_column.create({
          id: v4(),
          title: t("New column"),
        })
      )
    );
  };
  return (
    <section
      className="kanban-board"
      data-kanban=""
      data-id={node.attrs.id}
      aria-label={t("Kanban board")}
    >
      <div
        className="kanban-scroll"
        tabIndex={0}
        role="region"
        aria-label={t("Board columns")}
      >
        <div className="kanban-columns" ref={contentRef} />
      </div>
      {isEditable && (
        <Controls contentEditable={false} onMouseDown={handleControlMouseDown}>
          <Button neutral onClick={handleAddColumn}>
            {t("Add column")}
          </Button>
        </Controls>
      )}
    </section>
  );
}

/**
 * Render a column with safe deletion and accessible reorder controls.
 *
 * @param props the current node view.
 * @return the column.
 */
export function KanbanColumn({
  node,
  view,
  getPos,
  contentRef,
  isEditable,
}: ComponentProps) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  const [destinationId, setDestinationId] = useState("");
  const current = () =>
    findKanbanNode(view.state.doc, node.attrs.id, "kanban_column");
  const pos = getPos();
  const board =
    pos === undefined ? undefined : view.state.doc.resolve(pos).parent;
  const columnIndex =
    pos === undefined ? 0 : view.state.doc.resolve(pos).index();
  const columns: { id: string; title: string }[] = [];
  board?.forEach((column) => {
    if (column.attrs.id !== node.attrs.id) {
      columns.push({ id: column.attrs.id, title: column.attrs.title });
    }
  });
  const dispatch = (tr: Transaction | undefined) => {
    if (tr && view.editable) {
      view.dispatch(tr);
    }
  };
  const handleRename = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const column = current();
    if (column && view.editable) {
      view.dispatch(
        view.state.tr.setNodeAttribute(column.pos, "title", event.target.value)
      );
    }
  };
  const handleAddCard = () => {
    const column = current();
    if (!column || !view.editable) {
      return;
    }
    const at = column.pos + column.node.nodeSize - 1;
    const card = view.state.schema.nodes.kanban_card.create(
      { id: v4() },
      view.state.schema.nodes.paragraph.create()
    );
    const tr = view.state.tr.insert(at, card);
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2))));
    view.focus();
  };
  const handleDelete = () => {
    const tr = deleteKanbanColumn(
      view.state,
      node.attrs.id,
      destinationId || undefined
    );
    if (tr) {
      dispatch(tr);
      setDeleting(false);
    }
  };
  const handleDeleteRequest = () => {
    setDeleting(true);
  };
  return (
    <section
      className="kanban-column"
      data-kanban-column=""
      data-id={node.attrs.id}
      aria-label={node.attrs.title}
    >
      <ColumnHeader
        contentEditable={false}
        onMouseDown={handleControlMouseDown}
      >
        <ColumnMeta>
          <CardCount aria-label={t("Card count")}>
            {node.childCount === 1
              ? t("{{count}} card", { count: node.childCount })
              : t("{{count}} cards", { count: node.childCount })}
          </CardCount>
          {isEditable && (
            <ColumnActions>
              <IconButton
                neutral
                aria-label={t("Move column left")}
                disabled={columnIndex === 0}
                onClick={() =>
                  dispatch(moveKanbanColumn(view.state, node.attrs.id, -1))
                }
              >
                <ArrowLeftIcon size={16} />
              </IconButton>
              <IconButton
                neutral
                aria-label={t("Move column right")}
                disabled={!board || columnIndex === board.childCount - 1}
                onClick={() =>
                  dispatch(moveKanbanColumn(view.state, node.attrs.id, 1))
                }
              >
                <ArrowRightIcon size={16} />
              </IconButton>
              <IconButton
                neutral
                $destructive
                aria-label={t("Delete column")}
                disabled={!columns.length}
                onClick={handleDeleteRequest}
              >
                <TrashIcon size={16} />
              </IconButton>
            </ColumnActions>
          )}
        </ColumnMeta>
        {isEditable ? (
          <TitleInput
            $column
            aria-label={t("Column name")}
            value={node.attrs.title}
            onChange={handleRename}
            margin={0}
          />
        ) : (
          <strong className="kanban-column-title">{node.attrs.title}</strong>
        )}
      </ColumnHeader>
      {isEditable && deleting && (
        <DeletePanel
          contentEditable={false}
          onMouseDown={handleControlMouseDown}
          role="group"
          aria-label={t("Delete column")}
        >
          <p>
            {node.childCount
              ? t(
                  "Move all cards to another column before deleting this column."
                )
              : t("Delete this empty column?")}
          </p>
          {!!node.childCount && (
            <select
              aria-label={t("Move remaining cards to")}
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
            >
              <option value="">{t("Choose a column")}</option>
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.title}
                </option>
              ))}
            </select>
          )}
          <Controls>
            <Button neutral onClick={() => setDeleting(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={
                !!node.childCount &&
                !columns.some((column) => column.id === destinationId)
              }
              onClick={handleDelete}
            >
              {t("Delete column")}
            </Button>
          </Controls>
        </DeletePanel>
      )}
      <div className="kanban-cards" ref={contentRef} />
      {isEditable && (
        <Controls contentEditable={false} onMouseDown={handleControlMouseDown}>
          <AddButton
            neutral
            fullwidth
            icon={<PlusIcon size={16} />}
            onClick={handleAddCard}
          >
            {t("Add card")}
          </AddButton>
        </Controls>
      )}
    </section>
  );
}

/**
 * Render independent title and tag inputs around the native rich-text body.
 *
 * @param props the current node view.
 * @return the card.
 */
export function KanbanCard({
  node,
  view,
  getPos,
  contentRef,
  isEditable,
}: ComponentProps) {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const update = useCallback(
    (field: "title" | "tags", value: string | string[]) => {
      const card = findKanbanNode(view.state.doc, node.attrs.id, "kanban_card");
      if (card && view.editable) {
        view.dispatch(view.state.tr.setNodeAttribute(card.pos, field, value));
      }
    },
    [view, node.attrs.id]
  );
  const handleTitle = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => update("title", event.target.value);
  const handleTagCommit = (value: string) => {
    const card = findKanbanNode(view.state.doc, node.attrs.id, "kanban_card");
    if (card) {
      update(
        "tags",
        normalizeKanbanTags([...card.node.attrs.tags, ...value.split(",")])
      );
    }
  };
  const handleTagInput = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const value = event.target.value;
    if (value.includes(",")) {
      const parts = value.split(",");
      setTagInput(parts.pop() ?? "");
      handleTagCommit(parts.join(","));
      return;
    }
    setTagInput(value);
  };
  const handleTagKey = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      handleTagCommit(tagInput);
      setTagInput("");
    }
  };
  const handleRemoveTag = (tag: string) => {
    const card = findKanbanNode(view.state.doc, node.attrs.id, "kanban_card");
    if (card) {
      update(
        "tags",
        normalizeKanbanTags(card.node.attrs.tags).filter((item) => item !== tag)
      );
    }
  };
  const handleBodySelection = () => {
    if (!view.editable) {
      return;
    }
    const selection = view.dom.ownerDocument.getSelection();
    const card = findKanbanNode(view.state.doc, node.attrs.id, "kanban_card");
    if (!selection?.anchorNode || !selection.focusNode || !card) {
      return;
    }
    const anchorElement =
      selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode.parentElement;
    if (
      !anchorElement ||
      anchorElement.closest<HTMLElement>("[data-kanban-card]")?.dataset.id !==
        node.attrs.id ||
      !anchorElement.closest(".kanban-body")
    ) {
      return;
    }
    const start = card.pos + 1;
    const end = card.pos + card.node.nodeSize - 1;
    const anchor = Math.max(
      start,
      Math.min(end, view.posAtDOM(selection.anchorNode, selection.anchorOffset))
    );
    const head = Math.max(
      start,
      Math.min(
        end,
        view.dom.contains(selection.focusNode)
          ? view.posAtDOM(selection.focusNode, selection.focusOffset)
          : selection.anchorNode.compareDocumentPosition(selection.focusNode) &
              globalThis.Node.DOCUMENT_POSITION_PRECEDING
            ? start
            : end
      )
    );
    if (
      view.state.selection.anchor !== anchor ||
      view.state.selection.head !== head
    ) {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.between(
            view.state.doc.resolve(anchor),
            view.state.doc.resolve(head)
          )
        )
      );
    }
  };
  const handleDelete = () => {
    const card = findKanbanNode(view.state.doc, node.attrs.id, "kanban_card");
    if (card && view.editable) {
      view.dispatch(
        view.state.tr.delete(card.pos, card.pos + card.node.nodeSize)
      );
    }
  };
  const pos = getPos();
  const $pos = pos === undefined ? undefined : view.state.doc.resolve(pos);
  const column = $pos?.parent;
  const board = $pos?.node(-1);
  const index = $pos?.index() ?? 0;
  const columns: { id: string; title: string }[] = [];
  board?.forEach((item) =>
    columns.push({ id: item.attrs.id, title: item.attrs.title })
  );
  const handleMove = (columnId: string, beforeId?: string) => {
    const tr = moveKanbanCard(view.state, node.attrs.id, columnId, beforeId);
    if (tr && view.editable) {
      view.dispatch(tr);
    }
  };
  const tags = normalizeKanbanTags(node.attrs.tags);
  return (
    <article
      className="kanban-card"
      data-kanban-card=""
      data-id={node.attrs.id}
    >
      <CardHeader contentEditable={false} onMouseDown={handleControlMouseDown}>
        {isEditable && (
          <CardActions>
            <Menu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
              <MenuTrigger>
                <IconButton neutral aria-label={t("Card actions")}>
                  <MoreIcon size={16} />
                </IconButton>
              </MenuTrigger>
              <MenuContent
                onCloseAutoFocus={(event) => {
                  if (editingTags) {
                    event.preventDefault();
                  }
                }}
              >
                <MenuButton
                  label={t("Move card up")}
                  disabled={index === 0}
                  onClick={() =>
                    handleMove(
                      column?.attrs.id,
                      column?.maybeChild(index - 1)?.attrs.id
                    )
                  }
                />
                <MenuButton
                  label={t("Move card down")}
                  disabled={!column || index === column.childCount - 1}
                  onClick={() =>
                    handleMove(
                      column?.attrs.id,
                      column?.maybeChild(index + 2)?.attrs.id
                    )
                  }
                />
                {columns
                  .filter((item) => item.id !== column?.attrs.id)
                  .map((item) => (
                    <MenuButton
                      key={item.id}
                      label={t("Move to {{column}}", { column: item.title })}
                      onClick={() => handleMove(item.id)}
                    />
                  ))}
                <MenuButton
                  label={t("Edit tags")}
                  onClick={() => setEditingTags(true)}
                />
                <MenuButton
                  label={t("Delete card")}
                  dangerous
                  onClick={handleDelete}
                />
              </MenuContent>
            </Menu>
          </CardActions>
        )}
        {isEditable ? (
          <TitleInput
            type="textarea"
            autoSize
            rows={1}
            aria-label={t("Card title")}
            placeholder={t("Untitled card")}
            value={node.attrs.title}
            onChange={handleTitle}
            margin={0}
          />
        ) : (
          <strong className="kanban-title">
            {node.attrs.title || t("Untitled card")}
          </strong>
        )}
      </CardHeader>
      <div
        className="kanban-body"
        onMouseUp={handleBodySelection}
        onKeyDownCapture={handleBodySelection}
        aria-label={t("Card body")}
        ref={contentRef}
      />
      <Tags contentEditable={false} onMouseDown={handleControlMouseDown}>
        {tags.map((tag) => (
          <Badge primary key={tag}>
            {tag}
            {isEditable && (
              <RemoveTag
                type="button"
                aria-label={t("Remove tag {{tag}}", { tag })}
                onClick={() => handleRemoveTag(tag)}
              >
                ×
              </RemoveTag>
            )}
          </Badge>
        ))}
      </Tags>
      {isEditable && editingTags && (
        <Controls contentEditable={false} onMouseDown={handleControlMouseDown}>
          <TagInput
            autoFocus
            aria-label={t("Add tags")}
            placeholder={t("Add tags with Enter or comma")}
            value={tagInput}
            onChange={handleTagInput}
            onKeyDown={handleTagKey}
            onBlur={() => {
              handleTagCommit(tagInput);
              setTagInput("");
              setEditingTags(false);
            }}
            margin={0}
          />
        </Controls>
      )}
    </article>
  );
}

function handleControlMouseDown(event: MouseEvent) {
  event.stopPropagation();
}

const Controls = styled.div`
  display: flex;
  gap: 8px;
  padding: 8px 0;
  flex-wrap: wrap;
`;
const ColumnHeader = styled.header`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
`;
const ColumnMeta = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
`;
const CardCount = styled.span`
  color: ${({ theme }) => theme.textSecondary};
  font-size: 12px;
`;
const ColumnActions = styled.div`
  display: flex;
  gap: 2px;
`;
const IconButton = styled(Button)<{ $destructive?: boolean }>`
  background: transparent;
  box-shadow: none;
  border-radius: 4px;
  color: ${({ theme, $destructive }) => ($destructive ? theme.danger : theme.accent)};
  height: 24px;
  min-width: 24px;
  ${Inner} {
    padding: 0;
    justify-content: center;
  }
  &:hover:not(:disabled),
  &[aria-expanded="true"] {
    background: ${({ theme }) => theme.backgroundSecondary};
    box-shadow: none;
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.accent};
    outline-offset: 2px;
  }
  &:disabled {
    color: ${({ theme }) => theme.textTertiary};
    background: ${({ theme }) => theme.backgroundSecondary};
    opacity: 0.5;
  }
  @media (max-width: 600px) {
    height: 32px;
    min-width: 32px;
  }
`;
const AddButton = styled(Button)`
  color: ${({ theme }) => theme.accent};
  background: transparent;
  box-shadow: none;
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.background};
    box-shadow: none;
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.accent};
    outline-offset: 2px;
  }
`;
const TitleInput = styled(Input)<{ $column?: boolean }>`
  width: 100%;
  ${Outline} {
    background: transparent;
    border-color: transparent;
  }
  &:focus-within ${Outline} {
    border-color: ${({ theme }) => theme.inputBorderFocused};
    background: ${({ theme }) => theme.background};
  }
  ${NativeInput}, ${NativeTextarea} {
    padding: 0;
    font-family: inherit;
    font-size: ${({ $column }) => ($column ? "16px" : "14px")};
    font-weight: 600;
    line-height: 1.6;
    resize: none;
    height: auto;
  }
  @media (max-width: 600px) {
    ${NativeInput}, ${NativeTextarea} {
      font-size: 16px;
    }
  }
`;
const TagInput = styled(Input)`
  width: 100%;
  ${NativeInput} {
    font-size: 14px;
  }
  @media (max-width: 600px) {
    ${NativeInput} {
      font-size: 16px;
    }
  }
`;
const CardHeader = styled.header`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  min-width: 0;
`;
const CardActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
`;
const Tags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  > span {
    white-space: normal;
    overflow-wrap: anywhere;
    max-width: 100%;
  }
`;
const RemoveTag = styled.button`
  background: none;
  color: inherit;
  border: none;
  margin-left: 4px;
  cursor: pointer;
  min-width: 24px;
  min-height: 24px;
`;
const DeletePanel = styled.div`
  border: 1px solid ${({ theme }) => theme.inputBorder};
  padding: 8px;
  border-radius: 6px;
  select {
    width: 100%;
  }
`;
