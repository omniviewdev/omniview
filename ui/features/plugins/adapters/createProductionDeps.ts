import { EXTENSION_REGISTRY } from '@/features/extensions/store';
import { ensureBuiltinExtensionPointsRegistered } from '@/features/extensions/registerBuiltinExtensionPoints';
import { Events } from '@omniviewdev/runtime/runtime';
import { observeFrontendOperation } from '@omniviewdev/runtime';
import { DevServerManager, PluginManager } from '@omniviewdev/runtime/api';
import { DevProcessStatus } from '@omniviewdev/runtime/models';
import { validatePluginExports } from '../core/validation';
import { MissingExtensionPointError, DuplicateContributionError } from '../core/errors';
import { InMemoryCrashDataStrategy } from '../core/CrashDataService';
import type { PluginDescriptor, PluginServiceDeps, PluginServiceConfig } from '../core/types';
import { DEFAULT_CONFIG } from '../core/types';
import { importPlugin } from './importPlugin';
import { clearPlugin } from './clearPlugin';
import { ensureDevSharedDeps } from './devSharedDeps';
import { builtinRoutes, createPluginModuleResolver } from './builtinModules';

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

  const builtinIds = new Set<string>();
  const getPluginDescriptor = async (pluginId: string): Promise<PluginDescriptor> => {
    const plugin = await PluginManager.GetPlugin(pluginId);
    if (plugin.origin === 'builtin') {
      builtinIds.add(pluginId);
      return { id: pluginId, dev: false, origin: 'builtin', frontendModule: plugin.frontendModule, enabled: plugin.enabled };
    }

    builtinIds.delete(pluginId);
    if (!plugin.devMode) {
      return { id: pluginId, dev: false, origin: 'external', enabled: plugin.enabled };
    }

    const server = await DevServerManager.GetDevServerState(pluginId);
    if (server?.viteStatus !== DevProcessStatus.DevProcessStatusReady || server.vitePort <= 0) {
      throw new Error(`Development server for plugin "${pluginId}" is not ready`);
    }

    return { id: pluginId, dev: true, devPort: server.vitePort, origin: 'external', enabled: plugin.enabled };
  };

  return {
    crashData,
    getPluginDescriptor,
    getBuiltinRoutes: builtinRoutes,
    setPluginEnabled: async (id, enabled) => {
      await PluginManager.SetPluginEnabled(id, enabled);
    },
    importPlugin: createPluginModuleResolver({
      getDescriptor: getPluginDescriptor,
      activateBackend: async (id) => observeFrontendOperation('frontend.plugin.activate', { plugin_id: id }, PluginManager.LoadPlugin(id, null)),
      importExternal: importPlugin,
    }),
    clearPlugin: async (opts) => builtinIds.has(opts.pluginId) ? Promise.resolve() : clearPlugin(opts),

    onEvent: (eventName, handler) => {
      // Events.On returns () => void — use it for proper cleanup.
      return Events.On(eventName, (ev) => {
        handler(ev.data); 
      });
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
