import { CollectionFooter, LoadingBody } from '@omniviewdev/kit';
import { useLayoutEffect, useRef, useSyncExternalStore, type FocusEvent, type ReactNode } from 'react';
import { focusTab } from '../focus';
import { PanelEmpty } from '../PanelEmpty';
import type { PortRow } from './model';
import styles from './PortsBody.module.css';
import { PortsTable } from './PortsTable';
import type { PortsStore } from './PortsStore';
import { PORTS_EMPTY, PORTS_ICON, PORTS_TOOL_ID } from './tool';

// The body of the Ports tool (docs/ui-next/status/PF1.md): what the host reports of forwards, as a table, in the panel's body. It is drawn only while the tool is on screen with the panel open (the host's `renderTool`), so that is
// when the store listens to the host (`PortsStore.ts`): a window with the tool out of sight holds no call, no listener and no timer of it.

type PortsBodyProps = { readonly store: PortsStore };

/** Where the keyboard was in the table: the forward's row. */
type Spot = { readonly id: string };

const ROW = '[data-ports-part="row"]';
/** The window's menu, which is drawn outside the table: the keyboard in it is still the row's. */
const MENU = '[role="menu"]';

/** Puts the keyboard on the row `successor`, or on the tool's own tab when there is none. */
function recover(table: HTMLElement | null, successor: string | undefined): void {
  const row = successor === undefined ? undefined : [...(table?.querySelectorAll<HTMLElement>(ROW) ?? [])].find((candidate) => candidate.dataset.portsId === successor);
  const button = row?.querySelector('button');
  if (button === null || button === undefined) {
    focusTab('panelTools', PORTS_TOOL_ID);
  } else {
    button.focus();
  }
}

/** The row that takes the place of the forward `id` when it goes: the next row of the table as it was drawn last that is still there, else the one before it. */
function successorOf(before: readonly PortRow[], id: string, present: ReadonlySet<string>): string | undefined {
  const at = before.findIndex((row) => row.id === id);
  const after = before.slice(at + 1).find((row) => present.has(row.id));
  return (after ?? before.slice(0, Math.max(at, 0)).reverse().find((row) => present.has(row.id)))?.id;
}

/** A noun of the footer's count, with how many of the forwards are stopping after it, in plain words, while some are: the kit's footer prints the count as `<n> <noun>`, in the polite status it has. */
const counted = (noun: string, stopping: number): string => (stopping === 0 ? noun : `${noun} · ${String(stopping)} stopping`);

export function PortsBody({ store }: PortsBodyProps) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const root = useRef<HTMLDivElement>(null);
  const spot = useRef<Spot | undefined>(undefined);
  const shown = useRef(view.rows);
  const regain = useRef(false);

  // A row whose button had the keyboard goes (Stop ended it, or the host said it was closed): the keyboard is not left on the page, which is where a browser puts it when the element that had it is removed. It goes to the row that took the
  // place of the one that went (the next row of the table as it was drawn last that is still there, else the one before it), or to the tool's own tab when there is none. Only a focus that was lost is found: a person who went elsewhere before
  // the row went is left where they are. A row that goes while the keyboard is in its menu keeps its bookmark, and the table that had it: the host puts the menu away, now that its row is gone, and gives the focus to the table, where
  // `remember` finds it.
  useLayoutEffect(() => {
    const held = spot.current;
    const present = new Set(view.rows.map((row) => row.id));
    if (held !== undefined && !present.has(held.id)) {
      const active = document.activeElement;
      if (active instanceof Element && active.closest(MENU) !== null) {
        return;
      }

      spot.current = undefined;
      if (active === null || active === document.body) {
        recover(root.current, successorOf(shown.current, held.id, present));
      }
    }

    shown.current = view.rows;
  }, [view.rows]);

  // Try again was pressed with the keyboard in the tool: its button goes with the state that holds it, so the keyboard is put on the body, which holds it while the list is read, and then where the answer says it goes: on Try again when the
  // read fails again, and on the first forward when it answers. Only a keyboard that is still on the body is moved: a person who went elsewhere is left there.
  const retry = (): void => {
    const active = document.activeElement;
    regain.current = active instanceof Element && root.current?.contains(active) === true;
    store.retry();
    if (regain.current) {
      root.current?.focus({ preventScroll: true });
    }
  };

  useLayoutEffect(() => {
    if (!regain.current || view.status === 'loading') {
      return;
    }

    regain.current = false;
    const active = document.activeElement;
    if (active !== root.current && active !== document.body && active !== null) {
      return;
    }

    if (view.status === 'failed') {
      root.current?.querySelector<HTMLElement>('[data-shell-part="panelEmpty"] button')?.focus();
    } else {
      recover(root.current, view.rows[0]?.id);
    }
  }, [view.status, view.rows]);

  const remember = (event: FocusEvent<HTMLElement>): void => {
    const row = event.target.closest<HTMLElement>(ROW);
    const held = spot.current;
    if (row !== null) {
      spot.current = { id: row.dataset.portsId ?? '' };
      return;
    }

    // The focus is on the table and not on a row. If the row that had the keyboard is gone from the table as it is drawn now, the host has just put away the menu of that row and given the focus to the table (it does so before the effect above has
    // seen the rows): the keyboard goes on to the row that took its place.
    spot.current = undefined;
    if (held !== undefined) {
      const drawn = new Set([...(root.current?.querySelectorAll<HTMLElement>(ROW) ?? [])].map((candidate) => candidate.dataset.portsId ?? ''));
      if (!drawn.has(held.id)) {
        recover(root.current, successorOf(shown.current, held.id, drawn));
      }
    }
  };

  // The keyboard left the table for another element that is there: it is no longer on a row, unless that element is the row's own menu. A blur with nowhere to go, from an element that is no longer in the document, is the browser taking the
  // focus from a row that was removed.
  const forget = (event: FocusEvent<HTMLElement>): void => {
    const next = event.relatedTarget;
    if (next instanceof Element && next.closest(MENU) !== null) {
      return;
    }

    if (event.target.isConnected && !(next instanceof Node && root.current?.contains(next) === true)) {
      spot.current = undefined;
    }
  };

  let content: ReactNode;
  if (view.status === 'loading') {
    content = (
      <div className={styles.scroll} data-loading="">
        <LoadingBody label="forwarded ports" columns={5} />
      </div>
    );
  } else if (view.status === 'failed') {
    content = (
      <PanelEmpty
        icon="status-error"
        title="Couldn't read the port forwards."
        hint="Forwards that are running are not affected."
        action={{ label: 'Try again', icon: 'refresh', onSelect: retry }}
      />
    );
  } else if (view.rows.length === 0) {
    content = <PanelEmpty icon={PORTS_ICON} title={PORTS_EMPTY.title} hint={PORTS_EMPTY.hint} />;
  } else {
    content = (
      <div className={styles.scroll} tabIndex={-1}>
        <PortsTable rows={view.rows} copied={view.copied} actions={store} />
      </div>
    );
  }

  const stopping = view.rows.filter((row) => row.state === 'stopping').length;

  return (
    <div ref={root} className={styles.ports} data-shell-part="portsBody" data-ports-status={view.status} tabIndex={-1} onFocus={remember} onBlur={forget}>
      {content}
      {view.status === 'ready' ? (
        <CollectionFooter
          shown={view.rows.length}
          total={{ kind: 'exact', value: view.rows.length }}
          noun={counted('forward', stopping)}
          plural={counted('forwards', stopping)}
          data-ports-part="footer"
        />
      ) : null}
      {/* What the tool says aloud (a copy, a stop, a refusal): a region that is in the page before it speaks, and a node in it for each thing said, so that words said twice are read twice. It is read and never drawn. */}
      <div className={styles.live} role="status" aria-live="polite" data-ports-part="live">
        <span key={view.announcement?.id ?? 0}>{view.announcement?.text}</span>
      </div>
    </div>
  );
}
