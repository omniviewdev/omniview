import { ExtensionPointRegistry } from '@omniviewdev/runtime';
import { Category, Setting, SettingType } from '@omniviewdev/runtime/models';
import { describe, expect, it } from 'vitest';
import { ensureBuiltinExtensionPointsRegistered } from '../extensions/registerBuiltinExtensionPoints';
import { registerCoreSearchCatalogue } from './catalogue';

function registry() {
  const instance = new ExtensionPointRegistry();
  ensureBuiltinExtensionPointsRegistered(instance);
  return instance;
}

describe('core global-search catalogue ownership and public metadata', () => {
  it('registers typed settings and ready-plugin closed commands, never reads secret setting values/defaults', () => {
    const instance = registry();
    const theme = new Setting({
      id: 'theme',
      label: 'Theme',
      description: 'Application colors',
      type: SettingType.Select,
    });
    for (const field of ['value', 'default']) {
      Object.defineProperty(theme, field, {
        get: () => {
          throw new Error('protected value must not be indexed');
        },
      });
    }

    const registration = registerCoreSearchCatalogue(instance, {
      settings: { appearance: new Category({ id: 'appearance', label: 'Appearance', settings: { theme } }) },
      plugins: [
        { id: 'probe', label: 'Private native tasks', ready: true },
        { id: 'loading', label: 'Loading plugin', ready: false },
      ],
    });
    const entries = instance.getExtensionPoint('omniview/global-search')!.listAll();
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plugin: 'core',
          label: 'Theme',
          value: expect.objectContaining({
            kind: 'setting',
            target: { section: 'core', categoryId: 'appearance', settingId: 'appearance.theme' },
            keywords: expect.arrayContaining(['appearance.theme']),
          }),
        }),
        expect.objectContaining({
          plugin: 'core',
          label: 'Reload Private native tasks connections',
          value: expect.objectContaining({
            kind: 'command',
            command: { kind: 'reload-connections', pluginId: 'probe' },
          }),
        }),
      ]),
    );
    expect(entries.some((entry) => entry.label.includes('Loading plugin'))).toBe(false);
    expect(entries.every((entry) => entry.id.startsWith('core/global-search/'))).toBe(true);
    registration.dispose();
  });

  it('unregisters only its exact owned core contributions', () => {
    const instance = registry();
    const store = instance.getExtensionPoint('omniview/global-search')!;
    store.register({
      id: 'core/other-feature',
      plugin: 'core',
      label: 'Other feature',
      value: {
        schemaVersion: 1,
        kind: 'navigation',
        target: { kind: 'core', path: '/' },
      },
    });
    const registration = registerCoreSearchCatalogue(instance, { settings: {}, plugins: [] });
    expect(store.listAll().length).toBeGreaterThan(1);
    registration.dispose();
    expect(store.listAll().map((entry) => entry.id)).toEqual(['core/other-feature']);
  });

  it('bounds settings descriptor processing before inspecting surplus metadata and reports overflow', () => {
    const instance = registry();
    const settings: Record<string, Setting> = {};
    for (let index = 0; index < 1001; index++) {
      settings[`s${index}`] = new Setting({ id: `s${index}`, label: `Setting ${index}`, type: SettingType.Text });
    }

    Object.defineProperty(settings.s1000, 'label', {
      get: () => {
        throw new Error('surplus metadata must not be scanned');
      },
    });
    const registration = registerCoreSearchCatalogue(instance, {
      settings: { general: new Category({ id: 'general', label: 'General', settings }) },
      plugins: [],
    });
    expect(registration.truncated).toBe(true);
    expect(
      instance
        .getExtensionPoint('omniview/global-search')!
        .listAll()
        .some((entry) => entry.label === 'Setting 1000'),
    ).toBe(false);
    registration.dispose();
  });

  it('caps registrations at the 1000 the controller reads, core entries included, reporting truncation', () => {
    const instance = registry();
    const settings: Record<string, Setting> = {};
    for (let index = 0; index < 996; index++) {
      settings[`s${index}`] = new Setting({ id: `s${index}`, label: `Setting ${index}`, type: SettingType.Text });
    }

    const registration = registerCoreSearchCatalogue(instance, {
      settings: { general: new Category({ id: 'general', label: 'General', settings }) },
      plugins: [],
      newTabPlugins: [{ id: 'probe', name: 'Probe' }],
    });

    const entries = instance.getExtensionPoint('omniview/global-search')!.listAll();
    expect(entries).toHaveLength(1000);
    expect(entries.some((entry) => entry.label === 'New Probe tab')).toBe(false);
    expect(registration.truncated).toBe(true);
    registration.dispose();
  });

  it('does not spend the registration cap on skipped dev-only settings', () => {
    const instance = registry();
    const settings: Record<string, Setting> = {};
    for (let index = 0; index < 995; index++) {
      settings[`dev${index}`] = new Setting({ id: `dev${index}`, label: `Dev ${index}`, type: SettingType.Text, devOnly: true });
    }

    settings.first = new Setting({ id: 'first', label: 'First', type: SettingType.Text });
    settings.second = new Setting({ id: 'second', label: 'Second', type: SettingType.Text });
    const registration = registerCoreSearchCatalogue(instance, {
      settings: { general: new Category({ id: 'general', label: 'General', settings }) },
      plugins: [],
    });

    const labels = instance.getExtensionPoint('omniview/global-search')!.listAll().map((entry) => entry.label);
    expect(labels).toEqual(expect.arrayContaining(['First', 'Second']));
    expect(registration.truncated).toBe(false);
    registration.dispose();
  });

  it('rejects oversized generated IDs/command labels before constructing or reading unrelated metadata', () => {
    const instance = registry();
    const setting = new Setting({ id: 'oversized', label: 'Not indexed', type: SettingType.Text });
    Object.defineProperty(setting, 'label', {
      get: () => {
        throw new Error('oversized ID metadata must not be scanned');
      },
    });
    const registration = registerCoreSearchCatalogue(instance, {
      settings: {
        general: new Category({ id: 'general', label: 'General', settings: { ['x'.repeat(256)]: setting } }),
      },
      plugins: [{ id: 'probe', label: 'x'.repeat(238), ready: true }],
    });
    expect(registration.unavailable).toBe(true);
    expect(
      instance
        .getExtensionPoint('omniview/global-search')!
        .listAll()
        .some((entry) => entry.label.startsWith('Reload ')),
    ).toBe(false);
    registration.dispose();
  });

  it('keeps "New <plugin> tab" entries for plugin IDs and names near the limits', () => {
    const instance = registry();
    const id = 'p'.repeat(256);
    const name = 'N'.repeat(200);
    const registration = registerCoreSearchCatalogue(instance, { settings: {}, plugins: [], newTabPlugins: [{ id, name }] });

    const entry = instance.getExtensionPoint('omniview/global-search')!.listAll().find((candidate) => candidate.label === `New ${name} tab`);
    expect(entry?.value).toMatchObject({ kind: 'navigation', target: { kind: 'plugin', pluginId: id, path: '/' } });
    expect(registration.unavailable).toBe(false);
    registration.dispose();
  });
});
