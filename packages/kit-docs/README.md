# Omniview Kit component reference

This private workspace builds the interactive component reference, Storybook workshop, and static agent documentation for `@omniviewdev/kit`. It does not ship with the desktop app or change the plugin API.

## Run the complete preview

From the repository root, using the Node and pnpm versions in `.tool-versions`:

```sh
pnpm --filter @omniviewdev/kit-docs... install --frozen-lockfile --ignore-scripts
pnpm --filter @omniviewdev/kit-docs build
pnpm --filter @omniviewdev/kit-docs preview --host 127.0.0.1
```

Open the URL printed by Vite. Select a component from the catalog or link directly, for example `./?component=DataTable`. Each page connects its live examples with their source, appearance controls, and Storybook stories. Preview token changes are local experiments, not a persisted Kit theme.

For tools that do not render JavaScript, start at `./llms.txt`. Follow its pinned links to find component guidance, API declarations, examples, and token data for the same Kit revision.

For authoring, run `pnpm --filter @omniviewdev/kit-docs dev` for the page or `pnpm --filter @omniviewdev/kit-docs storybook` for the workshop. Use the complete build to check links across both surfaces.

## Maintain the reference

- Document public props where they are declared. The generator follows public component exports and reads their TypeScript signatures and JSDoc. The full API report remains authoritative for relationships between props in discriminated unions.
- Put the caption for a named example in the JSDoc immediately above its export in `*.examples.tsx`. No comment means no caption.
- Change token usage in the component or its styles, not in a second documentation list. Inspector evidence identifies the selector, property, and source file. Static usage describes a possible state, not necessarily the currently active declaration.
- Keep category, summary, and advice about choosing or composing components in `content/`. These are editorial decisions, not type facts.

## Share a build

`packages/kit-docs/dist/` is the complete static site. Serve the directory over HTTP, not `file://`. The **Kit documentation preview** workflow uploads it as a seven-day PR artifact. After extraction, serve the artifact root with `python3 -m http.server 4173 --bind 127.0.0.1`. This workflow does not publish unreviewed code to a public domain.
