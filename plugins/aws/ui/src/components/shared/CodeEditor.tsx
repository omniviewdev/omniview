import { type FC, useEffect, useState } from "react";
import Editor, { DiffEditor, useMonaco } from "@monaco-editor/react";

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
  const [controlledValue, setControlledValue] = useState(value);
  const monaco = useMonaco();
  const [lang, setLang] = useState<string | undefined>(language);

  useEffect(() => {
    if (monaco) {
      // themes can be added here if desired
    }
    async function detectLanguage() {
      try {
        /* @ts-expect-error - global helper on the window object */
        const detected = await window.detectLanguage({
          filename,
          contents: value,
        });
        if (detected) {
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
        theme="vs-dark"
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
        theme="vs-dark"
        language={lang}
        value={
          lang === "json"
            ? JSON.stringify(JSON.parse(value), null, 2)
            : value || controlledValue
        }
        onChange={(value) => {
          handleChange(value || "");
        }}
        height={height ?? "100%"}
        options={{ readOnly, fontSize: 11 }}
      />
    );
  }
};

export default CodeEditor;
