import { MenuHost } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen as page } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPanelStore, HOST } from '../../../core/panel';
import type { EngineLoader } from '../engine';
import type { TerminalBusy, TerminalDirectory, TerminalFeedSnapshot, TerminalLink, TerminalTarget } from '../feed';
import { createScreenReaderChoice } from '../screenReader';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngineLoader, type FakeTerminalFeed } from '../testing';
import { TerminalBody } from '../TerminalBody';
import { createTerminalSessions } from '../TerminalSessions';
import { TERMINAL_TOOL } from '../tool';
import { createXtermEngine } from '../xtermEngine';

// The terminal's context menu and its links in the body that draws them: the real body, screen and registry, the kit's real menu host, and a fake emulator for the first two sections, the real one (xterm.js, in jsdom: no layout, no
// drawing) for the last. What is checked here is the hook-up: that the body's elements and the screen carry what the two hooks give them, and that what a person does reaches the emulator and the registry. What a real renderer
// does with a pointer, and where a link is on a screen with a layout, is the probes' to prove.

const MAC = 'MacIntel';
const OTHER = 'Linux x86_64';
const ADDRESS = 'https://example.com/docs';

type Mounted = {
  readonly loader: FakeEngineLoader;
  readonly feed: FakeTerminalFeed;
  readonly openExternal: Mock<(url: string) => void>;
  readonly screen: () => HTMLElement;
  /** What the body was given to open "New terminal here" with (never called unless the test asked for the item). */
  readonly newHere: Mock<(session: string) => void>;
  /** The id of the session the body shows. */
  readonly sessionId: string;
};

/** The real emulator's code, as the body's loader gives it. */
const real: EngineLoader = async () => Promise.resolve(createXtermEngine);

let counter = 0;
let shown: HTMLStyleElement;

function mount(
  options: { readonly platform?: string; readonly links?: boolean; readonly state?: TerminalFeedSnapshot['state']; readonly real?: boolean; readonly here?: { readonly directory: boolean }; readonly resolveLink?: (rowDirectory: string, text: string) => Promise<TerminalLink> } = {},
): Mounted {
  counter = 0;
  const openExternal = vi.fn<(url: string) => void>();
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.resolve()), readText: vi.fn(async () => Promise.resolve('echo hi')) }, platform: options.platform ?? MAC });
  const store = createPanelStore({ now: () => 1_000, newId: () => `s${String(++counter)}` });
  store.registerTool(TERMINAL_TOOL);
  const sessions = createTerminalSessions(store, { newId: () => `term-${String(++counter)}`, ...(options.links === false ? {} : { openExternal }) });
  sessions.attach();
  const feed = fakeTerminalFeed({
    state: options.state ?? 'running',
    ...(options.resolveLink === undefined ? {} : { resolveLink: options.resolveLink, busy: async () => Promise.resolve<TerminalBusy>({ state: 'idle' }) }),
    ...(options.here?.directory === true ? { directory: async () => Promise.resolve<TerminalDirectory>({ state: 'known', path: '/usr', source: 'shell' }) } : {}),
  });
  const loader = fakeEngineLoader();
  const target: TerminalTarget = { plugin: HOST, id: 'local', title: 'Terminal', open: () => feed };
  const opened = sessions.open(target, { focus: false });
  const session = store.getSnapshot().sessions[opened?.id ?? ''];
  if (session === undefined) {
    throw new Error('the session did not open');
  }

  const newHere = vi.fn<(session: string) => void>();
  render(
    <MenuHost>
      <TerminalBody
        sessions={sessions}
        session={session}
        visible
        load={options.real === true ? real : loader.load}
        screenReader={createScreenReaderChoice()}
        {...(options.here === undefined ? {} : { onNewHere: newHere })}
      />
    </MenuHost>,
  );
  return {
    loader,
    feed,
    openExternal,
    newHere,
    sessionId: session.id,
    screen: () => {
      const element = document.querySelector<HTMLElement>('[data-shell-part="terminalScreen"]');
      if (element === null) {
        throw new Error('the body drew no screen');
      }

      return element;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // jsdom has no Popover API: the setup's stand-in marks an element and nothing shows it, and a popover is `display: none` until a rule says otherwise, which makes it inaccessible to the queries (the notices' tests do the same).
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
});

afterEach(() => {
  cleanup();
  shown.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Lets the emulator's code load and the screen make it. */
const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
};

const menu = () => page.queryByRole('menu', { name: 'Terminal actions' });
const item = (name: string) => page.getByRole('menuitem', { name });
const rightClick = (element: Element, init: MouseEventInit = {}) => fireEvent.contextMenu(element, { button: 2, clientX: 30, clientY: 40, ...init });

describe('the menu in the body', () => {
  it('makes the screen\'s element a context trigger, and gives the emulator\'s input the same attributes once the emulator is made', async () => {
    const { loader, screen } = mount();
    expect(screen().getAttribute('data-ov-menu-mode')).toBe('context');
    expect(screen().getAttribute('data-ov-menu')).toMatch(/\S/);
    await flush();
    expect(loader.engines[0]?.inputAttributes()).toEqual({
      'data-ov-menu': screen().getAttribute('data-ov-menu'),
      'data-ov-menu-mode': 'context',
      'data-ov-menu-label': 'Terminal actions',
    });
  });

  it('opens on a secondary click on the screen, with Copy, Paste, Select all, Clear, Find and Open link', async () => {
    const { screen } = mount();
    await flush();
    rightClick(screen());
    expect(menu()).toBeInTheDocument();
    expect(page.getAllByRole('menuitem').map((entry) => entry.getAttribute('aria-label'))).toEqual(['Copy', 'Paste', 'Select all', 'Clear', 'Find', 'Open link']);
  });

  // The kit names an item by its label alone and draws a shortcut after it, so an item that draws one fails "Label in Name" (WCAG 2.5.3; axe `label-content-name-mismatch`, found by the probe in a real browser). The terminal takes its
  // chords all the same (`keys.ts`); the menu draws none, on either platform, until the kit names an item together with its shortcut.
  it.each([MAC, OTHER])('draws no shortcut next to any item (%s)', async (platform) => {
    const { screen } = mount({ platform });
    await flush();
    rightClick(screen());
    expect(page.getAllByRole('menuitem')).toHaveLength(6);
    expect(document.querySelectorAll('[role="menu"] kbd')).toHaveLength(0);
  });

  // OPEN LINK (#696 step 1) in the real body: the links in view come from the emulator when the menu opens, the submenu names each by its target, and the registry opens the one chosen, and the host's own server is never offered.
  describe('Open link', () => {
    it('lists the links in view by their targets, and opens the chosen one through the registry, once', async () => {
      const { screen, loader, openExternal } = mount();
      await flush();
      loader.engines[0]?.linksInView(['https://example.com/docs', 'https://b.example/login']);
      rightClick(screen());
      fireEvent.keyDown(item('Open link'), { key: 'ArrowRight' });
      expect(page.getAllByRole('menuitem').map((entry) => entry.getAttribute('aria-label'))).toContain('https://b.example/login');
      fireEvent.click(item('https://b.example/login'));
      expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://b.example/login');
    });

    it('does not offer the host\'s own server, which the registry will not open', async () => {
      const { screen, loader } = mount();
      await flush();
      loader.engines[0]?.linksInView([`http://${location.hostname}:${location.port || '80'}/api`, 'https://example.com/']);
      rightClick(screen());
      fireEvent.keyDown(item('Open link'), { key: 'ArrowRight' });
      const labels = page.getAllByRole('menuitem').map((entry) => entry.getAttribute('aria-label'));
      expect(labels).toContain('https://example.com/');
      expect(labels.filter((label) => label?.startsWith('http://') === true)).toEqual([]);
    });

    it('is not in the menu of a window that cannot open an address', async () => {
      const { screen } = mount({ links: false });
      await flush();
      rightClick(screen());
      expect(page.queryByRole('menuitem', { name: 'Open link' })).toBeNull();
    });
  });

  describe('New terminal here', () => {
    it('is in the menu of a body that is given a way to open one, and asks for it by the id of its session: the body asks nothing of the host itself', async () => {
      const { screen, newHere, sessionId } = mount({ here: { directory: true } });
      await flush();
      rightClick(screen());
      expect(page.getAllByRole('menuitem').map((entry) => entry.getAttribute('aria-label'))).toEqual(['Copy', 'Paste', 'Select all', 'Clear', 'Find', 'Open link', 'New terminal here']);
      expect(item('New terminal here')).not.toHaveAttribute('aria-disabled');
      fireEvent.click(item('New terminal here'));
      expect(newHere).toHaveBeenCalledTimes(1);
      expect(newHere).toHaveBeenCalledWith(sessionId);
    });

    it('is unavailable when the session\'s feed cannot say where it is, and opens nothing', async () => {
      const { screen, newHere } = mount({ here: { directory: false } });
      await flush();
      rightClick(screen());
      expect(item('New terminal here')).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(item('New terminal here'));
      expect(newHere).not.toHaveBeenCalled();
    });

    it('is not in the menu of a body that is given no way to open one', async () => {
      const { screen } = mount();
      await flush();
      rightClick(screen());
      expect(page.queryByRole('menuitem', { name: 'New terminal here' })).toBeNull();
    });
  });

  it('selects all the output, and clears it, in the emulator', async () => {
    const { loader, screen } = mount();
    await flush();
    rightClick(screen());
    fireEvent.click(item('Select all'));
    expect(loader.engines[0]?.selectAlls()).toBe(1);
    rightClick(screen());
    fireEvent.click(item('Clear'));
    expect(loader.engines[0]?.clears()).toBe(1);
  });

  it('opens the find bar from Find, with the keyboard in its field: the item is the bar\'s own way in, as the toolbar\'s Find button is', async () => {
    const { screen } = mount();
    await flush();
    expect(page.queryByRole('search')).toBeNull();
    rightClick(screen());
    fireEvent.click(item('Find'));
    await flush();
    expect(page.getByRole('search', { name: 'Find in terminal' })).toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Find' })).toHaveAttribute('aria-pressed', 'true');
    expect(page.getByRole('searchbox', { name: 'Find in terminal' })).toHaveFocus();
  });

  it('pastes what the clipboard holds through the emulator, as the person\'s own input', async () => {
    const { loader, screen } = mount();
    await flush();
    rightClick(screen());
    await act(async () => {
      fireEvent.click(item('Paste'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loader.engines[0]?.pastes).toEqual(['echo hi']);
  });

  it('has no Paste for a terminal that takes no input', async () => {
    const { loader, screen } = mount({ state: 'ended' });
    await flush();
    rightClick(screen());
    expect(item('Paste')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item('Paste'));
    expect(loader.engines[0]?.pastes).toEqual([]);
  });

  it('copies the selection as the toolbar\'s button does: it is the same copy, and it says so to a person who cannot see it', async () => {
    const { loader, screen } = mount();
    await flush();
    act(() => {
      loader.engines[0]?.select('hello');
    });
    rightClick(screen());
    await act(async () => {
      fireEvent.click(item('Copy'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('hello');
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Selection copied');
  });

  it('puts away an open menu when the terminal ends, and the next opening has no Paste: the body\'s own status reaches the menu', async () => {
    const { feed, screen } = mount();
    await flush();
    rightClick(screen());
    expect(item('Paste')).not.toHaveAttribute('aria-disabled');
    act(() => {
      feed.set({ state: 'ended' });
    });
    expect(menu()).toBeNull();
    rightClick(screen());
    expect(item('Paste')).toHaveAttribute('aria-disabled', 'true');
  });

  it('has no Copy until something is selected', async () => {
    const { screen } = mount();
    await flush();
    rightClick(screen());
    expect(item('Copy')).toHaveAttribute('aria-disabled', 'true');
  });

  it('leaves a secondary click to the program while it has the mouse, and opens with Shift held', async () => {
    const { loader, screen } = mount();
    await flush();
    loader.engines[0]?.mouseReports(true);
    expect(rightClick(screen())).toBe(false);
    expect(menu()).toBeNull();
    rightClick(screen(), { shiftKey: true });
    expect(menu()).toBeInTheDocument();
  });
});

describe('the links in the body', () => {
  it('are made when the window can open an address, and the pointer on one shows how to follow it, in the words of the platform', async () => {
    const { loader } = mount({ platform: OTHER });
    await flush();
    const engine = loader.engines[0];
    expect(engine?.links()).toBeDefined();
    expect(page.queryByRole('tooltip')).toBeNull();
    act(() => {
      engine?.linkHover({ uri: ADDRESS, x: 200, y: 100 });
    });
    expect(page.getByRole('tooltip')).toHaveTextContent('Follow link (ctrl + click)');
    act(() => {
      engine?.linkHover(undefined);
    });
    expect(page.queryByRole('tooltip')).toBeNull();
  });

  it('are followed with the platform\'s click, through the registry, and not with a plain one', async () => {
    const { loader, openExternal } = mount({ platform: OTHER });
    await flush();
    loader.engines[0]?.linkActivate(ADDRESS, new MouseEvent('click'));
    expect(openExternal).not.toHaveBeenCalled();
    loader.engines[0]?.linkActivate(ADDRESS, new MouseEvent('click', { ctrlKey: true }));
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(ADDRESS);
  });

  it('lets Escape put the tooltip away without touching the key, and keeps it away while the pointer stays on the link', async () => {
    const { loader } = mount({ platform: OTHER });
    await flush();
    const engine = loader.engines[0];
    const link = { uri: ADDRESS, x: 200, y: 100 };
    act(() => {
      engine?.linkHover(link);
    });
    expect(page.getByRole('tooltip')).toBeInTheDocument();
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true);
    expect(page.queryByRole('tooltip')).toBeNull();
    act(() => {
      engine?.linkHover({ ...link });
    });
    expect(page.queryByRole('tooltip')).toBeNull();
    act(() => {
      engine?.linkHover(undefined);
    });
    await flush();
    act(() => {
      engine?.linkHover({ ...link });
    });
    expect(page.getByRole('tooltip')).toBeInTheDocument();
  });

  it('are made by no body whose window cannot open an address: there is no link and no tooltip to draw', async () => {
    const { loader } = mount({ links: false });
    await flush();
    expect(loader.engines[0]?.links()).toBeUndefined();
    expect(page.queryByRole('tooltip')).toBeNull();
  });
});

// THE FILE LINKS IN THE BODY (#696 step 4): the body gives the screen a handler only when the session's feed can resolve a link, and the handler asks that feed.
describe('the file links in the body', () => {
  it('asks the session\'s own feed to resolve a candidate, with an empty directory for a row no command owns, and copies the path with the platform\'s click', async () => {
    const resolveLink = vi.fn(async (_directory: string, _text: string) => Promise.resolve<TerminalLink>({ kind: 'file', path: '/work/src/a.go', line: 12, col: 3 }));
    const { loader } = mount({ platform: OTHER, resolveLink });
    await flush();
    const handler = loader.engines[0]?.fileLinks();
    expect(handler).toBeDefined();
    expect(await handler?.resolve(0, ['src/a.go:12:3'])).toEqual([{ path: '/work/src/a.go', kind: 'file', line: 12, col: 3 }]);
    expect(resolveLink).toHaveBeenCalledExactlyOnceWith('', 'src/a.go:12:3');
    handler?.activate({ path: '/work/src/a.go', kind: 'file', line: 12, col: 3 }, new MouseEvent('click', { ctrlKey: true }));
    await flush();
    expect(vi.mocked(navigator.clipboard.writeText)).toHaveBeenCalledExactlyOnceWith('/work/src/a.go:12:3');
  });

  it('asks the host about the file links of the lines in view when the keyboard comes into the body, and lists what it found in Open link', async () => {
    const resolveLink = vi.fn(async (_directory: string, _text: string) => Promise.resolve<TerminalLink>({ kind: 'file', path: '/work/src/a.go', line: 12, col: 3 }));
    const { loader, screen } = mount({ platform: OTHER, resolveLink });
    await flush();
    loader.engines[0]?.filesInView([{ row: 3, texts: ['src/a.go:12:3'] }]);
    act(() => {
      fireEvent.focus(screen());
    });
    await flush();
    expect(resolveLink).toHaveBeenCalledExactlyOnceWith('', 'src/a.go:12:3');
    rightClick(screen());
    fireEvent.keyDown(item('Open link'), { key: 'ArrowRight' });
    expect(page.getAllByRole('menuitem').map((entry) => entry.getAttribute('aria-label'))).toContain('Copy path /work/src/a.go:12:3');
  });

  it('makes no file links for a session whose feed has no disk to look at', async () => {
    const { loader } = mount({ platform: OTHER });
    await flush();
    expect(loader.engines[0]?.fileLinks()).toBeUndefined();
  });
});

describe('with the real emulator', () => {
  /** The input the emulator made: where the keys go, and what the menu's host reads as the trigger of a keyboard invocation. */
  const input = (): HTMLTextAreaElement => {
    const element = document.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
    if (element === null) {
      throw new Error('the emulator made no input');
    }

    return element;
  };

  it('has the menu\'s attributes on its own input, and Shift F10 pressed in it opens the menu: the emulator leaves the key to the window, and the focus comes back to the input', async () => {
    const { screen } = mount({ real: true, platform: OTHER });
    await flush();
    expect(input().getAttribute('data-ov-menu')).toBe(screen().getAttribute('data-ov-menu'));
    input().focus();
    expect(fireEvent.keyDown(input(), { key: 'F10', code: 'F10', keyCode: 121, shiftKey: true })).toBe(false);
    expect(menu()).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it('opens on the Menu key pressed in its input', async () => {
    mount({ real: true, platform: MAC });
    await flush();
    input().focus();
    expect(fireEvent.keyDown(input(), { key: 'ContextMenu', code: 'ContextMenu', keyCode: 93 })).toBe(false);
    expect(menu()).toBeInTheDocument();
  });

  it('opens on a secondary click that lands on its input, which it moves under the pointer', async () => {
    mount({ real: true });
    await flush();
    rightClick(input());
    expect(menu()).toBeInTheDocument();
  });

  it('keeps a secondary click for a program that asked for the mouse (its own mode), and opens with Shift', async () => {
    const { feed, screen } = mount({ real: true });
    await flush();
    act(() => {
      feed.push('\u001b[?1000h');
    });
    await flush();
    expect(rightClick(screen())).toBe(false);
    expect(rightClick(input())).toBe(false);
    expect(menu()).toBeNull();
    rightClick(screen(), { shiftKey: true });
    expect(menu()).toBeInTheDocument();
  });

  it('pastes through the emulator: between the markers of bracketed paste when the program asked for them', async () => {
    const { feed, screen } = mount({ real: true });
    await flush();
    act(() => {
      feed.push('\u001b[?2004h');
    });
    await flush();
    rightClick(screen());
    await act(async () => {
      fireEvent.click(item('Paste'));
      await vi.advanceTimersByTimeAsync(0);
    });
    await flush();
    expect(feed.typed()).toEqual(['\u001b[200~echo hi\u001b[201~']);
  });

  it('selects all the output, so that the Copy button has a selection', async () => {
    const { feed, screen } = mount({ real: true });
    await flush();
    act(() => {
      feed.push('hello\r\nworld\r\n');
    });
    await flush();
    expect(page.getByRole('button', { name: 'Copy selection' })).toHaveAttribute('aria-disabled', 'true');
    rightClick(screen());
    fireEvent.click(item('Select all'));
    await flush();
    expect(page.getByRole('button', { name: 'Copy selection' })).not.toHaveAttribute('aria-disabled');
  });
});

// THE COMMANDS IN THE BODY (issue #694 step 5): the hook-up of the gutter. The shell's marks reach the screen through the feed; what a person can do with them is in the menu (the keyboard path: Shift F10 or the Menu key opens it, and
// every item is named), what the pointer does on a mark is the tooltip, and what an action did is said in the body's live region. A fake emulator draws nothing: where a mark is drawn is the probes' to prove.

describe('the commands in the body', () => {
  const mark = (kind: 'prompt-start' | 'input-start' | 'command-start' | 'command-end', extra: Record<string, unknown> = {}) => ({ kind, at: 0, end: 1, id: 'c1', trust: 'unverified' as const, ...extra });
  const ran = async (m: Mounted) => {
    m.feed.push('$ make test\r\nout1\r\nout2\r\n', [
      { mark: mark('prompt-start'), at: 0 },
      { mark: mark('input-start'), at: 2 },
      { mark: mark('command-start', { trust: 'nonce', command: 'make test' }), at: 13 },
      { mark: mark('command-end', { exit: 2, durationMs: 3_000 }), at: 25 },
    ]);
    await flush();
  };

  it('has no items in the menu while the shell has made no command: a terminal with no shell integration has nothing for them to act on', async () => {
    const m = mount();
    await flush();
    rightClick(m.screen());
    expect(page.queryByRole('menuitem', { name: 'Previous command' })).toBeNull();
    expect(page.queryByRole('menuitem', { name: 'Run command again' })).toBeNull();
  });

  it('puts an open menu away when a command ends while it is open: its Copy command output and Run command again would say what was true when it opened', async () => {
    const m = mount();
    await flush();
    m.feed.push('$ make test\r\nout1\r\n', [
      { mark: mark('prompt-start'), at: 0 },
      { mark: mark('input-start'), at: 2 },
      { mark: mark('command-start', { trust: 'nonce', command: 'make test' }), at: 13 },
    ]);
    await flush();
    rightClick(m.screen());
    expect(menu()).not.toBeNull();
    m.feed.push('more\r\n', [{ mark: mark('command-end', { exit: 0, durationMs: 5 }), at: 6 }]);
    await flush();
    expect(menu()).toBeNull();
  });

  it('goes to the previous command from the menu, and says where it went to a person who cannot see the view move', async () => {
    const m = mount();
    await flush();
    await ran(m);
    rightClick(m.screen());
    expect(item('Previous command')).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item('Previous command'));
    await flush();
    expect(m.loader.engines.at(-1)?.scrolls).toEqual([0]);
    expect(page.getByText('Command 1 of 1, Failed, exit 2, took 3.0 s: make test')).toBeInTheDocument();
  });

  it('selects the output of the command, copies it, and runs it again, from the menu', async () => {
    const m = mount();
    await flush();
    await ran(m);
    rightClick(m.screen());
    fireEvent.click(item('Select command output'));
    await flush();
    expect(m.loader.engines.at(-1)?.lineSelections).toEqual([[1, 3]]);
    rightClick(m.screen());
    fireEvent.click(item('Run command again'));
    await flush();
    expect(m.loader.engines.at(-1)?.pastes).toEqual(['make test']);
    expect(m.feed.typed()).toContain('\r');
  });

  it('shows the tooltip of a mark while the pointer is on it, and not after', async () => {
    const m = mount();
    await flush();
    await ran(m);
    const decoration = m.loader.engines.at(-1)?.decorations()[0];
    expect(decoration, 'the command is drawn').toBeDefined();
    decoration?.element.firstElementChild?.dispatchEvent(new MouseEvent('mouseenter'));
    await flush();
    expect(page.getByRole('tooltip')).toHaveTextContent('make test');
    expect(page.getByRole('tooltip')).toHaveTextContent('Failed, exit 2, took 3.0 s');
    decoration?.element.firstElementChild?.dispatchEvent(new MouseEvent('mouseleave'));
    await flush();
    expect(page.queryByRole('tooltip')).toBeNull();
  });
});
