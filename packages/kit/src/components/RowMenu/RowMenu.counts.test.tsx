// The guards that can fail a pull request for what a table's action menu costs (docs/ui-next/optimisations.md T-08 and MNR-T6; section 1.4,
// G-T2: work counts, not times). One popup owner per table: 0 popup roots while closed, exactly 1 while open, however many rows or triggers
// there are; a trigger that adds no listener, no timer and no state of its own; a bounded and constant number of document and window
// listeners while a menu is open and none after; and opening and closing a menu renders no row of the table. Each count is an exact
// assertion in the style of DataTable.counts.test.tsx. They count in jsdom (React's work and the DOM's shape, not pixels); the probe reads
// the same counts in WebKit and Chromium on the 5,000-row example (probes/row-menu-probe.mjs).
import { DataTable, RowMenu, RowMenuTrigger, createRowMenu, type DataTableColumn, type RowMenuHandle, type RowMenuItem } from '@omniviewdev/kit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, useMemo, useState, type ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const VIEWPORT = { height: 900 - 25 - 80, width: 1117 };
const WINDOW = { height: 900, width: 1440 };
const isRegion = (element: HTMLElement) => element.getAttribute('role') === 'region';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
    return this === document.documentElement ? WINDOW.height : isRegion(this) ? VIEWPORT.height : 0;
  } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
    return this === document.documentElement ? WINDOW.width : isRegion(this) ? VIEWPORT.width : 0;
  } });
  // jsdom has no canvas; the table measures text with an estimate and says nothing.
  HTMLCanvasElement.prototype.getContext = () => null;
  // React adds one listener to the document for the first root it makes there: make it before any count is taken.
  render(<div />).unmount();
});

let errors: MockInstance<Console['error']>;
let popoverRule: HTMLStyleElement;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // jsdom's default stylesheet hides every popover that is not `:popover-open`, a state it cannot match, so nothing in one could be focused
  // or found by role. A browser shows the popover once showPopover has run: this is the same rule, in the page.
  popoverRule = document.createElement('style');
  popoverRule.textContent = '[popover] { display: block; }';
  document.head.append(popoverRule);
});

afterEach(() => {
  expect(errors.mock.calls).toEqual([]);
  popoverRule.remove();
  cellCalls = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Job = { readonly key: string; readonly name: string; readonly state: string };

const jobs = (count: number): Job[] =>
  Array.from({ length: count }, (_, index) => ({ key: `job-${index}`, name: `render-${index}-x7q2z`, state: index % 3 === 0 ? 'Pending' : 'Running' }));

const getRowKey = (row: Job) => row.key;
let cellCalls = 0;

/** The narrow table of the first screen, with the menu's column last: a trigger in every row. Built once per handle, so its identity holds. */
const columnsFor = (handle: RowMenuHandle<Job>): ReadonlyArray<DataTableColumn<Job>> => [
  {
    id: 'name',
    header: 'Name',
    fit: 'flex',
    text: (row) => row.name,
    cell: (row) => {
      cellCalls += 1;
      return row.name;
    },
  },
  { id: 'state', header: 'State', fit: 'fixed', width: 96, cell: (row) => row.state },
  {
    id: 'actions',
    header: 'Actions',
    fit: 'fixed',
    width: 48,
    cell: (row) => <RowMenuTrigger handle={handle} row={row} label={`Actions for ${row.name}`} />,
  },
];

const selected: string[] = [];
const items = (): ReadonlyArray<RowMenuItem<Job>> => [
  { id: 'inspect', label: 'Inspect', onSelect: (row) => {
    selected.push(`inspect ${row.key}`);
  } },
  { id: 'rerun', label: 'Run again', onSelect: (row) => {
    selected.push(`rerun ${row.key}`);
  } },
  { id: 'copy', label: 'Copy name', onSelect: (row) => {
    selected.push(`copy ${row.key}`);
  } },
  { id: 'delete', label: 'Delete\u2026', destructive: true, separatorBefore: true, onSelect: (row) => {
    selected.push(`delete ${row.key}`);
  } },
];
// root + four items + one separator
const POPUP_ELEMENTS = 6;

type PageProps = { readonly handle: RowMenuHandle<Job>; readonly rows: readonly Job[]; readonly onCommit?: () => void; readonly onRowActivate?: (row: Job) => void };

/** A DataTable of `rows` with the trigger column, and the table's one menu beside it. */
function Page({ handle, rows, onCommit = () => undefined, onRowActivate }: PageProps): ReactElement {
  const columns = useMemo(() => columnsFor(handle), [handle]);
  return (
    <>
      <Profiler id="table" onRender={onCommit}>
        <DataTable label="Jobs" rows={rows} getRowKey={getRowKey} columns={columns} onRowActivate={onRowActivate} rowsAreImmutable />
      </Profiler>
      <RowMenu handle={handle} label="Job actions" items={items} />
    </>
  );
}

/** `count` triggers in a plain list, not a table: nothing is windowed, every trigger is in the document. */
function Flat({ handle, count }: { readonly handle: RowMenuHandle<Job>; readonly count: number }): ReactElement {
  const rows = useMemo(() => jobs(count), [count]);
  return (
    <div role="region" aria-label="Jobs" tabIndex={0}>
      {rows.map((row) => (
        <RowMenuTrigger key={row.key} handle={handle} row={row} label={`Actions for ${row.name}`} />
      ))}
      <RowMenu handle={handle} label="Job actions" items={items} />
    </div>
  );
}

const roots = () => document.querySelectorAll('[role="menu"]').length;
const triggers = () => screen.queryAllByRole('button', { name: /^Actions for / });
const mountedRows = () => document.querySelectorAll('tbody > tr:not([aria-hidden])').length;
const elementsInDocument = () => document.querySelectorAll('*').length;
const defined = <T,>(value: T | null | undefined, what: string): T => {
  if (value === undefined || value === null) {
    throw new Error(`no ${what}`);
  }

  return value;
};

const openWithKey = (button: Element) => {
  fireEvent.keyDown(button, { key: 'ArrowDown' });
};

const closeWithEscape = () => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
};

// ---------------------------------------------------------------------------------------------------------------------------------
// What the document and the window hold: every listener added and not yet removed on either, and every observer made and not yet disconnected.
// The test window keeps its own bound methods, so they are replaced on the window itself; everything else goes through EventTarget.prototype.
function trackListeners() {
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const windowAdd = window.addEventListener;
  const windowRemove = window.removeEventListener;
  const ids = new WeakMap<EventListenerOrEventListenerObject, number>();
  const live = new Set<string>();
  let next = 0;
  let added = 0;
  const key = (name: string, type: string, listener: EventListenerOrEventListenerObject, options: unknown) => {
    let id = ids.get(listener);
    if (id === undefined) {
      next += 1;
      id = next;
      ids.set(listener, id);
    }

    const capture = typeof options === 'boolean' ? options : (options as { capture?: boolean } | undefined)?.capture === true;
    return `${name}:${type}:${String(capture)}:${id}`;
  };

  EventTarget.prototype.addEventListener = function patched(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    added += 1;
    const entry = this === document ? key('document', type, listener, options) : undefined;
    if (entry !== undefined) {
      live.add(entry);
    }

    add.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function patched(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    const entry = this === document ? key('document', type, listener, options) : undefined;
    if (entry !== undefined) {
      live.delete(entry);
    }

    remove.call(this, type, listener, options);
  };

  window.addEventListener = function patched(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    added += 1;
    const entry = key('window', type, listener, options);
    if (entry !== undefined) {
      live.add(entry);
    }

    windowAdd.call(window, type, listener, options);
  } as typeof window.addEventListener;

  window.removeEventListener = function patched(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    const entry = key('window', type, listener, options);
    if (entry !== undefined) {
      live.delete(entry);
    }

    windowRemove.call(window, type, listener, options);
  } as typeof window.removeEventListener;

  return {
    /** The listeners of the document and the window that are in force, as `target:type:capture`, sorted. */
    live: () => [...live].map((entry) => entry.split(':').slice(0, 3).join(':')).sort(),
    /** Every addEventListener call on any target since tracking began. */
    added: () => added,
    stop: () => {
      EventTarget.prototype.addEventListener = add;
      EventTarget.prototype.removeEventListener = remove;
      window.addEventListener = windowAdd;
      window.removeEventListener = windowRemove;
    },
  };
}

function countObservers() {
  const created: MutationObserver[] = [];
  const disconnected: MutationObserver[] = [];
  const Real = MutationObserver;
  class Counting extends Real {
    constructor(callback: MutationCallback) {
      super(callback);
      created.push(this);
    }

    override disconnect() {
      disconnected.push(this);
      super.disconnect();
    }
  }

  vi.stubGlobal('MutationObserver', Counting);
  return { created, disconnected };
}

describe('popup roots', () => {
  it('has 0 while closed and exactly 1 while open, with 25, 60 and 5,025 rows (MNR-T6: one popup owner per table)', () => {
    for (const count of [25, 60, 5025]) {
      const handle = createRowMenu<Job>();
      const view = render(<Page handle={handle} rows={jobs(count)} />);
      expect(roots(), `${count} rows, closed`).toBe(0);
      openWithKey(defined(triggers()[0], 'trigger'));
      expect(roots(), `${count} rows, open`).toBe(1);
      closeWithEscape();
      expect(roots(), `${count} rows, closed again`).toBe(0);
      view.unmount();
    }
  });

  it('has exactly 1 with 5,025 triggers in the document, opened from the first, the middle and the last', () => {
    const handle = createRowMenu<Job>();
    render(<Flat handle={handle} count={5025} />);
    expect(triggers()).toHaveLength(5025);
    expect(roots()).toBe(0);
    for (const index of [0, 2512, 5024]) {
      openWithKey(defined(triggers()[index], `trigger ${index}`));
      expect(roots(), `from trigger ${index}`).toBe(1);
      closeWithEscape();
      expect(roots(), `after trigger ${index}`).toBe(0);
    }
  });

  it('has 1 for each table when a page holds two, and an open menu closes when the other table\'s trigger is pressed', () => {
    const one = createRowMenu<Job>();
    const two = createRowMenu<Job>();
    render(
      <>
        <Page handle={one} rows={jobs(30)} />
        <Page handle={two} rows={jobs(30)} />
      </>,
    );
    const [first, ...rest] = triggers();
    openWithKey(defined(first, 'first table trigger'));
    expect(roots()).toBe(1);
    const other = defined(rest.find((button) => !(first?.closest('[role="region"]')?.contains(button) ?? false)), 'second table trigger');
    fireEvent.pointerDown(other);
    expect(roots()).toBe(0);
    openWithKey(other);
    expect(roots()).toBe(1);
  });
});

describe('elements', () => {
  it('is one button, one svg and one path for a trigger: 3 elements, however many rows', () => {
    const handle = createRowMenu<Job>();
    render(<Page handle={handle} rows={jobs(5025)} />);
    const all = triggers();
    expect(all.length).toBeGreaterThan(10);
    expect(new Set(all.map((button) => 1 + button.querySelectorAll('*').length))).toEqual(new Set([3]));
  });

  it('puts as many triggers in the document as rows are mounted, not as rows there are', () => {
    const handle = createRowMenu<Job>();
    render(<Page handle={handle} rows={jobs(5025)} />);
    expect(triggers()).toHaveLength(mountedRows());
    expect(triggers().length).toBeLessThan(60);
  });

  it('adds the popup\'s own elements and no others when it opens, 6 for these items, with 25 rows and with 5,025', () => {
    for (const count of [25, 5025]) {
      const handle = createRowMenu<Job>();
      const view = render(<Page handle={handle} rows={jobs(count)} />);
      const before = elementsInDocument();
      openWithKey(defined(triggers()[0], 'trigger'));
      expect(elementsInDocument() - before, `${count} rows`).toBe(POPUP_ELEMENTS);
      expect(defined(document.querySelector('[role="menu"]'), 'popup').querySelectorAll('*')).toHaveLength(POPUP_ELEMENTS - 1);
      closeWithEscape();
      expect(elementsInDocument(), `${count} rows, closed again`).toBe(before);
      view.unmount();
    }
  });
});

describe('listeners', () => {
  function listenersAdded(count: number): number {
    const tracking = trackListeners();
    try {
      const handle = createRowMenu<Job>();
      const view = render(<Flat handle={handle} count={count} />);
      view.unmount();
      return tracking.added();
    } finally {
      tracking.stop();
    }
  }

  it('registers the same number of listeners for 0, 1, 60 and 5,025 triggers: a trigger adds none of its own, React\'s root delegation serves them all (MNR-T6, plan K9)', () => {
    const none = listenersAdded(0);
    expect(none).toBeGreaterThan(0);
    expect(listenersAdded(1)).toBe(none);
    expect(listenersAdded(60)).toBe(none);
    expect(listenersAdded(5025)).toBe(none);
  });

  it('registers the same number of listeners for a table of 60 rows and a table of 5,025 with a trigger in each', () => {
    const added = (count: number) => {
      const tracking = trackListeners();
      try {
        const view = render(<Page handle={createRowMenu<Job>()} rows={jobs(count)} />);
        act(() => {
          fireEvent.scroll(screen.getByRole('region', { name: 'Jobs' }));
        });
        view.unmount();
        return tracking.added();
      } finally {
        tracking.stop();
      }
    };

    expect(added(5025)).toBe(added(60));
  });

  it('holds none of its own while closed, exactly 3 on the window (a press, a scroll, a resize) while open, and none after it closes; 60 or 5,025 rows alike', () => {
    for (const count of [60, 5025]) {
      const tracking = trackListeners();
      try {
        const handle = createRowMenu<Job>();
        const view = render(<Page handle={handle} rows={jobs(count)} />);
        const rest = tracking.live();
        openWithKey(defined(triggers()[0], 'trigger'));
        const open = tracking.live();
        expect(open).toHaveLength(rest.length + 3);
        expect(open.filter((entry) => !rest.includes(entry))).toEqual(['window:pointerdown:true', 'window:resize:false', 'window:scroll:true']);
        closeWithEscape();
        expect(tracking.live(), `${count} rows`).toEqual(rest);
        // Opened and closed again, ten times: the balance holds.
        for (let cycle = 0; cycle < 10; cycle += 1) {
          openWithKey(defined(triggers()[cycle], 'trigger'));
          expect(tracking.live()).toHaveLength(rest.length + 3);
          closeWithEscape();
        }

        expect(tracking.live()).toEqual(rest);
        view.unmount();
      } finally {
        tracking.stop();
      }
    }
  });

  it('removes them when the menu is closed by anything: a selection, a press outside, a scroll, a resize, the part going away', () => {
    const tracking = trackListeners();
    try {
      const handle = createRowMenu<Job>();
      const view = render(<Page handle={handle} rows={jobs(60)} />);
      const rest = tracking.live();
      const reasons: Array<() => void> = [
        () => {
          fireEvent.click(screen.getByRole('menuitem', { name: 'Inspect' }), { detail: 0 });
        },
        () => {
          fireEvent.pointerDown(document.body);
        },
        () => {
          fireEvent.scroll(window);
        },
        () => {
          fireEvent(window, new Event('resize'));
        },
        () => {
          view.unmount();
        },
      ];
      for (const reason of reasons) {
        const button = triggers()[0];
        if (button === undefined) {
          // The part went away with the previous reason; the handle must hold nothing either.
          break;
        }

        openWithKey(button);
        expect(tracking.live()).toHaveLength(rest.length + 3);
        act(() => {
          reason();
        });
        expect(tracking.live()).toEqual(rest);
      }
    } finally {
      tracking.stop();
    }
  });

  it('creates one MutationObserver for each opening, only while open, and disconnects it on close', () => {
    const observers = countObservers();
    const handle = createRowMenu<Job>();
    render(<Page handle={handle} rows={jobs(5025)} />);
    expect(observers.created).toHaveLength(0);
    for (let cycle = 1; cycle <= 5; cycle += 1) {
      openWithKey(defined(triggers()[cycle], 'trigger'));
      expect(observers.created).toHaveLength(cycle);
      expect(observers.disconnected).toHaveLength(cycle - 1);
      closeWithEscape();
      expect(observers.disconnected).toHaveLength(cycle);
    }

    expect(observers.disconnected).toEqual(observers.created);
  });

  it('starts no timer and no animation frame: 5,025 triggers, opening, moving and closing cost none', () => {
    const calls = () => ({
      timeout: vi.spyOn(globalThis, 'setTimeout'),
      interval: vi.spyOn(globalThis, 'setInterval'),
      frame: vi.spyOn(globalThis, 'requestAnimationFrame'),
    });
    const spies = calls();
    const handle = createRowMenu<Job>();
    const view = render(<Flat handle={handle} count={5025} />);
    const afterRender = [spies.timeout.mock.calls.length, spies.interval.mock.calls.length, spies.frame.mock.calls.length];
    openWithKey(defined(triggers()[100], 'trigger'));
    fireEvent.keyDown(defined(document.activeElement, 'focus'), { key: 'ArrowDown' });
    fireEvent.pointerMove(screen.getByRole('menuitem', { name: 'Copy name' }));
    closeWithEscape();
    view.unmount();
    expect([spies.timeout.mock.calls.length, spies.interval.mock.calls.length, spies.frame.mock.calls.length]).toEqual(afterRender);
  });
});

describe('renders', () => {
  const setup = (count = 5025) => {
    const handle = createRowMenu<Job>();
    const rows = jobs(count);
    let commits = 0;
    const onCommit = () => {
      commits += 1;
    };

    const onRowActivate = vi.fn();
    const view = render(<Page handle={handle} rows={rows} onCommit={onCommit} onRowActivate={onRowActivate} />);
    cellCalls = 0;
    commits = 0;
    return { handle, rows, view, onRowActivate, commits: () => commits };
  };

  it('renders no row and commits nothing in the table when a menu opens, moves, selects and closes (MNR-T6: no per-row menu state)', () => {
    const table = setup();
    const button = defined(triggers()[3], 'trigger');
    openWithKey(button);
    fireEvent.keyDown(defined(document.activeElement, 'focus'), { key: 'ArrowDown' });
    fireEvent.keyDown(defined(document.activeElement, 'focus'), { key: 'End' });
    closeWithEscape();
    expect(cellCalls).toBe(0);
    expect(table.commits()).toBe(0);
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Run again' }), { detail: 1 });
    expect(selected.at(-1)).toBe('rerun job-3');
    expect(cellCalls).toBe(0);
    expect(table.commits()).toBe(0);
    fireEvent.click(button, { detail: 1 });
    fireEvent.pointerDown(document.body);
    expect(roots()).toBe(0);
    expect(cellCalls).toBe(0);
    expect(table.commits()).toBe(0);
  });

  it('does not activate the row when its trigger is pressed, and does when a cell beside it is (the control)', () => {
    const table = setup();
    const row = defined(document.querySelector('tbody > tr:not([aria-hidden])'), 'row');
    fireEvent.click(defined(row.querySelector('button'), 'trigger in the row'), { detail: 1 });
    expect(roots()).toBe(1);
    expect(table.onRowActivate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inspect' }), { detail: 1 });
    expect(table.onRowActivate).not.toHaveBeenCalled();
    fireEvent.click(defined(row.querySelector('td'), 'cell'), { detail: 1 });
    expect(table.onRowActivate).toHaveBeenCalledTimes(1);
  });

  it('keeps the table\'s own counts with the trigger column: a patch to one record in view renders one row, one out of view none', () => {
    const handle = createRowMenu<Job>();
    let current = jobs(5025);
    const commits = { count: 0 };
    const onCommit = () => {
      commits.count += 1;
    };

    const view = render(<Page handle={handle} rows={current} onCommit={onCommit} />);
    // The same rows with one record replaced by a new object, as a live update delivers it.
    const patched = (index: number) => {
      const next = current.slice();
      next[index] = { ...defined(current[index], `row ${index}`), state: 'Failed' };
      current = next;
      return next;
    };

    cellCalls = 0;
    commits.count = 0;
    view.rerender(<Page handle={handle} rows={patched(3)} onCommit={onCommit} />);
    expect(cellCalls).toBe(1);
    expect(commits.count).toBe(1);
    cellCalls = 0;
    view.rerender(<Page handle={handle} rows={patched(4000)} onCommit={onCommit} />);
    expect(cellCalls).toBe(0);
  });

  it('renders no row when the page that holds the table renders again with the same rows', () => {
    const handle = createRowMenu<Job>();
    const rows = jobs(5025);
    function Parent(): ReactElement {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" data-testid="parent" onClick={() => {
            setTick(tick + 1);
          }}>{`parent ${tick}`}</button>
          <Page handle={handle} rows={rows} />
        </>
      );
    }

    render(<Parent />);
    cellCalls = 0;
    fireEvent.click(screen.getByTestId('parent'));
    expect(cellCalls).toBe(0);
  });
});

describe('writes', () => {
  it('writes nothing to the document root or body while a menu opens, moves and closes (B7, rule 4)', () => {
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    const before = [document.documentElement.getAttribute('style'), document.body.getAttribute('style')];
    const handle = createRowMenu<Job>();
    render(<Page handle={handle} rows={jobs(5025)} />);
    openWithKey(defined(triggers()[0], 'trigger'));
    fireEvent.keyDown(defined(document.activeElement, 'focus'), { key: 'ArrowDown' });
    closeWithEscape();
    openWithKey(defined(triggers()[1], 'trigger'));
    fireEvent.pointerDown(document.body);
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(records).toEqual([]);
    expect([document.documentElement.getAttribute('style'), document.body.getAttribute('style')]).toEqual(before);
    expect([...document.documentElement.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});
