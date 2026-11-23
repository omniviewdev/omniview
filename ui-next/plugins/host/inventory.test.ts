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

  it('says the host refused a plugin for the protocol it speaks, with the two numbers it decided on, and nothing of its text', () => {
    const refused = plugin({ id: 'acme', phase: 'Failed', incompatible: { pluginProtocol: 2, accepted: { oldest: 1, newest: 1 } } });

    expect(describePlugins([refused])).toEqual([{ id: 'acme', name: 'Name of acme', failed: true, incompatible: { pluginProtocol: 2, accepted: { oldest: 1, newest: 1 } } }]);
  });

  it('reads the numbers and nothing else of what the host sent as incompatible', () => {
    const refused = plugin({ id: 'acme', phase: 'Failed', incompatible: { pluginProtocol: 2, accepted: { oldest: 1, newest: 1, text: 'SECRET' }, error: 'incompatible API version with plugin: token=abc123' } });

    const described = describePlugins([refused]);

    expect(described[0]?.incompatible).toEqual({ pluginProtocol: 2, accepted: { oldest: 1, newest: 1 } });
    expect(JSON.stringify(described)).not.toMatch(/SECRET|abc123|API version/);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['text', 'protocol 2'],
    ['numbers that are text', { pluginProtocol: '2', accepted: { oldest: 1, newest: 1 } }],
    ['a range that is not one', { pluginProtocol: 2, accepted: { oldest: 2, newest: 1 } }],
  ])('says nothing of a refusal for an inventory entry whose incompatible is %s: the plugin is described as it would be without it', (_name, incompatible) => {
    expect(describePlugins([plugin({ id: 'acme', phase: 'Failed', incompatible })])).toEqual([{ id: 'acme', name: 'Name of acme', failed: true }]);
  });

  it('reads no text of the plugin\'s state into what it describes', () => {
    const listed: InstalledPlugin & { readonly lastError: string } = { ...plugin({ id: 'acme', phase: 'Failed' }), lastError: 'panic at /Users/me/.omniview/plugins/acme: token=abc123' };

    const described = describePlugins([listed]);

    expect(JSON.stringify(described)).not.toMatch(/abc123|Users|panic/);
  });
});
