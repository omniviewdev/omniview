import { type FC, useEffect, useState } from "react";
import Editor, { DiffEditor, useMonaco } from "@monaco-editor/react";

// Themes
import GithubDark from "./themes/GithubDark";
import BrillianceBlack from "./themes/BrillianceBlack";

type Props = {
  filename: string;
  height?: string | number;
  language?: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  diff?: boolean;
  original?: string;
};

const CodeEditor: FC<Props> = ({
  height,
  language,
  filename,
  value,
  onChange,
  readOnly,
  diff,
  original,
}) => {
  // If uncontrolled, define our state control here
  const [controlledValue, setControlledValue] = useState(value);
  const monaco = useMonaco();
  const [lang, setLang] = useState<string | undefined>(language);

  useEffect(() => {
    if (monaco) {
      // Define all of our themes
      monaco.editor.defineTheme("github-dark", GithubDark);
      monaco.editor.defineTheme("brilliance-black", BrillianceBlack);
    }

    async function detectLanguage() {
      try {
        /* @ts-expect-error - global helper on the window object */
        const detected = await window.detectLanguage({
          filename,
          contents: value,
        });
        if (detected) {
          console.log("Detected language", detected);
          setLang(detected);
        }
      } catch (err) {
        console.error("Failed to detect language", err);
      }
    }

    if (!lang) {
      detectLanguage().catch(console.error);
    }
  }, [monaco, filename, value, lang]);

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

  if (diff && original && lang) {
    return (
      <DiffEditor
        theme={lang === "nginx" ? "nginx-theme-dark" : "vs-dark"}
        language={lang}
        original={original}
        modified={value || controlledValue}
        height={height ?? "100%"}
        options={{ readOnly, fontSize: 11 }}
      />
    );
  }

  if (lang) {
    return (
      <Editor
        theme={lang === "nginx" ? "nginx-theme-dark" : "vs-dark"}
        language={lang}
        value={
          lang === "json"
            ? // pretty print it
            JSON.stringify(JSON.parse(value), null, 2)
            : value || controlledValue
        }
        onChange={(value) => {
          handleChange(value || "");
        }}
        options={{ readOnly, fontSize: 11 }}
      />
    );
  }
};

export default CodeEditor;
