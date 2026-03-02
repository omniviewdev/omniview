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

// ---------------------------------------------------------------------------
// Solarized (Ethan Schoonover)
// ---------------------------------------------------------------------------

export const solarizedDark: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: '839496' },
    { token: 'comment', foreground: '586e75', fontStyle: 'italic' },
    { token: 'keyword', foreground: '859900' },
    { token: 'string', foreground: '2aa198' },
    { token: 'number', foreground: 'd33682' },
    { token: 'type', foreground: 'b58900' },
    { token: 'variable', foreground: 'b58900' },
    { token: 'constant', foreground: 'cb4b16' },
    { token: 'function', foreground: '268bd2' },
    { token: 'operator', foreground: '859900' },
  ],
  colors: {
    'editor.background': '#002b36',
    'editor.foreground': '#839496',
    'editor.lineHighlightBackground': '#073642',
    'editor.selectionBackground': '#073642',
    'editorCursor.foreground': '#268bd2',
    'editorLineNumber.foreground': '#586e75',
    'editorLineNumber.activeForeground': '#93a1a1',
    'editor.inactiveSelectionBackground': '#073642aa',
    'editorIndentGuide.background': '#073642',
    'editorIndentGuide.activeBackground': '#586e75',
  },
};

export const solarizedLight: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '657b83' },
    { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
    { token: 'keyword', foreground: '859900' },
    { token: 'string', foreground: '2aa198' },
    { token: 'number', foreground: 'd33682' },
    { token: 'type', foreground: 'b58900' },
    { token: 'variable', foreground: 'b58900' },
    { token: 'constant', foreground: 'cb4b16' },
    { token: 'function', foreground: '268bd2' },
    { token: 'operator', foreground: '859900' },
  ],
  colors: {
    'editor.background': '#fdf6e3',
    'editor.foreground': '#657b83',
    'editor.lineHighlightBackground': '#eee8d5',
    'editor.selectionBackground': '#eee8d5',
    'editorCursor.foreground': '#268bd2',
    'editorLineNumber.foreground': '#93a1a1',
    'editorLineNumber.activeForeground': '#586e75',
    'editor.inactiveSelectionBackground': '#eee8d5aa',
    'editorIndentGuide.background': '#eee8d5',
    'editorIndentGuide.activeBackground': '#93a1a1',
  },
};

export const MONACO_THEME_NAMES = {
  omniviewDark: 'omniview-dark',
  omniviewLight: 'omniview-light',
  solarizedDark: 'solarized-dark',
  solarizedLight: 'solarized-light',
} as const;

export function registerOmniviewThemes(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme(MONACO_THEME_NAMES.omniviewDark, omniviewDark);
  monaco.editor.defineTheme(MONACO_THEME_NAMES.omniviewLight, omniviewLight);
  monaco.editor.defineTheme(MONACO_THEME_NAMES.solarizedDark, solarizedDark);
  monaco.editor.defineTheme(MONACO_THEME_NAMES.solarizedLight, solarizedLight);
}
