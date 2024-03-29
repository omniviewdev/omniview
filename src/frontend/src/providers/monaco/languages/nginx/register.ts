import type * as monaco from 'monaco-editor';
import { themeConfig, themeDarkConfig, tokenConf } from './conf';
import suggestions from './suggestions';
import directives from './directives.json';

export const register = (instance: typeof monaco) => {
// Register a new language
  instance.languages.register({
    id: 'nginx',
  });
  instance.languages.setMonarchTokensProvider('nginx', tokenConf);
  instance.editor.defineTheme('nginx-theme', themeConfig);
  instance.editor.defineTheme('nginx-theme-dark', themeDarkConfig);

  instance.languages.registerCompletionItemProvider('nginx', {
    provideCompletionItems: (model: monaco.editor.ITextModel, position: monaco.Position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return { suggestions: suggestions(range) };
    },
  });

  instance.languages.registerHoverProvider('nginx', {
    provideHover: (model: monaco.editor.ITextModel, position: monaco.Position, _token: monaco.CancellationToken) => {
      const word = model.getWordAtPosition(position);
      if (!word) return;
      const data = directives.find((item) => item.n === word.word || item.n === `$${word.word}`);
      if (!data) return;
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const contents = [{ value: `**\`${data.n}\`** | ${data.m} | ${data.c ?? ''}` }];
      if (data.s) {
        contents.push({ value: `**syntax:** ${data.s || ''}` });
      }

      if (data.v) {
        contents.push({ value: `**default:** ${data.v || ''}` });
      }

      if (data.d) {
        contents.push({ value: `${data.d}` });
      }

      return {
        contents: [...contents],
        range: range,
      };
    },
  });
};
