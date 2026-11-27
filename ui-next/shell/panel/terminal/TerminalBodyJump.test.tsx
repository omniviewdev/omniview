import { act, cleanup, render, screen as page } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST } from '../../core/panel';
import type { PlacedMark, TerminalMark } from './feed';
import { createScreenReaderChoice } from './screenReader';
import { fakeEngineLoader, fakeTerminalFeed } from './testing';
import { TerminalBody } from './TerminalBody';
import { createTerminalSessions } from './TerminalSessions';
import { TERMINAL_TOOL } from './tool';

// "SHOW" OF THE FINISHED-COMMAND NOTICE, ON THE BODY (issue #694 step 6): the registry keeps the request to move a terminal's view to a command; the body that shows the session takes it once its screen is there, moves the view to the
// command, puts the keyboard in the terminal (the person pressed Show: it is theirs to ask for, wherever the keyboard was) and says where it went in the live region. A request for a terminal that is not on screen waits for it.
// Against the real panel model, the real registry and screen, and the fake emulator.

const mark = (kind: TerminalMark['kind'], extra: Partial<TerminalMark> = {}): TerminalMark => ({ kind, at: 0, end: 1, trust: 'unverified', ...extra });
const placed = (at: number, one: TerminalMark): PlacedMark => ({ mark: one, at });

function mount(options: { readonly visible?: boolean } = {}) {
  const store = createPanelStore({ now: () => 1_000, newId: () => 's1' });
  store.registerTool(TERMINAL_TOOL);
  const sessions = createTerminalSessions(store, { newId: () => 'term-1' });
  sessions.attach();
  const feed = fakeTerminalFeed();
  const loader = fakeEngineLoader();
  const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed }, { focus: false });
  const id = opened?.id ?? '';
  const reader = createScreenReaderChoice(false);
  const body = (visible: boolean) => <TerminalBody sessions={sessions} session={store.getSnapshot().sessions[id]!} visible={visible} load={loader.load} screenReader={reader} />;
  const view = render(body(options.visible ?? true));
  return {
    sessions,
    feed,
    loader,
    id,
    show: (visible: boolean) => {
      view.rerender(body(visible));
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
};

/** A terminal that ran `make`, which failed. */
async function withCommand(options: { readonly visible?: boolean } = {}) {
  const m = mount(options);
  await settle();
  if (options.visible !== false) {
    act(() => {
      m.feed.push('$ make\r\nout1\r\nout2\r\n', [
        placed(0, mark('prompt-start', { id: 'c1' })),
        placed(2, mark('input-start', { id: 'c1' })),
        placed(8, mark('command-start', { id: 'c1', trust: 'nonce', command: 'make' })),
        placed(20, mark('command-end', { id: 'c1', exit: 2, durationMs: 31_000 })),
      ]);
    });
    await settle();
  }

  return m;
}

describe('a request to show a command', () => {
  it('moves the view to the command, puts the keyboard in the terminal wherever it was, takes the request and says where it went', async () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    const m = await withCommand();
    const engine = m.loader.engines[0];
    expect(engine?.scrolls).toEqual([]);
    expect(engine?.focuses()).toBe(0);
    act(() => {
      m.sessions.requestJump(m.id, 'c1');
    });
    await settle();
    expect(engine?.scrolls).toEqual([0]);
    expect(engine?.focuses(), 'the person pressed Show: the keyboard goes in even from a field outside the panel').toBe(1);
    expect(m.sessions.pendingJump(m.id), 'the request is spent').toBeUndefined();
    expect(page.getByText('Command 1 of 1, Failed, exit 2, took 31 s: make')).toBeInTheDocument();
    field.remove();
  });

  it('waits for the terminal to be on screen, and is done once it is: nothing moves while the panel shows another session', async () => {
    const m = await withCommand();
    m.show(false);
    await settle();
    const engine = m.loader.engines[0];
    act(() => {
      m.sessions.requestJump(m.id, 'c1');
    });
    await settle();
    expect(m.sessions.pendingJump(m.id), 'still waiting').toBe('c1');
    expect(engine?.scrolls).toEqual([]);
    expect(engine?.focuses()).toBe(0);
    m.show(true);
    await settle();
    expect(m.sessions.pendingJump(m.id)).toBeUndefined();
    expect(engine?.scrolls).toEqual([0]);
    expect(engine?.focuses()).toBe(1);
  });

  it('says that the command is gone when the screen does not hold it, still brings the keyboard in, and is spent', async () => {
    const m = await withCommand();
    const engine = m.loader.engines[0];
    act(() => {
      m.sessions.requestJump(m.id, 'c99');
    });
    await settle();
    expect(engine?.scrolls).toEqual([]);
    expect(engine?.focuses()).toBe(1);
    expect(m.sessions.pendingJump(m.id)).toBeUndefined();
    expect(page.getByText('That command is no longer in the terminal')).toBeInTheDocument();
  });

  it('is taken once: a second request for the same command moves the view again, and nothing moves with no request', async () => {
    const m = await withCommand();
    const engine = m.loader.engines[0];
    await settle();
    expect(engine?.scrolls).toEqual([]);
    for (const turn of [1, 2]) {
      act(() => {
        m.sessions.requestJump(m.id, 'c1');
      });
      await settle();
      expect(engine?.scrolls, `request ${String(turn)}`).toHaveLength(turn);
    }
  });
});
