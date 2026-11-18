# `ui-next/plugins/`: the host's side of the plugin seam

How the new shell shows the pages the installed plugins contribute. It is **host code and plugin-agnostic**: no plugin word appears in this directory (the vocabulary guard scans it, tests and comments included; the fixture plugin is the one exemption, because a plugin is not the host), and no plugin's code is in this repository: a real plugin reaches the host as an installed bundle, and CI runs one through this seam from outside this tree. The design, the evidence and the sequence of steps are in `docs/ui-next/slices/n19-plugin-seam.md`; this page is the map.

**The default screen.** The native window loads `/` and cannot take a parameter, so nothing in the URL decides what it shows: it opens the first page a loaded plugin contributes (the first plugin by id that is ready, chosen once every plugin has settled; the plugin's `home` names the page), and shows the kit's empty state under the name "Plugins" when no plugin contributes. A browser can say more in the hash, `#/<plugin>/<page>?connection=<id>`.

| Path | What |
|---|---|
| `contract/v1.ts` | The first contribution contract: the types a plugin's bundle hands the host (`contributionV1`). Types only; written to move to the surface plugins import |
| `contract/admit.ts` | Admission: what a bundle's exports must be before the host builds anything from them. Pure |
| `loader/specifiers.ts` | The five modules the host shares with a plugin's bundle (the ABI of contract v1). Imports nothing, so a plugin's build reads it with Node |
| `loader/shared.ts` | How each shared module is served (the host's own instance, on first use) and registered in SystemJS |
| `loader/importBundle.ts` | Fetches and links a plugin's `assets/entry.js`; refuses a bundle that imports what the host does not serve, before it runs (`preflight.ts`); `clearBundle` |
| `loader/failure.ts` | The five kinds of load failure and the sentence for each |
| `host/pluginStore.ts` | What each installed plugin's interface came to: loading, ready, failed; a bounded pool of loads |
| `host/PluginHost.tsx` | The shell and the list page for a contribution, with one error boundary per contribution; the kit's collection state where there is no page |
| `host/PluginHostScreen.tsx` | The window's default screen (`main.tsx` mounts it for every URL but `?screen=parts` and `?screen=tooltip-stress`): inventory, store, route, providers |
| `fixture/` | A tiny plugin built **outside the host's bundle** by its own Vite config: `build.mjs` writes four installed plugin directories (healthy, a copy with its own kit, an old-shell bundle, no bundle) |
| `e2e/seam.check.mjs` | The real Go host in server mode loading the four fixture plugins, in WebKit and Chromium |

## Run the check

```sh
OMNIVIEW_UI=next task build:server           # bin/Omniview-server: the real host
node ui-next/plugins/e2e/seam.check.mjs      # needs Playwright's browsers; exit 0 is a pass
```

## Rules

1. A bundle exports `contributionV1` and nothing else is the host's business. The version is the export name.
2. A plugin imports its own files, the shared list and nothing else. Sharing the runtime's whole barrel would put the old UI library into the new build (1.88 MB, measured); the runtime joins as a curated entry.
3. The plugin's words never reach the page: a failure is a kind and a sentence the host wrote; the detail goes to the log.
4. A contribution's hook runs in the host's React, inside the contribution's own boundary.
