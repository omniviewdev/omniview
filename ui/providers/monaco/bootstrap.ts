import 'monaco-editor';
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import { configureMonacoYaml } from 'monaco-yaml';

// Worker URLs — Vite bundles each worker and returns a file URL (no blob)
import editorWorkerUrl from 'monaco-editor/esm/vs/editor/editor.worker?worker&url';
import cssWorkerUrl from 'monaco-editor/esm/vs/language/css/css.worker?worker&url';
import htmlWorkerUrl from 'monaco-editor/esm/vs/language/html/html.worker?worker&url';
import jsonWorkerUrl from 'monaco-editor/esm/vs/language/json/json.worker?worker&url';
import tsWorkerUrl from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker&url';
// The pre-built yaml.worker.js from monaco-yaml has ~10 external bare imports
// (prettier, jsonc-parser, vscode-uri, yaml, etc.) that can't be resolved as
// ES modules in the wails:// protocol context. Use a pre-bundled version where
// all dependencies are inlined by esbuild.
import yamlWorkerUrl from './yaml.worker.bundle.js?url';

// Use our pre-configured Monaco instance everywhere
loader.config({ monaco });

const workerUrls: Record<string, string> = {
  editorWorkerService: editorWorkerUrl,
  css: cssWorkerUrl, less: cssWorkerUrl, scss: cssWorkerUrl,
  handlebars: htmlWorkerUrl, html: htmlWorkerUrl, razor: htmlWorkerUrl,
  json: jsonWorkerUrl,
  javascript: tsWorkerUrl, typescript: tsWorkerUrl,
  yaml: yamlWorkerUrl,
};

window.MonacoEnvironment = {
  getWorker(_, label) {
    const url = workerUrls[label] ?? editorWorkerUrl;
    return new Worker(url, { type: 'module' });
  },
};

// Store the MonacoYaml handle for dynamic schema updates
export const monacoYaml = configureMonacoYaml(monaco, {
  enableSchemaRequest: true,
  schemas: [],
});

export { monaco };
