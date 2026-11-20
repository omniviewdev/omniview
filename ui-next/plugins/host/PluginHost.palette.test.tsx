import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, type PanelStore } from '../../shell';
import { acme } from '../testing';
import * as palette from './palette';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// The window's command palette through the host (palette.ts is tested on its own): that PluginHost makes it of the window's own models, attaches it for as long as the window is on screen, and
// lets go of it when the window goes. What the shell draws of it is the shell's, and is tested there.

const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

type Made = { readonly deps: palette.HostPaletteDeps; readonly palette: palette.HostPalette };

/** The palettes the host makes, with what it made them of, and how many are attached now. */
function watch() {
  const create = palette.createHostPalette;
  const made: Made[] = [];
  const live = { attached: 0 };
  vi.spyOn(palette, 'createHostPalette').mockImplementation((deps) => {
    const real = create(deps);
    const watched: palette.HostPalette = {
      ...real,
      attach: () => {
        live.attached += 1;
        const stop = real.attach();
        return () => {
          live.attached -= 1;
          stop();
        };
      },
    };
    made.push({ deps, palette: watched });
    return watched;
  });
  return { made, live };
}

function mount(over: { readonly onCloseWindow?: () => void; readonly panel?: PanelStore } = {}, options: { readonly reactStrictMode?: boolean } = {}) {
  return render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} {...over} />, options);
}

// jsdom has no modal dialog: a stand-in that opens the element, as the attribute does (what a modal does in a real engine is the shell's probes').
const dialog = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
dialog.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the host\'s palette', () => {
  it('is made once, of the window\'s own models: its plugins, its panel, the callback that closes the window, and the tab model the shell draws', () => {
    const { made } = watch();
    const panel = createPanelStore();
    const onCloseWindow = vi.fn();
    mount({ onCloseWindow, panel });

    expect(made).toHaveLength(1);
    const deps = made[0]?.deps;
    expect(deps?.plugins).toBe(plugins);
    expect(deps?.panel).toBe(panel);
    expect(deps?.onCloseWindow).toBe(onCloseWindow);
    expect(deps?.contributions.home?.('acme')).toEqual({ plugin: 'acme', contribution: 'widgets' });
    // The tab the palette's tab model opens is the one the shell draws.
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    act(() => {
      deps?.tabs.open({ route: { plugin: 'acme', contribution: 'widgets' } });
    });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('is told the platform the window runs on', () => {
    const { made } = watch();
    mount();
    expect(made[0]?.deps.platform).toBe('other');
    cleanup();

    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    mount();
    expect(made[1]?.deps.platform).toBe('mac');
  });

  it('is attached while the window is on screen, and let go of when it leaves', () => {
    const { made, live } = watch();
    const view = mount();
    expect(live.attached).toBe(1);

    // Attached to the models the window drives: the place a tab opens at is remembered.
    act(() => {
      made[0]?.deps.tabs.open({ route: { plugin: 'acme', contribution: 'widgets' } });
    });
    expect(made[0]?.palette.store.getSnapshot().recents.map((recent) => recent.route.contribution)).toEqual(['widgets']);

    view.unmount();
    expect(live.attached).toBe(0);
  });

  it('is attached once at a time when the window mounts twice, as React does while it is developed', () => {
    const { live } = watch();
    const view = mount({}, { reactStrictMode: true });
    expect(live.attached).toBe(1);

    view.unmount();
    expect(live.attached).toBe(0);
  });

  it('is the one the shell draws: the top row has its Search control, and it opens the palette', async () => {
    const { made } = watch();
    const user = userEvent.setup();
    mount();
    expect(made[0]?.palette.store.getSnapshot().open).toBe(false);

    await user.click(screen.getByRole('button', { name: /^Search/ }));

    expect(made[0]?.palette.store.getSnapshot().open).toBe(true);
  });
});
