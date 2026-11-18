// @vitest-environment node
import { createRequire } from 'node:module';
import path from 'node:path';
import tsParser from '@typescript-eslint/parser';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

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
    for (const file of ['ui-next/Probe.tsx', 'ui-next/App.tsx', 'ui-next/plugins/Probe.tsx', 'ui-next/shell/Probe.tsx']) {
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
