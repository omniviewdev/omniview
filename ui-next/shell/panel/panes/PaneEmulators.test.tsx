import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createPanelStore, HOST } from '../../core/panel';
import { StaticShell } from '../../testing';
import { fakeEngineLoader, fakeTerminalFeed } from '../terminal/testing';
import { createScreenReaderChoice } from '../terminal/screenReader';
import { TerminalBody } from '../terminal/TerminalBody';
import { createTerminalSessions } from '../terminal/TerminalSessions';
import { TERMINAL_TOOL } from '../terminal/tool';
import { staticPanel } from '../testing';

// A split makes ONE emulator, the new pane's: no pane that is there is remounted (its emulator, its scrollback and its process's view would go with it). The real registry and the real body, with a FAKE emulator that counts its constructions
// (jsdom has no layout; the real emulator's contexts are the probe's, `panes.gl`).

afterEach(cleanup);

function rig() {
  let counter = 0;
  const store = createPanelStore({ newId: () => `s${String((counter += 1))}` });
  store.registerTool(TERMINAL_TOOL);
  const sessions = createTerminalSessions(store, { newId: () => `term-${String((counter += 1))}` });
  sessions.attach();
  const loader = fakeEngineLoader();
  const reader = createScreenReaderChoice(false);
  const panel = staticPanel({ store, renderBody: (session, visible) => <TerminalBody sessions={sessions} session={session} visible={visible} load={loader.load} screenReader={reader} /> });
  render(<StaticShell registration={{ plugin: { name: 'Acme' } }} panel={panel} />);
  const open = (split?: boolean) => {
    act(() => {
      sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed({ state: 'running' }) }, split === true ? { split: { extent: 1000 } } : {});
    });
  };

  return { store, loader, open };
}

describe('the emulators across splits', () => {
  it('constructs one for each pane and none again: a split in the middle remounts no pane that is there', async () => {
    const r = rig();
    r.open();
    await act(async () => Promise.resolve());
    r.open(true);
    await act(async () => Promise.resolve());
    r.open(true);
    await act(async () => Promise.resolve());
    expect(r.loader.engines).toHaveLength(3);
    const [one] = r.store.getSnapshot().order;
    act(() => {
      r.store.focusPane('terminal', r.store.getSnapshot().panes.terminal?.panes.find((pane) => pane.session === one)?.id ?? '');
    });
    r.open(true);
    await act(async () => Promise.resolve());
    expect(r.loader.engines, 'a split in the middle made one emulator, the new pane\'s').toHaveLength(4);
    expect(r.loader.engines.filter((engine) => engine.disposed() > 0)).toHaveLength(0);
  });
});
