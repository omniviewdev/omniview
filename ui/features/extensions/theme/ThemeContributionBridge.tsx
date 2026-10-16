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

export type ThemeContributionBridgeProps = {
  registry: ThemeRegistry;
};

function registrationKey(
  registration: ExtensionContributionRegistration<ThemeContribution>,
): string {
  return `${registration.plugin}\0${registration.id}`;
}

function encodeThemeIdSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function themeIdFor(
  registration: ExtensionContributionRegistration<ThemeContribution>,
): string {
  const normalizedPrefix = `${registration.plugin}/`;
  const localContributionId = registration.id.startsWith(normalizedPrefix)
    ? registration.id.slice(normalizedPrefix.length)
    : registration.id;

  return `plugin:${encodeThemeIdSegment(registration.plugin)}/${encodeThemeIdSegment(localContributionId)}`;
}

export function ThemeContributionBridge({
  registry,
}: ThemeContributionBridgeProps): null {
  const store = useExtensionPoint<ThemeContribution>(THEME_EXTENSION_POINT_ID);
  const storeVersion = store?.version;
  const activeRef = useRef<Map<string, ActiveThemeRegistration> | null>(null);
  activeRef.current ??= new Map();

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

      let themeId: string | undefined;
      try {
        themeId = themeIdFor(registration);
        const dispose = registry.register(
          { ...registration.value, id: themeId },
          { kind: 'plugin', id: registration.plugin },
        );
        activeRegistrations.set(key, { registration, registry, dispose });
      } catch (error) {
        const validationError = error instanceof ThemeValidationError;
        if (!validationError && !(error instanceof URIError)) {
          throw error;
        }

        console.error('[ThemeContributionBridge] Invalid theme contribution', {
          pluginId: registration.plugin,
          contributionId: registration.id,
          themeId,
          code: validationError ? error.code : 'invalid_id',
          path: validationError ? error.path : 'id',
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
