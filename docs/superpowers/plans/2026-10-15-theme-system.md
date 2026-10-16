# Production Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production theme engine with nine built-ins, Void as the default, unified app/editor/terminal theming, immediate durable selection, and owner-safe plugin theme contributions.

**Architecture:** `@omniviewdev/base-ui` owns the versioned schema, static built-ins, owner-aware catalog, controlled provider, and DOM application. `@omniviewdev/editors` converts the resolved active tokens for Monaco and Xterm. Omniview owns backend persistence/migration, first-paint policy, the settings picker, plugin contribution bridging, and per-surface overrides.

**Tech Stack:** TypeScript 5.9, React 19, CSS custom properties, Vite 7/8, Vitest 4 + jsdom, Monaco, Xterm, Go 1.24, Wails v3 beta.29, bbolt settings, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-15-theme-system-design.md`

## Global Constraints

- UI repository root: `/Users/joshuapare/Repos/omniviewdev/ui/main`.
- Omniview repository root: `/Users/joshuapare/Repos/omniviewdev/omniview`.
- Use `GOWORK=off` for every Go command in Omniview.
- Generate Wails bindings only with `task bindings`; this plan does not change bound Go method signatures, so regeneration is not expected.
- Build `@omniviewdev/base-ui` before `@omniviewdev/editors`; build `@omniviewdev/runtime` before `@omniviewdev/vite-plugin` if shim regeneration is required.
- Keep `ui/features/plugins/api/shared_dependencies.ts` and `packages/omniviewdev-vite-plugin/src/sharedPackages.ts` synchronized.
- Built-in component styling remains static CSS. Theme changes may mutate only root attributes, `color-scheme`, and a bounded set of validated custom properties.
- `appearance.theme` is the only durable selected-theme preference. LocalStorage is bootstrap cache only.
- Clean cutover: remove old provider props, localStorage persistence, app-local Solarized registration, static Appearance theme options, and hardcoded global editor themes. Do not add compatibility aliases.
- User changes already present in either worktree are out of scope; stage only files named by the active task.

## File Structure

### `omniviewdev/ui`

**Create**

- `packages/base-ui/src/theme/schema.ts` — public versioned definitions, token metadata types, owner and summary contracts.
- `packages/base-ui/src/theme/validation.ts` — pure definition validation, cloning, freezing, and typed errors.
- `packages/base-ui/src/theme/validation.test.ts` — schema and value validation behavior.
- `packages/base-ui/src/theme/applyTheme.ts` — pure root mutation and exact override cleanup.
- `packages/base-ui/src/theme/applyTheme.test.ts` — DOM application behavior.
- `packages/base-ui/src/theme/registry/catalog.ts` — immutable built-in metadata and ordering.
- `packages/base-ui/src/theme/registry/catalog.test.ts` — nine-theme metadata/selector contract.
- `.changeset/theme-system-v1.md` — Base UI breaking-minor and Editors feature-minor release note.

**Modify**

- `packages/base-ui/scripts/generate-token-keys.ts`
- `packages/base-ui/scripts/generate-token-keys.test.ts`
- `packages/base-ui/src/theme/generated/tokenKeys.ts`
- `packages/base-ui/src/theme/registry/types.ts`
- `packages/base-ui/src/theme/registry/registry.ts`
- `packages/base-ui/src/theme/registry/registry.test.ts` — replace current registry tests with owner/snapshot behavior.
- `packages/base-ui/src/theme/registry/builtIns.ts`
- `packages/base-ui/src/theme/registry/index.ts`
- `packages/base-ui/src/theme/ThemeProvider.tsx`
- `packages/base-ui/src/theme/ThemeProvider.test.tsx`
- `packages/base-ui/src/theme/context.ts`
- `packages/base-ui/src/theme/types.ts`
- `packages/base-ui/src/theme/index.ts`
- `packages/base-ui/src/theme/useThemeList.ts`
- `packages/base-ui/src/theme/useThemeList.test.tsx`
- `packages/base-ui/src/theme/useThemeRegistry.ts`
- `packages/base-ui/src/theme/ThemeSwitcher.tsx`
- `packages/base-ui/src/theme/styles.css`
- `packages/base-ui/src/theme/visual-regression/registry-visual.test.tsx`
- `packages/base-ui/src/test/render.tsx`
- `packages/base-ui/src/components/command-list/CommandList.test.tsx`
- `packages/base-ui/.storybook/preview.tsx`
- `packages/base-ui/.storybook/sampleCustomThemes.ts`
- `packages/base-ui/docs/THEMING.md`
- `apps/showcase/src/main.tsx`
- `apps/showcase/src/sampleThemes.ts`
- `apps/showcase/src/Dock.tsx`
- `packages/editors/src/themes/useEditorTheme.ts`
- `packages/editors/src/themes/types.ts`
- `packages/editors/src/themes/index.ts`
- `packages/editors/src/index.ts`
- `packages/editors/src/components/code-editor/CodeEditor.tsx`
- `packages/editors/src/components/code-editor/CodeEditor.test.tsx`
- `packages/editors/src/components/diff-viewer/DiffViewer.tsx`
- `packages/editors/src/components/diff-viewer/DiffViewer.test.tsx`
- `packages/editors/src/components/terminal/Terminal.tsx`
- `packages/editors/src/components/terminal/Terminal.test.tsx`

### `omniviewdev/omniview`

**Create**

- `ui/theme/themeBootstrap.ts` — versioned built-in paint-cache read/write/migration helpers.
- `ui/theme/themeBootstrap.test.ts` — cache and legacy-key behavior.
- `ui/theme/AppThemeController.tsx` — controlled selection, optimistic persistence, rollback, and context.
- `ui/theme/AppThemeController.test.tsx` — controller state transitions.
- `ui/theme/AppearanceThemeSetting.tsx` — reactive immediate-save picker.
- `ui/theme/AppearanceThemeSetting.test.tsx` — ordering, unavailable state, and selection.
- `ui/features/extensions/theme/extensionPoint.ts` — `omniview/theme` definition and value type.
- `ui/features/extensions/theme/ThemeContributionBridge.tsx` — extension-store to theme-registry diff.
- `ui/features/extensions/theme/ThemeContributionBridge.test.tsx` — add/reload/unload/error isolation.
- `internal/settings/appearance_test.go` — default, validation, and migration tests.

**Modify**

- `package.json`
- `pnpm-lock.yaml`
- `index.html`
- `main.go`
- `ui/App.tsx`
- `ui/theme/AppTheme.tsx` — remove after callers use `AppThemeController`.
- `ui/theme/solarized.ts` — remove after Solarized ships in Base UI.
- `ui/theme/__tests__/AppTheme.test.tsx` — replace with controller/provider integration coverage.
- `ui/pages/settings/CoreSettingsPage.tsx`
- `ui/pages/settings/SettingsEntries.tsx`
- `ui/features/extensions/registerBuiltinExtensionPoints.ts`
- `ui/features/extensions/builtinExtensionPoints.test.ts`
- `ui/components/displays/CodeEditor.tsx`
- `ui/federation/LinkedResourceDrawer.tsx`
- `ui/providers/BottomDrawer/containers/Terminal.tsx`
- `ui/providers/BottomDrawer/containers/terminalThemes.ts`
- `ui/providers/BottomDrawer/containers/__tests__/Terminal.test.tsx`
- `internal/settings/appearance.go`
- `internal/settings/editor.go`
- `internal/settings/terminal.go`
- `internal/bootstrap/bootstrap.go`
- `internal/bootstrap/bootstrap_test.go` — extend persisted migration coverage.
- `ui/store/settings/sections/appearance.ts` — remove only the dead `mode` and `theme` entries; retain `headerSearch` and `showSettingIds`.
- `packages/omniviewdev-vite-plugin/shims/_omniviewdev__base-ui.mjs` — generated only if Base UI exports change.
- `docs/plugin-development.md`

---

### Task 1: Generate One Theme Token Catalog

**Repository:** `/Users/joshuapare/Repos/omniviewdev/ui/main`

**Files:**
- Modify: `packages/base-ui/scripts/generate-token-keys.ts`
- Modify: `packages/base-ui/scripts/generate-token-keys.test.ts`
- Regenerate: `packages/base-ui/src/theme/generated/tokenKeys.ts`

**Interfaces:**
- Produces: `ThemeTokenKey`, `ThemeTokenValueKind`, `THEME_TOKEN_METADATA`.
- Removes: `ColorTokenKey`, `SyntaxTokenKey`, `TerminalTokenKey`, and three separate key sets.

- [ ] **Step 1: Replace generator expectations with one metadata catalog**

Add tests that require color and syntax keys, classify syntax style keys, and exclude structural tokens:

```ts
it('extracts one keyed token catalog with value kinds', () => {
  const css = `
    :root {
      --ov-color-bg-base: #000;
      --ov-color-terminal-bg: #111;
      --ov-color-ansi-red: #c00;
      --ov-syntax-keyword: #f0f;
      --ov-syntax-style-keyword: bold;
      --ov-size-button-md: 26px;
    }
  `;

  expect(extractThemeTokens(css)).toEqual({
    'color.ansi.red': { cssVariable: '--ov-color-ansi-red', valueKind: 'color' },
    'color.bg.base': { cssVariable: '--ov-color-bg-base', valueKind: 'color' },
    'color.terminal.bg': { cssVariable: '--ov-color-terminal-bg', valueKind: 'color' },
    'syntax.keyword': { cssVariable: '--ov-syntax-keyword', valueKind: 'color' },
    'syntax.style.keyword': {
      cssVariable: '--ov-syntax-style-keyword',
      valueKind: 'font-style',
    },
  });
});
```

Also assert duplicate definitions collapse to one entry and generated output is deterministic when CSS declaration order changes.

- [ ] **Step 2: Run the generator tests and observe the old API failure**

Run:

```bash
pnpm --filter @omniviewdev/base-ui exec vitest run scripts/generate-token-keys.test.ts
```

Expected: FAIL because `extractThemeTokens`, `ThemeTokenKey`, and metadata output do not exist.

- [ ] **Step 3: Implement deterministic extraction and rendering**

Use this contract in `generate-token-keys.ts`:

```ts
export type ExtractedThemeTokens = Record<
  string,
  { cssVariable: `--ov-${string}`; valueKind: 'color' | 'font-style' }
>;

const THEME_VAR_RE = /(--ov-(color|syntax)-([a-z0-9-]+))\s*:/g;

export function extractThemeTokens(css: string): ExtractedThemeTokens {
  const result: ExtractedThemeTokens = {};
  for (const match of css.matchAll(THEME_VAR_RE)) {
    const cssVariable = match[1] as `--ov-${string}`;
    const prefix = match[2];
    const rest = match[3];
    if (!rest) continue;
    const key = `${prefix}.${rest.replaceAll('-', '.')}`;
    result[key] = {
      cssVariable,
      valueKind: key.startsWith('syntax.style.') ? 'font-style' : 'color',
    };
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
```

Render one string union and one frozen metadata object. The generated file must export:

```ts
export type ThemeTokenValueKind = 'color' | 'font-style';
export type ThemeTokenKey = /* generated literal union */;
export const THEME_TOKEN_METADATA: Readonly<
  Record<ThemeTokenKey, { cssVariable: `--ov-${string}`; valueKind: ThemeTokenValueKind }>
> = Object.freeze(/* generated entries */);
```

- [ ] **Step 4: Regenerate and prove deterministic output**

Run:

```bash
pnpm --filter @omniviewdev/base-ui generate:token-keys
cp packages/base-ui/src/theme/generated/tokenKeys.ts /tmp/omniview-token-keys.ts
pnpm --filter @omniviewdev/base-ui generate:token-keys
diff -u /tmp/omniview-token-keys.ts packages/base-ui/src/theme/generated/tokenKeys.ts
```

Expected: generator reports nonzero theme tokens; `diff` emits no output.

- [ ] **Step 5: Run focused tests and commit**

```bash
pnpm --filter @omniviewdev/base-ui exec vitest run scripts/generate-token-keys.test.ts
git add packages/base-ui/scripts/generate-token-keys.ts \
  packages/base-ui/scripts/generate-token-keys.test.ts \
  packages/base-ui/src/theme/generated/tokenKeys.ts
git commit -m "refactor(base-ui): generate unified theme token metadata"
```

---

### Task 2: Add the Versioned Schema and Validator

**Repository:** `/Users/joshuapare/Repos/omniviewdev/ui/main`

**Files:**
- Create: `packages/base-ui/src/theme/schema.ts`
- Create: `packages/base-ui/src/theme/validation.ts`
- Create: `packages/base-ui/src/theme/validation.test.ts`
- Modify: `packages/base-ui/src/theme/registry/types.ts`
- Modify: `packages/base-ui/src/theme/types.test-d.test.ts`

**Interfaces:**
- Consumes: `ThemeTokenKey`, `THEME_TOKEN_METADATA` from Task 1.
- Produces: `BuiltInThemeId`, `ThemeDefinitionV1`, `ThemeDefinition`, `ThemeOwner`, `ThemeSummary`, `RegisteredTheme`, `ThemeValidationError`, `validateThemeDefinition`.

- [ ] **Step 1: Write schema type tests**

Replace the old split-map assertions with:

```ts
const valid: ThemeDefinition = {
  schemaVersion: 1,
  id: 'acme.slate',
  name: 'Slate',
  base: 'void',
  tokens: {
    'color.bg.base': '#101114',
    'syntax.keyword': '#8aafff',
    'syntax.style.keyword': 'bold',
  },
};
expectTypeOf(valid).toExtend<ThemeDefinitionV1>();

// @ts-expect-error removed split-map API
assertType<ThemeDefinition>({
  schemaVersion: 1,
  id: 'old',
  name: 'Old',
  base: 'dark',
  colors: { 'color.bg.base': '#000' },
});
```

- [ ] **Step 2: Write failing runtime validation tests**

Cover one success and every error code:

```ts
it.each([
  [{ ...valid, schemaVersion: 2 }, 'unsupported_schema'],
  [{ ...valid, id: 'bad id' }, 'invalid_id'],
  [{ ...valid, name: '' }, 'invalid_metadata'],
  [{ ...valid, base: 'missing' }, 'unknown_base'],
  [{ ...valid, tokens: { 'color.not.real': '#000' } }, 'unknown_token'],
  [{ ...valid, tokens: { 'color.bg.base': 'url(https://example.com/x)' } }, 'invalid_value'],
  [{ ...valid, tokens: { 'syntax.style.keyword': 'blink' } }, 'invalid_value'],
])('rejects invalid definitions', (input, code) => {
  expect(() => validateThemeDefinition(input)).toThrowError(
    expect.objectContaining({ code }),
  );
});

it('returns a detached deeply frozen definition', () => {
  const input = structuredClone(valid);
  const result = validateThemeDefinition(input);
  input.tokens['color.bg.base'] = '#fff';
  expect(result.tokens['color.bg.base']).toBe('#101114');
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.tokens)).toBe(true);
});
```

Inject a `supportsColor(value)` dependency in tests so Node behavior is deterministic.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
pnpm --filter @omniviewdev/base-ui exec vitest run \
  src/theme/validation.test.ts src/theme/types.test-d.test.ts
```

Expected: FAIL because schema and validator modules do not exist.

- [ ] **Step 4: Implement exact schema contracts**

In `schema.ts`, define the nine-ID union in catalog order and the owner union from the spec. In `validation.ts`, implement:

```ts
export type ThemeValidationErrorCode =
  | 'unsupported_schema'
  | 'invalid_id'
  | 'invalid_metadata'
  | 'unknown_base'
  | 'unknown_token'
  | 'invalid_value'
  | 'duplicate_id'
  | 'reserved_id'
  | 'owner_mismatch';

export class ThemeValidationError extends Error {
  constructor(
    readonly code: ThemeValidationErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'ThemeValidationError';
  }
}
```

Use `^[A-Za-z0-9._~%/:\-]+$`, maximum ID length 256, metadata bounds from the spec, `CSS.supports('color', value)` in browsers, and this font-style set:

```ts
const FONT_STYLES = new Set([
  'normal',
  'italic',
  'bold',
  'underline',
  'bold italic',
  'bold underline',
  'italic underline',
  'bold italic underline',
]);
```

Reject `url(`, `;`, `{`, and `}` before color support checks.

- [ ] **Step 5: Run tests, typecheck, and commit**

```bash
pnpm --filter @omniviewdev/base-ui exec vitest run \
  src/theme/validation.test.ts src/theme/types.test-d.test.ts
pnpm --filter @omniviewdev/base-ui typecheck
git add packages/base-ui/src/theme/schema.ts \
  packages/base-ui/src/theme/validation.ts \
  packages/base-ui/src/theme/validation.test.ts \
  packages/base-ui/src/theme/registry/types.ts \
  packages/base-ui/src/theme/types.test-d.test.ts
git commit -m "feat(base-ui): add versioned theme schema validation"
```

---

### Task 3: Replace the Registry with an Owner-Aware Catalog

**Repository:** `/Users/joshuapare/Repos/omniviewdev/ui/main`

**Files:**
- Create: `packages/base-ui/src/theme/registry/catalog.ts`
- Create: `packages/base-ui/src/theme/registry/catalog.test.ts`
- Modify: `packages/base-ui/src/theme/registry/builtIns.ts`
- Modify: `packages/base-ui/src/theme/registry/registry.ts`
- Modify: `packages/base-ui/src/theme/registry/registry.test.ts`
- Modify: `packages/base-ui/src/theme/registry/index.ts`
- Modify: `packages/base-ui/src/theme/useThemeList.ts`
- Modify: `packages/base-ui/src/theme/useThemeList.test.tsx`
- Modify: `packages/base-ui/src/theme/useThemeRegistry.ts`

**Interfaces:**
- Consumes: validated/frozen definitions from Task 2.
- Produces: stable `ThemeRegistrySnapshot`; owner-bound registration/disposal; immutable nine-theme catalog.
- Removes: `apply`, `active`, `ThemeRegistryEvent`, and DOM mutation from the registry.

- [ ] **Step 1: Write the built-in catalog contract test**

```ts
expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual([
  'void',
  'dark',
  'light',
  'obsidian',
  'carbon',
  'solarized-dark',
  'solarized-light',
  'high-contrast-dark',
  'high-contrast-light',
]);
expect(BUILT_IN_THEMES.find((theme) => theme.id === 'void')?.appearance).toBe('dark');
expect(BUILT_IN_THEMES.find((theme) => theme.id === 'light')?.appearance).toBe('light');
expect(BUILT_IN_THEMES.every((theme) => theme.builtIn)).toBe(true);
```

- [ ] **Step 2: Write owner and snapshot tests**

Require:

```ts
const registry = createThemeRegistry();
const owner = { kind: 'plugin', id: 'acme' } as const;
const dispose = registry.register(theme('acme.slate'), owner);
const afterAdd = registry.getSnapshot();
expect(afterAdd.themes.some((entry) => entry.id === 'acme.slate')).toBe(true);
expect(registry.getSnapshot()).toBe(afterAdd);

dispose();
dispose();
expect(registry.has('acme.slate')).toBe(false);
expect(registry.getSnapshot()).not.toBe(afterAdd);
```

Also test `unregisterOwner`, built-in removal rejection, wrong-owner rejection, duplicate ID rejection, deterministic built-in/user/plugin grouping, listener exception isolation, and no `document` writes.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
pnpm --filter @omniviewdev/base-ui exec vitest run \
  src/theme/registry/catalog.test.ts \
  src/theme/registry/registry.test.ts \
  src/theme/useThemeList.test.tsx
```

Expected: FAIL against the current apply/active registry.

- [ ] **Step 4: Implement immutable catalog metadata**

`catalog.ts` exports `BUILT_IN_THEMES`, `BUILT_IN_THEME_IDS`, and `isBuiltInThemeId`. Every summary contains:

```ts
{
  id: 'void',
  name: 'Void',
  base: 'void',
  appearance: 'dark',
  description: 'Ultra-deep warm-neutral theme',
  builtIn: true,
  owner: { kind: 'builtin', id: 'base-ui' },
}
```

Use `Object.freeze` for the array, entries, and owner objects.

- [ ] **Step 5: Implement owner-aware mutation and stable snapshots**

Keep registry state in `Map<string, RegisteredTheme>`. Build and freeze a new snapshot only from `invalidateSnapshot()` after successful mutation. `register()` validates custom definitions, adds source metadata, notifies subscribers, and returns an idempotent owner-bound disposer. `unregisterOwner()` removes all matching non-built-ins and emits one notification for the batch.

Sort summaries by:

1. built-in catalog order;
2. user display name then ID;
3. plugin display name then ID.

- [ ] **Step 6: Replace `useThemeList` with direct external-store consumption**

```ts
export function useThemeList(registry: ThemeRegistry = themeRegistry) {
  return useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  ).themes;
}
```

Bind methods in the registry implementation or expose arrow methods so `useSyncExternalStore` receives stable callable functions.

- [ ] **Step 7: Run tests, typecheck, and commit**

```bash
pnpm --filter @omniviewdev/base-ui exec vitest run \
  src/theme/registry/catalog.test.ts \
  src/theme/registry/registry.test.ts \
  src/theme/useThemeList.test.tsx \
  src/theme/useThemeRegistry.test.tsx
pnpm --filter @omniviewdev/base-ui typecheck
git add packages/base-ui/src/theme/registry \
  packages/base-ui/src/theme/useThemeList.ts \
  packages/base-ui/src/theme/useThemeList.test.tsx \
  packages/base-ui/src/theme/useThemeRegistry.ts
git commit -m "refactor(base-ui): make theme registry owner aware"
```

---

### Task 4: Implement the Controlled Provider and Root Applier

**Repository:** `/Users/joshuapare/Repos/omniviewdev/ui/main`

**Files:**
- Create: `packages/base-ui/src/theme/applyTheme.ts`
- Create: `packages/base-ui/src/theme/applyTheme.test.ts`
- Modify: `packages/base-ui/src/theme/ThemeProvider.tsx`
- Modify: `packages/base-ui/src/theme/ThemeProvider.test.tsx`
- Modify: `packages/base-ui/src/theme/context.ts`
- Modify: `packages/base-ui/src/theme/types.ts`
- Modify: `packages/base-ui/src/theme/index.ts`
- Modify: `packages/base-ui/src/theme/ThemeSwitcher.tsx`
- Modify: `packages/base-ui/src/test/render.tsx`
- Modify: `packages/base-ui/src/components/command-list/CommandList.test.tsx`
- Modify: `packages/base-ui/.storybook/preview.tsx`
- Modify: `apps/showcase/src/main.tsx`
- Modify: `apps/showcase/src/Dock.tsx`

**Interfaces:**
- Consumes: `ThemeRegistry`, `ThemeSummary`, `RegisteredTheme` from Task 3.
- Produces: controlled `ThemeProvider`; context fields `requestedThemeId`, `activeTheme`, `isFallback`, `setTheme`.
- Removes: `initialTheme`, `persist`, localStorage keys, registry `apply()` calls, hardcoded ThemeSwitcher options.

- [ ] **Step 1: Write applier behavior tests**

Test built-in/custom switching without clearing unrelated styles:

```ts
root.style.setProperty('--host-owned', 'keep');
const cleanup = createThemeRootApplier(root);
cleanup.apply(customTheme);
expect(root.dataset.ovTheme).toBe('dark');
expect(root.dataset.ovThemeCustom).toBe('acme.slate');
expect(root.style.getPropertyValue('--ov-color-bg-base')).toBe('#101114');

cleanup.apply(builtInVoid);
expect(root.dataset.ovTheme).toBe('void');
expect(root.dataset.ovThemeCustom).toBeUndefined();
expect(root.style.getPropertyValue('--ov-color-bg-base')).toBe('');
expect(root.style.getPropertyValue('--host-owned')).toBe('keep');
```

- [ ] **Step 2: Write controlled provider transition tests**

Use a `Harness` that controls `themeId` in state. Cover known selection, missing-ID fallback, late registration, active-theme removal, `setTheme` callback, Strict Mode, SSR/no document, density, motion, and no localStorage writes.

The late-registration assertion must distinguish requested and active values:

```ts
expect(read()).toEqual({
  requestedThemeId: 'plugin:acme/slate',
  activeThemeId: 'void',
  isFallback: true,
});

act(() => registry.register(pluginTheme, { kind: 'plugin', id: 'acme' }));
expect(read()).toEqual({
  requestedThemeId: 'plugin:acme/slate',
  activeThemeId: 'plugin:acme/slate',
  isFallback: false,
});
```

- [ ] **Step 3: Run focused tests and verify failure**

```bash
pnpm --filter @omniviewdev/base-ui exec vitest run \
  src/theme/applyTheme.test.ts src/theme/ThemeProvider.test.tsx
```

Expected: FAIL because the provider still owns persistence and registry activation.

- [ ] **Step 4: Implement root application and controlled resolution**

`ThemeProvider` calls `useSyncExternalStore` on the injected/default registry, resolves `themeId` or `fallbackThemeId`, and applies in `useInsertionEffect`. Keep density and motion as provider-local state initialized by `initialDensity`/`initialMotion` and apply their root attributes without persistence.

Memoize context on primitive IDs, summary object, fallback flag, density, and motion. `setTheme` calls only `onThemeChange`.

- [ ] **Step 5: Migrate every provider caller found by LSP**

Use explicit controlled harnesses:

```tsx
function ThemeHarness({ children }: PropsWithChildren) {
  const [themeId, setThemeId] = useState<BuiltInThemeId>('dark');
  return (
    <ThemeProvider themeId={themeId} onThemeChange={setThemeId}>
      {children}
    </ThemeProvider>
  );
}
```

Update `src/test/render.tsx`, CommandList tests, Storybook preview, and showcase root. Do not retain deprecated props.

- [ ] **Step 6: Make switchers registry-driven**

`ThemeSwitcher` and Showcase `Dock` render `useThemeList()` and use `requestedThemeId`/`setTheme`. Remove four hardcoded options and casts to the old `ThemeMode`.

- [ ] **Step 7: Run all affected tests with zero warnings and commit**

```bash
pnpm --filter @omniviewdev/base-ui exec vitest run \
  src/theme src/components/command-list/CommandList.test.tsx
pnpm --filter @omniviewdev/base-ui typecheck
pnpm --filter @omniviewdev/showcase build
git add packages/base-ui/src/theme \
  packages/base-ui/src/test/render.tsx \
  packages/base-ui/src/components/command-list/CommandList.test.tsx \
  packages/base-ui/.storybook/preview.tsx \
  apps/showcase/src/main.tsx apps/showcase/src/Dock.tsx
git commit -m "refactor(base-ui): make theme provider controlled"
```

Expected: no React `act()` warnings.

---

### Task 5: Ship and Verify the Nine Static Palettes

**Repository:** `/Users/joshuapare/Repos/omniviewdev/ui/main`

**Files:**
- Modify: `packages/base-ui/src/theme/styles.css`
- Modify: `packages/base-ui/src/theme/registry/catalog.test.ts`
- Modify: `packages/base-ui/src/theme/visual-regression/registry-visual.test.tsx`
- Modify: `packages/base-ui/.storybook/sampleCustomThemes.ts`
- Modify: `apps/showcase/src/sampleThemes.ts`
- Modify: `packages/base-ui/docs/THEMING.md`

**Interfaces:**
- Produces: explicit selectors for all nine built-ins and coherent computed editor/terminal tokens.
- Removes: runtime registration of Solarized showcase samples.

- [ ] **Step 1: Add failing selector and computed-token tests**

For each `BUILT_IN_THEMES` entry, render/apply the theme and assert non-empty computed values for:

```ts
const REQUIRED_SURFACE_TOKENS = [
  '--ov-color-bg-base',
  '--ov-color-fg-default',
  '--ov-color-editor-bg',
  '--ov-color-editor-fg',
  '--ov-color-editor-cursor',
  '--ov-color-editor-selection-bg',
  '--ov-color-terminal-bg',
  '--ov-color-terminal-fg',
  '--ov-color-terminal-cursor',
  '--ov-color-terminal-selection-bg',
  '--ov-syntax-keyword',
  '--ov-color-ansi-red',
] as const;
```

Parse `styles.css` and assert each ID appears in a `data-ov-theme='<id>'` selector. Accept the combined `:root, :root[data-ov-theme='dark']` block for Dark.

- [ ] **Step 2: Add failing contrast checks**

Use a small test-only hex/rgb luminance helper. Assert:

- standard `fg.default` / `bg.base` and `fg.default` / `bg.surface` are at least `4.5`;
- border/focus against adjacent surfaces is at least `3.0` where the token is a solid color;
- high-contrast primary text pairs are at least `7.0`.

- [ ] **Step 3: Run catalog/visual tests and observe missing Solarized selectors**

```bash
pnpm --filter @omniviewdev/base-ui exec vitest run \
  src/theme/registry/catalog.test.ts \
  src/theme/visual-regression/registry-visual.test.tsx
```

Expected: FAIL for Solarized selectors and incomplete variant surface overrides.

- [ ] **Step 4: Make Dark an explicit selector without duplicating declarations**

Change the opening block to:

```css
:root,
:root[data-ov-theme='dark'] {
  /* existing default tokens unchanged */
}
```

- [ ] **Step 5: Complete Obsidian, Carbon, and Void surface alignment**

Inside each existing block, add aliases using that palette's existing semantic colors:

```css
--ov-color-editor-bg: var(--ov-color-bg-base);
--ov-color-editor-fg: var(--ov-color-fg-default);
--ov-color-editor-cursor: var(--ov-color-accent-strong);
--ov-color-editor-selection-bg: var(--ov-color-accent-soft);
--ov-color-terminal-bg: var(--ov-color-bg-inset);
--ov-color-terminal-fg: var(--ov-color-fg-default);
--ov-color-terminal-cursor: var(--ov-color-accent-strong);
--ov-color-terminal-selection-bg: var(--ov-color-accent-soft);
--ov-color-terminal-selection-fg: var(--ov-color-fg-default);
--ov-color-terminal-border: var(--ov-color-border-default);
```

Do not duplicate the default-dark syntax or ANSI ramps; inheritance is deliberate.

- [ ] **Step 6: Add complete Solarized Dark and Light selectors**

Use the canonical palette:

```text
base03 #002b36  base02 #073642  base01 #586e75  base00 #657b83
base0  #839496  base1  #93a1a1  base2  #eee8d5  base3  #fdf6e3
yellow #b58900  orange #cb4b16  red    #dc322f  magenta #d33682
violet #6c71c4  blue   #268bd2  cyan   #2aa198  green   #859900
```

Solarized Dark uses `base03` base/inset, `base02` surfaces/editor/terminal, `base0` primary text, and `blue` focus/brand. Solarized Light uses `base3` base, `base2` surface/editor/terminal, `base00` primary text, and `blue` focus/brand.

Map syntax consistently in both selectors:

```css
--ov-syntax-comment: #586e75;
--ov-syntax-string: #2aa198;
--ov-syntax-string-escape: #cb4b16;
--ov-syntax-number: #d33682;
--ov-syntax-keyword: #859900;
--ov-syntax-keyword-control: #859900;
--ov-syntax-keyword-operator: #859900;
--ov-syntax-type: #b58900;
--ov-syntax-class: #b58900;
--ov-syntax-interface: #b58900;
--ov-syntax-function: #268bd2;
--ov-syntax-method: #268bd2;
--ov-syntax-variable: var(--ov-color-fg-default);
--ov-syntax-parameter: #cb4b16;
--ov-syntax-property: #268bd2;
--ov-syntax-namespace: #b58900;
--ov-syntax-decorator: #6c71c4;
--ov-syntax-regexp: #2aa198;
--ov-syntax-operator: #859900;
--ov-syntax-punctuation: var(--ov-color-fg-muted);
```

Map ANSI colors to the same canonical palette, using `base02`/`base01` for black/bright black in Dark and `base03`/`base01` in Light. Use red, green, yellow, blue, magenta, cyan, and base2/base00 for normal colors; orange, green, yellow, violet, magenta, cyan, and base3/base03 for bright colors.

- [ ] **Step 7: Remove showcase Solarized runtime registration**

Delete Solarized entries from `sampleThemes.ts` and registration loops from showcase/Storybook. Retain one non-built-in fixture named `example-ocean` for custom-theme documentation and registry visual coverage.

- [ ] **Step 8: Run generator, tests, showcase browser smoke, and commit**

```bash
pnpm --filter @omniviewdev/base-ui generate:token-keys
pnpm --filter @omniviewdev/base-ui test
pnpm --filter @omniviewdev/base-ui typecheck
pnpm --filter @omniviewdev/showcase build
```

Start `pnpm --filter @omniviewdev/showcase dev:fast`, open the showcase in a real browser, and select all nine menu entries. Verify the root selector and editor/terminal demo colors for each.

```bash
git add packages/base-ui/src/theme/styles.css \
  packages/base-ui/src/theme/generated/tokenKeys.ts \
  packages/base-ui/src/theme/registry/catalog.test.ts \
  packages/base-ui/src/theme/visual-regression/registry-visual.test.tsx \
  packages/base-ui/.storybook/sampleCustomThemes.ts \
  packages/base-ui/docs/THEMING.md \
  apps/showcase/src/sampleThemes.ts
git commit -m "feat(base-ui): ship nine complete built-in themes"
```

---

### Task 6: Make Editors Subscribe to the Resolved Theme

**Repository:** `/Users/joshuapare/Repos/omniviewdev/ui/main`

**Files:**
- Modify: `packages/editors/src/themes/useEditorTheme.ts`
- Modify: `packages/editors/src/themes/types.ts`
- Modify: `packages/editors/src/themes/index.ts`
- Modify: `packages/editors/src/index.ts`
- Modify: `packages/editors/src/components/code-editor/CodeEditor.tsx`
- Modify: `packages/editors/src/components/code-editor/CodeEditor.test.tsx`
- Modify: `packages/editors/src/components/diff-viewer/DiffViewer.tsx`
- Modify: `packages/editors/src/components/diff-viewer/DiffViewer.test.tsx`
- Modify: `packages/editors/src/components/terminal/Terminal.tsx`
- Modify: `packages/editors/src/components/terminal/Terminal.test.tsx`

**Interfaces:**
- Consumes: `useTheme().activeTheme` from Task 4.
- Produces: `useEditorTheme(): { id: string; base: BuiltInThemeId }`.
- Preserves: the public hook plus `buildMonacoTheme(base)` and `buildXtermTheme()` token adapters.

- [ ] **Step 1: Add same-base custom-switch regression tests**

Render each editor under a controlled provider. Register two custom themes with base `dark` but different editor/terminal tokens. Switch `themeId` from the first to the second and assert:

```ts
expect(monaco.editor.defineTheme).toHaveBeenLastCalledWith(
  OV_MONACO_THEME,
  expect.objectContaining({
    colors: expect.objectContaining({ 'editor.background': '#222222' }),
  }),
);
expect(mockTerminal.options.theme).toEqual(
  expect.objectContaining({ background: '#222222' }),
);
```

- [ ] **Step 2: Run focused tests and verify current observation failure**

```bash
pnpm --filter @omniviewdev/editors exec vitest run \
  src/components/code-editor/CodeEditor.test.tsx \
  src/components/diff-viewer/DiffViewer.test.tsx \
  src/components/terminal/Terminal.test.tsx
```

Expected: the same-base custom switch does not rebuild because the current hook exposes only the base DOM attribute.

- [ ] **Step 3: Replace MutationObserver state with Base UI context**

Use the peer dependency directly:

```ts
import { useTheme } from '@omniviewdev/base-ui';

export function useEditorTheme() {
  const { activeTheme } = useTheme();
  return { id: activeTheme.id, base: activeTheme.base } as const;
}
```

Pass `theme.base` to `buildMonacoTheme`; include `theme.id` in the theme-rebuild effect dependency so same-base custom switches re-read computed CSS variables.

- [ ] **Step 4: Add explicit update effects without recreating editors**

For CodeEditor and DiffViewer:

```ts
useEffect(() => {
  if (!isReady) return;
  monaco.editor.defineTheme(OV_MONACO_THEME, buildMonacoTheme(theme.base));
  monaco.editor.setTheme(OV_MONACO_THEME);
}, [isReady, theme.id, theme.base]);
```

For Terminal, keep the existing options assignment but depend on `theme.id` and `theme.base`. Do not add theme to the mount effect.

- [ ] **Step 5: Run tests/build and commit**

```bash
pnpm --filter @omniviewdev/editors test
pnpm --filter @omniviewdev/editors typecheck
pnpm --filter @omniviewdev/base-ui build
pnpm --filter @omniviewdev/editors build
git add packages/editors/src
git commit -m "feat(editors): follow resolved application themes"
```

---

### Task 7: Version and Document the UI Package Cutover

**Repository:** `/Users/joshuapare/Repos/omniviewdev/ui/main`

**Files:**
- Create: `.changeset/theme-system-v1.md`
- Modify: `packages/base-ui/docs/THEMING.md`
- Modify: root `docs/THEMING.md`

**Interfaces:**
- Produces expected release versions: Base UI `0.3.0`, Editors `1.1.0` after Changesets versioning.

- [ ] **Step 1: Add the release changeset**

```md
---
"@omniviewdev/base-ui": minor
"@omniviewdev/editors": minor
---

Replace the persisted uncontrolled theme provider with a controlled, owner-aware theme engine; add nine built-in themes and versioned custom-theme validation. Editors now rebuild Monaco and Xterm themes from the resolved Base UI theme.
```

- [ ] **Step 2: Document the exact public API**

Include controlled-provider usage, the `ThemeDefinitionV1` JSON shape, generated token discovery, plugin-owner registration, fallback semantics, and removal of `persist`, `initialTheme`, split token maps, registry `apply`, and registry `active`.

- [ ] **Step 3: Run the complete UI validation gate**

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm audit:ui
pnpm test
pnpm --filter @omniviewdev/base-ui build
pnpm --filter @omniviewdev/editors build
pnpm --filter @omniviewdev/showcase build
```

Expected: all commands pass and theme tests emit no warnings.

- [ ] **Step 4: Commit**

```bash
git add .changeset/theme-system-v1.md packages/base-ui/docs/THEMING.md docs/THEMING.md
git commit -m "docs(ui): document production theme system"
```

Do not publish from a development task. Merge and publish the UI package changes through the repository release workflow before committing Omniview dependency versions.

---

### Task 8: Migrate Omniview Backend Theme Settings

**Repository:** `/Users/joshuapare/Repos/omniviewdev/omniview`

**Files:**
- Modify: `internal/settings/appearance.go`
- Create: `internal/settings/appearance_test.go`
- Modify: `internal/settings/editor.go`
- Modify: `internal/settings/terminal.go`
- Modify: `internal/bootstrap/bootstrap.go`
- Create or modify: `internal/bootstrap/bootstrap_test.go`
- Modify: `main.go`

**Interfaces:**
- Produces: `appearance.theme` default `void`; `editor.theme` and `terminal.theme` default `application`; persisted migration `default → void`, `solarized → solarized-dark`.

- [ ] **Step 1: Write failing appearance contract tests**

```go
func TestAppearanceThemeDefaultsToVoid(t *testing.T) {
    setting := Appearance.Settings["theme"]
    require.Equal(t, "void", setting.Default)
    require.Empty(t, setting.Options)
    require.NoError(t, setting.Validator("plugin:acme/slate"))
    require.Error(t, setting.Validator("bad theme id"))
}

func TestMigrateAppearanceValues(t *testing.T) {
    tests := map[string]string{
        "default": "void",
        "solarized": "solarized-dark",
        "void": "void",
        "plugin:acme/slate": "plugin:acme/slate",
    }
    for input, want := range tests {
        values, changed := MigrateAppearanceValues(map[string]any{"theme": input})
        require.Equal(t, want, values["theme"])
        require.Equal(t, input != want, changed)
    }
}
```

Add settings tests asserting terminal/editor default to `application` and keep explicit override options after it.

- [ ] **Step 2: Write bootstrap persistence migration test**

Load an Appearance category containing `solarized`, call `registerCoreSettings`, then assert the provider value is `solarized-dark` and the bbolt store is rewritten with `solarized-dark`.

- [ ] **Step 3: Run focused Go tests and verify failure**

```bash
GOWORK=off go test ./internal/settings ./internal/bootstrap -count=1
```

- [ ] **Step 4: Implement validators and migration**

Use this validator:

```go
var themeIDPattern = regexp.MustCompile(`^[A-Za-z0-9._~%:/-]+$`)

func validateThemeID(value any) error {
    id, ok := value.(string)
    if !ok {
        return settings.ErrSettingTypeMismatch
    }
    if id == "" || len(id) > 256 || !themeIDPattern.MatchString(id) {
        return fmt.Errorf("invalid theme ID")
    }
    return nil
}
```

`MigrateAppearanceValues` returns a copied map and change flag; never rewrite unknown IDs. In `registerCoreSettings`, migrate loaded Appearance values before hydration and call `SaveCategory` immediately when changed.

Add `application` as the first terminal option and an editor theme setting whose options are `application`, `brilliance-black`, and `github-dark`.

- [ ] **Step 5: Remove forced macOS dark appearance**

Delete `Appearance: application.NSAppearanceNameDarkAqua` from the macOS window options. Do not add platform-specific runtime reflection.

- [ ] **Step 6: Run Go tests/build and commit**

```bash
GOWORK=off go test ./internal/settings ./internal/bootstrap -count=1
GOWORK=off go test ./... -count=1
GOWORK=off go build .
git add internal/settings/appearance.go internal/settings/appearance_test.go \
  internal/settings/editor.go internal/settings/terminal.go \
  internal/bootstrap/bootstrap.go internal/bootstrap/bootstrap_test.go main.go
git commit -m "feat(settings): migrate application theme preferences"
```

---

### Task 9: Add First-Paint Cache and Controlled App Theme Controller

**Repository:** `/Users/joshuapare/Repos/omniviewdev/omniview`

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `ui/theme/themeBootstrap.ts`
- Create: `ui/theme/themeBootstrap.test.ts`
- Create: `ui/theme/AppThemeController.tsx`
- Create: `ui/theme/AppThemeController.test.tsx`
- Modify: `ui/theme/__tests__/AppTheme.test.tsx`
- Modify: `index.html`
- Modify: `ui/App.tsx`
- Remove: `ui/theme/AppTheme.tsx`
- Remove: `ui/theme/solarized.ts`

**Interfaces:**
- Consumes: published `@omniviewdev/base-ui@^0.3.0` controlled provider.
- Produces: `AppThemeContext` with `requestedThemeId`, `activeTheme`, `isFallback`, `selectTheme(id): Promise<void>`.

- [ ] **Step 1: Upgrade UI dependencies and restore test runtime**

Set:

```json
"@omniviewdev/base-ui": "^0.3.0",
"@omniviewdev/editors": "^1.1.0"
```

Add `"jsdom": "^27.0.0"` to devDependencies, run `pnpm install`, and verify the existing AppTheme test starts before replacing it:

```bash
pnpm exec vitest run ui/theme/__tests__/AppTheme.test.tsx
```

Expected before migration: assertions fail against the new provider API, but jsdom starts successfully.

- [ ] **Step 2: Write bootstrap helper tests**

Cover valid nine-ID cache reads, malformed JSON, wrong schema, custom IDs falling back to Void, legacy `ov-theme-variant`, legacy known `ov-theme-mode`, write behavior for built-in/custom selection, and legacy key removal after settings hydration.

Use this storage record:

```ts
interface ThemeBootstrapRecordV1 {
  schemaVersion: 1;
  themeId: BuiltInThemeId;
}
```

- [ ] **Step 3: Write controller transition tests**

Mock `SettingsProvider.SetSetting` and `useSettings`. Assert:

1. `{}` settings start from bootstrap ID;
2. loaded canonical backend value wins;
3. `selectTheme('light')` applies before the promise settles;
4. success writes cache and reloads settings;
5. rejection rolls back and leaves cache unchanged;
6. `solarized` normalizes to `solarized-dark`;
7. unknown backend IDs remain requested while active is Void.

- [ ] **Step 4: Run focused tests and verify failure**

```bash
pnpm exec vitest run \
  ui/theme/themeBootstrap.test.ts \
  ui/theme/AppThemeController.test.tsx
```

- [ ] **Step 5: Implement bootstrap helpers**

Export pure functions:

```ts
readBootstrapTheme(storage: Storage): BuiltInThemeId;
writeBootstrapTheme(storage: Storage, selectedId: string): void;
readLegacyPaintHint(storage: Storage): BuiltInThemeId | null;
clearLegacyThemeKeys(storage: Storage): void;
```

`writeBootstrapTheme` stores the selected built-in or `void` for custom IDs.

- [ ] **Step 6: Apply the synchronous paint hint in `index.html`**

Change the root to `data-ov-theme="void"`, change loading background to Void `#0e0f11`, and add a small classic head script before stylesheet/module loading. The script parses only `{ schemaVersion: 1, themeId }`, checks a literal nine-ID map, sets `data-ov-theme`, and sets `style.colorScheme` from a literal light-ID set. It must catch storage/JSON errors and leave Void unchanged.

- [ ] **Step 7: Implement optimistic controlled selection**

`AppThemeController` owns local requested ID and wraps Base UI:

```tsx
<ThemeProvider
  themeId={requestedThemeId}
  fallbackThemeId="void"
  onThemeChange={(id) => void selectTheme(id)}
  initialDensity="compact"
>
  <ThemeStateBridge>{children}</ThemeStateBridge>
</ThemeProvider>
```

`selectTheme` captures the prior ID, sets the next ID synchronously, awaits `SettingsProvider.SetSetting('appearance.theme', id)`, writes bootstrap/reloads on success, and restores the prior ID plus reports through the existing snackbar error path on failure. Deduplicate or serialize concurrent selections so a stale rejected request cannot roll back a newer successful choice.

- [ ] **Step 8: Replace provider composition and delete obsolete modules**

Replace `<AppTheme>` in `ui/App.tsx` with `<AppThemeController>`. Delete `AppTheme.tsx` and `solarized.ts`; replace their old test with controller/provider integration assertions. Remove every `ov-theme-variant` write outside bootstrap migration.

- [ ] **Step 9: Run tests/build and commit**

```bash
pnpm exec vitest run ui/theme
pnpm run build
git add package.json pnpm-lock.yaml index.html ui/App.tsx ui/theme
git commit -m "feat(ui): add controlled application theme controller"
```

---

### Task 10: Add the Immediate Appearance Theme Picker

**Repository:** `/Users/joshuapare/Repos/omniviewdev/omniview`

**Files:**
- Create: `ui/theme/AppearanceThemeSetting.tsx`
- Create: `ui/theme/AppearanceThemeSetting.test.tsx`
- Modify: `ui/pages/settings/CoreSettingsPage.tsx`
- Modify: `ui/pages/settings/SettingsEntries.tsx`
- Modify: `ui/store/settings/sections/appearance.ts`

**Interfaces:**
- Consumes: app theme controller context and `useThemeList()`.
- Produces: immediate picker; unavailable selected row.

- [ ] **Step 1: Write picker behavior tests**

Render with built-ins plus user/plugin fixtures. Assert the order is built-ins, users alphabetically, plugins alphabetically; the requested missing ID appears as a disabled `Unavailable: plugin:missing/theme` option; selecting Obsidian calls `selectTheme('obsidian')` immediately.

- [ ] **Step 2: Write settings-page integration test**

Render Appearance category data with `theme` and one ordinary field. Assert the theme control bypasses draft state while the ordinary field still enables `Save Changes`.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
pnpm exec vitest run \
  ui/theme/AppearanceThemeSetting.test.tsx \
  ui/pages/settings/CoreSettingsPage.test.tsx
```

If `CoreSettingsPage.test.tsx` does not exist, create it with only consumer-visible form behavior described above.

- [ ] **Step 4: Implement dedicated control routing**

Add an optional render override to `SettingsEntries` keyed by full setting ID, or handle exactly `categoryID === 'appearance' && id === 'theme'` in `CoreSettingsPage`. Prefer the explicit override map:

```tsx
<SettingsEntries
  ...
  renderSetting={{
    'appearance.theme': () => <AppearanceThemeSetting />,
  }}
/>
```

Exclude `appearance.theme` from `draftValues` and `SetSettings` payloads.

- [ ] **Step 5: Remove dead Redux theme/mode definitions**

Delete the `mode` and `theme` entries from the legacy Redux Appearance section. Retain `headerSearch`, `showSettingIds`, the Appearance section itself, and its root-slice import; those non-theme fields are still part of the legacy settings state.

- [ ] **Step 6: Run tests/build and commit**

```bash
pnpm exec vitest run ui/theme ui/pages/settings
pnpm run build
git add ui/theme/AppearanceThemeSetting.tsx \
  ui/theme/AppearanceThemeSetting.test.tsx \
  ui/pages/settings/CoreSettingsPage.tsx \
  ui/pages/settings/SettingsEntries.tsx \
  ui/pages/settings/CoreSettingsPage.test.tsx \
  ui/store/settings/sections/appearance.ts \
  ui/store/settings/slice.ts
git commit -m "feat(settings): apply application themes immediately"
```

Stage only paths that still exist.

---

### Task 11: Bridge Plugin Theme Contributions into the Registry

**Repository:** `/Users/joshuapare/Repos/omniviewdev/omniview`

**Files:**
- Create: `ui/features/extensions/theme/extensionPoint.ts`
- Create: `ui/features/extensions/theme/ThemeContributionBridge.tsx`
- Create: `ui/features/extensions/theme/ThemeContributionBridge.test.tsx`
- Modify: `ui/features/extensions/registerBuiltinExtensionPoints.ts`
- Modify: `ui/features/extensions/builtinExtensionPoints.test.ts`
- Modify: `ui/theme/AppThemeController.tsx`

**Interfaces:**
- Produces: extension point ID `omniview/theme` with value `Omit<ThemeDefinitionV1, 'id'>`.
- Canonical ID: `plugin:${encodeURIComponent(pluginId)}/${encodeURIComponent(localContributionId)}`. PluginService normalizes store IDs to `${pluginId}/${localContributionId}`; the bridge must remove that exact prefix before encoding.

- [ ] **Step 1: Write extension point registration tests**

Assert `ensureBuiltinExtensionPointsRegistered` creates `omniview/theme` in multiple mode, owned by core, and remains idempotent.

- [ ] **Step 2: Write bridge lifecycle tests**

Use a real `ExtensionPointRegistry` and injected Base UI `createThemeRegistry`. Cover:

```ts
store.register({
  id: 'acme/slate',
  plugin: 'acme',
  label: 'Slate',
  value: {
    schemaVersion: 1,
    name: 'Slate',
    base: 'void',
    tokens: { 'color.bg.base': '#101114' },
  },
});
expect(themeRegistry.has('plugin:acme/slate')).toBe(true);

store.removeContributionsByPlugin('acme');
expect(themeRegistry.has('plugin:acme/slate')).toBe(false);
```

Also assert replacement on reload, bridge-unmount disposal, invalid contribution isolation, and that one invalid plugin does not remove another plugin's valid themes.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
pnpm exec vitest run \
  ui/features/extensions/builtinExtensionPoints.test.ts \
  ui/features/extensions/theme/ThemeContributionBridge.test.tsx
```

- [ ] **Step 4: Implement extension point and bridge diff**

Create the point with:

```ts
export const THEME_EXTENSION_POINT_ID = 'omniview/theme';

export function createThemeExtensionPoint(): ExtensionPointSettings<
  ExtensionRenderContext,
  ThemeContribution
> {
  return { id: THEME_EXTENSION_POINT_ID, pluginId: 'core', mode: 'multiple' };
}
```

In the bridge, subscribe via `useExtensionPoint<ThemeContribution>()`, compare current registrations by `plugin + '\0' + id`, dispose removed/replaced registrations, and register additions with plugin ownership. Derive `localContributionId` by removing the exact `${registration.plugin}/` prefix that PluginService normalization adds to `registration.id`; preserve an unprefixed ID for direct host/test registrations. Catch `ThemeValidationError`, log structured identifiers, and continue the diff.

- [ ] **Step 5: Mount bridge under both providers**

`AppThemeController` already runs inside `ExtensionProvider`. Render `ThemeContributionBridge` inside the controlled Base UI provider so it can use the shared registry while plugin contributions load.

- [ ] **Step 6: Run tests/build and commit**

```bash
pnpm exec vitest run ui/features/extensions ui/theme
pnpm run build
git add ui/features/extensions/theme \
  ui/features/extensions/registerBuiltinExtensionPoints.ts \
  ui/features/extensions/builtinExtensionPoints.test.ts \
  ui/theme/AppThemeController.tsx
git commit -m "feat(plugins): add theme contribution extension point"
```

---

### Task 12: Unify Omniview Monaco and Xterm with Optional Overrides

**Repository:** `/Users/joshuapare/Repos/omniviewdev/omniview`

**Files:**
- Modify: `ui/components/displays/CodeEditor.tsx`
- Create: `ui/components/displays/CodeEditor.test.tsx`
- Preserve: `ui/components/displays/themes/BrillianceBlack.ts`
- Preserve: `ui/components/displays/themes/GithubDark.ts`
- Modify: `ui/federation/LinkedResourceDrawer.tsx`
- Modify: `ui/providers/BottomDrawer/containers/Terminal.tsx`
- Modify: `ui/providers/BottomDrawer/containers/terminalThemes.ts`
- Modify: `ui/providers/BottomDrawer/containers/__tests__/Terminal.test.tsx`

**Interfaces:**
- Consumes: `useTheme().activeTheme`, `buildMonacoTheme`, `OV_MONACO_THEME`, `buildXtermTheme` from published UI packages.
- Setting sentinel: `application`.

- [ ] **Step 1: Add Monaco inheritance tests**

Mock Monaco and set `editor.theme = application`. Assert the editor defines/applies `OV_MONACO_THEME`, then redefine/reapply after the active theme ID changes. With `editor.theme = github-dark`, assert the explicit override remains selected after the app theme changes.

- [ ] **Step 2: Add terminal inheritance tests**

Replace the old default expectation with:

```ts
expect(Terminal).toHaveBeenCalledWith(
  expect.objectContaining({
    theme: expect.objectContaining({
      background: resolvedApplicationBackground,
      foreground: resolvedApplicationForeground,
    }),
  }),
);
```

Assert app theme changes update `term.options.theme`; an explicit `dracula` setting remains Dracula.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
pnpm exec vitest run \
  ui/components/displays/CodeEditor.test.tsx \
  ui/providers/BottomDrawer/containers/__tests__/Terminal.test.tsx
```

- [ ] **Step 4: Migrate the legacy CodeEditor**

When `settings['editor.theme'] === 'application'`, define `OV_MONACO_THEME` with `buildMonacoTheme(activeTheme.base)` and reapply it when `activeTheme.id` changes. Keep `BrillianceBlack.ts` and `GithubDark.ts`; LSP shows both are consumed only by this component, and they remain required for the explicit `brilliance-black` and `github-dark` override paths.

- [ ] **Step 5: Migrate linked-resource editors**

Remove every `theme='vs-dark'` prop from `LinkedResourceDrawer`. Pass the resolved application or explicit editor theme consistently to Editor and DiffEditor.

- [ ] **Step 6: Add `application` terminal resolution**

Change `getTerminalTheme` to:

```ts
export function getTerminalTheme(name: string): ITheme {
  return name === 'application'
    ? buildXtermTheme()
    : terminalThemes[name] ?? buildXtermTheme();
}
```

Remove `default` from `terminalThemes` and make `application` the first option. Ensure loading, error, initial construction, reconnect, and live update paths all call the same resolver.

- [ ] **Step 7: Run tests/build and commit**

```bash
pnpm exec vitest run \
  ui/components/displays \
  ui/providers/BottomDrawer/containers \
  ui/federation
pnpm run build
git add ui/components/displays ui/federation/LinkedResourceDrawer.tsx \
  ui/providers/BottomDrawer/containers/Terminal.tsx \
  ui/providers/BottomDrawer/containers/terminalThemes.ts \
  ui/providers/BottomDrawer/containers/__tests__/Terminal.test.tsx
git commit -m "feat(ui): unify editor and terminal theme defaults"
```

---

### Task 13: Regenerate Plugin Shims and Update Documentation

**Repository:** `/Users/joshuapare/Repos/omniviewdev/omniview`

**Files:**
- Modify generated: `packages/omniviewdev-vite-plugin/shims/_omniviewdev__base-ui.mjs`
- Verify: `ui/features/plugins/api/shared_dependencies.ts`
- Verify: `packages/omniviewdev-vite-plugin/src/sharedPackages.ts`
- Modify: `docs/plugin-development.md`

**Interfaces:**
- Exposes the new Base UI theme exports to dev-mode plugins.

- [ ] **Step 1: Build Runtime before Vite Plugin**

```bash
pnpm --filter @omniviewdev/runtime build
pnpm --filter @omniviewdev/vite-plugin build
```

The Vite plugin build regenerates and verifies shims. Never invoke a raw shim generator that bypasses package scripts.

- [ ] **Step 2: Verify generated exports**

The Base UI shim must expose the controlled provider, registry, `useTheme`, `useThemeList`, theme validation error/type runtime exports, and built-in catalog values. Type-only exports do not appear in the JavaScript shim.

Confirm both shared-package lists still contain the same Base UI, AI UI, and Editors package names; no list edit is needed unless the package specifiers changed.

- [ ] **Step 3: Document plugin contribution format**

Add a concrete plugin registration example:

```ts
export const extensionRegistrations = [
  {
    extensionPointId: 'omniview/theme',
    registration: {
      id: 'slate',
      label: 'Slate',
      value: {
        schemaVersion: 1,
        name: 'Slate',
        base: 'void',
        author: 'Acme',
        version: '1.0.0',
        tokens: {
          'color.bg.base': '#101114',
          'color.bg.surface': '#16181d',
          'color.accent.strong': '#82a8ff',
        },
      },
    },
  },
] satisfies ExtensionRegistration<ThemeContribution>[];
```

Document canonical ID derivation, fallback on unload, validation failures, and automatic cleanup.

- [ ] **Step 4: Commit generated/docs changes**

```bash
git add packages/omniviewdev-vite-plugin/shims/_omniviewdev__base-ui.mjs \
  ui/features/plugins/api/shared_dependencies.ts \
  packages/omniviewdev-vite-plugin/src/sharedPackages.ts \
  docs/plugin-development.md
git commit -m "docs(plugins): document theme contributions"
```

Stage the shared-package list files only if their content changed.

---

### Task 14: Final Cross-Repository Verification

**Repositories:** both roots

**Files:** no production edits unless a verification failure identifies a defect in changed code.

- [ ] **Step 1: Run complete UI repository checks**

From `/Users/joshuapare/Repos/omniviewdev/ui/main`:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm audit:ui
pnpm test
pnpm --filter @omniviewdev/base-ui build
pnpm --filter @omniviewdev/editors build
pnpm --filter @omniviewdev/showcase build
```

- [ ] **Step 2: Browser-smoke all built-ins in Showcase**

Run the showcase, open it in a real browser, and select each theme in catalog order. For every selection record:

- `data-ov-theme` equals the selected built-in ID;
- `data-ov-theme-custom` is absent;
- chrome background changes to the expected palette;
- Monaco background matches `--ov-color-editor-bg`;
- Xterm background matches `--ov-color-terminal-bg`;
- Light and Solarized Light set `color-scheme: light`;
- all other built-ins set `color-scheme: dark`.

- [ ] **Step 3: Run complete Omniview checks**

From `/Users/joshuapare/Repos/omniviewdev/omniview`:

```bash
pnpm run lint
pnpm run test
pnpm run build
GOWORK=off go test ./... -count=1
GOWORK=off go build .
```

- [ ] **Step 4: Desktop-smoke the actual Wails app**

Run:

```bash
task dev
```

Exercise this scenario in the running desktop app:

1. Fresh profile starts in Void without a dark-to-void flash.
2. Select Light; chrome, Monaco, and terminal change immediately.
3. Restart; Light is present on first paint and remains selected after settings load.
4. Select Solarized Dark; chrome, syntax, editor, and terminal all use Solarized values.
5. Set Terminal to Dracula; change app theme to Obsidian; terminal remains Dracula while chrome/editor change.
6. Return Terminal to Application; it immediately matches Obsidian.
7. Load a fixture plugin theme; select it; unload the plugin; rendering falls back to Void and the unavailable requested ID remains visible.
8. Reload the plugin; its selected theme activates automatically.
9. Select Light and inspect native hidden-inset chrome on macOS after removing forced DarkAqua.

- [ ] **Step 5: Confirm clean cutover**

Search must return no production references to:

```text
ov-theme-variant
ov-theme-mode
registerSolarizedTheme
SOLARIZED_THEME_ID
initialTheme=
persist=
themeRegistry.apply
themeRegistry.active
```

Allowed occurrences: migration tests and release/documentation history that explicitly describe removed APIs.

- [ ] **Step 6: Commit only fixes caused by verification**

If verification required code changes, rerun the affected focused check and commit those files with a message describing the actual defect. Do not create a no-op verification commit.
