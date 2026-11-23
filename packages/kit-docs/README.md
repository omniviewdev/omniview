# Omniview Kit documentation pilot

This private workspace builds a standalone Button reference, Storybook workshop, and static agent documentation for `@omniviewdev/kit`. It does not ship with the desktop app or change the plugin API.

## Run the complete preview

From the repository root, using the Node and pnpm versions in `.tool-versions`:

```sh
pnpm --filter @omniviewdev/kit-docs... install --frozen-lockfile --ignore-scripts
pnpm --filter @omniviewdev/kit-docs build
pnpm --filter @omniviewdev/kit-docs preview --host 127.0.0.1
```

Open the URL printed by Vite. The page links to the Button workshop at `./storybook/?path=/story/kit-button--primary` and the agent index at `./llms.txt`. Follow the index for revision-specific Markdown and token data. Preview token changes are local experiments, not a persisted Kit theme.

For authoring, run `pnpm --filter @omniviewdev/kit-docs dev` for the page or `pnpm --filter @omniviewdev/kit-docs storybook` for the workshop. Use the complete build to check links across both surfaces.

## Share a build

`packages/kit-docs/dist/` is the complete static site. Serve the directory over HTTP, not `file://`. The **Kit documentation preview** workflow uploads it as a seven-day PR artifact. After extraction, serve the artifact root with `python3 -m http.server 4173 --bind 127.0.0.1`. This workflow does not publish unreviewed code to a public domain.
