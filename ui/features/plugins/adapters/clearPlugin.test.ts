import { afterEach, expect, test } from 'vitest';
import { systemJs } from '../api/systemjs';
import { clearPlugin } from './clearPlugin';

const base = `${window.location.protocol}//${window.location.host}/_/plugins/`;
const pluginId = 'upgrade-regression';
const root = `${base}${pluginId}/assets/`;
const unrelated = `${base}${pluginId}-other/assets/entry2.js`;

function registerGeneration(name: string, value: string): void {
  systemJs.register(`${root}entry2.js`, [], exportValue => ({
    execute() {
      exportValue(name, () => value);
    },
  }));
  systemJs.register(`${root}entry.js`, ['./entry2.js'], exportValue => {
    let render: () => string;
    return {
      setters: [module => {
        render = module[name] as () => string;
      }],
      execute() {
        exportValue('render', () => render());
      },
    };
  });
}

afterEach(async () => {
  await clearPlugin({ pluginId });
  systemJs.delete(unrelated);
});

test('an installed plugin upgrade executes new chunk exports without retiring another plugin', async () => {
  systemJs.set(unrelated, { singleton: true });
  registerGeneration('oldExport', 'old screen');
  const old = await systemJs.import(`${root}entry.js`);
  expect(old.render()).toBe('old screen');

  await clearPlugin({ pluginId });
  registerGeneration('newExport', 'updated screen');
  const updated = await systemJs.import(`${root}entry.js`);
  expect(updated.render()).toBe('updated screen');
  expect(systemJs.get(unrelated)?.singleton).toBe(true);
});
