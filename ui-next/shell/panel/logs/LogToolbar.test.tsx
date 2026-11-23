import { MenuHost, ThemeProvider } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Profiler, type ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, type PanelStore, type Session } from '../../core/panel';
import { createLogStreams, type LogStreams } from './LogStreams';
import { LogsBody } from './LogsBody';
import { fakeFeed, type FakeFeed } from './testing';
import { LOGS_TOOL } from './tool';

// The toolbar of a Logs session (P1b-4a): the controls the kit's log view has, drawn as the mock draws its Logs body toolbar, over the feed the registry holds. jsdom has no layout, so the geometry the list
// reads is stubbed (as the kit's own tests do) and time is the test's; what is asserted is the toolbar's contract: its buttons, names, states and reasons, what each does to the view and to the stream, what
// it costs while it is not on screen, and that its state is the session's.

const LIST = { height: 625, header: 25, row: 24 };
const isList = (element: Element) => element.getAttribute('role') === 'grid';
const isProbe = (element: Element) => element.getAttribute('aria-hidden') === 'true' && element.parentElement !== null && isList(element.parentElement);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
    return isList(this) ? LIST.height : this.getAttribute('data-shell-part') === 'logsTools' ? column.height : 0;
  } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: function get(this: HTMLElement) {
    return this.getAttribute('aria-rowindex') === '1' ? LIST.header : 0;
  } });
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const height = isProbe(this) ? LIST.row : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height, toJSON: () => ({}) };
  };
});

/** The height the toolbar's column has, which jsdom cannot lay out: 0 says nothing is known (every button is shown, as in a body that is not laid out). */
const column = { height: 0 };
const written: string[] = [];
let clipboardWorks = true;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  written.length = 0;
  clipboardWorks = true;
  column.height = 0;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (!clipboardWorks) {
          throw new Error('NotAllowedError');
        }

        written.push(text);
      },
    },
  });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
});

type Mounted = {
  readonly store: PanelStore;
  readonly feed: FakeFeed;
  readonly commits: () => number;
  readonly show: (visible: boolean) => void;
};

function mount(options: { readonly state?: 'starting' | 'streaming' | 'ended' | 'failed'; readonly sources?: ReadonlyArray<{ readonly id: string; readonly label?: string }>; readonly stream?: boolean } = {}): Mounted {
  const store = createPanelStore();
  store.registerTool(LOGS_TOOL);
  store.syncPlugins([{ id: 'acme', tools: [] }]);
  const streams: LogStreams = createLogStreams(store);
  streams.attach();
  const feed = fakeFeed({ state: options.state ?? 'streaming', ...(options.sources === undefined ? {} : { sources: options.sources }) });
  const opened =
    options.stream === false
      ? store.openSession({ tool: 'logs', plugin: 'acme', title: 'orders-api/app', scope: 'north', state: 'ended', cause: 'Restored from the last session.' })
      : streams.open({ plugin: 'acme', id: 'item/orders-api/app', title: 'orders-api/app', scope: 'north', open: () => feed });
  const id = opened === undefined ? '' : 'id' in opened ? opened.id : '';
  const first: Session | undefined = store.getSnapshot().sessions[id];
  if (first === undefined) {
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
        <LogsBody streams={streams} session={store.getSnapshot().sessions[id] ?? first} visible={visible} />
      </Profiler>
    </ThemeProvider>
  );
  const view = render(body(true), { wrapper: MenuHost });
  return {
    store,
    feed,
    commits: () => commits,
    show: (visible) => {
      act(() => {
        view.rerender(body(visible));
      });
    },
  };
}

const frames = (count = 1) => {
  act(() => {
    vi.advanceTimersByTime(16 * count);
  });
};

const feedLines = (feed: FakeFeed, count: number) => {
  act(() => {
    feed.push(count);
    vi.advanceTimersByTime(16);
  });
};

const toolbar = () => screen.getByRole('toolbar', { name: 'Logs tools' });
const button = (name: string) => within(toolbar()).getByRole('button', { name });
const strip = () => {
  // The strip's numbers are told at most four times a second: let the clock run out and the frame it asks for tell them.
  frames(1);
  act(() => {
    vi.advanceTimersByTime(300);
  });
  frames(2);
  return screen.getByRole('group', { name: 'Session status' }).textContent ?? '';
};

const rowCount = () => screen.getByRole('grid').getAttribute('aria-rowcount');
const glyph = (name: string) => button(name).querySelector('[data-ov-glyph]')?.getAttribute('data-ov-glyph');
const settle = async () => {
  // A copy is an asynchronous write: the promises settle in microtasks, the confirmation is a state of the next render.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('the toolbar of a Logs session', () => {
  it('stands at the left of the log view, in the document before it: a group named for the tool, with the five buttons the view supports, in the mock\'s order', () => {
    mount();
    const bar = toolbar();
    expect(within(bar).getAllByRole('button').map((one) => one.getAttribute('aria-label'))).toEqual(['Follow', 'Pause log updates', 'Show timestamps in UTC', 'Clear', 'Copy']);
    const view = screen.getByRole('group', { name: /^Log,/ });
    const regions = [...document.querySelectorAll('[role=toolbar], [role=group]')];
    expect(regions.indexOf(bar)).toBeGreaterThanOrEqual(0);
    expect(regions.indexOf(bar)).toBeLessThan(regions.indexOf(view));
    // It is the ARIA toolbar pattern the mock draws (`role="toolbar" aria-orientation="vertical" aria-label="Logs tools"`, shell-regions.js 319): one Tab stop, the arrows of a column.
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('draws the mock\'s glyphs', () => {
    mount();
    expect(['Follow', 'Pause log updates', 'Show timestamps in UTC', 'Clear', 'Copy'].map((name) => glyph(name))).toEqual(['arrow-down-to-line', 'pause', 'globe', 'eraser', 'copy']);
  });

  it('is one Tab stop and a column of arrows: the first button takes the Tab, the arrows move down and up and stop at the ends, Home and End go to them', () => {
    mount();
    const names = ['Follow', 'Pause log updates', 'Show timestamps in UTC', 'Clear', 'Copy'];
    expect(names.filter((name) => button(name).tabIndex === 0)).toEqual(['Follow']);
    button('Follow').focus();
    fireEvent.keyDown(button('Follow'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('Pause log updates'));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(button('Follow'));
    fireEvent.keyDown(button('Follow'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(button('Follow'));
    fireEvent.keyDown(button('Follow'), { key: 'End' });
    expect(document.activeElement).toBe(button('Copy'));
    fireEvent.keyDown(button('Copy'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('Copy'));
    fireEvent.keyDown(button('Copy'), { key: 'Home' });
    expect(document.activeElement).toBe(button('Follow'));
    // Left and Right are not the column's: they move nothing.
    fireEvent.keyDown(button('Follow'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(button('Follow'));
    // The Tab stop is the button that last had the focus.
    fireEvent.keyDown(button('Follow'), { key: 'ArrowDown' });
    expect(names.filter((name) => button(name).tabIndex === 0)).toEqual(['Pause log updates']);
  });

  it('gives each button its name as its tooltip, and a button that cannot apply its reason on a second line', () => {
    mount();
    expect(button('Follow').getAttribute('data-ov-tip')).toBe('Follow');
    expect(button('Pause log updates').getAttribute('data-ov-tip')).toBe('Pause log updates');
    expect(button('Copy').getAttribute('data-ov-tip')).toBe('Copy\nThere are no lines yet');
    expect(button('Clear').getAttribute('data-ov-tip')).toBe('Clear\nThere are no lines yet');
  });

  it('is not drawn for a session that has no stream: there is nothing in it to follow, pause, clear or copy', () => {
    mount({ stream: false });
    expect(screen.queryByRole('toolbar', { name: 'Logs tools' })).toBeNull();
  });
});

describe('what a button that cannot apply says', () => {
  it('keeps Clear and Copy for lines: unavailable, focusable, with the reason as their description, and a press does nothing', () => {
    const { feed } = mount();
    for (const name of ['Clear', 'Copy']) {
      const one = button(name);
      expect(one.getAttribute('aria-disabled')).toBe('true');
      expect(one.hasAttribute('disabled')).toBe(false);
      expect(one.getAttribute('aria-describedby')).not.toBeNull();
      expect(document.getElementById(one.getAttribute('aria-describedby') ?? '')?.textContent).toBe('There are no lines yet');
      fireEvent.click(one);
    }

    expect(written).toEqual([]);
    feedLines(feed, 5);
    expect(button('Clear').getAttribute('aria-disabled')).toBeNull();
    expect(button('Copy').getAttribute('aria-disabled')).toBeNull();
  });

  it('cannot Pause a stream that ended, and says so in the mock\'s words', () => {
    const { feed } = mount();
    expect(button('Pause log updates').getAttribute('aria-disabled')).toBeNull();
    act(() => {
      feed.set({ state: 'ended' });
    });
    frames(1);
    expect(button('Pause log updates').getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(button('Pause log updates').getAttribute('aria-describedby') ?? '')?.textContent).toBe('The stream has ended');
    fireEvent.click(button('Pause log updates'));
    expect(feed.controls()).toBe(0);
  });

  it('keeps Follow and the timestamps available whatever the stream does', () => {
    const { feed } = mount({ state: 'failed' });
    frames(2);
    expect(button('Follow').getAttribute('aria-disabled')).toBeNull();
    expect(button('Show timestamps in UTC').getAttribute('aria-disabled')).toBeNull();
    expect(feed.controls()).toBe(0);
  });
});

describe('Pause log updates', () => {
  it('holds the stream\'s reads and says it is pressed; the view draws no more, and the strip counts the lines that wait (the mock: Paused, N new lines waiting)', () => {
    const { feed } = mount();
    feedLines(feed, 20);
    fireEvent.click(button('Pause log updates'));
    frames(1);
    expect(feed.getSnapshot().paused).toBe(true);
    expect(button('Pause log updates').getAttribute('aria-pressed')).toBe('true');
    feedLines(feed, 35);
    frames(30);
    expect(rowCount()).toBe('21');
    expect(strip()).toContain('Paused, 35 new lines waiting');
  });

  it('lets them through when pressed again: the lines that waited are drawn, and the button is not pressed', () => {
    const { feed } = mount();
    feedLines(feed, 20);
    fireEvent.click(button('Pause log updates'));
    feedLines(feed, 35);
    fireEvent.click(button('Pause log updates'));
    frames(5);
    expect(feed.getSnapshot().paused).toBe(false);
    expect(button('Pause log updates').getAttribute('aria-pressed')).toBe('false');
    expect(rowCount()).toBe('56');
  });

  it('is pressed when the strip\'s Resume lifts it, and when the stream is paused by anyone: it reads the stream\'s pause', () => {
    const { feed } = mount();
    feedLines(feed, 5);
    act(() => {
      feed.pause();
    });
    frames(1);
    expect(button('Pause log updates').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    frames(1);
    expect(button('Pause log updates').getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles from what the stream is when it is pressed, not from what was last drawn: two presses before React draws again hold it and let it go', () => {
    const { feed } = mount();
    feedLines(feed, 20);
    const pause = button('Pause log updates');
    act(() => {
      pause.click();
      pause.click();
    });
    expect(feed.getSnapshot().paused).toBe(false);
    expect(feed.controls()).toBe(2);
    expect(button('Pause log updates').getAttribute('aria-pressed')).toBe('false');
  });

  it('costs one commit to hold the stream and one to let it go', () => {
    const { feed, commits } = mount();
    feedLines(feed, 20);
    frames(30);
    const before = commits();
    fireEvent.click(button('Pause log updates'));
    expect(commits() - before).toBe(1);
    const held = commits();
    fireEvent.click(button('Pause log updates'));
    expect(commits() - held).toBe(1);
  });
});

describe('Follow', () => {
  it('is pressed while the view follows; pressed again it stops following where the list is, and the strip says it is scrolled back', () => {
    const { feed } = mount();
    feedLines(feed, 100);
    expect(button('Follow').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('Follow'));
    frames(1);
    expect(button('Follow').getAttribute('aria-pressed')).toBe('false');
    feedLines(feed, 10);
    expect(strip()).toContain('Scrolled back, 10 new lines');
  });

  it('toggles from what the view is when it is pressed: two presses before React draws again stop following and follow again', () => {
    const { feed } = mount();
    feedLines(feed, 100);
    const follow = button('Follow');
    act(() => {
      follow.click();
      follow.click();
    });
    frames(2);
    expect(button('Follow').getAttribute('aria-pressed')).toBe('true');
  });

  it('follows again at the end of the log when pressed, and says so', () => {
    const { feed } = mount();
    feedLines(feed, 100);
    fireEvent.click(button('Follow'));
    feedLines(feed, 10);
    fireEvent.click(button('Follow'));
    frames(3);
    expect(button('Follow').getAttribute('aria-pressed')).toBe('true');
    expect(strip()).toContain('Following');
    expect(rowCount()).toBe('111');
  });

  it('is not pressed when the reader scrolls away: it reads the view\'s own following', () => {
    const { feed } = mount();
    feedLines(feed, 200);
    const list = screen.getByRole('grid');
    act(() => {
      fireEvent.wheel(list, { deltaY: -120 });
    });
    frames(1);
    expect(button('Follow').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Clear', () => {
  it('forgets the lines the view holds: the stream is neither paused nor closed, and the lines that come after are drawn', () => {
    const { feed } = mount();
    feedLines(feed, 60);
    expect(rowCount()).toBe('61');
    fireEvent.click(button('Clear'));
    frames(2);
    expect(rowCount()).toBe('1');
    expect(feed.getSnapshot().paused).toBe(false);
    expect(feed.closed()).toBe(0);
    expect(feed.controls()).toBe(0);
    expect(button('Clear').getAttribute('aria-disabled')).toBe('true');
    feedLines(feed, 4);
    expect(rowCount()).toBe('5');
    expect(button('Clear').getAttribute('aria-disabled')).toBeNull();
  });

  it('says no line and nothing dropped on the strip', () => {
    const { feed } = mount();
    feedLines(feed, 60);
    fireEvent.click(button('Clear'));
    expect(strip()).toMatch(/^0 lines/);
    expect(strip()).not.toContain('dropped');
  });
});

describe('Copy', () => {
  it('writes every line the list draws, a line each, with the source of each (its label, as the Source column names it), and says how many it wrote', async () => {
    const { feed } = mount({ sources: [{ id: 'orders-api/app', label: 'app' }, { id: 'orders-api/sidecar', label: 'sidecar' }] });
    act(() => {
      feed.push(2, 'orders-api/app');
      feed.push(1, 'orders-api/sidecar');
      vi.advanceTimersByTime(16);
    });
    fireEvent.click(button('Copy'));
    await settle();
    expect(written).toHaveLength(1);
    const lines = (written[0] ?? '').split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/ app {2}line 1$/);
    expect(lines[2]).toMatch(/ sidecar {2}line 3$/);
    expect(screen.getByText('3 lines copied')).toBeInTheDocument();
  });

  it('writes every line the list draws when some are selected: the keyboard\'s copy is the selection\'s, and the mock\'s Copy writes the lines of its view (shell-panel.js 2063-2070)', async () => {
    const { feed } = mount();
    feedLines(feed, 10);
    const rowsDrawn = screen.queryAllByRole('row').filter((row) => row.getAttribute('data-n') !== null);
    fireEvent.click(rowsDrawn[2]);
    fireEvent.click(rowsDrawn[4], { shiftKey: true });
    fireEvent.click(button('Copy'));
    await settle();
    expect((written[0] ?? '').split('\n')).toHaveLength(10);
    expect(screen.getByText('10 lines copied')).toBeInTheDocument();
  });

  it('confirms itself with a check for two seconds and keeps its name', async () => {
    const { feed } = mount();
    feedLines(feed, 3);
    expect(glyph('Copy')).toBe('copy');
    fireEvent.click(button('Copy'));
    await settle();
    expect(glyph('Copy')).toBe('check');
    expect(button('Copy').getAttribute('aria-label')).toBe('Copy');
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(glyph('Copy')).toBe('check');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(glyph('Copy')).toBe('copy');
  });

  it('restarts its two seconds with each copy: a second copy at 1.5 s keeps the check until 3.5 s, not 2', async () => {
    const { feed } = mount();
    feedLines(feed, 3);
    fireEvent.click(button('Copy'));
    await settle();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.click(button('Copy'));
    await settle();
    expect(glyph('Copy')).toBe('check');
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(glyph('Copy')).toBe('check');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(glyph('Copy')).toBe('copy');
  });

  it('announces a second copy of the same lines again: the polite region is a new message', async () => {
    const { feed } = mount();
    feedLines(feed, 3);
    fireEvent.click(button('Copy'));
    await settle();
    const first = screen.getByText('3 lines copied');
    fireEvent.click(button('Copy'));
    await settle();
    expect(screen.getByText('3 lines copied')).not.toBe(first);
  });

  it('says it could not when the clipboard is not there, and does not confirm', async () => {
    const { feed } = mount();
    feedLines(feed, 3);
    clipboardWorks = false;
    fireEvent.click(button('Copy'));
    await settle();
    expect(glyph('Copy')).toBe('copy');
    expect(screen.getByText(/^Couldn't copy\./)).toBeInTheDocument();
  });

  it('writes the lines the level filter lets through and no others: what is hidden is not drawn and is not copied', async () => {
    const { feed } = mount();
    feedLines(feed, 5);
    fireEvent.click(screen.getByRole('radio', { name: 'Error' }));
    frames(2);
    expect(button('Copy').getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(button('Copy').getAttribute('aria-describedby') ?? '')?.textContent).toBe('No lines match the filters');
    // The lines are held, so they can be cleared.
    expect(button('Clear').getAttribute('aria-disabled')).toBeNull();
  });
});

describe('Show timestamps in UTC', () => {
  const STAMP = '2024-01-15T10:30:00.123Z';
  const clocks = (): string[] => screen.queryAllByRole('row').filter((row) => row.getAttribute('data-n') !== null).map((row) => row.querySelector('[data-ov-tip]')?.textContent ?? '');
  const lines = (feed: FakeFeed) => {
    act(() => {
      feed.push(3, 'source/main', STAMP);
      vi.advanceTimersByTime(16);
    });
  };

  it('is not pressed at first: the rows show the viewer\'s own clock, with no mark of a zone', () => {
    const { feed } = mount();
    lines(feed);
    expect(button('Show timestamps in UTC').getAttribute('aria-pressed')).toBe('false');
    expect(clocks()).toHaveLength(3);
    expect(clocks().every((clock) => /^\d\d:\d\d:\d\d\.\d{3}$/.test(clock))).toBe(true);
  });

  it('is pressed, and the rows show UTC with its Z; pressed again the viewer\'s own clock is back, and every line stayed', () => {
    const { feed } = mount();
    lines(feed);
    fireEvent.click(button('Show timestamps in UTC'));
    frames(1);
    expect(button('Show timestamps in UTC').getAttribute('aria-pressed')).toBe('true');
    expect(clocks()).toEqual(['10:30:00.123Z', '10:30:00.123Z', '10:30:00.123Z']);
    expect(rowCount()).toBe('4');
    fireEvent.click(button('Show timestamps in UTC'));
    frames(1);
    expect(button('Show timestamps in UTC').getAttribute('aria-pressed')).toBe('false');
    expect(clocks().every((clock) => !clock.endsWith('Z'))).toBe(true);
    expect(rowCount()).toBe('4');
  });

  it('is the clock a copy writes: the rows and the copy say the same time', async () => {
    const { feed } = mount();
    lines(feed);
    fireEvent.click(button('Show timestamps in UTC'));
    fireEvent.click(button('Copy'));
    await settle();
    expect((written[0] ?? '').split('\n').every((line) => line.startsWith('10:30:00.123Z '))).toBe(true);
    fireEvent.click(button('Show timestamps in UTC'));
    frames(1);
    fireEvent.click(button('Copy'));
    await settle();
    // Two copies, the second in the viewer's own clock: each line starts with the clock its own row shows (whatever the time zone of the machine).
    expect(written).toHaveLength(2);
    const shown = clocks();
    const copied = written[1]?.split('\n') ?? [];
    expect(shown).toHaveLength(3);
    expect(shown.some((clock) => clock.endsWith('Z'))).toBe(false);
    expect(copied).toHaveLength(shown.length);
    copied.forEach((line, index) => {
      expect(line.startsWith(`${shown[index] ?? '?'} `)).toBe(true);
    });
  });
});

describe('the session\'s own state', () => {
  it('keeps what the session chose while it is not on screen and when it comes back: UTC, a pause, Follow off, a clear', () => {
    const { feed, show } = mount();
    feedLines(feed, 100);
    fireEvent.click(button('Show timestamps in UTC'));
    fireEvent.click(button('Pause log updates'));
    fireEvent.click(button('Follow'));
    frames(1);
    show(false);
    show(true);
    frames(2);
    expect(button('Show timestamps in UTC').getAttribute('aria-pressed')).toBe('true');
    expect(button('Pause log updates').getAttribute('aria-pressed')).toBe('true');
    expect(button('Follow').getAttribute('aria-pressed')).toBe('false');
    expect(feed.getSnapshot().paused).toBe(true);
  });

  it('is its own: another session of the Logs tool has its own toolbar and its own choices', () => {
    const first = mount();
    fireEvent.click(button('Show timestamps in UTC'));
    cleanup();
    const second = mount();
    expect(button('Show timestamps in UTC').getAttribute('aria-pressed')).toBe('false');
    expect(first.feed).not.toBe(second.feed);
  });
});

describe('a toolbar that is not on screen', () => {
  it('holds no listener of its own on the stream and does no work: the stream goes on, nothing is drawn, no timer runs', () => {
    const { feed, show, commits } = mount();
    feedLines(feed, 100);
    // The registry's listener and the view's two; the toolbar reads the view, not the stream.
    expect(feed.listeners()).toBe(3);
    show(false);
    expect(feed.listeners()).toBe(1);
    const commitsAtHide = commits();
    const reads = feed.reads();
    for (let second = 0; second < 5; second += 1) {
      act(() => {
        feed.push(10_000);
        vi.advanceTimersByTime(1_000);
      });
    }

    expect(commits()).toBe(commitsAtHide);
    expect(feed.reads()).toBe(reads);
    expect(vi.getTimerCount()).toBe(0);
    show(true);
    expect(feed.listeners()).toBe(3);
  });

  it('lets go of the confirmation\'s clock while it is hidden', async () => {
    const { feed, show } = mount();
    feedLines(feed, 3);
    fireEvent.click(button('Copy'));
    await settle();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    show(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});


// A column that does not fit (the mock's rule, shell-regions.js 298-320): the buttons that do not fit are the LAST ones and stand behind a `⋯` More actions button that takes the last slot, so none is clipped and the
// column never scrolls. The shared menu lists them. jsdom has no layout and no Popover API: the column's height is the test's, the observer is a stub the test calls, and the menu is given what a browser would.
describe('a column that does not fit', () => {
  const observers: Array<() => void> = [];
  let popoverRule: HTMLStyleElement;
  let stubbed = false;

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();

      constructor(callback: () => void) {
        observers.push(callback);
      }
    });

    popoverRule = document.createElement('style');
    popoverRule.textContent = '[popover] { display: block !important; }';
    document.head.append(popoverRule);
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 800 });
    // The test environment may have the Popover API (then it is what shows the menu) or not (then the rule above does).
    if (typeof HTMLElement.prototype.showPopover !== 'function') {
      HTMLElement.prototype.showPopover = function showPopover() {
        return undefined;
      };

      stubbed = true;
    }
  });

  afterEach(() => {
    popoverRule.remove();
    vi.unstubAllGlobals();
    if (stubbed) {
      delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
      stubbed = false;
    }
  });

  const names = () => within(toolbar()).getAllByRole('button').map((one) => one.getAttribute('aria-label'));
  const resize = (height: number) => {
    column.height = height;
    act(() => {
      for (const callback of observers) {
        callback();
      }
    });
  };

  it('keeps every button when the body holds them: 229 px (1440 x 900) and 199 px (1280 x 800) hold the five, and no More button is drawn', () => {
    column.height = 229;
    mount();
    expect(names()).toEqual(['Follow', 'Pause log updates', 'Show timestamps in UTC', 'Clear', 'Copy']);
    cleanup();
    column.height = 199;
    mount();
    expect(names()).toEqual(['Follow', 'Pause log updates', 'Show timestamps in UTC', 'Clear', 'Copy']);
  });

  it('keeps the first buttons and puts the last behind More actions: the panel\'s least body, 79 px, holds two slots, one for Follow and one for the More button', () => {
    column.height = 79;
    mount();
    expect(names()).toEqual(['Follow', 'More actions']);
    expect(button('More actions').getAttribute('aria-haspopup')).toBe('menu');
    expect(button('More actions').getAttribute('data-ov-tip')).toBe('More actions');
    column.height = 159;
    cleanup();
    mount();
    expect(names()).toEqual(['Follow', 'Pause log updates', 'Show timestamps in UTC', 'More actions']);
  });

  it('lists what does not fit in the menu, in the column\'s order, each saying what pressing it does; a press acts, and the menu closes', async () => {
    column.height = 79;
    const { feed } = mount();
    feedLines(feed, 12);
    fireEvent.click(button('More actions'));
    const menu = screen.getByRole('menu', { name: 'Logs actions' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Pause log updates', 'Show timestamps in UTC', 'Clear', 'Copy']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Pause log updates' }));
    expect(feed.getSnapshot().paused).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    // The toggle is not drawn, so the item says its state in its words.
    fireEvent.click(button('More actions'));
    expect(within(screen.getByRole('menu', { name: 'Logs actions' })).getAllByRole('menuitem').map((item) => item.textContent)[0]).toBe('Resume log updates');
    fireEvent.click(within(screen.getByRole('menu', { name: 'Logs actions' })).getByRole('menuitem', { name: 'Clear' }));
    frames(2);
    expect(rowCount()).toBe('1');
  });

  it('dismisses the old Pause command when the feed pauses independently and offers Resume on reopening', () => {
    column.height = 79;
    const { feed, show } = mount();
    const trigger = button('More actions');
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Logs actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Pause log updates' })).toBeInTheDocument();

    show(true);
    expect(screen.getByRole('menu')).toBe(menu);

    act(() => {
      feed.set({ state: 'paused', paused: true });
    });
    frames(2);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(feed.getSnapshot().paused).toBe(true);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resume log updates' }));
    expect(feed.getSnapshot().paused).toBe(false);
  });

  it('says an item cannot apply, as the button would, and why: Clear and Copy with no line are unavailable in the menu, each with its reason in its text', () => {
    column.height = 79;
    mount();
    fireEvent.click(button('More actions'));
    const menu = screen.getByRole('menu', { name: 'Logs actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Clear (There are no lines yet)' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(menu).getByRole('menuitem', { name: 'Copy (There are no lines yet)' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(menu).getByRole('menuitem', { name: 'Pause log updates' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('says why Copy cannot apply when a level filter hides every line, in the item\'s text', () => {
    column.height = 79;
    const { feed } = mount();
    feedLines(feed, 6);
    fireEvent.click(screen.getByRole('radio', { name: 'Error' }));
    frames(2);
    fireEvent.click(button('More actions'));
    const menu = screen.getByRole('menu', { name: 'Logs actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Copy (No lines match the filters)' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(menu).getByRole('menuitem', { name: 'Clear' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('draws the buttons again when the body grows, and puts them away when it shrinks: the observer\'s callback measures the column', () => {
    column.height = 229;
    mount();
    expect(names()).toHaveLength(5);
    resize(79);
    expect(names()).toEqual(['Follow', 'More actions']);
    resize(199);
    expect(names()).toEqual(['Follow', 'Pause log updates', 'Show timestamps in UTC', 'Clear', 'Copy']);
  });

  it('is still one Tab stop and a column of arrows, with the More button last: ArrowDown reaches it and stops, ArrowUp from it goes back and does not open the menu', () => {
    column.height = 79;
    mount();
    expect(within(toolbar()).getAllByRole('button').filter((one) => one.tabIndex === 0)).toHaveLength(1);
    button('Follow').focus();
    fireEvent.keyDown(button('Follow'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('More actions'));
    fireEvent.keyDown(button('More actions'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('More actions'));
    fireEvent.keyDown(button('More actions'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(button('Follow'));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(button('Follow'), { key: 'End' });
    expect(document.activeElement).toBe(button('More actions'));
  });

  it('keeps the menu out of the toolbar: its items are not stops of the toolbar and the toolbar holds only its buttons', () => {
    column.height = 79;
    mount();
    fireEvent.click(button('More actions'));
    expect(within(toolbar()).queryAllByRole('menuitem')).toEqual([]);
    expect(names()).toEqual(['Follow', 'More actions']);
  });

  it('keeps the keyboard in the toolbar when the More button goes: the panel grows while it has the focus, and the button that took its slot has it', () => {
    column.height = 79;
    mount();
    button('Follow').focus();
    fireEvent.keyDown(button('Follow'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('More actions'));
    resize(229);
    expect(names()).toEqual(['Follow', 'Pause log updates', 'Show timestamps in UTC', 'Clear', 'Copy']);
    expect(document.activeElement).toBe(button('Pause log updates'));
    // The arrows go on from there.
    fireEvent.keyDown(button('Pause log updates'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('Show timestamps in UTC'));
  });

  it('keeps the keyboard in the toolbar when the button that has it goes behind More: the panel shrinks, and the More button has the focus', () => {
    column.height = 229;
    mount();
    button('Copy').focus();
    expect(document.activeElement).toBe(button('Copy'));
    resize(79);
    expect(names()).toEqual(['Follow', 'More actions']);
    expect(document.activeElement).toBe(button('More actions'));
  });

  it('leaves the focus alone when it is not in the toolbar: a resize moves nothing the reader chose', () => {
    column.height = 229;
    mount();
    const find = screen.getByRole('searchbox');
    find.focus();
    resize(79);
    expect(document.activeElement).toBe(find);
  });
});
