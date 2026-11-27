import { cleanup, render, screen as page } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST } from '../../core/panel';
import { PaneRoomProvider, type PaneRoom } from '../panes/room';
import { fakeEngineLoader, fakeTerminalFeed } from './testing';
import { createScreenReaderChoice } from './screenReader';
import { TerminalBody } from './TerminalBody';
import { createTerminalSessions } from './TerminalSessions';
import { TERMINAL_TOOL } from './tool';

// The Split terminal button of the Terminal tool's toolbar (#697 step 6): in the body of each pane, against the real registry and screen with a FAKE emulator (what a real one does with the pane's size is the probe's). It asks the deck for the
// length the panes would share, and the window to split; it says why it cannot when there is no room or no way to say where the terminal is.

function mount(options: { readonly room: PaneRoom | null; readonly onSplit?: ((session: string, extent: number) => void) | undefined; readonly directory?: boolean }) {
  const store = createPanelStore({ now: () => 1_000, newId: () => 's1' });
  store.registerTool(TERMINAL_TOOL);
  const sessions = createTerminalSessions(store, { newId: () => 'term-1' });
  sessions.attach();
  const feed = fakeTerminalFeed({ state: 'running', ...(options.directory === false ? {} : { directory: async () => Promise.resolve({ state: 'known', path: '/usr', source: 'shell' } as const) }) });
  const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed });
  const session = store.getSnapshot().sessions[opened?.id ?? ''];
  const body = (
    <TerminalBody sessions={sessions} session={session} visible load={fakeEngineLoader().load} screenReader={createScreenReaderChoice(false)} canSplit={options.directory !== false} {...(options.onSplit === undefined ? {} : { onSplit: options.onSplit })} />
  );
  render(options.room === null ? body : <PaneRoomProvider value={options.room}>{body}</PaneRoomProvider>);
  return { user: userEvent.setup() };
}

afterEach(cleanup);

describe('Split terminal', () => {
  it('is a button of the toolbar, and asks the window to split this session for the length the deck says', async () => {
    const onSplit = vi.fn();
    const r = mount({ room: { fits: true, extent: () => 900 }, onSplit });
    const button = page.getByRole('button', { name: 'Split terminal' });
    expect(button).toBeEnabled();
    await r.user.click(button);
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(onSplit).toHaveBeenCalledWith('s1', 900);
  });

  it('is in the toolbar\'s one Tab stop with the other buttons (it is a member of the roving group), and is named for a screen reader', () => {
    mount({ room: { fits: true, extent: () => 900 }, onSplit: vi.fn() });
    const toolbar = page.getByRole('toolbar', { name: 'Terminal tools' });
    expect(toolbar.querySelectorAll('[data-terminal-tool]')).toHaveLength(5);
    expect(toolbar.querySelector('[data-terminal-tool="split"]')).not.toBeNull();
  });

  it('cannot apply when no other pane fits: it stays focusable and says why', async () => {
    const onSplit = vi.fn();
    const r = mount({ room: { fits: false, extent: () => 150 }, onSplit });
    const button = page.getByRole('button', { name: 'Split terminal' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(/No room for another pane/);
    await r.user.click(button);
    expect(onSplit).not.toHaveBeenCalled();
  });

  it('cannot apply outside a deck of panes, and when the terminal cannot say where it is', async () => {
    const onSplit = vi.fn();
    const r = mount({ room: null, onSplit });
    expect(page.getByRole('button', { name: 'Split terminal' })).toHaveAttribute('aria-disabled', 'true');
    await r.user.click(page.getByRole('button', { name: 'Split terminal' }));
    expect(onSplit).not.toHaveBeenCalled();
    cleanup();
    mount({ room: { fits: true, extent: () => 900 }, onSplit, directory: false });
    expect(page.getByRole('button', { name: 'Split terminal' })).toHaveAttribute('aria-disabled', 'true');
    expect(page.getByRole('button', { name: 'Split terminal' })).toHaveAccessibleDescription(/cannot say where/);
  });

  it('is not in a body the window gives no way to split', () => {
    mount({ room: { fits: true, extent: () => 900 } });
    expect(page.queryByRole('button', { name: 'Split terminal' })).toBeNull();
  });
});
