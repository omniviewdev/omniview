# @omniviewdev/kit

The new UI library of Omniview (`docs/ui-next/AGENTS.md` is the steering document; read it first). This file is the rule for part authors.

## Adding a part: add a directory, never edit the root barrel

Parallel pull requests each add a part, so no file may list every part by hand. The public entry and the examples registry are **generated from the part directories**:

```
src/components/<Part>/
  <Part>.tsx               the part
  <Part>.module.css        its styles
  <Part>.examples.tsx      its typed examples (one component without props per state; imported from "@omniviewdev/kit", never a relative path)
  <Part>.test.tsx          its tests
  index.ts                 its public exports, written by hand: the part's own surface, named, with `export type` for types
```

1. Create the directory with an `index.ts` (what plugins may import) and a `<Part>.examples.tsx`.
2. Run `pnpm --filter @omniviewdev/kit run refresh`. It writes `src/index.ts` (the public entry: one `export *` per directory, sorted), `src/generated/examples.ts` (the examples registry: one import per `*.examples.tsx`, sorted, keyed by the file name: `DataTable.parity.examples.tsx` is `DataTableParity`), and rebuilds the API reports (`api/kit.api.md`, `api/kit-examples.api.md`).
3. Commit the part and everything `refresh` changed.

Never edit `src/index.ts`, `src/generated/*` or `src/examples.ts` by hand: they are generated or hold only types, and CI (`generate:check`, `api:check`) fails when a generated file is stale. A directory without an `index.ts` is internal to its neighbours (`TableFit`): nothing of it is public. Foundation modules that are not parts (`src/theme`, `src/shared`) are the two fixed directories listed in `scripts/registry.ts`.

### A merge conflict in a generated file

Never merge a generated file by hand. Resolve the conflicts in your part's files, then run `pnpm --filter @omniviewdev/kit run refresh` and commit the result: both registries and both API reports are rebuilt from the merged directories.

## Action menus

`ui-next` provides one `MenuHost` per window. Register a local definition with `useMenu` **once per owning view**, not once per row. Give each trigger a stable record key. The resolver runs when a trigger opens, not when the table renders.

```tsx
const menu = useMenu(key => {
  const record = key === undefined ? undefined : records.get(key);
  if (!record) return [];
  return [{ kind: 'action', id: 'inspect', label: 'Inspect', onSelect: () => inspect(record.id) }];
});

// Inside the row renderer:
<button {...menuTrigger(menu, record.id)} aria-label={`Actions for ${record.name}`}>…</button>
```

Use `menuTrigger(menu, record.id, 'context')` on a keyboard-reachable element for secondary click, Shift+F10 and the Menu key. The same definition serves both invocations. Keep commands in the owning view; use `Select` for a form value and a palette for searchable commands.

The **Menu** section of `/?screen=parts` demonstrates toolbar overflow, grouped launch targets, nested commands, tab context actions, checked settings, and a virtualized 20,000-record table.

## Commands

```sh
pnpm --filter @omniviewdev/kit run generate   # tokens, the public entry and the examples registry
pnpm --filter @omniviewdev/kit run refresh    # generate, build, and rewrite the API reports
pnpm --filter @omniviewdev/kit run verify     # generate:check, tsc, stylelint, tests, build, API reports
```
