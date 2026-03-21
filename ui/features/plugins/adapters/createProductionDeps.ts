import { EXTENSION_REGISTRY } from '@/features/extensions/store';
import { ensureBuiltinExtensionPointsRegistered } from '@/features/extensions/registerBuiltinExtensionPoints';
import { Events } from '@omniviewdev/runtime/runtime';
import { validatePluginExports } from '../core/validation';
import { MissingExtensionPointError, DuplicateContributionError } from '../core/errors';
import { InMemoryCrashDataStrategy } from '../core/CrashDataService';
import type { PluginServiceDeps, PluginServiceConfig } from '../core/types';
import { DEFAULT_CONFIG } from '../core/types';
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
export function createProductionDeps(config?: Partial<PluginServiceConfig>): PluginServiceDeps {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  const crashData = new InMemoryCrashDataStrategy({ maxRecordsPerContribution: resolved.maxCrashRecordsPerContribution });

  return {
    crashData,
    importPlugin,
    clearPlugin,

    onEvent: (eventName, handler) => {
      // Events.On returns () => void — use it for proper cleanup.
      return Events.On(eventName, (ev) => handler(ev.data));
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
      try {
        store.register(contribution);
      } catch (err) {
        // Wrap the registry's plain Error into a typed error for structured handling
        if (err instanceof Error && err.message.includes('already exists')) {
          throw new DuplicateContributionError(err.message, {
            pluginId: contribution.plugin,
            extensionPointId,
            contributionId: contribution.id,
            cause: err,
          });
        }
        throw err;
      }
    },

    removeContributions: (pluginId) => {
      EXTENSION_REGISTRY.removeContributions(pluginId);
    },

    ensureDevSharedDeps,
    validateExports: validatePluginExports,
    log: pluginServiceLogger,
  };
}
