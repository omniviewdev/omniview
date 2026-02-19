import { useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { DiffEditor, type Monaco } from '@monaco-editor/react';
import { registerOmniviewThemes } from './themes';

export interface DiffViewerProps {
  original: string;
  modified: string;
  language?: string;
  layout?: 'sideBySide' | 'unified';
  readOnly?: boolean;
  sx?: SxProps<Theme>;
}

export default function DiffViewer({
  original,
  modified,
  language = 'yaml',
  layout = 'sideBySide',
  readOnly = true,
  sx,
}: DiffViewerProps) {
  const handleBeforeMount = useCallback((monaco: Monaco) => {
    registerOmniviewThemes(monaco as unknown as typeof import('monaco-editor'));
  }, []);

  const additions = modified.split('\n').length - original.split('\n').length;
  const headerText =
    additions > 0
      ? `+${additions} lines`
      : additions < 0
        ? `${additions} lines`
        : 'No line count change';

  return (
    <Box
      sx={{
        border: '1px solid var(--ov-border-default)',
        borderRadius: '6px',
        overflow: 'hidden',
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
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--ov-fg-muted)' }}>
          Diff View ({layout === 'sideBySide' ? 'Side by Side' : 'Unified'})
        </Typography>
        <Typography variant="caption" sx={{ color: additions > 0 ? 'var(--ov-success)' : additions < 0 ? 'var(--ov-danger)' : 'var(--ov-fg-muted)' }}>
          {headerText}
        </Typography>
      </Box>
      <DiffEditor
        original={original}
        modified={modified}
        language={language}
        theme="omniview-dark"
        beforeMount={handleBeforeMount}
        options={{
          readOnly,
          renderSideBySide: layout === 'sideBySide',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: 'var(--ov-font-mono)',
          automaticLayout: true,
        }}
        height={300}
      />
    </Box>
  );
}

DiffViewer.displayName = 'DiffViewer';
