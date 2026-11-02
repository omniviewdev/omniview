import { describe, expect, it } from 'vitest';
import { extensionInspectorTarget, settingsWindowTarget } from './settingsWindow';

describe('extension diagnostic route migration', () => {
  it('migrates both diagnostic settings formats without claiming the Settings window', () => {
    const canonical = '/settings?section=extensions';
    const legacy = '#/settings?section=core&category=extensions';
    expect(extensionInspectorTarget(canonical)).toBe('/developer-tools/extensions');
    expect(extensionInspectorTarget(legacy)).toBe('/developer-tools/extensions');
    expect(settingsWindowTarget(canonical)).toBeNull();
    expect(settingsWindowTarget(legacy)).toBeNull();
  });

  it('preserves diagnostic selection without carrying settings-only focus state', () => {
    const input = new URLSearchParams({
      category: 'extensions',
      plugin: 'acme',
      point: 'omniview/resource/sidebar/infopanel',
      contribution: 'acme/a?b#c',
      setting: 'private-setting',
    });
    const migrated = extensionInspectorTarget(`/settings/?${input.toString()}`);
    const result = new URL(migrated!, 'https://host.invalid');
    expect(result.pathname).toBe('/developer-tools/extensions');
    expect(Object.fromEntries(result.searchParams)).toEqual({
      plugin: 'acme',
      point: 'omniview/resource/sidebar/infopanel',
      contribution: 'acme/a?b#c',
    });
  });

  it('retains unrelated settings routes and rejects external or look-alike paths', () => {
    expect(extensionInspectorTarget('/settings?section=plugins&category=extensions')).toBeNull();
    expect(settingsWindowTarget('/settings?category=editor')).toBe('/settings?category=editor');
    expect(extensionInspectorTarget('https://example.com/settings?section=extensions')).toBeNull();
    expect(settingsWindowTarget('//example.com/settings?section=extensions')).toBeNull();
    expect(extensionInspectorTarget('/settings-other?section=extensions')).toBeNull();
  });
});
