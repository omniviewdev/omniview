import { Activity, Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Location, TabId } from '../core/tabs';
import { useTabs } from './context';
import { useActiveId, useLocation, useMountedIds } from './hooks';
import styles from './PageHost.module.css';
import { tabDomId } from './words';

/** What a host is asked to draw: the tab, and where it is. The page is drawn again when the tab's route changes or it is reloaded, never for a title. */
export type PageTab = { readonly id: TabId; readonly location: Location };

type PageHostProps = {
  /** Draws the page of one tab. Called for every mounted tab, so a hidden page keeps its own state and its own subscriptions' place. */
  readonly renderPage: (tab: PageTab) => ReactNode;
  /** What the region shows while no tab is on screen (the plugins are loading, or none is installed). */
  readonly empty: ReactNode;
  /** Who scrolls the page (ch16 S15): the shell's own region (`document`), or the page itself (`pane`). */
  readonly layout: 'document' | 'pane';
  readonly prefix: string;
  readonly panelId: string;
};

type Slot = { readonly id: TabId; readonly visible: boolean; readonly layout: 'document' | 'pane'; readonly renderPage: PageHostProps['renderPage'] };

type Position = { readonly top: number; readonly left: number };

/** A scroller inside a page, known by what it is and not by which element it is: a page that draws it anew (a collection that reads its data again) is still the page's scroller. */
type Remembered = Position & { readonly tag: string; readonly role: string; readonly label: string; readonly ordinal: number };

/** How long after a page comes back its scrollers are looked for again (a collection may take its time to draw its rows). */
const RESTORE_WINDOW_MS = 10_000;

const scrollersLike = (root: Element, tag: string, role: string, label: string): Element[] =>
  [...root.querySelectorAll(tag)].filter((element) => (element.getAttribute('role') ?? '') === role && (element.getAttribute('aria-label') ?? '') === label);

function remember(root: Element, element: Element, memory: Map<string, Remembered>): void {
  const role = element.getAttribute('role') ?? '';
  const label = element.getAttribute('aria-label') ?? '';
  const ordinal = scrollersLike(root, element.tagName, role, label).indexOf(element);
  memory.set(JSON.stringify([element.tagName, role, label, ordinal]), { tag: element.tagName, role, label, ordinal, top: element.scrollTop, left: element.scrollLeft });
}

/** Puts back what was left, in each scroller that is at its start: one the user has scrolled since is left alone. */
function restore(root: Element, memory: ReadonlyMap<string, Remembered>): void {
  for (const saved of memory.values()) {
    const element = scrollersLike(root, saved.tag, saved.role, saved.label)[saved.ordinal];
    if (element?.scrollTop === 0 && element.scrollLeft === 0 && (saved.top > 0 || saved.left > 0)) {
      element.scrollTop = saved.top;
      element.scrollLeft = saved.left;
    }
  }
}

/**
 * A hidden page's own scrollers keep their offsets (the browser's `display: none` does not reset them). A page that draws a scroller anew when it comes back (the data layer reads a
 * collection again, shows its loading state, and the table is a new element) has lost the offset with the element, so what each scroller was at is kept as it scrolls, and put back
 * for a while after the page is shown, as the scrollers appear.
 */
function useScrollRestore(root: RefObject<HTMLDivElement | null>, memory: Map<string, Remembered>, visible: boolean): void {
  useEffect(() => {
    const element = root.current;
    if (!visible || element === null || memory.size === 0) {
      return undefined;
    }

    restore(element, memory);
    const observer = new MutationObserver(() => {
      restore(element, memory);
    });
    observer.observe(element, { childList: true, subtree: true });
    const stop = setTimeout(() => {
      observer.disconnect();
    }, RESTORE_WINDOW_MS);
    return () => {
      clearTimeout(stop);
      observer.disconnect();
    };
  }, [visible, root, memory]);
}

/** One mounted page. It reads its own tab's location, so a route change in another tab does not render it. */
function PageSlot({ id, visible, layout, renderPage }: Slot) {
  const store = useTabs();
  const location = useLocation(store, id);
  const root = useRef<HTMLDivElement>(null);
  const [memory] = useState(() => new Map<string, Remembered>());
  useScrollRestore(root, memory, visible);
  if (location === undefined) {
    return null;
  }

  // React hides what is not on screen: its effects are released, so a hidden page holds no timer and no subscription, its renders wait for idle time, and the browser does no layout and
  // no paint for it (`display: none`). Its state and its DOM stay, so it comes back as it was. The key is the page's place: a new route, or a reload, draws it from scratch.
  return (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <div
        ref={root}
        className={styles.content}
        data-layout={layout}
        data-page-slot=""
        data-tab-id={id}
        onScrollCapture={(event) => {
          if (event.target instanceof Element && event.target !== event.currentTarget) {
            remember(event.currentTarget, event.target, memory);
          }
        }}
      >
        <Fragment key={`${location.key}|${String(location.generation)}`}>{renderPage({ id, location })}</Fragment>
      </div>
    </Activity>
  );
}

/**
 * The page region of the island (ch16 R7, S15, S29): the one tabpanel every tab controls, with the pages of the mounted tabs in it. The tab model says which pages are mounted
 * (`selectors.mounted`: the keep-alive policy, default five, the one on screen and four hidden); this draws each in its own slot, and hides all but the tab on screen with React's
 * `Activity` (docs/ui-next/optimisations.md HSH-21, MNR-K1). A tab that leaves the list is unmounted, and is drawn from scratch when it is shown again.
 *
 * Scroll. A hidden page's own scrollers keep their offsets (measured in WebKit and Chromium: `display: none` does not reset them). The region itself scrolls the pages that do not own
 * their scrolling (`document`), and it is one element for every tab, so its offset is kept per tab here and put back before the tab is painted.
 */
export function PageHost({ renderPage, empty, layout, prefix, panelId }: PageHostProps) {
  const store = useTabs();
  const mounted = useMountedIds(store);
  const active = useActiveId(store);
  const panel = useRef<HTMLDivElement>(null);
  const [memory] = useState(() => new Map<TabId, Position>());

  // The region shows the offset of the tab that is on screen: the one it was left at, or the top of a page that was not shown before.
  useLayoutEffect(() => {
    const element = panel.current;
    if (element === null || active === null) {
      return;
    }

    for (const id of memory.keys()) {
      if (!mounted.includes(id)) {
        memory.delete(id);
      }
    }

    const saved = memory.get(active);
    element.scrollTop = saved?.top ?? 0;
    element.scrollLeft = saved?.left ?? 0;
  }, [active, mounted, memory]);

  const hosted = active !== null && mounted.length > 0;
  return (
    <div
      ref={panel}
      id={panelId}
      className={styles.page}
      role={hosted ? 'tabpanel' : undefined}
      tabIndex={layout === 'pane' ? undefined : 0}
      aria-labelledby={hosted ? tabDomId(prefix, active) : undefined}
      data-shell-part="page"
      data-layout={layout}
      onScroll={(event) => {
        if (active !== null) {
          memory.set(active, { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });
        }
      }}
    >
      {hosted ? (
        mounted.map((id) => <PageSlot key={id} id={id} visible={id === active} layout={layout} renderPage={renderPage} />)
      ) : (
        <div className={styles.content} data-layout={layout}>
          {empty}
        </div>
      )}
    </div>
  );
}
