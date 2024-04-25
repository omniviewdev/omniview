import 'monaco-editor';
import * as monaco from 'monaco-editor';
import { configureMonacoYaml } from 'monaco-yaml';

// workers
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import CSSWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HTMLWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JSONWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import YamlWorker from 'monaco-yaml/yaml.worker?worker';

//
// loader.config({ monaco });
//
// await loader.init().then((monaco) => {
//   register(monaco);
//   console.log('Monaco has been initialized');
// });

window.MonacoEnvironment = {
  getWorker(_, label) {
    switch (label) {
      case 'editorWorkerService':
        return new EditorWorker();
      case 'css':
      case 'less':
      case 'scss':
        return new CSSWorker();
      case 'handlebars':
      case 'html':
      case 'razor':
        return new HTMLWorker();
      case 'json':
        return new JSONWorker();
      case 'javascript':
      case 'typescript':
        return new TypeScriptWorker();
      case 'yaml':
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
      fileMatch: ['**/apps::v1::Deployment/*.yaml'],
      uri: 'https://kubernetesjsonschema.dev/v1.14.0/deployment-apps-v1.json',
    },
    {
      fileMatch: ['**/apps::v1::StatefulSet/*.yaml'],
      uri: 'https://kubernetesjsonschema.dev/v1.14.0/statefulset-apps-v1.json',
    },
  ],
});
