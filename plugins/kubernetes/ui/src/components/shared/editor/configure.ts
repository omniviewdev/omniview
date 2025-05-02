import * as monaco from "monaco-editor";
import { configureMonacoYaml } from "monaco-yaml";

window.MonacoEnvironment = {
  getWorker(_, label) {
    switch (label) {
      case 'editorWorkerService':
        return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url))
      case 'css':
      case 'less':
      case 'scss':
        return new Worker(new URL('monaco-editor/esm/vs/language/css/css.worker', import.meta.url))
      case 'handlebars':
      case 'html':
      case 'razor':
        return new Worker(
          new URL('monaco-editor/esm/vs/language/html/html.worker', import.meta.url)
        )
      case 'json':
        return new Worker(
          new URL('monaco-editor/esm/vs/language/json/json.worker', import.meta.url)
        )
      case 'javascript':
      case 'typescript':
        return new Worker(
          new URL('monaco-editor/esm/vs/language/typescript/ts.worker', import.meta.url)
        )
      case 'yaml':
        return new Worker(new URL('monaco-yaml/yaml.worker', import.meta.url))
      default:
        throw new Error(`Unknown label ${label}`)
    }
  }
}

configureMonacoYaml(monaco, {
  enableSchemaRequest: true,
  schemas: [
    {
      // If YAML file is opened matching this glob
      fileMatch: ['**/.prettierrc.*'],
      // Then this schema will be downloaded from the internet and used.
      uri: 'https://json.schemastore.org/prettierrc.json'
    },
  ],
});

interface RegisterModelOpts {
  /** The gvr key of the resource */
  key: string;
  /** The ID of the resource itself */
  id: string;
  /** The namespace of the resource */
  namespace: string;
  /** The data of the resource */
  data: string;
}

/**
 * Register a model with the editor, returning if it already exists
 */
export const registerModel = (opts: RegisterModelOpts) => {
  const uri = monaco.Uri.parse(`file:///${opts.key}/${opts.id}.yaml`);
  if (monaco.editor.getModel(uri)) {
    return;
  }

  monaco.editor.createModel(
    opts.data,
    undefined,
    monaco.Uri.parse(`file:///${opts.key}/${opts.id}.yaml`)
  );
};

/**
 * Dispose of a model in the editor. Should be called in cleanup
 */
export const disposeModel = (opts: RegisterModelOpts) => {
  const model = monaco.editor.getModel(
    monaco.Uri.parse(`file:///${opts.key}/${opts.id}.yaml`)
  );
  if (model) {
    model.dispose();
  }
};

//
// const editor = monaco.editor.create(document.getElementById('editor'), {
//   automaticLayout: true,
//   model: prettierc,
//   quickSuggestions: {
//     other: true,
//     comments: false,
//     strings: true
//   }
// })
//
// const select = document.getElementById('model')
// select.addEventListener('change', () => {
//   editor.setModel(monaco.editor.getModel(monaco.Uri.parse(select.value)))
// })
