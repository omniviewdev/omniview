// Count work, not time (MNR-T6). The browser probe measures layout and latency against the compiled gallery.
import { DataTable, Icon, MenuHost, menuTrigger, useMenu, type DataTableColumn, type MenuItem } from '@omniviewdev/kit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, useMemo, useState, type ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  // React registers a document listener the first time it creates a root.
  render(<div />).unmount();
});

let popoverRule: HTMLStyleElement;
beforeEach(() => {
  const dimensions = (element: Element, windowSize: number, regionSize: number) =>
    element === document.documentElement ? windowSize : element.getAttribute('role') === 'region' ? regionSize : 0;
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function height(this: Element) {
    return dimensions(this, 900, 360);
  });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function width(this: Element) {
    return dimensions(this, 1440, 800);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // jsdom does not yet implement the browser's :popover-open state.
  popoverRule = document.createElement('style');
  popoverRule.textContent = '[popover] { display: block; }';
  document.head.append(popoverRule);
});

afterEach(() => {
  popoverRule.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Row = { readonly id: string; readonly name: string };
const makeRows = (count: number): readonly Row[] => Array.from({ length: count }, (_, index) => ({ id: String(index), name: `worker-${index}` }));
const getRowKey = (row: Row) => row.id;
const noop = () => undefined;

const triggers = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-ov-menu]'));
const roots = () => document.querySelectorAll('[role="menu"]').length;
const elements = () => document.querySelectorAll('*').length;
const mountedRows = () => document.querySelectorAll('tbody > tr:not([aria-hidden])').length;

function triggerAt(index: number) {
  const trigger = triggers()[index];
  if (trigger === undefined) {
    throw new Error(`No trigger at index ${index}`);
  }

  return trigger;
}

function openAt(index: number) {
  const trigger = triggerAt(index);
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
}

function escape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
}

function RowTrigger({ menu, row }: { readonly menu: string; readonly row: Row }) {
  return <button type="button" aria-label={`Actions for ${row.name}`} {...menuTrigger(menu, row.id)}><Icon name="ellipsis" /></button>;
}

const plainItems: readonly MenuItem[] = [
  { kind: 'action', id: 'inspect', label: 'Inspect', onSelect: noop },
  { kind: 'action', id: 'rerun', label: 'Run again', onSelect: noop },
  { kind: 'action', id: 'copy', label: 'Copy name', onSelect: noop },
  { kind: 'separator', id: 'before-delete' },
  { kind: 'action', id: 'delete', label: 'Delete…', destructive: true, onSelect: noop },
];

function Flat({ count }: { readonly count: number }) {
  const [rows] = useState(() => makeRows(count));
  const menu = useMenu(plainItems);
  return <div>{rows.map((row) => <RowTrigger key={row.id} menu={menu} row={row} />)}</div>;
}

type TableProps = {
  readonly rows: readonly Row[];
  readonly onCell?: (() => void) | undefined;
  readonly onCommit?: (() => void) | undefined;
  readonly onSelect?: ((row: Row) => void) | undefined;
  readonly onRowActivate?: ((row: Row) => void) | undefined;
};

function Table({ rows, onCell, onCommit = noop, onSelect, onRowActivate }: TableProps) {
  const menu = useMenu((key) => {
    const row = key === undefined ? undefined : rows[Number(key)];
    if (row === undefined) {
      return null;
    }

    return [...plainItems, {
      kind: 'action', id: 'focus', label: 'Focus row',
      onSelect: () => {
        onSelect?.(row);
      },
    }];
  });
  const columns = useMemo<ReadonlyArray<DataTableColumn<Row>>>(() => [
    {
      id: 'name', header: 'Name', fit: 'flex', text: (row) => row.name,
      cell: (row) => {
        onCell?.();
        return row.name;
      },
    },
    { id: 'actions', header: 'Actions', fit: 'fixed', width: 48, cell: (row) => <RowTrigger menu={menu} row={row} /> },
  ], [menu, onCell]);
  return (
    <Profiler id="table" onRender={onCommit}>
      <DataTable label="Workloads" rows={rows} getRowKey={getRowKey} columns={columns} onRowActivate={onRowActivate} rowsAreImmutable />
    </Profiler>
  );
}

function renderWithHost(children: ReactElement) {
  return render(<MenuHost>{children}</MenuHost>);
}

function trackListeners() {
  const prototypeAdd = EventTarget.prototype.addEventListener;
  const prototypeRemove = EventTarget.prototype.removeEventListener;
  const windowAdd = window.addEventListener;
  const windowRemove = window.removeEventListener;
  const ids = new WeakMap<EventListenerOrEventListenerObject, number>();
  const live = new Set<string>();
  let next = 0;
  let added = 0;
  function key(target: 'window' | 'document', type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    let id = ids.get(listener);
    if (id === undefined) {
      id = ++next;
      ids.set(listener, id);
    }

    const capture = typeof options === 'boolean' ? options : options?.capture === true;
    return `${target}:${type}:${String(capture)}:${id}`;
  }

  EventTarget.prototype.addEventListener = function add(this: EventTarget, type, listener, options) {
    added += 1;
    if (this === document && listener !== null) {
      live.add(key('document', type, listener, options));
    }

    prototypeAdd.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function remove(this: EventTarget, type, listener, options) {
    if (this === document && listener !== null) {
      live.delete(key('document', type, listener, options));
    }

    prototypeRemove.call(this, type, listener, options);
  };

  window.addEventListener = function add(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    added += 1;
    live.add(key('window', type, listener, options));
    windowAdd.call(window, type, listener, options);
  } as typeof window.addEventListener;
  window.removeEventListener = function remove(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    live.delete(key('window', type, listener, options));
    windowRemove.call(window, type, listener, options);
  } as typeof window.removeEventListener;
  return {
    live: () => [...live].sort(),
    added: () => added,
    stop: () => {
      EventTarget.prototype.addEventListener = prototypeAdd;
      EventTarget.prototype.removeEventListener = prototypeRemove;
      window.addEventListener = windowAdd;
      window.removeEventListener = windowRemove;
    },
  };
}

function countAdds(child: ReactElement) {
  const tracking = trackListeners();
  try {
    renderWithHost(child).unmount();
    return tracking.added();
  } finally {
    tracking.stop();
  }
}

describe('delegated row menu work', () => {
  it.each([25, 60, 20_000])('mounts one three-element trigger per visible row and only mounts the popup when open (%i rows)', (count) => {
    renderWithHost(<Table rows={makeRows(count)} />);
    const all = triggers();
    const before = elements();
    expect(all).toHaveLength(mountedRows());
    expect(all.length).toBeGreaterThan(10);
    expect(all.length).toBeLessThan(60);
    expect(new Set(all.map((trigger) => trigger.querySelectorAll('*').length))).toEqual(new Set([2]));
    expect(roots()).toBe(0);
    openAt(0);
    expect(roots()).toBe(1);
    const popup = screen.getByRole('menu');
    expect(popup.parentElement?.hasAttribute('data-ov-menu-portal')).toBe(true);
    expect(elements() - before).toBe(2 + popup.querySelectorAll('*').length);
    expect(elements() - before).toBe(14); // One portal, popup, body, five buttons with labels, separator.
    expect(popup.querySelectorAll('[role="menuitem"]')).toHaveLength(5);
    expect(popup.querySelectorAll('[role="separator"]')).toHaveLength(1);
    escape();
    expect(roots()).toBe(0);
    expect(elements()).toBe(before);
  });

  it('uses the same listeners with 0, 1, 60 or 5,025 mounted triggers', () => {
    const baseline = countAdds(<Flat count={0} />);
    expect(baseline).toBeGreaterThan(0);
    for (const count of [1, 60, 5025]) {
      expect(countAdds(<Flat count={count} />)).toBe(baseline);
    }

    expect(countAdds(<Table rows={makeRows(20_000)} />)).toBe(countAdds(<Table rows={makeRows(60)} />));
  });

  it('opens one popup from the first, middle and last of 5,025 mounted triggers', () => {
    renderWithHost(<Flat count={5025} />);
    expect(triggers()).toHaveLength(5025);
    for (const index of [0, 2512, 5024]) {
      openAt(index);
      expect(roots()).toBe(1);
      expect(triggerAt(index).getAttribute('aria-controls')).toBe(screen.getByRole('menu').id);
      escape();
      expect(roots()).toBe(0);
    }
  });

  it('switches between row registrations without stacking popups', () => {
    renderWithHost(<><Table rows={makeRows(30)} /><Table rows={makeRows(30)} /></>);
    const first = triggerAt(0);
    const other = triggers().find((trigger) => trigger.closest('table') !== first.closest('table'));
    if (other === undefined) {
      throw new Error('No trigger in second table');
    }

    fireEvent.click(first, { detail: 1 });
    expect(roots()).toBe(1);
    fireEvent.pointerDown(other);
    fireEvent.click(other, { detail: 1 });
    expect(roots()).toBe(1);
    expect(first.hasAttribute('aria-controls')).toBe(false);
    expect(other.getAttribute('aria-controls')).toBe(screen.getByRole('menu').id);
  });

  it('holds a fixed set of open-only listeners and one observer, and cleans up on every close path', () => {
    const Native = MutationObserver;
    let created = 0;
    let disconnected = 0;
    vi.stubGlobal('MutationObserver', class Counting extends Native {
      constructor(callback: MutationCallback) {
        super(callback);
        created += 1;
      }

      override disconnect() {
        disconnected += 1;
        super.disconnect();
      }
    });
    const tracking = trackListeners();
    try {
      const view = renderWithHost(<Table rows={makeRows(20_000)} />);
      const idle = tracking.live();
      expect(created).toBe(0);
      const close = [
        escape,
        () => {
          fireEvent.click(screen.getByRole('menuitem', { name: 'Inspect' }), { detail: 1 });
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
      ];
      for (const [index, dismiss] of close.entries()) {
        openAt(index);
        expect(tracking.live().filter((entry) => !idle.includes(entry)).map((entry) => entry.slice(0, entry.lastIndexOf(':')))).toEqual([
          'document:focusin:false', 'window:pointerdown:true', 'window:resize:false', 'window:scroll:true',
        ]);
        expect(created).toBe(index + 1);
        expect(disconnected).toBe(index);
        dismiss();
        expect(roots()).toBe(0);
        expect(tracking.live()).toEqual(idle);
        expect(disconnected).toBe(created);
      }

      openAt(0);
      expect(roots()).toBe(1);
      view.unmount();
      expect(roots()).toBe(0);
      expect(tracking.live()).toEqual([]);
      expect(disconnected).toBe(created);
    } finally {
      tracking.stop();
    }
  });

  it('starts no timer or animation frame for plain actions', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const interval = vi.spyOn(globalThis, 'setInterval');
    const frame = vi.spyOn(globalThis, 'requestAnimationFrame');
    const timers = [timeout, interval, frame];
    const before = timers.map((timer) => timer.mock.calls.length);
    const view = renderWithHost(<Flat count={5025} />);
    openAt(100);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowDown' });
    fireEvent.pointerMove(screen.getByRole('menuitem', { name: 'Copy name' }));
    escape();
    view.unmount();
    expect(timers.map((timer) => timer.mock.calls.length)).toEqual(before);
  });

  it('does not commit or render any row when a menu opens, navigates, closes or selects', () => {
    const onCell = vi.fn();
    const onCommit = vi.fn();
    const onSelect = vi.fn();
    const onRowActivate = vi.fn();
    renderWithHost(<Table rows={makeRows(20_000)} onCell={onCell} onCommit={onCommit} onSelect={onSelect} onRowActivate={onRowActivate} />);
    onCell.mockClear();
    onCommit.mockClear();
    openAt(3);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'End' });
    escape();
    const button = triggerAt(3);
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Focus row' }), { detail: 1 });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith({ id: '3', name: 'worker-3' });
    expect(onCell).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onRowActivate).not.toHaveBeenCalled();
    const cell = button.closest('tr')?.querySelector('td');
    if (cell === null || cell === undefined) {
      throw new Error('No workload cell');
    }

    fireEvent.click(cell);
    expect(onRowActivate).toHaveBeenCalledOnce();
  });

  it('keeps row work unchanged when an in-view or offscreen record changes', () => {
    const onCell = vi.fn();
    let rows = makeRows(20_000);
    const view = renderWithHost(<Table rows={rows} onCell={onCell} />);
    const patch = (index: number) => {
      const updated = rows.slice();
      updated[index] = { id: String(index), name: 'changed' };
      rows = updated;
      view.rerender(<MenuHost><Table rows={rows} onCell={onCell} /></MenuHost>);
    };

    onCell.mockClear();
    patch(3);
    expect(onCell).toHaveBeenCalledOnce();
    onCell.mockClear();
    patch(19_000);
    expect(onCell).not.toHaveBeenCalled();
    view.rerender(<MenuHost><Table rows={rows} onCell={onCell} /></MenuHost>);
    expect(onCell).not.toHaveBeenCalled();
  });

  it('never changes root element styles while the menu opens, moves or closes', () => {
    renderWithHost(<Flat count={2} />);
    const observer = new MutationObserver(noop);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    openAt(0);
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowDown' });
    });
    escape();
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
  });
});
