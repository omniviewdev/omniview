import { useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { registerOmniviewThemes } from './themes';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  minimap?: boolean;
  lineNumbers?: boolean;
  wordWrap?: boolean;
  maxHeight?: number | string;
  theme?: string;
  onSave?: (value: string) => void;
  sx?: SxProps<Theme>;
}

export default function CodeEditor({
  value,
  onChange,
  language = 'yaml',
  readOnly = false,
  minimap = false,
  lineNumbers = true,
  wordWrap = false,
  maxHeight,
  theme,
  onSave,
  sx,
}: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    registerOmniviewThemes(monaco as unknown as typeof import('monaco-editor'));
  }, []);

  const handleMount: OnMount = useCallback(
    (ed, monaco) => {
      editorRef.current = ed;

      if (onSave) {
        ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          onSave(ed.getValue());
        });
      }
    },
    [onSave],
  );

  const resolvedTheme = theme ?? 'omniview-dark';

  return (
    <Box
      sx={{
        border: '1px solid var(--ov-border-default)',
        borderRadius: '6px',
        overflow: 'hidden',
        maxHeight,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      }}
    >
      <Editor
        value={value}
        onChange={(v) => onChange?.(v ?? '')}
        language={language}
        theme={resolvedTheme}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: minimap },
          lineNumbers: lineNumbers ? 'on' : 'off',
          wordWrap: wordWrap ? 'on' : 'off',
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: 'var(--ov-font-mono)',
          tabSize: 2,
          renderLineHighlight: 'line',
          automaticLayout: true,
          padding: { top: 8, bottom: 8 },
        }}
        height={typeof maxHeight === 'number' ? maxHeight : maxHeight ?? 300}
      />
    </Box>
  );
}

CodeEditor.displayName = 'CodeEditor';
