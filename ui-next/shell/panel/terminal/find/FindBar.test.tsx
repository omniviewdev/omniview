import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import events from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Platform } from '../../../core/chords';
import type { FindState } from '../engine';
import { FindBar, FIND_LABEL, FIND_OPTIONS_LABEL, type FindBarProps } from './FindBar';
import { INITIAL_FIND, type FindInput } from './findModel';

// The keyboard library waits on a timer of its own between two inputs unless it is told not to: here it waits on none, so the order of what happens is the order of the awaits.
const userEvent = { setup: () => events.setup({ delay: null }) };

// The bar as a person meets it: one search landmark that holds the field (with its count lane inside) and one roving row of buttons. What it says for a screen reader (names, pressed, invalid, the live count), what each
// control asks of its caller, and the keys it takes before the field can take them. The rules it is built from are `findModel.test.ts`; when it is opened and what it looks for is `findSession.test.ts`.

const NAMES = ['Match case', 'Use regular expression', 'Match whole word', 'Previous match', 'Next match', 'Close find'];

function mount(over: Partial<FindBarProps> = {}, input: Partial<FindInput> = {}) {
  const onQuery: Mock<(query: string) => void> = vi.fn();
  const onToggle: Mock<(flag: string) => void> = vi.fn();
  const onStep: Mock<(direction: string) => void> = vi.fn();
  const onFind: Mock<() => void> = vi.fn();
  const onClose: Mock<() => void> = vi.fn();
  const props: FindBarProps = { input: { ...INITIAL_FIND, ...input }, valid: true, unavailable: false, result: undefined, platform: 'other', onQuery, onToggle, onStep, onFind, onClose, ...over };
  const view = render(<FindBar {...props} />);
  return {
    onQuery,
    onToggle,
    onStep,
    onFind,
    onClose,
    again: (next: Partial<FindBarProps>) => {
      view.rerender(<FindBar {...props} {...next} />);
    },
  };
}

const field = () => screen.getByRole('searchbox', { name: FIND_LABEL });
const lane = () => document.querySelector('[data-ov-lane]');
const button = (name: string) => screen.getByRole('button', { name });

afterEach(() => {
  cleanup();
});

describe('what the bar is', () => {
  it('is one search landmark named "Find in terminal", with the field of the same name and a group of buttons named "Find options"', () => {
    mount();
    const landmark = screen.getByRole('search', { name: FIND_LABEL });
    expect(within(landmark).getByRole('searchbox', { name: FIND_LABEL })).toBe(field());
    expect(within(landmark).getByRole('group', { name: FIND_OPTIONS_LABEL })).toBeInTheDocument();
    expect(landmark).toHaveAttribute('data-shell-part', 'terminalFind');
  });

  it('draws the six buttons in the order of the written spec, each with its own name: Match case, Use regular expression, Match whole word, Previous match, Next match, Close find', () => {
    mount();
    const group = screen.getByRole('group', { name: FIND_OPTIONS_LABEL });
    expect(within(group).getAllByRole('button').map((one) => one.getAttribute('aria-label'))).toEqual(NAMES);
  });

  it('holds the field and the buttons as ONE group: nothing else is in it', () => {
    mount();
    const landmark = screen.getByRole('search');
    const own = [...landmark.querySelectorAll('input, button')].filter((one) => one.getAttribute('tabindex') !== '-1' || one.tagName === 'BUTTON');
    expect(own.filter((one) => one.tagName === 'INPUT')).toHaveLength(1);
  });

  it('gives its root to the ref it is given', () => {
    const ref = createRef<HTMLDivElement>();
    render(<FindBar input={INITIAL_FIND} valid unavailable={false} result={undefined} platform="other" onQuery={vi.fn()} onToggle={vi.fn()} onStep={vi.fn()} onFind={vi.fn()} onClose={vi.fn()} ref={ref} />);
    expect(ref.current).toBe(screen.getByRole('search'));
  });

  it('marks the three switches as toggles by what the bar holds, and the steps and Close as plain buttons with no pressed state', () => {
    mount({}, { caseSensitive: true, wholeWord: true });
    expect(button('Match case')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Use regular expression')).toHaveAttribute('aria-pressed', 'false');
    expect(button('Match whole word')).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Previous match', 'Next match', 'Close find']) {
      expect(button(name)).not.toHaveAttribute('aria-pressed');
    }
  });

  it('puts a tip on each button: its name, and the key where there is one (Enter, Shift Enter and Escape are written for the platform)', () => {
    mount();
    const tipOf = (name: string) => button(name).getAttribute('data-ov-tip');
    expect(tipOf('Match case')).toBe('Match case');
    expect(tipOf('Use regular expression')).toBe('Use regular expression');
    expect(tipOf('Match whole word')).toBe('Match whole word');
    expect(tipOf('Previous match')).toBe('Previous match\nShift+Enter');
    expect(tipOf('Next match')).toBe('Next match\nEnter');
    expect(tipOf('Close find')).toBe('Close find\nEsc');
  });

  it('writes the keys of the tips with the glyphs of a Mac', () => {
    mount({ platform: 'mac' });
    expect(button('Previous match').getAttribute('data-ov-tip')).toBe('Previous match\n\u21E7\u21B5');
    expect(button('Next match').getAttribute('data-ov-tip')).toBe('Next match\n\u21B5');
    expect(button('Close find').getAttribute('data-ov-tip')).toBe('Close find\nEsc');
  });
});

describe('the count lane', () => {
  it('is inside the field, a polite live region that the field is described by, and is there with no text so that nothing moves when a count comes', () => {
    mount();
    const found = lane();
    expect(found).not.toBeNull();
    expect(found).toHaveAttribute('aria-live', 'polite');
    expect(found).toHaveTextContent('');
    expect(field()).toHaveAttribute('aria-describedby', found?.id);
    expect(field().closest('[data-ov-counted="true"]')).not.toBeNull();
  });

  it.each<[string, FindState | undefined, string]>([
    ['nothing before the engine has answered', undefined, ''],
    ['the position of a match from 1', { index: 2, count: 12, capped: false }, '3 of 12'],
    ['thousands with a comma', { index: 1_233, count: 5_678, capped: false }, '1,234 of 5,678'],
    ['that nothing was found', { index: -1, count: 0, capped: false }, 'No results'],
    ['a count that is a floor when the engine stopped at its limit', { index: 4, count: 20_000, capped: true }, '5 of 20,000+'],
    ['that the position is not known when the match is not among those counted', { index: -1, count: 20_000, capped: true }, '? of 20,000+'],
  ])('says %s', (_name, result, words) => {
    mount({ result }, { query: 'a' });
    expect(lane()).toHaveTextContent(words);
    expect(lane()?.textContent).toBe(words);
  });

  it('says nothing for an empty field, whatever the engine last said (the engine tells the empty state when it is cleared)', () => {
    mount({ result: { index: -1, count: 0, capped: false } }, { query: '' });
    expect(lane()?.textContent).toBe('');
  });

  it('follows the engine: the text changes in the one lane', () => {
    const { again } = mount({ result: { index: 0, count: 3, capped: false } }, { query: 'a' });
    expect(lane()?.textContent).toBe('1 of 3');
    again({ result: { index: 1, count: 3, capped: false } });
    expect(lane()?.textContent).toBe('2 of 3');
    expect(document.querySelectorAll('[data-ov-lane]')).toHaveLength(1);
  });

  it('marks the field invalid and says "Invalid pattern" in the lane for a pattern that does not parse, and the field is described by it', () => {
    mount({ valid: false, result: { index: 0, count: 3, capped: false } }, { query: '(', regex: true });
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(lane()?.textContent).toBe('Invalid pattern');
    expect(field()).toHaveAccessibleDescription('Invalid pattern');
  });

  it('does not mark a field invalid that is not', () => {
    mount({}, { query: 'a' });
    expect(field()).not.toHaveAttribute('aria-invalid');
  });
});

describe('what each control asks', () => {
  it('shows the text it holds, and tells the caller of each change', async () => {
    const user = userEvent.setup();
    const { onQuery } = mount({}, { query: 'ab' });
    expect(field()).toHaveValue('ab');
    await user.type(field(), 'x');
    expect(onQuery).toHaveBeenCalledWith('abx');
  });

  it('asks for the switch that was pressed', async () => {
    const user = userEvent.setup();
    const { onToggle } = mount();
    await user.click(button('Match case'));
    await user.click(button('Use regular expression'));
    await user.click(button('Match whole word'));
    expect(onToggle.mock.calls).toEqual([['caseSensitive'], ['regex'], ['wholeWord']]);
  });

  it('asks for the step that was pressed, and for the bar to close', async () => {
    const user = userEvent.setup();
    const { onStep, onClose } = mount();
    await user.click(button('Previous match'));
    await user.click(button('Next match'));
    await user.click(button('Close find'));
    expect(onStep.mock.calls).toEqual([['previous'], ['next']]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is not a form: nothing is submitted, and a press on a switch changes nothing but its own request', async () => {
    const user = userEvent.setup();
    const { onQuery, onStep, onClose } = mount();
    await user.click(button('Match case'));
    expect(onQuery).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the keys the bar takes before the field can', () => {
  it('steps forward on Enter and back on Shift Enter in the field, and the key is the bar\'s: its default is cancelled', async () => {
    const user = userEvent.setup();
    const { onStep } = mount({}, { query: 'a' });
    const seen: KeyboardEvent[] = [];
    const listen = (event: KeyboardEvent) => {
      seen.push(event);
    };

    window.addEventListener('keydown', listen, { capture: true });
    await user.click(field());
    await user.keyboard('{Enter}{Shift>}{Enter}{/Shift}');
    window.removeEventListener('keydown', listen, { capture: true });
    expect(onStep.mock.calls).toEqual([['next'], ['previous']]);
    expect(seen.filter((event) => event.key === 'Enter').every((event) => event.defaultPrevented)).toBe(true);
  });

  it('steps on F3 and Shift F3 from the field and from a button, and cancels the key (the browser\'s own find-next is not run)', () => {
    const { onStep } = mount({}, { query: 'a' });
    // The keyboard of user-event has no function keys: the key is made as a browser makes it, with its code.
    const pressed = [
      fireEvent.keyDown(field(), { key: 'F3', code: 'F3' }),
      fireEvent.keyDown(field(), { key: 'F3', code: 'F3', shiftKey: true }),
      fireEvent.keyDown(button('Close find'), { key: 'F3', code: 'F3' }),
    ];
    expect(onStep.mock.calls).toEqual([['next'], ['previous'], ['next']]);
    expect(pressed).toEqual([false, false, false]);
  });

  it.each<[Platform, boolean]>([['mac', true], ['other', false]])('on %s, Command G steps: %s', async (platform, steps) => {
    const user = userEvent.setup();
    const { onStep } = mount({ platform }, { query: 'a' });
    await user.click(field());
    await user.keyboard('{Meta>}g{/Meta}');
    await user.keyboard('{Meta>}{Shift>}g{/Shift}{/Meta}');
    expect(onStep.mock.calls).toEqual(steps ? [['next'], ['previous']] : []);
  });

  it('closes on the FIRST Escape, with text in the field: the field would clear it first and keep the key, so the bar takes the key before it', async () => {
    const user = userEvent.setup();
    const { onClose, onQuery } = mount({}, { query: 'hello' });
    await user.click(field());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onQuery).not.toHaveBeenCalled();
    expect(field()).toHaveValue('hello');
  });

  // With text the field would stop the key itself (it clears the text first); with none it lets it go to the page. The bar takes it before either, so it is the bar that stops it.
  it.each([['text in the field', 'hello'], ['an empty field', '']])('cancels the Escape it takes and stops it with %s: the page\'s own Escape (the shell moves the keyboard to the page) never sees it', async (_where, query) => {
    const user = userEvent.setup();
    const { onClose } = mount({}, { query });
    const reached = vi.fn();
    document.addEventListener('keydown', reached);
    const seen: KeyboardEvent[] = [];
    const capture = (event: KeyboardEvent) => {
      seen.push(event);
    };

    window.addEventListener('keydown', capture, { capture: true });
    await user.click(field());
    await user.keyboard('{Escape}');
    document.removeEventListener('keydown', reached);
    window.removeEventListener('keydown', capture, { capture: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.defaultPrevented).toBe(true);
    expect(reached).not.toHaveBeenCalled();
  });

  it('closes on Escape with an empty field, and from a button', async () => {
    const user = userEvent.setup();
    const { onClose } = mount();
    await user.click(field());
    await user.keyboard('{Escape}');
    button('Next match').focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('leaves an Escape that an input method is composing to the input method', () => {
    const { onClose } = mount({}, { query: 'a' });
    fireEvent.keyDown(field(), { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('presses a button once on Enter or Space: the key of a button is its press, not the bar\'s step', async () => {
    const user = userEvent.setup();
    const { onStep, onToggle } = mount();
    button('Next match').focus();
    await user.keyboard('{Enter}');
    expect(onStep.mock.calls).toEqual([['next']]);
    button('Match case').focus();
    await user.keyboard(' ');
    expect(onToggle.mock.calls).toEqual([['caseSensitive']]);
  });

  it('leaves the keys for typing to the field', async () => {
    const user = userEvent.setup();
    const { onQuery, onStep, onClose } = mount();
    await user.click(field());
    await user.keyboard('g');
    expect(onQuery).toHaveBeenCalledWith('g');
    expect(onStep).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the keyboard', () => {
  it('reaches the field, then the one stop of the row of buttons (the first, or the pressed one), and then leaves the bar', async () => {
    const user = userEvent.setup();
    mount();
    await user.tab();
    expect(document.activeElement).toBe(field());
    await user.tab();
    expect(document.activeElement).toBe(button('Match case'));
    await user.tab();
    expect(screen.getByRole('search').contains(document.activeElement)).toBe(false);
  });

  it('takes the pressed switch for the stop of the row', async () => {
    const user = userEvent.setup();
    mount({}, { regex: true });
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(button('Use regular expression'));
  });

  it('reaches all six buttons by the arrows, Home and End, and the clear button of the field is not a stop', async () => {
    const user = userEvent.setup();
    mount({}, { query: 'a' });
    await user.tab();
    await user.tab();
    const reached: Array<string | null> = [document.activeElement?.getAttribute('aria-label') ?? null];
    for (let step = 0; step < 5; step += 1) {
      await user.keyboard('{ArrowRight}');
      reached.push(document.activeElement?.getAttribute('aria-label') ?? null);
    }

    expect(reached).toEqual(NAMES);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(button('Match case'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(button('Close find'));
    expect(screen.getByRole('button', { name: 'Clear search', hidden: true })).toHaveAttribute('tabindex', '-1');
  });

  it('gives every control an accessible name', () => {
    mount({}, { query: 'a' });
    const landmark = screen.getByRole('search');
    for (const control of landmark.querySelectorAll('input, button')) {
      const named = control.getAttribute('aria-label') ?? '';
      expect(named, control.outerHTML).not.toBe('');
    }
  });
});

describe('the count lane when the search cannot be had', () => {
  it('says "Unavailable" in the same polite lane as the other words, and does not mark the field invalid: a pattern is invalid, a search that cannot be started is not the person\'s pattern', () => {
    mount({ unavailable: true });
    expect(lane()?.textContent).toBe('Unavailable');
    expect(lane()).toHaveAttribute('aria-live', 'polite');
    expect(document.querySelectorAll('[data-ov-lane]')).toHaveLength(1);
    expect(field()).not.toHaveAttribute('aria-invalid');
    expect(field()).toHaveAccessibleDescription('Unavailable');
  });

  it('says it beside a query as well as beside an empty field', () => {
    mount({ unavailable: true }, { query: 'hello' });
    expect(lane()?.textContent).toBe('Unavailable');
  });

  it('keeps "Invalid pattern" first, and the field marked invalid, when the pattern does not parse', () => {
    mount({ unavailable: true, valid: false }, { query: '(', regex: true });
    expect(lane()?.textContent).toBe('Invalid pattern');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
  });

  it('goes when the search can be had again: the lane follows what it is given, in the one lane', () => {
    const { again } = mount({ unavailable: true }, { query: 'a' });
    expect(lane()?.textContent).toBe('Unavailable');
    again({ unavailable: false, result: { index: 0, count: 3, capped: false } });
    expect(lane()?.textContent).toBe('1 of 3');
    expect(document.querySelectorAll('[data-ov-lane]')).toHaveLength(1);
  });
});

// The bar is beside the terminal's screen and not in it, so no key rule of the screen sees a key pressed in the bar: the chord that opens the find is the bar's to take there. It asks for the field (its caller owns the keyboard,
// and puts it in the field with the text selected), and cancels the key, which a browser tab would answer with its own find.
describe('the find chord pressed in the bar', () => {
  const CHORDS: ReadonlyArray<readonly [string, Platform, KeyboardEventInit]> = [
    ['Control F', 'other', { key: 'f', code: 'KeyF', ctrlKey: true }],
    ['Control Shift F', 'other', { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true }],
    ['Command F', 'mac', { key: 'f', code: 'KeyF', metaKey: true }],
  ];

  it.each(CHORDS)('asks for the field on %s pressed in the field, and takes the key: it is cancelled and goes no further', (_name, platform, init) => {
    const { onFind } = mount({ platform }, { query: 'hello' });
    const reached = vi.fn();
    document.addEventListener('keydown', reached);
    const goesOn = fireEvent.keyDown(field(), init);
    document.removeEventListener('keydown', reached);
    expect(onFind).toHaveBeenCalledTimes(1);
    expect(goesOn).toBe(false);
    expect(reached).not.toHaveBeenCalled();
  });

  it.each(CHORDS)('asks for the field on %s pressed on a button too', (_name, platform, init) => {
    const { onFind } = mount({ platform });
    for (const name of NAMES) {
      expect(fireEvent.keyDown(button(name), init), name).toBe(false);
    }

    expect(onFind).toHaveBeenCalledTimes(NAMES.length);
  });

  it('leaves a chord that is not the find chord on the platform alone: Control F on a Mac moves the field\'s cursor, and Command F elsewhere is the window\'s', () => {
    const mac = mount({ platform: 'mac' });
    expect(fireEvent.keyDown(field(), { key: 'f', code: 'KeyF', ctrlKey: true })).toBe(true);
    expect(mac.onFind).not.toHaveBeenCalled();
    cleanup();
    const other = mount({ platform: 'other' });
    expect(fireEvent.keyDown(field(), { key: 'f', code: 'KeyF', metaKey: true })).toBe(true);
    expect(other.onFind).not.toHaveBeenCalled();
  });

  it('leaves a plain F to the field: it is a letter', async () => {
    const user = userEvent.setup();
    const { onFind, onQuery } = mount();
    await user.click(field());
    await user.keyboard('f');
    expect(onFind).not.toHaveBeenCalled();
    expect(onQuery).toHaveBeenCalledWith('f');
  });
});
