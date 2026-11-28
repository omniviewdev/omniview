import { MenuHost } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen as page } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import type { TerminalFeedSnapshot } from '../feed';
import type { ScreenSnapshot } from '../screen';
import { NO_INPUT } from './terminalMenu';
import { useTerminalMenu, type TerminalMenuOptions, type TerminalMenuScreen } from './useTerminalMenu';

// The terminal's context menu on the window's menu host: what the hook gives the screen's element and the emulator's input so that the host opens on them, when the program's mouse wins over the menu, what the items do and when they
// run. The real kit host is mounted (as the kit's own tests do) and the screen is a fake with the members the menu uses; the real screen and a fake emulator are in `hookup.test.tsx`.

/** The element the emulator draws in, and the input it makes in it (a textarea: the emulator's own, which the kit's menu host treats as an editor of its own). */
const HOST = 'screen';

type FakeScreen = {
  readonly screen: TerminalMenuScreen;
  readonly decorateInput: Mock<TerminalMenuScreen['decorateInput']>;
  readonly clear: Mock<TerminalMenuScreen['clear']>;
  readonly selectAll: Mock<TerminalMenuScreen['selectAll']>;
  readonly paste: Mock<TerminalMenuScreen['paste']>;
  /** The input element the emulator made: what `decorateInput` sets attributes on (none until the harness draws one). */
  readonly bind: (element: HTMLElement | null) => void;
  /** Some of the output is selected now, and whoever listens is told. */
  readonly select: (selected: boolean) => void;
  /** The same, and nobody is told: a menu that reads it when it opens sees it, and a menu that reads what it was told does not. */
  readonly selectQuietly: (selected: boolean) => void;
  /** The program asks for mouse reports, or lets go of them. */
  readonly report: (on: boolean) => void;
};

function fakeScreen(): FakeScreen {
  let snapshot: ScreenSnapshot = { ready: true, selected: false, error: undefined };
  let reporting = false;
  let input: HTMLElement | undefined;
  let set: string[] = [];
  const listeners = new Set<() => void>();
  // The emulator's own: the attributes it is given are set on its input, and those of an earlier call that are not in these are removed.
  const decorateInput = vi.fn<TerminalMenuScreen['decorateInput']>((attributes) => {
    for (const name of set) {
      input?.removeAttribute(name);
    }

    set = Object.keys(attributes);
    for (const [name, value] of Object.entries(attributes)) {
      input?.setAttribute(name, value);
    }
  });
  const clear = vi.fn<TerminalMenuScreen['clear']>();
  const selectAll = vi.fn<TerminalMenuScreen['selectAll']>();
  const paste = vi.fn<TerminalMenuScreen['paste']>();
  const screen: TerminalMenuScreen = {
    clear,
    selectAll,
    paste,
    decorateInput,
    mouseReporting: () => reporting,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
  return {
    screen,
    decorateInput,
    clear,
    selectAll,
    paste,
    bind: (element) => {
      input = element ?? undefined;
    },
    select: (selected) => {
      snapshot = { ...snapshot, selected };
      act(() => {
        for (const listener of [...listeners]) {
          listener();
        }
      });
    },
    selectQuietly: (selected) => {
      snapshot = { ...snapshot, selected };
    },
    report: (on) => {
      reporting = on;
    },
  };
}

type Props = Omit<TerminalMenuOptions, 'screen'> & { readonly fake: FakeScreen | undefined; readonly decorate?: boolean | undefined; readonly id?: string | undefined };

/** What the body does with the hook: its attributes on the element the emulator draws in, with the emulator's input inside it. */
function Terminal({ fake, decorate = true, id = HOST, ...options }: Props): ReactElement {
  const { host } = useTerminalMenu({ ...options, screen: fake?.screen });
  return (
    <div data-testid={id} {...host}>
      <textarea
        aria-label={`Terminal input ${id}`}
        ref={(element) => {
          if (decorate) {
            fake?.bind(element);
          }
        }}
      />
    </div>
  );
}

type Rig = {
  readonly fake: FakeScreen;
  readonly openFind: Mock<() => void>;
  readonly copy: Mock<() => void>;
  /** What "New terminal here" opens. */
  readonly open: Mock<() => void>;
  readonly host: () => HTMLElement;
  readonly input: () => HTMLTextAreaElement;
  readonly rerender: (props?: Partial<Props>) => void;
};

function mount(
  options: { readonly host?: boolean; readonly strict?: boolean; readonly state?: TerminalFeedSnapshot['state']; readonly decorate?: boolean; readonly here?: { readonly available: boolean } } = {},
): Rig {
  const fake = fakeScreen();
  const openFind = vi.fn<() => void>();
  const copy = vi.fn<() => void>();
  const open = vi.fn<() => void>();
  const props = (more: Partial<Props> = {}): Props => ({
    fake,
    status: { state: options.state ?? 'running' },
    openFind,
    copy,
    ...(options.here === undefined ? {} : { here: { open, available: options.here.available } }),
    decorate: options.decorate,
    ...more,
  });
  const ui = (more: Partial<Props> = {}): ReactElement => {
    const body = <Terminal {...props(more)} />;
    const hosted = options.host === false ? body : <MenuHost>{body}</MenuHost>;
    return options.strict === true ? <StrictMode>{hosted}</StrictMode> : hosted;
  };

  const view = render(ui());
  return {
    fake,
    openFind,
    copy,
    open,
    host: () => page.getByTestId(HOST),
    input: () => page.getByLabelText<HTMLTextAreaElement>(`Terminal input ${HOST}`),
    rerender: (more) => {
      view.rerender(ui(more));
    },
  };
}

function metrics() {
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function measure(this: Element) {
    return this.getAttribute('role') === 'menu' ? new DOMRect(0, 0, 200, 120) : new DOMRect(100, 60, 60, 24);
  });
}

let warn: MockInstance<Console['warn']>;
let shown: HTMLStyleElement;

beforeEach(() => {
  metrics();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // jsdom has no Popover API: the setup's stand-in marks an element and nothing shows it, and a popover is `display: none` until a rule says otherwise, which makes it inaccessible to the queries (the notices' tests do the same).
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
});

afterEach(() => {
  cleanup();
  shown.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

const clipboard = (readText: () => Promise<string>) => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
};

const menu = () => page.queryByRole('menu');
const item = (name: string) => page.getByRole('menuitem', { name });
const names = () => page.getAllByRole('menuitem').map((entry) => entry.getAttribute('aria-label'));
/** A secondary click on the element, with the pointer where a person's would be. */
const rightClick = (element: Element, init: MouseEventInit = {}) => fireEvent.contextMenu(element, { button: 2, clientX: 30, clientY: 40, ...init });

describe('what the hook gives the screen', () => {
  it('is the attributes of a context trigger for the element the emulator draws in, named for what it is', () => {
    const { host } = mount();
    expect(host().getAttribute('data-ov-menu')).toMatch(/\S/);
    expect(host().getAttribute('data-ov-menu-mode')).toBe('context');
    expect(host().getAttribute('data-ov-menu-label')).toBe('Terminal actions');
    // A context trigger has no popup of its own to point at: no aria-haspopup (the kit sets it for a dropdown only).
    expect(host().hasAttribute('aria-haspopup')).toBe(false);
  });

  it('is the same attributes for the emulator\'s input, once, through the screen: the menu host ignores an editor that is not the trigger', () => {
    const { fake, host, input } = mount();
    expect(fake.decorateInput).toHaveBeenCalledTimes(1);
    expect(fake.decorateInput).toHaveBeenCalledWith({
      'data-ov-menu': host().getAttribute('data-ov-menu'),
      'data-ov-menu-mode': 'context',
      'data-ov-menu-label': 'Terminal actions',
    });
    expect(input().getAttribute('data-ov-menu')).toBe(host().getAttribute('data-ov-menu'));
    expect(input().getAttribute('data-ov-menu-mode')).toBe('context');
  });

  it('is asked again of a new screen, and not again of the one that has it', () => {
    const rig = mount();
    rig.rerender();
    expect(rig.fake.decorateInput).toHaveBeenCalledTimes(1);
    const next = fakeScreen();
    rig.rerender({ fake: next });
    expect(next.decorateInput).toHaveBeenCalledTimes(1);
    expect(rig.fake.decorateInput).toHaveBeenCalledTimes(1);
  });

  it('is a trigger of its own for each terminal: two bodies share the window\'s one host and no id', () => {
    const first = fakeScreen();
    const second = fakeScreen();
    const openFirst = vi.fn();
    const openSecond = vi.fn();
    const base: Omit<TerminalMenuOptions, 'screen' | 'openFind'> = { status: { state: 'running' }, copy: vi.fn() };
    render(
      <MenuHost>
        <Terminal {...base} fake={first} id="one" openFind={openFirst} />
        <Terminal {...base} fake={second} id="two" openFind={openSecond} />
      </MenuHost>,
    );
    expect(page.getByTestId('one').getAttribute('data-ov-menu')).not.toBe(page.getByTestId('two').getAttribute('data-ov-menu'));
    rightClick(page.getByTestId('two'));
    fireEvent.click(item('Find'));
    expect(openSecond).toHaveBeenCalledTimes(1);
    expect(openFirst).not.toHaveBeenCalled();
  });

  it('has nothing to open before the screen is there: the browser\'s own menu is left alone, and nothing is decorated again', () => {
    const rig = mount();
    rig.rerender({ fake: undefined });
    expect(rig.host().getAttribute('data-ov-menu-mode')).toBe('context');
    expect(rightClick(rig.host())).toBe(true);
    expect(menu()).toBeNull();
    expect(rig.fake.decorateInput).toHaveBeenCalledTimes(1);
  });
});

describe('opening', () => {
  it('draws nothing while it is closed', () => {
    mount();
    expect(menu()).toBeNull();
    expect(page.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('opens on a secondary click on the screen, as Copy, Paste, Select all, a separator, Clear and Find, named for the terminal', () => {
    const { host } = mount();
    expect(rightClick(host())).toBe(false);
    expect(page.getByRole('menu', { name: 'Terminal actions' })).toBeInTheDocument();
    expect(names()).toEqual(['Copy', 'Paste', 'Select all', 'Clear', 'Find']);
    expect(page.getAllByRole('separator')).toHaveLength(1);
  });

  // The kit names an item by its label alone and draws a shortcut after it: an item with one has a name that is not all that it draws (WCAG 2.5.3, Label in Name; axe `label-content-name-mismatch`, found by the terminal's probe in a real
  // browser). The terminal takes its chords all the same (`keys.ts`), so the items draw none.
  it('draws no shortcut, so that the name of each item is all that the item draws', () => {
    const { host } = mount();
    rightClick(host());
    const items = page.getAllByRole('menuitem');
    expect(items.flatMap((entry) => (entry.querySelector('kbd') === null ? [] : [entry.getAttribute('aria-label')]))).toEqual([]);
    expect(items.map((entry) => entry.textContent)).toEqual(items.map((entry) => entry.getAttribute('aria-label')));
  });

  it('opens on a secondary click that lands on the emulator\'s input, which the emulator moves under the pointer', () => {
    const { input } = mount();
    expect(rightClick(input())).toBe(false);
    expect(menu()).toBeInTheDocument();
  });

  it.each([
    ['Shift F10', { key: 'F10', shiftKey: true }],
    ['the Menu key', { key: 'ContextMenu' }],
  ])('opens on %s in the emulator\'s input, with the first item focused', (_name, init) => {
    const { input } = mount();
    input().focus();
    expect(fireEvent.keyDown(input(), init)).toBe(false);
    expect(menu()).toBeInTheDocument();
    expect(document.activeElement).toBe(item('Paste'));
  });

  it('would leave the emulator\'s input to the browser\'s own menu without the attributes: that is what the screen is asked to set', () => {
    const { input } = mount({ decorate: false });
    input().focus();
    expect(rightClick(input())).toBe(true);
    expect(fireEvent.keyDown(input(), { key: 'F10', shiftKey: true })).toBe(true);
    expect(menu()).toBeNull();
  });

  it('works under strict mode, where effects run twice', () => {
    const { host } = mount({ strict: true });
    rightClick(host());
    expect(names()).toEqual(['Copy', 'Paste', 'Select all', 'Clear', 'Find']);
  });
});

describe('the program\'s mouse', () => {
  it('keeps a secondary click for the program while it reports the mouse: the browser\'s menu is stopped and ours does not open', () => {
    const { fake, host } = mount({ host: false });
    fake.report(true);
    expect(rightClick(host())).toBe(false);
  });

  it('leaves the click alone when the program does not report the mouse', () => {
    const { host } = mount({ host: false });
    expect(rightClick(host())).toBe(true);
  });

  it('leaves the click alone with Shift held, which forces the menu while the program reports the mouse (VS Code)', () => {
    const { fake, host } = mount({ host: false });
    fake.report(true);
    expect(rightClick(host(), { shiftKey: true })).toBe(true);
  });

  it('applies to a click that lands on the emulator\'s input as well', () => {
    const { fake, input } = mount({ host: false });
    fake.report(true);
    expect(rightClick(input())).toBe(false);
  });

  it('opens the menu on the host: with reporting off, or with Shift; not without', () => {
    const { fake, host } = mount();
    fake.report(true);
    rightClick(host());
    expect(menu()).toBeNull();
    rightClick(host(), { shiftKey: true });
    expect(menu()).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(menu()).toBeNull();
    fake.report(false);
    rightClick(host());
    expect(menu()).toBeInTheDocument();
  });

  it('does not stop the keyboard\'s way in: Shift F10 opens the menu whatever the program asked for', () => {
    const { fake, input } = mount();
    fake.report(true);
    input().focus();
    fireEvent.keyDown(input(), { key: 'F10', shiftKey: true });
    expect(menu()).toBeInTheDocument();
  });
});

describe('the items', () => {
  it('say when Copy has nothing to copy, and have it when there is a selection, read as the menu opens', () => {
    const { fake, host } = mount();
    rightClick(host());
    expect(item('Copy')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    // Nobody is told: what the menu shows is what the screen says when it opens, not what the hook last heard.
    fake.selectQuietly(true);
    rightClick(host());
    expect(item('Copy')).not.toHaveAttribute('aria-disabled');
  });

  it('close the menu when the selection goes while it is open, since its Copy would copy nothing', () => {
    const { fake, host, input } = mount();
    fake.select(true);
    input().focus();
    rightClick(host());
    expect(item('Copy')).not.toHaveAttribute('aria-disabled');
    fake.select(false);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it('close the menu when a selection comes while it is open, so that the next opening has Copy', () => {
    const { fake, host } = mount();
    rightClick(host());
    fake.select(true);
    expect(menu()).toBeNull();
    rightClick(host());
    expect(item('Copy')).not.toHaveAttribute('aria-disabled');
  });

  it('close the menu when the terminal stops taking input while it is open, so that the next opening has no Paste', () => {
    const { host, input, rerender } = mount();
    input().focus();
    rightClick(host());
    expect(item('Paste')).not.toHaveAttribute('aria-disabled');
    rerender({ status: { state: 'ended' } });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(input());
    rightClick(host());
    expect(item('Paste')).toHaveAttribute('aria-disabled', 'true');
  });

  it('keep the menu open while the terminal goes on taking input: starting, then running, changes nothing the menu offers', () => {
    const { host, rerender } = mount({ state: 'starting' });
    rightClick(host());
    expect(item('Paste')).not.toHaveAttribute('aria-disabled');
    rerender({ status: { state: 'running' } });
    expect(menu()).toBeInTheDocument();
    expect(item('Paste')).not.toHaveAttribute('aria-disabled');
  });

  it('do not copy when Copy is unavailable', () => {
    const { copy, host } = mount();
    rightClick(host());
    fireEvent.click(item('Copy'));
    expect(copy).not.toHaveBeenCalled();
    expect(menu()).toBeInTheDocument();
  });

  it('run the body\'s own copy for Copy: the toolbar\'s button runs it too, so the confirmation is the same', () => {
    const { copy, fake, host } = mount();
    fake.selectQuietly(true);
    rightClick(host());
    fireEvent.click(item('Copy'));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it.each([
    ['Select all', (rig: Rig) => rig.fake.selectAll],
    ['Clear', (rig: Rig) => rig.fake.clear],
    ['Find', (rig: Rig) => rig.openFind],
  ])('run %s once, after the focus is back in the terminal\'s input', (name, call) => {
    const rig = mount();
    const spy = call(rig);
    let focused: Element | null = null;
    spy.mockImplementation(() => {
      focused = document.activeElement;
    });
    rig.input().focus();
    rightClick(rig.host());
    expect(document.activeElement).toBe(item('Copy').parentElement?.closest('[role="menu"]'));
    fireEvent.click(item(name));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(focused).toBe(rig.input());
    expect(menu()).toBeNull();
  });

  it('run no other action than their own', () => {
    const rig = mount();
    rightClick(rig.host());
    fireEvent.click(item('Select all'));
    expect(rig.fake.selectAll).toHaveBeenCalledTimes(1);
    expect(rig.fake.clear).not.toHaveBeenCalled();
    expect(rig.fake.paste).not.toHaveBeenCalled();
    expect(rig.openFind).not.toHaveBeenCalled();
    expect(rig.copy).not.toHaveBeenCalled();
  });

  it('use the callbacks of the render the menu was chosen in, not the ones it opened with', () => {
    const rig = mount();
    const later = vi.fn();
    rightClick(rig.host());
    rig.rerender({ openFind: later });
    fireEvent.click(item('Find'));
    expect(later).toHaveBeenCalledTimes(1);
    expect(rig.openFind).not.toHaveBeenCalled();
  });
});

describe('New terminal here', () => {
  it('is not in the menu when the hook is given no way to open one', () => {
    const { host } = mount();
    rightClick(host());
    expect(names()).not.toContain('New terminal here');
  });

  it('is the last item, after a separator of its own, and runs what it was given, once, after the focus is back in the terminal\'s input', () => {
    const rig = mount({ here: { available: true } });
    let focused: Element | null = null;
    rig.open.mockImplementation(() => {
      focused = document.activeElement;
    });
    rig.input().focus();
    rightClick(rig.host());
    expect(names()).toEqual(['Copy', 'Paste', 'Select all', 'Clear', 'Find', 'New terminal here']);
    expect(page.getAllByRole('separator')).toHaveLength(2);
    expect(item('New terminal here')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(item('New terminal here'));
    expect(rig.open).toHaveBeenCalledTimes(1);
    expect(focused).toBe(rig.input());
    expect(menu()).toBeNull();
  });

  it('is unavailable for a terminal that cannot say where it is, and opens nothing', () => {
    const rig = mount({ here: { available: false } });
    rightClick(rig.host());
    expect(item('New terminal here')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item('New terminal here'));
    expect(rig.open).not.toHaveBeenCalled();
    expect(menu()).toBeInTheDocument();
  });

  it('is available once the terminal ended: it opens from the directory the terminal started in', () => {
    const rig = mount({ here: { available: true }, state: 'ended' });
    rightClick(rig.host());
    expect(item('New terminal here')).not.toHaveAttribute('aria-disabled');
    expect(item('Paste')).toHaveAttribute('aria-disabled', 'true');
  });

  it('runs the function of the render the menu was chosen in, not the one it opened with', () => {
    const rig = mount({ here: { available: true } });
    const later = vi.fn();
    rightClick(rig.host());
    rig.rerender({ here: { available: true, open: later } });
    fireEvent.click(item('New terminal here'));
    expect(later).toHaveBeenCalledTimes(1);
    expect(rig.open).not.toHaveBeenCalled();
  });
});

describe('Paste', () => {
  it('reads the clipboard only when it is chosen, and gives what it holds to the screen as a paste, once', async () => {
    const text = Promise.withResolvers<string>();
    const readText = vi.fn(async () => text.promise);
    clipboard(readText);
    const rig = mount();
    rightClick(rig.host());
    expect(readText).not.toHaveBeenCalled();
    fireEvent.click(item('Paste'));
    expect(readText).toHaveBeenCalledTimes(1);
    expect(rig.fake.paste).not.toHaveBeenCalled();
    await act(async () => {
      text.resolve('ls -la\nexit\n');
      await text.promise;
    });
    expect(rig.fake.paste).toHaveBeenCalledExactlyOnceWith('ls -la\nexit\n');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once and pastes nothing when the clipboard refuses to be read', async () => {
    const text = Promise.withResolvers<string>();
    clipboard(async () => text.promise);
    const rig = mount();
    rightClick(rig.host());
    fireEvent.click(item('Paste'));
    await act(async () => {
      text.reject(new DOMException('Read permission denied.', 'NotAllowedError'));
      await text.promise.catch(() => undefined);
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(rig.fake.paste).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it('warns once and pastes nothing when the clipboard is empty', async () => {
    const text = Promise.withResolvers<string>();
    clipboard(async () => text.promise);
    const rig = mount();
    rightClick(rig.host());
    fireEvent.click(item('Paste'));
    await act(async () => {
      text.resolve('');
      await text.promise;
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(rig.fake.paste).not.toHaveBeenCalled();
  });

  it('warns once and pastes nothing where there is no clipboard to read (an insecure page)', async () => {
    const rig = mount();
    rightClick(rig.host());
    await act(async () => {
      fireEvent.click(item('Paste'));
      await Promise.resolve();
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(rig.fake.paste).not.toHaveBeenCalled();
  });

  it('is unavailable once the terminal takes no input, says why, and reads nothing', () => {
    const readText = vi.fn(async () => 'text');
    clipboard(readText);
    const rig = mount({ state: 'ended' });
    rightClick(rig.host());
    expect(item('Paste')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Paste')).toHaveAttribute('aria-description', expect.stringContaining(NO_INPUT));
    fireEvent.click(item('Paste'));
    expect(readText).not.toHaveBeenCalled();
    expect(rig.fake.paste).not.toHaveBeenCalled();
  });

  it('reads whether the terminal takes input as the menu opens: a terminal that ended meanwhile has no Paste', () => {
    const rig = mount();
    rig.rerender({ status: { state: 'ended' } });
    rightClick(rig.host());
    expect(item('Paste')).toHaveAttribute('aria-disabled', 'true');
  });

  it('pastes nothing when the terminal stops taking input while the clipboard is being read: the read can wait for the person\'s leave, and a paste then has nowhere to go', async () => {
    const text = Promise.withResolvers<string>();
    clipboard(async () => text.promise);
    const rig = mount();
    rightClick(rig.host());
    fireEvent.click(item('Paste'));
    rig.rerender({ status: { state: 'ended' } });
    await act(async () => {
      text.resolve('ls\n');
      await text.promise;
    });
    expect(rig.fake.paste).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('focus', () => {
  it('goes back to the emulator\'s input when Escape closes the menu a secondary click opened', () => {
    const { host, input } = mount();
    input().focus();
    rightClick(host());
    expect(document.activeElement).not.toBe(input());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it('goes back to the emulator\'s input when Escape closes the menu Shift F10 opened', () => {
    const { input } = mount();
    input().focus();
    fireEvent.keyDown(input(), { key: 'F10', shiftKey: true });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(input());
  });
});

// OPEN LINK (#696 step 1): the links in view, read when the menu opens, in a submenu named by their targets, followed through the registry's own call; a link the registry will not follow is not in it.
describe('Open link', () => {
  const DOCS = 'https://example.com/docs';
  const mountWith = (view: readonly string[], follows: (uri: string) => boolean = () => true) => {
    const rig = mount();
    const open = vi.fn<(uri: string) => void>();
    const viewLinks = vi.fn(() => view);
    const withLinks = { ...rig.fake.screen, viewLinks };
    const fake = { ...rig.fake, screen: withLinks };
    rig.rerender({ fake, links: { open, follows } });
    return { ...rig, open, viewLinks };
  };

  it('is not in the menu when the window gave no way to open an address', () => {
    const { host } = mount();
    rightClick(host());
    expect(names()).not.toContain('Open link');
  });

  it('reads the links in view when the menu opens, and not before', () => {
    const { host, viewLinks } = mountWith([DOCS]);
    expect(viewLinks).not.toHaveBeenCalled();
    rightClick(host());
    expect(viewLinks).toHaveBeenCalledTimes(1);
    expect(names()).toContain('Open link');
  });

  it('opens a submenu with a keyboard arrow whose items are the targets, and a chosen one is opened through the registry, once', () => {
    const { host, open } = mountWith([DOCS, 'https://b.example/login']);
    rightClick(host());
    fireEvent.keyDown(item('Open link'), { key: 'ArrowRight' });
    expect(names()).toContain('https://b.example/login');
    fireEvent.click(item('https://b.example/login'));
    expect(open).toHaveBeenCalledExactlyOnceWith('https://b.example/login');
    expect(menu()).toBeNull();
  });

  it('leaves out a link the registry will not follow: the host\'s own server is not offered', () => {
    const { host } = mountWith([DOCS, 'http://localhost:34115/api'], (uri) => !uri.includes(':34115'));
    rightClick(host());
    fireEvent.keyDown(item('Open link'), { key: 'ArrowRight' });
    expect(names()).toContain(DOCS);
    expect(names()).not.toContain('http://localhost:34115/api');
  });

  it('is unavailable, with its reason, when no link is in view', () => {
    const { host } = mountWith([]);
    rightClick(host());
    expect(item('Open link')).toHaveAttribute('aria-disabled', 'true');
  });
});

// FILE LINKS IN OPEN LINK, on the real kit host (#696 step 4): the files the page has resolved for the lines in view are read when the menu opens, and the lines are asked about again for the next opening (the host answers from a
// cache of 10 s): the menu is a snapshot, and the list is as of the last time the lines were asked.
describe('Open link with file links', () => {
  const FILE = { path: '/work/src/a.go', kind: 'file', line: 12, col: 3 } as const;
  const mountFiles = (files: readonly (typeof FILE)[]) => {
    const rig = mount();
    const copy = vi.fn<(text: string) => void>();
    const warm = vi.fn(async () => Promise.resolve());
    const inView = vi.fn(() => files);
    rig.rerender({ links: { open: vi.fn(), follows: () => true, files: { inView, warm, copy } } });
    return { ...rig, copy, warm, inView };
  };

  it('reads what is in view when the menu opens, and asks the lines again for the next time: once for each opening', () => {
    const { host, warm, inView } = mountFiles([FILE]);
    expect(inView).not.toHaveBeenCalled();
    rightClick(host());
    expect(inView).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it('opens a submenu with the keyboard whose item copies the path: Copy path /work/src/a.go:12:3, chosen once', () => {
    const { host, copy } = mountFiles([FILE]);
    rightClick(host());
    fireEvent.keyDown(item('Open link'), { key: 'ArrowRight' });
    expect(names()).toContain('Copy path /work/src/a.go:12:3');
    fireEvent.click(item('Copy path /work/src/a.go:12:3'));
    expect(copy).toHaveBeenCalledExactlyOnceWith('/work/src/a.go:12:3');
    expect(menu()).toBeNull();
  });

  it('has Open link available with files alone: no web address is in view', () => {
    const { host } = mountFiles([FILE]);
    rightClick(host());
    expect(item('Open link')).not.toHaveAttribute('aria-disabled');
  });
});
