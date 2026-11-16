import tsParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import plugin from './plugin.mjs';

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
