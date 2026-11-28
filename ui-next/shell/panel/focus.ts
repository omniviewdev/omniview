import { paneToward, type PaneStep, type PanelStore, type SessionId, type ShowOptions } from '../core/panel';

// Where the focus goes when the panel opens and closes (ch16 S105, S116; the mock's `focusPanel` and `focusPage`). The regions say where their focus goes (`data-shell-region`,
// `data-shell-focus`, as ../useRegionKeys.ts reads them): opening the panel puts the focus on its tool on screen, and closing it from inside returns the focus to the page, so an action
// never leaves the focus on <body>.

const PANEL = '[data-shell-region="panel"]';
const HANDLE = '[data-shell-part="panelHandle"]';

const target = (region: string): HTMLElement | null => document.querySelector<HTMLElement>(`${region} [data-shell-focus], ${region}[data-shell-focus]`);

/** Whether an element is inside the panel. */
export const inPanel = (node: EventTarget | null): boolean => node instanceof Element && node.closest(PANEL) !== null;

/** Whether an element is the panel's resize separator. It is a sibling of the region, not inside it, so `inPanel` does not take it for part of the panel; it goes when the panel does, and so does the focus on it. */
const onHandle = (node: EventTarget | null): boolean => node instanceof Element && node.matches(HANDLE);

/** Puts the focus on the panel's one stop: its tool on screen. False when the panel is not drawn. */
export function focusPanel(): boolean {
  const element = target(PANEL);
  element?.focus();
  return element !== null && document.activeElement === element;
}

/** Puts the focus on the page island's stop. */
export function focusPage(): boolean {
  const element = target('[data-shell-region="island"]');
  element?.focus();
  return element !== null && document.activeElement === element;
}

/** Opens the panel and moves the focus into it, once React has drawn it (the region is hidden until then, and a hidden element takes no focus). */
export function showPanel(store: PanelStore, options?: ShowOptions): void {
  store.show(options);
  focusAfterOpen();
}

function focusAfterOpen(): void {
  queueMicrotask(() => {
    if (!focusPanel()) {
      requestAnimationFrame(() => {
        focusPanel();
      });
    }
  });
}

/** Hides the panel. A focus that was inside it, or on its separator, goes to the page: the element it was on is about to stop being drawn. */
export function hidePanel(store: PanelStore): void {
  const inside = inPanel(document.activeElement) || onHandle(document.activeElement);
  store.hide();
  if (inside) {
    queueMicrotask(() => {
      focusPage();
    });
  }
}

/**
 * A drag released below the threshold hides the panel, the splitter's own way of hiding it: the separator it pressed on had the focus and goes with the panel, so the focus goes to the page, as it
 * does when the panel is hidden any other way. Called by the splitter once the release has hidden the panel, while the separator is still there.
 */
export function leaveHandle(): void {
  if (onHandle(document.activeElement)) {
    queueMicrotask(() => {
      focusPage();
    });
  }
}

export function togglePanelMaximized(store: PanelStore): void {
  store.toggleMaximized();
  if (store.getSnapshot().maximized && !inPanel(document.activeElement)) {
    focusAfterOpen();
  }
}

/** The toggle: open and focus, or hide. */
export function togglePanel(store: PanelStore): void {
  if (store.getSnapshot().open) {
    hidePanel(store);
  } else {
    showPanel(store);
  }
}

/** Puts the focus on a tab of one of the panel's strips by its id, once React has drawn the strip without the tab that closed. */
export function focusTab(strip: 'sessionTabs' | 'panelTools', id: string): void {
  queueMicrotask(() => {
    const tabs = document.querySelectorAll<HTMLElement>(`${PANEL} [data-shell-part="${strip}"] [role="tab"]`);
    [...tabs].find((tab) => tab.dataset.tabId === id)?.focus();
  });
}

const PANE_BODY = '[data-shell-part="panelBody"][data-session-id]';

/** Puts the keyboard in the body of a pane: its emulator's input (where a terminal takes the keys), else the first control it has. False when the body has nothing to take it. */
export function focusPaneBody(session: SessionId): boolean {
  const body = [...document.querySelectorAll<HTMLElement>(PANE_BODY)].find((one) => one.getAttribute('data-session-id') === session);
  const target = body?.querySelector<HTMLElement>('.xterm-helper-textarea') ?? body?.querySelector<HTMLElement>('button, [tabindex="0"], textarea, input');
  target?.focus();
  return target !== undefined && target !== null && document.activeElement === target;
}

/**
 * The pane chords (`paneChordOf`): moves the keyboard from the active pane of the tool on screen to the pane `step` asks for, and makes that pane the active one. False when there is nowhere to go (one pane, the end of a row), so that the key is
 * left alone.
 */
export function moveToPane(store: PanelStore, step: PaneStep): boolean {
  const shown = store.selectors.shown(store.getSnapshot());
  const layout = shown === null ? null : store.selectors.paneLayout(store.getSnapshot(), shown.tool);
  const target = layout === null ? undefined : paneToward(layout, step);
  const pane = layout?.panes.find((one) => one.id === target);
  if (shown === null || pane === undefined || target === undefined) {
    return false;
  }

  store.focusPane(shown.tool, target);
  focusPaneBody(pane.session);
  return true;
}
