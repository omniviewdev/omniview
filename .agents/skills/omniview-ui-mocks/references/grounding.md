# Ground the mock in the real app

Paths below are relative to the host checkout unless noted. Re-check them with a targeted search; source moves, this list does not.

## Capture real pixels

Select and observe the running instance with **omniview-instance-verification** first; capture is read-only observation and does not authorize resets or connections. Native MCP `screenshot_dom` returns DOM structure, **not pixels** — it cannot tell you colors, antialiasing or spacing as rendered.

Linux native app on an X display (the local dev setup uses Xvfb `:99`; use the display the instance actually runs on). `$PID` is the owned host process from the instance descriptor:

```sh
DISPLAY=:99 xdotool search --onlyvisible --pid "$PID"     # window id(s)
DISPLAY=:99 import -window "$XID" current.png
```

Browser-mode instance: screenshot the actual `instance.endpoints.browser` URL in a fresh context. Other OSes: use that OS's window capture; do not substitute a DOM dump.

Zoom into regions to read details (header, tab strip, footer, menus):

```sh
convert current.png -crop 900x80+0+0 +repage -scale 200% header-zoom.png
```

## Sample colors

```sh
convert current.png -format '%[hex:p{120,19}]' info:
```

Sample the header, tab strip, content, side panel, field/input backgrounds, borders, muted/strong text and the accent, a few pixels away from edges and text antialiasing. Coordinates are captured pixels (account for device scale). The running theme can differ from raw token values; use **sampled values for surfaces/text** and tokens for radius/motion.

## Theme tokens

- Source: `packages/base-ui/src/theme/styles.css` in the separate `ui` (base-ui) repository.
- Installed: `node_modules/@omniviewdev/base-ui/dist/base-ui.css` (exported as `@omniviewdev/base-ui/styles.css`); the host imports it as a cascade layer in `ui/theme/base-ui.css`.
- Families: `--ov-color-bg-*` (`base`, `surface`, `surface-raised`, `elevated`, `inset`, …), `--ov-color-fg-*`, `--ov-color-border-*`, `--ov-color-accent-*`, `--ov-color-state-*` (`hover`, `selected`, `pressed`, `focus-ring`), `--ov-radius-*`, `--ov-duration-{fast,interactive,panel}`, `--ov-ease-standard`.

## Real sizes and structure

Use a read-only scout (via **omniview-repo-map**) to collect component names, sizes, shortcuts and routes; put the paths in the issue's implementation notes.

| Concern | Source |
| --- | --- |
| Shell grid: header 38px, footer 24px, any side columns | `ui/layouts/core/main/WorkspaceShell.module.css`, `WorkspaceShell.tsx` |
| Header areas (tabs, search, context, items) | `ui/layouts/core/main/Header/areas/` |
| Which plugins the shell offers to open | `grep -rn 'routes.length !== 0' ui` (the plugin rail, later the new-tab launcher) |
| Command palette structure | `ui/features/command-search/` |
| Plugin registration/routes (`PluginWindow.withRoutes()`) | `ui/features/plugins/README.md` and the plugin's own UI source |
| Plugin name/icon | each plugin's `plugin.yaml` (`icon: SiKubernetes`) |

Anything not in source (for example a tab-strip height) is measured from the capture, not guessed.

## Check existing rules before inventing lists

Reuse the app's filters. Example: the shell offers only plugins whose registration has routes (`registrations.get(id)?.routes.length !== 0`; find it with the grep above); Flux extends Kubernetes without routes, so a launcher mock listing Flux was wrong. Likewise use each plugin's real home route (e.g. Kubernetes `/` → clusters, Proxmox `/` → connections) rather than an invented landing page.

## Real icons

Plugin icons are react-icons export names from `plugin.yaml`; the app UI uses Lucide (`react-icons/lu`). Extract the real SVGs instead of drawing look-alikes:

```sh
RI="$(readlink -f <install-root>/node_modules/react-icons)"   # package exports block require.resolve('react-icons/package.json')
node .agents/skills/omniview-ui-mocks/scripts/extract-react-icons.mjs \
  --react-icons "$RI" --out ~/omniview/mocks/<topic>/icons.js SiKubernetes SiProxmox LuPlus LuSearch
```

The pack comes from the name prefix (`Si`→`si`, `Lu`→`lu`, `Fa`→`fa`); use `fa6/FaGithub`-style `pack/Name` for packs sharing a prefix (`fa6`, `hi2`, `io5`). Missing names exit non-zero. Output is `window.ICONS = {...};` with kebab-case attributes (except `viewBox`) and `fill="currentColor"` by default.
