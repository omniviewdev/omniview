// The log view as a person and a profiler meet it (design 16 S120; docs/ui-next/optimisations.md HLT-1 to HLT-12, HLT-18, MNR-L1 to L6). jsdom has no layout: the
// geometry the list reads (its height, its header, the probe's row height) is stubbed on the elements that report it, and time is the test's. What is
// asserted is what is mounted, how often React commits, which rows the DOM changed in (a row that was not drawn again has no mutation, and the memo
// boundary itself is LogRow.test.tsx), what the roles and names say, and what the keys do.
import { act, fireEvent, render, within, type RenderResult } from '@testing-library/react';
import { Profiler, useLayoutEffect, type ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogTimestamps } from '../../log/types';
import { LogView } from './LogView';
import { SyntheticFeed } from './syntheticFeed';

const LIST = { height: 625, header: 25, row: 24 };
const VIEWPORT_ROWS = Math.ceil((LIST.height - LIST.header) / LIST.row);

const isList = (element: Element) => element.getAttribute('role') === 'grid';
const isProbe = (element: Element) => element.getAttribute('aria-hidden') === 'true' && element.parentElement !== null && isList(element.parentElement);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
    return isList(this) ? LIST.height : 0;
  } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: function get(this: HTMLElement) {
    return this.getAttribute('aria-rowindex') === '1' ? LIST.header : 0;
  } });
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const height = isProbe(this) ? LIST.row : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height, toJSON: () => ({}) };
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const frame = (count = 1) => {
  act(() => {
    vi.advanceTimersByTime(16 * count);
  });
};

/** A change the feed makes, and the frames that follow it: React work started outside `act` is not flushed by one. */
const run = (change: () => void, frames = 1) => {
  act(() => {
    change();
    vi.advanceTimersByTime(16 * frames);
  });
};

/**
 * The `data-n` of every row a mutation record touched: the row it happened in (`target`), and the rows it added or removed. React replaces a row by editing
 * the window's children, so the record's target is the window, which is in no row: the rows that came and went are read from the nodes themselves, with the
 * rows inside them (a node that holds rows), as well as the row a node sits in.
 */
function addRowsOf(records: readonly MutationRecord[], changed: Set<string>): void {
  const note = (element: Element | null) => {
    const n = element?.closest('[data-n]')?.getAttribute('data-n');
    if (n != null) {
      changed.add(n);
    }
  };

  const noteNode = (node: Node) => {
    if (node instanceof Element) {
      note(node);
      node.querySelectorAll('[data-n]').forEach(note);
    }
  };

  for (const record of records) {
    note(record.target instanceof Element ? record.target : record.target.parentElement);
    record.addedNodes.forEach(noteNode);
    record.removedNodes.forEach(noteNode);
  }
}

/** Which rows' DOM changed while `work` ran: the `data-n` of every row with a mutation in it, one that was replaced, added or removed included. */
function mutatedRows(view: RenderResult, work: () => void): Set<string> {
  const changed = new Set<string>();
  const observer = new MutationObserver((records) => {
    addRowsOf(records, changed);
  });
  observer.observe(view.container, { subtree: true, childList: true, attributes: true, characterData: true });
  work();
  addRowsOf(observer.takeRecords(), changed);
  observer.disconnect();
  return changed;
}

describe('the mutation helper', () => {
  // The window holds its rows as children: when React replaces a row, the record targets the window, not the row, so a helper that reads only the target
  // sees nothing and every test that says "no row was touched" passes whatever the list does.
  const holder = () => render(<div data-testid="window"><div role="row" data-n="1"><span>one</span></div><div role="row" data-n="2"><span>two</span></div></div>);

  it('sees a row that was replaced, added or removed, which the window container (the record target) hides', () => {
    const view = holder();
    const window = view.getByTestId('window');
    const replaced = mutatedRows(view, () => {
      const next = document.createElement('div');
      next.setAttribute('data-n', '2');
      window.lastElementChild?.replaceWith(next);
    });
    expect([...replaced]).toEqual(['2']);

    const grown = mutatedRows(view, () => {
      const wrapper = document.createElement('div');
      const added = document.createElement('div');
      added.setAttribute('data-n', '3');
      wrapper.append(added);
      window.append(wrapper);
    });
    expect([...grown]).toEqual(['3']);

    const shrunk = mutatedRows(view, () => {
      window.firstElementChild?.remove();
    });
    expect([...shrunk]).toEqual(['1']);
  });

  it('names the row of a change inside a row, and nothing for a change outside every row', () => {
    const view = holder();
    const window = view.getByTestId('window');
    expect([...mutatedRows(view, () => {
      window.querySelector('span')!.textContent = 'uno';
    })]).toEqual(['1']);
    expect(mutatedRows(view, () => {
      window.setAttribute('data-x', '1');
    }).size).toBe(0);
  });
});

/**
 * The list's scroll offset and height are the test's: the element reports them, and a scroll event says they moved. With `clamp` the offset is held inside the content, as a
 * browser holds it (a write past the end lands at the end, and a write to where the list already is moves nothing and queues no scroll event).
 */
function stubScroll(list: HTMLElement, options: { readonly clamp?: boolean | undefined } = {}) {
  let top = 0;
  let height = 0;
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = options.clamp === true ? Math.min(Math.max(0, value), Math.max(0, height - LIST.height)) : value;
    },
  });
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => height });
  return {
    /** The content's height, as the browser would lay it out. */
    setContent: (value: number) => {
      height = value;
    },
    scrollTo: (value: number) => {
      act(() => {
        top = value;
        fireEvent.scroll(list);
      });
    },
    top: () => top,
  };
}

function mount(options: { feed?: SyntheticFeed; lines?: number; maxLines?: number; onCommit?: () => void; defaultQuery?: string; clampScroll?: boolean; timestamps?: LogTimestamps } = {}) {
  const feed = options.feed ?? new SyntheticFeed({ rate: 0 });
  const lines = options.lines ?? 0;
  if (lines > 0) {
    feed.emit(lines);
  }

  const onCommit = options.onCommit;
  const ui = (timestamps: LogTimestamps | undefined = options.timestamps): ReactElement => (
    <Profiler id="log" onRender={() => onCommit?.()}>
      <LogView label="worker-0 · app" feed={feed} maxLines={options.maxLines} defaultQuery={options.defaultQuery} timestamps={timestamps} />
    </Profiler>
  );
  const view = render(ui());
  frame();
  const list = view.getByRole('grid');
  const scroll = stubScroll(list, { clamp: options.clampScroll });
  return { view, feed, list, scroll, ui };
}

/** The row at `index`, or a failure that names it: the rows are read by position in several places. */
function row(rows: readonly HTMLElement[], index: number): HTMLElement {
  const found = rows[index];
  if (found === undefined) {
    throw new Error(`no row ${index}`);
  }

  return found;
}

const rowsOf = (view: RenderResult) => [...view.container.querySelectorAll('[role="row"][data-n]')] as HTMLElement[];
const elementsIn = (row: Element) => 1 + row.querySelectorAll('*').length;

describe('what it is', () => {
  it('is a group named by the session, with a find bar, a level filter, a list that is a named grid and a status strip', () => {
    const { view } = mount({ lines: 20 });
    expect(view.getByRole('group', { name: 'Log, worker-0 · app' })).toBeTruthy();
    expect(view.getByRole('group', { name: 'Log filters' })).toBeTruthy();
    expect(view.getByRole('searchbox', { name: 'Search logs' })).toBeTruthy();
    for (const name of ['Match case', 'Use regular expression', 'Previous match', 'Next match']) {
      expect(view.getByRole('button', { name })).toBeTruthy();
    }

    const level = view.getByRole('radiogroup', { name: 'Minimum level' });
    expect(within(level).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['All', 'Info+', 'Warn+', 'Error']);
    const grid = view.getByRole('grid', { name: 'Log lines, worker-0 · app' });
    expect(grid.getAttribute('tabindex')).toBe('0');
    expect(within(grid).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Time', 'Level', 'Message']);
    expect(view.getByRole('group', { name: 'Session status' })).toBeTruthy();
  });

  it('shows every line of a small log, in order, one row each, with its clock, level and text', () => {
    const feed = new SyntheticFeed({ rate: 0, clock: () => Date.parse('2024-01-15T10:30:00.000Z') });
    feed.push([feed.line('first line', 'info'), feed.line('second line', 'error'), feed.line('third line')]);
    const { view } = mount({ feed });
    const rows = rowsOf(view);
    expect(rows.map((row) => row.querySelector('[role="gridcell"]:last-child')?.textContent)).toEqual(['first line', 'second line', 'third line']);
    expect(rows.map((row) => row.getAttribute('data-ov-level'))).toEqual(['info', 'error', null]);
    expect(rows[0]?.textContent).toContain('INFO');
    expect(rows[1]?.textContent).toContain('ERROR');
    expect(within(row(rows, 2)).getByRole('img', { name: 'No level' })).toBeTruthy();
  });

  it('closes its props: no className, no style, data-* passes through to the root', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    const view = render(<LogView label="x" feed={feed} data-probe="log" />);
    expect(view.container.querySelector('[data-probe="log"]')?.getAttribute('role')).toBe('group');
  });
});

describe('windowing (HLT-1, MNR-L1)', () => {
  it('mounts the viewport and its overscan at 100,000 lines, never the lines there are', () => {
    const { view } = mount({ lines: 100_000 });
    const rows = rowsOf(view);
    // 24 rows fit in 600 px; the overscan is 10 each side and a step is 4: at most 26 + 2 x 10 + 2 x 3.
    expect(rows.length).toBeGreaterThan(VIEWPORT_ROWS);
    expect(rows.length).toBeLessThanOrEqual(26 + 2 * 10 + 2 * 3);
    // A viewport plus 60 rows, the inventory's ceiling for the old viewer, is not exceeded either.
    expect(rows.length).toBeLessThanOrEqual(VIEWPORT_ROWS + 60);
    // The window is the end of the log, because it follows.
    expect(rows.at(-1)?.getAttribute('data-n')).toBe('100000');
  });

  it('keeps the element count of the document bounded by the window, not by the buffer', () => {
    const small = mount({ lines: 60 });
    const smallCount = small.view.container.querySelectorAll('*').length;
    small.view.unmount();
    const large = mount({ lines: 100_000 });
    const largeCount = large.view.container.querySelectorAll('*').length;
    expect(largeCount).toBeLessThanOrEqual(smallCount * 2);
    expect(largeCount).toBeLessThan(1500);
  });

  it('draws a plain row with a fixed number of elements, and the same for every row of a kind (HLT-3)', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    const levels = ['info', 'debug', undefined, 'warn', 'error'] as const;
    feed.push(Array.from({ length: 60 }, (_, index) => feed.line(`plain line ${index}`, levels[index % levels.length])));
    const { view } = mount({ feed });
    const counts = new Map<string | null, Set<number>>();
    for (const row of rowsOf(view)) {
      const level = row.getAttribute('data-ov-level');
      counts.set(level, (counts.get(level) ?? new Set()).add(elementsIn(row)));
    }

    for (const [level, set] of counts) {
      expect(set.size, String(level)).toBe(1);
    }

    // The row, three cells, and the glyph with its paints: info, warn and error are two-tone (an svg and 2 paths), debug a circle (an svg and 1), no level a dash.
    expect([...(counts.get('info') ?? [])]).toEqual([1 + 3 + 3]);
    expect([...(counts.get('error') ?? [])]).toEqual([1 + 3 + 3]);
    expect([...(counts.get('debug') ?? [])]).toEqual([1 + 3 + 2]);
    expect([...(counts.get(null) ?? [])]).toEqual([1 + 3 + 1]);
    // A plain row has no inline style at all.
    for (const row of rowsOf(view)) {
      expect(row.getAttribute('style')).toBeNull();
      expect(row.querySelector('[style]')).toBeNull();
    }
  });
});

describe('renders (MNR-L2, MNR-L3, HLT-2)', () => {
  it('five batches in a frame are one commit', () => {
    let commits = 0;
    const { feed } = mount({ lines: 50, onCommit: () => (commits += 1) });
    commits = 0;
    for (let batch = 0; batch < 5; batch += 1) {
      feed.emit(100);
    }

    frame();
    expect(commits).toBe(1);
  });

  it('100 batches of 100 lines make at most 100 commits, and a frame is one however many lines it brought (MNR-L2)', () => {
    let commits = 0;
    const { feed } = mount({ lines: 50, onCommit: () => (commits += 1) });
    commits = 0;
    for (let batch = 0; batch < 100; batch += 1) {
      feed.emit(100);
      if (batch % 5 === 4) {
        frame();
      }
    }

    frame();
    expect(commits).toBe(20);
  });

  it('appends 100 lines to a log the reader scrolled back in without changing one row that was there', () => {
    let commits = 0;
    const { feed, scroll, view } = mount({ lines: 5000, onCommit: () => (commits += 1) });
    scroll.setContent(5000 * 24 + 25);
    scroll.scrollTo(24 * 2000);
    const before = rowsOf(view);
    expect(before.length).toBeGreaterThan(VIEWPORT_ROWS);
    commits = 0;
    const changed = mutatedRows(view, () => {
      run(() => {
        feed.emit(100); 
      });
    });
    // The window did not move: the same rows, the same elements, none touched.
    expect(rowsOf(view)).toEqual(before);
    rowsOf(view).forEach((row, index) => {
      expect(row).toBe(before[index]); 
    });
    expect(changed.size).toBe(0);
    expect(commits).toBeLessThanOrEqual(1);
  });

  it('draws only the rows that come into the window when it follows', () => {
    const { feed, view } = mount({ lines: 5000 });
    const before = new Set(rowsOf(view));
    run(() => {
      feed.emit(2); 
    });
    const fresh = rowsOf(view).filter((row) => !before.has(row));
    // Two lines came: two rows enter at the end, and the window moves in steps of four, so no more than a step's worth is made.
    expect(fresh.length).toBeLessThanOrEqual(2 + 4);
    expect(rowsOf(view).length).toBeLessThanOrEqual(26 + 2 * 10 + 2 * 3);
  });

  it('a hover, a focus and a click on the list or on a column head that changes nothing commit nothing and touch no row', () => {
    let commits = 0;
    const { list, view } = mount({ lines: 200, onCommit: () => (commits += 1) });
    commits = 0;
    const target = row(rowsOf(view), 3);
    const head = view.getByRole('columnheader', { name: 'Time' });
    const changed = mutatedRows(view, () => {
      fireEvent.mouseOver(target);
      fireEvent.mouseEnter(target);
      fireEvent.pointerMove(target);
      fireEvent.focus(list);
      // A column head is no line's: the click selects nothing, so no row changes.
      fireEvent.click(head);
    });
    expect(commits).toBe(0);
    expect(changed.size).toBe(0);
  });

  it('a search keystroke changes only the rows that have a match (HLT-12)', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push(Array.from({ length: 300 }, (_, index) => feed.line(index % 6 === 0 ? `needle ${index}` : `hay ${index}`)));
    const { view, scroll } = mount({ feed });
    scroll.setContent(300 * 24 + 25);
    scroll.scrollTo(24 * 100);
    const mounted = rowsOf(view);
    const hits = new Set(mounted.filter((row) => row.textContent?.includes('needle')).map((row) => row.getAttribute('data-n')));
    expect(hits.size).toBeGreaterThan(2);
    const field = view.getByRole('searchbox', { name: 'Search logs' });
    const changed = mutatedRows(view, () => {
      fireEvent.change(field, { target: { value: 'needle' } });
      frame(3);
    });
    // Each row with a match was marked; no other row was touched.
    expect(changed.size).toBeGreaterThan(0);
    for (const n of changed) {
      expect(hits.has(n), `row ${n}`).toBe(true);
    }

    for (const row of rowsOf(view)) {
      expect(row.querySelector('[data-ov-mark]') !== null, `row ${row.getAttribute('data-n')}`).toBe(hits.has(row.getAttribute('data-n')));
    }
  });
});

describe('listeners and writes (MNR-L6, B6, B7)', () => {
  function listenersAdded(lines: number): number {
    const original = EventTarget.prototype.addEventListener;
    let added = 0;
    EventTarget.prototype.addEventListener = function patched(this: EventTarget, ...args: Parameters<typeof original>) {
      added += 1;
      original.apply(this, args);
    };

    try {
      const { view, scroll } = mount({ lines });
      scroll.setContent(lines * 24 + 25);
      scroll.scrollTo(24 * 10);
      view.unmount();
    } finally {
      EventTarget.prototype.addEventListener = original;
    }

    return added;
  }

  it('registers the same number of listeners for 60 lines and for 100,000: one handler a kind of event, none a row (T-07)', () => {
    expect(listenersAdded(100_000)).toBe(listenersAdded(60));
  });

  it('leaves no listener on the feed when it unmounts', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    let subscribers = 0;
    const subscribe = feed.subscribe;
    const counted = Object.assign(Object.create(feed) as SyntheticFeed, {
      subscribe: (listener: () => void) => {
        subscribers += 1;
        const off = subscribe(listener);
        return () => {
          subscribers -= 1;
          off();
        };
      },
    });
    const view = render(<LogView label="x" feed={counted} />);
    frame();
    expect(subscribers).toBeGreaterThan(0);
    view.unmount();
    expect(subscribers).toBe(0);
  });

  it('writes nothing to the document root or body while it mounts, streams, scrolls, searches and selects (rule 4)', () => {
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    const before = [document.documentElement.getAttribute('style'), document.body.getAttribute('style')];
    const { view, feed, scroll, list } = mount({ lines: 2000 });
    scroll.setContent(2000 * 24 + 25);
    scroll.scrollTo(24 * 100);
    feed.emit(500);
    frame();
    fireEvent.change(view.getByRole('searchbox', { name: 'Search logs' }), { target: { value: 'request' } });
    frame(3);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.click(view.getByRole('radio', { name: 'Warn+' }));
    observer.takeRecords().forEach((record) => records.push(record));
    observer.disconnect();
    expect(records).toEqual([]);
    expect([document.documentElement.getAttribute('style'), document.body.getAttribute('style')]).toEqual(before);
  });
});

describe('follow (HLT-9)', () => {
  it('pins the list to the end after the commit that brings lines, once the content has grown', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    const view = render(<LogView label="x" feed={feed} />);
    const list = view.getByRole('grid');
    const scroll = stubScroll(list);
    scroll.setContent(900_000);
    feed.emit(1000);
    frame();
    expect(scroll.top()).toBe(900_000);
  });

  it('stops following when the wheel goes up, says how to get back, and does not pin again', () => {
    const { feed, view, list, scroll } = mount({ lines: 2000 });
    scroll.setContent(2000 * 24 + 25);
    expect(view.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    fireEvent.wheel(list, { deltaY: -120 });
    scroll.scrollTo(24 * 1500);
    const button = view.getByRole('button', { name: 'Jump to latest' });
    const top = scroll.top();
    scroll.setContent(2100 * 24 + 25);
    feed.emit(100);
    frame();
    expect(scroll.top()).toBe(top);
    // The strip says how many came meanwhile, at most four times a second.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(view.getByRole('group', { name: 'Session status' }).textContent).toContain('Scrolled back');
    expect(button).toBeTruthy();
  });

  it('follows again from the button, and moves the focus to the list', () => {
    const { view, list, scroll } = mount({ lines: 2000 });
    scroll.setContent(2000 * 24 + 25);
    fireEvent.wheel(list, { deltaY: -120 });
    scroll.scrollTo(24 * 100);
    fireEvent.click(view.getByRole('button', { name: 'Jump to latest' }));
    expect(scroll.top()).toBe(2000 * 24 + 25);
    expect(view.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    expect(document.activeElement).toBe(list);
  });

  // Each model numbers its scroll commands from 1. The list remembers the last number it applied to drop a command it has seen, so it must remember whose
  // number it was: another feed is another model, and its first commands are not the old model's old ones.
  it('applies the first scroll commands of the model of a new feed, though the model of the old feed had issued more', () => {
    const first = new SyntheticFeed({ rate: 0 });
    const view = render(<LogView label="x" feed={first} />);
    const list = view.getByRole('grid');
    const scroll = stubScroll(list);
    for (let step = 1; step <= 8; step += 1) {
      scroll.setContent(step * 10_000);
      first.emit(50);
      frame();
    }

    expect(scroll.top()).toBe(80_000);

    const second = new SyntheticFeed({ rate: 0 });
    second.emit(50);
    scroll.setContent(900_000);
    view.rerender(<LogView label="x" feed={second} />);
    frame(2);
    expect(scroll.top()).toBe(900_000);

    // And it goes on following the new feed.
    scroll.setContent(950_000);
    second.emit(50);
    frame();
    expect(scroll.top()).toBe(950_000);
  });
});

describe('the list and the model agree on what the list did (HLT-9)', () => {
  // The model is told where the list went when it was asked to move, and takes the scroll event that comes next for the list's own. A write that moves nothing queues no scroll
  // event, so there is nothing to meet: if it is told all the same, the next scroll of the reader, if it lands within a few px of the place, is taken for the list's, the view goes
  // on following, and the next batch pins the reader back to the end.
  it('does not take a reader for the list after a pin that moved nothing: a buffer at its cap pins to the end it is already at', () => {
    const { feed, view, list, scroll } = mount({ lines: 300, maxLines: 300, clampScroll: true });
    scroll.setContent(300 * 24 + 25);
    // The first pin moves the list to the end, and the browser says so.
    run(() => {
      feed.emit(5);
    });
    act(() => {
      fireEvent.scroll(list);
    });
    const end = scroll.top();
    expect(end).toBeGreaterThan(0);
    // More lines at the cap: the content is as high as it was, the pin writes the offset it already has, and no scroll event follows.
    run(() => {
      feed.emit(5);
    });
    expect(scroll.top()).toBe(end);
    expect(view.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    // The reader scrolls up by two px. That is the reader, not the list: the view stops following and says how to get back.
    scroll.scrollTo(end - 2);
    expect(view.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
  });

  it('still takes the scroll event of a pin that moved the list for the list\'s own', () => {
    const { feed, view, list, scroll } = mount({ lines: 300, maxLines: 300, clampScroll: true });
    scroll.setContent(300 * 24 + 25);
    run(() => {
      feed.emit(5);
    });
    act(() => {
      fireEvent.scroll(list);
    });
    expect(view.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });
});

describe('the rows of this grid (design 16 S120, WAI-ARIA grid)', () => {
  // `closest('[data-n]')` finds the nearest ancestor with the attribute, and `data-*` passes through to the root of the view: a caller's `data-n` is not a line.
  it('selects no line for a click outside the rows, whatever an ancestor says in `data-n`, and selects the row that is clicked', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.emit(10);
    const view = render(<LogView label="x" feed={feed} data-n="2" />);
    frame();
    expect(rowsOf(view).length).toBe(10);
    act(() => {
      fireEvent.click(view.getByRole('columnheader', { name: 'Time' }));
    });
    expect(view.container.querySelector('[aria-selected="true"]')).toBeNull();
    act(() => {
      fireEvent.click(row(rowsOf(view), 4));
    });
    expect([...view.container.querySelectorAll('[aria-selected="true"]')].map((each) => each.getAttribute('data-n'))).toEqual(['5']);
  });

  // The count is the rows the grid has (the header and the lines it holds that pass the filter) and a row's index is its place among them: after the cap has taken the oldest
  // lines, or a filter has hidden some, a stream number is neither.
  it('says how many rows it has and where each is: the lines it holds that pass the filter, after the cap took the oldest ones', () => {
    const { view, list } = mount({ lines: 350, maxLines: 300 });
    expect(list.getAttribute('aria-rowcount')).toBe('301');
    expect(list.querySelector('[role="row"][aria-rowindex="1"]')?.getAttribute('data-n')).toBeNull();
    const rows = rowsOf(view);
    // The newest line is the 350th of the stream and the 300th of the list, which is row 301 with the header.
    expect(rows.at(-1)?.getAttribute('data-n')).toBe('350');
    expect(rows.at(-1)?.getAttribute('aria-rowindex')).toBe('301');
    const indexes = rows.map((each) => Number(each.getAttribute('aria-rowindex')));
    expect(indexes).toEqual(Array.from({ length: rows.length }, (_, index) => 301 - rows.length + 1 + index));
  });

  it('counts the rows that pass a level filter, and numbers them one after the other', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push([feed.line('a', 'info'), feed.line('b', 'warn'), feed.line('c', 'info'), feed.line('d', 'error'), feed.line('e', 'debug'), feed.line('f', 'warn')]);
    const { view, list } = mount({ feed });
    expect(list.getAttribute('aria-rowcount')).toBe('7');
    run(() => fireEvent.click(view.getByRole('radio', { name: 'Warn+' })), 2);
    expect(list.getAttribute('aria-rowcount')).toBe('4');
    expect(rowsOf(view).map((each) => [each.getAttribute('data-n'), each.getAttribute('aria-rowindex')])).toEqual([['2', '2'], ['4', '3'], ['6', '4']]);
  });
});

describe('a range of rows made with the pointer (HLT-18)', () => {
  // A press with Shift held asks the browser to extend a text selection from the last click to this one (WebKit and Chromium both do), and the words it would select are part of two
  // lines' text: a copy then yields the browser's selection, not the lines of the range, because the log's copy stands aside for a text selection (found by the probe, in WebKit, with
  // real keys: log-probe.mjs, copy). The press is the log's: the browser's default is prevented, and the list takes the focus the press would have given it. A press without Shift is the
  // browser's, so a drag over the words of a row still selects them.
  it('keeps the browser from extending a text selection on a press with Shift, and gives the list the focus; a press without Shift is left alone', () => {
    const { view, list } = mount({ lines: 20 });
    const rows = rowsOf(view);
    expect(fireEvent.mouseDown(row(rows, 2))).toBe(true);
    expect(document.activeElement).not.toBe(list);
    expect(fireEvent.mouseDown(row(rows, 6), { shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(list);
  });

  it('selects the rows from the first click to the click with Shift', () => {
    const { view } = mount({ lines: 20 });
    const rows = rowsOf(view);
    act(() => {
      fireEvent.click(row(rows, 2));
      fireEvent.click(row(rows, 5), { shiftKey: true });
    });
    expect([...view.container.querySelectorAll('[aria-selected="true"]')].map((each) => each.getAttribute('data-n'))).toEqual(['3', '4', '5', '6']);
  });
});

describe('a text selection and the lines selected (HLT-18)', () => {
  // The log's copy stands aside for text the reader selected inside a row, and a text range outlives the clicks and keys that come after it: a selection of LINES made now (all of them, or a
  // range with Shift) is the reader's newer choice, and the text range that would win the copy is let go. A press without Shift is the browser's, so a drag over a row's words still selects.
  const selectText = (target: HTMLElement) => {
    const selection = window.getSelection();
    const cell = target.querySelector('[role="gridcell"]:last-child');
    if (selection === null || cell === null) {
      throw new Error('no text to select');
    }

    const range = document.createRange();
    range.selectNodeContents(cell);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
  };

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
  });

  it('lets go of a text selection when all the lines are selected, so the copy that follows is the lines', () => {
    const { view, list } = mount({ lines: 20 });
    expect(selectText(row(rowsOf(view), 2)).isCollapsed).toBe(false);
    fireEvent.keyDown(list, { key: 'a', ctrlKey: true });
    expect(window.getSelection()?.isCollapsed).toBe(true);
    const setData = vi.fn();
    // The event was prevented: the lines went to the clipboard, and the text range did not win.
    expect(fireEvent.copy(list, { clipboardData: { setData } })).toBe(false);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(String(setData.mock.calls[0]?.[1]).split('\n')).toHaveLength(20);
  });

  it('lets go of a text selection when a range of lines is made with Shift, by the pointer or by the keys, and leaves it for a press that is the browser\'s', () => {
    const { view, list } = mount({ lines: 20 });
    const rows = rowsOf(view);
    selectText(row(rows, 2));
    fireEvent.mouseDown(row(rows, 3));
    expect(window.getSelection()?.isCollapsed).toBe(false);
    fireEvent.mouseDown(row(rows, 6), { shiftKey: true });
    expect(window.getSelection()?.isCollapsed).toBe(true);
    selectText(row(rows, 2));
    fireEvent.keyDown(list, { key: 'ArrowDown', shiftKey: true });
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });
});

describe('a cap that changes (maxLines)', () => {
  const strip = (view: RenderResult) => view.getByRole('group', { name: 'Session status' }).textContent ?? '';
  /** The strip's clock runs out, and the frame it asks for tells it. */
  const tell = () => {
    act(() => {
      vi.advanceTimersByTime(600);
    });
  };

  const ui = (feed: SyntheticFeed, maxLines: number) => <LogView label="worker-0 · app" feed={feed} maxLines={maxLines} />;

  // `LogFeed.read` gives each line once: a view that is replaced to change its cap has lost every line the feed gave it, and the feed cannot give them again.
  it('keeps the lines it has when maxLines changes for the same feed, and holds the new cap from then on', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.emit(50);
    const view = render(ui(feed, 300));
    frame();
    tell();
    expect(strip(view)).toContain('50 lines');
    const rows = rowsOf(view).map((row) => row.getAttribute('data-n'));

    view.rerender(ui(feed, 600));
    frame();
    tell();
    expect(strip(view)).toContain('50 lines');
    expect(rowsOf(view).map((row) => row.getAttribute('data-n'))).toEqual(rows);

    run(() => {
      feed.emit(580);
    }, 4);
    tell();
    expect(strip(view)).toContain('600 lines');
    expect(strip(view)).toContain('30 older lines dropped');

    // A smaller cap drops the oldest and says so.
    view.rerender(ui(feed, 100));
    frame();
    tell();
    expect(strip(view)).toContain('100 lines');
    expect(strip(view)).toContain('530 older lines dropped');
  });

  it('starts empty for another feed: a feed is its own lines', () => {
    const first = new SyntheticFeed({ rate: 0 });
    first.emit(50);
    const view = render(ui(first, 300));
    frame();
    tell();
    expect(strip(view)).toContain('50 lines');

    const second = new SyntheticFeed({ rate: 0 });
    second.emit(3);
    view.rerender(ui(second, 300));
    frame();
    tell();
    expect(strip(view)).toContain('3 lines');
  });

  // A frame callback can run between the commit that raises the cap and the passive effects that follow it (React runs those after paint), and a read that finds the old cap evicts lines the
  // new cap would have kept, which cannot be given back. The cap is told in the layout phase of that commit, which no frame callback comes between: the layout effect of a sibling after the
  // view runs after the view's own and before any passive effect, and lets a frame run there.
  const gate = { armed: false };
  function FrameBetween() {
    useLayoutEffect(() => {
      if (gate.armed) {
        gate.armed = false;
        vi.advanceTimersByTime(16);
      }
    });
    return null;
  }

  it('holds the new cap before a frame can read in the commit that raises it: nothing the new cap keeps is evicted', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    const both = (maxLines: number) => (
      <>
        <LogView label="worker-0 · app" feed={feed} maxLines={maxLines} />
        <FrameBetween />
      </>
    );
    feed.emit(100);
    const view = render(both(100));
    frame();
    tell();
    expect(strip(view)).toContain('100 lines');

    // 50 more lines are held by the feed and a frame is waiting to read them; the cap goes up to 600 in a commit whose layout phase lets that frame run.
    feed.emit(50);
    gate.armed = true;
    view.rerender(both(600));
    frame();
    tell();
    expect(strip(view)).toContain('150 lines');
    expect(strip(view)).not.toContain('dropped');
  });
});

describe('a buffer at its cap (HLT-4, T-10)', () => {
  // Found by the bench (bench/log): once the buffer was full the list froze at the line it was on while the strip went on counting. The count stops
  // growing at the cap, so the window (a start and an end) stops changing; rows read from the model by index during render were cached by the compiler on
  // the window and never read again, though the entries behind the same indexes had changed. Rows now come from the snapshot.
  const CAP = 300;

  it('keeps drawing the newest line when the buffer is full and the window has not moved', () => {
    const { feed, view, list } = mount({ lines: CAP, maxLines: CAP });
    expect(rowsOf(view).at(-1)?.getAttribute('data-n')).toBe(String(CAP));
    for (let batch = 1; batch <= 5; batch += 1) {
      run(() => {
        feed.push(Array.from({ length: 10 }, (_, index) => feed.line(`late ${batch}.${index}`)));
      });
      const rows = rowsOf(view);
      const last = rows.at(-1);
      expect(last?.getAttribute('data-n'), `batch ${batch}`).toBe(String(CAP + batch * 10));
      expect(last?.textContent, `batch ${batch}`).toContain(`late ${batch}.9`);
      // The rows are consecutive lines, and each says what it is.
      rows.forEach((row, index) => {
        expect(Number(row.getAttribute('data-n'))).toBe(Number(rows[0]?.getAttribute('data-n')) + index);
      });
    }

    // The list says how many rows it has: the lines it holds (the cap, not the 350 that went through it) and the header.
    expect(list.getAttribute('aria-rowcount')).toBe(String(CAP + 1));
  });

  it('keeps drawing the newest line that passes a level filter when the buffer is full', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push(Array.from({ length: CAP }, (_, index) => feed.line(`old ${index}`, index % 3 === 0 ? 'warn' : 'info')));
    const { view } = mount({ feed, maxLines: CAP });
    fireEvent.click(view.getByRole('radio', { name: 'Warn+' }));
    frame();
    const first = rowsOf(view).at(-1);
    expect(first?.textContent).toContain('old 297');
    run(() => {
      // 30 lines, 10 of them warnings: the buffer drops 30 and holds the same number of warnings, so the filtered list keeps its length.
      feed.push(Array.from({ length: 30 }, (_, index) => feed.line(`new ${index}`, index % 3 === 0 ? 'warn' : 'info')));
    });
    expect(rowsOf(view).at(-1)?.textContent).toContain('new 27');
  });
});

describe('the counts at the rates of the bench (bench/log; MNR-L2, L3, L6, rule 4)', () => {
  // The bench streams 1,000, 10,000 and 50,000 lines a second into a full buffer and reads these in WebKit and Chromium (bench/log/README.md); this is the same
  // run on the frame clock of the test, so a change that breaks one fails here, in CI, before a person runs the bench. Time moves one millisecond at a time and
  // every millisecond is its own `act`, as every task is its own turn in a browser: a timer that fires between two frames commits on its own.
  const FRAMES = 125;
  const FRAME_MS = 16;
  const MAX_ROWS = 26 + 2 * 10 + 2 * 3;

  it.each([1000, 10_000, 50_000])('at %i lines a second: at most one commit a frame, a bounded window, no listener added, no write at the root, the newest line drawn', (rate) => {
    let commits = 0;
    const { feed, view } = mount({ maxLines: 5000, onCommit: () => (commits += 1) });
    const added: string[] = [];
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function patched(this: EventTarget, ...args: Parameters<typeof original>) {
      added.push(String(args[0]));
      original.apply(this, args);
    };

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    let mostRows = 0;
    let mostInAFrame = 0;
    // An object, not a variable: the callback below runs once per millisecond and adds to it.
    const source = { emitted: 0 };
    let during = 0;
    try {
      commits = 0;
      let inThisFrame = 0;
      for (let ms = 1; ms <= FRAMES * FRAME_MS; ms += 1) {
        const before = commits;
        act(() => {
          // The source's own timer: every 4 ms, what it is due.
          if (ms % 4 === 0) {
            feed.emit(rate / 250);
            source.emitted += rate / 250;
          }

          vi.advanceTimersByTime(1);
        });
        inThisFrame += commits - before;
        if (ms % FRAME_MS === 0) {
          mostInAFrame = Math.max(mostInAFrame, inThisFrame);
          inThisFrame = 0;
          mostRows = Math.max(mostRows, rowsOf(view).length);
        }
      }

      during = commits;
      // The lines the last tick brought are read by the next frame.
      frame(2);
    } finally {
      EventTarget.prototype.addEventListener = original;
      observer.takeRecords().forEach((record) => records.push(record));
      observer.disconnect();
    }

    expect(source.emitted).toBeGreaterThan(FRAMES * FRAME_MS * (rate / 1000) * 0.9);
    expect(during).toBeGreaterThan(FRAMES / 2);
    expect(during).toBeLessThanOrEqual(FRAMES);
    expect(mostInAFrame).toBe(1);
    expect(mostRows).toBeLessThanOrEqual(MAX_ROWS);
    expect(added).toEqual([]);
    expect(records).toEqual([]);
    // At the two higher rates the buffer of 5,000 is full (20,000 and 100,000 lines went through it), and at all three the list is on the newest line.
    const last = rowsOf(view).at(-1);
    expect(last?.getAttribute('data-n')).toBe(String(Math.round(source.emitted)));
  });
});

describe('the states (design 16 S116, S120)', () => {
  it('says it is connecting while it starts', () => {
    const feed = new SyntheticFeed({ rate: 0, state: 'starting' });
    const { view } = mount({ feed });
    expect(view.getByRole('status').textContent).toBe('Connecting…');
  });

  it('says it waits for lines while it streams with none', () => {
    const { view } = mount();
    expect(view.getByRole('status').textContent).toBe('Waiting for lines…');
  });

  it('says it is paused and offers the way back, which lets the feed through; the list is frozen and renders nothing while lines wait (HLT-6)', () => {
    let commits = 0;
    const { feed, view } = mount({ lines: 30, onCommit: () => (commits += 1) });
    run(() => {
      feed.pause(); 
    });
    commits = 0;
    const changed = mutatedRows(view, () => {
      run(() => {
        feed.emit(5000); 
      }, 5);
    });
    expect(commits).toBe(0);
    expect(changed.size).toBe(0);
    expect(rowsOf(view).length).toBe(30);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const strip = view.getByRole('group', { name: 'Session status' });
    expect(strip.textContent).toContain('Paused, 5,000 new lines waiting');
    run(() => fireEvent.click(within(strip).getByRole('button', { name: 'Resume' })), 3);
    expect(feed.getSnapshot().paused).toBe(false);
    expect(rowsOf(view).length).toBeGreaterThan(30);
  });

  it('puts the focus in the list when Resume takes its own button away, so the keys of the log go on working', () => {
    const { feed, view } = mount({ lines: 30 });
    run(() => {
      feed.pause();
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const resume = within(view.getByRole('group', { name: 'Session status' })).getByRole('button', { name: 'Resume' });
    resume.focus();
    expect(document.activeElement).toBe(resume);
    run(() => fireEvent.click(resume), 3);
    expect(feed.getSnapshot().paused).toBe(false);
    expect(document.activeElement).toBe(view.getByRole('grid'));
  });

  // `paused` is the feed's own flag, "whatever `state` says" (`LogFeedSnapshot`): a feed paused while it starts keeps `starting`, and one that goes on to stream while it is paused is
  // `streaming` and paused. The way back is offered in both, and the strip says it is paused.
  it('offers Resume to a feed that is paused while it starts, and still when it goes on to stream paused', () => {
    const feed = new SyntheticFeed({ rate: 0, state: 'starting' });
    const { view } = mount({ feed });
    run(() => {
      feed.pause();
    });
    expect(feed.getSnapshot()).toMatchObject({ state: 'starting', paused: true });
    const strip = view.getByRole('group', { name: 'Session status' });
    expect(within(strip).getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(strip.textContent).toContain('Paused');

    run(() => {
      feed.setState('streaming');
    });
    expect(feed.getSnapshot()).toMatchObject({ state: 'streaming', paused: true });
    expect(within(strip).getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(strip.textContent).toContain('Paused');
    run(() => fireEvent.click(within(strip).getByRole('button', { name: 'Resume' })));
    expect(feed.getSnapshot().paused).toBe(false);
    expect(within(strip).queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  // The runtime's stream keeps `paused` true when a session ends or fails ("whatever `state` says"), and a paused feed's `read` returns nothing. The lines it held are the last the
  // reader will get, and nothing is left that could resume a finished log: the view leaves the pause and reads them.
  it('shows the lines a paused log held when its stream ENDS, and its strip reads ended, not paused, with no way to resume', () => {
    const { feed, view } = mount({ lines: 30 });
    run(() => {
      feed.pause();
    });
    run(() => {
      feed.push([feed.line('held one'), feed.line('held two'), feed.line('the last line before the end')]);
    }, 2);
    expect(rowsOf(view).length).toBe(30);
    expect(feed.getSnapshot()).toMatchObject({ state: 'paused', paused: true });
    run(() => {
      feed.setState('ended');
    }, 4);
    expect(feed.getSnapshot()).toMatchObject({ state: 'ended', paused: false });
    expect(rowsOf(view).at(-1)?.textContent).toContain('the last line before the end');
    const strip = view.getByRole('group', { name: 'Session status' });
    expect(strip.textContent).toContain('Stream ended');
    expect(strip.textContent).not.toContain('Paused');
    expect(within(strip).queryByRole('button')).toBeNull();
  });

  it('shows the last lines of a paused log whose stream FAILED, the marker for what the feed dropped while it held them, and the cause', () => {
    // The feed keeps 12 lines for a reader that is not reading: 20 of the 32 that came while it was paused are dropped.
    const feed = new SyntheticFeed({ rate: 0, maxHeld: 12 });
    feed.push([feed.line('read before the pause')]);
    const { view } = mount({ feed });
    run(() => {
      feed.pause();
    });
    run(() => {
      feed.push(Array.from({ length: 31 }, (_, index) => feed.line(`while paused ${index + 1}`)));
      feed.push([feed.line('the last line before the failure', 'error')]);
    }, 2);
    expect(rowsOf(view).length).toBe(1);
    run(() => {
      feed.setState('failed', { stage: 'source', source: 'source/app', message: 'connection reset by peer' });
    }, 4);

    expect(feed.getSnapshot()).toMatchObject({ state: 'failed', paused: false });
    const rows = rowsOf(view);
    expect(rows.map((each) => each.getAttribute('data-ov-kind') ?? 'line')).toEqual(['line', 'gap', ...Array.from({ length: 12 }, () => 'line')]);
    expect(rows[1]?.textContent).toBe('20 lines dropped');
    expect(rows.at(-1)?.textContent).toContain('the last line before the failure');
    expect(view.getByRole('alert').textContent).toBe('The log stream stopped. connection reset by peer.');
    const strip = view.getByRole('group', { name: 'Session status' });
    expect(strip.textContent).toContain('Session failed');
    expect(strip.textContent).not.toContain('Paused');
  });

  it('says the stream ended, with no end to follow', () => {
    const { feed, view } = mount({ lines: 10 });
    run(() => {
      feed.setState('ended'); 
    });
    const strip = view.getByRole('group', { name: 'Session status' });
    expect(strip.textContent).toContain('Stream ended');
    expect(within(strip).queryByRole('button')).toBeNull();
  });

  it('says there are no lines when it ended with none', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    const { view } = mount({ feed });
    run(() => {
      feed.setState('ended'); 
    });
    expect(view.getByRole('status').textContent).toBe('There are no lines.');
  });

  it('tells a failure with its cause in one notice at the foot of the lines it had', () => {
    const { feed, view } = mount({ lines: 10 });
    run(() => {
      feed.setState('failed', { stage: 'source', source: 'source/app', message: 'connection reset by peer' }); 
    });
    const alert = view.getByRole('alert');
    expect(alert.textContent).toBe('The log stream stopped. connection reset by peer.');
    expect(rowsOf(view).length).toBe(10);
    expect(view.getByRole('group', { name: 'Session status' }).textContent).toContain('Session failed');
  });

  it('tells a failure that came before any line as the body of the log', () => {
    const feed = new SyntheticFeed({ rate: 0, state: 'starting' });
    const { view } = mount({ feed });
    run(() => {
      feed.setState('failed', { stage: 'create', message: 'The plugin is not running' }); 
    });
    expect(view.getByRole('alert').textContent).toBe('Couldn\'t start the log stream. The plugin is not running.');
    expect(view.queryByRole('status')).toBeNull();
  });

  // The feed's lifecycle, not the lines it brought, says whether a stream started: a stream that was created, streamed nothing and then failed at its source has stopped, and only a
  // creation that failed is one that never started.
  it('tells the failure of a stream that was created as one that stopped, though no line had come', () => {
    const { feed, view } = mount();
    run(() => {
      feed.setState('failed', { stage: 'source', source: 'source/app', message: 'connection reset by peer' });
    });
    expect(feed.getSnapshot().state).toBe('failed');
    expect(rowsOf(view).length).toBe(0);
    expect(view.getByRole('alert').textContent).toBe('The log stream stopped. connection reset by peer.');
  });

  it('keeps the cause of a failure on screen when the level filter hides every line it had, with the way out of the filter beside it', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push([feed.line('one', 'info'), feed.line('two', 'warn'), feed.line('three', 'debug')]);
    const { view } = mount({ feed });
    run(() => {
      feed.setState('failed', { stage: 'source', source: 'source/app', message: 'connection reset by peer' });
    });
    run(() => fireEvent.click(view.getByRole('radio', { name: 'Error' })), 2);

    // The filter hides all three lines, which the model still holds: the empty message and its button are there, and so is the cause, once.
    expect(rowsOf(view).length).toBe(0);
    expect(view.getByRole('status').textContent).toContain('No lines match the filters.');
    expect(view.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    expect(view.getByRole('alert').textContent).toBe('The log stream stopped. connection reset by peer.');
    expect(view.getByRole('group', { name: 'Session status' }).textContent).toContain('Session failed');

    // Clearing the filter brings the lines back and the cause stays: it is the stream's, not the filter's.
    run(() => fireEvent.click(view.getByRole('button', { name: 'Clear filters' })), 2);
    expect(rowsOf(view).length).toBe(3);
    expect(view.getByRole('alert').textContent).toBe('The log stream stopped. connection reset by peer.');
    expect(view.queryByRole('status')).toBeNull();
  });

  it('puts the focus in the list when Clear filters takes its own button away, so the keys of the list work on the lines that come back', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push([feed.line('one', 'info'), feed.line('two', 'warn')]);
    const { view } = mount({ feed });
    run(() => fireEvent.click(view.getByRole('radio', { name: 'Error' })), 2);
    const clear = view.getByRole('button', { name: 'Clear filters' });
    clear.focus();
    expect(document.activeElement).toBe(clear);
    run(() => fireEvent.click(clear), 2);
    expect(rowsOf(view).length).toBe(2);
    expect(document.activeElement).toBe(view.getByRole('grid'));
  });

  it('draws a marker where the feed dropped lines, in its place (the source says it)', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push([feed.line('before'), feed.line('also before')]);
    const { view } = mount({ feed });
    run(() => {
      feed.drop(7);
      feed.push([feed.line('after')]);
    });
    const rows = rowsOf(view);
    expect(rows.map((row) => row.getAttribute('data-ov-kind') ?? 'line')).toEqual(['line', 'line', 'gap', 'line']);
    expect(rows[2]?.textContent).toBe('7 lines dropped');
  });
});

// L1: lines the FEED dropped while the view was not reading (a hidden panel) are told: the marker is the first row of a view that holds nothing older, the strip counts them in the
// one total of dropped lines, and the note on the strip says how many of them were never shown.
describe('lines the feed dropped before the view read them (L1)', () => {
  const stripOf = (view: RenderResult) => view.getByRole('group', { name: 'Session status' });
  const tell = () => {
    act(() => {
      vi.advanceTimersByTime(600);
    });
  };

  it('shows the marker above the lines of a view that was handed a whole buffer after a drop, and says the drop on the strip, in one number', () => {
    const feed = new SyntheticFeed({ rate: 0, maxHeld: 100 });
    // The feed holds the newest 100 of 400 lines and drops the 300 before them, while nobody reads it.
    feed.emit(400);
    const { view, scroll } = mount({ feed, maxLines: 100 });
    tell();
    // The list follows the end; the marker is the first row, and the reader scrolls to the top to see it.
    scroll.setContent(101 * 24 + 25);
    scroll.scrollTo(0);
    frame();
    const rows = rowsOf(view);
    expect(rows[0]?.getAttribute('data-ov-kind')).toBe('gap');
    expect(rows[0]?.textContent).toBe('300 lines dropped');
    expect(rows.slice(1).every((each) => each.getAttribute('data-ov-kind') === null)).toBe(true);
    const text = stripOf(view).textContent ?? '';
    expect(text).toContain('100 lines');
    expect(text).toContain('300 older lines dropped');
  });

  it('keeps the marker while the lines go on coming and the view keeps its bound', () => {
    const feed = new SyntheticFeed({ rate: 0, maxHeld: 100 });
    feed.emit(400);
    const { view, scroll } = mount({ feed, maxLines: 100 });
    run(() => {
      feed.emit(50);
    }, 2);
    tell();
    scroll.setContent(101 * 24 + 25);
    scroll.scrollTo(0);
    frame();
    expect(rowsOf(view)[0]?.textContent).toBe('300 lines dropped');
    // The strip's one number is the 300 the feed dropped and the 50 the view evicted.
    expect(stripOf(view).textContent).toContain('350 older lines dropped');
  });

  it('says what the number is made of in the tooltip and the accessible description of the strip, and the words stay the mock\'s', () => {
    const feed = new SyntheticFeed({ rate: 0, maxHeld: 100 });
    feed.emit(400);
    const { view } = mount({ feed, maxLines: 100 });
    run(() => {
      feed.emit(50);
    }, 2);
    tell();
    const stat = within(stripOf(view)).getByText(/older lines dropped/);
    const note = '300 lines never reached the view: the feed held too many while the view was not reading. 50 older lines were pushed out of the view, which keeps the latest 100.';
    expect(stat.getAttribute('data-ov-tip')).toBe(note);
    expect(stat.getAttribute('aria-description')).toBe(note);
  });

  it('has no note on a strip that dropped nothing', () => {
    const { view } = mount({ lines: 10 });
    tell();
    const stat = within(stripOf(view)).getByText(/10 lines/);
    expect(stat.hasAttribute('data-ov-tip')).toBe(false);
    expect(stat.hasAttribute('aria-description')).toBe(false);
  });

  it('draws the first lines on the strip at once: not `0 lines` for a quarter of a second after they are on screen', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    const { view } = mount({ feed });
    expect(stripOf(view).textContent).toContain('0 lines');
    run(() => {
      feed.emit(5);
    });
    expect(rowsOf(view).length).toBe(5);
    expect(stripOf(view).textContent).toContain('5 lines');
  });
});

describe('the source of a line (L2)', () => {
  // The mock shows a Source column when a session has more than one source (shell-panel.js 2663 `badgesOn`): a chip per row, with the hue of the source's place in a series of seven and its
  // name as text. With one source the log is what it was. The column appears when the view has heard of a second source, in the one commit that carries it.
  const cellsOf = (element: Element) => [...element.querySelectorAll('[role="gridcell"]')] as HTMLElement[];
  const headsOf = (view: RenderResult) => within(view.getByRole('grid')).getAllByRole('columnheader').map((head) => head.textContent);
  const sourceOf = (element: Element) => cellsOf(element)[2];
  const PAIR = [
    { id: 'item/orders-api/app', label: 'app' },
    { id: 'item/orders-api/worker', label: 'worker' },
  ] as const;
  const pair = () => new SyntheticFeed({ rate: 0, sources: PAIR });

  it('draws nothing for one source: three column heads, three cells in a row, no chip, the same elements a row had before the column existed', () => {
    const { view } = mount({ lines: 30 });
    expect(headsOf(view)).toEqual(['Time', 'Level', 'Message']);
    expect(view.getByRole('grid').getAttribute('aria-colcount')).toBe('3');
    for (const row of rowsOf(view)) {
      expect(cellsOf(row)).toHaveLength(3);
      expect(row.querySelector('[data-ov-clip]')).toBeNull();
    }

    // The elements of a plain row are pinned by the HLT-3 test above: the row, three cells and the glyph (1 + 3 + 3 for info).
    const info = rowsOf(view).find((row) => row.getAttribute('data-ov-level') === 'info');
    expect(info === undefined ? 0 : elementsIn(info)).toBe(1 + 3 + 3);
  });

  it('draws a Source column for two sources: a head, four columns in the grid, a cell in every row that says the source by name', () => {
    const feed = pair();
    const { view } = mount({ feed, lines: 30 });
    expect(headsOf(view)).toEqual(['Time', 'Level', 'Source', 'Message']);
    expect(view.getByRole('grid').getAttribute('aria-colcount')).toBe('4');
    const rows = rowsOf(view);
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      const cells = cellsOf(row);
      expect(cells).toHaveLength(4);
      // Time, level, source, message: the message is still the last cell.
      expect(cells[3]?.textContent).not.toBe(cells[2]?.textContent);
    }

    // The names are the feed's, line by line: the lines took the sources in turn, from the first.
    expect(rows.map((row) => sourceOf(row)?.textContent)).toEqual(rows.map((row) => (Number(row.getAttribute('data-n')) % 2 === 1 ? 'app' : 'worker')));
    expect(within(row(rows, 0)).getByRole('gridcell', { name: 'app' })).toBe(sourceOf(row(rows, 0)));
  });

  it('gives each source the hue of its place in the series, the same on every row of it, and two sources two hues; the hue is never all the cell says', () => {
    const { view } = mount({ feed: pair(), lines: 30 });
    const hues = new Map<string, Set<string | null>>();
    for (const row of rowsOf(view)) {
      const cell = sourceOf(row);
      const hue = cell?.querySelector('[data-ov-hue]')?.getAttribute('data-ov-hue') ?? null;
      hues.set(cell?.textContent ?? '', (hues.get(cell?.textContent ?? '') ?? new Set()).add(hue));
    }

    expect([...hues.keys()].sort()).toEqual(['app', 'worker']);
    expect(hues.get('app')).toEqual(new Set(['blue']));
    expect(hues.get('worker')).toEqual(new Set(['green']));
  });

  it('cuts a long name from its start and keeps its end whole, with the whole name as the tip while it is cut (the kit\'s tooltip rule), and puts no title on the cell', () => {
    const long = 'checkout-7d8c6f49b-f8q4m/sidecar';
    const feed = new SyntheticFeed({ rate: 0, sources: [{ id: 'one', label: long }, { id: 'two' }] });
    const { view } = mount({ feed, lines: 4 });
    const clipped = view.container.querySelector(`[role="gridcell"] [data-ov-clip][data-ov-full="${long}"]`);
    expect(clipped).not.toBeNull();
    // The name is real text once, whole: what a reader of the screen and a copy of the page meet.
    expect(within(clipped as HTMLElement).getByText(long)).toBeTruthy();
    for (const row of rowsOf(view)) {
      expect(row.querySelector('[title]')).toBeNull();
    }
  });

  it('draws a cell with no chip for a line that names no source in a log that has more than one', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push([feed.line('from a', 'info', 'a'), feed.line('from b', 'info', 'b'), feed.line('from nobody', 'info', '')]);
    const { view } = mount({ feed });
    const rows = rowsOf(view);
    expect(rows.map((row) => cellsOf(row).length)).toEqual([4, 4, 4]);
    expect(rows.map((row) => sourceOf(row)?.textContent)).toEqual(['a', 'b', '']);
    expect(sourceOf(row(rows, 2))?.querySelector('[data-ov-hue]')).toBeNull();
  });

  it('puts the column in the one commit that carries the second source\'s first line: every row on screen has the cell then, and the frame is one commit', () => {
    let commits = 0;
    const feed = new SyntheticFeed({ rate: 0 });
    const { view } = mount({ feed, onCommit: () => (commits += 1) });
    run(() => {
      feed.push(Array.from({ length: 30 }, (_, index) => feed.line(`from the app ${index}`, 'info', 'item/app')));
    });
    expect(headsOf(view)).toEqual(['Time', 'Level', 'Message']);
    expect(rowsOf(view).every((row) => cellsOf(row).length === 3)).toBe(true);
    commits = 0;
    run(() => {
      feed.push([feed.line('the sidecar speaks', 'info', 'item/sidecar')]);
    });
    expect(commits).toBe(1);
    expect(headsOf(view)).toEqual(['Time', 'Level', 'Source', 'Message']);
    const rows = rowsOf(view);
    expect(rows).toHaveLength(31);
    expect(rows.every((row) => cellsOf(row).length === 4)).toBe(true);
    expect(rows.map((row) => sourceOf(row)?.textContent)).toEqual([...Array.from({ length: 30 }, () => 'item/app'), 'item/sidecar']);
  });

  it('touches each row on screen once for the column, in the commit that brings it, and then no row that was there when more lines are appended (HLT-2)', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push(Array.from({ length: 5000 }, (_, index) => feed.line(`line ${index}`, 'info', 'item/app')));
    const { view, scroll } = mount({ feed });
    scroll.setContent(5000 * 24 + 25);
    scroll.scrollTo(24 * 2000);
    const before = rowsOf(view);
    const touched = mutatedRows(view, () => {
      run(() => {
        feed.push([feed.line('the sidecar speaks', 'info', 'item/sidecar')]);
      });
    });
    // The reader is scrolled back and the new line is below the window: the rows on screen are the same elements, and each got its cell.
    expect(rowsOf(view)).toHaveLength(before.length);
    rowsOf(view).forEach((current, index) => {
      expect(current).toBe(before[index]);
    });
    expect(touched).toEqual(new Set(before.map((current) => current.getAttribute('data-n'))));
    // From here on a flush that appends lines changes none of them, the column being on.
    const later = mutatedRows(view, () => {
      run(() => {
        feed.push(Array.from({ length: 100 }, (_, index) => feed.line(`more ${index}`, 'info', index % 2 === 0 ? 'item/app' : 'item/sidecar')));
      });
    });
    expect(later.size).toBe(0);
  });

  it('moves nothing when the column appears: the reader scrolled back keeps the place and the rows on screen, and nothing is measured again', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push(Array.from({ length: 5000 }, (_, index) => feed.line(`line ${index}`, 'info', 'item/app')));
    const { view, scroll } = mount({ feed });
    scroll.setContent(5000 * 24 + 25);
    scroll.scrollTo(24 * 2000);
    const first = rowsOf(view)[0]?.getAttribute('data-n');
    const top = scroll.top();
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    run(() => {
      feed.push([feed.line('the sidecar speaks', 'info', 'item/sidecar')]);
    });
    expect(headsOf(view)).toEqual(['Time', 'Level', 'Source', 'Message']);
    expect(scroll.top()).toBe(top);
    expect(rowsOf(view)[0]?.getAttribute('data-n')).toBe(first);
    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
  });

  it('keeps following when the column appears: the one pin to the end of every flush, and the last line on screen', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push(Array.from({ length: 200 }, (_, index) => feed.line(`line ${index}`, 'info', 'item/app')));
    const { view, list, scroll } = mount({ feed, clampScroll: true });
    scroll.setContent(200 * 24 + 25);
    run(() => {
      feed.push([feed.line('the sidecar speaks', 'info', 'item/sidecar')]);
    });
    expect(headsOf(view)).toEqual(['Time', 'Level', 'Source', 'Message']);
    expect(rowsOf(view).at(-1)?.getAttribute('data-n')).toBe('201');
    expect(list.scrollTop).toBeGreaterThan(0);
  });

  it('lists the sources the feed has heard of before they speak, so the column is there when the first line is drawn, and does not draw it for a feed that lists one', () => {
    const quiet = new SyntheticFeed({ rate: 0, sources: ['only/one'] });
    const one = mount({ feed: quiet, lines: 10 });
    expect(headsOf(one.view)).toEqual(['Time', 'Level', 'Message']);
    one.view.unmount();
    const listed = new SyntheticFeed({ rate: 0 });
    const two = mount({ feed: listed });
    expect(headsOf(two.view)).toEqual(['Time', 'Level', 'Message']);
    act(() => {
      listed.setSources([{ id: 'a' }, { id: 'b' }]);
    });
    frame();
    expect(headsOf(two.view)).toEqual(['Time', 'Level', 'Source', 'Message']);
  });

  it('draws the marker of dropped lines across every column of a log that has a source column', () => {
    const feed = pair();
    feed.emit(5);
    const { view } = mount({ feed });
    run(() => {
      feed.drop(10);
      feed.emit(2);
    });
    const marker = view.container.querySelector('[data-ov-kind="gap"] [role="gridcell"]');
    expect(marker?.getAttribute('aria-colspan')).toBe('4');
  });

  it('copies the selected lines with their source named after the level, a log of one source included (the mock copies the label of any line that has one)', () => {
    const feed = pair();
    const { view, list } = mount({ feed, lines: 6 });
    fireEvent.keyDown(list, { key: 'a', ctrlKey: true });
    const setData = vi.fn();
    fireEvent.copy(list, { clipboardData: { setData } });
    const text = String(setData.mock.calls[0]?.[1]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(6);
    lines.forEach((line, index) => {
      expect(line).toMatch(new RegExp(`^\\d\\d:\\d\\d:\\d\\d\\.\\d{3} (?:INFO |WARN |ERROR|DEBUG|     ) ${index % 2 === 0 ? 'app' : 'worker'} {2}`));
    });
    view.unmount();

    // One source, so no column on screen: the copy still says which source wrote each line.
    const single = mount({ lines: 6 });
    expect(single.view.container.querySelector('[data-ov-column="source"]')).toBeNull();
    fireEvent.keyDown(single.list, { key: 'a', ctrlKey: true });
    const one = vi.fn();
    fireEvent.copy(single.list, { clipboardData: { setData: one } });
    const singles = String(one.mock.calls[0]?.[1]).split('\n');
    expect(singles).toHaveLength(6);
    for (const line of singles) {
      expect(line).toMatch(/^\d\d:\d\d:\d\d\.\d{3} (?:INFO |WARN |ERROR|DEBUG| {5}) source\/main {2}\S/);
    }
  });

  it('does not search the source: the matches are in the text cell, and a query that is only a name finds no row', () => {
    const feed = pair();
    const { view } = mount({ feed, lines: 20, defaultQuery: 'worker' });
    frame(2);
    for (const row of rowsOf(view)) {
      expect(row.querySelector('[data-ov-mark]')).toBeNull();
    }

    expect(within(view.getByRole('group', { name: 'Log filters' })).getByText('No results')).toBeTruthy();
  });
});

describe('the zone of the clock (L3)', () => {
  // The mock shows the clock in the viewer's local time and, when the reader asks, in UTC with a Z after it (shell-panel.js 1572 `ts: 'local'`, 1708, 2666 the Timestamps option). The control that asks is the
  // toolbar's (P1b-4): the view takes the choice as a prop and draws it. The full timestamp, with its zone, is the tip of the clock.
  const INSTANT = '2024-01-15T10:30:00.123Z';
  const stamped = (...texts: string[]) => {
    const feed = new SyntheticFeed({ rate: 0, clock: () => Date.parse(INSTANT) });
    feed.push(texts.map((text) => feed.line(text, 'info')));
    return feed;
  };

  const clocksOf = (view: RenderResult) => rowsOf(view).map((row) => row.querySelector('[role="gridcell"]')?.textContent);
  const root = (view: RenderResult) => view.getByRole('group', { name: 'Log, worker-0 · app' });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows the viewer\'s local clock with no mark of a zone when it is not told otherwise', () => {
    vi.stubEnv('TZ', 'Asia/Kolkata');
    const { view } = mount({ feed: stamped('first', 'second') });
    expect(clocksOf(view)).toEqual(['16:00:00.123', '16:00:00.123']);
    expect(root(view).getAttribute('data-ov-timestamps')).toBe('local');
  });

  it('shows the UTC clock with a Z after it when it is asked for UTC, whatever zone the viewer is in', () => {
    vi.stubEnv('TZ', 'Asia/Kolkata');
    const { view } = mount({ feed: stamped('first', 'second'), timestamps: 'utc' });
    expect(clocksOf(view)).toEqual(['10:30:00.123Z', '10:30:00.123Z']);
    expect(root(view).getAttribute('data-ov-timestamps')).toBe('utc');
  });

  it('changes the clock of the rows already drawn when the choice changes, in the rows it has: the lines stay, it is a setting and not another view', () => {
    vi.stubEnv('TZ', 'Asia/Kolkata');
    const { view, ui } = mount({ feed: stamped('first', 'second') });
    const before = rowsOf(view);
    view.rerender(ui('utc'));
    frame();
    expect(clocksOf(view)).toEqual(['10:30:00.123Z', '10:30:00.123Z']);
    expect(rowsOf(view).every((row, index) => row === before[index])).toBe(true);
    view.rerender(ui('local'));
    frame();
    expect(clocksOf(view)).toEqual(['16:00:00.123', '16:00:00.123']);
    expect(root(view).getAttribute('data-ov-timestamps')).toBe('local');
  });

  it('draws no clock, no Z and no tip for a line that has no time, in either zone', () => {
    const feed = new SyntheticFeed({ rate: 0 });
    feed.push([{ ...feed.line('timeless', 'info'), timestamp: '' }]);
    const { view, ui } = mount({ feed });
    for (const zone of ['local', 'utc'] as const) {
      view.rerender(ui(zone));
      frame();
      const cell = rowsOf(view)[0]?.querySelector('[role="gridcell"]');
      expect(cell?.textContent).toBe('');
      expect(cell?.hasAttribute('data-ov-tip')).toBe(false);
    }
  });

  it('copies the clock the rows show: UTC with its Z in UTC, the local clock with no mark in local time', () => {
    vi.stubEnv('TZ', 'Asia/Kolkata');
    const { view, list, ui } = mount({ feed: stamped('first'), timestamps: 'utc' });
    fireEvent.keyDown(list, { key: 'a', ctrlKey: true });
    const inUtc = vi.fn();
    fireEvent.copy(list, { clipboardData: { setData: inUtc } });
    expect(inUtc.mock.calls[0]?.[1]).toBe('10:30:00.123Z INFO  source/main  first');
    view.rerender(ui('local'));
    frame();
    const inLocal = vi.fn();
    fireEvent.copy(list, { clipboardData: { setData: inLocal } });
    expect(inLocal.mock.calls[0]?.[1]).toBe('16:00:00.123 INFO  source/main  first');
  });

  // The tip of the clock is the line's own timestamp: the text the source sent, with its zone and every digit of its fraction (an RFC 3339 timestamp with nanoseconds, as a command-line log tool prints it), so a reader who sees a local clock
  // can read the instant in UTC, and the date the clock leaves out. It is the attribute the one tooltip of the window reads; no element and no handler is added to a row.
  it('gives the clock the line\'s own full timestamp for a tip, in either zone, on the clock alone', () => {
    const feed = new SyntheticFeed({ rate: 0, clock: () => Date.parse(INSTANT) });
    feed.push([feed.line('first', 'info'), { ...feed.line('second', 'info'), timestamp: '2026-11-20T03:22:38.782123456Z' }]);
    const { view, ui } = mount({ feed });
    const tipsOf = () => rowsOf(view).map((row) => row.querySelector('[role="gridcell"]')?.getAttribute('data-ov-tip'));
    expect(tipsOf()).toEqual([INSTANT, '2026-11-20T03:22:38.782123456Z']);
    view.rerender(ui('utc'));
    frame();
    expect(tipsOf()).toEqual([INSTANT, '2026-11-20T03:22:38.782123456Z']);
    for (const row of rowsOf(view)) {
      expect(row.querySelectorAll('[data-ov-tip]')).toHaveLength(1);
    }
  });
});
