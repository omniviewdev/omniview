import React, { useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { DiffEditor, type Monaco, type DiffOnMount } from '@monaco-editor/react';
import { registerOmniviewThemes, resolveEditorTheme } from './themes';
import { useThemeVariant } from '../theme';

export interface DiffViewerProps {
  original: string;
  modified: string;
  language?: string;
  layout?: 'sideBySide' | 'unified';
  readOnly?: boolean;
  /** Height of the editor area. Defaults to 300. Pass '100%' to fill parent. */
  height?: string | number;
  /** Monaco theme name. Defaults to 'omniview-dark'. */
  theme?: string;
  /** Enable word wrapping. */
  wordWrap?: boolean;
  /** Show line numbers. Defaults to true. */
  lineNumbers?: boolean;
  /** Show minimap. Defaults to false. */
  minimap?: boolean;
  /** Custom loading indicator shown while the editor initializes. */
  loading?: React.ReactNode;
  /** Callback when the diff editor mounts. Exposes the editor instance. */
  onMount?: DiffOnMount;
  sx?: SxProps<Theme>;
}

export default function DiffViewer({
  original,
  modified,
  language = 'yaml',
  layout = 'sideBySide',
  readOnly = true,
  height = 300,
  theme,
  wordWrap = false,
  lineNumbers = true,
  minimap = false,
  loading,
  onMount,
  sx,
}: DiffViewerProps) {
  const { variant, colorMode } = useThemeVariant();
  const handleBeforeMount = useCallback((monaco: Monaco) => {
    registerOmniviewThemes(monaco as unknown as typeof import('monaco-editor'));
  }, []);

  const resolvedTheme = resolveEditorTheme(variant, colorMode, theme);

  const additions = modified.split('\n').length - original.split('\n').length;
  const headerText =
    additions > 0
      ? `+${additions} lines`
      : additions < 0
        ? `${additions} lines`
        : 'No line count change';

  const isFill = height === '100%';

  const options = {
    readOnly,
    renderSideBySide: layout === 'sideBySide',
    minimap: { enabled: minimap },
    lineNumbers: lineNumbers ? 'on' as const : 'off' as const,
    wordWrap: wordWrap ? 'on' as const : 'off' as const,
    scrollBeyondLastLine: false,
    fontSize: 13,
    fontFamily: 'var(--ov-font-mono)',
    automaticLayout: true,
  };

  return (
    <Box
      sx={{
        border: '1px solid var(--ov-border-default)',
        borderRadius: '6px',
        overflow: 'hidden',
        ...(isFill ? { height: '100%', display: 'flex', flexDirection: 'column' } : {}),
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 0.75,
          bgcolor: 'var(--ov-bg-surface-inset)',
          borderBottom: '1px solid var(--ov-border-default)',
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--ov-fg-muted)' }}>
          Diff View ({layout === 'sideBySide' ? 'Side by Side' : 'Unified'})
        </Typography>
        <Typography variant="caption" sx={{ color: additions > 0 ? 'var(--ov-success)' : additions < 0 ? 'var(--ov-danger)' : 'var(--ov-fg-muted)' }}>
          {headerText}
        </Typography>
      </Box>
      {isFill ? (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <DiffEditor
            original={original}
            modified={modified}
            language={language}
            theme={resolvedTheme}
            beforeMount={handleBeforeMount}
            onMount={onMount}
            loading={loading}
            options={options}
            height="100%"
          />
        </Box>
      ) : (
        <DiffEditor
          original={original}
          modified={modified}
          language={language}
          theme={resolvedTheme}
          beforeMount={handleBeforeMount}
          onMount={onMount}
          loading={loading}
          options={options}
          height={height}
        />
      )}
    </Box>
  );
}

DiffViewer.displayName = 'DiffViewer';
