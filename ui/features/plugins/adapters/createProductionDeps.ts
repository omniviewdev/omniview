import { EXTENSION_REGISTRY } from '@/features/extensions/store';
import { ensureBuiltinExtensionPointsRegistered } from '@/features/extensions/registerBuiltinExtensionPoints';
import { EventsOn } from '@omniviewdev/runtime/runtime';
import { validatePluginExports } from '../core/validation';
import { MissingExtensionPointError } from '../core/errors';
import type { PluginServiceDeps } from '../core/types';
import { importPlugin } from './importPlugin';
import { clearPlugin } from './clearPlugin';
import { ensureDevSharedDeps } from './devSharedDeps';

const pluginServiceLogger = {
  debug(message: string, data?: Record<string, unknown>): void {
    console.debug(`[PluginService] ${message}`, data ?? '');
  },
  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(`[PluginService] ${message}`, data ?? '');
  },
  error(message: string, data?: Record<string, unknown>): void {
    console.error(`[PluginService] ${message}`, data ?? '');
  },
};

/**
 * Create production dependency injection for PluginService.
 *
 * Wires the real extension registry, SystemJS/ESM import adapters,
 * Wails event system, and real validation pipeline.
 */
export function createProductionDeps(): PluginServiceDeps {
  return {
    importPlugin,
    clearPlugin,

    onEvent: (eventName, handler) => {
      // EventsOn returns () => void — use it for proper cleanup.
      return EventsOn(eventName, handler);
    },

    ensureBuiltinExtensionPoints: () => {
      ensureBuiltinExtensionPointsRegistered(EXTENSION_REGISTRY);
    },

    addExtensionPoint: (extension) => {
      EXTENSION_REGISTRY.addExtensionPoint(extension);
    },

    removeExtensionPoints: (pluginId) => {
      EXTENSION_REGISTRY.removeExtensionPoints(pluginId);
    },

    registerContribution: (extensionPointId, contribution) => {
      const store = EXTENSION_REGISTRY.getExtensionPoint(extensionPointId);
      if (!store) {
        throw new MissingExtensionPointError(
          `Extension point "${extensionPointId}" does not exist — cannot register contribution "${contribution.id}" from plugin "${contribution.plugin}"`,
          {
            pluginId: contribution.plugin,
            extensionPointId,
          },
        );
      }
      store.register(contribution);
    },

    removeContributions: (pluginId) => {
      EXTENSION_REGISTRY.removeContributions(pluginId);
    },

    ensureDevSharedDeps,
    validateExports: validatePluginExports,
    log: pluginServiceLogger,
  };
}
