import React, { useEffect } from 'react';
import { useColorScheme } from '@mui/material/styles';
import { ThemeProvider, useTheme as useBaseUiTheme } from '@omniviewdev/base-ui';

type ResolvedMode = 'light' | 'dark';

function useResolvedMuiMode(): ResolvedMode {
  const { mode, systemMode } = useColorScheme();
  const resolved = mode === 'system' ? systemMode : mode;
  return resolved === 'light' ? 'light' : 'dark';
}

/**
 * Keeps base-ui's theme in step with MUI's color scheme. MUI's mode (driven by
 * AppTheme's `defaultMode`) is the canonical store; base-ui persistence is off.
 */
function ColorModeBridge() {
  const mode = useResolvedMuiMode();
  const { theme, setTheme } = useBaseUiTheme();

  useEffect(() => {
    if (theme !== mode) {
      setTheme(mode);
    }
  }, [mode, theme, setTheme]);

  return null;
}

/**
 * Mounts the @omniviewdev/base-ui ThemeProvider inside the legacy MUI AppTheme
 * during the migration (omn-55to). Must be rendered inside AppTheme.
 *
 * base-ui owns the `data-ov-theme`, `data-ov-density` and `data-ov-motion`
 * attributes on <html>; the legacy theme uses `data-ovl-theme`. Theme variants
 * (solarized) are not ported yet, so base-ui shows plain dark/light for them.
 */
export default function BaseUiTheme({ children }: { children: React.ReactNode }) {
  const mode = useResolvedMuiMode();

  return (
    <ThemeProvider initialTheme={mode} initialDensity="compact" persist={false}>
      <ColorModeBridge />
      {children}
    </ThemeProvider>
  );
}
