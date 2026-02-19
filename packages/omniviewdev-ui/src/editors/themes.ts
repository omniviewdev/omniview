import type { editor } from 'monaco-editor';

export const omniviewDark: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'c9d1d9' },
    { token: 'comment', foreground: '6e7681', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff7b72' },
    { token: 'string', foreground: 'a5d6ff' },
    { token: 'number', foreground: '79c0ff' },
    { token: 'type', foreground: 'ffa657' },
    { token: 'variable', foreground: 'ffa657' },
    { token: 'constant', foreground: '79c0ff' },
    { token: 'function', foreground: 'd2a8ff' },
    { token: 'operator', foreground: 'ff7b72' },
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#c9d1d9',
    'editor.lineHighlightBackground': '#161b22',
    'editor.selectionBackground': '#264f78',
    'editorCursor.foreground': '#58a6ff',
    'editorLineNumber.foreground': '#484f58',
    'editorLineNumber.activeForeground': '#c9d1d9',
    'editor.inactiveSelectionBackground': '#1c3050',
    'editorIndentGuide.background': '#21262d',
    'editorIndentGuide.activeBackground': '#30363d',
  },
};

export const omniviewLight: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '24292f' },
    { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cf222e' },
    { token: 'string', foreground: '0a3069' },
    { token: 'number', foreground: '0550ae' },
    { token: 'type', foreground: '953800' },
    { token: 'variable', foreground: '953800' },
    { token: 'constant', foreground: '0550ae' },
    { token: 'function', foreground: '8250df' },
    { token: 'operator', foreground: 'cf222e' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#24292f',
    'editor.lineHighlightBackground': '#f6f8fa',
    'editor.selectionBackground': '#add6ff80',
    'editorCursor.foreground': '#0969da',
    'editorLineNumber.foreground': '#8c959f',
    'editorLineNumber.activeForeground': '#24292f',
    'editor.inactiveSelectionBackground': '#add6ff40',
    'editorIndentGuide.background': '#d8dee4',
    'editorIndentGuide.activeBackground': '#afb8c1',
  },
};

export function registerOmniviewThemes(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme('omniview-dark', omniviewDark);
  monaco.editor.defineTheme('omniview-light', omniviewLight);
}
