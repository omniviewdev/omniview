import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST } from '../../core/panel';
import type { TerminalFeedSnapshot } from './feed';
import { createScreenReaderChoice } from './screenReader';
import { fakeEngineLoader, fakeTerminalFeed } from './testing';
import { TerminalBody } from './TerminalBody';
import { createTerminalSessions } from './TerminalSessions';
import { TERMINAL_TOOL } from './tool';

// THE TIER FOR A PERSON WHO CANNOT SEE THE CARD (issue #694 step 6): the description the terminal's input points to says the shell integration in the words of the card, and follows it when the shell proves itself.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mount(snapshot: Partial<TerminalFeedSnapshot>) {
  const store = createPanelStore({ now: () => 1_000, newId: () => 's1' });
  store.registerTool(TERMINAL_TOOL);
  const sessions = createTerminalSessions(store, { newId: () => 'term-1' });
  sessions.attach();
  const feed = fakeTerminalFeed();
  feed.set(snapshot);
  const loader = fakeEngineLoader();
  const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed });
  render(<TerminalBody sessions={sessions} session={store.getSnapshot().sessions[opened?.id ?? '']} visible load={loader.load} screenReader={createScreenReaderChoice(false)} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  const [, hintId] = loader.engines[0]?.labels[0] ?? ['', ''];
  return { feed, hint: () => document.getElementById(hintId)?.textContent ?? '' };
}

describe('the description of the terminal\'s input', () => {
  it('says the tier of the shell integration in the card\'s words, after what it says of the keys', async () => {
    const rich = await mount({ integration: { state: 'on' }, proven: true });
    expect(rich.hint()).toMatch(/^Escape and Tab go to the shell\./);
    expect(rich.hint()).toContain('Shell integration. Rich: the shell tells this terminal each command, its exit status, its directory and its time.');
  });

  it('says Basic until the shell proves itself, and None with the reason when the host did not integrate it', async () => {
    const basic = await mount({ integration: { state: 'on' } });
    expect(basic.hint()).toContain('Shell integration. Basic: the shell was started with the integration and has not yet proved a command or a directory.');
    cleanup();
    const none = await mount({ integration: { state: 'off' } });
    expect(none.hint()).toContain('Shell integration. None: shell integration is turned off in Settings.');
  });

  it('says nothing of it when the producer says nothing', async () => {
    const silent = await mount({});
    expect(silent.hint()).not.toContain('Shell integration');
  });

  it('follows the shell: Basic becomes Rich when the shell proves itself', async () => {
    const m = await mount({ integration: { state: 'on' } });
    expect(m.hint()).toContain('Basic:');
    act(() => {
      m.feed.set({ proven: true });
    });
    expect(m.hint()).toContain('Rich:');
    expect(m.hint()).not.toContain('Basic:');
  });
});
