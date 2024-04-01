import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { configureMonacoYaml } from "monaco-yaml";
import YamlWorker from "monaco-yaml/yaml.worker?worker";

window.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    switch (label) {
      case "editorWorkerService":
        return new EditorWorker();
      case "yaml":
        return new YamlWorker();
      default:
        throw new Error(`Unknown label ${label}`);
    }
  },
};

configureMonacoYaml(monaco, {
  enableSchemaRequest: true,
  schemas: [
    {
      // If YAML file is opened matching this glob
      fileMatch: ["**/person.yaml"],
      // The following schema will be applied
      schema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The person’s display name",
          },
          age: {
            type: "integer",
            description: "How old is the person in years?",
          },
          occupation: {
            enum: ["Delivery person", "Software engineer", "Astronaut"],
          },
        },
      },
      // And the following URI will be linked to as the source.
      uri: "https://github.com/remcohaszing/monaco-yaml#usage",
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
