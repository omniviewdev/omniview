'use strict';

// Guards for the new trees, `packages/kit/` and `ui-next/`. The root eslint.config.cjs spreads this list.
// Each guard is proven by `plugin.test.mjs` (the rules) and by `guards.test.mjs` (this wiring, on real files).
const { default: kit } = require('./plugin.mjs');

const oldLibraries = ['@omniviewdev/base-ui', '@omniviewdev/ai-ui', '@omniviewdev/editors'];
const oldLibraryPattern = {
  group: oldLibraries.flatMap((name) => [name, `${name}/*`]),
  message:
    'The previous UI libraries are frozen and never imported by the new tree (strategy R3, R4). Use @omniviewdev/kit, or build the part through its screen.',
};
const kitInternalsPattern = {
  group: ['@omniviewdev/kit/*', '!@omniviewdev/kit/styles.css', '**/packages/kit/**'],
  message:
    'Import the kit by its two entries only: "@omniviewdev/kit" and "@omniviewdev/kit/styles.css". "@omniviewdev/kit/examples" is for ui-next/parts and the workshop.',
};
// The examples entry is development and documentation only: the parts page, the kit's own tests and the future workshop render it.
// It is never in the root entry (plugins share that one at run time) and no product code loads it.
const kitInternalsPatternForParts = {
  group: ['@omniviewdev/kit/*', '!@omniviewdev/kit/styles.css', '!@omniviewdev/kit/examples', '**/packages/kit/**'],
  message: 'Import the kit by its entries only: "@omniviewdev/kit", "@omniviewdev/kit/styles.css" and, on the parts page, "@omniviewdev/kit/examples".',
};
const examplesPattern = {
  group: ['**/*.examples', '**/*.examples.tsx', '**/examples', '**/examples.ts', '@omniviewdev/kit/examples'],
  message:
    'Examples are for the parts page, the kit tests and the workshop (docs/ui-next/AGENTS.md, "The kit"). Product code of the kit never imports an examples file or the examples entry.',
};
const hostPattern = {
  group: ['@omniviewdev/runtime', '@omniviewdev/runtime/*', '@wailsio/*', '**/ui/**', '**/ui-next/**'],
  message: 'The kit renders what it is given. It knows nothing of plugins, the backend, routes or the host (design D2.3).',
};

// Custom properties are never written at run time (strategy R6): theme, density and text size flip by attribute, and a
// per-instance value goes through one leaf's inline `style` (see kit/no-static-style), never through the root.
const runtimeWrites = [
  {
    selector: "CallExpression[callee.property.name='setProperty']",
    message:
      'Do not write custom properties at run time (strategy R6): flip an attribute, or bind a value on one leaf with an inline `style` of custom properties.',
  },
  {
    selector: "MemberExpression[property.name='style'][object.property.name=/^(?:documentElement|body)$/]",
    message: 'Do not touch the document root or body style: the theme is data-ov-* attributes on <html> and static CSS.',
  },
  {
    selector: "AssignmentExpression[left.property.name='cssText']",
    message: 'Do not assign cssText: an inline style is a data parameter on one leaf.',
  },
];

// TypeScript refers to a token through tokenVar(), which is checked against the generated names. A raw string is not checked.
const rawTokenStrings = [
  {
    // The one place a literal name belongs is the argument of tokenVar().
    selector: "Literal[value=/--ov-/]:not(CallExpression[callee.name='tokenVar'] > Literal)",
    message: 'Refer to a token with tokenVar("--ov-…"): a misspelled raw string is not checked.',
  },
  {
    selector: 'TemplateElement[value.raw=/--ov-/]',
    message: 'Refer to a token with tokenVar("--ov-…"): a misspelled raw string is not checked.',
  },
];

const tests = ['**/*.test.*', '**/*.spec.*'];

module.exports = [
  {
    // Plugin-agnostic host and kit (decision A13): tests included. A custom rule, not `no-restricted-imports`, because a later
    // block that sets `no-restricted-imports` for the same files replaces the options of an earlier one.
    files: ['packages/kit/**/*.{ts,tsx,mjs,cjs}', 'ui-next/**/*.{ts,tsx}'],
    plugins: { kit },
    rules: { 'kit/scaffold-boundary': 'error' },
  },
  {
    files: ['packages/kit/{src,tokens,scripts}/**/*.{ts,tsx}', 'ui-next/**/*.{ts,tsx}'],
    ignores: tests,
    plugins: { kit },
    rules: {
      'kit/no-static-style': 'error',
      'no-restricted-imports': ['error', { patterns: [oldLibraryPattern] }],
      'no-restricted-syntax': ['error', ...runtimeWrites],
    },
  },
  {
    files: ['packages/kit/src/**/*.{ts,tsx}'],
    ignores: [...tests, 'packages/kit/src/generated/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [oldLibraryPattern, hostPattern, examplesPattern] }],
      'no-restricted-syntax': ['error', ...runtimeWrites, ...rawTokenStrings],
    },
  },
  {
    // The entry file collects the examples files; an examples file is a consumer of the kit and imports it by its public name.
    files: ['packages/kit/src/examples.ts', 'packages/kit/src/**/*.examples.tsx'],
    ignores: tests,
    rules: { 'no-restricted-imports': ['error', { patterns: [oldLibraryPattern, hostPattern] }] },
  },
  {
    files: ['packages/kit/src/**/*.examples.tsx'],
    ignores: tests,
    plugins: { kit },
    rules: { 'kit/no-restyle': 'error' },
  },
  {
    files: ['packages/kit/src/components/**/*.{ts,tsx}'],
    ignores: tests,
    plugins: { kit },
    rules: { 'kit/closed-props': 'error' },
  },
  {
    files: ['ui-next/**/*.{ts,tsx}'],
    ignores: tests,
    plugins: { kit },
    rules: {
      'kit/no-restyle': 'error',
      'no-restricted-imports': ['error', { patterns: [oldLibraryPattern, kitInternalsPattern] }],
      'no-restricted-syntax': ['error', ...runtimeWrites, ...rawTokenStrings],
    },
  },
  {
    files: ['ui-next/parts/**/*.{ts,tsx}'],
    ignores: tests,
    rules: { 'no-restricted-imports': ['error', { patterns: [oldLibraryPattern, kitInternalsPatternForParts] }] },
  },
];
