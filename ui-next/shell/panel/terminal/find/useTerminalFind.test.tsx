import { act, cleanup, fireEvent, render, screen as page, within } from '@testing-library/react';
import events from '@testing-library/user-event';
import { Profiler, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FindState } from '../engine';
import { FIND_LABEL } from './FindBar';
import { createFindSession, type FindSession } from './findSession';
import { fakeFinder, fakeFindScreen, settled, type FakeFinder, type FakeFindScreen, type FakeFindScreenOptions } from './testing';
import { useTerminalFind, type TerminalFind, type UseTerminalFindOptions } from './useTerminalFind';

// The keyboard library waits on a timer of its own between two inputs unless it is told not to: here it waits on none, so the order of what happens is the order of the awaits.
const userEvent = { setup: () => events.setup({ delay: null }) };

// The hook that draws the find bar over a screen, against a fake screen and finder: what is in the document while it is closed (nothing), what opening does to the keyboard, what the bar shows of the engine's answers,
// what Escape gives back, and what a hidden body is spared. The rules are `findModel.test.ts`, the behaviour behind the bar is `findSession.test.ts`, and the bar's own markup and keys are `FindBar.test.tsx`: what is
// checked here is that the hook joins them.

type Rig = {
  readonly screen: FakeFindScreen;
  readonly finder: FakeFinder;
  /** The hook's latest answer. */
  readonly find: () => TerminalFind;
  readonly show: (visible: boolean) => void;
  /** What the body reads of the screen's own state: its emulator is there, or is not. */
  readonly ready: (ready: boolean) => void;
  readonly renders: () => number;
  readonly view: ReturnType<typeof render>;
};

type Props = Partial<UseTerminalFindOptions> & { readonly fake?: FakeFindScreen | undefined };

function mount(config: FakeFindScreenOptions & { readonly session?: FindSession | undefined; readonly visible?: boolean | undefined; readonly ready?: boolean | undefined; readonly strict?: boolean | undefined } = {}): Rig {
  const finder = fakeFinder();
  const screen = fakeFindScreen({ finder, ...config });
  let latest: TerminalFind | undefined;
  let renders = 0;
  let onScreen = config.visible ?? true;
  let emulator = config.ready;
  function Harness({ fake, visible, ready, session }: Props) {
    latest = useTerminalFind({ screen: fake, visible: visible ?? true, ready, session });
    return (
      <div>
        <button type="button" onClick={latest.isOpen ? latest.close : latest.open}>
          Find
        </button>
        <div data-testid="stage">{latest.element}</div>
      </div>
    );
  }

  const ui = () => (
    <Profiler
      id="find"
      onRender={() => {
        renders += 1;
      }}
    >
      <Harness fake={screen} visible={onScreen} ready={emulator} session={config.session} />
    </Profiler>
  );
  const drawn = () => (config.strict === true ? <StrictMode>{ui()}</StrictMode> : ui());
  const view = render(drawn());
  return {
    screen,
    finder,
    view,
    find: () => {
      if (latest === undefined) {
        throw new Error('the hook did not run');
      }

      return latest;
    },
    show: (visible) => {
      onScreen = visible;
      view.rerender(drawn());
    },
    ready: (ready) => {
      emulator = ready;
      view.rerender(drawn());
    },
    renders: () => renders,
  };
}

const bar = () => page.queryByRole('search', { name: FIND_LABEL });
const field = () => page.getByRole('searchbox', { name: FIND_LABEL });
const lane = () => document.querySelector('[data-ov-lane]');
const state = (index: number, count: number, capped = false): FindState => ({ index, count, capped });

/** Opens the bar as the screen's key does: from outside React's event system. */
const open = async (rig: Rig) => {
  await act(async () => {
    rig.find().open();
    await settled();
  });
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('a bar that is closed', () => {
  it('is not in the document, listens to nothing and asks the screen for nothing: it costs nothing until the first time it is opened', async () => {
    const { screen, finder, find } = mount();
    await act(async () => {
      await settled();
    });
    expect(bar()).toBeNull();
    expect(document.querySelector('[data-shell-part="terminalFind"]')).toBeNull();
    expect(page.getByTestId('stage')).toBeEmptyDOMElement();
    expect(find().isOpen).toBe(false);
    expect(find().element).toBeNull();
    expect(screen.asks()).toBe(0);
    expect(finder.listeners()).toBe(0);
  });

  it('takes no step: the key that steps a find is the terminal\'s', () => {
    const { find } = mount();
    expect(find().step('next')).toBe(false);
    expect(find().step('previous')).toBe(false);
  });

  it('cannot be opened with no screen: no bar', async () => {
    const view = render(<Probe />);
    function Probe() {
      const found = useTerminalFind({ screen: undefined, visible: true });
      return (
        <div>
          <button type="button" onClick={found.open}>
            Find
          </button>
          {found.element}
        </div>
      );
    }

    await userEvent.setup().click(view.getByRole('button', { name: 'Find' }));
    expect(bar()).toBeNull();
  });
});

describe('opening the bar', () => {
  it('draws it, and puts the keyboard in its field', async () => {
    const rig = mount();
    await open(rig);
    expect(bar()).toBeInTheDocument();
    expect(rig.find().isOpen).toBe(true);
    expect(document.activeElement).toBe(field());
  });

  it('asks the screen for its finder, once, on the first open, and listens to it', async () => {
    const rig = mount();
    await open(rig);
    await open(rig);
    expect(rig.screen.asks()).toBe(1);
    expect(rig.finder.listeners()).toBe(1);
  });

  it('is opened by the toolbar\'s button and closed by it again: it toggles, and the second press closes', async () => {
    const user = userEvent.setup();
    const { screen, finder } = mount();
    await user.click(page.getByRole('button', { name: 'Find' }));
    expect(bar()).toBeInTheDocument();
    expect(document.activeElement).toBe(field());
    await user.click(page.getByRole('button', { name: 'Find' }));
    expect(bar()).toBeNull();
    expect(finder.clears()).toBe(1);
    expect(screen.focuses()).toBe(1);
  });

  it('puts the keyboard in the field again, with its text selected, when it is asked to open with the bar open (the chord pressed again)', async () => {
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.type(field(), 'hello');
    page.getByRole('button', { name: 'Next match' }).focus();
    expect(document.activeElement).not.toBe(field());
    await open(rig);
    expect(document.activeElement).toBe(field());
    const input = field() as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  it('keeps the keyboard where the person put it when the bar is only redrawn: the engine\'s answers move nothing', async () => {
    const rig = mount();
    await open(rig);
    page.getByRole('button', { name: 'Close find' }).focus();
    act(() => {
      rig.finder.tell(state(0, 3));
    });
    expect(document.activeElement).toBe(page.getByRole('button', { name: 'Close find' }));
  });

  it('does not steal the keyboard when a body that was hidden is shown again with the bar open', async () => {
    const rig = mount();
    await open(rig);
    page.getByRole('button', { name: 'Find' }).focus();
    rig.show(false);
    rig.show(true);
    expect(bar()).toBeInTheDocument();
    expect(document.activeElement).toBe(page.getByRole('button', { name: 'Find' }));
  });

  it('serves a request for the field that was made while the body was hidden when it is shown', async () => {
    const rig = mount({ visible: false });
    await act(async () => {
      rig.find().open();
      await settled();
    });
    expect(document.activeElement).not.toBe(bar()?.querySelector('input'));
    rig.show(true);
    expect(document.activeElement).toBe(field());
  });
});

describe('looking for something', () => {
  it('searches as the person types, one step of the finder for each change, and the field shows what was typed', async () => {
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.type(field(), 'ab');
    expect(field()).toHaveValue('ab');
    expect(rig.finder.calls.map((call) => call.query)).toEqual(['a', 'ab']);
  });

  it('searches again, for the same text, when a switch is pressed, and the switch says it is pressed', async () => {
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.type(field(), 'ab');
    const caseButton = page.getByRole('button', { name: 'Match case' });
    expect(caseButton).toHaveAttribute('aria-pressed', 'false');
    await user.click(caseButton);
    expect(caseButton).toHaveAttribute('aria-pressed', 'true');
    expect(rig.finder.calls.at(-1)).toEqual({ direction: 'next', query: 'ab', options: { caseSensitive: true, regex: false, wholeWord: false } });
    await user.click(page.getByRole('button', { name: 'Match whole word' }));
    await user.click(page.getByRole('button', { name: 'Use regular expression' }));
    expect(rig.finder.calls.at(-1)).toEqual({ direction: 'next', query: 'ab', options: { caseSensitive: true, regex: true, wholeWord: true } });
  });

  it('steps forward on Enter and back on Shift Enter, and on the buttons', async () => {
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.type(field(), 'ab');
    await user.keyboard('{Enter}{Shift>}{Enter}{/Shift}');
    await user.click(page.getByRole('button', { name: 'Next match' }));
    await user.click(page.getByRole('button', { name: 'Previous match' }));
    expect(rig.finder.calls.slice(2).map((call) => call.direction)).toEqual(['next', 'previous', 'next', 'previous']);
    for (const call of rig.finder.calls.slice(2)) {
      expect(call.query).toBe('ab');
    }
  });

  it('steps on F3, Shift F3 and, on a Mac, Command G, from the bar', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.type(field(), 'ab');
    fireEvent.keyDown(field(), { key: 'F3', code: 'F3' });
    fireEvent.keyDown(field(), { key: 'F3', code: 'F3', shiftKey: true });
    fireEvent.keyDown(field(), { key: 'g', code: 'KeyG', metaKey: true });
    fireEvent.keyDown(field(), { key: 'g', code: 'KeyG', metaKey: true, shiftKey: true });
    expect(rig.finder.calls.slice(2).map((call) => call.direction)).toEqual(['next', 'previous', 'next', 'previous']);
  });

  it('is stepped by the screen\'s keys (F3, Shift F3, Command G) when the bar is open, and says so; and says it is not the bar\'s when it is closed', async () => {
    const rig = mount();
    expect(rig.find().step('next')).toBe(false);
    await open(rig);
    await userEvent.setup().type(field(), 'ab');
    const heard = rig.finder.calls.length;
    let answers: boolean[] = [];
    act(() => {
      answers = [rig.find().step('next'), rig.find().step('previous')];
    });
    expect(answers).toEqual([true, true]);
    expect(rig.finder.calls.slice(heard).map((call) => call.direction)).toEqual(['next', 'previous']);
  });

  it('shows the engine\'s count in the lane inside the field: N of M, No results, and a capped count as 20,000+', async () => {
    const rig = mount();
    await open(rig);
    await userEvent.setup().type(field(), 'a');
    expect(lane()?.textContent).toBe('');
    act(() => {
      rig.finder.tell(state(2, 12));
    });
    expect(lane()?.textContent).toBe('3 of 12');
    act(() => {
      rig.finder.tell(state(-1, 0));
    });
    expect(lane()?.textContent).toBe('No results');
    act(() => {
      rig.finder.tell(state(7, 20_000, true));
    });
    expect(lane()?.textContent).toBe('8 of 20,000+');
    expect(field()).toHaveAccessibleDescription('8 of 20,000+');
  });

  it('shows no count for an empty field, whatever the engine says when it is cleared', async () => {
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.type(field(), 'a');
    act(() => {
      rig.finder.tell(state(0, 3));
    });
    expect(lane()?.textContent).toBe('1 of 3');
    await user.clear(field());
    expect(rig.finder.clears()).toBe(1);
    expect(lane()?.textContent).toBe('');
  });

  it('never gives the finder a pattern that does not parse: the field is invalid, the lane says so, the highlights of the search before are cleared and the count of another query is gone', async () => {
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.click(page.getByRole('button', { name: 'Use regular expression' }));
    await user.type(field(), 'a');
    act(() => {
      rig.finder.tell(state(0, 3));
    });
    expect(lane()?.textContent).toBe('1 of 3');
    await user.type(field(), '(');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(lane()?.textContent).toBe('Invalid pattern');
    expect(rig.finder.clears()).toBe(1);
    expect(rig.finder.calls.map((call) => call.query)).toEqual(['a']);
    await user.type(field(), 'b');
    await user.keyboard('{Enter}');
    expect(rig.finder.calls.map((call) => call.query)).toEqual(['a']);
    await user.type(field(), ')');
    expect(field()).not.toHaveAttribute('aria-invalid');
    expect(rig.finder.calls.at(-1)?.query).toBe('a(b)');
  });

  it('works for text that is searched before the finder has arrived: the first search is made when it does', async () => {
    const user = userEvent.setup();
    const rig = mount({ held: true });
    await act(async () => {
      rig.find().open();
      await settled();
    });
    await user.type(field(), 'ab');
    expect(rig.finder.calls).toEqual([]);
    await act(async () => {
      rig.screen.answer(rig.finder);
      await settled();
    });
    expect(rig.finder.calls.map((call) => call.query)).toEqual(['ab']);
  });
});

describe('closing the bar', () => {
  it('closes on the first Escape with text in the field, clears the highlights and gives the keyboard back to the terminal, and the page\'s Escape never sees it', async () => {
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.type(field(), 'hello');
    const reached = vi.fn();
    document.addEventListener('keydown', reached);
    await user.keyboard('{Escape}');
    document.removeEventListener('keydown', reached);
    expect(bar()).toBeNull();
    expect(rig.finder.clears()).toBe(1);
    expect(rig.finder.listeners()).toBe(0);
    expect(rig.screen.focuses()).toBe(1);
    expect(reached).not.toHaveBeenCalled();
    expect(rig.find().isOpen).toBe(false);
  });

  it('closes on the Close button, and on Escape from a button', async () => {
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.click(page.getByRole('button', { name: 'Close find' }));
    expect(bar()).toBeNull();
    await open(rig);
    page.getByRole('button', { name: 'Next match' }).focus();
    await user.keyboard('{Escape}');
    expect(bar()).toBeNull();
    expect(rig.screen.focuses()).toBe(2);
  });

  it('does not close when the person clicks elsewhere', async () => {
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.click(document.body);
    await user.click(page.getByRole('button', { name: 'Find', hidden: true }).parentElement ?? document.body);
    expect(bar()).toBeInTheDocument();
    expect(rig.finder.clears()).toBe(0);
  });

  it('keeps the text and the switches for the next time, selects the text again, and looks for it again: highlights and count come back', async () => {
    const user = userEvent.setup();
    const rig = mount();
    await open(rig);
    await user.type(field(), 'hello');
    await user.click(page.getByRole('button', { name: 'Match case' }));
    await user.keyboard('{Escape}');
    const searched = rig.finder.calls.length;
    await open(rig);
    expect(field()).toHaveValue('hello');
    expect(page.getByRole('button', { name: 'Match case' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(field());
    expect((field() as HTMLInputElement).selectionEnd).toBe(5);
    expect(rig.finder.calls).toHaveLength(searched + 1);
    expect(rig.finder.calls.at(-1)).toEqual({ direction: 'next', query: 'hello', options: { caseSensitive: true, regex: false, wholeWord: false } });
    expect(rig.screen.asks()).toBe(1);
    expect(lane()?.textContent).toBe('');
  });

  it('lets go of the finder when the body goes: nothing listens to it, and nothing is cleared in a screen that goes with it', async () => {
    const rig = mount();
    await open(rig);
    expect(rig.finder.listeners()).toBe(1);
    rig.view.unmount();
    expect(rig.finder.listeners()).toBe(0);
    expect(rig.finder.clears()).toBe(0);
  });
});

describe('a body that is not on screen', () => {
  it('is not redrawn for what the engine says while it is hidden, and shows the latest when it is shown again', async () => {
    const rig = mount();
    await open(rig);
    await userEvent.setup().type(field(), 'a');
    act(() => {
      rig.finder.tell(state(0, 3));
    });
    expect(lane()?.textContent).toBe('1 of 3');
    rig.show(false);
    const drawn = rig.renders();
    act(() => {
      rig.finder.tell(state(1, 3));
      rig.finder.tell(state(2, 3));
    });
    expect(rig.renders()).toBe(drawn);
    expect(lane()?.textContent).toBe('1 of 3');
    rig.show(true);
    expect(lane()?.textContent).toBe('3 of 3');
  });

  it('goes on listening to the finder while hidden, so that the count is right when it is shown', async () => {
    const rig = mount();
    await open(rig);
    rig.show(false);
    expect(rig.finder.listeners()).toBe(1);
  });
});

describe('a finder that cannot be had', () => {
  /** A bar opened on a screen whose search fails to load: the first answer is a rejection. The console's warning is the session's own, kept out of the run. */
  async function failed(): Promise<{ readonly rig: Rig; readonly warn: ReturnType<typeof vi.spyOn> }> {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rig = mount({ held: true });
    await act(async () => {
      rig.find().open();
      await settled();
    });
    await act(async () => {
      rig.screen.fail(new Error('no chunk'));
      await settled();
    });
    return { rig, warn };
  }

  it('logs once and says so in the count lane: the bar is there and finds nothing, the words are in the one polite lane, and the field is not marked invalid', async () => {
    const { rig, warn } = await failed();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(bar()).toBeInTheDocument();
    expect(lane()?.textContent).toBe('Unavailable');
    expect(document.querySelectorAll('[data-ov-lane]')).toHaveLength(1);
    expect(lane()).toHaveAttribute('aria-live', 'polite');
    expect(field()).not.toHaveAttribute('aria-invalid');
    expect(field()).toHaveAccessibleDescription('Unavailable');
    expect(rig.finder.calls).toEqual([]);
  });

  it('asks again at the next request, and when that one gets the finder the words go, the text is searched, and the count shows', async () => {
    const user = userEvent.setup();
    const { rig } = await failed();
    await user.type(field(), 'ab');
    expect(rig.screen.asks()).toBe(2);
    expect(rig.screen.waiting()).toBe(1);
    expect(lane()?.textContent).toBe('Unavailable');
    await act(async () => {
      rig.screen.answer(rig.finder);
      await settled();
    });
    expect(lane()?.textContent).toBe('');
    expect(rig.finder.calls.map((call) => call.query)).toEqual(['ab']);
    act(() => {
      rig.finder.tell(state(0, 3));
    });
    expect(lane()?.textContent).toBe('1 of 3');
  });

  it('keeps the words while the next attempt fails too, and logs once', async () => {
    const user = userEvent.setup();
    const { rig, warn } = await failed();
    await user.type(field(), 'a');
    await act(async () => {
      rig.screen.fail(new Error('no chunk again'));
      await settled();
    });
    expect(lane()?.textContent).toBe('Unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(rig.screen.asks()).toBe(2);
  });

  it('asks again when the bar is closed and opened again, and takes the words away when that one gets the finder', async () => {
    const { rig } = await failed();
    act(() => {
      rig.find().close();
    });
    await act(async () => {
      rig.find().open();
      await settled();
    });
    expect(rig.screen.asks()).toBe(2);
    expect(lane()?.textContent).toBe('Unavailable');
    await act(async () => {
      rig.screen.answer(rig.finder);
      await settled();
    });
    expect(lane()?.textContent).toBe('');
  });
});

// The emulator may be made after the bar is opened. The body says it with the screen's own readiness (`ready`), and a bar that is open searches what it holds then, with no key pressed.
describe('an emulator that is made after the bar was opened', () => {
  it('searches what the bar holds when the screen says that its emulator is there: the count shows without another key', async () => {
    const rig = mount({ held: true, ready: false });
    await open(rig);
    fireEvent.change(field(), { target: { value: 'ab' } });
    await act(async () => {
      rig.screen.answer(undefined);
      await settled();
    });
    expect(rig.finder.calls).toEqual([]);
    expect(lane()?.textContent).toBe('');
    act(() => {
      rig.ready(true);
    });
    expect(rig.screen.asks()).toBe(2);
    await act(async () => {
      rig.screen.answer(rig.finder);
      await settled();
    });
    expect(rig.finder.calls.map((call) => [call.direction, call.query])).toEqual([['next', 'ab']]);
    act(() => {
      rig.finder.tell(state(0, 3));
    });
    expect(lane()?.textContent).toBe('1 of 3');
  });

  it('asks nothing for a bar that is closed: the emulator being there does not load the search', async () => {
    const rig = mount({ ready: false });
    act(() => {
      rig.ready(true);
    });
    await act(async () => {
      await settled();
    });
    expect(rig.screen.asks()).toBe(0);
    expect(bar()).toBeNull();
  });

  it('asks once for a bar opened after the emulator was there: the signal is not a second reason', async () => {
    const rig = mount({ ready: true });
    await open(rig);
    expect(rig.screen.asks()).toBe(1);
    act(() => {
      rig.ready(false);
    });
    act(() => {
      rig.ready(true);
    });
    await act(async () => {
      await settled();
    });
    expect(rig.screen.asks()).toBe(1);
    expect(rig.finder.calls).toEqual([]);
  });
});

describe('the find chord pressed in the bar', () => {
  it('puts the keyboard in the field with its text selected, from a button and from the field itself: the bar asks the session, which asks for the field', async () => {
    const rig = mount();
    await open(rig);
    fireEvent.change(field(), { target: { value: 'hello' } });
    page.getByRole('button', { name: 'Next match' }).focus();
    const target = document.activeElement ?? document.body;
    expect(fireEvent.keyDown(target, { key: 'f', code: 'KeyF', ctrlKey: true })).toBe(false);
    expect(document.activeElement).toBe(field());
    expect([(field() as HTMLInputElement).selectionStart, (field() as HTMLInputElement).selectionEnd]).toEqual([0, 5]);
    (field() as HTMLInputElement).setSelectionRange(5, 5);
    expect(fireEvent.keyDown(document.activeElement ?? document.body, { key: 'f', code: 'KeyF', ctrlKey: true })).toBe(false);
    expect(document.activeElement).toBe(field());
    expect([(field() as HTMLInputElement).selectionStart, (field() as HTMLInputElement).selectionEnd]).toEqual([0, 5]);
  });
});

describe('a session made before the screen', () => {
  it('is the one the hook uses: what opens it from outside (the screen\'s own key) draws the bar, and what steps it is the bar\'s', async () => {
    const session = createFindSession();
    const rig = mount({ session });
    await act(async () => {
      session.open();
      await settled();
    });
    expect(bar()).toBeInTheDocument();
    expect(document.activeElement).toBe(field());
    let took = false;
    act(() => {
      took = session.step('next');
    });
    expect(took).toBe(true);
    expect(rig.screen.asks()).toBe(1);
  });

  it('is closed with the body: unmounting closes an open bar and lets go of the finder', async () => {
    const session = createFindSession();
    const rig = mount({ session });
    await act(async () => {
      session.open();
      await settled();
    });
    rig.view.unmount();
    expect(session.getSnapshot().isOpen).toBe(false);
    expect(rig.finder.listeners()).toBe(0);
  });
});

describe('in strict mode', () => {
  it('opens, finds and closes as it does outside it: the effects that run twice leave one listener and one ask', async () => {
    const user = userEvent.setup();
    const rig = mount({ strict: true });
    await open(rig);
    await user.type(field(), 'ab');
    expect(rig.screen.asks()).toBe(1);
    expect(rig.finder.listeners()).toBe(1);
    await user.keyboard('{Escape}');
    expect(rig.finder.listeners()).toBe(0);
    expect(within(page.getByTestId('stage')).queryByRole('search')).toBeNull();
  });
});

describe('the keys of a Mac', () => {
  it('writes the keys of the tips for a Mac when the window is one', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const rig = mount();
    await open(rig);
    expect(page.getByRole('button', { name: 'Next match' }).getAttribute('data-ov-tip')).toBe('Next match\n\u21B5');
  });
});

describe('closing the bar from the terminal (Escape pressed while the terminal has the keyboard)', () => {
  it('does nothing and says so while the bar is closed: the Escape is the shell\'s', () => {
    const rig = mount();
    let closed = true;
    act(() => {
      closed = rig.find().closeIfOpen();
    });
    expect(closed).toBe(false);
    expect(rig.finder.clears()).toBe(0);
    expect(rig.screen.focuses()).toBe(0);
    expect(bar()).toBeNull();
  });

  it('closes an open bar and says so: the highlights are cleared, the keyboard goes back to the terminal and the bar leaves the document', async () => {
    const rig = mount();
    await open(rig);
    let closed = false;
    act(() => {
      closed = rig.find().closeIfOpen();
    });
    expect(closed).toBe(true);
    expect(bar()).toBeNull();
    expect(rig.finder.clears()).toBe(1);
    expect(rig.finder.listeners()).toBe(0);
    expect(rig.screen.focuses()).toBe(1);
    expect(rig.find().isOpen).toBe(false);
  });
});
