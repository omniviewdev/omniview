import { type FC, useEffect, useState } from "react";
import Editor, { DiffEditor, useMonaco, loader } from "@monaco-editor/react";

// Themes
import GithubDark from "./themes/GithubDark";
import BrillianceBlack from "./themes/BrillianceBlack";

type Props = {
  height?: string | number;
  language?: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  diff?: boolean;
  original?: string;
};

const CodeEditor: FC<Props> = ({
  language,
  value,
  onChange,
  readOnly,
  diff,
  original,
}) => {
  // If uncontrolled, define our state control here
  const [controlledValue, setControlledValue] = useState(value);
  const monaco = useMonaco();

  useEffect(() => {
    if (monaco) {
      // Define all of our themes
      monaco.editor.defineTheme("github-dark", GithubDark);
      monaco.editor.defineTheme("brilliance-black", BrillianceBlack);
      monaco.editor.setTheme("brilliance-black");
    }
  }, [monaco]);

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
      loader.init().then((monacoInstance) => {
        monacoInstance.languages.typescript.javascriptDefaults.setEagerModelSync(
          true,
        );
      });
    }
  }, [monaco]);

  if (diff && original) {
    return (
      <DiffEditor
        original={original}
        modified={value || controlledValue}
        language={language}
        options={{ readOnly }}
      />
    );
  }

  return (
    <Editor
      theme="brilliance-black"
      language={language}
      value={value || controlledValue}
      onChange={(value) => {
        handleChange(value || "");
      }}
      height="60vh"
      options={{ readOnly }}
    />
  );
};

export default CodeEditor;
