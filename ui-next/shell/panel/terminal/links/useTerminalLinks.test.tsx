import { act, cleanup, render, screen as page } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Platform } from '../../../core/chords';
import type { FileCandidates, FileLinkHandler, FileLinkHover, LinkHandler, LinkHover } from '../engine';
import type { TerminalBusy, TerminalLink } from '../feed';
import { isWebAddress } from './links';
import { useTerminalLinks, type TerminalLinksOptions, type TerminalLinksScreen } from './useTerminalLinks';

// The links in a terminal's output: made only where the window can open an address, followed only by the platform's click and only when the address is a web address, with a tooltip that is in the document only while the
// pointer is on a link. The screen and the registry are fakes with the members the hook uses (`hookup.test.tsx` has the real screen and a fake emulator).

const ADDRESS = 'https://example.com/docs?a=1#top';

type Rig = {
  readonly setLinks: Mock<TerminalLinksScreen['setLinks']>;
  readonly openExternal: Mock<(uri: string) => void>;
  readonly canOpenExternal: Mock<() => boolean>;
  readonly canFollow: Mock<(uri: string) => boolean>;
  /** The handler the screen was given last (it fails the test when it was given none). */
  readonly handler: () => LinkHandler;
  readonly hover: (hover: LinkHover | undefined) => void;
  readonly follow: (uri: string, modifiers?: MouseEventInit) => void;
  readonly rerender: (more?: Partial<TerminalLinksOptions>) => void;
  readonly body: () => HTMLElement;
  readonly unmount: () => void;
};

/** What the body does with the hook: it draws the element anywhere in itself. */
function Body(options: TerminalLinksOptions): ReactElement {
  const { element } = useTerminalLinks(options);
  return <div data-testid="body">{element}</div>;
}

function mount(options: { readonly platform?: Platform; readonly canOpen?: boolean; readonly strict?: boolean; readonly follows?: (uri: string) => boolean } = {}): Rig {
  const setLinks = vi.fn<TerminalLinksScreen['setLinks']>();
  const openExternal = vi.fn<(uri: string) => void>();
  const canOpenExternal = vi.fn(() => options.canOpen ?? true);
  // The screen and the registry are one object each for as long as the body lives, as they are in the body.
  const screen: TerminalLinksScreen = { setLinks };
  // The registry's answer for an address (`TerminalSessions.canFollow`): the scheme, and the host's own server. The default is the scheme alone.
  const canFollow = vi.fn<(uri: string) => boolean>(options.follows ?? isWebAddress);
  const sessions = { canOpenExternal, canFollow, openExternal };
  const props = (more: Partial<TerminalLinksOptions> = {}): TerminalLinksOptions => ({ screen, sessions, platform: options.platform ?? 'mac', ...more });
  const ui = (more: Partial<TerminalLinksOptions> = {}): ReactElement => (options.strict === true ? <StrictMode><Body {...props(more)} /></StrictMode> : <Body {...props(more)} />);
  const view = render(ui());
  const handler = (): LinkHandler => {
    const given = setLinks.mock.calls.findLast(([next]) => next !== undefined)?.[0];
    if (given === undefined) {
      throw new Error('the screen was given no link handler');
    }

    return given;
  };

  return {
    setLinks,
    openExternal,
    canOpenExternal,
    canFollow,
    handler,
    hover: (hover) => {
      act(() => {
        handler().hover(hover);
      });
    },
    follow: (uri, modifiers = {}) => {
      handler().activate(uri, new MouseEvent('click', { bubbles: true, ...modifiers }));
    },
    rerender: (more) => {
      view.rerender(ui(more));
    },
    body: () => page.getByTestId('body'),
    unmount: view.unmount,
  };
}

let shown: HTMLStyleElement;

beforeEach(() => {
  // jsdom has no Popover API: the setup's stand-in marks an element and nothing shows it, and a popover is `display: none` until a rule says otherwise, which makes it inaccessible to the queries (the notices' tests do the same).
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
});

afterEach(() => {
  cleanup();
  shown.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('where there are links', () => {
  it('makes none, and gives the screen no handler, when the window can open no address: a link that does nothing is not drawn', () => {
    const rig = mount({ canOpen: false });
    expect(rig.canOpenExternal).toHaveBeenCalled();
    expect(rig.setLinks).not.toHaveBeenCalled();
    expect(rig.body().querySelectorAll('*')).toHaveLength(0);
  });

  it('gives the screen a handler when it can, once', () => {
    const rig = mount();
    expect(rig.setLinks).toHaveBeenCalledTimes(1);
    expect(rig.handler()).toEqual({ activate: expect.any(Function), hover: expect.any(Function) });
  });

  it('keeps the same handler through the renders that follow', () => {
    const rig = mount();
    rig.rerender();
    rig.rerender();
    expect(rig.setLinks).toHaveBeenCalledTimes(1);
  });

  it('takes the handler back when the body goes: the screen is left with no links', () => {
    const rig = mount();
    rig.unmount();
    expect(rig.setLinks).toHaveBeenCalledTimes(2);
    expect(rig.setLinks).toHaveBeenLastCalledWith(undefined);
  });

  it('gives it to a new screen, and takes it from the old one', () => {
    const rig = mount();
    const next = vi.fn<TerminalLinksScreen['setLinks']>();
    rig.rerender({ screen: { setLinks: next } });
    expect(rig.setLinks).toHaveBeenLastCalledWith(undefined);
    expect(next).toHaveBeenCalledExactlyOnceWith({ activate: expect.any(Function), hover: expect.any(Function) });
  });

  it('has nothing to give before the screen is there', () => {
    const rig = mount();
    rig.rerender({ screen: undefined });
    expect(rig.setLinks).toHaveBeenLastCalledWith(undefined);
    expect(rig.body().querySelectorAll('*')).toHaveLength(0);
  });

  it('works under strict mode, where effects run twice: the screen ends with one handler', () => {
    const rig = mount({ strict: true });
    expect(rig.setLinks.mock.calls.at(-1)?.[0]).toEqual({ activate: expect.any(Function), hover: expect.any(Function) });
  });
});

describe('following a link', () => {
  it('opens the address outside the app with Command and a click on a Mac, once', () => {
    const rig = mount({ platform: 'mac' });
    rig.follow(ADDRESS, { metaKey: true });
    expect(rig.openExternal).toHaveBeenCalledExactlyOnceWith(ADDRESS);
  });

  it.each([
    ['Control', { ctrlKey: true }],
    ['Shift', { shiftKey: true }],
    ['Option', { altKey: true }],
    ['nothing', {}],
  ])('does nothing with %s and a click on a Mac: a plain click selects text', (_name, modifiers) => {
    const rig = mount({ platform: 'mac' });
    rig.follow(ADDRESS, modifiers);
    expect(rig.openExternal).not.toHaveBeenCalled();
  });

  it('opens the address with Control and a click on Windows and Linux, once', () => {
    const rig = mount({ platform: 'other' });
    rig.follow(ADDRESS, { ctrlKey: true });
    expect(rig.openExternal).toHaveBeenCalledExactlyOnceWith(ADDRESS);
  });

  it.each([
    ['Command', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['nothing', {}],
  ])('does nothing with %s and a click on Windows and Linux', (_name, modifiers) => {
    const rig = mount({ platform: 'other' });
    rig.follow(ADDRESS, modifiers);
    expect(rig.openExternal).not.toHaveBeenCalled();
  });

  it.each([
    'javascript:alert(document.cookie)',
    'file:///etc/passwd',
    'ftp://example.com/archive.zip',
    'data:text/html,<b>x</b>',
    'mailto:someone@example.com',
    'wails://localhost/',
    '/etc/passwd',
    'example.com',
    '',
  ])('does not hand %j to the registry, with the right click', (uri) => {
    const rig = mount({ platform: 'mac' });
    rig.follow(uri, { metaKey: true });
    expect(rig.openExternal).not.toHaveBeenCalled();
  });

  it('hands the address over as it is', () => {
    const rig = mount({ platform: 'mac' });
    rig.follow('http://localhost:3000/a%20b?c=d', { metaKey: true });
    expect(rig.openExternal).toHaveBeenCalledExactlyOnceWith('http://localhost:3000/a%20b?c=d');
  });

  it('follows with the platform it was given, not the one the page runs on', () => {
    const rig = mount({ platform: 'mac' });
    rig.rerender({ platform: 'other' });
    rig.follow(ADDRESS, { ctrlKey: true });
    expect(rig.openExternal).toHaveBeenCalledTimes(1);
  });
});

describe('the tooltip', () => {
  it('is not in the document while no link is hovered: not an element, not a node of any kind', () => {
    const rig = mount();
    expect(rig.body().childNodes).toHaveLength(0);
    expect(page.queryByRole('tooltip')).toBeNull();
  });

  it('says how to follow the link on a Mac, in VS Code\'s words', () => {
    const rig = mount({ platform: 'mac' });
    rig.hover({ uri: ADDRESS, x: 120, y: 80 });
    expect(page.getByRole('tooltip')).toHaveTextContent('Follow link (cmd + click)');
  });

  it('says how to follow the link on Windows and Linux', () => {
    const rig = mount({ platform: 'other' });
    rig.hover({ uri: ADDRESS, x: 120, y: 80 });
    expect(page.getByRole('tooltip')).toHaveTextContent('Follow link (ctrl + click)');
  });

  it('is put at the corner of the link, in the pixels of the window, through the two custom properties its stylesheet reads', () => {
    const rig = mount();
    rig.hover({ uri: ADDRESS, x: 120.5, y: 80 });
    const tip = page.getByRole('tooltip');
    expect(tip.style.getPropertyValue('--_x')).toBe('120.5px');
    expect(tip.style.getPropertyValue('--_y')).toBe('80px');
  });

  it('moves with the pointer from one link to another, and is the one tooltip', () => {
    const rig = mount();
    rig.hover({ uri: ADDRESS, x: 120, y: 80 });
    rig.hover({ uri: 'https://example.org/', x: 300, y: 200 });
    expect(page.getAllByRole('tooltip')).toHaveLength(1);
    expect(page.getByRole('tooltip').style.getPropertyValue('--_x')).toBe('300px');
    expect(page.getByRole('tooltip').style.getPropertyValue('--_y')).toBe('200px');
  });

  it('is a popover, put in the top layer once however far it moves, so that nothing the emulator draws is over it', () => {
    const show = vi.spyOn(HTMLElement.prototype, 'showPopover');
    const rig = mount();
    rig.hover({ uri: ADDRESS, x: 120, y: 80 });
    rig.hover({ uri: 'https://example.org/', x: 300, y: 200 });
    const tip = page.getByRole('tooltip');
    expect(tip).toHaveAttribute('popover', 'manual');
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.contexts[0]).toBe(tip);
  });

  it('is gone, with nothing left of it, when the pointer leaves the link', () => {
    const rig = mount();
    rig.hover({ uri: ADDRESS, x: 120, y: 80 });
    expect(page.getByRole('tooltip')).toBeInTheDocument();
    rig.hover(undefined);
    expect(page.queryByRole('tooltip')).toBeNull();
    expect(rig.body().childNodes).toHaveLength(0);
  });

  it('is gone with the body that drew it', () => {
    const rig = mount();
    rig.hover({ uri: ADDRESS, x: 120, y: 80 });
    rig.unmount();
    expect(page.queryByRole('tooltip')).toBeNull();
    expect(document.body.querySelectorAll('[role="tooltip"]')).toHaveLength(0);
  });

  it('is gone when the links are taken away, so that no tooltip stays for a link that no longer is one', () => {
    const rig = mount();
    rig.hover({ uri: ADDRESS, x: 120, y: 80 });
    rig.rerender({ screen: undefined });
    expect(page.queryByRole('tooltip')).toBeNull();
  });

  it('is told to a person who cannot see it, in a polite live region that exists only while it is shown', () => {
    const rig = mount({ platform: 'mac' });
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(0);
    rig.hover({ uri: ADDRESS, x: 120, y: 80 });
    const tip = page.getByRole('tooltip');
    expect(tip).toHaveAttribute('aria-live', 'polite');
    expect(tip).toHaveAttribute('aria-atomic', 'true');
    expect(tip).toHaveTextContent('Follow link (cmd + click)');
    rig.hover(undefined);
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(0);
  });

  it('is text: nothing in it takes the focus or can be pressed', () => {
    const rig = mount();
    rig.hover({ uri: ADDRESS, x: 120, y: 80 });
    const tip = page.getByRole('tooltip');
    expect(tip).not.toHaveAttribute('tabindex');
    expect(tip.querySelector('button, a, input, [tabindex]')).toBeNull();
  });

  // A hyperlink the program writes (OSC 8) can name any scheme, and a printed address is only ever a web address: the tooltip says a click follows the link, so it is shown only for an address a click does follow.
  it.each([
    ['another scheme', 'file:///etc/passwd'],
    ['a mail address', 'mailto:someone@example.com'],
    ['a script', 'javascript:alert(1)'],
    ['a web scheme with no host', 'https://'],
  ])('is not shown for %s: a click would do nothing, so the tooltip must not say it follows', (_what, uri) => {
    const rig = mount();
    rig.hover({ uri, x: 120, y: 80 });
    expect(page.queryByRole('tooltip')).toBeNull();
  });

  it('goes when the pointer moves from a link to one that cannot be followed, with no leave between them', () => {
    const rig = mount();
    rig.hover({ uri: ADDRESS, x: 120, y: 80 });
    expect(page.getByRole('tooltip')).toBeInTheDocument();
    rig.hover({ uri: 'mailto:someone@example.com', x: 300, y: 80 });
    expect(page.queryByRole('tooltip')).toBeNull();
  });
});

// WCAG 1.4.13 (Content on Hover or Focus), "dismissible": the tooltip covers output, and a person who reads it, or magnifies the screen, can put it away without moving the pointer. Escape does, while it is shown and only then, and the key
// itself is not touched: it goes on to the terminal and the window as it always did. The emulator says the pointer left, and then the same link, in one task when it reads a row again with the pointer where it was (output on the row,
// a link that wraps onto the next row), so a dismissal is forgotten when the emulator says the pointer left and does not say the link again in that task.
describe('dismissing the tooltip with Escape', () => {
  const LINK: LinkHover = { uri: ADDRESS, x: 120, y: 80 };

  /** Escape pressed where the keyboard is. The event is the test's own, so that what became of it can be read. */
  function pressEscape(target: EventTarget = document.body): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(event);
    });

    return event;
  }

  /** The task is over: what the hook leaves for the end of a task has been done. */
  async function endTask(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('hides the tooltip, wherever the keyboard is', () => {
    const rig = mount();
    rig.hover(LINK);
    expect(page.getByRole('tooltip')).toBeInTheDocument();
    pressEscape();
    expect(page.queryByRole('tooltip')).toBeNull();
    expect(rig.body().childNodes).toHaveLength(0);
  });

  it('works under strict mode, where effects run twice', () => {
    const rig = mount({ strict: true });
    rig.hover(LINK);
    pressEscape();
    expect(page.queryByRole('tooltip')).toBeNull();
  });

  it('leaves the key alone: it still reaches the terminal and the window, after the hook, and is not cancelled', () => {
    const rig = mount();
    rig.hover(LINK);
    const reached: string[] = [];
    const removers: Array<() => void> = [];
    const listen = (target: EventTarget, name: string, capture: boolean) => {
      const listener = () => {
        reached.push(name);
      };

      target.addEventListener('keydown', listener, capture);
      removers.push(() => {
        target.removeEventListener('keydown', listener, capture);
      });
    };

    // The hook's listener is on the window in the capture phase and came first. These come after it: a key that was stopped, even at that very place, would not reach them.
    listen(window, 'window, capture', true);
    listen(rig.body(), 'terminal', false);
    listen(document, 'document', false);
    listen(window, 'window, bubble', false);
    try {
      const event = pressEscape(rig.body());
      expect(reached).toEqual(['window, capture', 'terminal', 'document', 'window, bubble']);
      expect(event.defaultPrevented).toBe(false);
      expect(page.queryByRole('tooltip')).toBeNull();
    } finally {
      for (const remove of removers) {
        remove();
      }
    }
  });

  it('has no listener on the window while no tooltip is shown, one while it is, and none once it is hidden or the body is gone', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const keydowns = (calls: ReadonlyArray<readonly unknown[]>) => calls.filter(([type]) => type === 'keydown');
    const live = () => keydowns(added.mock.calls).length - keydowns(removed.mock.calls).length;
    const rig = mount();
    expect(keydowns(added.mock.calls)).toHaveLength(0);
    rig.hover(LINK);
    expect(live()).toBe(1);
    expect(keydowns(added.mock.calls)[0]?.[2]).toBe(true);
    // The pointer leaves the link.
    rig.hover(undefined);
    expect(live()).toBe(0);
    // Escape.
    rig.hover({ ...LINK, x: 200 });
    expect(live()).toBe(1);
    pressEscape();
    expect(live()).toBe(0);
    // The body goes while a tooltip is shown.
    rig.hover({ ...LINK, x: 300 });
    expect(live()).toBe(1);
    rig.unmount();
    expect(live()).toBe(0);
    // What was removed is what was added, in the phase it was added in.
    expect(keydowns(removed.mock.calls)).toEqual(keydowns(added.mock.calls));
  });

  it('uses no timer, idle, showing or dismissed', () => {
    vi.useFakeTimers();
    const rig = mount();
    expect(vi.getTimerCount()).toBe(0);
    rig.hover(LINK);
    expect(vi.getTimerCount()).toBe(0);
    pressEscape();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing while no tooltip is shown: the key is untouched, and the next tooltip is not held back', () => {
    const rig = mount();
    const event = pressEscape();
    expect(event.defaultPrevented).toBe(false);
    rig.hover(LINK);
    expect(page.getByRole('tooltip')).toBeInTheDocument();
  });

  it('does not come back for the same link when the emulator says it again, as when a pointer moves along it', () => {
    const rig = mount();
    rig.hover(LINK);
    pressEscape();
    rig.hover({ ...LINK });
    rig.hover({ ...LINK });
    expect(page.queryByRole('tooltip')).toBeNull();
  });

  it('does not come back when the emulator reads the row again and says the pointer left and then the same link, in one task: the pointer is where it was', async () => {
    const rig = mount();
    rig.hover(LINK);
    pressEscape();
    act(() => {
      rig.handler().hover(undefined);
      rig.handler().hover({ ...LINK });
    });
    await endTask();
    expect(page.queryByRole('tooltip')).toBeNull();
    // It is the same dismissal after the task: the pointer is on the link yet.
    rig.hover({ ...LINK });
    expect(page.queryByRole('tooltip')).toBeNull();
  });

  it('comes back once the pointer has left the link and reaches a link again, this one too', async () => {
    const rig = mount();
    rig.hover(LINK);
    pressEscape();
    rig.hover(undefined);
    await endTask();
    expect(page.queryByRole('tooltip')).toBeNull();
    rig.hover({ ...LINK });
    expect(page.getByRole('tooltip')).toHaveTextContent('Follow link (cmd + click)');
  });

  it('comes back for another link, and for the same address somewhere else on the screen', () => {
    const rig = mount();
    rig.hover(LINK);
    pressEscape();
    rig.hover({ uri: 'https://example.org/', x: 300, y: 200 });
    expect(page.getByRole('tooltip').style.getPropertyValue('--_x')).toBe('300px');
    pressEscape();
    expect(page.queryByRole('tooltip')).toBeNull();
    rig.hover({ ...LINK, y: 100 });
    expect(page.getByRole('tooltip').style.getPropertyValue('--_y')).toBe('100px');
  });
});

// The target is shown before it opens (#696 step 1). A hyperlink the program writes (OSC 8) has text and a target that may differ: `https://a.example` on the screen can be a link to `https://b.example`. The tooltip says where the
// click goes, in the words of the target itself, whatever the text is, and the click opens that target and no other.
describe('the target', () => {
  const TEXT = 'https://a.example';
  const TARGET = 'https://b.example/login';

  it('is in the tooltip, beside the words that say how to follow the link', () => {
    const rig = mount({ platform: 'other' });
    rig.hover({ uri: TARGET, x: 120, y: 80 });
    const tip = page.getByRole('tooltip');
    expect(tip).toHaveTextContent('Follow link (ctrl + click)');
    expect(tip).toHaveTextContent(TARGET);
    expect(tip).not.toHaveTextContent(TEXT);
  });

  it('is what the click opens, and is in the tooltip when the link is the same one the click is on', () => {
    const rig = mount({ platform: 'other' });
    rig.hover({ uri: TARGET, x: 120, y: 80 });
    rig.follow(TARGET, { ctrlKey: true });
    expect(rig.openExternal).toHaveBeenCalledExactlyOnceWith(TARGET);
    expect(page.getByRole('tooltip')).toHaveTextContent(TARGET);
  });

  it('is the one of the link the pointer is on now: it changes when the pointer moves to another link', () => {
    const rig = mount();
    rig.hover({ uri: TARGET, x: 120, y: 80 });
    rig.hover({ uri: 'https://c.example/', x: 300, y: 200 });
    const tip = page.getByRole('tooltip');
    expect(tip).toHaveTextContent('https://c.example/');
    expect(tip).not.toHaveTextContent(TARGET);
  });

  it('is in the one live region, so that it is said to a person who cannot see it, with the words', () => {
    const rig = mount();
    rig.hover({ uri: TARGET, x: 120, y: 80 });
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(document.querySelector('[aria-live]')).toHaveTextContent(TARGET);
  });

  it('is kept whole, however long: the host name is at the front, and a tooltip that cut the address would show the front only', () => {
    const rig = mount();
    const long = `https://b.example/${'a'.repeat(1900)}`;
    rig.hover({ uri: long, x: 120, y: 80 });
    expect(page.getByRole('tooltip')).toHaveTextContent(long);
  });
});

// The host's own server (#696 step 1): the registry says whether an address is followed, and a link to the host's own port is not one: no tooltip says it is, no click opens it.
describe('an address the registry will not follow', () => {
  const OWN = 'http://localhost:34115/api';

  it('has no tooltip, though it is a web address: a click would open nothing, so the tooltip must not say it follows', () => {
    const rig = mount({ follows: (uri) => uri !== OWN });
    rig.hover({ uri: OWN, x: 120, y: 80 });
    expect(page.queryByRole('tooltip')).toBeNull();
    expect(rig.canFollow).toHaveBeenCalledWith(OWN);
  });

  it('is not handed to the registry to open, with the right click', () => {
    const rig = mount({ platform: 'mac', follows: (uri) => uri !== OWN });
    rig.follow(OWN, { metaKey: true });
    expect(rig.openExternal).not.toHaveBeenCalled();
  });

  it('leaves the others alone: the same hook follows an address the registry does', () => {
    const rig = mount({ platform: 'mac', follows: (uri) => uri !== OWN });
    rig.follow('http://localhost:3000/', { metaKey: true });
    expect(rig.openExternal).toHaveBeenCalledExactlyOnceWith('http://localhost:3000/');
  });
});

// The host first (#696 review): the target is long enough to push its host out of a clamped box, so the host is a line of its own, as the browser reads it, ahead of the target.
describe('the host', () => {
  it('is a line of its own, between the words and the target, whatever the target is', () => {
    const rig = mount({ follows: () => true });
    rig.hover({ uri: `https://b.example/${'a'.repeat(1900)}`, x: 120, y: 80 });
    const tip = page.getByRole('tooltip');
    expect(Array.from(tip.children).map((child) => (child.textContent ?? '').slice(0, 30))).toEqual(['Follow link (cmd + click)', 'b.example', `https://b.example/${'a'.repeat(12)}`]);
  });

  it('is the one the browser reads: an international name shows as punycode', () => {
    const rig = mount({ follows: () => true });
    rig.hover({ uri: 'https://\u0430pple.com/x', x: 120, y: 80 });
    expect(page.getByRole('tooltip').children[1]).toHaveTextContent('xn--pple-43d.com');
  });

  it('is never shown for an address with a user name, which nothing follows: no tooltip at all', () => {
    const rig = mount();
    rig.hover({ uri: `https://accounts.google.com%2Fsignin${'a'.repeat(700)}@evil.example/login`, x: 120, y: 80 });
    expect(page.queryByRole('tooltip')).toBeNull();
  });

  it('is never shown for a target over the length the emulator accepts: no tooltip and no live region of 100,000 characters', () => {
    const rig = mount();
    rig.hover({ uri: `https://b.example/${'a'.repeat(100_000)}`, x: 120, y: 80 });
    expect(page.queryByRole('tooltip')).toBeNull();
  });
});

// THE FILE LINKS (#696 step 4): the host resolves, the page asks only what is worth asking, and a link shows the resolved path before it is followed. What a click does until the editor registers `openFile` (step 5) is
// "Copy path", through the clipboard.
describe('the file links', () => {
  const SRC = { kind: 'file', path: '/work/src/a.go', line: 12, col: 3 } as const satisfies TerminalLink;

  type FileRig = {
    readonly setFileLinks: Mock<NonNullable<TerminalLinksScreen['setFileLinks']>>;
    readonly resolveLink: Mock<(rowDirectory: string, text: string) => Promise<TerminalLink>>;
    readonly busy: Mock<() => Promise<TerminalBusy>>;
    readonly copyPath: Mock<(text: string) => Promise<boolean>>;
    readonly directoryAt: Mock<(row: number) => string | undefined>;
    readonly handler: () => FileLinkHandler;
    readonly hover: (hover: FileLinkHover | undefined) => void;
    readonly rerender: (more?: Partial<TerminalLinksOptions>) => void;
    readonly unmount: () => void;
    readonly links: () => ReturnType<typeof useTerminalLinks>;
  };

  function mountFiles(
    options: { readonly platform?: Platform; readonly table?: Record<string, TerminalLink>; readonly state?: TerminalBusy; readonly candidates?: readonly FileCandidates[]; readonly directory?: string; readonly noResolver?: boolean; readonly noFiles?: boolean } = {},
  ): FileRig {
    const setFileLinks = vi.fn<NonNullable<TerminalLinksScreen['setFileLinks']>>();
    const resolveLink = vi.fn<(rowDirectory: string, text: string) => Promise<TerminalLink>>(async (_directory, text) => Promise.resolve(options.table?.[text] ?? { kind: 'unknown', reason: 'not-found' }));
    const busy = vi.fn<() => Promise<TerminalBusy>>(async () => Promise.resolve(options.state ?? { state: 'idle' }));
    const copyPath = vi.fn<(text: string) => Promise<boolean>>(async () => Promise.resolve(true));
    const directoryAt = vi.fn<(row: number) => string | undefined>(() => options.directory);
    const screen: TerminalLinksScreen = { setLinks: vi.fn(), setFileLinks, directoryAt, fileCandidatesInView: () => options.candidates ?? [] };
    const sessions = { canOpenExternal: () => true, canFollow: isWebAddress, openExternal: vi.fn() };
    let latest: ReturnType<typeof useTerminalLinks> | undefined;
    function Probe(props: TerminalLinksOptions): ReactElement {
      latest = useTerminalLinks(props);
      return <div data-testid="body">{latest.element}</div>;
    }

    const props = (more: Partial<TerminalLinksOptions> = {}): TerminalLinksOptions => ({
      screen,
      sessions,
      platform: options.platform ?? 'mac',
      ...(options.noFiles === true ? {} : { files: { feed: options.noResolver === true ? { busy } : { resolveLink, busy }, copyPath } }),
      ...more,
    });
    const view = render(<Probe {...props()} />);
    const handler = (): FileLinkHandler => {
      const given = setFileLinks.mock.calls.findLast(([next]) => next !== undefined)?.[0];
      if (given === undefined) {
        throw new Error('the screen was given no file link handler');
      }

      return given;
    };

    return {
      setFileLinks,
      resolveLink,
      busy,
      copyPath,
      directoryAt,
      handler,
      hover: (hover) => {
        act(() => {
          handler().hover(hover);
        });
      },
      rerender: (more) => {
        view.rerender(<Probe {...props(more)} />);
      },
      unmount: view.unmount,
      links: () => {
        if (latest === undefined) {
          throw new Error('the hook did not run');
        }

        return latest;
      },
    };
  }

  describe('where there are file links', () => {
    it('gives the screen a handler when the feed can resolve a link, and takes it back with the body', () => {
      const rig = mountFiles();
      expect(rig.setFileLinks).toHaveBeenCalledTimes(1);
      rig.unmount();
      expect(rig.setFileLinks).toHaveBeenLastCalledWith(undefined);
    });

    it('makes none for a feed that has no disk to look at (a terminal of a plugin runs somewhere else), and none for a body given no files', () => {
      expect(mountFiles({ noResolver: true }).setFileLinks).not.toHaveBeenCalledWith(expect.anything());
      expect(mountFiles({ noFiles: true }).setFileLinks).not.toHaveBeenCalledWith(expect.anything());
    });

    it('holds the modifier of the platform: Command on a Mac and Control elsewhere, and no other', () => {
      const mac = mountFiles({ platform: 'mac' }).handler();
      expect([mac.held({ metaKey: true, ctrlKey: false }), mac.held({ metaKey: false, ctrlKey: true }), mac.held({ metaKey: false, ctrlKey: false })]).toEqual([true, false, false]);
      const other = mountFiles({ platform: 'other' }).handler();
      expect([other.held({ metaKey: false, ctrlKey: true }), other.held({ metaKey: true, ctrlKey: false })]).toEqual([true, false]);
    });
  });

  describe('resolving', () => {
    it('asks the host about each candidate with the directory of the row\'s command, and keeps the files and directories it found: any other answer is no link', async () => {
      const rig = mountFiles({ directory: '/srv', table: { 'a.go:1': SRC, 'dir/': { kind: 'dir', path: '/work/dir' }, 'gone.go:2': { kind: 'unknown', reason: 'gone' } } });
      const answers = await rig.handler().resolve(7, ['a.go:1', 'dir/', 'gone.go:2', 'nowhere.go:3']);
      expect(rig.directoryAt).toHaveBeenCalledWith(7);
      expect(rig.resolveLink.mock.calls).toEqual([['/srv', 'a.go:1'], ['/srv', 'dir/'], ['/srv', 'gone.go:2'], ['/srv', 'nowhere.go:3']]);
      expect(answers).toEqual([{ path: '/work/src/a.go', kind: 'file', line: 12, col: 3 }, { path: '/work/dir', kind: 'dir' }, undefined, undefined]);
    });

    it('names no directory of its own: a row that no proven command owns is asked with an empty directory, which is where the shell is now', async () => {
      const rig = mountFiles({ table: { 'a.go:1': SRC } });
      await rig.handler().resolve(0, ['a.go:1']);
      expect(rig.resolveLink.mock.calls).toEqual([['', 'a.go:1']]);
    });

    it.each([
      ['a program holds the foreground (ssh, a container exec)', { state: 'busy', name: 'ssh' } as TerminalBusy],
      ['the host cannot say what runs', { state: 'unknown' } as TerminalBusy],
    ])('asks the host nothing while %s: the answer would be about this machine\'s disk, and there are no links', async (_what, state) => {
      const rig = mountFiles({ state, table: { 'a.go:1': SRC } });
      expect(await rig.handler().resolve(0, ['a.go:1'])).toEqual([]);
      expect(rig.busy).toHaveBeenCalledTimes(1);
      expect(rig.resolveLink).not.toHaveBeenCalled();
    });

    it('asks the host what runs once for a line, and not for each candidate', async () => {
      const rig = mountFiles({ table: { 'a.go:1': SRC, 'b.go:2': SRC } });
      await rig.handler().resolve(0, ['a.go:1', 'b.go:2']);
      expect(rig.busy).toHaveBeenCalledTimes(1);
    });

    it('treats a question about what runs that fails as no links', async () => {
      const rig = mountFiles({ table: { 'a.go:1': SRC } });
      rig.busy.mockRejectedValueOnce(new Error('the host is not there'));
      expect(await rig.handler().resolve(0, ['a.go:1'])).toEqual([]);
      expect(rig.resolveLink).not.toHaveBeenCalled();
    });

    it('asks about at most 10 candidates, whatever it is given', async () => {
      const rig = mountFiles();
      await rig.handler().resolve(0, Array.from({ length: 25 }, (_, index) => `f${String(index)}.go:1`));
      expect(rig.resolveLink).toHaveBeenCalledTimes(10);
    });

    it('makes no link for a candidate whose question failed, and keeps the others', async () => {
      const rig = mountFiles({ table: { 'b.go:2': SRC } });
      rig.resolveLink.mockImplementationOnce(async () => Promise.reject(new Error('timeout')));
      expect(await rig.handler().resolve(0, ['a.go:1', 'b.go:2'])).toEqual([undefined, { path: '/work/src/a.go', kind: 'file', line: 12, col: 3 }]);
    });

    it('never shows a path the host did not give: an answer with no path is no link', async () => {
      const rig = mountFiles({ table: { 'a.go:1': { kind: 'file' } } });
      expect(await rig.handler().resolve(0, ['a.go:1'])).toEqual([undefined]);
    });
  });

  describe('the tooltip', () => {
    const words = (mac: boolean) => `Copy path (${mac ? 'cmd' : 'ctrl'} + click)`;

    it('says the resolved path first and whole, then where in it, after the words that say what the click does', () => {
      const rig = mountFiles({ platform: 'mac' });
      rig.hover({ path: '/work/src/a.go', kind: 'file', line: 12, col: 3, x: 120, y: 80 });
      const tip = page.getByRole('tooltip');
      expect(Array.from(tip.children).map((child) => child.textContent)).toEqual([words(true), '/work/src/a.go', 'line 12, column 3']);
    });

    it('says the words of the platform: control elsewhere', () => {
      const rig = mountFiles({ platform: 'other' });
      rig.hover({ path: '/work/src/a.go', kind: 'file', line: 12, x: 1, y: 1 });
      expect(page.getByRole('tooltip').children[0]).toHaveTextContent(words(false));
    });

    it('says the line alone when the text gave no column, and no position at all when it gave neither (a directory)', () => {
      const rig = mountFiles();
      rig.hover({ path: '/work/src/a.go', kind: 'file', line: 12, x: 1, y: 1 });
      expect(page.getByRole('tooltip').children[2]).toHaveTextContent('line 12');
      rig.hover({ path: '/work/src', kind: 'dir', x: 1, y: 1 });
      expect(Array.from(page.getByRole('tooltip').children).map((child) => child.textContent)).toEqual([words(true), '/work/src']);
    });

    it('keeps a long path whole in the document: the path is the one thing the person decides on', () => {
      const rig = mountFiles();
      const long = `/work/${'d'.repeat(900)}/a.go`;
      rig.hover({ path: long, kind: 'file', x: 1, y: 1 });
      expect(page.getByRole('tooltip').children[1]).toHaveTextContent(long);
    });

    it('is the one tooltip of a link, as a web link\'s is: a file link and then a web link are one tooltip at a time', () => {
      const rig = mountFiles();
      rig.hover({ path: '/work/src/a.go', kind: 'file', x: 1, y: 1 });
      act(() => {
        rig.setFileLinks.mock.calls.at(-1)?.[0]?.hover(undefined);
      });
      expect(page.queryByRole('tooltip')).toBeNull();
    });
  });

  describe('following a file link', () => {
    it('copies the path with the line and the column, with the platform\'s click, once: the editor that opens a file is step 5', async () => {
      const rig = mountFiles({ platform: 'mac' });
      rig.handler().activate({ path: '/work/src/a.go', kind: 'file', line: 12, col: 3 }, new MouseEvent('click', { metaKey: true }));
      expect(rig.copyPath).toHaveBeenCalledExactlyOnceWith('/work/src/a.go:12:3');
    });

    it('copies the path alone when the text gave no position, and a directory\'s path', () => {
      const rig = mountFiles({ platform: 'mac' });
      rig.handler().activate({ path: '/work/src', kind: 'dir' }, new MouseEvent('click', { metaKey: true }));
      rig.handler().activate({ path: '/work/a.go', kind: 'file', line: 7 }, new MouseEvent('click', { metaKey: true }));
      expect(rig.copyPath.mock.calls).toEqual([['/work/src'], ['/work/a.go:7']]);
    });

    it('does nothing for a click without the platform\'s modifier: a plain click selects', () => {
      const rig = mountFiles({ platform: 'other' });
      rig.handler().activate({ path: '/work/a.go', kind: 'file' }, new MouseEvent('click'));
      rig.handler().activate({ path: '/work/a.go', kind: 'file' }, new MouseEvent('click', { metaKey: true }));
      expect(rig.copyPath).not.toHaveBeenCalled();
    });

    it('says once on the console when the clipboard refuses, and does not throw', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const rig = mountFiles({ platform: 'mac' });
      rig.copyPath.mockResolvedValueOnce(false);
      rig.handler().activate({ path: '/work/a.go', kind: 'file' }, new MouseEvent('click', { metaKey: true }));
      await Promise.resolve();
      await Promise.resolve();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('the links in view, for a person with no pointer', () => {
    it('resolves the candidates of the lines in view when asked, and lists what the host found, once each, in the order of the lines', async () => {
      const rig = mountFiles({ candidates: [{ row: 5, texts: ['a.go:1', 'b.go:2'] }, { row: 2, texts: ['a.go:1', 'nowhere.go:3'] }], table: { 'a.go:1': SRC, 'b.go:2': { kind: 'file', path: '/work/b.go', line: 2 } } });
      expect(rig.links().files?.inView()).toEqual([]);
      await act(async () => {
        await rig.links().files?.warm();
      });
      expect(rig.links().files?.inView()).toEqual([{ path: '/work/src/a.go', kind: 'file', line: 12, col: 3 }, { path: '/work/b.go', kind: 'file', line: 2 }]);
      expect(rig.resolveLink).toHaveBeenCalledTimes(4);
    });

    it('lists nothing while a program holds the foreground, and asks the host nothing about the lines', async () => {
      const rig = mountFiles({ state: { state: 'busy', name: 'ssh' }, candidates: [{ row: 0, texts: ['a.go:1'] }], table: { 'a.go:1': SRC } });
      await act(async () => {
        await rig.links().files?.warm();
      });
      expect(rig.links().files?.inView()).toEqual([]);
      expect(rig.resolveLink).not.toHaveBeenCalled();
    });

    it('has no such members for a body with no file links', () => {
      expect(mountFiles({ noFiles: true }).links().files).toBeUndefined();
    });
  });
});
