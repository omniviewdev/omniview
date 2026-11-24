import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, seedChips } from '../core/palette';
import { command, manyCommands, mount, page, teardown, type Mounted } from './testing';

// The palette's view over the real store and the real tab model (ch16 S66 to S73, ch05 "Keyboard shortcuts and command palette"): what it draws, which roles and names it has, what each key and
// each pointer event does, where the focus goes. Ranking, merging and what a row does are the model's (core/palette) and are not repeated here. jsdom has no layout and no top layer: the
// geometry and the modal's own behaviour are the probe's (probes/palette-probe.mjs).

afterEach(teardown);

/** Opens the palette from the opener button, the way a user does it from where they are. */
function open(m: Mounted, opening: Parameters<Mounted['store']['open']>[0] = {}): HTMLElement {
  m.opener.focus();
  act(() => {
    m.store.open(opening);
  });
  return screen.getByRole('dialog', { name: 'Search' });
}

const field = (): HTMLInputElement => screen.getByRole('combobox', { name: /^Search/ });
const options = (): HTMLElement[] => screen.queryAllByRole('option');
const optionNames = (): string[] => options().map((element) => element.getAttribute('aria-label') ?? '');
const activeOption = (): HTMLElement | undefined => options().find((element) => element.getAttribute('aria-selected') === 'true');
const titleOf = (element: HTMLElement | undefined): string => element?.getAttribute('aria-label')?.split(': ')[1]?.split(',')[0] ?? '';
const optionOf = (title: string): HTMLElement => {
  const found = options().find((element) => titleOf(element) === title);
  if (found === undefined) {
    throw new Error(`no row ${title}: ${optionNames().join(' | ')}`);
  }

  return found;
};

const partOf = (dialog: HTMLElement, part: string): HTMLElement => {
  const found = dialog.querySelector<HTMLElement>(`[data-palette-part="${part}"]`);
  if (found === null) {
    throw new Error(`no part ${part}`);
  }

  return found;
};

describe('opening and closing', () => {
  it('draws nothing while it is closed', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-palette-part]')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('opens as a modal dialog named Search, with the focus in its input', () => {
    const m = mount();
    // The shim that `mount` installs (jsdom has no `showModal`) is what is spied on: spying first throws when this test runs alone.
    const showModal = vi.spyOn(HTMLDialogElement.prototype as unknown as { showModal: () => void }, 'showModal');
    const dialog = open(m);
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(field()).toHaveFocus();
  });

  it('opens with Command K from anywhere, and the same chord closes it (a toggle, S66)', async () => {
    const m = mount();
    await m.user.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    expect(field()).toHaveFocus();
    await m.user.keyboard('{Meta>}k{/Meta}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens with Control K elsewhere, and leaves Command K to the page there', async () => {
    const m = mount({ platform: 'Linux x86_64' });
    await m.user.keyboard('{Meta>}k{/Meta}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await m.user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
  });

  it('does not toggle on a key that is held down: a chord that flickered would close what it just opened', () => {
    const m = mount();
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', metaKey: true, repeat: true });
    expect(m.store.getSnapshot().open).toBe(true);
  });

  it('opens with what the host says: the query it starts with, which the input shows and the list follows', async () => {
    const opening = vi.fn(() => ({ query: 'vol' }));
    const m = mount({ opening });
    await m.user.keyboard('{Meta>}k{/Meta}');
    expect(opening).toHaveBeenCalledTimes(1);
    expect(field()).toHaveValue('vol');
    expect(optionNames().some((name) => name.includes('Volumes'))).toBe(true);
  });

  it('closes with Escape and gives the focus back to the element that had it', async () => {
    const m = mount();
    open(m);
    await m.user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(m.opener).toHaveFocus();
    });
  });

  it('gives the page the focus when the element that had it is gone: the focus never ends on the body', async () => {
    const m = mount();
    // An element React does not own, so the test can take it out of the document the way a script or another tree does.
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    act(() => {
      m.store.open({});
    });
    outside.remove();
    await m.user.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.querySelector('main')).toHaveFocus();
    });
  });

  it('closes on a press outside the palette, and not on one inside it', () => {
    const m = mount();
    const dialog = open(m);
    fireEvent.pointerDown(field());
    fireEvent.pointerDown(within(dialog).getByRole('listbox'));
    expect(m.store.getSnapshot().open).toBe(true);
    fireEvent.pointerDown(dialog);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes through the model on a close request of the platform, and the browser does not close the dialog by itself', () => {
    const m = mount();
    const dialog = open(m);
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(m.store.getSnapshot().open).toBe(false);
  });

  it('does not take Tab: the keys of moving between controls are the browser\'s (S67)', () => {
    const m = mount();
    open(m);
    expect(fireEvent.keyDown(field(), { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(field(), { key: 'Tab', shiftKey: true })).toBe(true);
  });

  it('keeps the window\'s own chords from the page behind it: close, jump and toggle panel are taken while it is open, and left alone once it is closed', () => {
    const m = mount();
    const chords = [
      { code: 'KeyW', key: 'w' },
      { code: 'Digit2', key: '2' },
      { code: 'KeyJ', key: 'j' },
    ];
    const press = (init: { code: string; key: string }): boolean => fireEvent.keyDown(document.body, { ...init, metaKey: true });
    for (const chord of chords) {
      expect(press(chord)).toBe(true);
    }

    open(m);
    for (const chord of chords) {
      expect(press(chord)).toBe(false);
    }

    expect(fireEvent.keyDown(field(), { key: 'c', code: 'KeyC', metaKey: true })).toBe(true);
  });

  it('leaves nothing behind when it closes: it holds the one chord listener while closed, and no listener or timer after an open', () => {
    // The timers a palette could start. jsdom's own `setImmediate` (it queues a task to fire `select`) is not one of them, and React's scheduler is not counted either.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      // The window's listener methods are its own, and the prototype's are everything else's (documents and elements).
      const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
      const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
      const windowAdd = vi.spyOn(window, 'addEventListener');
      const windowRemove = vi.spyOn(window, 'removeEventListener');
      const captures = (options: unknown): boolean => options === true || (typeof options === 'object' && options !== null && 'capture' in options && options.capture === true);
      type Registration = { readonly target: unknown; readonly type: string; readonly listener: unknown; readonly capture: boolean };
      type Operation = Registration & { readonly order: number; readonly adds: boolean };
      type Calls = { readonly mock: { readonly calls: ReadonlyArray<readonly unknown[]>; readonly contexts: readonly unknown[]; readonly invocationCallOrder: readonly number[] } };
      const operations = (spy: Calls, own: unknown, adds: boolean): Operation[] =>
        spy.mock.calls.map((call, index) => ({ target: own ?? spy.mock.contexts[index], type: String(call[0]), listener: call[1], capture: captures(call[2]), order: spy.mock.invocationCallOrder[index] ?? 0, adds }));
      const same = (a: Registration, b: Registration): boolean => a.target === b.target && a.type === b.type && a.listener === b.listener && a.capture === b.capture;
      /** The listeners added and not removed, replayed in the order the calls were made (a callback added, removed and added again is held), on what is still part of the page (an element that left takes its own listeners with it). */
      const held = (): string[] => {
        const live: Registration[] = [];
        const calls = [...operations(add, undefined, true), ...operations(windowAdd, window, true), ...operations(remove, undefined, false), ...operations(windowRemove, window, false)].sort((a, b) => a.order - b.order);
        for (const call of calls) {
          const at = live.findIndex((one) => same(one, call));
          if (!call.adds) {
            if (at >= 0) {
              live.splice(at, 1);
            }
          } else if (at < 0) {
            live.push(call);
          }
        }

        return live
          .filter((one) => one.target === window || one.target === document || (one.target instanceof Node && one.target.isConnected))
          .map((one) => `${one.target === window ? 'window' : one.target === document ? 'document' : 'node'}|${one.type}|${String(one.capture)}`);
      };

      const m = mount();
      expect(held().filter((entry) => entry.startsWith('window|'))).toEqual(['window|keydown|true']);
      const baseline = held();
      // What React's own scheduler holds is not the palette's: the claim is that opening, typing and closing leave no timer of its own, in the browser's clock or the model's.
      const timers = vi.getTimerCount();
      open(m);
      act(() => {
        m.store.setQuery('ins');
      });
      act(() => {
        m.store.close();
      });
      expect(held()).toEqual(baseline);
      expect(vi.getTimerCount()).toBe(timers);
      expect(m.f.clock.pending()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the combobox and the listbox', () => {
  it('is a combobox over a listbox, named, with the focus staying in the input (ARIA 1.2, ch05)', () => {
    const m = mount();
    const dialog = open(m);
    const input = field();
    const list = within(dialog).getByRole('listbox', { name: 'Results' });
    expect(list).toHaveAttribute('aria-busy', 'false');
    expect(input).toHaveAttribute('aria-controls', list.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-haspopup', 'listbox');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('maxlength', String(LIMITS.query));
    expect(input).toHaveAttribute('placeholder', 'Search pages, resources, commands and settings');
    expect(input).toHaveAccessibleName('Search');
    expect(input).toHaveFocus();
  });

  it('names the active row in aria-activedescendant, and marks it selected: the first row that can be opened', () => {
    const m = mount();
    open(m, { kind: 'goto' });
    const active = activeOption();
    expect(titleOf(active)).toBe('Instances');
    expect(field()).toHaveAttribute('aria-activedescendant', active?.id);
    expect(options().filter((element) => element.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(field()).toHaveFocus();
  });

  it('has a row for each result: an option named by the model, in a group named by its heading', () => {
    const m = mount();
    const dialog = open(m, { kind: 'goto' });
    const group = within(dialog).getByRole('group', { name: 'Go to' });
    expect(within(group).getAllByRole('option')).toHaveLength(4);
    expect(optionNames()).toEqual(['Page: Instances, Cloud · Compute', 'Page: Volumes, Cloud · Storage', 'Page: Buckets, Cloud · Storage', 'Plugin home: Cloud, Compute']);
  });

  it('moves the active row with Down and Up, wrapping at both ends, and reveals it', async () => {
    const m = mount();
    open(m, { kind: 'goto' });
    const reveal = vi.fn();
    for (const element of options()) {
      element.scrollIntoView = reveal;
    }

    await m.user.keyboard('{ArrowDown}');
    expect(titleOf(activeOption())).toBe('Volumes');
    expect(reveal).toHaveBeenCalledWith({ block: 'nearest' });
    await m.user.keyboard('{ArrowUp}{ArrowUp}');
    expect(titleOf(activeOption())).toBe('Cloud');
    await m.user.keyboard('{ArrowDown}');
    expect(titleOf(activeOption())).toBe('Instances');
    expect(field()).toHaveFocus();
  });

  it('moves a page with PageDown and PageUp and stops at the ends', async () => {
    const m = mount({ register: false });
    m.f.palette.registerProvider({ id: 'host:commands', plugin: 'host', section: 'commands', match: () => manyCommands(20) });
    open(m, { kind: 'commands' });
    expect(options()).toHaveLength(20);
    const at = (): number => options().findIndex((element) => element.getAttribute('aria-selected') === 'true');
    await m.user.keyboard('{PageDown}');
    expect(at()).toBe(8);
    await m.user.keyboard('{PageDown}{PageDown}{PageDown}');
    expect(at()).toBe(19);
    await m.user.keyboard('{PageUp}');
    expect(at()).toBe(11);
  });

  it('goes to the first and the last row with Home and End where the caret has nowhere to go, and leaves them to the caret otherwise', async () => {
    const m = mount();
    open(m, { kind: 'goto' });
    // An empty input: the caret is at both ends already.
    await m.user.keyboard('{End}');
    expect(titleOf(activeOption())).toBe('Cloud');
    await m.user.keyboard('{Home}');
    expect(titleOf(activeOption())).toBe('Instances');

    await m.user.type(field(), 'o');
    await m.user.keyboard('{ArrowDown}');
    const second = titleOf(activeOption());
    const at = (): number => options().findIndex((element) => element.getAttribute('aria-selected') === 'true');
    // The caret is at the end of the text: End goes on to the last row, and Home moves the caret to the start first.
    await m.user.keyboard('{Home}');
    expect(field().selectionStart).toBe(0);
    expect(titleOf(activeOption())).toBe(second);
    await m.user.keyboard('{End}');
    expect(field().selectionStart).toBe(1);
    expect(titleOf(activeOption())).toBe(second);
    await m.user.keyboard('{End}');
    expect(at()).toBe(options().length - 1);
    await m.user.keyboard('{Home}{Home}');
    expect(at()).toBe(0);
  });

  it('does not take the arrows with Alt or a command key: those are the platform\'s', () => {
    const m = mount();
    open(m, { kind: 'goto' });
    expect(fireEvent.keyDown(field(), { key: 'ArrowDown', altKey: true })).toBe(true);
    expect(fireEvent.keyDown(field(), { key: 'ArrowDown', metaKey: true })).toBe(true);
    expect(titleOf(activeOption())).toBe('Instances');
  });

  it('moves to a row the pointer really moved onto, and not to one a still pointer is over: the keyboard\'s row is not stolen (the mock: hover moves the active row only after the pointer really moved)', () => {
    const m = mount();
    open(m, { kind: 'goto' });
    const buckets = optionOf('Buckets');
    const volumes = optionOf('Volumes');
    fireEvent.pointerOver(buckets);
    fireEvent.pointerEnter(buckets);
    fireEvent.mouseOver(buckets);
    expect(titleOf(activeOption())).toBe('Instances');
    fireEvent.pointerMove(buckets, { clientX: 40, clientY: 90, pointerType: 'mouse' });
    expect(titleOf(activeOption())).toBe('Buckets');
    // The keyboard moves on, and the list scrolls under a pointer that has not moved: it fires over and move again at the same place.
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(titleOf(activeOption())).toBe('Volumes');
    fireEvent.pointerMove(buckets, { clientX: 40, clientY: 90, pointerType: 'mouse' });
    expect(titleOf(activeOption())).toBe('Volumes');
    fireEvent.pointerMove(volumes, { clientX: 41, clientY: 90, pointerType: 'mouse' });
    expect(titleOf(activeOption())).toBe('Volumes');
    fireEvent.pointerMove(buckets, { clientX: 42, clientY: 91, pointerType: 'mouse' });
    expect(titleOf(activeOption())).toBe('Buckets');
  });

  it('does not take a touch for a hover', () => {
    const m = mount();
    open(m, { kind: 'goto' });
    fireEvent.pointerMove(optionOf('Buckets'), { clientX: 40, clientY: 90, pointerType: 'touch' });
    expect(titleOf(activeOption())).toBe('Instances');
  });

  it('keeps the focus in the input when a row is pressed: the press must not take it', () => {
    const m = mount();
    open(m, { kind: 'goto' });
    expect(fireEvent.mouseDown(optionOf('Buckets'))).toBe(false);
    expect(field()).toHaveFocus();
  });

  it('does not put the rows in the Tab order: the one stop is the input', () => {
    const m = mount();
    open(m, { kind: 'goto' });
    for (const element of options()) {
      expect(element).toHaveAttribute('tabindex', '-1');
    }
  });
});

describe('opening a row', () => {
  it('opens the active place on Enter through the tab model, closes, and gives the focus back', async () => {
    const m = mount();
    open(m, { kind: 'goto' });
    await m.user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(m.h.titles()).toContain('Buckets');
    await waitFor(() => {
      expect(m.opener).toHaveFocus();
    });
  });

  it('opens in a background tab on Command Enter: the tab on screen stays, and a new tab is after it', async () => {
    const m = mount();
    const on = m.h.active();
    open(m, { kind: 'goto' });
    await m.user.keyboard('{ArrowDown}{ArrowDown}{Meta>}{Enter}{/Meta}');
    expect(m.h.active()).toBe(on);
    expect(m.h.titles()).toEqual(['Instances', 'Buckets', 'Volumes']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens in a background tab on Control Enter elsewhere', async () => {
    const m = mount({ platform: 'Linux x86_64' });
    const on = m.h.active();
    open(m, { kind: 'goto' });
    await m.user.keyboard('{ArrowDown}{ArrowDown}{Control>}{Enter}{/Control}');
    expect(m.h.active()).toBe(on);
    expect(m.h.titles()).toEqual(['Instances', 'Buckets', 'Volumes']);
  });

  it('opens here on Option Enter: the tab on screen goes to the place, and no tab is added', async () => {
    const m = mount();
    const on = m.h.active();
    open(m, { kind: 'goto' });
    await m.user.keyboard('{ArrowDown}{ArrowDown}{Alt>}{Enter}{/Alt}');
    expect(m.h.active()).toBe(on);
    expect(m.h.titles()).toEqual(['Buckets', 'Volumes']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens in a new tab on Command Shift Enter: the new tab is on screen, after the one that was', async () => {
    const m = mount();
    const on = m.h.active();
    open(m, { kind: 'goto' });
    await m.user.keyboard('{ArrowDown}{ArrowDown}{Meta>}{Shift>}{Enter}{/Shift}{/Meta}');
    expect(m.h.active()).not.toBe(on);
    expect(m.h.titles()).toEqual(['Instances', 'Buckets', 'Volumes']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refuses Shift Enter, which would open a window this window cannot open: it says why in the footer, stays open and opens nothing', async () => {
    const m = mount();
    const dialog = open(m, { kind: 'goto' });
    await m.user.keyboard('{ArrowDown}{ArrowDown}{Shift>}{Enter}{/Shift}');
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    expect(partOf(dialog, 'foot')).toHaveTextContent('This window cannot open another one yet.');
    expect(m.h.titles()).toEqual(['Instances', 'Volumes']);
  });

  it('opens a row with a click, and a row with a Command click in the background', () => {
    const m = mount();
    const on = m.h.active();
    open(m, { kind: 'goto' });
    fireEvent.click(optionOf('Buckets'), { metaKey: true, button: 0 });
    expect(m.h.active()).toBe(on);
    expect(m.h.titles()).toContain('Buckets');
    expect(screen.queryByRole('dialog')).toBeNull();
    open(m, { kind: 'goto' });
    const volumes = m.h.ids()[m.h.titles().indexOf('Volumes')];
    expect(m.h.active()).not.toBe(volumes);
    fireEvent.click(optionOf('Volumes'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(m.h.active()).toBe(volumes);
    expect(m.h.titles().filter((title) => title === 'Volumes')).toHaveLength(1);
  });

  it('opens a row with the middle button in the background', () => {
    const m = mount();
    const on = m.h.active();
    open(m, { kind: 'goto' });
    fireEvent(optionOf('Buckets'), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(m.h.active()).toBe(on);
    expect(m.h.titles()).toContain('Buckets');
  });

  it('runs a command on Enter, which ignores the modifiers, and closes', async () => {
    const m = mount();
    open(m, { kind: 'commands' });
    await m.user.keyboard('{ArrowDown}{Shift>}{Enter}{/Shift}');
    expect(m.f.ran.map((run) => run.id)).toEqual(['host.panel.toggle']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refuses a row that cannot open and stays open, saying why in the footer and in the live region', async () => {
    const m = mount({ register: false });
    m.f.palette.registerProvider({
      id: 'cloud:pages',
      plugin: 'cloud',
      section: 'goto',
      match: () => [
        { id: 'a', kind: 'page' as const, title: 'Alpha', route: { plugin: 'cloud', contribution: 'alpha' }, unavailable: 'Needs an update' },
        { id: 'b', kind: 'page' as const, title: 'Beta', route: { plugin: 'cloud', contribution: 'beta' } },
      ],
    });
    const dialog = open(m);
    await m.user.type(field(), 'a');
    // The first row that can open is active, not the first row.
    expect(optionNames().map((name) => name.split(': ')[1])).toEqual(['Alpha, Unavailable. Needs an update', 'Beta']);
    expect(titleOf(activeOption())).toBe('Beta');
    const alpha = optionOf('Alpha');
    expect(alpha).toHaveAttribute('aria-disabled', 'true');
    fireEvent.pointerMove(alpha, { clientX: 5, clientY: 5, pointerType: 'mouse' });
    expect(titleOf(activeOption())).toBe('Alpha');
    expect(partOf(dialog, 'foot')).toHaveTextContent('Needs an update');
    await m.user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(m.h.titles()).not.toContain('Alpha');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Alpha: Needs an update');
  });

  it('says what a command that refused said, in the footer too: a live region alone leaves a sighted user with nothing', async () => {
    const m = mount({ register: false, run: () => ({ ok: false, reason: 'There is no panel.' }) });
    m.f.palette.registerProvider({ id: 'host:commands', plugin: 'host', section: 'commands', match: () => [command('x.fail', 'Toggle panel')] });
    const dialog = open(m, { kind: 'commands' });
    await m.user.keyboard('{Enter}');
    expect(m.store.getSnapshot().open).toBe(true);
    expect(partOf(dialog, 'foot')).toHaveTextContent('Toggle panel: There is no panel.');
    await m.user.keyboard('{ArrowDown}');
    expect(partOf(dialog, 'foot')).not.toHaveTextContent('There is no panel.');
  });
});

describe('what a row says', () => {
  it('draws the matched run of the title in weight 600 and the rest plain, never in colour alone', async () => {
    const m = mount();
    open(m);
    await m.user.type(field(), 'ins');
    const row = options().find((element) => element.getAttribute('aria-label')?.startsWith('Page: Instances') === true);
    expect(row).toBeDefined();
    expect(row?.querySelector('b')?.textContent).toBe('Ins');
    expect(row?.textContent).toContain('Instances');
  });

  it('draws a tile for the kind, the muted context, and the key hint of a command that is bound, and of no other', () => {
    const m = mount();
    open(m, { kind: 'commands' });
    const close = optionOf('Close tab');
    const toggle = optionOf('Toggle panel');
    expect(close.querySelector('svg')).not.toBeNull();
    expect(within(close).getByText('Tabs')).toBeInTheDocument();
    expect(close.querySelector('[data-palette-part="meta"] kbd')).toHaveTextContent(/^⌘W$/);
    expect(close).toHaveAccessibleName('Command: Close tab, Tabs, ⌘W');
    expect(toggle.querySelector('kbd')).toBeNull();
  });

  it('says a row that opens to a recovery page as a word, with the reason as its tip', () => {
    const m = mount({ register: false });
    m.f.palette.registerProvider({
      id: 'cloud:pages',
      plugin: 'cloud',
      section: 'goto',
      match: () => [{ id: 'a', kind: 'page' as const, title: 'Alpha', route: { plugin: 'cloud', contribution: 'alpha' } }],
    });
    m.h.world.report('cloud', { state: 'degraded', reason: 'This plugin is loading.' });
    open(m, { kind: 'goto' });
    expect(optionOf('Alpha')).toHaveTextContent('Degraded');
    expect(optionOf('Alpha')).toHaveAttribute('data-state', 'degraded');
    expect(optionOf('Alpha')).toHaveAttribute('data-ov-tip', 'This plugin is loading.');
  });

  describe('the name of a row holds what the row shows', () => {
    // axe's label-content-name-mismatch (WCAG 2.5.3 Label in Name), as it compares: the visible text, lower case and without punctuation, is found in the accessible name the same way.
    const curated = (text: string): string =>
      text
        .toLowerCase()
        .replace(/[\u2000-\u206F\\'!"#$%&()*+,\-./:;<=>?@[\]^_`{|}~]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const shownRows = (): string[] => {
      const rows = options();
      expect(rows.length).toBeGreaterThan(0);
      return rows.filter((row) => !curated(row.getAttribute('aria-label') ?? '').includes(curated(row.textContent ?? ''))).map((row) => `${row.getAttribute('aria-label') ?? ''} <- ${row.textContent ?? ''}`);
    };

    const world = (): Mounted => {
      const m = mount({ register: false });
      m.f.palette.registerProvider({
        id: 'cloud:pages',
        plugin: 'cloud',
        pluginName: 'Cloud',
        title: 'Pages',
        section: 'goto',
        match: () => [page('instances', 'Instances', { context: 'Cloud · Compute' }), page('volumes', 'Volumes', { context: 'Cloud · Storage', unavailable: 'Needs an update' }), page('buckets', 'Buckets')],
      });
      m.f.palette.registerProvider({
        id: 'host:commands',
        plugin: 'host',
        pluginName: 'Omniview',
        title: 'Commands',
        section: 'commands',
        match: () => [command('host.tab.close', 'Close tab', { context: 'Tabs', shortcut: '⌘W' }), ...manyCommands(12)],
      });
      for (const name of ['a', 'b', 'c', 'd', 'e']) {
        m.f.palette.registerProvider({
          id: `flaky${name}:pages`,
          plugin: `flaky${name}`,
          pluginName: `Flaky ${name}`,
          title: 'Pages',
          section: 'goto',
          match: (): never => {
            throw new Error('it is down');
          },
        });
      }

      return m;
    };

    it('does, in the list of results: a context, a chord, a state word and the Show all of a folded section', async () => {
      const m = world();
      m.h.world.report('cloud', { state: 'degraded', reason: 'This plugin is loading.' });
      open(m);
      await m.user.type(field(), 'e');
      expect(optionNames().some((name) => name.startsWith('More results:'))).toBe(true);
      expect(optionNames().some((name) => name.includes('Degraded'))).toBe(true);
      expect(optionNames().some((name) => name.includes('Unavailable'))).toBe(true);
      expect(shownRows()).toEqual([]);
    });

    it('does, in the list of commands: the chord of a command that has one', () => {
      const m = world();
      open(m, { kind: 'commands' });
      expect(within(optionOf('Close tab')).getByText('⌘W')).toBeInTheDocument();
      expect(shownRows()).toEqual([]);
    });

    it('does, in the list of sources: what each is doing, in the words the row shows', async () => {
      const m = world();
      const dialog = open(m);
      await m.user.type(field(), 'e');
      await m.user.click(within(partOf(dialog, 'band')).getByRole('button', { name: '+2 more, show all 5 sources' }));
      expect(optionNames().some((name) => name.startsWith('Source:'))).toBe(true);
      expect(shownRows()).toEqual([]);
    });
  });

  it('draws the sections in the model\'s order with a heading each, which assistive technology reads once, as the group\'s name', async () => {
    const m = mount();
    const dialog = open(m);
    await m.user.type(field(), 'ins');
    const groups = within(dialog).getAllByRole('group');
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) {
      const heading = document.getElementById(group.getAttribute('aria-labelledby') ?? '');
      expect(heading).not.toBeNull();
      expect(heading).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('lists the keys of the active row in the footer, written for the platform and named in words for a screen reader', () => {
    const m = mount();
    const dialog = open(m, { kind: 'goto' });
    const foot = partOf(dialog, 'foot');
    expect(within(foot).getByText('Open')).toBeInTheDocument();
    const keys = within(foot).getByText('Background tab').previousElementSibling;
    expect(keys?.tagName).toBe('KBD');
    expect(keys?.querySelector('[aria-hidden="true"]')).toHaveTextContent('⌘↵');
    expect(keys).toHaveTextContent('Command Enter');
  });

  it('says the open keys that work and no other: a host that cannot open a window does not advertise one', () => {
    const m = mount();
    const foot = partOf(open(m, { kind: 'goto' }), 'foot');
    for (const label of ['Open', 'Here', 'New tab', 'Background tab']) {
      expect(within(foot).getByText(label)).toBeInTheDocument();
    }

    expect(within(foot).queryByText('New window')).toBeNull();
  });

  it('writes the keys with Control elsewhere', () => {
    const m = mount({ platform: 'Linux x86_64' });
    const dialog = open(m, { kind: 'goto' });
    const keys = within(partOf(dialog, 'foot')).getByText('Background tab').previousElementSibling;
    expect(keys?.querySelector('[aria-hidden="true"]')).toHaveTextContent('Ctrl+Enter');
    expect(keys).toHaveTextContent('Control Enter');
  });
});

describe('the states of the list', () => {
  it('has no note and the plugin homes before anything is typed', () => {
    const m = mount();
    const dialog = open(m);
    expect(dialog.querySelector('[data-palette-part="note"]')).toBeNull();
    expect(optionNames()).toEqual(['Plugin home: Cloud, Compute']);
  });

  it('says Nothing to show yet in a kind that has no rows and no query, and offers the plugin homes as somewhere to go from (the mock\'s rule: `note = query ? No results for “q” : Nothing to show yet`, then Suggestions)', () => {
    const m = mount();
    const dialog = open(m, { kind: 'settings' });
    expect(partOf(dialog, 'note')).toHaveTextContent('Nothing to show yet');
    expect(within(dialog).getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('group', { name: 'Suggestions' })).toBeInTheDocument();
    expect(optionNames()).toEqual(['Plugin home: Cloud, Compute']);
  });

  it('says what matched nothing, in the mock\'s quotes, and offers somewhere to go from', async () => {
    const m = mount();
    const dialog = open(m);
    await m.user.type(field(), 'zzz');
    expect(partOf(dialog, 'note')).toHaveTextContent('No results for “zzz”');
    expect(options().length).toBeGreaterThan(0);
    expect(m.store.getSnapshot().total).toBe(0);
  });

  it('puts Search everywhere first when the search is narrowed, and removing the scope is what it does', async () => {
    const m = mount();
    open(m, { scope: seedChips({ plugin: 'cloud', pluginName: 'Cloud', pluginIcon: 'server', scope: { id: 'north', label: 'north' } }) });
    await m.user.type(field(), 'zzz');
    expect(optionNames()[0]).toContain('Search everywhere');
    expect(titleOf(activeOption())).toBe('Search everywhere');
    await m.user.keyboard('{Enter}');
    expect(m.store.getSnapshot().chips).toHaveLength(0);
    expect(m.store.getSnapshot().open).toBe(true);
  });
});

describe('the kinds and the input', () => {
  it('has the five kinds as a tablist with one tab stop, and All selected', () => {
    const m = mount();
    const dialog = open(m);
    const list = within(dialog).getByRole('tablist', { name: 'Result kinds' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['All', 'Go to', 'Tabs', 'Commands', 'Settings']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('selects a kind with a click, and says what it searches in the input', async () => {
    const m = mount();
    const dialog = open(m);
    await m.user.click(within(dialog).getByRole('tab', { name: 'Commands' }));
    expect(m.store.getSnapshot().kind).toBe('commands');
    expect(field()).toHaveAttribute('placeholder', 'Search commands');
    expect(within(dialog).getByRole('tab', { name: 'Commands' })).toHaveAttribute('aria-selected', 'true');
  });

  it('takes the first character that names a kind into the kind, and leaves the input without it', async () => {
    const m = mount();
    open(m);
    await m.user.type(field(), '>');
    expect(m.store.getSnapshot().kind).toBe('commands');
    expect(field()).toHaveValue('');
    await m.user.keyboard('{Backspace}');
    expect(m.store.getSnapshot().kind).toBe('all');
  });

  it('shows what is typed, and searches it only when an input method has finished composing', () => {
    const m = mount();
    open(m);
    fireEvent.compositionStart(field());
    fireEvent.change(field(), { target: { value: 'vol' } });
    expect(field()).toHaveValue('vol');
    expect(m.store.getSnapshot().composing).toBe(true);
    fireEvent.compositionEnd(field(), { data: 'vol' });
    expect(m.store.getSnapshot().composing).toBe(false);
    expect(m.store.getSnapshot().query).toBe('vol');
    expect(optionNames().some((name) => name.includes('Volumes'))).toBe(true);
  });

  it('does not act on a key while a composition is in progress', () => {
    const m = mount();
    open(m, { kind: 'goto' });
    expect(fireEvent.keyDown(field(), { key: 'Enter', isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(field(), { key: 'ArrowDown', keyCode: 229 })).toBe(true);
    expect(m.store.getSnapshot().open).toBe(true);
    expect(titleOf(activeOption())).toBe('Instances');
  });
});

describe('the chips of a narrowed search (S69)', () => {
  const scoped = () => seedChips({ plugin: 'cloud', pluginName: 'Cloud', pluginIcon: 'server', scope: { id: 'north', label: 'north' } });

  it('names the search by where it is, and draws a chip for the plugin and the scope, each with a named Remove', () => {
    const m = mount();
    const dialog = open(m, { scope: scoped() });
    expect(field()).toHaveAccessibleName('Search in Cloud › north');
    const group = within(dialog).getByRole('group', { name: 'Search scope' });
    expect(within(group).getByRole('button', { name: 'Cloud', pressed: false })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'scope north', pressed: false })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Remove Cloud and dependent scopes' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Remove scope north' })).toBeInTheDocument();
  });

  it('keeps the chips out of the Tab order: they are reached with the arrows from the input', () => {
    const m = mount();
    const dialog = open(m, { scope: scoped() });
    for (const button of within(within(dialog).getByRole('group', { name: 'Search scope' })).getAllByRole('button')) {
      expect(button).toHaveAttribute('tabindex', '-1');
    }
  });

  it('selects the last chip with Left at the start of the text, walks the chips with the arrows and returns to the input', async () => {
    const m = mount();
    const dialog = open(m, { scope: scoped() });
    await m.user.keyboard('{ArrowLeft}');
    const group = within(dialog).getByRole('group', { name: 'Search scope' });
    const north = within(group).getByRole('button', { name: 'scope north' });
    expect(north).toHaveFocus();
    expect(north).toHaveAttribute('aria-pressed', 'true');
    await m.user.keyboard('{ArrowLeft}');
    expect(within(group).getByRole('button', { name: 'Cloud' })).toHaveFocus();
    await m.user.keyboard('{End}');
    expect(north).toHaveFocus();
    await m.user.keyboard('{ArrowRight}');
    expect(field()).toHaveFocus();
  });

  it('removes the chip that is selected with Backspace, and the focus goes back to the input', async () => {
    const m = mount();
    open(m, { scope: scoped() });
    await m.user.keyboard('{ArrowLeft}{Backspace}');
    expect(m.store.getSnapshot().chips).toHaveLength(1);
    expect(field()).toHaveFocus();
  });

  it('removes the last chip with Backspace on an empty input', async () => {
    const m = mount();
    open(m, { scope: scoped() });
    await m.user.keyboard('{Backspace}');
    expect(m.store.getSnapshot().chips).toHaveLength(1);
    expect(field()).toHaveFocus();
  });

  it('removes a chip and the ones under it with its Remove button, and the focus goes back to the input', async () => {
    const m = mount();
    const dialog = open(m, { scope: scoped() });
    await m.user.click(within(dialog).getByRole('button', { name: 'Remove Cloud and dependent scopes' }));
    expect(m.store.getSnapshot().chips).toHaveLength(0);
    expect(field()).toHaveFocus();
  });

  it('moves the focus into the input and types there when a character is typed on a chip', async () => {
    const m = mount();
    const dialog = open(m, { scope: scoped() });
    await m.user.keyboard('{ArrowLeft}');
    await m.user.keyboard('a');
    expect(field()).toHaveFocus();
    expect(within(dialog).queryByRole('button', { name: 'scope north', pressed: true })).toBeNull();
    expect(field()).toHaveValue('a');
  });
});

describe('what the sources say (S72)', () => {
  const broken = (id: string, name: string) => ({
    id: `${id}:pages`,
    plugin: id,
    pluginName: name,
    title: 'Pages',
    section: 'goto' as const,
    match: (): never => {
      throw new Error('it is down');
    },
  });

  it('says in the band which source did not answer, with a Retry named for it, and the others answer', async () => {
    const m = mount();
    m.f.palette.registerProvider(broken('flaky', 'Flaky'));
    const dialog = open(m);
    await m.user.type(field(), 'ins');
    const band = partOf(dialog, 'band');
    expect(band).toHaveTextContent('Pages: Unavailable');
    const retry = within(band).getByRole('button', { name: 'Retry Flaky · Pages' });
    expect(optionNames().some((name) => name.includes('Instances'))).toBe(true);
    const calls = m.f.errors.length;
    await m.user.click(retry);
    expect(m.f.errors.length).toBeGreaterThan(calls);
  });

  it('draws nothing in the band when every source answered: no Ready, no collapsed details', async () => {
    const m = mount();
    const dialog = open(m);
    await m.user.type(field(), 'ins');
    expect(partOf(dialog, 'band').textContent).toBe('');
  });

  it('folds more than three runs into a +N that shows the Sources list, and Escape comes back to the results before it closes', async () => {
    const m = mount();
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      m.f.palette.registerProvider(broken(`p${name.toLowerCase()}`, name));
    }

    const dialog = open(m);
    await m.user.type(field(), 'ins');
    const band = partOf(dialog, 'band');
    expect(within(band).getAllByRole('button', { name: /^Retry / })).toHaveLength(3);
    const more = within(band).getByRole('button', { name: '+2 more, show all 5 sources' });
    expect(more).toHaveTextContent('+2');
    await m.user.click(more);
    expect(within(dialog).getByRole('listbox', { name: 'Sources' })).toBeInTheDocument();
    expect(options()).toHaveLength(5);
    expect(within(partOf(dialog, 'band')).getByRole('button', { name: 'Back to results' })).toBeInTheDocument();
    // The control that had the focus left with its markup: the input takes the keyboard back.
    expect(field()).toHaveFocus();
    await m.user.keyboard('{Escape}');
    expect(within(dialog).getByRole('listbox', { name: 'Results' })).toBeInTheDocument();
    expect(m.store.getSnapshot().open).toBe(true);
    await m.user.keyboard('{Escape}');
    expect(m.store.getSnapshot().open).toBe(false);
  });

  it('takes the browser\'s own close request as the model takes Escape: the Sources list goes back to the results with the search kept, and the results close', async () => {
    const m = mount();
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      m.f.palette.registerProvider(broken(`p${name.toLowerCase()}`, name));
    }

    const dialog = open(m);
    await m.user.type(field(), 'ins');
    await m.user.click(within(partOf(dialog, 'band')).getByRole('button', { name: '+2 more, show all 5 sources' }));
    expect(within(dialog).getByRole('listbox', { name: 'Sources' })).toBeInTheDocument();
    // The close request of the platform (Escape with the focus on a control that is not the input, a back gesture) is a cancel event on the dialog.
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(within(dialog).getByRole('listbox', { name: 'Results' })).toBeInTheDocument();
    expect(m.store.getSnapshot()).toMatchObject({ open: true, query: 'ins' });
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(m.store.getSnapshot().open).toBe(false);
  });
});

describe('the live region (S86)', () => {
  it('is a polite status inside the dialog, so a modal does not hide it, and says nothing for an empty input', async () => {
    const m = mount();
    const dialog = open(m);
    const region = within(dialog).getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('');
    await act(async () => {
      await m.f.clock.advance(1000);
    });
    expect(region).toHaveTextContent('');
  });

  it('is told the sentence once the results have been still, and not on every keystroke', async () => {
    const m = mount();
    const dialog = open(m);
    const region = within(dialog).getByRole('status');
    await m.user.type(field(), 'ins');
    expect(region).toHaveTextContent('');
    await act(async () => {
      await m.f.clock.advance(450);
    });
    expect(region.textContent).not.toBe('');
    expect(region).toHaveTextContent(m.store.getSnapshot().sentence);
  });
});

describe('what it costs', () => {
  it('commits once for a keystroke at most', async () => {
    const commits: string[] = [];
    const m = mount({ onRender: (_id, phase) => commits.push(phase) });
    open(m);
    const before = commits.length;
    await m.user.type(field(), 'i');
    expect(commits.length - before).toBe(1);
    await m.user.type(field(), 'ns');
    expect(commits.length - before).toBe(3);
    await m.user.keyboard('{ArrowDown}');
    expect(commits.length - before).toBeLessThanOrEqual(4);
  });

  it('does not draw again for a snapshot that changed nothing', () => {
    const commits: string[] = [];
    const m = mount({ onRender: (_id, phase) => commits.push(phase) });
    open(m);
    const before = commits.length;
    act(() => {
      m.store.refresh();
      m.store.refresh();
    });
    expect(commits.length - before).toBe(0);
  });
});
