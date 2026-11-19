# `ui-next/plugins/`: the host's side of the plugin seam

How the new shell shows the pages the installed plugins contribute. It is **host code and plugin-agnostic**: no plugin word appears in this directory (the vocabulary guard scans it, tests and comments included; the fixture plugin is the one exemption, because a plugin is not the host), and no plugin's code is in this repository: a real plugin reaches the host as an installed bundle, and CI runs one through this seam from outside this tree. The design, the evidence and the sequence of steps are in `docs/ui-next/slices/n19-plugin-seam.md`; this page is the map.

**The default screen.** The native window loads `/` and cannot take a parameter, so nothing in the URL decides what it shows: it opens the first page a loaded plugin contributes as a tab (the first plugin in the order the plugins declare for the window's rail, `contribution.rail.order`, not the first by id; chosen once every plugin has settled; the plugin's `home` names the page), and shows the kit's empty state under the name "Plugins" when no plugin contributes. The window's rail (`host/rail.ts`) has one entry for each plugin that contributes, and choosing one shows that plugin's sidebar without closing a tab. Closing the last tab leaves an empty window (`host/NoTabs.tsx`: the plugins that can be opened) and opens no page by itself; Command or Control W there closes the window (decision A17). While a plugin loads the shell draws its frame with the regions reserved, so nothing moves when it arrives. A browser can say more in the hash, `#/<plugin>/<page>?connection=<id>`: a deep link at load, and a hash typed later; each opens a tab through the tab model. The window never writes the hash.

| Path | What |
|---|---|
| `contract/v1.ts` | The first contribution contract: the types a plugin's bundle hands the host (`contributionV1`). Types only; written to move to the surface plugins import |
| `contract/admit.ts` | Admission: what a bundle's exports must be before the host builds anything from them. Pure |
| `loader/specifiers.ts` | The five modules the host shares with a plugin's bundle (the ABI of contract v1). Imports nothing, so a plugin's build reads it with Node |
| `loader/shared.ts` | How each shared module is served (the host's own instance, on first use) and registered in SystemJS |
| `loader/importBundle.ts` | Fetches and links a plugin's `assets/entry.js`; refuses a bundle that imports what the host does not serve, before it runs (`preflight.ts`); `clearBundle` |
| `loader/failure.ts` | The five kinds of load failure and the sentence for each |
| `host/pluginStore.ts` | What each installed plugin's interface came to: loading, ready, failed; a bounded pool of loads |
| `host/PluginHost.tsx` | The shell's tab model over the plugins: the page of each mounted tab (the list page for a contribution, with one error boundary per page; the kit's collection state where there is no page), the registration of the tab on screen, the sidebar's data hook, what a sidebar entry and `+` open |
| `host/contributions.ts` | The tab model's `Contributions` over the loaded plugins: what a route is called (title, glyph, path, scope), whether it opens, the connection a sidebar entry inherits, the home page. `HOME_PAGE` stands for a plugin's first page before it has loaded |
| `host/published.ts` | What a mounted page or sidebar says about the frame around it (its tab, path and scope; the sidebar's entries), kept where the frame and the model can read it |
| `host/PlaceholderPage.tsx` | The page the host draws when it has no page of a plugin: loading, did not load, or the page failed |
| `host/PluginHostScreen.tsx` | The window's default screen (`main.tsx` mounts it for every URL but `?screen=parts` and `?screen=tooltip-stress`): inventory, store, the address, providers |
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
5. A page is a `list` or a `detail` page. A detail page is the page of one object: a route names it by a page id and the object's identity as string parameters (`RouteV1.params`), the tab is called `{name} · {Kind}` from the route and the definition alone, and it has no sidebar entry (it needs an object; `home` is never one). It was added to version 1 as a minor addition: the rule that decides minor or a new `contributionV2` is written at the head of `contract/v1.ts`, and `admit.test.ts` keeps a bundle written before it.
6. A link inside a plugin's page is the kit's `Link` in the host's `LinkProvider` (`host/links.ts`): it names a page of its own plugin and that page's parameters, carries the address as its `href` (`#/<plugin>/<page>?connection=<id>&<name>=<value>`, the grammar the hash is read in), and a plain click or Enter is smart open, Command or Control or a middle click opens a background tab.
