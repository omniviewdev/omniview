import { ThemeProvider } from '@omniviewdev/kit';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Profiler, type ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, type PanelStore, type Session } from '../../core/panel';
import { createLogStreams, type LogStreams } from './LogStreams';
import { LogsBody } from './LogsBody';
import { fakeFeed, type FakeFeed } from './testing';
import { LOGS_TOOL } from './tool';

// The body of a Logs session: the kit's log view over the feed the registry holds for it. jsdom has no layout, so the geometry the list reads is stubbed on the elements that report it (as the kit's own
// tests do) and time is the test's. What is asserted is what the host adds to the view: which feed it reads, that a body that is not on screen holds no listener and does no work while its stream goes
// on, that it reads what the stream held when it comes back, and that closing the session lets every listener go.

const LIST = { height: 625, header: 25, row: 24 };
const isList = (element: Element) => element.getAttribute('role') === 'grid';
const isProbe = (element: Element) => element.getAttribute('aria-hidden') === 'true' && element.parentElement !== null && isList(element.parentElement);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: function get(this: HTMLElement) {
      return isList(this) ? LIST.height : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: function get(this: HTMLElement) {
      return this.getAttribute('aria-rowindex') === '1' ? LIST.header : 0;
    },
  });
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const height = isProbe(this) ? LIST.row : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height, toJSON: () => ({}) };
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Mounted = {
  readonly store: PanelStore;
  readonly streams: LogStreams;
  readonly feed: FakeFeed;
  readonly session: Session;
  readonly commits: () => number;
  /** Renders the body for the session, on screen or not. */
  readonly show: (visible: boolean) => void;
  readonly unmount: () => void;
};

function mount(options: { readonly visible?: boolean; readonly stream?: boolean } = {}): Mounted {
  const store = createPanelStore();
  store.registerTool(LOGS_TOOL);
  store.syncPlugins([{ id: 'acme', tools: [] }]);
  const streams = createLogStreams(store);
  streams.attach();
  const feed = fakeFeed({ state: 'streaming' });
  const opened = options.stream === false ? store.openSession({ tool: 'logs', plugin: 'acme', title: 'orders-api/app', scope: 'north', state: 'ended', cause: 'Restored from the last session.' }) : streams.open({ plugin: 'acme', id: 'item/orders-api/app', title: 'orders-api/app', scope: 'north', open: () => feed });
  const id = opened === undefined ? '' : 'id' in opened ? opened.id : '';
  const session = store.getSnapshot().sessions[id];
  if (session === undefined) {
    throw new Error('the session did not open');
  }

  let commits = 0;
  const body = (visible: boolean): ReactElement => (
    <ThemeProvider>
      <Profiler
        id="body"
        onRender={() => {
          commits += 1;
        }}
      >
        <LogsBody streams={streams} session={session} visible={visible} />
      </Profiler>
    </ThemeProvider>
  );
  const view = render(body(options.visible ?? true));
  return {
    store,
    streams,
    feed,
    session,
    commits: () => commits,
    show: (visible) => {
      act(() => {
        view.rerender(body(visible));
      });
    },
    unmount: () => {
      view.unmount();
    },
  };
}

const frames = (count = 1) => {
  act(() => {
    vi.advanceTimersByTime(16 * count);
  });
};

/** The listeners a feed has: the registry's one, and the view's two (its status, and its reader that is woken for lines). */
const REGISTRY = 1;
const VIEW = 2;

/** The rows the list has mounted. */
const rows = (): number => screen.queryAllByRole('row').filter((row) => row.getAttribute('data-n') !== null).length;

describe('the body of a Logs session', () => {
  it('is the log view of the session, named for it, over the stream the registry holds', () => {
    mount();
    expect(screen.getByRole('group', { name: 'Log, orders-api/app · north' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Log lines, orders-api/app · north' })).toBeInTheDocument();
  });

  it('draws the lines the stream holds, a frame at a time, and no more than a window of them', () => {
    const { feed } = mount();
    act(() => {
      feed.push(500);
      vi.advanceTimersByTime(16);
    });
    expect(rows()).toBeGreaterThan(0);
    expect(rows()).toBeLessThan(60);
    expect(screen.getByRole('grid').getAttribute('aria-rowcount')).toBe('501');
  });

  it('reads the stream with two listeners of the view\'s (its status and its reader) and the registry\'s, and takes no control of it: a feed has one reader, and the registry only listens', () => {
    const { feed } = mount();
    expect(feed.listeners()).toBe(REGISTRY + VIEW);
    expect(feed.controls()).toBe(0);
  });

  it('says what is left of a session that has no stream (restored from the last run, or whose plugin came back): the earlier lines are gone, and how to get logs again; no view is made over nothing', () => {
    mount({ stream: false });
    expect(screen.getByText('The earlier lines are gone')).toBeInTheDocument();
    expect(screen.getByText('Open logs from the resource to follow them again.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('group', { name: /^Log,/ })).toBeNull();
  });
});

describe('a body that is not on screen', () => {
  it('lets go of its listener and reads nothing while its stream goes on: a hidden session does no work', () => {
    const { feed, show, commits } = mount();
    act(() => {
      feed.push(100);
      vi.advanceTimersByTime(16);
    });
    const rowsBefore = rows();
    show(false);
    // Only the registry listens now: the view is gone from the stream, and its frames and its clock with it.
    expect(feed.listeners()).toBe(REGISTRY);
    const reads = feed.reads();
    const commitsAtHide = commits();
    for (let second = 0; second < 5; second += 1) {
      act(() => {
        feed.push(10_000);
        vi.advanceTimersByTime(1_000);
      });
    }

    expect(feed.reads()).toBe(reads);
    expect(commits()).toBe(commitsAtHide);
    expect(vi.getTimerCount()).toBe(0);
    expect(rowsBefore).toBeGreaterThan(0);
  });

  it('is not drawn: the view\'s own nodes are hidden, so the browser does no layout and no paint for them', () => {
    const { show } = mount();
    show(false);
    const root = document.querySelector<HTMLElement>('[data-log-session]');
    expect(root).not.toBeNull();
    expect(root?.style.display).toBe('none');
    show(true);
    expect(root?.style.display).not.toBe('none');
  });

  it('comes back with the lines it had and the lines the stream held meanwhile, read from where it left off', () => {
    const { feed, show } = mount();
    act(() => {
      feed.push(50);
      vi.advanceTimersByTime(16);
    });
    expect(screen.getByRole('grid').getAttribute('aria-rowcount')).toBe('51');
    show(false);
    act(() => {
      feed.push(200);
      vi.advanceTimersByTime(5_000);
    });
    show(true);
    frames(3);
    expect(feed.listeners()).toBe(REGISTRY + VIEW);
    expect(screen.getByRole('grid').getAttribute('aria-rowcount')).toBe('251');
  });

  it('follows the tail again when it comes back: the last line is the newest', () => {
    const { feed, show } = mount();
    act(() => {
      feed.push(300);
      vi.advanceTimersByTime(16);
    });
    show(false);
    act(() => {
      feed.push(300);
    });
    show(true);
    frames(3);
    const last = screen.queryAllByRole('row').filter((row) => row.getAttribute('data-n') !== null).at(-1);
    expect(last?.textContent).toContain('line 600');
  });
});

describe('the end of a session', () => {
  it('lets the view go of every listener when its body unmounts, which is what closing the session does', () => {
    const { feed, store, session, unmount } = mount();
    expect(feed.listeners()).toBe(REGISTRY + VIEW);
    // The tab closes: the registry releases its listener and closes the stream; the body unmounts and the view releases its own.
    store.closeSession(session.id);
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(VIEW);
    unmount();
    expect(feed.listeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the source of a line (L2)', () => {
  // The body hands the stream to the kit's view as it is, so the source a line names and the sources the stream lists reach the Source column with nothing in between to map.
  const heads = () => screen.getAllByRole('columnheader').map((head) => head.textContent);
  const dataRows = () => screen.queryAllByRole('row').filter((row) => row.getAttribute('data-n') !== null);
  const cells = (row: HTMLElement) => [...row.querySelectorAll('[role="gridcell"]')].map((cell) => cell.textContent);

  it('draws nothing extra for a stream with one source', () => {
    const { feed } = mount();
    feed.push(6, 'item/app');
    frames();
    expect(heads()).toEqual(['Time', 'Level', 'Message']);
    expect(dataRows().map((row) => cells(row).length)).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it('draws a Source column, with each line\'s source by name, as soon as the stream has more than one', () => {
    const { feed } = mount();
    feed.push(2, 'item/app');
    frames();
    expect(heads()).toEqual(['Time', 'Level', 'Message']);
    feed.push(2, 'item/worker');
    frames();
    expect(heads()).toEqual(['Time', 'Level', 'Source', 'Message']);
    expect(dataRows().map((row) => cells(row)[2])).toEqual(['item/app', 'item/app', 'item/worker', 'item/worker']);
  });

  it('names a source by the label the stream lists for it', () => {
    const { feed } = mount();
    feed.set({ sources: [{ id: 'item/app', label: 'app' }, { id: 'item/worker', label: 'worker' }] });
    feed.push(2, 'item/worker');
    frames();
    expect(heads()).toEqual(['Time', 'Level', 'Source', 'Message']);
    expect(dataRows().map((row) => cells(row)[2])).toEqual(['worker', 'worker']);
  });
});
