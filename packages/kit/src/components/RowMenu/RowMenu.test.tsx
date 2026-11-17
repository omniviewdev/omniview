// The row menu as a person meets it: a button in each row, and one menu for the table that opens from it. jsdom has no layout and no Popover
// API, so the tests give the part what a browser would (a trigger's rectangle, the popup's size, the window's size, showPopover) and assert
// structure, focus, calls and the numbers the placement writes; the probe reads the same menu in WebKit and Chromium
// (probes/row-menu-probe.mjs). The exact counts (popup roots, listeners, renders) are in RowMenu.counts.test.tsx.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as examples from './RowMenu.examples';
import { RowMenu } from './RowMenu';
import { RowMenuTrigger } from './RowMenuTrigger';
import { createRowMenu, type RowMenuHandle } from './handle';
import type { RowMenuItem } from './RowMenu';

type Job = { readonly key: string; readonly name: string; readonly paused?: boolean };
const WEB_1: Job = { key: 'a', name: 'web-1' };
const WEB_2: Job = { key: 'b', name: 'web-2' };
const WORKER: Job = { key: 'c', name: 'worker-1', paused: true };
const JOBS: readonly Job[] = [WEB_1, WEB_2, WORKER];

const VIEWPORT = { width: 1000, height: 800 };
const POPUP = { width: 200, height: 120 };

const rects = new WeakMap<Element, { left: number; top: number; width: number; height: number }>();
const shown: Element[] = [];
const calls: string[] = [];

const rectOf = ({ left, top, width, height }: { left: number; top: number; width: number; height: number }): DOMRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

/** Where a trigger is, for the one measurement the menu makes of it. */
function layout(element: Element, left: number, top: number, width = 24, height = 24) {
  rects.set(element, { left, top, width, height });
}

let rectSpy: MockInstance<Element['getBoundingClientRect']>;
let errors: MockInstance<Console['error']>;
let popoverRule: HTMLStyleElement;

beforeEach(() => {
  // jsdom's default stylesheet hides every popover that is not `:popover-open`, a state it cannot match, so nothing in one could be focused
  // or found by role. A browser shows the popover once showPopover has run: this is the same rule, in the page.
  popoverRule = document.createElement('style');
  popoverRule.textContent = '[popover] { display: block; }';
  document.head.append(popoverRule);
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function measure(this: Element) {
    if (this.getAttribute('role') === 'menu') {
      calls.push('measure popup');
      return rectOf({ left: 0, top: 0, ...POPUP });
    }

    return rectOf(rects.get(this) ?? { left: 0, top: 0, width: 0, height: 0 });
  });
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: VIEWPORT.width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: VIEWPORT.height });
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) {
    shown.push(this);
    calls.push('showPopover');
  };

  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  // A warning from React (an update outside act, a missing key) is a failure of the part, not noise.
  expect(errors.mock.calls).toEqual([]);
  shown.length = 0;
  calls.length = 0;
  popoverRule.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
  vi.restoreAllMocks();
});

const defined = <T,>(value: T | null | undefined, what: string): T => {
  if (value === undefined || value === null) {
    throw new Error(`no ${what}`);
  }

  return value;
};

type Log = Array<readonly [string, string]>;

/** The items of a job: the second is unavailable for a paused job, the last destroys it and sits apart. */
const itemsFor = (log: Log) => (row: Job): ReadonlyArray<RowMenuItem<Job>> => [
  { id: 'inspect', label: 'Inspect', onSelect: (target) => {
    log.push(['inspect', target.key]);
  } },
  { id: 'pause', label: 'Pause', disabled: row.paused === true, onSelect: (target) => {
    log.push(['pause', target.key]);
  } },
  { id: 'rerun', label: 'Run again', onSelect: (target) => {
    log.push(['rerun', target.key]);
  } },
  { id: 'delete', label: 'Delete\u2026', destructive: true, separatorBefore: true, onSelect: (target) => {
    log.push(['delete', target.key]);
  } },
];

type TableProps = {
  readonly handle: RowMenuHandle<Job>;
  readonly items: (row: Job) => ReadonlyArray<RowMenuItem<Job>>;
  readonly jobs?: readonly Job[];
  readonly onRegionKeyDown?: () => void;
};

function Table({ handle, items, jobs = JOBS, onRegionKeyDown }: TableProps): ReactElement {
  return (
    <div role="region" aria-label="Jobs" tabIndex={0} onKeyDown={onRegionKeyDown}>
      {jobs.map((job) => (
        <RowMenuTrigger key={job.key} handle={handle} row={job} label={`Actions for ${job.name}`} />
      ))}
      <RowMenu handle={handle} label="Job actions" items={items} />
    </div>
  );
}

function setup(options: { log?: Log; jobs?: readonly Job[] } = {}) {
  const log = options.log ?? [];
  const handle = createRowMenu<Job>();
  const items = vi.fn(itemsFor(log));
  const view = render(<Table handle={handle} items={items} {...(options.jobs === undefined ? {} : { jobs: options.jobs })} />);
  return { log, handle, items, view };
}

const trigger = (name: string): HTMLElement => screen.getByRole('button', { name: `Actions for ${name}` });
const menu = (): HTMLElement => screen.getByRole('menu');
const entries = (): HTMLElement[] => within(menu()).getAllByRole('menuitem');
const entry = (label: string): HTMLElement => within(menu()).getByRole('menuitem', { name: label });
const pointerClick = (element: Element) => {
  fireEvent.click(element, { detail: 1 });
};

const keyClick = (element: Element) => {
  fireEvent.click(element, { detail: 0 });
};

const press = (element: Element, key: string, init: KeyboardEventInit = {}): boolean => fireEvent.keyDown(element, { key, ...init });
const focused = () => document.activeElement;
const labelOfFocused = () => focused()?.textContent;

/** A DOM change and the microtask that observes it, inside act, so that what React does about it is not an unwrapped update. */
const mutate = async (change: () => void) => {
  await act(async () => {
    change();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('the popup', () => {
  it('renders nothing while closed: no element, so no popup root', () => {
    const { view } = setup();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(0);
    expect(within(screen.getByRole('region')).getAllByRole('button')).toHaveLength(3);
    expect(view.container.querySelectorAll('[popover]')).toHaveLength(0);
  });

  it('opens exactly one popup root, named by its label, holding the items of the row that opened it, in order', () => {
    setup();
    pointerClick(trigger('web-1'));
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(menu().getAttribute('aria-label')).toBe('Job actions');
    expect(entries().map((item) => item.textContent)).toEqual(['Inspect', 'Pause', 'Run again', 'Delete\u2026']);
    expect(screen.getByRole('menu', { name: 'Job actions' })).toBe(menu());
  });

  it('builds the items only for the open menu, once per opening, from the payload row (T-08: only the open menu reads what changes)', () => {
    const { items } = setup();
    expect(items).not.toHaveBeenCalled();
    pointerClick(trigger('web-2'));
    expect(items).toHaveBeenCalledTimes(1);
    expect(items).toHaveBeenLastCalledWith(WEB_2);
    press(menu(), 'Escape');
    expect(items).toHaveBeenCalledTimes(1);
    pointerClick(trigger('web-1'));
    expect(items).toHaveBeenCalledTimes(2);
    expect(items).toHaveBeenLastCalledWith(WEB_1);
  });

  it('draws one separator before an item that asks for it, and none before the first', () => {
    const log: Log = [];
    const handle = createRowMenu<Job>();
    const items = (): ReadonlyArray<RowMenuItem<Job>> => [
      { id: 'one', label: 'One', separatorBefore: true, onSelect: () => {
        log.push(['one', '']);
      } },
      { id: 'two', label: 'Two', onSelect: () => {
        log.push(['two', '']);
      } },
      { id: 'three', label: 'Three', separatorBefore: true, onSelect: () => {
        log.push(['three', '']);
      } },
    ];
    render(<Table handle={handle} items={items} />);
    pointerClick(trigger('web-1'));
    const separators = within(menu()).getAllByRole('separator');
    expect(separators).toHaveLength(1);
    expect(separators[0]?.nextElementSibling?.textContent).toBe('Three');
    expect(menu().firstElementChild?.getAttribute('role')).toBe('menuitem');
  });

  it('has the ARIA of a menu: items that are menu items and never Tab stops, a destructive one that says so, an unavailable one that is announced', () => {
    setup({ jobs: [WORKER] });
    pointerClick(trigger('worker-1'));
    expect(menu().tabIndex).toBe(-1);
    for (const item of entries()) {
      expect(item.tagName).toBe('BUTTON');
      expect(item.getAttribute('type')).toBe('button');
      expect(item.getAttribute('tabindex')).toBe('-1');
      expect(item.hasAttribute('title')).toBe(false);
      expect(item.hasAttribute('disabled')).toBe(false);
    }

    const pause = entry('Pause');
    expect(pause.getAttribute('aria-disabled')).toBe('true');
    expect(entry('Inspect').hasAttribute('aria-disabled')).toBe(false);
    // Colour is never the only signal: the destructive row also says it.
    expect(entry('Delete\u2026').getAttribute('aria-description')).toBe('Destructive action');
    expect(entry('Delete\u2026').hasAttribute('data-ov-destructive')).toBe(true);
    expect(entry('Inspect').hasAttribute('aria-description')).toBe(false);
  });

  it('passes data-* through to the popup and nothing else', () => {
    const handle = createRowMenu<Job>();
    render(
      <div role="region" aria-label="Jobs" tabIndex={0}>
        <RowMenuTrigger handle={handle} row={WEB_1} label="Actions for web-1" />
        <RowMenu handle={handle} label="Job actions" items={itemsFor([])} data-testid="popup" />
      </div>,
    );
    pointerClick(trigger('web-1'));
    expect(menu().getAttribute('data-testid')).toBe('popup');
  });

  it('is typed closed: an item has these keys and no other, and the parts take no className and no style', () => {
    const handle = createRowMenu<Job>();
    const ok: RowMenuItem<Job> = { id: 'a', label: 'A', onSelect: () => undefined, disabled: false, destructive: false, separatorBefore: false };
    // @ts-expect-error the item is closed: no icon, no children, no handlers of its own
    const extra: RowMenuItem<Job> = { id: 'a', label: 'A', onSelect: () => undefined, icon: 'close' };
    // @ts-expect-error label and onSelect are required
    const bare: RowMenuItem<Job> = { id: 'a' };
    expect([ok, extra, bare]).toHaveLength(3);
    const nodes = [
      // @ts-expect-error closed props: no className
      <RowMenuTrigger key="1" handle={handle} row={WEB_1} label="x" className="x" />,
      // @ts-expect-error closed props: no style
      <RowMenu key="2" handle={handle} label="x" items={() => []} style={{ color: 'red' }} />,
    ];
    expect(nodes).toHaveLength(2);
  });
});

describe('the trigger', () => {
  it('is one native button with a glyph, three elements at most, and announces a menu', () => {
    setup({ jobs: [WEB_1] });
    const button = trigger('web-1');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-label')).toBe('Actions for web-1');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('ellipsis');
    expect(1 + button.querySelectorAll('*').length).toBeLessThanOrEqual(3);
    for (const attribute of ['title', 'style', 'tabindex', 'disabled', 'aria-expanded', 'aria-controls', 'aria-pressed']) {
      expect(button.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('writes aria-expanded and aria-controls on the one open trigger, by the handle, and they survive a render of that trigger', () => {
    const handle = createRowMenu<Job>();
    const items = itemsFor([]);
    const view = render(<Table handle={handle} items={items} />);
    pointerClick(trigger('web-1'));
    const open = trigger('web-1');
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.getAttribute('aria-controls')).toBe(menu().id);
    expect(menu().id).toBe(handle.id);
    for (const name of ['web-2', 'worker-1']) {
      expect(trigger(name).hasAttribute('aria-expanded')).toBe(false);
      expect(trigger(name).hasAttribute('aria-controls')).toBe(false);
    }

    // The trigger renders again (its row is a new object): React does not know these attributes and does not take them off.
    view.rerender(<Table handle={handle} items={items} jobs={[{ ...WEB_1 }, WEB_2, WORKER]} />);
    expect(trigger('web-1')).toBe(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.getAttribute('aria-controls')).toBe(handle.id);
    press(menu(), 'Escape');
    expect(open.hasAttribute('aria-expanded')).toBe(false);
    expect(open.hasAttribute('aria-controls')).toBe(false);
  });

  it('is a memoised part, so a row that renders it again with the same row renders it no more', () => {
    expect((RowMenuTrigger as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('opens for the row it was last given: a new object for the same record binds the new one', () => {
    const handle = createRowMenu<Job>();
    const items = itemsFor([]);
    const view = render(<Table handle={handle} items={items} />);
    const newer: Job = { key: 'a', name: 'web-1' };
    view.rerender(<Table handle={handle} items={items} jobs={[newer, WEB_2, WORKER]} />);
    pointerClick(trigger('web-1'));
    const state = handle.getSnapshot();
    expect(state.open).toBe(true);
    expect(state.open ? state.row : undefined).toBe(newer);
    expect(state.open ? state.row : undefined).not.toBe(WEB_1);
  });

  it('keeps the trigger a stateless part: one memo and its markup, no hook, no timer, no listener of its own', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await readFile(path.join(import.meta.dirname, 'RowMenuTrigger.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\buse(?:State|Effect|LayoutEffect|Ref|Context|Memo|Callback|Id|Reducer|SyncExternalStore|Transition|DeferredValue|ImperativeHandle|Debug)\b|\buse\(/);
    expect(code).not.toMatch(/addEventListener|removeEventListener|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|MutationObserver|IntersectionObserver|ResizeObserver|\.subscribe\(/);
    expect([...code.matchAll(/import \{([^}]*)\} from 'react'/g)].map((match) => match[1]?.trim()).join(',')).toMatch(/^memo(?:, type [A-Za-z]+)*$/);
  });
});

describe('binding to a row', () => {
  it('binds the shared menu to the selected row rather than the previous trigger (the old host test, ported)', () => {
    const { log } = setup();
    pointerClick(trigger('web-1'));
    pointerClick(entry('Inspect'));
    pointerClick(trigger('web-2'));
    pointerClick(entry('Inspect'));
    expect(log).toEqual([['inspect', 'a'], ['inspect', 'b']]);
  });

  it('binds the items and the selection to the second row when it opens while the first is open', () => {
    const { log, handle, items } = setup();
    pointerClick(trigger('web-1'));
    act(() => {
      handle.open(trigger('web-2'), WEB_2, 'first');
    });
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(items).toHaveBeenLastCalledWith(WEB_2);
    expect(trigger('web-1').hasAttribute('aria-expanded')).toBe(false);
    expect(trigger('web-2').getAttribute('aria-expanded')).toBe('true');
    pointerClick(entry('Run again'));
    expect(log).toEqual([['rerun', 'b']]);
  });

  it('acts on the row it was opened for: a newer object for the same record does not replace it while the menu is open', () => {
    const log: Log = [];
    const handle = createRowMenu<Job>();
    const items = itemsFor(log);
    const view = render(<Table handle={handle} items={items} />);
    pointerClick(trigger('web-1'));
    view.rerender(<Table handle={handle} items={items} jobs={[{ ...WEB_1, name: 'web-1-renamed' }, WEB_2, WORKER]} />);
    pointerClick(entry('Inspect'));
    expect(log).toEqual([['inspect', 'a']]);
    const logged = vi.fn();
    const handleItems = (): ReadonlyArray<RowMenuItem<Job>> => [{ id: 'x', label: 'X', onSelect: (target) => {
      logged(target);
    } }];
    view.rerender(<Table handle={handle} items={handleItems} />);
    pointerClick(trigger('web-1'));
    pointerClick(entry('X'));
    expect(logged).toHaveBeenCalledWith(WEB_1);
  });

  it('builds the items again when its owner renders again, so a selection reads what the owner knows now (the old host test, ported)', () => {
    const log: Log = [];
    const handle = createRowMenu<Job>();
    const first = (): ReadonlyArray<RowMenuItem<Job>> => [{ id: 'inspect', label: 'Inspect', onSelect: (target) => {
      log.push(['first', target.key]);
    } }];
    const second = (): ReadonlyArray<RowMenuItem<Job>> => [{ id: 'inspect', label: 'Inspect', onSelect: (target) => {
      log.push(['second', target.key]);
    } }];
    const view = render(<Table handle={handle} items={first} />);
    pointerClick(trigger('web-1'));
    view.rerender(<Table handle={handle} items={second} />);
    pointerClick(entry('Inspect'));
    expect(log).toEqual([['second', 'a']]);
  });

  it('closes when its owner has no action left for the row, and an Enter after that does nothing (the old host test, ported)', () => {
    const log: Log = [];
    const handle = createRowMenu<Job>();
    const view = render(<Table handle={handle} items={itemsFor(log)} />);
    pointerClick(trigger('web-1'));
    expect(entries()).toHaveLength(4);
    const open = trigger('web-1');
    view.rerender(<Table handle={handle} items={() => []} />);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(handle.getSnapshot()).toEqual({ open: false });
    expect(open.hasAttribute('aria-expanded')).toBe(false);
    press(document.body, 'Enter');
    expect(log).toEqual([]);
  });

  it('does not open for a row whose owner has no action for it', () => {
    const handle = createRowMenu<Job>();
    render(<Table handle={handle} items={() => []} />);
    pointerClick(trigger('web-1'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(handle.getSnapshot()).toEqual({ open: false });
    expect(trigger('web-1').hasAttribute('aria-expanded')).toBe(false);
  });

  it('survives React\'s strict mode: one popup, one selection', () => {
    const log: Log = [];
    const handle = createRowMenu<Job>();
    render(
      <StrictMode>
        <Table handle={handle} items={itemsFor(log)} />
      </StrictMode>,
    );
    pointerClick(trigger('web-2'));
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    press(menu(), 'ArrowDown');
    press(menu(), 'ArrowDown');
    keyClick(entry('Run again'));
    expect(log).toEqual([['rerun', 'b']]);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('opening from the keyboard and the pointer', () => {
  it('opens with the first item focused for Enter and Space (which a button turns into a click without a pointer)', () => {
    setup();
    for (const key of ['Enter', ' ']) {
      const button = trigger('web-1');
      act(() => {
        button.focus();
      });
      press(button, key);
      keyClick(button);
      expect(labelOfFocused()).toBe('Inspect');
      press(menu(), 'Escape');
      expect(focused()).toBe(button);
    }
  });

  it('opens with the first item focused for ArrowDown and the last for ArrowUp, without scrolling the region', () => {
    setup();
    const button = trigger('web-1');
    act(() => {
      button.focus();
    });
    expect(press(button, 'ArrowDown')).toBe(false);
    expect(labelOfFocused()).toBe('Inspect');
    press(menu(), 'Escape');
    expect(press(button, 'ArrowUp')).toBe(false);
    expect(labelOfFocused()).toBe('Delete\u2026');
  });

  it('ignores the arrow keys with a modifier, and every other key, on the trigger', () => {
    setup();
    const button = trigger('web-1');
    for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(press(button, 'ArrowDown', init)).toBe(true);
    }

    expect(press(button, 'ArrowLeft')).toBe(true);
    expect(press(button, 'a')).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens from a pointer with the popup focused and no item active: the first arrow key chooses', () => {
    setup();
    pointerClick(trigger('web-2'));
    expect(focused()).toBe(menu());
    press(menu(), 'ArrowDown');
    expect(labelOfFocused()).toBe('Inspect');
    press(menu(), 'Escape');
    pointerClick(trigger('web-2'));
    press(menu(), 'ArrowUp');
    expect(labelOfFocused()).toBe('Delete\u2026');
  });

  it('takes the first available item when the first is unavailable, and the popup when none is', () => {
    const handle = createRowMenu<Job>();
    const items = (): ReadonlyArray<RowMenuItem<Job>> => [
      { id: 'a', label: 'A', disabled: true, onSelect: () => undefined },
      { id: 'b', label: 'B', onSelect: () => undefined },
      { id: 'c', label: 'C', disabled: true, onSelect: () => undefined },
    ];
    const view = render(<Table handle={handle} items={items} />);
    const button = trigger('web-1');
    press(button, 'ArrowDown');
    expect(labelOfFocused()).toBe('B');
    press(menu(), 'ArrowDown');
    expect(labelOfFocused()).toBe('B');
    press(menu(), 'Escape');
    view.rerender(<Table handle={handle} items={() => [{ id: 'a', label: 'A', disabled: true, onSelect: () => undefined }]} />);
    press(button, 'ArrowDown');
    expect(focused()).toBe(menu());
    expect(press(menu(), 'ArrowDown')).toBe(false);
    expect(focused()).toBe(menu());
  });
});

describe('moving in the menu', () => {
  it('moves with ArrowDown and ArrowUp, wraps at the ends, and skips what is unavailable', () => {
    setup({ jobs: [WORKER] });
    press(trigger('worker-1'), 'ArrowDown');
    expect(labelOfFocused()).toBe('Inspect');
    press(focused() ?? menu(), 'ArrowDown');
    // Pause is unavailable for a paused job: the next available item is Run again.
    expect(labelOfFocused()).toBe('Run again');
    press(focused() ?? menu(), 'ArrowDown');
    expect(labelOfFocused()).toBe('Delete\u2026');
    press(focused() ?? menu(), 'ArrowDown');
    expect(labelOfFocused()).toBe('Inspect');
    press(focused() ?? menu(), 'ArrowUp');
    expect(labelOfFocused()).toBe('Delete\u2026');
    press(focused() ?? menu(), 'ArrowUp');
    press(focused() ?? menu(), 'ArrowUp');
    expect(labelOfFocused()).toBe('Inspect');
  });

  it('goes to the first and the last available item with Home and End, and keeps those keys from scrolling the page', () => {
    setup({ jobs: [WORKER] });
    press(trigger('worker-1'), 'ArrowDown');
    expect(press(focused() ?? menu(), 'End')).toBe(false);
    expect(labelOfFocused()).toBe('Delete\u2026');
    expect(press(focused() ?? menu(), 'Home')).toBe(false);
    expect(labelOfFocused()).toBe('Inspect');
  });

  it('announces an unavailable item without making it a stop: it stays in the menu as aria-disabled and never takes focus', () => {
    setup({ jobs: [WORKER] });
    press(trigger('worker-1'), 'ArrowDown');
    const pause = entry('Pause');
    for (let step = 0; step < 6; step += 1) {
      press(focused() ?? menu(), 'ArrowDown');
      expect(focused()).not.toBe(pause);
    }

    expect(pause.getAttribute('aria-disabled')).toBe('true');
    expect(pause.isConnected).toBe(true);
  });

  it('leaves keys with a modifier and every other key to the page', () => {
    setup();
    press(trigger('web-1'), 'ArrowDown');
    const current = focused();
    for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect(press(focused() ?? menu(), 'ArrowDown', init)).toBe(true);
    }

    expect(press(focused() ?? menu(), 'a')).toBe(true);
    expect(focused()).toBe(current);
  });

  it('follows the pointer: the item under it takes focus, an unavailable one and a touch do not', () => {
    setup({ jobs: [WORKER] });
    pointerClick(trigger('worker-1'));
    fireEvent.pointerMove(entry('Run again'));
    expect(focused()).toBe(entry('Run again'));
    fireEvent.pointerMove(entry('Pause'));
    expect(focused()).toBe(entry('Run again'));
    fireEvent.pointerMove(entry('Delete\u2026'), { pointerType: 'touch' });
    expect(focused()).toBe(entry('Run again'));
    fireEvent.pointerMove(entry('Delete\u2026'), { pointerType: 'mouse' });
    expect(focused()).toBe(entry('Delete\u2026'));
  });

  it('keeps focus where it is when the pointer goes down in the menu: a press on the padding or a separator does not close it', () => {
    setup();
    pointerClick(trigger('web-1'));
    press(menu(), 'ArrowDown');
    expect(fireEvent.mouseDown(menu())).toBe(false);
    expect(fireEvent.mouseDown(within(menu()).getByRole('separator'))).toBe(false);
    expect(labelOfFocused()).toBe('Inspect');
    expect(screen.getByRole('menu')).toBe(menu());
  });
});

describe('closing', () => {
  it('closes on Escape and returns focus to the trigger, and the Escape is the menu\'s alone', () => {
    const outer = vi.fn();
    const handle = createRowMenu<Job>();
    render(<Table handle={handle} items={itemsFor([])} onRegionKeyDown={outer} />);
    const button = trigger('web-1');
    press(button, 'ArrowDown');
    outer.mockClear();
    expect(press(focused() ?? menu(), 'Escape')).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(button);
    expect(outer).not.toHaveBeenCalled();
    expect(button.hasAttribute('aria-expanded')).toBe(false);
  });

  it('closes on Tab and Shift+Tab, puts focus on the trigger so the browser goes on from there, and does not cancel the key', () => {
    setup();
    for (const init of [{}, { shiftKey: true }]) {
      const button = trigger('web-2');
      press(button, 'ArrowDown');
      expect(press(focused() ?? menu(), 'Tab', init)).toBe(true);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(focused()).toBe(button);
    }
  });

  it('closes on a press outside, and stays open for a press inside or on its own trigger', () => {
    setup();
    pointerClick(trigger('web-1'));
    fireEvent.pointerDown(menu());
    fireEvent.pointerDown(entry('Inspect'));
    fireEvent.pointerDown(trigger('web-1'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger('web-1').hasAttribute('aria-expanded')).toBe(false);
  });

  it('closes when its own trigger is pressed again, and keeps focus on it', () => {
    setup();
    const button = trigger('web-1');
    pointerClick(button);
    fireEvent.pointerDown(button);
    pointerClick(button);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(button);
  });

  it('opens the menu of another trigger in one click: the press closes the first, the click opens the second', () => {
    const { log } = setup();
    pointerClick(trigger('web-1'));
    fireEvent.pointerDown(trigger('web-2'));
    expect(screen.queryByRole('menu')).toBeNull();
    pointerClick(trigger('web-2'));
    pointerClick(entry('Inspect'));
    expect(log).toEqual([['inspect', 'b']]);
  });

  it('closes when focus goes to another control, and leaves it there', () => {
    const handle = createRowMenu<Job>();
    render(
      <>
        <Table handle={handle} items={itemsFor([])} />
        <input aria-label="Filter" />
      </>,
    );
    pointerClick(trigger('web-1'));
    expect(focused()).toBe(menu());
    const input = screen.getByRole('textbox', { name: 'Filter' });
    act(() => {
      input.focus();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(input);
  });

  it('closes when the page scrolls under it, as the old menu did, and returns focus without scrolling', () => {
    setup();
    const button = trigger('web-1');
    const focus = vi.spyOn(button, 'focus');
    pointerClick(button);
    act(() => {
      fireEvent.scroll(window);
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    pointerClick(button);
    act(() => {
      fireEvent.scroll(screen.getByRole('region'));
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when the window is resized', () => {
    setup();
    pointerClick(trigger('web-1'));
    act(() => {
      fireEvent(window, new Event('resize'));
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when its row is no longer in the page, and moves focus to the table region instead of dropping it', async () => {
    const handle = createRowMenu<Job>();
    const items = itemsFor([]);
    const view = render(<Table handle={handle} items={items} />);
    press(trigger('web-2'), 'ArrowDown');
    expect(labelOfFocused()).toBe('Inspect');
    await mutate(() => {
      view.rerender(<Table handle={handle} items={items} jobs={[WEB_1, WORKER]} />);
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(handle.getSnapshot()).toEqual({ open: false });
    expect(focused()).toBe(screen.getByRole('region'));
  });

  it('closes with the part: unmounting the menu while it is open takes the open state with it', () => {
    const { handle, view } = setup();
    const button = trigger('web-1');
    pointerClick(button);
    view.unmount();
    expect(handle.getSnapshot()).toEqual({ open: false });
    expect(button.hasAttribute('aria-expanded')).toBe(false);
  });
});

describe('choosing an item', () => {
  it('calls onSelect with the row once, after the menu has closed and focus is back on the trigger', () => {
    const handle = createRowMenu<Job>();
    const seen: Array<{ open: boolean; focus: Element | null; row: Job }> = [];
    const items = (): ReadonlyArray<RowMenuItem<Job>> => [
      {
        id: 'inspect',
        label: 'Inspect',
        onSelect: (row) => {
          seen.push({ open: handle.getSnapshot().open, focus: document.activeElement, row });
        },
      },
    ];
    render(<Table handle={handle} items={items} />);
    const button = trigger('web-2');
    press(button, 'ArrowDown');
    keyClick(entry('Inspect'));
    expect(seen).toEqual([{ open: false, focus: button, row: WEB_2 }]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lets what a selection does with focus stand: a dialog or a field it opens keeps it', () => {
    const handle = createRowMenu<Job>();
    const items = (): ReadonlyArray<RowMenuItem<Job>> => [
      {
        id: 'rename',
        label: 'Rename',
        onSelect: () => {
          document.getElementById('name')?.focus();
        },
      },
    ];
    render(
      <>
        <Table handle={handle} items={items} />
        <input id="name" aria-label="Name" />
      </>,
    );
    press(trigger('web-1'), 'ArrowDown');
    keyClick(entry('Rename'));
    expect(focused()).toBe(screen.getByRole('textbox', { name: 'Name' }));
  });

  it('does nothing for an unavailable item: the menu stays open, focus stays, nothing is called', () => {
    const { log } = setup({ jobs: [WORKER] });
    pointerClick(trigger('worker-1'));
    press(menu(), 'ArrowDown');
    const pause = entry('Pause');
    pointerClick(pause);
    keyClick(pause);
    expect(log).toEqual([]);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(labelOfFocused()).toBe('Inspect');
  });

  it('selects the focused item with Enter or Space, which a button turns into a click', () => {
    const { log } = setup();
    press(trigger('web-1'), 'ArrowDown');
    press(focused() ?? menu(), 'ArrowDown');
    press(focused() ?? menu(), 'ArrowDown');
    expect(labelOfFocused()).toBe('Run again');
    // Enter presses the focused button, and a button answers with a click that has no pointer behind it.
    press(focused() ?? menu(), 'Enter');
    keyClick(focused() ?? menu());
    expect(log).toEqual([['rerun', 'a']]);
  });
});

describe('where the popup goes', () => {
  it('opens below its trigger with its end edge on the trigger\'s end edge, written as custom properties, once the popup is in the top layer', () => {
    setup();
    const button = trigger('web-1');
    layout(button, 500, 100);
    pointerClick(button);
    const popup = menu();
    expect(popup.getAttribute('popover')).toBe('manual');
    expect(shown).toEqual([popup]);
    expect(popup.style.getPropertyValue('--_x')).toBe('324px');
    expect(popup.style.getPropertyValue('--_y')).toBe('128px');
    expect(popup.getAttribute('data-ov-side')).toBe('bottom');
    expect(popup.style.getPropertyValue('--_max-height')).toBe('');
    expect(calls).toEqual(['showPopover', 'measure popup']);
  });

  it('flips above the trigger when it does not fit below', () => {
    setup();
    const button = trigger('web-2');
    layout(button, 500, 700);
    pointerClick(button);
    expect(menu().style.getPropertyValue('--_y')).toBe('576px');
    expect(menu().getAttribute('data-ov-side')).toBe('top');
  });

  it('stays 4 px inside the window at its edges', () => {
    setup();
    const button = trigger('web-1');
    layout(button, 10, 100);
    pointerClick(button);
    expect(menu().style.getPropertyValue('--_x')).toBe('4px');
    press(menu(), 'Escape');
    layout(button, 990, 100);
    pointerClick(button);
    expect(menu().style.getPropertyValue('--_x')).toBe('796px');
  });

  it('is limited to the room it has when it fits on neither side, and scrolls inside', () => {
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 200 });
    setup();
    const button = trigger('web-1');
    layout(button, 500, 90);
    pointerClick(button);
    expect(menu().style.getPropertyValue('--_max-height')).toBe('82px');
    expect(menu().style.getPropertyValue('--_y')).toBe('4px');
  });

  it('is placed once, when it opens: one reading of the trigger and of the popup, none of any other trigger, and none after a render or a key', () => {
    const handle = createRowMenu<Job>();
    const items = itemsFor([]);
    const view = render(<Table handle={handle} items={items} />);
    const button = trigger('web-1');
    layout(button, 500, 100);
    rectSpy.mockClear();
    pointerClick(button);
    const measured = () => rectSpy.mock.contexts.filter((context): context is Element => context instanceof Element);
    expect(measured().filter((element) => element === button)).toHaveLength(1);
    expect(measured().filter((element) => element === menu())).toHaveLength(1);
    expect(measured().filter((element) => element !== button && element !== menu())).toHaveLength(0);
    const before = measured().length;
    view.rerender(<Table handle={handle} items={itemsFor([])} />);
    press(menu(), 'ArrowDown');
    press(menu(), 'ArrowDown');
    fireEvent.pointerMove(entry('Run again'));
    expect(measured()).toHaveLength(before);
    expect(menu().style.getPropertyValue('--_x')).toBe('324px');
  });

  it('writes custom properties and nothing else on the popup, and nothing at all on the document root or body', () => {
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    const before = [document.documentElement.getAttribute('style'), document.body.getAttribute('style')];
    setup();
    const button = trigger('web-1');
    layout(button, 500, 100);
    pointerClick(button);
    expect([...menu().style].filter((name) => !name.startsWith('--_'))).toEqual([]);
    expect(menu().style.getPropertyValue('--_x')).not.toBe('');
    press(menu(), 'ArrowDown');
    press(menu(), 'Escape');
    pointerClick(button);
    fireEvent.pointerDown(document.body);
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(records).toEqual([]);
    expect([document.documentElement.getAttribute('style'), document.body.getAttribute('style')]).toEqual(before);
  });

  it('still works in an engine without the Popover API: the popup is fixed where it is mounted', () => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
    setup();
    const button = trigger('web-1');
    layout(button, 500, 100);
    pointerClick(button);
    expect(menu().style.getPropertyValue('--_x')).toBe('324px');
    expect(shown).toEqual([]);
  });

  it('opens in a right-to-left context the other way round', () => {
    setup();
    const button = trigger('web-1');
    layout(button, 500, 100);
    const rtl: Pick<CSSStyleDeclaration, 'direction'> = { direction: 'rtl' };
    const direction = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => rtl as CSSStyleDeclaration);
    pointerClick(button);
    expect(menu().style.getPropertyValue('--_x')).toBe('500px');
    direction.mockRestore();
  });
});

// The examples, one row each (the interim rule of docs/ui-next/AGENTS.md): what each shows, read from its own markup.
type Row = { readonly rows: number | 'window'; readonly unavailable: boolean; readonly destructive: boolean };
const MATRIX: Readonly<Record<string, Row>> = {
  Default: { rows: 12, unavailable: false, destructive: true },
  Large: { rows: 'window', unavailable: false, destructive: true },
  DisabledAndDestructive: { rows: 12, unavailable: true, destructive: true },
};

const isRegion = (element: HTMLElement) => element.getAttribute('role') === 'region';

describe('RowMenu examples: the a11y matrix', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
      return this === document.documentElement ? VIEWPORT.height : isRegion(this) ? 420 : 0;
    } });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
      return this === document.documentElement ? VIEWPORT.width : isRegion(this) ? 480 : 0;
    } });
    HTMLCanvasElement.prototype.getContext = () => null;
  });

  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [name, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[name];
    it(`${name}: one table, one trigger a mounted row, no menu until one opens, then one menu`, () => {
      if (Example === undefined) {
        throw new Error(`no example ${name}`);
      }

      const { container } = render(<Example />);
      const triggers = screen.getAllByRole('button', { name: /^Actions for / });
      const mounted = container.querySelectorAll('tbody > tr:not([aria-hidden])');
      expect(triggers).toHaveLength(mounted.length);
      expect(mounted.length).toBeGreaterThan(0);
      if (row.rows === 'window') {
        expect(mounted.length).toBeLessThan(60);
      } else {
        expect(mounted).toHaveLength(row.rows);
      }

      for (const button of triggers) {
        expect(button.getAttribute('aria-haspopup')).toBe('menu');
        expect(button.hasAttribute('title')).toBe(false);
        expect(button.hasAttribute('aria-expanded')).toBe(false);
      }

      expect(screen.queryByRole('menu')).toBeNull();
      const first = defined(triggers[0], 'first trigger');
      press(first, 'ArrowDown');
      expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
      const unavailable = within(menu()).queryAllByRole('menuitem').filter((item) => item.getAttribute('aria-disabled') === 'true');
      const destructive = within(menu()).queryAllByRole('menuitem').filter((item) => item.hasAttribute('data-ov-destructive'));
      expect(destructive.length > 0).toBe(row.destructive);
      if (row.unavailable) {
        // Some job in the example has an unavailable item: open every trigger in view and look.
        let found = unavailable.length > 0;
        for (const button of triggers) {
          press(focused() ?? menu(), 'Escape');
          press(button, 'ArrowDown');
          found ||= within(menu()).queryAllByRole('menuitem').some((item) => item.getAttribute('aria-disabled') === 'true');
        }

        expect(found).toBe(true);
      }

      press(focused() ?? menu(), 'Escape');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.querySelector('[title]')).toBeNull();
    });
  }
});
