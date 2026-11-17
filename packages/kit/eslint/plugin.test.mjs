import tsParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import path from 'node:path';
import plugin from './plugin.mjs';
import { REPO_ROOT } from './scaffolding.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } }, sourceType: 'module' },
});

tester.run('no-static-style', plugin.rules['no-static-style'], {
  valid: [
    { code: 'const a = <i style={{ "--c": color }} />;' },
    { code: 'const a = <i style={{ "--swatch": tokenVar("--ov-accent"), "--w": `${width}px` }} />;' },
    { code: 'const a = <i style={{ "--c": color } as CSSProperties} />;' },
    { code: 'const a = <i className={styles.root} />;' },
  ],
  invalid: [
    { code: 'const a = <i style={{ padding: 8 }} />;', errors: [{ messageId: 'notCustomProperty' }] },
    { code: 'const a = <i style={{ color: tone }} />;', errors: [{ messageId: 'notCustomProperty' }] },
    { code: 'const a = <i style={{ "--c": "red" }} />;', errors: [{ messageId: 'staticValue' }] },
    { code: 'const a = <i style={{ "--w": 12 * 2 }} />;', errors: [{ messageId: 'staticValue' }] },
    { code: 'const a = <i style={{ "--w": `12px` }} />;', errors: [{ messageId: 'staticValue' }] },
    { code: 'const a = <i style="padding: 8px" />;', errors: [{ messageId: 'notObject' }] },
    { code: 'const s = { padding: 8 }; const a = <i style={s} />;', errors: [{ messageId: 'notObject' }] },
    { code: 'const a = <i style={{ ...rest }} />;', errors: [{ messageId: 'notObject' }] },
    { code: 'const a = <i style={{ [name]: value }} />;', errors: [{ messageId: 'notCustomProperty' }] },
  ],
});

tester.run('closed-props', plugin.rules['closed-props'], {
  valid: [
    { code: 'interface TextProps extends DataAttributes { readonly variant?: string }' },
    { code: 'function Text({ variant, ...rest }: TextProps) { return <span {...dataAttributes(rest)} data-ov-variant={variant} />; }' },
  ],
  invalid: [
    { code: 'interface P { className?: string }', errors: [{ messageId: 'restyleProp' }] },
    { code: 'interface P { readonly style?: CSSProperties }', errors: [{ messageId: 'restyleProp' }] },
    { code: 'type P = { className: string };', errors: [{ messageId: 'restyleProp' }] },
    { code: 'function T({ className, children }: P) { return null; }', errors: [{ messageId: 'restyleProp' }] },
    { code: 'function T({ style }: P) { return null; }', errors: [{ messageId: 'restyleProp' }] },
    { code: 'interface P extends HTMLAttributes<HTMLDivElement> {}', errors: [{ messageId: 'attributeTypes' }] },
    { code: 'interface P extends React.HTMLAttributes<HTMLDivElement> {}', errors: [{ messageId: 'attributeTypes' }] },
    { code: 'type P = ComponentProps<"div">;', errors: [{ messageId: 'attributeTypes' }] },
    { code: 'type P = ComponentPropsWithoutRef<"button"> & { a: 1 };', errors: [{ messageId: 'attributeTypes' }] },
    { code: 'function T(props: P) { return <div {...props} />; }', errors: [{ messageId: 'spread' }] },
    { code: 'function T({ a, ...rest }: P) { return <div {...rest} />; }', errors: [{ messageId: 'spread' }] },
  ],
});

tester.run('no-restyle', plugin.rules['no-restyle'], {
  valid: [
    { code: 'import { Text } from "@omniviewdev/kit"; const a = <Text variant="body" />;' },
    { code: 'import { Text } from "@omniviewdev/kit"; const a = <main className={styles.window} style={{ "--c": c }} />;' },
    { code: 'import { Text } from "./Other"; const a = <Text className="x" />;' },
  ],
  invalid: [
    {
      code: 'import { Stack } from "@omniviewdev/kit"; const a = <Stack className={styles.x} />;',
      errors: [{ messageId: 'restyle', data: { name: 'className', component: 'Stack' } }],
    },
    {
      code: 'import { Text as T } from "@omniviewdev/kit"; const a = <T style={{ "--c": c }} />;',
      errors: [{ messageId: 'restyle', data: { name: 'style', component: 'T' } }],
    },
  ],
});

const at = (file) => path.join(REPO_ROOT, file);
const hostToPlugin = [{ messageId: 'hostToPlugin' }];
const pluginToHost = [{ messageId: 'pluginToHost' }];

tester.run('scaffold-boundary', plugin.rules['scaffold-boundary'], {
  valid: [
    // plugin code may use its own files and the public surface
    ...['./b', './sub/c', '@omniviewdev/runtime', '@omniviewdev/kit', '@omniviewdev/kit/styles.css', 'react', 'vitest', '@tanstack/react-query', '@testing-library/react'].map(
      (specifier) => ({ code: `import x from '${specifier}'; export { x };`, filename: at('ui-next/k8s/a.ts') }),
    ),
    { code: "import { P } from '../b'; import { Page } from '../../pods/Page'; export { P, Page };", filename: at('ui-next/k8s/sub/d.ts') },
    { code: "import { usePods } from '../k8s/usePods'; export { usePods };", filename: at('ui-next/pods/Page.tsx') },
    { code: "export * from './b'; export { y } from '../pods/y'; import('./lazy'); require('./cjs');", filename: at('ui-next/k8s/a.ts') },
    // the host may use anything that is not plugin code
    { code: "import { Frame } from './shell/Frame'; import '@omniviewdev/kit'; import { x } from './k8sish/x';", filename: at('ui-next/App.tsx') },
    { code: "import { x } from '../../ui-next/shell/x';", filename: at('packages/kit/src/Probe.tsx') },
    // other trees are out of scope
    { code: "import { x } from '../ui-next/k8s/x';", filename: at('ui/Probe.tsx') },
    // a computed dynamic import cannot be resolved
    { code: 'import(name); require(name);', filename: at('ui-next/App.tsx') },
  ],
  invalid: [
    { code: "import x from '../../../ui-next/k8s/x'; export { x };", filename: at('packages/kit/src/Probe.tsx'), errors: hostToPlugin },
    { code: "import { a } from '../k8s/usePods'; export { a };", filename: at('ui-next/shell/Probe.tsx'), errors: hostToPlugin },
    { code: "import { a } from '../pods/Page'; export { a };", filename: at('ui-next/shell/Probe.tsx'), errors: hostToPlugin },
    { code: "import { a } from './k8s';", filename: at('ui-next/App.tsx'), errors: hostToPlugin },
    { code: "export { a } from './k8s/usePods';", filename: at('ui-next/App.tsx'), errors: hostToPlugin },
    { code: "export * from './pods/Page';", filename: at('ui-next/App.tsx'), errors: hostToPlugin },
    { code: "const a = import('./pods/Page');", filename: at('ui-next/App.tsx'), errors: hostToPlugin },
    { code: "const a = require('./k8s/usePods');", filename: at('ui-next/App.tsx'), errors: hostToPlugin },
    { code: "import { a } from '../k8s/usePods';", filename: at('ui-next/shell/Probe.test.tsx'), errors: hostToPlugin },
    { code: "import { a } from 'somewhere/ui-next/k8s/usePods';", filename: at('packages/kit/src/Probe.tsx'), errors: hostToPlugin },
    { code: "import { a } from '/abs/ui-next/pods/Page';", filename: at('ui-next/App.tsx'), errors: hostToPlugin },
    // plugin code may not reach the host
    ...['../shell/Frame', '../../ui/utils/x', '@/utils/y', '@omniviewdev/runtime/api', '@omniviewdev/runtime/runtime', '@omniviewdev/kit/dist/x', '@omniviewdev/kit/src/x', '@wailsio/runtime', '../App', '../main', '../../packages/kit/src/x', '../k8sish/x'].map(
      (specifier) => ({ code: `import x from '${specifier}'; export { x };`, filename: at('ui-next/k8s/a.ts'), errors: pluginToHost }),
    ),
    { code: "import x from '../shell/Frame'; export { x };", filename: at('ui-next/k8s/a.test.ts'), errors: pluginToHost },
    { code: "export { x } from '../shell/Frame';", filename: at('ui-next/pods/a.ts'), errors: pluginToHost },
    { code: "export * from '@/x';", filename: at('ui-next/pods/a.ts'), errors: pluginToHost },
    { code: "const a = import('@omniviewdev/runtime/api');", filename: at('ui-next/pods/a.ts'), errors: pluginToHost },
    { code: "const a = require('@wailsio/runtime');", filename: at('ui-next/k8s/a.ts'), errors: pluginToHost },
  ],
});
