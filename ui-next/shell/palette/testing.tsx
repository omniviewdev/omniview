import { cleanup, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { vi } from 'vitest';
import { command, commands as manyCommands, makePalette, page, type Fixture } from '../core/palette/testing';
import type { Candidate, PaletteOptions, PaletteStore, Provider } from '../core/palette';
import { boot, type Harness } from '../core/tabs/testing';
import { Palette } from './Palette';
import { PaletteProvider } from './context';
import { createAnnouncer, type PaletteBindings } from './host';

// Test support only: nothing in the product imports this file. The palette's view is read over the real store, the real tab model and the real announcer; only the browser's modal dialog is a
// stand-in, because jsdom has none (what a modal does in a real engine, the top layer and an inert document, is the probe's to prove).

/** jsdom has no `showModal`: a stand-in that opens the element, as the attribute does. Installed once. */
export function installDialog(): void {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };

  proto.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

export const cloudPages: readonly Candidate[] = [
  page('instances', 'Instances', { context: 'Cloud · Compute', icon: 'server' }),
  page('volumes', 'Volumes', { context: 'Cloud · Storage', icon: 'server' }),
  page('buckets', 'Buckets', { context: 'Cloud · Storage', icon: 'server' }),
  { id: 'home', kind: 'home', title: 'Cloud', context: 'Compute', icon: 'server', keywords: 'cloud', route: { plugin: 'cloud', contribution: 'instances' } },
];

/** What the palette of a window offers in these tests: a plugin's pages, the host's commands (one of them bound to a chord) and the host's tabs. */
export function providers(f: Fixture): Provider[] {
  return [
    { id: 'cloud:pages', plugin: 'cloud', pluginName: 'Cloud', pluginIcon: 'server', title: 'Pages', section: 'goto', match: () => cloudPages },
    {
      id: 'host:commands',
      plugin: 'host',
      pluginName: 'Omniview',
      title: 'Commands',
      section: 'commands',
      match: () => [command('host.tab.close', 'Close tab', { context: 'Tabs', icon: 'close', shortcut: '⌘W' }), command('host.panel.toggle', 'Toggle panel', { context: 'Panel', icon: 'panel-bottom' })],
    },
    {
      id: 'host:tabs',
      plugin: 'host',
      pluginName: 'Omniview',
      title: 'Tabs',
      section: 'tabs',
      match: () => f.tabs.state().order.map((id) => ({ id, kind: 'tab' as const, title: f.tabs.state().tabs[id]?.face.title ?? '?', tab: id, context: 'Window 1', matchContext: '', route: f.tabs.state().tabs[id]?.location.route })),
    },
  ];
}

export type Mounted = {
  readonly f: Fixture;
  readonly h: Harness;
  readonly bindings: PaletteBindings;
  readonly store: PaletteStore;
  readonly user: UserEvent;
  /** The button that holds the focus before the palette opens. */
  readonly opener: HTMLButtonElement;
  readonly unmount: () => void;
};

export type MountOptions = {
  /** Register the fixture's providers. Default: yes. */
  readonly register?: boolean;
  readonly platform?: string;
  readonly onRender?: ProfilerOnRenderCallback;
  /** What running a command answers. Default: the fixture's, which records it and says it ran. */
  readonly run?: PaletteOptions['run'];
  /** What the palette opens with. Default: nothing: no query, no chips. */
  readonly opening?: PaletteBindings['opening'];
};

/** The palette over the real store, the real tab model (two tabs open, the first on screen) and the fixture world, with a button that can hold the focus before it opens. */
export function mount(options: MountOptions = {}): Mounted {
  installDialog();
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(options.platform ?? 'MacIntel');
  const announcer = createAnnouncer();
  const h = boot({ home: false });
  h.openAll(['instances', 'volumes']);
  h.store.goto(1);
  const f = makePalette({ tabs: h, announce: announcer.announce, ...(options.run === undefined ? {} : { run: options.run }), platform: options.platform?.startsWith('Mac') === false ? 'other' : 'mac' });
  if (options.register !== false) {
    for (const provider of providers(f)) {
      f.palette.registerProvider(provider);
    }
  }

  const bindings: PaletteBindings = { store: f.palette, announcer, opening: options.opening ?? (() => ({})) };
  const body = (
    <PaletteProvider palette={bindings}>
      <button type="button">Opener</button>
      <main data-shell-region="island" data-shell-focus tabIndex={-1} />
      <Palette />
    </PaletteProvider>
  );
  const view = render(
    options.onRender === undefined ? (
      body
    ) : (
      <Profiler id="palette" onRender={options.onRender}>
        {body}
      </Profiler>
    ),
  );
  const opener = document.querySelector<HTMLButtonElement>('button')!;
  return { f, h, bindings, store: f.palette, user: userEvent.setup(), opener, unmount: view.unmount };
}

export function teardown(): void {
  cleanup();
  vi.restoreAllMocks();
}

export { command, manyCommands, page };
