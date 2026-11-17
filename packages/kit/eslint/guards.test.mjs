// @vitest-environment node
import { createRequire } from 'node:module';
import path from 'node:path';
import tsParser from '@typescript-eslint/parser';
import { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHARED_SPECIFIERS_V1 } from '../../../ui-next/plugins/loader/specifiers.ts';
import { PLUGIN_SURFACE } from './scaffolding.mjs';

// The wiring of the guards on files of the two trees: which globs each rule covers, and what stays exempt.
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const fragment = require('./config.cjs');

const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } } },
    ...fragment,
  ],
});

async function rulesFired(code, file) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return result.messages.map((message) => message.ruleId);
}

const NEW_TREE_FILES = ['ui-next/Probe.tsx', 'packages/kit/src/Probe.tsx'];

describe('the previous UI libraries are never imported by the new trees', () => {
  for (const file of NEW_TREE_FILES) {
    for (const specifier of ['@omniviewdev/base-ui', '@omniviewdev/base-ui/metrics', '@omniviewdev/ai-ui', '@omniviewdev/editors', '@omniviewdev/editors/themes']) {
      it(`${specifier} from ${file}`, async () => {
        expect(await rulesFired(`import * as old from '${specifier}'; export { old };`, file)).toContain('no-restricted-imports');
      });
    }
  }

  it('and the kit is allowed', async () => {
    expect(await rulesFired("import { Text } from '@omniviewdev/kit'; import '@omniviewdev/kit/styles.css'; export { Text };", 'ui-next/Probe.tsx')).toEqual([]);
  });
});

describe('an inline style is a data parameter or it is an error', () => {
  for (const file of NEW_TREE_FILES) {
    it(`static values in ${file}`, async () => {
      expect(await rulesFired('export const a = <i style={{ padding: 8 }} />;', file)).toContain('kit/no-static-style');
      expect(await rulesFired('export const a = <i style={{ "--_c": "red" }} />;', file)).toContain('kit/no-static-style');
    });

    it(`a computed custom property in ${file}`, async () => {
      expect(await rulesFired('export const a = (c: string) => <i style={{ "--_c": c }} />;', file)).toEqual([]);
    });
  }

  it('does not apply to tests', async () => {
    expect(await rulesFired('export const a = <i style={{ padding: 8 }} />;', 'ui-next/Probe.test.tsx')).toEqual([]);
  });
});

describe('a custom property is never written at run time', () => {
  const writes = [
    "document.documentElement.style.setProperty('--ov-x', '1');",
    "element.style.setProperty('--_x', '1');",
    "document.documentElement.style.color = 'red';",
    "document.body.style.margin = '0';",
    "element.style.cssText = '--x: 1';",
  ];
  for (const file of NEW_TREE_FILES) {
    for (const code of writes) {
      it(`${code} in ${file}`, async () => {
        expect(await rulesFired(code, file)).toContain('no-restricted-syntax');
      });
    }
  }
});

describe('a token is named through tokenVar, which is typed', () => {
  for (const file of ['ui-next/Probe.tsx', 'packages/kit/src/Probe.tsx']) {
    it(`raw strings are errors in ${file}`, async () => {
      expect(await rulesFired("export const a = 'var(--ov-bg-windw)';", file)).toContain('no-restricted-syntax');
      expect(await rulesFired('export const a = `var(--ov-${name})`;', file)).toContain('no-restricted-syntax');
    });

    it(`tokenVar("--ov-…") is not in ${file}`, async () => {
      expect(await rulesFired("import { tokenVar } from './tokenVar'; export const a = tokenVar('--ov-bg-window');", file)).toEqual([]);
    });
  }

  it('the generated names are exempt', async () => {
    expect(await rulesFired("export const A = ['--ov-bg-window'] as const;", 'packages/kit/src/generated/tokenNames.ts')).toEqual([]);
  });
});

describe('a kit part is closed', () => {
  const part = 'packages/kit/src/components/Probe/Probe.tsx';
  it('takes no className, no style and no HTML attribute types, and spreads nothing', async () => {
    expect(await rulesFired('export type P = { className?: string };', part)).toContain('kit/closed-props');
    expect(await rulesFired('export type P = { style?: object };', part)).toContain('kit/closed-props');
    expect(await rulesFired('export type P = React.HTMLAttributes<HTMLDivElement>;', part)).toContain('kit/closed-props');
    expect(await rulesFired('export const A = (p: P) => <div {...p} />;', part)).toContain('kit/closed-props');
  });

  it('the rule is for parts, not for every kit file', async () => {
    expect(await rulesFired('export type P = { className?: string };', 'packages/kit/src/shared/Probe.ts')).not.toContain('kit/closed-props');
  });

  it('a consumer cannot restyle a kit part', async () => {
    const code = "import { Stack } from '@omniviewdev/kit'; export const A = () => <Stack className=\"x\" />;";
    expect(await rulesFired(code, 'ui-next/Probe.tsx')).toContain('kit/no-restyle');
  });
});

describe('the kit knows nothing of the host, and the host uses the kit by its entries', () => {
  it('the kit cannot import the runtime, the backend bindings or the host trees', async () => {
    for (const specifier of ['@omniviewdev/runtime', '@omniviewdev/runtime/api', '@wailsio/runtime']) {
      expect(await rulesFired(`import * as host from '${specifier}'; export { host };`, 'packages/kit/src/Probe.tsx'), specifier).toContain(
        'no-restricted-imports',
      );
    }
  });

  it('ui-next cannot reach into the kit', async () => {
    expect(await rulesFired("import { tokenVar } from '@omniviewdev/kit/src/theme/tokenVar'; export { tokenVar };", 'ui-next/Probe.tsx')).toContain('no-restricted-imports');
    expect(await rulesFired("import { tokenVar } from '../packages/kit/src/theme/tokenVar'; export { tokenVar };", 'ui-next/Probe.tsx')).toContain('no-restricted-imports');
  });
});

describe('the examples entry is for the parts page, the workshop and the kit tests, and for nothing else', () => {
  const examples = "import { examples } from '@omniviewdev/kit/examples'; export { examples };";

  it('the parts page may import it', async () => {
    expect(await rulesFired(examples, 'ui-next/parts/PartsPage.tsx')).toEqual([]);
    expect(await rulesFired(examples, 'ui-next/parts/nested/Probe.tsx')).toEqual([]);
  });

  it('no other file of ui-next may import it', async () => {
    for (const file of ['ui-next/Probe.tsx', 'ui-next/App.tsx', 'ui-next/pods/Probe.tsx', 'ui-next/k8s/Probe.ts', 'ui-next/shell/Probe.tsx']) {
      expect(await rulesFired(examples, file), file).toContain('no-restricted-imports');
    }
  });

  it('the parts page still cannot reach into the kit or use the previous libraries', async () => {
    expect(await rulesFired("import { tokenVar } from '@omniviewdev/kit/src/theme/tokenVar'; export { tokenVar };", 'ui-next/parts/Probe.tsx')).toContain('no-restricted-imports');
    expect(await rulesFired("import * as old from '@omniviewdev/base-ui'; export { old };", 'ui-next/parts/Probe.tsx')).toContain('no-restricted-imports');
  });

  it('no product code of the kit may import an examples file or the entry', async () => {
    for (const code of [
      "import { Primary } from './Button.examples'; export { Primary };",
      "import * as all from './components/Button/Button.examples'; export { all };",
      "import { examples } from './examples'; export { examples };",
      "import { examples } from '@omniviewdev/kit/examples'; export { examples };",
    ]) {
      for (const file of ['packages/kit/src/components/Button/Button.tsx', 'packages/kit/src/index.ts', 'packages/kit/src/shared/Probe.ts']) {
        expect(await rulesFired(code, file), `${code} in ${file}`).toContain('no-restricted-imports');
      }
    }
  });

  it('the entry file collects the examples files, and an examples file is a consumer of the kit', async () => {
    expect(await rulesFired("import * as buttons from './components/Button/Button.examples'; export const examples = { buttons };", 'packages/kit/src/examples.ts')).toEqual([]);
    expect(await rulesFired("import { Button } from '@omniviewdev/kit'; export const Primary = () => <Button>Create</Button>;", 'packages/kit/src/components/Button/Button.examples.tsx')).toEqual([]);
    expect(await rulesFired("import { Button } from '@omniviewdev/kit'; export const A = () => <Button className=\"x\">a</Button>;", 'packages/kit/src/components/Button/Button.examples.tsx')).toContain('kit/no-restyle');
    expect(await rulesFired("import * as old from '@omniviewdev/base-ui'; export { old };", 'packages/kit/src/components/Button/Button.examples.tsx')).toContain('no-restricted-imports');
  });

  it('tests may import examples', async () => {
    expect(await rulesFired("import * as all from './Button.examples'; export { all };", 'packages/kit/src/components/Button/Button.test.tsx')).toEqual([]);
  });
});

describe('the host and the kit are plugin-agnostic (decision A13)', () => {
  const boundary = async (code, file) => (await rulesFired(code, file)).filter((id) => id === 'kit/scaffold-boundary').length;

  it('a kit file cannot import plugin scaffolding', async () => {
    expect(await boundary("import x from '../../../ui-next/k8s/x'; export { x };", 'packages/kit/src/Probe.tsx')).toBe(1);
    expect(await boundary("import x from '../../../ui-next/k8s/x'; export { x };", 'packages/kit/src/Probe.test.tsx')).toBe(1);
  });

  it('a shell file cannot import plugin scaffolding, tests included', async () => {
    const code = "import { a } from '../k8s/usePods'; import { b } from '../pods/Page'; export { a, b };";
    expect(await boundary(code, 'ui-next/shell/Probe.tsx')).toBe(2);
    expect(await boundary(code, 'ui-next/shell/Probe.test.tsx')).toBe(2);
  });

  it('plugin code cannot reach the host', async () => {
    const specifiers = ['../shell/Frame', '../../ui/utils/x', '@/utils/y', '@omniviewdev/runtime/api', '@omniviewdev/runtime/runtime', '@omniviewdev/kit/dist/x', '@wailsio/runtime'];
    const code = specifiers.map((specifier, index) => `import x${index} from '${specifier}';`).join('\n');
    expect(await boundary(code, 'ui-next/k8s/a.ts')).toBe(specifiers.length);
    expect(await boundary(code, 'ui-next/k8s/a.test.ts')).toBe(specifiers.length);
    expect(await boundary(code, 'ui-next/pods/a.tsx')).toBe(specifiers.length);
  });

  it('plugin code reaches the runtime only through its curated entry and the kit only through its root entry, tests included', async () => {
    const outside = ['@omniviewdev/runtime', '@omniviewdev/runtime/ui/v2', '@omniviewdev/kit/styles.css', '@omniviewdev/base-ui', '@omniviewdev/providers'];
    const code = outside.map((specifier, index) => `import x${index} from '${specifier}';`).join('\n');
    for (const file of ['ui-next/k8s/a.ts', 'ui-next/k8s/a.test.ts', 'ui-next/pods/a.tsx', 'ui-next/pods/a.test.tsx']) {
      expect(await boundary(code, file), file).toBe(outside.length);
    }
  });

  it('plugin code may use its own files and the shared list, and the host and the kit may use the whole runtime', async () => {
    const own = ['./b', './sub/c', '@omniviewdev/kit', '@omniviewdev/runtime/ui/v1', 'react', 'react/jsx-runtime', 'react/compiler-runtime', 'vitest'];
    expect(await boundary(own.map((specifier, index) => `import x${index} from '${specifier}';`).join('\n'), 'ui-next/k8s/a.ts')).toBe(0);
    expect(await boundary("import { b } from '../b'; import { Page } from '../../pods/Page';", 'ui-next/k8s/sub/d.ts')).toBe(0);
    expect(await boundary("import { usePods } from '../k8s/usePods';", 'ui-next/pods/Page.tsx')).toBe(0);
    expect(await boundary("import { ActivityProvider } from '@omniviewdev/runtime'; import '@omniviewdev/kit/styles.css';", 'ui-next/main.tsx')).toBe(0);
  });

  it('what the rule lets a plugin import is the list the host shares with a plugin\'s bundle, so the two cannot drift', () => {
    // `react/jsx-dev-runtime` is imported by a development server's modules, never written in a source file.
    expect([...PLUGIN_SURFACE].sort()).toEqual(SHARED_SPECIFIERS_V1.filter((name) => name !== 'react/jsx-dev-runtime').sort());
  });

  it('the one mount point is ui-next/main.tsx, marked, and the rule stays active on its other lines', async () => {
    const text = readFileSync(path.join(root, 'ui-next/main.tsx'), 'utf8');
    expect(await boundary(text, 'ui-next/main.tsx')).toBe(0);
    const bare = text.split('\n').filter((line) => !line.includes('eslint-disable-next-line kit/scaffold-boundary'));
    expect(bare.length).toBe(text.split('\n').length - 1);
    expect(await boundary(bare.join('\n'), 'ui-next/main.tsx')).toBe(1);
  });
});
