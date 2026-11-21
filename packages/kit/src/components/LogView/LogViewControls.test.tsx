// The controls of a log view (P1b-4a): what a toolbar beside the view reads and does, through one object the view binds itself to. jsdom has no layout: the geometry the list reads is stubbed on the
// elements that report it, and time is the test's, as in LogView.test.tsx. What is asserted is what the object says, what its calls do to the view and to the feed, and how often React commits.
import { act, render, type RenderResult } from '@testing-library/react';
import { Profiler, useSyncExternalStore, type ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogViewControls, type LogViewControls, type LogViewState } from './LogViewControls';
import { LogView } from './LogView';
import { SyntheticFeed } from './syntheticFeed';

const LIST = { height: 625, header: 25, row: 24 };
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

/** A control that reads the controls as a toolbar does, and shows what it read. */
function Reader({ controls, onRender }: { readonly controls: LogViewControls; readonly onRender?: ((state: LogViewState) => void) | undefined }): ReactElement {
  const state = useSyncExternalStore(controls.subscribe, controls.getSnapshot);
  onRender?.(state);
  return (
    <output data-testid="state">
      {state.following ? 'following' : 'scrolled'} {state.drawn ? 'drawn' : 'empty'} {state.held ? 'held' : 'none'} {state.paused ? 'paused' : 'running'} {state.feed}
    </output>
  );
}

function mount(options: { readonly lines?: number; readonly controls?: LogViewControls | undefined; readonly onCommit?: () => void } = {}) {
  const feed = new SyntheticFeed({ rate: 0 });
  if ((options.lines ?? 0) > 0) {
    feed.emit(options.lines ?? 0);
  }

  const controls = options.controls ?? createLogViewControls();
  const tree = (
    <Profiler id="log" onRender={() => options.onCommit?.()}>
      <Reader controls={controls} />
      <LogView label="app" feed={feed} controls={controls} />
    </Profiler>
  );
  const view = render(tree);
  frame(2);
  return { feed, controls, view };
}

const strip = (view: RenderResult) => view.getByRole('group', { name: 'Session status' }).textContent ?? '';
const rows = (view: RenderResult) => view.getByRole('grid').getAttribute('aria-rowcount');

describe('a control object that no view is bound to', () => {
  it('says what a view that has not begun is: following, drawing nothing, holding nothing, going', () => {
    const controls = createLogViewControls();
    expect(controls.getSnapshot()).toEqual({ following: true, drawn: false, held: false, paused: false, feed: 'starting' });
  });

  it('does nothing when asked, and says nothing: a toolbar that is drawn before its view is not an error', () => {
    const controls = createLogViewControls();
    const told = vi.fn();
    controls.subscribe(told);
    expect(() => {
      controls.follow(true);
      controls.follow(false);
      controls.pause(true);
      controls.pause(false);
      controls.clear();
    }).not.toThrow();
    expect(controls.copy()).toBeUndefined();
    expect(told).not.toHaveBeenCalled();
  });

  it('keeps one snapshot for as long as nothing changes', () => {
    const controls = createLogViewControls();
    expect(controls.getSnapshot()).toBe(controls.getSnapshot());
  });
});

describe('the view that is given the object', () => {
  it('binds before it is drawn: the first thing a control reads is the view\'s own state, and the feed\'s', () => {
    const { view } = mount({ lines: 0 });
    expect(view.getByTestId('state').textContent).toBe('following empty none running streaming');
  });

  it('tells when the first lines are drawn, and keeps what it says through the lines that follow', () => {
    const rendered: LogViewState[] = [];
    const feed = new SyntheticFeed({ rate: 0 });
    const controls = createLogViewControls();
    render(
      <>
        <Reader controls={controls} onRender={(state) => rendered.push(state)} />
        <LogView label="app" feed={feed} controls={controls} />
      </>,
    );
    frame(2);
    const before = rendered.length;
    act(() => {
      feed.emit(50);
    });
    frame(2);
    expect(controls.getSnapshot()).toMatchObject({ drawn: true, held: true });
    const afterFirst = rendered.length;
    expect(afterFirst).toBeGreaterThan(before);
    for (let batch = 0; batch < 10; batch += 1) {
      act(() => {
        feed.emit(50);
      });
      frame(1);
    }

    expect(rendered.length).toBe(afterFirst);
  });

  it('stops being bound when the view goes: the object keeps its last word and does nothing', () => {
    const { view, controls, feed } = mount({ lines: 20 });
    expect(controls.getSnapshot().drawn).toBe(true);
    view.unmount();
    const last = controls.getSnapshot();
    expect(() => {
      controls.clear();
      controls.pause(true);
      controls.follow(false);
    }).not.toThrow();
    expect(feed.getSnapshot().paused).toBe(false);
    expect(controls.copy()).toBeUndefined();
    expect(controls.getSnapshot()).toBe(last);
  });

  it('lets go of its listener on the feed and on the model when the view goes', () => {
    const { view, controls } = mount({ lines: 5 });
    const told = vi.fn();
    controls.subscribe(told);
    view.unmount();
    expect(told).not.toHaveBeenCalled();
  });
});

describe('Pause', () => {
  it('holds the feed, says so, and the strip says how many lines wait: the lines are counted and not drawn', () => {
    const { view, controls, feed } = mount({ lines: 10 });
    act(() => {
      controls.pause(true);
    });
    frame(1);
    expect(feed.getSnapshot().paused).toBe(true);
    expect(view.getByTestId('state').textContent).toContain('paused');
    act(() => {
      feed.emit(25);
    });
    frame(20);
    expect(rows(view)).toBe('11');
    vi.advanceTimersByTime(400);
    frame(2);
    expect(strip(view)).toContain('Paused, 25 new lines waiting');
    expect(view.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('lets the lines through when it is lifted, and they are drawn', () => {
    const { view, controls, feed } = mount({ lines: 10 });
    act(() => {
      controls.pause(true);
    });
    act(() => {
      feed.emit(25);
    });
    frame(5);
    act(() => {
      controls.pause(false);
    });
    frame(5);
    expect(feed.getSnapshot().paused).toBe(false);
    expect(rows(view)).toBe('36');
    expect(view.getByTestId('state').textContent).toContain('running');
  });

  it('is lifted by the strip\'s own Resume, and the controls say so: they read the feed\'s pause, not their own', () => {
    const { view, controls } = mount({ lines: 10 });
    act(() => {
      controls.pause(true);
    });
    frame(1);
    expect(controls.getSnapshot().paused).toBe(true);
    act(() => {
      view.getByRole('button', { name: 'Resume' }).click();
    });
    frame(1);
    expect(controls.getSnapshot().paused).toBe(false);
  });

  it('costs one commit, to lift as to hold: the control and the strip are drawn together (the pause is the feed\'s status, which both read; the real engine counts it at 10,000 lines a second: ui-next/shell/probes/logs-probe.mjs)', () => {
    let commits = 0;
    const feed = new SyntheticFeed({ rate: 0 });
    feed.emit(10);
    const controls = createLogViewControls();
    render(
      <Profiler
        id="log"
        onRender={() => {
          commits += 1;
        }}
      >
        <Reader controls={controls} />
        <LogView label="app" feed={feed} controls={controls} />
      </Profiler>,
    );
    frame(3);
    vi.advanceTimersByTime(600);
    frame(3);
    const before = commits;
    act(() => {
      controls.pause(true);
    });
    expect(commits - before).toBe(1);
    const resumed = commits;
    act(() => {
      controls.pause(false);
    });
    expect(commits - resumed).toBe(1);
  });
});

describe('Follow', () => {
  it('stops following where the list is, and the strip says it is scrolled back', () => {
    const { view, controls } = mount({ lines: 100 });
    expect(view.getByTestId('state').textContent).toContain('following');
    act(() => {
      controls.follow(false);
    });
    frame(1);
    expect(controls.getSnapshot().following).toBe(false);
    expect(view.getByTestId('state').textContent).toContain('scrolled');
    vi.advanceTimersByTime(400);
    frame(2);
    expect(strip(view)).toContain('Scrolled back');
  });

  it('follows again at the end of the log, and lets a paused feed through, as the strip\'s Jump to latest does', () => {
    const { view, controls, feed } = mount({ lines: 100 });
    act(() => {
      controls.pause(true);
      controls.follow(false);
    });
    act(() => {
      feed.emit(10);
    });
    frame(3);
    act(() => {
      controls.follow(true);
    });
    frame(3);
    expect(controls.getSnapshot()).toMatchObject({ following: true, paused: false });
    expect(feed.getSnapshot().paused).toBe(false);
    expect(rows(view)).toBe('111');
  });
});

describe('Clear', () => {
  it('drops the lines the view holds and keeps the stream: the feed is not paused, closed or listened to differently', () => {
    const { view, controls, feed } = mount({ lines: 40 });
    expect(rows(view)).toBe('41');
    act(() => {
      controls.clear();
    });
    frame(2);
    expect(rows(view)).toBe('1');
    expect(controls.getSnapshot()).toMatchObject({ drawn: false, held: false });
    expect(feed.getSnapshot().paused).toBe(false);
    act(() => {
      feed.emit(3);
    });
    frame(2);
    expect(rows(view)).toBe('4');
  });

  it('tells the strip at once: no line, nothing dropped', () => {
    const { view, controls } = mount({ lines: 40 });
    act(() => {
      controls.clear();
    });
    frame(2);
    vi.advanceTimersByTime(300);
    frame(2);
    expect(strip(view)).toMatch(/^0 lines/);
    expect(strip(view)).not.toContain('dropped');
  });
});

describe('Copy', () => {
  it('copies every line the list draws, and says how many', () => {
    const { controls } = mount({ lines: 12 });
    const copied = controls.copy();
    expect(copied?.lines).toBe(12);
    expect(copied?.text.split('\n')).toHaveLength(12);
  });

  it('copies the lines in the clock the caller says the rows show', () => {
    const feed = new SyntheticFeed({ rate: 0, clock: () => Date.UTC(2024, 0, 15, 10, 30, 0, 123) });
    feed.emit(1);
    const controls = createLogViewControls();
    render(<LogView label="app" feed={feed} controls={controls} timestamps="utc" />);
    frame(2);
    expect(controls.copy('utc')?.text).toMatch(/^10:30:00\.123Z /);
  });

  it('is nothing for a view that draws nothing', () => {
    const { controls } = mount({ lines: 0 });
    expect(controls.copy()).toBeUndefined();
  });
});
