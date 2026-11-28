import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { fail, type Watch } from './data';
import { compileManifest } from './manifest';
import { moduleBytes } from './module';
import { authorConfig, checkAuthor } from './project';
import { StaticGraph } from './static';

export async function prepareExtensions(root: string, descriptor: string, development: boolean, watch: Watch): Promise<Map<string, string>> {
  const yaml = path.resolve(root, '../plugin.yaml');
  watch(yaml);
  const plugin = parse(readFileSync(yaml, 'utf8'), { uniqueKeys: true });
  if (typeof plugin?.id !== 'string') {
    fail('plugin.yaml: expected a string id');
  }

  const config = authorConfig(root, descriptor, watch);
  const graph = new StaticGraph(root, config.options, watch);
  const { json, roles } = compileManifest(plugin.id, graph.descriptor(descriptor), graph);
  for (const role of roles) {
    if (!existsSync(path.join(root, 'src', role.source))) {
      fail(`expected src/${role.source} for its declared offers`);
    }
  }

  const program = checkAuthor(root, config, graph.proofs, roles, watch);
  const assets = new Map([['extensions.v1.json', json]]);
  for (const role of roles) {
    assets.set(role.asset, await moduleBytes(root, role, program, development, watch));
  }

  return assets;
}
