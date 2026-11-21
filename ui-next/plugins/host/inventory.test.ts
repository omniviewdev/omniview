import { describe, expect, it } from 'vitest';
import { describePlugins, type InstalledPlugin } from './inventory';

// What the host's inventory (`PluginManager.ListPlugins`) says of each plugin, as the window reads it (PU2): which plugins have an interface to load, under what name, and which the host holds as failed. The phase is read and nothing else of
// the plugin's state: the inventory carries the text of its last error (`lastError`), which is the plugins page's to show, never the window's.

const plugin = (patch: Partial<InstalledPlugin> & { readonly id: string }): InstalledPlugin => ({ origin: 'external', enabled: true, phase: 'Running', metadata: { name: `Name of ${patch.id}` }, ...patch });

describe('describePlugins', () => {
  it('names each plugin by its manifest, else by its id', () => {
    expect(describePlugins([plugin({ id: 'acme' }), plugin({ id: 'bare', metadata: { name: '' } })])).toEqual([
      { id: 'acme', name: 'Name of acme' },
      { id: 'bare', name: 'bare' },
    ]);
  });

  it('leaves out what has no bundle to load here: the host\'s own frontends, and a plugin that was turned off', () => {
    expect(describePlugins([plugin({ id: 'built', origin: 'builtin' }), plugin({ id: 'off', enabled: false }), plugin({ id: 'acme' })]).map((described) => described.id)).toEqual(['acme']);
  });

  it.each(['Failed', 'BuildFailed'])('says the host holds a plugin as failed when its phase is %s', (phase) => {
    expect(describePlugins([plugin({ id: 'acme', phase })])).toEqual([{ id: 'acme', name: 'Name of acme', failed: true }]);
  });

  it.each(['Running', 'Starting', 'Recovering', 'Stopped', 'Installed', 'Degraded', ''])('says nothing of failure for a plugin in the phase %s: its interface is read and the host\'s events say the rest', (phase) => {
    expect(describePlugins([plugin({ id: 'acme', phase })])).toEqual([{ id: 'acme', name: 'Name of acme' }]);
  });

  it('reads no text of the plugin\'s state into what it describes', () => {
    const listed: InstalledPlugin & { readonly lastError: string } = { ...plugin({ id: 'acme', phase: 'Failed' }), lastError: 'panic at /Users/me/.omniview/plugins/acme: token=abc123' };

    const described = describePlugins([listed]);

    expect(JSON.stringify(described)).not.toMatch(/abc123|Users|panic/);
  });
});
