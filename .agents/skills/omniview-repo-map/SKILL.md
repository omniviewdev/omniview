---
name: omniview-repo-map
description: Use when locating Omniview feature or bug source across the host, shared UI, Go plugin SDK, Kubernetes, other plugins, runtime packages, or Vite shared dependencies, especially from the wrong checkout or an unfamiliar clone layout.
---

# Find the feature source

Resolve the selected feature before searching:

```sh
omniview-dev workspace paths "$FEATURE" --root "$COLLECTION" --json
```

No context? Read the explicit collection's `.omniview-dev/repositories.json` and `workspace list`; use **omniview-workspaces**. Missing/ambiguous selection is not permission to search every clone or edit canonical sources.

Read only the relevant row in [source map](references/source-map.md). Treat returned repository paths—not cwd, conventional directory names, origin URLs, or historical documentation—as authority. Registered repository IDs and committed `plugin.yaml` IDs differ; each selected plugin has its own path.

Return **resolved feature path → narrow implementation entry → reason**. Start with a targeted symbol/search inside that entry; expand only along actual callers. Do not enumerate entire repositories or load context files/whole plans to find a component. Runtime and Vite plugin packages live in the host repository, not the separate Go SDK. Legacy MUI/Emotion/`@omniviewdev/ui` are not host shared dependencies.
