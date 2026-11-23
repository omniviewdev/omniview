import type { MenuTriggerMode } from './menuTrigger';
import { buildMenu, type MenuDefinition, type MenuModel, type MenuRegistry, type MenuRow } from './items';

const hosts = new WeakSet<Document>();
const MENU = 'data-ov-menu';
const MODE = 'data-ov-menu-mode';
const KEY = 'data-ov-menu-key';
const ITEM = '[data-ov-menu-item]';
const POPUP = '[data-ov-menu-popup]';
const NATIVE_EDIT = 'input, textarea, select, [contenteditable]';
const ROW = 'tr, li, [role="row"], [role="option"], [role="listitem"]';
const HOVER_DELAY = 250;
const NATIVE_BUTTON_INPUTS: Readonly<Record<string, true>> = { button: true, submit: true, reset: true, image: true };
const TYPE_TIMEOUT = 700;
const SCOPE_TOKENS = ['data-ov-theme', 'data-ov-density'] as const;

type Trigger = {
  readonly element: HTMLElement;
  readonly id: string;
  readonly mode: MenuTriggerMode;
  readonly key: string | null;
};

type Focus = 'first' | 'last' | 'panel' | 'none';

type Position =
  | { readonly kind: 'trigger'; readonly element: HTMLElement }
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'branch'; readonly row: HTMLButtonElement; readonly panel: HTMLDivElement; readonly parentIndex: number };

export type MenuLevel = {
  readonly id: string;
  readonly epoch: number;
  readonly depth: number;
  readonly position: Position;
  readonly focus: Focus;
  readonly model: MenuModel;
  readonly label: string;
};

export type MenuView = {
  readonly mount: HTMLElement;
  readonly ownerId: string;
  readonly rtl: boolean;
  readonly mode: MenuTriggerMode;
  readonly levels: readonly MenuLevel[];
};

export type MenuController = {
  readonly attach: (portal: HTMLDivElement) => () => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => MenuView | null;
  readonly setMenus: (menus: MenuRegistry | undefined) => void;
  readonly register: (id: string, definition: MenuDefinition) => () => void;
  readonly invalidate: (id: string) => void;
  readonly attachPanel: (level: MenuLevel, element: HTMLDivElement) => () => void;
  readonly focusInitial: (level: MenuLevel) => void;
  readonly panelBlur: (level: MenuLevel) => void;
  readonly keyDown: (level: MenuLevel, event: KeyboardEvent) => boolean;
  readonly pointerMove: (level: MenuLevel, row: MenuRow | undefined) => void;
  readonly pointerLeave: (level: MenuLevel) => void;
  readonly select: (level: MenuLevel, row: MenuRow) => void;
};

type Session = {
  readonly trigger: Trigger;
  readonly invoker: HTMLElement;
  readonly region: HTMLElement | null;
  readonly overlay: HTMLElement | null;
  view: MenuView;
  contextKeyTime: number | undefined;
  disconnect: () => void;
};

type Panel = {
  readonly element: HTMLDivElement;
  readonly buttons: NodeListOf<HTMLButtonElement>;
  prefix: string;
  typedAt: number;
};

function triggerAt(target: EventTarget | null, mode: MenuTriggerMode): Trigger | null {
  if (!(target instanceof Element) || target.closest(POPUP) !== null) {
    return null;
  }

  const element = target.closest(`[${MENU}][${MODE}="${mode}"]`);
  if (!(element instanceof HTMLElement) || element.matches(':disabled, [aria-disabled="true"]')) {
    return null;
  }

  const id = element.getAttribute(MENU);
  return id ? { element, id, mode, key: element.getAttribute(KEY) } : null;
}

function isLive({ element, id, mode, key }: Trigger): boolean {
  return element.isConnected && element.getAttribute(MENU) === id && element.getAttribute(MODE) === mode &&
    element.getAttribute(KEY) === key && !element.matches(':disabled, [aria-disabled="true"]') &&
    element.closest('[hidden], [inert]') === null;
}

function sameTrigger(left: Trigger, right: Trigger): boolean {
  return left.element === right.element && left.id === right.id && left.mode === right.mode && left.key === right.key;
}

function keepsNativeContext(target: EventTarget | null, trigger: HTMLElement): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const editor = target.closest(NATIVE_EDIT);
  return editor !== null && editor !== trigger && editor.getAttribute('contenteditable') !== 'false';
}

function labelOf({ element, mode }: Trigger): string {
  const doc = element.ownerDocument;
  const references = element.getAttribute('aria-labelledby');
  const label = references?.trim().split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? '').join(' ').trim();
  const name = [element.getAttribute('data-ov-menu-label'), label, element.getAttribute('aria-label'), mode === 'dropdown' ? element.textContent : null]
    .find((candidate) => !!candidate?.trim())?.trim();
  return name ?? (mode === 'context' ? 'Context menu' : 'Menu');
}

function tryFocus(element: HTMLElement | null): boolean {
  if (element?.isConnected !== true) {
    return false;
  }

  element.focus({ preventScroll: true });
  return element.ownerDocument.activeElement === element;
}

export function createMenuController(rootId: string): MenuController {
  const listeners = new Set<() => void>();
  const local = new Map<string, MenuDefinition>();
  const panels = new WeakMap<MenuLevel, Panel>();
  let portal: HTMLDivElement | undefined;
  let menus: MenuRegistry | undefined;
  let session: Session | undefined;
  let epoch = 0;
  let hover: { readonly level: MenuLevel; readonly row: MenuRow } | undefined;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;

  const publish = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const definitionFor = (id: string) => local.get(id) ?? (menus !== undefined && Object.hasOwn(menus, id) ? menus[id] : undefined);

  function clearHover() {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
    hover = undefined;
  }

  function inMenu(open: Session, target: Node): boolean {
    return open.view.levels.some((level) => panels.get(level)?.element.contains(target) === true);
  }

  /** Focus can be given back only while the menu owns it. An invalid trigger can only return focus to its original region. */
  function restoreFocus(open: Session) {
    const { element } = open.trigger;
    const doc = element.ownerDocument;
    const active = doc.activeElement;
    const inPanel = active !== null && inMenu(open, active);
    if (inPanel || active === null || active === doc.body || active === doc.documentElement) {
      const invoker = open.invoker;
      if (isLive(open.trigger) && ((element.contains(invoker) && tryFocus(invoker)) || tryFocus(element))) {
        return;
      }

      if (!tryFocus(open.region) && inPanel && active instanceof HTMLElement) {
        active.blur();
      }
    }
  }

  function finish(restore: boolean): boolean {
    const open = session;
    if (open === undefined) {
      return false;
    }

    session = undefined;
    open.disconnect();
    clearHover();

    const { element, mode } = open.trigger;
    if (mode === 'dropdown') {
      element.removeAttribute('aria-expanded');
      element.removeAttribute('aria-controls');
    }

    open.view.mount.remove();
    if (restore) {
      restoreFocus(open);
    }

    return true;
  }

  function close(restore = true) {
    if (finish(restore)) {
      publish();
    }
  }

  function live(level: MenuLevel): Session | undefined {
    const open = session;
    if (open?.view.levels[level.depth] !== level) {
      return undefined;
    }

    if (isLive(open.trigger) && definitionFor(open.trigger.id) !== undefined) {
      return open;
    }

    close();
    return undefined;
  }

  function observe(open: Session): () => void {
    const { element } = open.trigger;
    const doc = element.ownerDocument;
    const win = doc.defaultView;
    const observer = new MutationObserver(() => {
      if (session !== open) {
        return;
      }

      if (!isLive(open.trigger) || !open.view.mount.isConnected) {
        close();
        return;
      }

      // WebKit can drop focus onto the body without a blur when a focused node is removed.
      const active = doc.activeElement;
      const deepest = open.view.levels.at(-1);
      if ((active === null || active === doc.body) && deepest !== undefined) {
        panels.get(deepest)?.element.focus({ preventScroll: true });
      }
    });
    observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert'] });
    observer.observe(element, { attributes: true, attributeFilter: [MENU, MODE, KEY, 'disabled', 'aria-disabled', 'hidden', 'inert'] });

    const press = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node) {
        if (inMenu(open, target)) {
          return;
        }

        if (open.trigger.mode === 'dropdown' && element.contains(target)) {
          // Safari can move focus to the surrounding region on the press before the toggle click.
          if (event.button === 0) {
            event.preventDefault();
          }

          return;
        }
      }

      close();
    };

    const dismissForLayout = () => {
      if (open.trigger.key === null || win === null) {
        close();
        return;
      }

      // A row can recycle in a scroll handler after this capture listener runs. Check its identity after layout.
      const at = epoch;
      close(false);
      win.requestAnimationFrame(() => {
        if (epoch === at && session === undefined && hosts.has(doc)) {
          restoreFocus(open);
        }
      });
    };

    const scroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && target !== doc) {
        if (inMenu(open, target)) {
          // A scrolling parent panel must not leave a child at its row's old position.
          const child = open.view.levels.find((level) => level.position.kind === 'branch' && target.contains(level.position.row));
          if (child !== undefined) {
            closeBranch(open, child);
          }

          return;
        }

        if (!target.contains(element)) {
          return;
        }
      }

      dismissForLayout();
    };

    const resize = () => {
      dismissForLayout();
    };

    const focus = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && (element.contains(target) || inMenu(open, target))) {
        return;
      }

      close(false);
    };

    const ownerToggle = (event: ToggleEvent) => {
      if (event.target === open.overlay && event.newState === 'closed') {
        close(false);
      }
    };

    const ownerClose = () => {
      close(false);
    };

    win?.addEventListener('pointerdown', press, true);
    win?.addEventListener('scroll', scroll, true);
    win?.addEventListener('resize', resize);
    doc.addEventListener('focusin', focus);
    open.overlay?.addEventListener('toggle', ownerToggle);
    open.overlay?.addEventListener('close', ownerClose);
    return () => {
      observer.disconnect();
      win?.removeEventListener('pointerdown', press, true);
      win?.removeEventListener('scroll', scroll, true);
      win?.removeEventListener('resize', resize);
      doc.removeEventListener('focusin', focus);
      open.overlay?.removeEventListener('toggle', ownerToggle);
      open.overlay?.removeEventListener('close', ownerClose);
    };
  }

  function openMenu(trigger: Trigger, focus: Focus, position: Position): boolean {
    if (trigger.mode === 'dropdown' && session !== undefined && sameTrigger(session.trigger, trigger)) {
      close();
      return true;
    }

    if (portal === undefined || !isLive(trigger)) {
      return false;
    }

    const definition = definitionFor(trigger.id);
    const items = typeof definition === 'function' ? definition(trigger.key ?? undefined) : definition;
    if (items === null || items === undefined || items.length === 0 || !isLive(trigger)) {
      return false;
    }

    const model = buildMenu(items);
    if (model.rows.length === 0) {
      return false;
    }

    finish(false);
    const { element } = trigger;
    const doc = element.ownerDocument;
    const overlay = element.closest<HTMLElement>('dialog[open], [popover]');
    const scope = element.parentElement?.closest<HTMLElement>('[data-ov-menu-scope]');
    const mount = scope != null && (overlay === null || overlay.contains(scope)) ? scope : overlay ?? doc.body;
    // Mirror local tokens that the portal would otherwise miss, without inserting a div into a table or button.
    for (const attribute of SCOPE_TOKENS) {
      const source = element.closest(`[${attribute}]`);
      const value = source === null || source.contains(mount) ? null : source.getAttribute(attribute);
      if (value === null) {
        portal.removeAttribute(attribute);
      } else {
        portal.setAttribute(attribute, value);
      }
    }

    mount.append(portal);
    const computedDir = doc.defaultView?.getComputedStyle(element).direction;
    const dir = computedDir === 'rtl' || computedDir === 'ltr' ? computedDir : element.closest('[dir]')?.getAttribute('dir');
    const active = doc.activeElement;
    const row = element.closest(ROW) ?? element;
    const region = row.parentElement?.closest<HTMLElement>('[tabindex]:not([data-ov-menu])') ?? null;
    const level: MenuLevel = { id: rootId, epoch: ++epoch, depth: 0, position, focus, model, label: labelOf(trigger) };
    const open: Session = {
      trigger,
      invoker: active instanceof HTMLElement && element.contains(active) ? active : element,
      region,
      overlay,
      view: { mount: portal, ownerId: trigger.id, rtl: dir === 'rtl', mode: trigger.mode, levels: [level] },
      contextKeyTime: undefined,
      disconnect: () => undefined,
    };
    session = open;
    open.disconnect = observe(open);
    if (trigger.mode === 'dropdown') {
      element.setAttribute('aria-expanded', 'true');
      element.setAttribute('aria-controls', rootId);
    }

    publish();
    return true;
  }

  function setLevels(open: Session, levels: readonly MenuLevel[]) {
    open.view = { ...open.view, levels };
    publish();
  }

  function closeBranch(open: Session, level: MenuLevel) {
    if (level.position.kind !== 'branch') {
      return;
    }

    clearHover();
    const focus = level.position.row.ownerDocument.activeElement;
    if (focus !== null && inMenu(open, focus)) {
      tryFocus(level.position.row);
    }

    setLevels(open, open.view.levels.slice(0, level.depth));
  }

  function openBranch(open: Session, level: MenuLevel, row: MenuRow, focus: Focus) {
    const parent = panels.get(level);
    const button = parent?.buttons.item(row.index);
    if (parent === undefined || button === null || button === undefined || row.submenu === undefined || row.disabled) {
      return;
    }

    const depth = level.depth + 1;
    const current = open.view.levels[depth];
    if (current?.position.kind === 'branch' && current.position.row === button) {
      if (focus === 'first') {
        focusInitial(current, focus);
      }

      return;
    }

    const next: MenuLevel = {
      id: `${rootId}-${depth}`,
      epoch: ++epoch,
      depth,
      position: { kind: 'branch', row: button, panel: parent.element, parentIndex: row.index },
      focus,
      model: buildMenu(row.submenu),
      label: row.entry.label,
    };
    setLevels(open, [...open.view.levels.slice(0, depth), next]);
  }

  function focusRow(open: Session, level: MenuLevel, index: number, reveal: boolean) {
    const button = panels.get(level)?.buttons.item(index);
    if (button === null || button === undefined) {
      return;
    }

    const child = open.view.levels[level.depth + 1];
    if (child?.position.kind === 'branch' && child.position.row !== button) {
      setLevels(open, open.view.levels.slice(0, level.depth + 1));
    }

    button.focus({ preventScroll: true });
    if (reveal) {
      button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  function focusInitial(level: MenuLevel, focus = level.focus) {
    const open = live(level);
    if (open === undefined || focus === 'none') {
      return;
    }

    if (focus !== 'panel') {
      const rows = level.model.rows;
      const index = focus === 'first' ? rows.findIndex((row) => !row.disabled) : rows.findLastIndex((row) => !row.disabled);
      if (index >= 0) {
        focusRow(open, level, index, true);
        return;
      }
    }

    panels.get(level)?.element.focus({ preventScroll: true });
  }

  function select(level: MenuLevel, row: MenuRow) {
    const open = live(level);
    if (open === undefined || row.disabled) {
      return;
    }

    clearHover();
    if (row.select === undefined) {
      openBranch(open, level, row, 'first');
    } else {
      close();
      row.select();
    }
  }

  function pointerMove(level: MenuLevel, row: MenuRow | undefined) {
    const open = live(level);
    if (open === undefined || (row !== undefined && hover?.level === level && hover.row === row)) {
      return;
    }

    clearHover();
    if (row === undefined) {
      return;
    }

    const parent = panels.get(level);
    const button = parent?.buttons.item(row.index);
    const child = open.view.levels[level.depth + 1];
    const otherBranch = child?.position.kind === 'branch' && child.position.row !== button;
    hover = { level, row };
    if (!otherBranch && !row.disabled) {
      focusRow(open, level, row.index, false);
    }

    if (!otherBranch && (row.disabled || row.submenu === undefined || child !== undefined)) {
      return;
    }

    // Delay a switch while crossing the parent on the way to its child; leaving the panel cancels it.
    hoverTimer = setTimeout(() => {
      hoverTimer = undefined;
      if (live(level) !== open) {
        return;
      }

      if (row.disabled) {
        if (child !== undefined) {
          closeBranch(open, child);
        }

        return;
      }

      if (otherBranch) {
        focusRow(open, level, row.index, false);
      }

      if (row.submenu !== undefined) {
        openBranch(open, level, row, 'none');
      }
    }, HOVER_DELAY);
  }

  function keyDown(level: MenuLevel, event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }

    const open = live(level);
    const panel = panels.get(level);
    if (open === undefined || panel === undefined) {
      return false;
    }

    const { key } = event;
    if (key === 'Tab') {
      // Let native Tab start at the restored trigger, not at the portal's position in DOM order.
      close();
      return false;
    }

    clearHover();
    if (key === 'Escape') {
      const deepest = open.view.levels.at(-1);
      if (deepest?.position.kind === 'branch') {
        closeBranch(open, deepest);
      } else {
        close();
      }

      return true;
    }

    const row = rowAt(level, event.target);
    const forward = open.view.rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = open.view.rtl ? 'ArrowRight' : 'ArrowLeft';
    if (key === back) {
      const deepest = open.view.levels.at(-1);
      if (deepest?.position.kind === 'branch') {
        closeBranch(open, deepest);
        return true;
      }
    }

    if (key === forward && row?.submenu !== undefined) {
      openBranch(open, level, row, 'first');
      return true;
    }

    const searchInProgress = key === ' ' && panel.prefix !== '' && Date.now() - panel.typedAt <= TYPE_TIMEOUT;
    if (key === 'Enter' || (key === ' ' && !searchInProgress)) {
      if (row !== undefined && !event.repeat) {
        select(level, row);
      }

      return true;
    }

    const { rows } = level.model;
    const page = key === 'PageUp' || key === 'PageDown';
    const wraps = key === 'ArrowDown' || key === 'ArrowUp';
    if (page || wraps || key === 'Home' || key === 'End') {
      panel.prefix = '';
      const direction = key === 'ArrowUp' || key === 'PageUp' || key === 'End' ? -1 : 1;
      let index = key === 'Home' ? -1 : key === 'End' ? rows.length : row?.index ?? (direction > 0 ? -1 : rows.length);
      let remaining = rows.length;
      let steps = page ? 10 : 1;
      let selected = -1;
      while (remaining > 0) {
        remaining -= 1;
        index += direction;
        if (index < 0 || index >= rows.length) {
          if (!wraps) {
            break;
          }

          index = (index + rows.length) % rows.length;
        }

        const next = rows[index];
        if (next !== undefined && !next.disabled) {
          selected = index;
          steps -= 1;
          if (steps === 0) {
            break;
          }
        }
      }

      if (selected !== -1) {
        focusRow(open, level, selected, true);
      }

      return true;
    }

    if (key.length !== 1 && !(key.length === 2 && (key.codePointAt(0) ?? 0) > 0xffff)) {
      return false;
    }

    const at = Date.now();
    const char = key.toLocaleLowerCase();
    const same = at - panel.typedAt <= TYPE_TIMEOUT && panel.prefix === char;
    panel.prefix = same || at - panel.typedAt > TYPE_TIMEOUT ? char : panel.prefix + char;
    panel.typedAt = at;
    const start = row === undefined ? 0 : row.index + (panel.prefix === char ? 1 : 0);
    for (let i = 0; i < rows.length; i += 1) {
      const item = rows[(start + i + rows.length) % rows.length];
      // Search also reaches unavailable items so keyboard users can read the reason without activating them.
      if (item?.entry.label.trimStart().toLocaleLowerCase().startsWith(panel.prefix)) {
        focusRow(open, level, item.index, true);
        break;
      }
    }

    return true;
  }

  function attach(container: HTMLDivElement): () => void {
    const doc = container.ownerDocument;
    if (hosts.has(doc)) {
      throw new Error('Mount only one MenuHost per document');
    }

    hosts.add(doc);
    portal = container;

    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }

      const trigger = triggerAt(event.target, 'dropdown');
      if (trigger === null) {
        return;
      }

      const focus = event.detail === 0 || trigger.element.getAttribute('data-ov-menu-pointer-focus') === 'first' ? 'first' : 'panel';
      if (openMenu(trigger, focus, { kind: 'trigger', element: trigger.element })) {
        event.preventDefault();
      }
    };

    const context = (event: MouseEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const trigger = triggerAt(event.target, 'context');
      if (trigger === null || keepsNativeContext(event.target, trigger.element)) {
        return;
      }

      // Some engines issue a zero-button contextmenu event after a keyboard invocation.
      const open = session;
      if (event.button === 0 && open?.contextKeyTime !== undefined && sameTrigger(open.trigger, trigger) && Date.now() - open.contextKeyTime < 500) {
        event.preventDefault();
        return;
      }

      const focus = trigger.element.getAttribute('data-ov-menu-pointer-focus') === 'first' ? 'first' : 'panel';
      if (openMenu(trigger, focus, { kind: 'point', x: event.clientX, y: event.clientY })) {
        event.preventDefault();
      }
    };

    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const open = session;
      if (open !== undefined && event.target instanceof Node && open.trigger.element.contains(event.target)) {
        if (event.key === 'Tab') {
          close();
          return;
        }

        if (event.key === 'Escape') {
          close();
          event.preventDefault();
          return;
        }
      }

      const contextKey = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
      const dropdownKey = !event.shiftKey && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp');
      if (!contextKey && !dropdownKey) {
        return;
      }

      const trigger = triggerAt(event.target, contextKey ? 'context' : 'dropdown');
      if (trigger === null || (contextKey ? keepsNativeContext(event.target, trigger.element) : trigger.element !== event.target)) {
        return;
      }

      if ((event.key === 'Enter' || event.key === ' ') &&
        (trigger.element instanceof HTMLButtonElement ||
          (trigger.element instanceof HTMLInputElement && Object.hasOwn(NATIVE_BUTTON_INPUTS, trigger.element.type)))) {
        // Let native activation dispatch a click so the trigger's own onClick can veto opening.
        return;
      }

      const focus = event.key === 'ArrowUp' ? 'last' : 'first';
      if (event.repeat) {
        if (open !== undefined && sameTrigger(open.trigger, trigger)) {
          event.preventDefault();
        }

        return;
      }

      if (openMenu(trigger, focus, { kind: 'trigger', element: trigger.element })) {
        if (contextKey && session !== undefined) {
          session.contextKeyTime = Date.now();
        }

        event.preventDefault();
      }
    };

    doc.addEventListener('click', click);
    doc.addEventListener('contextmenu', context);
    doc.addEventListener('keydown', key);
    return () => {
      close(false);
      portal = undefined;
      doc.removeEventListener('click', click);
      doc.removeEventListener('contextmenu', context);
      doc.removeEventListener('keydown', key);
      hosts.delete(doc);
    };
  }

  return {
    attach,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot(): MenuView | null {
      return session?.view ?? null;
    },
    setMenus(next: MenuRegistry | undefined) {
      menus = next;
      if (session !== undefined && definitionFor(session.trigger.id) === undefined) {
        close();
      }
    },
    register(id: string, definition: MenuDefinition): () => void {
      local.set(id, definition);
      return () => {
        local.delete(id);
        const open = session;
        if (open?.trigger.id === id) {
          queueMicrotask(() => {
            if (session === open && definitionFor(id) === undefined) {
              close();
            }
          });
        }
      };
    },
    invalidate(id: string) {
      if (session?.trigger.id === id) {
        close();
      }
    },
    attachPanel(level: MenuLevel, element: HTMLDivElement): () => void {
      panels.set(level, { element, buttons: element.querySelectorAll<HTMLButtonElement>(ITEM), prefix: '', typedAt: 0 });
      return () => {
        panels.delete(level);
      };
    },
    focusInitial,
    panelBlur(level: MenuLevel) {
      if (session?.view.levels[level.depth] === level) {
        close(false);
      }
    },
    keyDown,
    pointerMove,
    pointerLeave(level: MenuLevel) {
      if (hover?.level === level) {
        clearHover();
      }
    },
    select,
  };
}

export function rowAt(level: MenuLevel, target: EventTarget | null): MenuRow | undefined {
  const row = target instanceof Element ? target.closest<HTMLElement>(ITEM) : null;
  const index = row?.getAttribute('data-ov-menu-item');
  return index == null ? undefined : level.model.rows[Number(index)];
}
