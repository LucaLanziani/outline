import { css } from "styled-components";
import { mix } from "polished";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";

/** Document-native board layout shared by editable and static renderers. */
export const kanbanStyle = css`
  .kanban-board {
    --kanban-accent: ${({ theme }) => theme.accent};
    width: calc(
      var(--container-width, 100%) - ${EditorStyleHelper.padding * 2}px
    );
    margin-inline-start: calc(
      50% -
        (var(--container-width, 100%) - ${EditorStyleHelper.padding * 2}px) /
        2 + var(--full-width-transform-offset, 0px)
    );
    margin-block: 24px;
    border: 1px solid ${({ theme }) => theme.inputBorder};
    border-radius: 8px;
    padding: 8px;
    background: ${({ theme }) => theme.background};
    box-sizing: border-box;
  }
  .kanban-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 32px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .kanban-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.6;
  }
  .kanban-scroll {
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding: 2px 2px 12px;
    scrollbar-gutter: stable;
  }
  .kanban-columns > .component-content,
  section[data-kanban] > .kanban-columns {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(250px, 1fr);
    gap: 12px;
    align-items: stretch;
    min-width: 100%;
  }
  .component-kanban_column {
    display: flex;
  }
  .kanban-column {
    width: 100%;
    min-height: 220px;
    min-width: 0;
    border-radius: 4px;
    padding: 8px;
    background: ${({ theme }) => mix(0.4, theme.backgroundSecondary, theme.background)};
    box-sizing: border-box;
  }
  .kanban-cards > .component-content,
  section[data-kanban-column] > .kanban-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 8px;
  }
  .kanban-card {
    min-width: 0;
    padding: 8px;
    border: 1px solid ${({ theme }) => theme.inputBorder};
    border-radius: 4px;
    font-size: 14px;
    line-height: 1.6;
    background: ${({ theme }) => theme.background};
    overflow-wrap: anywhere;
    box-shadow: none;
    transition: opacity 120ms ease;
    box-sizing: border-box;
  }
  .kanban-body {
    margin-block: 4px 8px;
    p {
      margin-block: 0 6px;
      line-height: inherit;
    }
    min-height: 24px;
    overflow-wrap: anywhere;
    > .component-content > :first-child {
      margin-top: 0;
    }
    > .component-content > :last-child {
      margin-bottom: 0;
    }
    img,
    video {
      max-width: 100%;
    }
    pre {
      max-width: 100%;
      overflow-x: auto;
    }
    .kanban-board {
      width: 100%;
      margin-inline: 0;
    }
  }
  .kanban-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    > span {
      padding: 2px 6px;
      background: ${({ theme }) => theme.backgroundSecondary};
      border-radius: 8px;
      font-size: 12px;
    }
  }
  .kanban-column-title {
    font-size: 16px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .kanban-title {
    display: block;
    font-weight: 600;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  @media (max-width: 600px) {
    .kanban-board {
      width: 100%;
      margin-inline: 0;
    }
    .kanban-columns > .component-content {
      grid-auto-columns: minmax(250px, 1fr);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .kanban-card {
      transition: none;
    }
  }
  @media print {
    .kanban-board {
      width: 100%;
      margin-inline: 0;
    }
    .kanban-scroll {
      overflow: visible;
    }
    .kanban-columns > .component-content,
    section[data-kanban] > .kanban-columns {
      grid-auto-flow: row;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
`;
