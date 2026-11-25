import { describe, expect, it } from 'vitest';
import { manifestOf } from './manifest';

// The `plugin.yaml` of a fixture plugin. The capabilities are what the host reads to know the plugin has a process (any backend capability starts one) and which controllers to start for it, so a plugin that serves a forward
// declares `networker`, as a real plugin does. The manifests the seam's other scenarios read are held to what they were, text for text.

const text = (capabilities: readonly string[]) =>
  ['id: fixture-x', 'version: 0.0.1', 'name: X', 'description: Fixture plugin of the new UI seam', 'license: Apache-2.0', 'author:', '  name: Omniview', 'capabilities:', ...capabilities.map((capability) => `  - ${capability}`), ''].join('\n');

describe('the manifest of a fixture plugin', () => {
  it('declares the UI alone for a plugin with no process', () => {
    expect(manifestOf('fixture-x', 'X', false)).toBe(text(['ui']));
  });

  it('declares settings and the UI for a plugin whose process serves what the SDK serves to every plugin', () => {
    expect(manifestOf('fixture-x', 'X', true)).toBe(text(['settings', 'ui']));
  });

  it('declares the capabilities the process serves itself, before the two every plugin has', () => {
    expect(manifestOf('fixture-x', 'X', true, ['resource'])).toBe(text(['resource', 'settings', 'ui']));
  });

  it('declares the networker capability of a plugin that forwards ports', () => {
    const manifest = manifestOf('fixture-x', 'X', true, ['resource', 'networker']);
    expect(manifest).toBe(text(['resource', 'networker', 'settings', 'ui']));
    expect(manifest.split('\n')).toContain('  - networker');
  });

  it('keeps a served capability out of a plugin that has no process: nothing would serve it', () => {
    expect(manifestOf('fixture-x', 'X', false, ['networker'])).toBe(text(['ui']));
  });
});
