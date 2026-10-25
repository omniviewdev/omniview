import type { ExtensionContributionRegistration, ExtensionPointRegistryContract } from '@omniviewdev/runtime';
import type { Category } from '@omniviewdev/runtime/models';
import { admitSearchContribution } from './admission';
import { GLOBAL_SEARCH_EXTENSION_POINT_ID } from './extensionPoint';
import type { SearchEntryV1 } from './types';

export type CoreSearchPlugin = {
  id: string;
  label: string;
  ready: boolean;
};

type CatalogueInput = {
  settings: Record<string, Category | undefined>;
  plugins: readonly CoreSearchPlugin[];
  devMode?: boolean;
};

export type CoreSearchCatalogue = {
  truncated: boolean;
  unavailable: boolean;
  dispose: () => void;
};

export function registerCoreSearchCatalogue(
  registry: ExtensionPointRegistryContract,
  input: CatalogueInput,
): CoreSearchCatalogue {
  const store = registry.getExtensionPoint(GLOBAL_SEARCH_EXTENSION_POINT_ID);
  if (!store) {
    throw new Error('Global search extension point must be registered before its catalogue.');
  }

  const owned = new Set<ExtensionContributionRegistration>();
  let consumed = 0;
  let truncated = false;
  let unavailable = false;

  function register(label: string, value: SearchEntryV1) {
    const registration = { id: `core/global-search/catalogue/${owned.size}`, plugin: 'core', label, value };
    if (!admitSearchContribution(registration)) {
      unavailable = true;
      return;
    }

    store!.register(registration);
    owned.add(registration);
  }

  register('Home', { schemaVersion: 1, kind: 'navigation', target: { kind: 'core', path: '/' } });
  register('Plugins', { schemaVersion: 1, kind: 'navigation', target: { kind: 'core', path: '/plugins' } });
  register('Extensions', { schemaVersion: 1, kind: 'setting', target: { section: 'extensions' } });

  catalogue: for (const key in input.settings) {
    if (!Object.hasOwn(input.settings, key)) {
      continue;
    }

    if (consumed++ >= 1000) {
      truncated = true;
      break;
    }

    const category = input.settings[key];
    if (!category) {
      continue;
    }

    if (typeof category.id !== 'string' || !category.id || category.id.length > 256) {
      unavailable = true;
      continue;
    }

    register(category.label, {
      schemaVersion: 1,
      kind: 'setting',
      description: category.description,
      target: { section: 'core', categoryId: category.id },
    });
    for (const settingKey in category.settings) {
      if (!Object.hasOwn(category.settings, settingKey)) {
        continue;
      }

      if (consumed++ >= 1000) {
        truncated = true;
        break catalogue;
      }

      const setting = category.settings[settingKey];
      if (!setting || (setting.devOnly && !input.devMode)) {
        continue;
      }

      if (!settingKey || category.id.length + 1 + settingKey.length > 256) {
        unavailable = true;
        continue;
      }

      const fullId = `${category.id}.${settingKey}`;
      const keywords: string[] = [];
      if (category.label.length > 0 && category.label.length <= 128) {
        keywords.push(category.label);
      }

      if (settingKey.length > 0 && settingKey.length <= 128) {
        keywords.push(settingKey);
      }

      if (fullId.length <= 128) {
        keywords.push(fullId);
      }

      // Deliberately read only public descriptors, never values/defaults/options.
      register(setting.label, {
        schemaVersion: 1,
        kind: 'setting',
        description: setting.description,
        keywords,
        target: { section: 'core', categoryId: category.id, settingId: fullId },
      });
    }
  }

  for (const plugin of input.plugins) {
    if (consumed++ >= 1000) {
      truncated = true;
      break;
    }

    if (!plugin.ready) {
      continue;
    }

    if (
      plugin.id.length === 0 ||
      plugin.id.length > 256 ||
      plugin.label.length > 256 - 'Reload '.length - ' connections'.length
    ) {
      unavailable = true;
      continue;
    }

    register(`Reload ${plugin.label} connections`, {
      schemaVersion: 1,
      kind: 'command',
      command: { kind: 'reload-connections', pluginId: plugin.id },
      description: 'Reload connections from this plugin’s native provider.',
    });
  }

  return {
    truncated,
    unavailable,
    dispose() {
      for (const registration of store.listAll()) {
        if (owned.has(registration)) {
          store.unregister(registration.id);
        }
      }

      owned.clear();
    },
  };
}
