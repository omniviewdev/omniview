import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

interface Catalog {
  parts: Record<string, { examples: { group: string; name: string }[] }>;
}

/** Materialize static CSF exports before Storybook indexes the workshop. */
export function writeStories(docs: URL) {
  const catalog: Catalog = JSON.parse(readFileSync(new URL('public/catalog.json', docs), 'utf8'));
  const groups = new Map<string, string[]>();
  for (const { examples } of Object.values(catalog.parts)) {
    for (const { group, name } of examples) {
      const names = groups.get(group);
      if (names) names.push(name);
      else groups.set(group, [name]);
    }
  }

  const output = new URL('stories/generated/', docs);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const [group, names] of groups) {
    const exports = names.map((name) => (
      `export const ${name} = { render: groups[${JSON.stringify(group)}][${JSON.stringify(name)}] } satisfies Story;`
    ));
    const layout = group === 'Button' ? ', parameters: { layout: "centered" }' : '';
    writeFileSync(new URL(`${group}.stories.ts`, output), [
      '// Generated from public/catalog.json. Do not edit.',
      "import type { Meta, StoryObj } from '@storybook/react-vite';",
      "import { groups } from '../../content/registry.ts';",
      '',
      `const meta = { title: ${JSON.stringify(`Kit/${group}`)}${layout} } satisfies Meta;`,
      'export default meta;',
      'type Story = StoryObj<typeof meta>;',
      '',
      ...exports,
      '',
    ].join('\n'));
  }
}
