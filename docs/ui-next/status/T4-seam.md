# Status: T4-seam (the seam scenario r9 and the probe sections for #695 step 6)

- Agent: OpenWhereSeam. Worktree `~/omniview/wt/t695-seam`, branch `test/terminal-open-where-seam` on `origin/main` `af58b162f` (after #725 `launch.env`, #767 profiles and `defaultShell`, #777 New terminal here, #787 title and rename, #791 restart). Epic #692, issue #695. No push, no PR.
- Owned: `ui-next/plugins/e2e/seam.check.mjs` (scenario r9), `scripts/ci/seam-units.mjs`, `scripts/ci/seam-shards.mjs` (one table name) and its test, `ui-next/shell/probes/terminal-where.mjs`, `terminal-where-probe.mjs`, the probe units and the manifest. Test infrastructure of the probes touched: `terminal-host.mjs` (the title frame, the counts of it) and `terminal-fixture.tsx` (`?shells=`). No product file.

## What the seam r9 proves (phase `terminal-where`, `checkTerminalOpenWhere`)

Real host, real bash and zsh of the machine, both engines. Every assertion has a control (`WHERE_CONTROLS`, 17), run as one table (`SEAM_CONTROL=terminal-where`) and one by one with `SEAM_REMOVE`.

| Acceptance line of #695 | Assertion | Control |
|---|---|---|
| a chosen shell's name on its tab and in `echo $0` | the `Choose a shell` menu, once for zsh and once for bash: the tab says the name (or `name (2)`), `$0` and `ps` say it | `where-tab-name`, `where-shell-zero` |
| a terminal in /tmp has `pwd` /tmp, against the host's cwd fact, no sleep | `pwd` and `ChannelTerminalCwd` both /tmp, read once `pwd` has answered | `where-cwd` |
| an `env` entry visible; a refused name is the typed error naming `env` | `echo $SEAM_WHERE_ENV`; `WAILS_MCP_TOKEN` and `A=B` answer `INVALID_REQUEST` naming `launch.env.WAILS_MCP_TOKEN` / `launch.env`, no value in the text, no terminal made | `where-env`, `where-env-refused` |
| New terminal here after `cd /usr` | the new shell's `pwd`, the host's fact for it and the page's `cwd` in the create call are /usr | `where-here` |
| a program's `ESC ] 0 ; title BEL` shows while it runs, the shell's name after | the tab says the title while the host says busy, and the shell's name once idle; a 100,000-character title with a control character is at most 256 bytes, clean | `where-title-shown`, `where-title-ended`, `where-title-bound` |
| a renamed tab keeps its name after a reload and while programs set titles | the host's title frame (`program: true`) reached the page and the tab still says the name, before and after a reload | `where-rename`, `where-rename-programs`, `where-rename-reload` |
| Restart: same shell, directory, env, a different id, the transcript kept | after `exit` and the lane's Restart: the host lists one new terminal under another id in the same tab (name kept), `$0` and `ps` say the same shell, `pwd` is /tmp (where it STARTED, not /usr, where it was left), the old output is above the restart line; for a page that reloaded, `SEAM_WHERE_ENV` is in the new shell | `where-restart-id`, `where-restart-shell`, `where-restart-dir`, `where-restart-transcript`, `where-restart-env` |

How the controls work (`withPremises`, the model of scenario v): a premise broken before the act (the assertion is tried before the page did what it says: `where-tab-name`, `where-here`, `where-title-*`, `where-rename`, `where-rename-programs`, `where-rename-reload`, `where-restart-transcript`), or a fault planted while the assertion is tried (`ps` redefined in the shell, `cd /`, `unset`, an accepted env name for `where-env-refused`, a terminal created straight at the host under the ended id for `where-restart-id`). Each must fail with ITS words and no other; with `SEAM_REMOVE=<name>` the fault passes.

## Decisions and what the check does not do for the page

- **The page has no gesture that sends a start directory or an environment** (`shellsOf` keeps `name` and `path` of the host's answer; a profile with `cwd` or `env` is "a later step"). The check writes `launch.cwd` and `launch.env` into the page's own `CreateTerminal` (`addToNextCreate`, a route that adds them to the next create), and says so in the scenario and in its notes. A restart carries the environment only for what the page KNOWS it asked (`params.launch`, which the host lists back): for a terminal the page made in this load it asked for none. So the environment of a restart is proved for a page that reloaded: the check writes the same environment into `params.launch` of the second terminal, reloads, ends the shell and presses Restart. **This is a gap in the product, reported, not fixed:** the acceptance line "Restart starts a shell with the same environment" holds for what the page asked, and the page cannot ask for an environment yet.
- Restart goes back to the directory the shell STARTED in (#791's decision), so `pwd` after a restart is /tmp for a shell that was left in /usr; the check asserts exactly that.
- The transcript of an ended terminal is above the new shell's only until a reload (#791's known limit). The check restarts once without a reload for it, and once after a reload for the environment.
- Tabs of one name say `name (2)`: the expected label is the name with an optional twin suffix.

## What the probe sections prove (`terminal-where-probe.mjs`, `PART=where`, units `terminal-where` and `terminal-controls-where`)

WebKit and Chromium at 1440 x 900 and 1280 x 800, against the probe's host and the page's real kit (a real xterm, DOM renderer). The host's synthetic shell has `title`, `untitle` and `title-hostile`; the fixture takes `?shells=bash=/bin/bash*,zsh=...`.

- `where-menu`: `where.menu-rows` (the arrow is beside the `+` and as tall; rows bash (Default), zsh, fish, each with its path), `where.menu-keys` (Enter opens, Escape closes and the keyboard is on the arrow), `where.menu-start` (zsh chosen: a tab named zsh and a request that names `/usr/bin/zsh`).
- `where-tab`: `where.title` (title while a program runs, the name after), `where.title-bound` (control character, right-to-left override, markup, 100,000 characters: clean text, at most 256 bytes, inside the strip), `where.rename` (field in the tab, Escape keeps, Enter gives and the keyboard goes to the tab, a program's title does not take it).
- `where-lane`: `where.restart-offer` (Restart drawn inside the lane), `where.restart` (Enter restarts: a new id, one tab, the ended output above the new banner, no Restart left; read from the emulator's whole buffer).
- `where-axe`: `axe.where` on the lane with Restart.
- Nine controls (`WHERE_CONTROLS` of the probe), each detected by its assertion and by no other, and not detected with the assertion off (`ASSERTION_OFF`).
- **A gap noted, not asserted:** axe finds `label-content-name-mismatch` (3) on the rows of the shell menu (`button[data-ov-menu-item]`: the accessible name is the shell's name, the visible words are the name, "Default" and the path). It is the kit's menu rows (#678), not the Terminal tool's. The probe prints it as `GAP where menu axe`.

## Shas

`11e066fff` test (red: the plan does not read `WHERE_CONTROLS`), `4f68d6bea` plan reads it, `90564ec3b` scenario r9 with units, `ace59dbe1` probe host and fixture, `ce5deddb2` probe sections with units and manifest, `dac7e07cd` title-kept fault, `745129e67` header of the check. This file's commit follows.

## Checks run

Linux amd64, Go 1.27.4 toolchain, Node 26, bash 5.3 and zsh 5.9 of this machine (real, from `/usr/bin`; no missing library, no fresh-home wizard: the home of the seam has `.zprofile`). Load average 3 to 21 (shared machine).

- Seam r9, both engines, `SEAM_SHELL=/bin/bash`: passes; the phase took 17 to 21 s (Chromium) and 19.6 s (WebKit); with the controls 51 s of phase in each engine.
- Seam controls: `SEAM_CONTROL=terminal-where` in both engines: 17 of 17 detected by their own assertion (the shell controls twice, once for each shell). `SEAM_CONTROL=<c> SEAM_REMOVE=<c>` for each of the 17, Chromium: each prints `NOT DETECTED ... with its assertion removed, as it must be`, exit 0.
- `node scripts/ci/seam-shards.mjs check`: ok (30 phases, 224 controls, 23 units). `node --test scripts/ci/seam-shards.test.mjs`: 35 of 35.
- `node scripts/ci/probe-shards.mjs check`: ok (100 units, 55 control units, 450 controls, 45 probe scripts).
- Probe `terminal-where-probe.mjs`, both engines, both viewports: passes. Controls: each of the nine, Chromium, with its assertion (detected by it alone) and with `ASSERTION_OFF` (NOT DETECTED).
- `node --test ui-next/shell/probes/terminal-host.test.mjs`: 34 of 34.

## Not verified

- macOS and Windows. The CI image (bash only): the zsh half is then NOT RUN and the check says so.
- The seconds of the four new units are ESTIMATES from the laptop (marked in the unit files); the nightly corrects them.
- The Go half of #695 and the page's unit tests are not touched here.

## Dev tools

- `SEAM_TERMINAL_ONLY=r9`, `SEAM_CONTROL=terminal-where|<control>`, `SEAM_REMOVE=<control>`; `NEGATIVE_CONTROL=<control>` and `ASSERTION_OFF=^<assertion>$` for the probe (`BUILD_CACHE=<dir>` shares the fixture build).

## Backend catalog

- Nothing for the SDK, a plugin or the host.

## Review round (ReviewWhereSeam, FIX FIRST on a40f829bc)

- The shell of r9 is now a listed shell that is NOT the host's default (`subject`), so a page that ignores the menu's choice, or a restart that drops it, starts the default and is seen. If the host lists no such shell the scenario FAILS with that sentence (it lists bash and zsh here; run with `SEAM_SHELL` set to a shell the host lists second, or on a machine with two). `where-restart-command` asserts that the restart's `CreateTerminal` asked for the ended shell's path (a decoy later create is its fault).
- The title controls are on the tab side: `where-title-shown` and `where-title-ended` assert the tab only (the act already waited for the host's busy fact); `where-title-length` and `where-title-control` plant a 300-character and a control-character label on the tab.
- `ps` and `$0` are separate assertions with a fault each (`ps()` redefined; `BASH_ARGV0` or `0` assigned): `where-shell-ps`, `where-shell-zero`, `where-restart-shell`, `where-restart-zero`.
- The `SEAM_REMOVE` half proves little where an act has one assertion: removing it leaves nothing else to see the fault, so it passes by construction. It is a check on controls that share an act only.
- CI runs r9 once the CI image with zsh (and fish) is pinned: that image pull request comes first (owner's decision). Until then the image lists bash only and r9 stops at the non-default check with its message (zsh NOT RUN there). r9 is kept as written.
