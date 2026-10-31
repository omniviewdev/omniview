import { describe, it, expect } from 'vitest';
import { validatePluginExports } from './validation';
import { PluginValidationError } from './errors';
import { PluginWindow } from '@omniviewdev/runtime';

describe('validatePluginExports boundaries', () => {
  it('rejects a missing module', () => {
    expect(() => validatePluginExports(null)).toThrow(PluginValidationError);
  });

  it('rejects a null plugin', () => {
    expect(() => validatePluginExports({ plugin: null })).toThrow(PluginValidationError);
  });

  it('rejects an array in place of a plugin instance', () => {
    expect(() => validatePluginExports({ plugin: [] })).toThrow(PluginValidationError);
  });

  it('rejects an empty sidebar resource type ID', () => {
    expect(() => validatePluginExports({
      plugin: new PluginWindow(),
      sidebars: Object.fromEntries([['', () => null]]),
    })).toThrow(PluginValidationError);
  });

  it('rejects an empty drawer resource type ID', () => {
    expect(() => validatePluginExports({
      plugin: new PluginWindow(),
      drawers: Object.fromEntries([['', () => ({ views: [] })]]),
    })).toThrow(PluginValidationError);
  });
});
