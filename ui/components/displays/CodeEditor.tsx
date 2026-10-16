import { type FC, type RefObject, useEffect, useRef, useState } from 'react';
import Editor, { DiffEditor, useMonaco, loader } from '@monaco-editor/react';
import { useTheme } from '@omniviewdev/base-ui';
import { buildMonacoTheme, OV_MONACO_THEME } from '@omniviewdev/editors';
import { useSettings } from '@omniviewdev/runtime';

// Themes
import GithubDark from './themes/GithubDark';
import BrillianceBlack from './themes/BrillianceBlack';
import { orFallback } from '@/utils/orFallback';

type Props = {
  height?: string | number;
  language: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  diff?: boolean;
  original?: string;
};

export function useResolvedMonacoTheme(rootRef: RefObject<HTMLElement | null>): string {
  const { settings } = useSettings();
  const { activeTheme } = useTheme();
  const monaco = useMonaco();
  const configuredTheme = settings['editor.theme'] as string | undefined;
  const theme = configuredTheme === undefined
    || configuredTheme === 'application'
    || configuredTheme === 'default'
    ? OV_MONACO_THEME
    : configuredTheme;

  useEffect(() => {
    if (!monaco) {
      return;
    }

    monaco.editor.defineTheme('github-dark', GithubDark);
    monaco.editor.defineTheme('brilliance-black', BrillianceBlack);

    if (theme === OV_MONACO_THEME) {
      monaco.editor.defineTheme(
        OV_MONACO_THEME,
        buildMonacoTheme(activeTheme.base, rootRef.current),
      );
    }

    // Monaco themes are page-global, so reapply the selected theme whenever
    // the application theme changes.
    monaco.editor.setTheme(theme);
  }, [activeTheme, monaco, rootRef, theme]);

  return theme;
}

const CodeEditor: FC<Props> = ({ height, language, value, onChange, readOnly, diff, original }) => {
  // If uncontrolled, define our state control here
  const [controlledValue, setControlledValue] = useState(value);
  const monaco = useMonaco();
  const themeRootRef = useRef<HTMLDivElement>(null);
  const theme = useResolvedMonacoTheme(themeRootRef);

  /**
    * If we are using controlled, we need to handle the change event
    */
  const handleChange = (value: string) => {
    if (onChange) {
      onChange(value);
      return;
    }

    setControlledValue(value);
  };

  useEffect(() => {
    if (monaco) {
      void loader.init().then(monacoInstance => {
        monacoInstance.languages.typescript.javascriptDefaults.setEagerModelSync(true);
      });
    }
  }, [monaco]);

  const editor = diff && original
    ? (
      <DiffEditor
        original={original}
        modified={orFallback(value, controlledValue)}
        language={language}
        theme={theme}
        options={{ readOnly }}
      />
    )
    : (
      <Editor
        language={language}
        value={orFallback(value, controlledValue)}
        theme={theme}
        onChange={value => {
          handleChange(value ?? '');
        }}
        options={{ readOnly }}
      />
    );

  return (
    <div ref={themeRootRef} style={{ display: 'contents', height }}>
      {editor}
    </div>
  );
};

export default CodeEditor;
