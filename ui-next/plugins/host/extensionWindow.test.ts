import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRIBUTION_EXPORT_V1 } from '../contract/admit';
import { acme } from '../testing';
import { ExtensionAuthority } from './extensionAuthority';
import { ExtensionWindow } from './extensionWindow';
import { describePlugins } from './inventory';
import type { EventSource } from './lifecycle';
import { PluginStore } from './pluginStore';

const source = { id: 'owner', phase: 'Running', enabled: true, origin: 'external', hasPage: false, metadata: { name: 'Owner' }, extension: {
  pin: `sha256:${'1'.repeat(64)}`, generation: 'one', features: [], views: [], manifest: JSON.stringify({ schemaVersion: 1, id: 'owner', offers: [], bindings: [], points: [{
    id: 'usage', kind: 'section', protocol: 'visuals/utilization@1', placement: 'overview-section', label: 'Usage', contract: { package: 'owner-points', version: '1.0.0', export: 'usage' },
  }] }),
} };

describe('window admission', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto); 
  });
  afterEach(() => {
    vi.unstubAllGlobals(); 
  });

  it('admits a route-less peer only after its owner page and exact grant, and cannot resurrect a revoked grant from an older read', async () => {
    const authority = new ExtensionAuthority();
    const imports: string[] = [];
    const pages = new PluginStore({
      importBundle: async id => {
        imports.push(id); return { [CONTRIBUTION_EXPORT_V1]: acme() }; 
      },
      clearBundle: vi.fn(), log: vi.fn(),
    });
    const bridge = new ExtensionWindow(authority, pages);
    const owner = { ...source, hasPage: true, extension: { ...source.extension, pageDigest: source.extension.pin } };
    const peer = { ...source, id: 'peer', extension: { ...source.extension, pin: `sha256:${'2'.repeat(64)}`, features: ['gauge'],
      manifest: JSON.stringify({ schemaVersion: 1, id:'peer', points:[], offers:[{ id:'gauge', label:'Usage', kind:'section', protocol:'visuals/utilization@1', requests:['used'] }], bindings:[{ offer:'gauge', target:'owner/usage' }] }) } };
    type Policy = Parameters<ExtensionAuthority['replacePolicy']>[0];
    const denied: Policy = { known:true, revision:'1', disabled:false, grants:[], disabledOffers:[], disabledBindings:[] };
    let policy = Promise.resolve(denied);
    const events = new Map<string, Parameters<EventSource['On']>[1]>();
    const stop = bridge.listen({ On: (name, fn) => {
      events.set(name, fn); return () => {
        events.delete(name); 
      }; 
    } }, async () => policy, vi.fn(), fn => {
      fn(true);
      return vi.fn();
    });
    const invalidate = () => events.get('ui-extensions:policy-invalidated')?.({});
    try {
      const rows = await bridge.inventory(async () => [owner, peer]);
      for (const page of describePlugins(rows)) {
        await pages.load(page);
      }

      expect(imports).toEqual(['owner']);
      await vi.waitFor(() => {
        expect(authority.declaredPoint('owner/usage')).toBeTruthy(); 
      });
      expect(authority.point('owner/usage')).toHaveLength(0);
      const allowed: Policy = { ...denied, revision: '2', grants: [{ point:'owner/usage', offer:'peer/gauge',
        ownerPin:owner.extension.pin, contributorPin:peer.extension.pin, contract:authority.declaredPoint('owner/usage')!.contract, fields:['used'], continuity:'first' }] };
      policy = Promise.resolve(allowed);
      invalidate();
      await vi.waitFor(() => {
        expect(authority.point('owner/usage')).toHaveLength(1); 
      });
      const pending = Promise.withResolvers<Policy>();
      policy = pending.promise;
      invalidate();
      expect(authority.point('owner/usage')).toHaveLength(0);
      policy = Promise.resolve({ ...denied, revision:'3' });
      invalidate();
      pending.resolve(allowed);
      await pending.promise;
      expect(authority.point('owner/usage')).toHaveLength(0);
    } finally {
      stop(); 
    }
  });

  it('shares discovery with pages, never loads a route-less owner, and fences inventory spanning an unload', async () => {
    const authority = new ExtensionAuthority();
    const bridge = new ExtensionWindow(authority, new PluginStore());
    const handlers = new Map<string, Parameters<EventSource['On']>[1]>();
    let connection: ((online: boolean) => void) | undefined;
    const stop = bridge.listen({ On: (name, cb) => {
      handlers.set(name, cb); return () => {
        handlers.delete(name); 
      }; 
    } },
    async () => ({ known:false, revision:'', disabled:true, grants:[], disabledOffers:[], disabledBindings:[] }),
    vi.fn(), notify => {
      connection = notify; notify(true); return () => {
        connection = undefined; 
      }; 
    });
    try {
      expect(describePlugins(await bridge.inventory(async () => [source]))).toEqual([]);
      await vi.waitFor(() => {
        expect(authority.declaredPoint('owner/usage')).toBeTruthy(); 
      });
      const pending = Promise.withResolvers<Array<typeof source>>();
      const read = bridge.inventory(async () => pending.promise);
      handlers.get('plugin/unloaded')?.({ data:{ pluginID:'owner', cause:'crashed' } });
      expect(authority.declaredPoint('owner/usage')).toBeFalsy();
      pending.resolve([source]);
      await expect(read).rejects.toThrow('Plugin inventory changed during read');
      expect(authority.declaredPoint('owner/usage')).toBeFalsy();
      connection?.(false);
      await bridge.inventory(async () => [source]);
      expect(authority.declaredPoint('owner/usage')).toBeFalsy();
    } finally {
      stop(); 
    }

    expect(handlers.size).toBe(0);
  });
});
