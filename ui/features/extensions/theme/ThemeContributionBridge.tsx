import { useEffect, useRef } from 'react';
import {
  ThemeValidationError,
  type ThemeRegistry,
} from '@omniviewdev/base-ui';
import {
  useExtensionPoint,
  type ExtensionContributionRegistration,
} from '@omniviewdev/runtime';

import {
  THEME_EXTENSION_POINT_ID,
  type ThemeContribution,
} from './extensionPoint';

type ActiveThemeRegistration = {
  registration: ExtensionContributionRegistration<ThemeContribution>;
  registry: ThemeRegistry;
  dispose: () => void;
};

export interface ThemeContributionBridgeProps {
  registry: ThemeRegistry;
}

function registrationKey(
  registration: ExtensionContributionRegistration<ThemeContribution>,
): string {
  return `${registration.plugin}\0${registration.id}`;
}

function themeIdFor(
  registration: ExtensionContributionRegistration<ThemeContribution>,
): string {
  const normalizedPrefix = `${registration.plugin}/`;
  const localContributionId = registration.id.startsWith(normalizedPrefix)
    ? registration.id.slice(normalizedPrefix.length)
    : registration.id;

  return `plugin:${encodeURIComponent(registration.plugin)}/${encodeURIComponent(localContributionId)}`;
}

export function ThemeContributionBridge({
  registry,
}: ThemeContributionBridgeProps): null {
  const store = useExtensionPoint<ThemeContribution>(THEME_EXTENSION_POINT_ID);
  const storeVersion = store?.version;
  const activeRef = useRef<Map<string, ActiveThemeRegistration> | null>(null);
  if (activeRef.current === null) {
    activeRef.current = new Map();
  }
  const activeRegistrations = activeRef.current;

  useEffect(() => {
    const registrations = store?.listAll() ?? [];
    const currentByKey = new Map<string, ExtensionContributionRegistration<ThemeContribution>>();

    for (const registration of registrations) {
      currentByKey.set(registrationKey(registration), registration);
    }

    for (const [key, active] of activeRegistrations) {
      const current = currentByKey.get(key);
      if (current !== active.registration || active.registry !== registry) {
        active.dispose();
        activeRegistrations.delete(key);
      }
    }

    for (const registration of registrations) {
      const key = registrationKey(registration);
      if (activeRegistrations.has(key)) {
        continue;
      }

      const themeId = themeIdFor(registration);
      try {
        const dispose = registry.register(
          { ...registration.value, id: themeId },
          { kind: 'plugin', id: registration.plugin },
        );
        activeRegistrations.set(key, { registration, registry, dispose });
      } catch (error) {
        if (!(error instanceof ThemeValidationError)) {
          throw error;
        }

        console.error('[ThemeContributionBridge] Invalid theme contribution', {
          pluginId: registration.plugin,
          contributionId: registration.id,
          themeId,
          code: error.code,
          path: error.path,
          error,
        });
      }
    }
  }, [activeRegistrations, registry, store, storeVersion]);

  useEffect(() => () => {
    for (const active of activeRegistrations.values()) {
      active.dispose();
    }
    activeRegistrations.clear();
  }, [activeRegistrations]);

  return null;
}
