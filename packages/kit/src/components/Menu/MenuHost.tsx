import { createContext, useContext, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createMenuController, type MenuController } from './controller';
import type { MenuDefinition, MenuRegistry } from './items';
import { MenuPanel } from './MenuPanel';
import styles from './Menu.module.css';

export type MenuHostProps = {
  /** Definitions keyed by the IDs passed to `menuTrigger`. A resolver runs only when its menu is invoked. */
  readonly menus?: MenuRegistry | undefined;
  /** App content. Descendants can register a definition with `useMenu`. */
  readonly children?: ReactNode;
};

const MenuContext = createContext<MenuController | null>(null);
const closed = () => null;

/**
 * The one menu host per document. Dropdown and context triggers need only attributes; the host builds and mounts the active menu tree on demand.
 * The menu enters the top layer in its trigger's theme, inside any containing dialog or popover. Mark a region with `data-ov-menu-scope`
 * to keep native events inside it. Escape closes one level at a time. Selection and Tab close the tree. Focus returns before an
 * action runs, and never returns to a virtual trigger that has changed context key.
 */
export function MenuHost({ menus, children }: MenuHostProps): ReactElement {
  const id = useId();
  const [controller] = useState(() => createMenuController(`${id}-menu`));
  const view = useSyncExternalStore(controller.subscribe, controller.snapshot, closed);
  const root = view?.levels[0];

  useLayoutEffect(() => {
    controller.setMenus(menus);
  }, [controller, menus]);
  useLayoutEffect(() => {
    const portal = document.createElement('div');
    portal.className = styles.portal ?? '';
    portal.setAttribute('data-ov-menu-portal', '');
    return controller.attach(portal);
  }, [controller]);

  return (
    <MenuContext.Provider value={controller}>
      {children}
      {view === null || root === undefined ? null : createPortal(
        <MenuPanel key={root.epoch} controller={controller} level={root} view={view} />,
        view.mount,
      )}
    </MenuContext.Provider>
  );
}

/**
 * Register one live, local menu definition under `MenuHost`. Pass the returned ID to `menuTrigger`; one definition can serve every row.
 * Definition changes apply to the next opening. A change to `revision` dismisses an open snapshot, for example when its commands become
 * unavailable. Without a host, a trigger remains inert.
 */
export function useMenu(definition: MenuDefinition, revision?: unknown): string {
  const controller = useContext(MenuContext);
  const id = useId();
  const latest = useRef(definition);
  const previousRevision = useRef(revision);
  useLayoutEffect(() => {
    latest.current = definition;
    if (!Object.is(previousRevision.current, revision)) {
      previousRevision.current = revision;
      controller?.invalidate(id);
    }
  }, [controller, definition, id, revision]);
  useLayoutEffect(() => controller?.register(id, (key) => {
    const current = latest.current;
    return typeof current === 'function' ? current(key) : current;
  }), [controller, id]);
  return id;
}
