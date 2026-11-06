import type { PluginInfo } from '@omniviewdev/runtime/models';
import { describe, expect, it } from 'vitest';
import { selectNewTabPlugins } from './newTabPlugins';

const plugin = (id: string, name?: string) => ({ id, enabled: true, metadata: { name, icon: `Si${id}` } }) as unknown as PluginInfo;
const withPages = { routes: [{ path: '' }] };

describe('selectNewTabPlugins', () => {
  it('leaves out loaded plugins without pages, which only extend other plugins', () => {
    const registrations = new Map([['kubernetes', withPages], ['flux', { routes: [] }]]);

    expect(selectNewTabPlugins([plugin('kubernetes', 'Kubernetes'), plugin('flux', 'Flux')], registrations).map(({ id }) => id))
      .toEqual(['kubernetes']);
  });

  it('keeps plugins that have not loaded yet', () => {
    const registrations = new Map([['kubernetes', withPages]]);

    expect(selectNewTabPlugins([plugin('kubernetes', 'Kubernetes'), plugin('aws', 'AWS')], registrations).map(({ id }) => id))
      .toEqual(['aws', 'kubernetes']);
  });
  it('shows discovered built-in pages without advertising disabled or command-only built-ins', () => {
    const inventory = [
      { ...plugin('pages'), origin: 'builtin', enabled: true },
      { ...plugin('commands'), origin: 'builtin', enabled: true },
      { ...plugin('disabled'), origin: 'builtin', enabled: false },
    ];
    const registrations = new Map([['pages', withPages], ['disabled', withPages]]);
    expect(selectNewTabPlugins(inventory, registrations).map(({ id }) => id)).toEqual(['pages']);
  });


  it('sorts by display name, falling back to the plugin ID', () => {
    const registrations = new Map([['proxmox', withPages], ['kubernetes', withPages], ['zeta', withPages]]);

    expect(selectNewTabPlugins([plugin('proxmox', 'Proxmox'), plugin('zeta'), plugin('kubernetes', 'Kubernetes')], registrations))
      .toEqual([
        { id: 'kubernetes', name: 'Kubernetes', icon: 'Sikubernetes' },
        { id: 'proxmox', name: 'Proxmox', icon: 'Siproxmox' },
        { id: 'zeta', name: 'zeta', icon: 'Sizeta' },
      ]);
  });
});
