import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellPickerOption, ShellScopePicker } from './registration';
import { ScopeLane } from './ScopeLane';

// The picker through the face that opens it, over a hand-made `ShellScopePicker`: how it opens, what it draws, and the whole of its keyboard. jsdom has no layout: where the popup stands is core/picker/place.test.ts's, and
// here only that the component asks with what it measured. The Popover API is the test setup's stand-in, which marks the element it shows.

// jsdom hides a `[popover]` that no rule shows (its Popover API is the setup's stand-in, which marks an element and shows nothing), and a hidden element is inaccessible to the queries: this is the rule that shows it, as the
// notification centre's tests have it.
let shown: HTMLStyleElement | undefined;

beforeEach(() => {
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  shown?.remove();
});

const OPTIONS: readonly ShellPickerOption[] = [
  { id: 'north', label: 'north', state: { role: 'healthy', word: 'Connected' } },
  { id: 'south', label: 'south', state: { role: 'stopped', word: 'Disconnected' } },
  { id: 'east', label: 'east', state: { role: 'error', word: 'Connection failed' }, reason: 'certificate has expired' },
];

const make = (over: Partial<ShellScopePicker> = {}): ShellScopePicker => ({
  title: 'Connections',
  placeholder: 'Search connections',
  empty: 'No connections',
  icon: 'server',
  options: OPTIONS,
  current: 'north',
  onChoose: vi.fn(),
  ...over,
});

const laneOf = (picker: ShellScopePicker | undefined, text = 'north') => <ScopeLane label="Acme scope" faces={[{ label: 'Connection', icon: 'server', text, picker }]} />;

const face = (): HTMLElement => screen.getByRole('button', { name: /^Connection:/ });
const input = (): HTMLElement => screen.getByRole('combobox', { name: 'Connections' });
const popup = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-shell-part="picker"]');
const options = (): HTMLElement[] => screen.queryAllByRole('option');
const names = (): string[] => options().map((option) => option.getAttribute('aria-label') ?? option.textContent);
const activeText = (): string | null | undefined => document.getElementById(input().getAttribute('aria-activedescendant') ?? '')?.querySelector('[data-ov-clip]')?.textContent;
const said = (): string | null => screen.getByRole('status').textContent;

async function open(picker: ShellScopePicker = make()) {
  const user = userEvent.setup();
  const view = render(laneOf(picker));
  await user.click(face());
  return { user, picker, ...view };
}

/** A list of `count` options, `o0` to `o(count - 1)`, the first of them the current one. */
const many = (count: number): ShellPickerOption[] => Array.from({ length: count }, (_, at) => ({ id: `o${String(at)}`, label: `o${String(at)}`, state: { role: 'healthy', word: 'Connected' } }));

describe('opening', () => {
  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
    ['ArrowDown', '{ArrowDown}'],
  ])('opens on %s from the face, takes the focus into its input, and tells the host once', async (_name, keys) => {
    const picker = make({ onOpen: vi.fn() });
    const user = userEvent.setup();
    render(laneOf(picker));
    face().focus();
    expect(popup()).toBeNull();

    await user.keyboard(keys);

    expect(input()).toHaveFocus();
    expect(face()).toHaveAttribute('aria-expanded', 'true');
    expect(face()).toHaveAttribute('aria-controls', popup()?.id);
    expect(picker.onOpen).toHaveBeenCalledTimes(1);
  });

  it('opens on a click, and a second click on the face closes it', async () => {
    const { user, picker } = await open(make({ onOpen: vi.fn() }));

    expect(input()).toHaveFocus();
    expect(picker.onOpen).toHaveBeenCalledTimes(1);
    await user.click(face());
    expect(popup()).toBeNull();
    expect(face()).toHaveAttribute('aria-expanded', 'false');
    expect(face()).not.toHaveAttribute('aria-controls');
  });

  it('is in the top layer, one popover the browser can light-dismiss, and is not there at all while it is closed', async () => {
    const view = render(laneOf(make()));
    expect(popup()).toBeNull();

    await userEvent.setup().click(face());

    expect(popup()).toHaveAttribute('popover', 'auto');
    expect(popup()).toHaveAttribute('data-test-popover-open');
    expect(document.querySelectorAll('[data-shell-part="picker"]')).toHaveLength(1);
    view.unmount();
  });
});

describe('what it draws', () => {
  it('lists the options by their name and state, the current one selected and marked with a dot, in the order given', async () => {
    await open();

    expect(screen.getByRole('listbox', { name: 'Connections' })).toBeInTheDocument();
    expect(options().map((option) => option.textContent?.replace(/^•/, '').replace(/\s+/g, ' ').trim())).toEqual(['north Connected', 'south Disconnected', 'east Connection failed certificate has expired']);
    expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(options().map((option) => option.querySelector('[aria-hidden="true"]')?.textContent)).toEqual(['•', '', '']);
    expect(screen.getByRole('option', { name: 'north Connected' })).toBe(options()[0]);
  });

  it('names its input by the title, says what it is for, and names the active option, the current one when there is one', async () => {
    await open();

    expect(input()).toHaveAttribute('placeholder', 'Search connections');
    expect(input()).toHaveAttribute('aria-autocomplete', 'list');
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(input()).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
    expect(activeText()).toBe('north');
    expect(options()[0]).toHaveAttribute('data-active');
    expect(screen.getByText('Connections')).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens on the first option when the current one is not in the list, or is none', async () => {
    await open(make({ current: undefined }));
    expect(activeText()).toBe('north');
    cleanup();

    await open(make({ current: 'gone' }));
    expect(activeText()).toBe('north');
    cleanup();

    await open(make({ current: 'south' }));
    expect(activeText()).toBe('south');
  });

  it('draws a reason as a second line under the name, with its full text as its tip', async () => {
    await open();

    const reason = screen.getByText('certificate has expired');
    expect(options()[2]).toContainElement(reason);
    expect(reason).toHaveAttribute('data-ov-tip', 'certificate has expired');
    expect(options()[0]?.querySelector('[data-shell-part="pickerReason"]')).toBeNull();
  });

  it('draws the plugin\'s secondary text as a second line with its full text as its tip, and lets a reason take the line when there is one', async () => {
    const detailed = OPTIONS.map((option) => ({ ...option, detail: `EKS \u00b7 ${option.id}-1` }));
    await open(make({ options: detailed }));

    const north = options()[0];
    const detail = north?.querySelector('[data-shell-part="pickerDetail"]');
    expect(detail).toHaveTextContent('EKS \u00b7 north-1');
    expect(detail).toHaveAttribute('data-ov-tip', 'EKS \u00b7 north-1');
    // `east` failed: its reason is the second line, and its secondary text is not drawn beside it.
    expect(options()[2]?.querySelector('[data-shell-part="pickerDetail"]')).toBeNull();
    expect(options()[2]?.querySelector('[data-shell-part="pickerReason"]')).toHaveTextContent('certificate has expired');
  });

  it('finds an option by what its secondary text says, and keeps the name\'s runs for the name', async () => {
    const detailed: ShellPickerOption = { id: 'north', label: 'north', state: { role: 'healthy', word: 'Connected' }, detail: 'EKS \u00b7 eu-west-1' };
    const { user } = await open(make({ options: [detailed, ...OPTIONS.slice(1)] }));

    await user.keyboard('eu-west');

    expect(names()).toEqual(['\u2022north Connected EKS \u00b7 eu-west-1']);
  });

  it('shows what the host says when there is no option, and closes on Enter: nothing is active', async () => {
    const { user, picker } = await open(make({ options: [], current: undefined }));

    expect(screen.getByText('No connections')).toBeInTheDocument();
    expect(options()).toHaveLength(0);
    expect(input()).not.toHaveAttribute('aria-activedescendant');
    expect(said()).toBe('Connections: 0');

    await user.keyboard('{Enter}');
    expect(popup()).toBeNull();
    expect(face()).toHaveFocus();
    expect(picker.onChoose).not.toHaveBeenCalled();
  });

  it('is told how many options there are when it opens', async () => {
    await open();

    expect(said()).toBe('Connections: 3');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('typing', () => {
  it('narrows the list, makes the first match active, and says how many are left', async () => {
    const { user } = await open();

    await user.keyboard('s');
    expect(options().map((option) => option.querySelector('[data-ov-clip]')?.textContent)).toEqual(['south', 'east']);
    expect(options()).toHaveLength(2);

    await user.keyboard('o');
    expect(options()).toHaveLength(1);
    expect(activeText()).toBe('south');
    expect(said()).toBe('Connections: 1 of 3');
  });

  it('draws the matched run of a name in weight 600', async () => {
    const { user } = await open();
    await user.keyboard('ou');

    const [bold] = screen.getByRole('option').querySelectorAll('b');
    expect(bold?.textContent).toBe('ou');
    expect(screen.getByRole('option').querySelector('[data-ov-clip]')?.textContent).toBe('south');
  });

  it('says No matches for the query when it keeps nothing, and draws no option', async () => {
    const { user } = await open();
    await user.keyboard('zz');

    expect(options()).toHaveLength(0);
    expect(screen.getAllByText('No matches for "zz"')).toHaveLength(2);
    expect(said()).toBe('No matches for "zz"');
    expect(input()).not.toHaveAttribute('aria-activedescendant');
  });

  it('makes the current option the active one again when the field is empty, and says the whole list', async () => {
    const { user } = await open(make({ current: 'south' }));
    await user.keyboard('ea');
    expect(activeText()).toBe('east');

    await user.keyboard('{Backspace}{Backspace}');
    expect(options()).toHaveLength(3);
    expect(activeText()).toBe('south');
    expect(said()).toBe('Connections: 3');
  });

  it('makes the first option the active one when the field is empty again and there is no current one', async () => {
    const { user } = await open(make({ current: undefined }));
    await user.keyboard('ea{Backspace}{Backspace}');

    expect(options()).toHaveLength(3);
    expect(activeText()).toBe('north');
  });
});

describe('the keys', () => {
  it('moves the active option with ArrowDown and ArrowUp, and stops at the ends: it does not wrap', async () => {
    const { user } = await open();

    await user.keyboard('{ArrowDown}');
    expect(activeText()).toBe('south');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(activeText()).toBe('east');
    await user.keyboard('{ArrowUp}');
    expect(activeText()).toBe('south');
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(activeText()).toBe('north');
  });

  it('goes to the first and the last option with Home and End while the field is empty', async () => {
    const { user } = await open();

    await user.keyboard('{End}');
    expect(activeText()).toBe('east');
    await user.keyboard('{Home}');
    expect(activeText()).toBe('north');
  });

  it('leaves Home and End to the caret once there is text: the active option stays, and the caret moves', async () => {
    const { user } = await open();
    await user.keyboard('o');
    expect(activeText()).toBe('north');
    await user.keyboard('{ArrowDown}');
    expect(activeText()).toBe('south');

    await user.keyboard('{Home}');
    expect(activeText()).toBe('south');
    expect(input()).toHaveProperty('selectionStart', 0);
    await user.keyboard('{End}');
    expect(activeText()).toBe('south');
    expect(input()).toHaveProperty('selectionStart', 1);
  });

  it('moves by 8 with PageDown and PageUp, and stops at the ends', async () => {
    const { user } = await open(make({ options: many(20), current: 'o0' }));

    await user.keyboard('{PageDown}');
    expect(activeText()).toBe('o8');
    await user.keyboard('{PageDown}');
    expect(activeText()).toBe('o16');
    await user.keyboard('{PageDown}');
    expect(activeText()).toBe('o19');
    await user.keyboard('{PageUp}');
    expect(activeText()).toBe('o11');
    await user.keyboard('{PageUp}{PageUp}');
    expect(activeText()).toBe('o0');
  });

  it('brings the active option into view, when it opens and after a key moves it', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { user } = await open(make({ options: many(20), current: 'o5' }));

    expect(scroll).toHaveBeenCalled();
    expect(scroll.mock.contexts.at(-1)).toBe(options()[5]);
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });

    scroll.mockClear();
    await user.keyboard('{ArrowDown}');
    expect(scroll.mock.contexts).toEqual([options()[6]]);
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('lets the pointer make an option active, and does not scroll for it', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { user } = await open();
    scroll.mockClear();

    await user.hover(options()[2]);
    expect(activeText()).toBe('east');
    expect(scroll).not.toHaveBeenCalled();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('ignores a key the input method is composing with', async () => {
    const { picker } = await open();

    fireEvent.keyDown(input(), { key: 'ArrowDown', isComposing: true });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(activeText()).toBe('north');
    fireEvent.keyDown(input(), { key: 'ArrowDown', ctrlKey: true });
    expect(activeText()).toBe('north');
    expect(picker.onChoose).not.toHaveBeenCalled();
    expect(popup()).not.toBeNull();
  });
});

describe('choosing', () => {
  it('calls the host with the id of another option on Enter, once, and stays open with the focus in the input', async () => {
    const { user, picker } = await open();

    await user.keyboard('{ArrowDown}{Enter}');

    expect(picker.onChoose).toHaveBeenCalledTimes(1);
    expect(picker.onChoose).toHaveBeenCalledWith('south');
    expect(popup()).not.toBeNull();
    expect(input()).toHaveFocus();
  });

  it('only closes on Enter on the current option, and the focus is on the face', async () => {
    const { user, picker } = await open();

    await user.keyboard('{Enter}');

    expect(picker.onChoose).not.toHaveBeenCalled();
    expect(popup()).toBeNull();
    expect(face()).toHaveFocus();
  });

  it('does nothing on Enter on a busy option, and on a press on one', async () => {
    const busy = OPTIONS.map((option) => (option.id === 'south' ? { ...option, busy: true, state: { role: 'progress' as const, word: 'Connecting…' } } : option));
    const { user, picker } = await open(make({ options: busy }));

    await user.keyboard('{ArrowDown}{Enter}');
    await user.click(options()[1]);

    expect(picker.onChoose).not.toHaveBeenCalled();
    expect(popup()).not.toBeNull();
    expect(options()[1]).toHaveAttribute('aria-disabled', 'true');
    expect(options()[1]).toHaveTextContent('south Connecting…');
  });

  it('does what Enter does for an option when it is pressed: the host is told once, or the picker closes for the current one', async () => {
    const { user, picker } = await open();

    await user.click(options()[2]);
    expect(picker.onChoose).toHaveBeenCalledTimes(1);
    expect(picker.onChoose).toHaveBeenCalledWith('east');
    expect(popup()).not.toBeNull();
    expect(input()).toHaveFocus();

    await user.click(options()[0]);
    expect(picker.onChoose).toHaveBeenCalledTimes(1);
    expect(popup()).toBeNull();
    expect(face()).toHaveFocus();
  });

  it('does not take the focus out of the input for a press anywhere in the popup but the input', async () => {
    await open();

    expect(fireEvent.mouseDown(screen.getByRole('listbox'))).toBe(false);
    expect(fireEvent.mouseDown(options()[1])).toBe(false);
    expect(fireEvent.mouseDown(input())).toBe(true);
    expect(input()).toHaveFocus();
  });
});

describe('closing', () => {
  it('closes on Escape and gives the focus back to the face, and nothing outside sees the key', async () => {
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    const { user } = await open();

    await user.keyboard('{Escape}');

    expect(popup()).toBeNull();
    expect(face()).toHaveFocus();
    expect(outside.mock.calls.every((call: unknown[]) => !(call[0] instanceof KeyboardEvent) || call[0].key !== 'Escape' || call[0].defaultPrevented)).toBe(true);
    document.removeEventListener('keydown', outside);
  });

  it.each([
    ['Tab', {}],
    ['Shift+Tab', { shiftKey: true }],
  ])('closes on %s and leaves the focus on the face, so the browser goes on from there', async (_name, init) => {
    const { picker } = await open();

    const taken = fireEvent.keyDown(input(), { key: 'Tab', ...init });

    expect(taken).toBe(true);
    expect(popup()).toBeNull();
    expect(face()).toHaveFocus();
    expect(picker.onChoose).not.toHaveBeenCalled();
  });

  it('goes on to the next stop from the face with Tab, and to the one before it with Shift+Tab', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">before</button>
        {laneOf(make())}
        <button type="button">after</button>
      </>,
    );
    await user.click(face());
    await user.tab();
    expect(popup()).toBeNull();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();

    await user.click(face());
    await user.tab({ shift: true });
    expect(popup()).toBeNull();
    expect(screen.getByRole('button', { name: 'before' })).toHaveFocus();
  });

  it('closes when the browser light-dismisses it, and the focus goes back to the face when it was lost', async () => {
    await open();
    input().blur();

    fireEvent(popup()!, Object.assign(new Event('toggle'), { oldState: 'open', newState: 'closed' }));

    expect(popup()).toBeNull();
    await waitFor(() => {
      expect(face()).toHaveFocus();
    });
  });

  it('leaves the focus where it is when the press that dismissed it landed on another control', async () => {
    const user = userEvent.setup();
    render(
      <>
        {laneOf(make())}
        <button type="button">elsewhere</button>
      </>,
    );
    await user.click(face());
    const other = screen.getByRole('button', { name: 'elsewhere' });

    other.focus();
    await waitFor(() => {
      expect(popup()).toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(other).toHaveFocus();
  });

  it('does not close when the focus goes to the face, or nowhere', async () => {
    await open();

    face().focus();
    expect(popup()).not.toBeNull();
  });

  it('closes when the window changes size', async () => {
    await open();

    fireEvent(window, new Event('resize'));

    expect(popup()).toBeNull();
    await waitFor(() => {
      expect(face()).toHaveFocus();
    });
  });

  it('closes and returns the focus to the face when the face says another value than the one it opened on', async () => {
    const picker = make();
    const view = render(laneOf(picker));
    await userEvent.setup().click(face());
    expect(popup()).not.toBeNull();

    view.rerender(laneOf({ ...picker, current: 'south' }, 'south'));

    expect(popup()).toBeNull();
    expect(face()).toHaveAccessibleName('Connection: south');
    await waitFor(() => {
      expect(face()).toHaveFocus();
    });

    // It does not come back when the value turns back to the one it opened on.
    view.rerender(laneOf(picker));
    expect(popup()).toBeNull();
  });

  it('stays open while the host only changes the options: the current option is what closes it', async () => {
    const picker = make();
    const view = render(laneOf(picker));
    await userEvent.setup().click(face());

    view.rerender(laneOf({ ...picker, options: [...OPTIONS].reverse() }));

    expect(popup()).not.toBeNull();
    expect(names().length).toBe(3);
  });

  it('closes when the face loses its picker', async () => {
    const picker = make();
    const view = render(laneOf(picker));
    await userEvent.setup().click(face());
    expect(popup()).not.toBeNull();

    view.rerender(laneOf(undefined));

    expect(popup()).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('what the host does after a choice', () => {
  it('says the state and the name of an option that turns busy, once', async () => {
    const picker = make();
    const view = render(laneOf(picker));
    await userEvent.setup().click(face());
    expect(said()).toBe('Connections: 3');

    const busy = OPTIONS.map((option) => (option.id === 'south' ? { ...option, busy: true, state: { role: 'progress' as const, word: 'Connecting…' } } : option));
    view.rerender(laneOf({ ...picker, options: busy }));
    expect(said()).toBe('Connecting… south');

    // The host answers again with the same options: nothing changed, so nothing is said.
    const node = screen.getByRole('status').firstChild;
    view.rerender(laneOf({ ...picker, options: busy.map((option) => ({ ...option })) }));
    expect(said()).toBe('Connecting… south');
    expect(screen.getByRole('status').firstChild).toBe(node);
  });

  it('says the name and the reason of an option that gains one, and draws the reason under its name', async () => {
    const picker = make();
    const view = render(laneOf(picker));
    await userEvent.setup().click(face());

    const failed = OPTIONS.map((option) => (option.id === 'south' ? { ...option, reason: 'connection refused', state: { role: 'error' as const, word: 'Connection failed' } } : option));
    view.rerender(laneOf({ ...picker, options: failed }));

    expect(said()).toBe('south: connection refused');
    expect(screen.getByText('connection refused')).toHaveAttribute('data-ov-tip', 'connection refused');
    expect(options()[1]).toHaveTextContent('south Connection failed connection refused');
  });

  it('keeps what a query said when the host changes something that is not worth saying', async () => {
    const picker = make();
    const view = render(laneOf(picker));
    const { user } = { user: userEvent.setup() };
    await user.click(face());
    await user.keyboard('so');
    expect(said()).toBe('Connections: 1 of 3');

    view.rerender(laneOf({ ...picker, options: OPTIONS.map((option) => (option.id === 'south' ? { ...option, state: { role: 'healthy' as const, word: 'Connected' } } : option)) }));

    expect(said()).toBe('Connections: 1 of 3');
    expect(options()[0]).toHaveTextContent('south Connected');
  });

  it('gives the focus to the face when the choice drew the lane again, the button the person was on being gone', async () => {
    // The host answers a choice by moving the page, and the page of the new value draws the lane afresh: the face is a new button.
    function Moved() {
      const [at, setAt] = useState('north');
      return <ScopeLane key={at} label="Acme scope" faces={[{ label: 'Connection', icon: 'server', text: at, picker: make({ current: at, onChoose: setAt }) }]} />;
    }

    render(<Moved />);
    const before = face();
    const { user } = { user: userEvent.setup() };
    await user.click(before);
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(face()).toHaveAccessibleName('Connection: south');
    });
    expect(before.isConnected).toBe(false);
    await waitFor(() => {
      expect(face()).toHaveFocus();
    });
    expect(popup()).toBeNull();
  });
});

describe('where it stands', () => {
  it('asks for a place with the rectangle of the face and the size it measured, and draws it there', async () => {
    const rects = new Map<string, DOMRect>();
    const rect = (left: number, top: number, width: number, height: number): DOMRect => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return rects.get(this.dataset.shellPart ?? '') ?? rect(0, 0, 0, 0);
    });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1440 });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 900 });
    const user = userEvent.setup();
    render(laneOf(make()));

    // Room under the face: it stands under it, left edges on one line.
    rects.set('scopeFace', rect(100, 56, 150, 28));
    rects.set('picker', rect(0, 0, 320, 200));
    await user.click(face());
    expect(popup()).toHaveAttribute('data-side', 'below');
    expect(popup()?.style.getPropertyValue('--_left')).toBe('100px');
    expect(popup()?.style.getPropertyValue('--_edge')).toBe('88px');
    expect(popup()?.style.getPropertyValue('--_max')).toBe('360px');
    await user.keyboard('{Escape}');

    // None under it: above it, hanging from the face, and kept inside the window on the right.
    rects.set('scopeFace', rect(1400, 800, 150, 28));
    await user.click(face());
    expect(popup()).toHaveAttribute('data-side', 'above');
    expect(popup()?.style.getPropertyValue('--_left')).toBe('1112px');
    expect(popup()?.style.getPropertyValue('--_edge')).toBe('104px');

    Reflect.deleteProperty(document.documentElement, 'clientWidth');
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
    expect(within(popup()!).getAllByRole('option')).toHaveLength(3);
  });
});
