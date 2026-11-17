// The first guards that can fail a pull request for what a table costs (docs/ui-next/optimisations.md section 10: no benchmark in the
// repository can). Times drift on a shared machine; work counts do not, so each of these is an exact assertion and runs in the kit's
// own test step in CI: elements per row (B4, MNR-T1), elements at rest on 5,025 rows (B3), renders and commits per live update, per
// selection click, per hover and per parent render (B6, MNR-T4, T-06, T-09, T-12), listeners that do not grow with the rows (B6, MNR-T5),
// and no write to the document root (B7, rule 4). They count in jsdom, so they see React's work and the DOM's shape, not pixels; the table
// bench reads the same counts in WebKit and Chromium on real rows.
import { act, fireEvent, render } from '@testing-library/react';
import { Profiler, useState, type ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Icon } from '../Icon';
import { DataTable } from './DataTable';
import type { DataTableColumn, DataTableProps } from './types';

const VIEWPORT = { height: 900 - 25 - 80, width: 1117 };
const isRegion = (element: HTMLElement) => element.getAttribute('role') === 'region';
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
    return isRegion(this) ? VIEWPORT.height : 0; 
  } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
    return isRegion(this) ? VIEWPORT.width : 0; 
  } });
  // jsdom has no canvas; the table measures text with an estimate and says nothing.
  HTMLCanvasElement.prototype.getContext = () => null;
});

type Job = { readonly key: string; readonly name: string; readonly group: string; readonly ready: string; readonly state: string; readonly attempts: number; readonly created: number };

const jobs = (count: number): Job[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `job-${index}`,
    name: `render-${index}-x7q2z`,
    group: `team-${index % 9}`,
    ready: index % 3 === 0 ? '0/1' : '1/1',
    state: index % 3 === 0 ? 'Pending' : 'Running',
    attempts: index % 4,
    created: 1_700_000_000_000 + index * 1000,
  }));

let cellCalls = 0;
// The narrow column set of the first screen: a select column, an identity with a tile, a name, its tail and a second line, a ready count,
// a state with a glyph, a count and an age. Every cell is plain markup: what the table adds is what is counted.
const columns: ReadonlyArray<DataTableColumn<Job>> = [
  {
    id: 'name',
    header: 'Name',
    fit: 'id',
    lead: 36,
    sortKey: (row) => row.name,
    text: (row) => [{ text: row.name }, { text: row.group, font: 'small' }],
    keepEnd: () => 6,
    cell: (row) => {
      cellCalls += 1;
      return (
        <>
          <span data-tile="" />
          <span>{row.name.slice(0, -6)}</span>
          <span>{row.name.slice(-6)}</span>
          <span>{row.group}</span>
        </>
      );
    },
  },
  { id: 'ready', header: 'Ready', fit: 'fixed', width: 59, align: 'end', sortKey: (row) => row.ready, cell: (row) => row.ready },
  {
    id: 'state',
    header: 'State',
    fit: 'fixed',
    width: 157,
    sortKey: (row) => row.state,
    cell: (row) => (
      <>
        <Icon name={row.state === 'Running' ? 'status-success' : 'status-warning'} />
        <span>{row.state}</span>
      </>
    ),
  },
  { id: 'attempts', header: 'Attempts', fit: 'fixed', width: 72, align: 'end', sortKey: (row) => row.attempts, sortKind: 'number', cell: (row) => String(row.attempts) },
  { id: 'age', header: 'Age', fit: 'fixed', width: 59, sortKey: (row) => row.created, sortKind: 'number', cell: (row) => <span>{`${row.attempts}d`}</span> },
];

const getRowKey = (row: Job) => row.key;
const selection = {
  selected: new Set<string>(),
  onToggle: () => undefined,
  label: (row: Job) => `Select ${row.name}`,
};

function Counted({ onCommit, ...props }: { onCommit: () => void } & DataTableProps<Job>): ReactElement {
  return (
    <Profiler id="table" onRender={onCommit}>
      <DataTable {...props} />
    </Profiler>
  );
}

afterEach(() => {
  cellCalls = 0;
});

const mountedRows = (container: HTMLElement) => [...container.querySelectorAll('tbody > tr:not([aria-hidden])')];
const elementsIn = (row: Element) => 1 + row.querySelectorAll('*').length;

describe('elements', () => {
  it('a row has exactly the elements its cells and the table give it, never more than 40 (B4, MNR-T1)', () => {
    const { container } = render(<DataTable label="Jobs" rows={jobs(5025)} getRowKey={getRowKey} columns={columns} selection={selection} lines={2} />);
    const counts = new Set(mountedRows(container).map(elementsIn));
    // tr; select td + input; name td + tile, name, tail, group; ready td; state td + svg with its two paints + word; attempts td; age td + span.
    expect([...counts]).toEqual([1 + 2 + 5 + 1 + 5 + 1 + 2]);
    expect(Math.max(...counts)).toBeLessThanOrEqual(40);
  });

  it('5,025 rows leave at most 3,000 elements in the document, and about as many as 25 rows plus the window (B3)', () => {
    const { container } = render(<DataTable label="Jobs" rows={jobs(5025)} getRowKey={getRowKey} columns={columns} selection={selection} lines={2} />);
    const large = container.querySelectorAll('*').length;
    expect(large).toBeLessThanOrEqual(3000);
    const small = render(<DataTable label="Jobs" rows={jobs(25)} getRowKey={getRowKey} columns={columns} selection={selection} lines={2} />).container.querySelectorAll('*').length;
    // The window is what is mounted: 5,025 rows cost the elements of the rows in view, not of the rows there are.
    expect(large).toBeLessThan(small * 4);
  });
});

describe('renders', () => {
  function Harness({ rows, onCommit }: { rows: Job[]; onCommit: () => void }) {
    const [tick, setTick] = useState(0);
    return (
      <>
        <button type="button" data-testid="parent" onClick={() => {
          setTick(tick + 1); 
        }}>{`parent ${tick}`}</button>
        <Counted onCommit={onCommit} label="Jobs" rows={rows} getRowKey={getRowKey} columns={columns} selection={selection} onRowActivate={() => undefined} lines={2} rowsAreImmutable />
      </>
    );
  }

  const setup = (rows: Job[]) => {
    let commits = 0;
    const onCommit = () => {
      commits += 1;
    };

    const view = render(<Harness rows={rows} onCommit={onCommit} />);
    return {
      view,
      commits: () => commits,
      rerender: (next: Job[]) => {
        view.rerender(<Harness rows={next} onCommit={onCommit} />); 
      },
      settle: () => {
        commits = 0;
        cellCalls = 0;
      },
    };
  };

  // The same rows with one record replaced by a new object, as a live update delivers it.
  function patched(rows: Job[], index: number): Job[] {
    const row = rows.at(index);
    if (row === undefined) {
      throw new Error(`no row ${index}`);
    }

    const next = rows.slice();
    next[index] = { ...row, attempts: 9 };
    return next;
  }

  it('a patch to one record in view renders one row, in one commit (MNR-T4)', () => {
    const rows = jobs(5025);
    const table = setup(rows);
    table.settle();
    table.rerender(patched(rows, 3));
    expect(cellCalls).toBe(1);
    expect(table.commits()).toBe(1);
  });

  it('a patch to a record out of view renders no row', () => {
    const rows = jobs(5025);
    const table = setup(rows);
    table.settle();
    table.rerender(patched(rows, 4000));
    expect(cellCalls).toBe(0);
  });

  it('a render of the parent with the same rows renders no row (T-06, T-09)', () => {
    const rows = jobs(5025);
    const table = setup(rows);
    table.settle();
    fireEvent.click(table.view.getByTestId('parent'));
    expect(cellCalls).toBe(0);
  });

  it('hover commits nothing: it is the pointer\'s, not React\'s (T-12)', () => {
    const table = setup(jobs(5025));
    table.settle();
    const row = table.view.container.querySelector('tbody > tr:not([aria-hidden])')!;
    fireEvent.mouseOver(row);
    fireEvent.mouseEnter(row);
    fireEvent.pointerMove(row);
    expect(table.commits()).toBe(0);
    expect(cellCalls).toBe(0);
  });

  it('a scroll that moves no row boundary commits nothing, not even right after a window change (T-05, B2)', () => {
    const table = setup(jobs(5025));
    table.settle();
    const region = table.view.getByRole('region');
    let offset = 0;
    Object.defineProperty(region, 'scrollTop', { configurable: true, get: () => offset, set: (value: number) => (offset = value) });
    const scrollTo = (top: number) => {
      act(() => {
        offset = top;
        fireEvent.scroll(region);
      });
    };

    // The window moves: a real commit. The scroll handler must not leave one more render behind it: React's eager bail-out of a state
    // update that sets the value it already has holds only on a fiber that has not just rendered, so a handler that sets state on every
    // scroll event costs a render after each commit (the real engine counted two commits for every window change, bench/table/counts.mjs).
    scrollTo(2000);
    table.settle();
    // Inside that window: the next scroll events move no row boundary.
    scrollTo(2012);
    scrollTo(2024);
    scrollTo(2036);
    expect(table.commits()).toBe(0);
  });

  it('a click on a checkbox renders at most two rows in one commit (MNR-T4)', () => {
    const rowsOnce = jobs(5025);
    let commits = 0;
    function Selecting() {
      const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(['job-1']));
      return (
        <Profiler
          id="t"
          onRender={() => {
            commits += 1;
          }}
        >
          <DataTable
            label="Jobs"
            rows={rowsOnce}
            getRowKey={getRowKey}
            columns={columns}
            lines={2}
            selection={{ selected, label: selection.label, onToggle: (row) => {
              setSelected(new Set([row.key])); 
            } }}
          />
        </Profiler>
      );
    }

    const view = render(<Selecting />);
    cellCalls = 0;
    commits = 0;
    fireEvent.click(view.getByRole('checkbox', { name: 'Select render-3-x7q2z' }));
    expect(cellCalls).toBeLessThanOrEqual(2);
    expect(commits).toBeLessThanOrEqual(1);
  });
});

describe('listeners and writes', () => {
  function listenersAdded(rows: number): number {
    const original = EventTarget.prototype.addEventListener;
    let added = 0;
    EventTarget.prototype.addEventListener = function (this: EventTarget, ...args: Parameters<typeof original>) {
      added += 1;
      original.apply(this, args);
    };

    try {
      const view = render(<DataTable label="Jobs" rows={jobs(rows)} getRowKey={getRowKey} columns={columns} selection={selection} onRowActivate={() => undefined} lines={2} />);
      const region = view.getByRole('region');
      act(() => {
        fireEvent.scroll(region);
      });
      view.unmount();
    } finally {
      EventTarget.prototype.addEventListener = original;
    }

    return added;
  }

  it('registers the same number of listeners for 60 rows and for 5,025: one handler for the body, not one for a row (T-07, MNR-T5)', () => {
    expect(listenersAdded(5025)).toBe(listenersAdded(60));
  });

  it('writes nothing to the document root or body while it mounts, scrolls, sorts and selects (B7)', () => {
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    const before = [document.documentElement.getAttribute('style'), document.body.getAttribute('style')];
    function Sorting() {
      const [sort, setSort] = useState<DataTableProps<Job>['sort']>(undefined);
      return <DataTable label="Jobs" rows={jobs(5025)} getRowKey={getRowKey} columns={columns} selection={selection} sort={sort} onSortChange={setSort} lines={2} />;
    }

    const view = render(<Sorting />);
    fireEvent.click(view.getByRole('button', { name: 'Name' }));
    fireEvent.click(view.getByRole('button', { name: 'Name' }));
    fireEvent.scroll(view.getByRole('region'));
    const first = view.getAllByRole('checkbox').at(1);
    if (first === undefined) {
      throw new Error('no row checkbox');
    }

    fireEvent.click(first);
    observer.takeRecords().forEach((record) => records.push(record));
    observer.disconnect();
    expect(records).toEqual([]);
    expect([document.documentElement.getAttribute('style'), document.body.getAttribute('style')]).toEqual(before);
  });
});
