import { build } from 'esbuild';

await build({
  entryPoints: ['node_modules/monaco-yaml/yaml.worker.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: process.env.OMNIVIEW_YAML_WORKER_OUTPUT_FILE || 'ui/providers/monaco/yaml.worker.bundle.js',
  logLevel: 'info',
});
