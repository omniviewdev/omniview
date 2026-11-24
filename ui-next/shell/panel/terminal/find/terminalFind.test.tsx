import { act, cleanup, fireEvent, render, screen as page } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST } from '../../../core/panel';
import type { FindState } from '../engine';
import type { TerminalFeedSnapshot, TerminalTarget } from '../feed';
import { createScreenReaderChoice } from '../screenReader';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngine, type FakeEngineLoader, type FakeTerminalFeed } from '../testing';
import { TerminalBody } from '../TerminalBody';
import { createTerminalSessions } from '../TerminalSessions';
import { TERMINAL_TOOL } from '../tool';

// The find bar in the body of a terminal session: the real body, registry and screen over a fake emulator and a fake finder (what the real ones do is the probes' to prove). What is checked is the joining: the toolbar's
// Find button and the screen's find chord open the bar, what is typed reaches the emulator's finder, the screen's step keys step it, Escape gives the keyboard back to the emulator, and a bar that is only an overlay asks the
// emulator for no other size. The clock is fake and the events are made by hand (the keyboard library waits on a real timer, which a fake clock never gives it).

type Rig = {
  readonly engine: FakeEngine;
  readonly feed: FakeTerminalFeed;
};

let counter = 0;

/** The body of a session, drawn over a fake emulator: the toolbar, the screen and the lane. The loader that makes the emulator is the test's: with `deferred` it makes none until `release`. */
async function start(options: { readonly state?: TerminalFeedSnapshot['state']; readonly deferred?: boolean } = {}): Promise<{ readonly loader: FakeEngineLoader; readonly feed: FakeTerminalFeed }> {
  counter = 0;
  const store = createPanelStore({ now: () => 1_000, newId: () => `s${String(++counter)}` });
  store.registerTool(TERMINAL_TOOL);
  const sessions = createTerminalSessions(store, { newId: () => `term-${String(++counter)}` });
  sessions.attach();
  const feed = fakeTerminalFeed({ state: options.state ?? 'running' });
  const loader = fakeEngineLoader({ deferred: options.deferred === true });
  const target: TerminalTarget = { plugin: HOST, id: 'local', title: 'Terminal', open: () => feed };
  const opened = sessions.open(target, { focus: false });
  const id = opened?.id ?? '';
  const session = store.getSnapshot().sessions[id];
  if (session === undefined) {
    throw new Error('the session was not opened');
  }

  render(<TerminalBody sessions={sessions} session={session} visible load={loader.load} screenReader={createScreenReaderChoice()} />);
  await flush();
  return { loader, feed };
}

async function mount(options: { readonly state?: TerminalFeedSnapshot['state'] } = {}): Promise<Rig> {
  const { loader, feed } = await start(options);
  const engine = loader.engines[0];
  if (engine === undefined) {
    throw new Error('the emulator was not made');
  }

  return { engine, feed };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  document.documentElement.removeAttribute('data-ov-theme');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

const toolbarFind = () => page.getByRole('button', { name: 'Find' });
const bar = () => page.queryByRole('search', { name: 'Find in terminal' });
const field = () => page.getByRole('searchbox', { name: 'Find in terminal' });
const lane = () => document.querySelector('[data-ov-lane]');
const state = (index: number, count: number, capped = false): FindState => ({ index, count, capped });

/** Types the text a key at a time, as a person does: the field holds one more character at each change. */
function type(text: string) {
  for (let length = 1; length <= text.length; length += 1) {
    fireEvent.change(field(), { target: { value: text.slice(0, length) } });
  }
}

/** A key as the emulator's key handler sees it, inside React's `act` so that what it opens is drawn. */
function press(engine: FakeEngine, init: Parameters<FakeEngine['key']>[0]) {
  let answer: ReturnType<FakeEngine['key']> | undefined;
  act(() => {
    answer = engine.key(init);
  });
  if (answer === undefined) {
    throw new Error('the key was not answered');
  }

  return answer;
}

describe('the toolbar\'s Find button', () => {
  it('is the first button of the toolbar, a toggle that says so, and its tip is its name and the chord of the platform', async () => {
    await mount();
    const toolbar = page.getByRole('toolbar', { name: 'Terminal tools' });
    expect(toolbar.querySelector('button')).toBe(toolbarFind());
    expect(toolbarFind()).toHaveAttribute('aria-pressed', 'false');
    expect(toolbarFind().getAttribute('data-ov-tip')).toBe('Find\nCtrl+F');
  });

  it('writes the chord with the Command glyph on a Mac', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    await mount();
    expect(toolbarFind().getAttribute('data-ov-tip')).toBe('Find\n\u2318F');
  });

  it('opens the bar over the screen and gives the keyboard to its field, and a second press closes it, clears the highlights and gives the keyboard back to the emulator', async () => {
    const { engine } = await mount();
    expect(bar()).toBeNull();
    fireEvent.click(toolbarFind());
    await flush();
    expect(bar()).toBeInTheDocument();
    expect(toolbarFind()).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(field());
    const focuses = engine.focuses();
    fireEvent.click(toolbarFind());
    await flush();
    expect(bar()).toBeNull();
    expect(toolbarFind()).toHaveAttribute('aria-pressed', 'false');
    expect(engine.findClears()).toBe(1);
    expect(engine.focuses()).toBe(focuses + 1);
  });

  it('draws the bar as a sibling of the screen, between it and the status lane, and not inside the element the emulator draws in', async () => {
    await mount();
    fireEvent.click(toolbarFind());
    await flush();
    const screenElement = document.querySelector('[data-shell-part="terminalScreen"]');
    const laneElement = document.querySelector('[data-shell-part="terminalLane"]');
    expect(screenElement?.contains(bar())).toBe(false);
    expect([...(screenElement?.parentElement?.children ?? [])]).toEqual([screenElement, bar(), laneElement]);
  });
});

describe('the find chord in the terminal', () => {
  it('opens the bar on Control F and Control Shift F, and the key is taken: the emulator does not send it to the shell', async () => {
    const { engine } = await mount();
    const first = press(engine, { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(first).toEqual({ handled: false, defaultPrevented: true });
    await flush();
    expect(bar()).toBeInTheDocument();
    expect(document.activeElement).toBe(field());
    const again = press(engine, { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true });
    expect(again).toEqual({ handled: false, defaultPrevented: true });
    expect(bar()).toBeInTheDocument();
  });

  it('opens the bar on Command F on a Mac', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { engine } = await mount();
    const answer = press(engine, { key: 'f', code: 'KeyF', metaKey: true });
    expect(answer).toEqual({ handled: false, defaultPrevented: true });
    await flush();
    expect(bar()).toBeInTheDocument();
    expect(document.activeElement).toBe(field());
  });

  it('puts the keyboard in the field again, with its text selected, when the chord is pressed in the TERMINAL with the bar open: the emulator\'s own key rules take it', async () => {
    const { engine } = await mount();
    press(engine, { key: 'f', code: 'KeyF', ctrlKey: true });
    await flush();
    type('hello');
    expect(press(engine, { key: 'f', code: 'KeyF', ctrlKey: true })).toEqual({ handled: false, defaultPrevented: true });
    await flush();
    expect(document.activeElement).toBe(field());
    expect((field() as HTMLInputElement).selectionStart).toBe(0);
    expect((field() as HTMLInputElement).selectionEnd).toBe(5);
  });
});

// The bar is beside the screen and not in it: the emulator's key rules never see a key pressed in the bar, so the chord there is the bar's. These are real key events at the control that has the keyboard, as a person makes them.
describe('the find chord pressed in the bar', () => {
  const CTRL_F = { key: 'f', code: 'KeyF', ctrlKey: true } as const;
  const selected = (): [number | null, number | null] => [(field() as HTMLInputElement).selectionStart, (field() as HTMLInputElement).selectionEnd];

  async function opened(text: string): Promise<Rig> {
    const rig = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    type(text);
    return rig;
  }

  it('puts the keyboard in the field and selects its text when it is pressed in the field itself, and takes the key: the window, the shell and the browser\'s own find never see it', async () => {
    const { engine, feed } = await opened('hello');
    (field() as HTMLInputElement).setSelectionRange(5, 5);
    const target = document.activeElement;
    expect(target).toBe(field());
    const reached = vi.fn();
    document.addEventListener('keydown', reached);
    const focuses = engine.focuses();
    const goesOn = fireEvent.keyDown(target ?? document.body, CTRL_F);
    document.removeEventListener('keydown', reached);
    await flush();
    expect(goesOn).toBe(false);
    expect(reached).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field());
    expect(selected()).toEqual([0, 5]);
    expect(engine.focuses()).toBe(focuses);
    expect(feed.typed()).toEqual([]);
  });

  it.each(['Match case', 'Use regular expression', 'Match whole word', 'Previous match', 'Next match', 'Close find'])('puts the keyboard in the field and selects its text when it is pressed on the %s button, and takes the key', async (name) => {
    await opened('hello');
    page.getByRole('button', { name }).focus();
    const target = document.activeElement;
    expect(target).toBe(page.getByRole('button', { name }));
    const reached = vi.fn();
    document.addEventListener('keydown', reached);
    const goesOn = fireEvent.keyDown(target ?? document.body, CTRL_F);
    document.removeEventListener('keydown', reached);
    await flush();
    expect(goesOn).toBe(false);
    expect(reached).not.toHaveBeenCalled();
    expect(bar()).toBeInTheDocument();
    expect(document.activeElement).toBe(field());
    expect(selected()).toEqual([0, 5]);
  });

  it('is Control Shift F on Windows and Linux too, and Command F on a Mac', async () => {
    await opened('hello');
    page.getByRole('button', { name: 'Next match' }).focus();
    expect(fireEvent.keyDown(document.activeElement ?? document.body, { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(field());
    cleanup();
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    await opened('hello');
    page.getByRole('button', { name: 'Next match' }).focus();
    expect(fireEvent.keyDown(document.activeElement ?? document.body, { key: 'f', code: 'KeyF', metaKey: true })).toBe(false);
    expect(document.activeElement).toBe(field());
    expect(selected()).toEqual([0, 5]);
  });

  it('looks for nothing by itself: the chord only brings the keyboard to the field', async () => {
    const { engine } = await opened('hello');
    const searched = engine.finds.length;
    page.getByRole('button', { name: 'Close find' }).focus();
    fireEvent.keyDown(document.activeElement ?? document.body, CTRL_F);
    await flush();
    expect(engine.finds).toHaveLength(searched);
    expect(bar()).toBeInTheDocument();
  });
});

// The panel can be shown, and Find pressed, before the emulator's code has loaded and the emulator is made. The screen has no finder to give then; once the emulator is there, the bar searches what it holds, with no key pressed.
describe('a bar opened before the emulator is there', () => {
  async function release(loader: FakeEngineLoader): Promise<FakeEngine> {
    loader.release();
    await flush();
    const engine = loader.engines[0];
    if (engine === undefined) {
      throw new Error('the emulator was not made');
    }

    return engine;
  }

  it('searches what it holds once the emulator is made, with no key pressed: the count shows', async () => {
    const { loader } = await start({ deferred: true });
    expect(loader.engines).toHaveLength(0);
    fireEvent.click(toolbarFind());
    await flush();
    expect(bar()).toBeInTheDocument();
    type('err');
    expect(lane()?.textContent).toBe('');
    const engine = await release(loader);
    expect(engine.finds.map((find) => [find.direction, find.query])).toEqual([['next', 'err']]);
    act(() => {
      engine.found(state(0, 3));
    });
    expect(lane()?.textContent).toBe('1 of 3');
  });

  it('listens to the finder of the emulator it was waiting for, and lets go of it when it closes', async () => {
    const { loader } = await start({ deferred: true });
    fireEvent.click(toolbarFind());
    await flush();
    const engine = await release(loader);
    expect(engine.findListeners()).toBe(1);
    fireEvent.keyDown(field(), { key: 'Escape', code: 'Escape' });
    await flush();
    expect(engine.findListeners()).toBe(0);
  });

  it('loads none of the emulator\'s search for a bar nobody opened: the emulator being made is not a reason', async () => {
    const { loader } = await start({ deferred: true });
    const engine = await release(loader);
    expect(engine.findAsks()).toBe(0);
    expect(engine.findListeners()).toBe(0);
  });
});

describe('looking for something', () => {
  it('reaches the emulator\'s finder as it is typed, with the switches as they are pressed, and the count in the lane is the finder\'s', async () => {
    const { engine } = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    type('err');
    fireEvent.click(page.getByRole('button', { name: 'Match case' }));
    expect(engine.finds.map((find) => [find.direction, find.query, find.options.caseSensitive])).toEqual([
      ['next', 'e', false],
      ['next', 'er', false],
      ['next', 'err', false],
      ['next', 'err', true],
    ]);
    act(() => {
      engine.found(state(2, 12));
    });
    expect(lane()?.textContent).toBe('3 of 12');
    act(() => {
      engine.found(state(0, 20_000, true));
    });
    expect(lane()?.textContent).toBe('1 of 20,000+');
  });

  it('is stepped by the screen\'s own keys while the bar is open: F3 forward, Shift F3 back, and the keys are taken', async () => {
    const { engine } = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    type('err');
    const heard = engine.finds.length;
    const forward = press(engine, { key: 'F3', code: 'F3' });
    const back = press(engine, { key: 'F3', code: 'F3', shiftKey: true });
    expect(forward).toEqual({ handled: false, defaultPrevented: true });
    expect(back).toEqual({ handled: false, defaultPrevented: true });
    expect(engine.finds.slice(heard).map((find) => [find.direction, find.query])).toEqual([['next', 'err'], ['previous', 'err']]);
  });

  it('steps on Enter and Shift Enter in the field, as it does from the screen', async () => {
    const { engine } = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    type('err');
    const heard = engine.finds.length;
    fireEvent.keyDown(field(), { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(field(), { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(engine.finds.slice(heard).map((find) => [find.direction, find.query])).toEqual([['next', 'err'], ['previous', 'err']]);
  });

  it('leaves F3 to the shell while the bar is closed: the terminal\'s own key, as it was, and the finder is not asked', async () => {
    const { engine } = await mount();
    const answer = press(engine, { key: 'F3', code: 'F3' });
    expect(answer).toEqual({ handled: true, defaultPrevented: false });
    expect(engine.finds).toEqual([]);
    expect(engine.findAsks()).toBe(0);
  });

  it('can be searched in a terminal that has ended: its output is there to read', async () => {
    const { engine } = await mount({ state: 'ended' });
    fireEvent.click(toolbarFind());
    await flush();
    type('done');
    expect(bar()).toBeInTheDocument();
    expect(engine.finds.at(-1)).toMatchObject({ direction: 'next', query: 'done' });
  });

  it('never gives the emulator a pattern that does not parse', async () => {
    const { engine } = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    fireEvent.click(page.getByRole('button', { name: 'Use regular expression' }));
    type('(');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(lane()?.textContent).toBe('Invalid pattern');
    expect(engine.finds).toEqual([]);
  });
});

describe('closing the bar', () => {
  it('closes on Escape: the highlights are cleared, the keyboard is the emulator\'s again, and nothing of the bar stays in the document', async () => {
    const { engine } = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    type('hello');
    const focuses = engine.focuses();
    fireEvent.keyDown(field(), { key: 'Escape', code: 'Escape' });
    await flush();
    expect(bar()).toBeNull();
    expect(document.querySelector('[data-shell-part="terminalFind"]')).toBeNull();
    expect(engine.findClears()).toBe(1);
    expect(engine.findListeners()).toBe(0);
    expect(engine.focuses()).toBe(focuses + 1);
  });

  it('is opened again on the text it had, which is looked for again', async () => {
    const { engine } = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    type('hello');
    fireEvent.keyDown(field(), { key: 'Escape', code: 'Escape' });
    await flush();
    const heard = engine.finds.length;
    press(engine, { key: 'f', code: 'KeyF', ctrlKey: true });
    await flush();
    expect(field()).toHaveValue('hello');
    expect(engine.finds).toHaveLength(heard + 1);
    expect(engine.finds.at(-1)).toMatchObject({ direction: 'next', query: 'hello' });
  });
});

describe('what the bar costs', () => {
  it('asks the emulator for its finder on the first opening only, and not before: a terminal nobody searches loads none of the emulator\'s search', async () => {
    const { engine } = await mount();
    expect(engine.findAsks()).toBe(0);
    expect(engine.findListeners()).toBe(0);
    fireEvent.click(toolbarFind());
    await flush();
    expect(engine.findAsks()).toBe(1);
    expect(engine.findListeners()).toBe(1);
    fireEvent.click(toolbarFind());
    fireEvent.click(toolbarFind());
    await flush();
    expect(engine.findAsks()).toBe(1);
  });

  it('is an overlay: opening it, searching and closing it ask for no other size of the terminal, of the emulator or of the shell', async () => {
    const { engine, feed } = await mount();
    const resizes = engine.resizes.length;
    const sizes = feed.sizes().length;
    fireEvent.click(toolbarFind());
    await flush();
    type('abc');
    fireEvent.keyDown(field(), { key: 'Escape', code: 'Escape' });
    await flush();
    expect(engine.resizes).toHaveLength(resizes);
    expect(feed.sizes()).toHaveLength(sizes);
  });

  it('is released with the body: unmounting an open bar leaves no listener on the finder', async () => {
    const { engine } = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    expect(engine.findListeners()).toBe(1);
    cleanup();
    expect(engine.findListeners()).toBe(0);
  });
});

describe('Escape pressed in the terminal', () => {
  it('closes the bar while it is open: the key is the bar\'s and not the shell\'s, so nothing is written to the feed, the highlights are cleared and the keyboard is the emulator\'s', async () => {
    const { engine, feed } = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    type('hello');
    const focuses = engine.focuses();
    const answer = press(engine, { key: 'Escape', code: 'Escape' });
    await flush();
    expect(answer).toEqual({ handled: false, defaultPrevented: true });
    expect(bar()).toBeNull();
    expect(toolbarFind()).toHaveAttribute('aria-pressed', 'false');
    expect(engine.findClears()).toBe(1);
    expect(engine.findListeners()).toBe(0);
    expect(engine.focuses()).toBe(focuses + 1);
    expect(feed.typed()).toEqual([]);
  });

  it('is the shell\'s while the bar is closed: the emulator takes the key and sends the escape to the program, and nothing is cleared', async () => {
    const { engine, feed } = await mount();
    const answer = press(engine, { key: 'Escape', code: 'Escape' });
    expect(answer).toEqual({ handled: true, defaultPrevented: false });
    expect(engine.findClears()).toBe(0);
    expect(feed.typed()).toEqual([]);
  });

  it('is the shell\'s again once the bar is closed: the first Escape closes it, the second goes to the program', async () => {
    const { engine } = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    expect(press(engine, { key: 'Escape', code: 'Escape' })).toEqual({ handled: false, defaultPrevented: true });
    await flush();
    expect(press(engine, { key: 'Escape', code: 'Escape' })).toEqual({ handled: true, defaultPrevented: false });
    expect(engine.findClears()).toBe(1);
  });

  it('does not close the bar for an Escape with a modifier: that is not the Escape of the find (Shift, Control, Option and Command Escape are the terminal\'s or the window\'s)', async () => {
    const { engine } = await mount();
    fireEvent.click(toolbarFind());
    await flush();
    press(engine, { key: 'Escape', code: 'Escape', ctrlKey: true });
    press(engine, { key: 'Escape', code: 'Escape', altKey: true });
    press(engine, { key: 'Escape', code: 'Escape', shiftKey: true });
    expect(bar()).toBeInTheDocument();
    expect(engine.findClears()).toBe(0);
  });
});
