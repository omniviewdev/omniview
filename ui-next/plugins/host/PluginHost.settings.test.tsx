import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as runtime from '../../shell/settings/runtime';
import { manualClock } from '../../shell/core/fields/testing';
import { createSettingsSession } from '../../shell/settings/model/session';
import { fakeHost } from '../../shell/settings/model/testing';
import { acme } from '../testing';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// Where Settings opens is the host's choice of the window it is in (the owner's ruling, 2026-11-22): a native window asks the host for its own Settings window, a browser has none and draws a sheet. The host's window passes
// `openSettingsWindow`; what the control, the gear and the palette's command do with it is tested where they are (`shell/settings/host.test.ts`, `Settings.test.tsx`): here only that the host wires it.

// The sheet's code reads the runtime's bindings, which jsdom does not have: its session is made over a host in memory.
vi.mock('../../shell/settings/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof runtime>()),
  createSession: () => createSettingsSession({ client: fakeHost().client, scheduler: manualClock().scheduler }),
}));

const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

// jsdom has no modal dialog: a stand-in that opens the element, as the attribute does (what a modal does in a real engine is the sheet's probe's).
const dialog = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
dialog.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(openSettingsWindow?: () => Promise<unknown>) {
  return render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} openSettingsWindow={openSettingsWindow} />);
}

describe('Settings through the host', () => {
  it('asks the host\'s window for Settings from the gear, and draws no sheet, where the app has native windows', async () => {
    const openSettingsWindow = vi.fn(async () => undefined);
    mount(openSettingsWindow);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => {
      expect(openSettingsWindow).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });

  it('draws the sheet from the gear in a browser, where there is no window to ask', async () => {
    mount();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });
});
