import loader from '@monaco-editor/loader';
import 'monaco-editor';
import * as monaco from 'monaco-editor';
import { register } from './languages/nginx/register';

loader.config({ monaco });

await loader.init().then((monaco) => {
  register(monaco);
});
