import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ThemeProvider,
  themeRegistry,
  useTheme,
  type ThemeSummary,
} from '@omniviewdev/base-ui';
import {
  showAppError,
  useSettings,
  useSnackbar,
  useScopedSettings,
  HOST_SETTINGS_SCOPE,
} from '@omniviewdev/runtime';

import { ThemeContributionBridge } from '@/features/extensions/theme/ThemeContributionBridge';

import {
  clearLegacyThemeKeys,
  readBootstrapTheme,
  writeBootstrapTheme,
} from './themeBootstrap';

const THEME_SETTING_ID = 'appearance.theme';

export type AppThemeContextValue = {
  requestedThemeId: string;
  activeTheme: Readonly<ThemeSummary>;
  isFallback: boolean;
  selectTheme: (id: string) => Promise<void>;
};

export const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function normalizeThemeId(id: string): string {
  if (id === 'default') {
    return 'void';
  }

  if (id === 'solarized') {
    return 'solarized-dark';
  }

  return id;
}

export function useAppTheme(): AppThemeContextValue {
  const value = useContext(AppThemeContext);
  if (value === null) {
    throw new Error('useAppTheme must be used within AppThemeController');
  }

  return value;
}

type ThemeStateBridgeProps = {
  children: ReactNode;
  selectTheme: (id: string) => Promise<void>;
};

function ThemeStateBridge({ children, selectTheme }: ThemeStateBridgeProps) {
  const { requestedThemeId, activeTheme, isFallback } = useTheme();
  const value = useMemo<AppThemeContextValue>(
    () => ({ requestedThemeId, activeTheme, isFallback, selectTheme }),
    [requestedThemeId, activeTheme, isFallback, selectTheme],
  );

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}

export default function AppThemeController({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const { commit } = useScopedSettings(HOST_SETTINGS_SCOPE);
  const { showSnackbar } = useSnackbar();
  const [storage] = useState<Storage | null>(() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  });
  const [requestedThemeId, setRequestedThemeId] = useState<string>(() => (
    storage === null ? 'void' : readBootstrapTheme(storage)
  ));
  const requestedThemeIdRef = useRef<string>(requestedThemeId);
  const durableThemeIdRef = useRef<string>(requestedThemeId);
  const latestSelectionRef = useRef(0);
  const settledSelectionRef = useRef(0);
  const persistenceQueueRef = useRef<Promise<void> | null>(null);

  const configuredTheme = settings[THEME_SETTING_ID];
  const backendThemeId = typeof configuredTheme === 'string'
    ? normalizeThemeId(configuredTheme)
    : null;

  useEffect(() => {
    if (backendThemeId === null) {
      return;
    }

    // Hydration is authoritative even while an optimistic selection is
    // pending. Keep it as the durable rollback target, then apply it once no
    // selection is in flight.
    durableThemeIdRef.current = backendThemeId;
    if (settledSelectionRef.current !== latestSelectionRef.current) {
      return;
    }

    requestedThemeIdRef.current = backendThemeId;
    setRequestedThemeId((current) => (
      current === backendThemeId ? current : backendThemeId
    ));

    if (storage !== null) {
      writeBootstrapTheme(storage, backendThemeId);
      clearLegacyThemeKeys(storage);
    }
  }, [backendThemeId, storage]);

  const selectTheme = useCallback(async (selectedId: string): Promise<void> => {
    const nextId = normalizeThemeId(selectedId);
    const selection = latestSelectionRef.current + 1;
    latestSelectionRef.current = selection;
    requestedThemeIdRef.current = nextId;
    setRequestedThemeId(nextId);

    const persist = async (): Promise<void> => {
      try {
        const result = await commit({ [THEME_SETTING_ID]: nextId });
        durableThemeIdRef.current = nextId;
        if (storage !== null) {
          writeBootstrapTheme(storage, nextId);
        }

        if (!result.applied || result.uncertain) {
          showSnackbar(result.message || 'Theme saved, but could not be applied completely.', 'warning');
        }
      } catch (error) {
        showAppError(showSnackbar, error, 'Failed to save theme');
      } finally {
        settledSelectionRef.current = selection;
        if (selection === latestSelectionRef.current) {
          const durableThemeId = durableThemeIdRef.current;
          requestedThemeIdRef.current = durableThemeId;
          setRequestedThemeId(durableThemeId);
          if (storage !== null) {
            writeBootstrapTheme(storage, durableThemeId);
          }
        }
      }
    };

    const queued = persistenceQueueRef.current;
    const persistence = queued === null
      ? persist()
      : queued.then(persist, persist);
    persistenceQueueRef.current = persistence;
    await persistence;
  }, [commit, showSnackbar, storage]);

  return (
    <ThemeProvider
      themeId={requestedThemeId}
      fallbackThemeId="void"
      onThemeChange={(id) => {
        selectTheme(id).catch(() => undefined);
      }}
      initialDensity="compact"
      registry={themeRegistry}
    >
      <ThemeContributionBridge registry={themeRegistry} />
      <ThemeStateBridge selectTheme={selectTheme}>
        {children}
      </ThemeStateBridge>
    </ThemeProvider>
  );
}
