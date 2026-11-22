# PL1: the Plugins page, first slice (Installed list and the detail of one installed plugin, on real state)

Row: PL1 in the lead's tracker (not edited here). Worktree `~/Repos/omniviewdev/worktrees/ui-next-pl1-plugins-page`, branch `ui-next/pl1-plugins-page` (work in progress is saved on `wip/ui-next-pl1-plugins-page`, no PR), on `origin/main` 7471b52f. Seam scenario letter `t` (Main's correction: Terminal has `r`, Settings `s`); the seam file is `ui-next/plugins/e2e/seam.check.mjs` (there is no `scripts/ui-next-seam/`).

**State (2026-11-22): IN PROGRESS, saved on `wip/ui-next-pl1-plugins-page` (no PR).** Built and tested in jsdom: the model, the page, the list, the detail, the confirm, the host registration and the palette command. NOT done (the run ended at its request budget): the browser probe against the mock (the mock's reference is recorded, the host's fixture and probe are not written), seam scenario `t`, the performance run in a production build, screenshots, the shard-table entry, the rest of the commands CI runs, the PR. "What is done and what is not" below is the resume point.

## Goal

The Plugins page as a host page in a tab (`host:plugins`, a singleton): the INSTALLED list on the host's real inventory, live from the plugin events with no polling, the detail of one installed plugin with what the backend really has, and the actions that are real today end to end (Reload, Retry, Enable, Disable, Uninstall behind its confirm), each with its in-progress state, its failure as a sticky notice with a Retry where retry is meaningful, and its result read from the host's events, never from optimism.

## The container: a tab page, not a sheet

The mock registers the page as the singleton tab `host:plugins` (`AWS.page('host/plugins', ..., { layout: 'pane', frame: { sidebar } })`; chapter 16 S9, S26, S133: "`host:plugins` is a singleton tab"); only Settings is a sheet (owner ruling, 2026-11-22). The mock puts the list in the SHELL'S SIDEBAR SLOT (340 px, resizable 244 to 480) and the detail in the page island. The shell's sidebar here is a tree (`ShellSidebar.nodes`) and cannot hold a list of two-line rows with chips, so the page draws BOTH panes inside the island (a grid `340px 1fr`, 5 px apart, each an island over the window colour) and the registration of a host route has no sidebar track (`registrationOf`, `PluginHost.tsx`): the mock's rectangles are the mock's plus the rail's 40 px. A custom body for the sidebar slot is the shell owner's change (a `ShellSidebar` variant), not this step's.

## What the backend can tell the page TODAY (read from `backend/pkg/plugin/**` at 7471b52f; nothing was guessed)

Evidence is the file and line of the code that answers; "(cr)" = by reading, no test behind it. Paths: `bpp/` = `backend/pkg/plugin/`.

### The inventory (`PluginManager.ListPlugins`, bound in `bpp/service_wrapper.go`)

- Fields (`PluginInfo`, `bpp/types/plugin_record.go`): `id`, `metadata` (the manifest: `name`, `version`, `description`, `category`, `license`, `author{name,email,url}`, `repository`, `website`, `tags`, `dependencies`, `capabilities` (the declared KINDS), `icon`, `icon_url`...), `phase`, `enabled` (the persisted preference), `devMode`, `devPath` (an ABSOLUTE source path), `capabilities` (the kinds a LIVE process detected: empty for a plugin that is not running), `lastError` (raw text), `origin` (`builtin` or `external`; a development link is `external` with `devMode`), `frontendModule` (built-ins only), `releaseChannel` (empty: no explicit channel).
- Not exposed: an install date (`ToInfo` drops `installedAt`, and the record's value is the time of the LAST LOAD), a publisher's trust, the source of an install (marketplace, file or folder), a signature verdict, a size.
- The order is NOT stable (it ranges over a Go map, `manager.go:868`): the page sorts. It costs one read lock and no process call: O(n) for 200 plugins.
- Listed: every built-in (`Installed` until activated, `Running` after), every external plugin whose load ended (`Running`, a UI-only plugin too), a disabled external plugin (`Installed`, `enabled: false`), an external plugin whose load failed (`Failed`), a development plugin (`BuildFailed`, `Stopped`). NOT listed: an external plugin DURING its (re)load: the host deletes its record for the whole reload and stores it again when the load ends (`bpp/loader.go:244-247, 732-739`: up to 15 s, and 2 s of recovery backoff between crash attempts). A window opened then sees the plugin missing (PL1-03).

### States (`lifecycle.PluginPhase`)

Reachable in the inventory: `Installed` (a plugin turned off; or turned on and not started; or a built-in not activated), `Running`, `Recovering` (about 2 s), `Stopped` (a built-in after unload, a stopped development link), `Failed`, `BuildFailed` (development only). Never set by non-test code: `Starting` (local to a load), `Stopping`, `Validating`, `Installing`, `Uninstalling`, `Uninstalled`, `Building`, `Degraded` (`bpp/lifecycle/state.go`; grep). The page maps all fourteen, so a host that sets one later says it without a change.

| phase | enabled | the page says |
|---|---|---|
| `Running` | true | no chip (a healthy plugin has no state to say). The host loaded the files and started the controllers; a dead process is found by a 30 s health tick plus a 5 s probe |
| `Installed` | false | Disabled |
| `Installed` | true | Stopped ("turned on, not started": `SetPluginEnabled(true)` never starts it) |
| `Recovering` | true | Recovering |
| `Failed` | any | Did not start (the rail's word and sentence for a load that failed; the host does not say which kind of failure it was: PL1-05) |
| `BuildFailed` | any | Build failed (development) |
| `Stopped` | true | Stopped |
| record absent | | the window's plugin store holds the plugin through a reload, so the row stays (Starting again); with no store entry the plugin is not listed |

Crash timeline (cr): the inventory says `Running` until the next health tick (up to 30 s); `plugin/crash`, `plugin/unloaded {crashed}` and `Running -> Recovering` follow; about 2 s later the record is DELETED for the reload (`unloaded {reloaded}`, then `Starting -> Running` and `plugin/recovered`, or `unloaded {failed|timeout}`); three attempts at 2, 4 and 8 s, then `Failed` with `lastError` "max crash recovery attempts reached", which replaces the real cause; the sixth crash in five minutes is `Failed` "plugin keeps crashing". Only `RetryFailedPlugin` resets the budget.

### Actions (all bound; none takes a context, so none can be cancelled from JavaScript)

| call | precondition and errors | blocks | what the host does and tells |
|---|---|---|---|
| `ReloadPlugin(id)` | a record must exist (404 `omniview:plugin/not-loaded`); an archive or uninstall recovery pending refuses (500) | until the plugin runs or fails: no overall bound (15 s process start, 5 s per lifecycle call, controller starts with no deadline: PU2-01); a second call WAITS and then runs a full second reload | `state_change {Running->Stopped}`, `unloaded {reloaded}`, `state_change {Starting->Running}`; a failed load: `unloaded {failed|timeout}` and no state change. A disabled plugin: `unloaded {reloaded}`, stored `Installed`, returns with NO error and NO `Running` (PL1-08): the page does not offer it |
| `RetryFailedPlugin(id)` | none: it also restarts a Running plugin | as Reload | cancels the host's own recovery and its crash budget, then `ReloadPlugin` |
| `SetPluginEnabled(id, false)` | a record must exist (plain error); works for built-ins | stops the plugin: about 2 s | `enablement_changed {pluginID, enabled: false}` and `unloaded {disabled}` BEFORE the teardown (the inventory then says `enabled: false`, phase still `Running`), then `Running->Stopped`, `Stopped->Installed` |
| `SetPluginEnabled(id, true)` | as above | no | persists the choice, sets `Installed`, emits `enablement_changed {enabled: true}`. It does NOT start the plugin and sends no `unloaded` (PL1-07): the page follows it with `ReloadPlugin`, which honours the flag |
| `LoadPlugin(id, null)` | not used | | with no options it forces `enabled: true` and starts a plugin that is turned off (`bpp/loader.go:286-290`): a hazard, so the page never calls it |
| `UninstallPlugin(id)` | a built-in is refused (plain error); no record 404; an archive recovery pending refuses; waits on the install lock | until done | `unloaded {uninstalled}` FIRST (before the disposal), then `inventory_changed` (no payload). A failed or incomplete uninstall sends nothing more, leaves the plugin listed `Stopped` or `Failed`, and a second uninstall retries the erase (PL1-10) |

What reaches the TypeScript side on a failure: the Go return value is discarded and the call rejects with a `RuntimeError` whose message is the error's text. A host `apperror` is its JSON (`type`, `title`, `status`, `detail`), which the runtime's `parseAppError` reads; a plain Go error (`GetPlugin`, `SetPluginEnabled` not found, the built-in guard) becomes the generic `omniview:internal`. The `detail` of the host's own errors is NOT gated: it holds absolute paths, the process's first line and joined causes, so the page words a failure by the error's TYPE and never by its text (`failureReport.ts`).

### Events (all windows get them, in emit order; a window opened later gets none and reads the inventory)

| trigger | what the window is told |
|---|---|
| Reload or Retry of a running plugin | `state_change {Running->Stopped}`, `unloaded {reloaded}`, then `state_change {Starting->Running}`, or `unloaded {failed|timeout}` |
| Disable | `enablement_changed {enabled: false}`, `unloaded {disabled}`, `state_change {Running->Stopped}`, `state_change {Stopped->Installed}` |
| Enable | `enablement_changed {enabled: true}` only |
| Uninstall | `unloaded {uninstalled}`, `inventory_changed` (a rollback: only the first) |
| Crash, recovered | `crash` (the first of a cycle), `unloaded {crashed}`, `Running->Recovering`, then `Recovering->Stopped`, `unloaded {reloaded}`, `Starting->Running`, `recovered` |
| Install, update | `update_started`, `install_started`, [`unloaded {reloaded}`], `Starting->Running`, `inventory_changed`, `install_finished`, `update_complete` |

`plugin/enablement_changed` is a literal (not a declared event); `dev_reload_*` are declared and never emitted; events during the host's start reach no window. Free text rides only in `state_change.reason`, `crash.error`, `update_error.error` and `state_write_error.detail`: the page reads none of them (`core/events.ts` reads an id and a phase).

### Uninstall: what it removes and what it keeps (host PR #613, `docs/plugin-development.md`)

The plugin's whole directory (binary, assets, `plugin.yaml`, `data/`, `store/`: its connection profiles, the credentials the host saved for its connections, its authority bindings) is removed; the process stops; a development link is removed and its source folder is never touched; the credential-class settings (declared Sensitive or Password, or declared nowhere) are ERASED from the host's settings store and the file is scrubbed; the settings the plugin declares as ordinary are KEPT and a reinstall finds them; the plugin's logs are kept. There is no option on the bound call, so the confirm offers no choice. The confirm says exactly that (`core/words.ts`, `uninstallWords`).

## Gaps: where the page would have to GUESS (producer-side signals; none is worked around)

Classes: BLOCKER (the UI cannot behave properly without it), TANGENTIAL (an independent gain or fix), WIRE (it changes the plugin protocol).

| id | the page wants | the backend gives | class | the signal that would fix it |
|---|---|---|---|---|
| PL1-01 | a stable row order | a Go map's order (`manager.go:868`) | TANGENTIAL | sort in `ListPlugins` |
| PL1-02 | install and update dates, a size | none (`installedAt` is dropped and is the last load's) | TANGENTIAL | carry `installedAt` through loads; add it and `updatedAt` to `PluginInfo` |
| PL1-03 | a row that stays while the plugin restarts, in a window opened at that moment too | the record is deleted for the whole (re)load (`loader.go:244-247`) | BLOCKER | keep a `Starting` or `Recovering` record, or `PluginInfo.operation`. Interim: the window's plugin store holds the plugin through a reload and the page keeps the row; a window opened mid-reload shows it only if its store has it |
| PL1-04 | one honest failure sentence | `lastError` is raw (go-plugin's first stdout line, absolute paths, recovery directories, joined causes) and NO gate is applied: `apperror.PublicText` has three call sites, all in `ForResource` | BLOCKER | a host-worded cause code plus gated detail at each `lastError` assignment. Interim: the page never reads `lastError`; it says the host's own sentence for the cause the events carry (`failure.ts`, the rail's words) |
| PL1-05 | whether Retry helps for THIS failure | `Failed` has no kind; an incomplete uninstall is a `Failed` record that looks like a failed start, and Reload and Retry on it answer "uninstall requires recovery" | BLOCKER | a `failureKind` enum on `PluginInfo` |
| PL1-06 | live updates from events alone | no `unloaded`/`state_change` for a fatal source transport, a failed stop or unload (PU1-03, PU2-04), an uninstall rollback, a built-in's load failure; records with no state observer never emit `state_change` | BLOCKER | one emit at each of those sites, or an inventory event that names the plugin. Interim: the page reads the inventory again when an action it ran ends, whatever the answer |
| PL1-07 | "Enable" means on AND running | `SetPluginEnabled(true)` only persists; `LoadPlugin(id, null)` ignores `enabled` | BLOCKER | `SetPluginEnabled(true)` loads, or `LoadPlugin` honours the flag. Interim: Enable is `SetPluginEnabled(true)` then `ReloadPlugin` (two calls, two points of failure: the plugin may be on and not running, which the row says) |
| PL1-08 | Reload and Retry only where they can run | on a disabled plugin they send `unloaded {reloaded}` and then nothing | BLOCKER | refuse with an `apperror` when `!enabled`, or emit a not-started cause. Interim: the page does not offer them |
| PL1-09 | Disable ends cleanly | `enablement_changed` and `unloaded` fire BEFORE the teardown | TANGENTIAL | an event after the teardown |
| PL1-10 | an uninstall's result, and a second window agreeing | the call answers the pre-uninstall record; `inventory_changed` has no payload; a rollback is silent after `unloaded {uninstalled}` was told | BLOCKER (second window) | `inventory_changed {pluginID, change}`, also on rollback. Interim: the row leaves on `unloaded {uninstalled}` (the rail's moment); the window that ran the call reads the inventory again when it answers and the plugin comes back if the host kept it; another window shows it gone until its next read |
| PL1-11 | a timely "crashed" | `Running` for up to ~35 s after the process died; a hung plugin looks healthy | TANGENTIAL | a process-exit watcher; `lastCrash` and `recovery {attempt, max, nextAt}` on the record |
| PL1-12 | why the host gave up | the real cause is replaced by a fixed sentence (`health.go:254,297`); Reload does not reset the budget | TANGENTIAL | keep the last load error; expose the budget |
| PL1-13 | an update is available | not computed (`registry.go:264-287` hard-codes `update_available: false`); the list needs the network and every page | TANGENTIAL | `GetPluginUpdates(ids)` with a cache and an offline flag |
| PL1-14 | compatible with this host | not stored for an installed version; registry-only | TANGENTIAL | persist the registry's min/max IDE and `compatible` at install |
| PL1-15 | a plugin built below the accepted SDK | `sdk_release_untrusted` exists on development and workspace paths only; a production install gets raw handshake text in `lastError` | TANGENTIAL | the typed `incompatible` cause (another step): this page's state model has room for it (`Cause`, `StateKind` in `core/types.ts`) |
| PL1-16 | publisher, signature, origin of the install | nothing persisted; `official`/`publisher_name` exist only in marketplace listings; `author` is self-declared | TANGENTIAL | persist `source` and `verified` |
| PL1-17 | what a plugin MAY ACCESS | only the declared capability KINDS (`ui`, `resource`, `exec`, `networker`, `settings`, `log`, `metric`, `tools`) and manifest `requires`/`exports`; no consent record | TANGENTIAL (display) / WIRE (new grants) | surface `requires`/`exports`; grants need a manifest and SDK change. The page shows the kinds as "Provides", never as permissions |
| PL1-18 | install, update, uninstall PROGRESS | start and finish events only | TANGENTIAL | `plugin/operation_progress` events |
| PL1-19 | "an operation is running", also from another window | a silent mutex wait with no timeout; no cancel | TANGENTIAL | `PluginInfo.operation`, `TryLock`, a 409 `apperror` |
| PL1-20 | readable failures | plain Go errors (not found, the built-in guard, "is disabled") become generic text; the return value is lost on error | TANGENTIAL | an `apperror` for every lifecycle error |
| PL1-21 | a late window knows the cause | no replay | TANGENTIAL | `lastUnloadCause` on `PluginInfo` |
| PL1-22 | disable during a recovery | no `CancelRecovery` in `SetPluginEnabled(false)`: a backoff can reload a disabled plugin | TANGENTIAL (cr) | cancel the recovery |
| PL1-23 | a development build's detail | `BuildFailed` stub has an empty `lastError`; `dev_reload_*` never emitted | TANGENTIAL | fill `lastError`; emit the events |
| PL1-24 | what the plugin provides | the live `capabilities` is empty for a plugin that is not running; `metadata.capabilities` is the declared list | TANGENTIAL | the page reads the declared list |
| PL1-25 | what an uninstall will erase | static truth only (above); with no remembered settings schema ALL stored values are erased, which the confirm's "the settings it declares are kept" cannot say | TANGENTIAL | `GetUninstallPlan(id)` |
| PL1-26 | an icon for the plugin | `icon` and `icon_url` are a name and an address the kit cannot draw (the kit has 76 glyphs) | TANGENTIAL | the page draws the rail's glyph (the plugin's contribution), else the host's own |
| PL1-27 | a release note, a readme, versions | `GetPluginReadme` and `GetPluginVersions` go to the marketplace (network); nothing is local | (later slice) | see "Later slices" |

## What is built, and the proof so far

| Piece | Where | Proof (jsdom, `pnpm exec vitest run ui-next/shell/plugins-page ui-next/plugins`) |
|---|---|---|
| The model: rows by id (one object per row until it changes), a notification for the row that changed and for nothing else, a logical clock that orders events against reads, the plugins the window holds through a reload, the five actions, the page's memory | `core/model.ts` | `model.test.ts` (36), `operations.test.ts` (22) |
| The state of a plugin (the rail's words and the window's plugin store for the interface half; the host's phase for the rest), what can be done now and why not, the inventory read defensively, the two events read for an id and a phase | `core/state.ts`, `availability.ts`, `inventory.ts`, `events.ts`, `words.ts` | 25 + 12 + 21 + 27 + 4 tests |
| A failed action as a sticky notice of the host, worded by the CLASS of the error | `failureReport.ts` | 20 tests: no word of the error reaches the model |
| The list pane, a row, the detail (header with three fixed slots, status lane, details card, More menu), the confirm dialog, the state chip | `List.tsx`, `Row.tsx`, `Detail.tsx`, `Header.tsx`, `StatusLane.tsx`, `DetailsCard.tsx`, `ConfirmUninstall.tsx`, `StateChip.tsx` | 39 + 35 + 13 + 11 tests; a list of 200 plugins mounts in ONE commit and an event for one plugin renders one row (`List.test.tsx`) |
| The host's route registry, the tab's description of a host route, the page host's branch, the frame of a host route (rail, no sidebar), the palette command `host.plugins` "Plugins" | `ui-next/plugins/host/hostPages.ts`, `contributions.ts`, `PluginHost.tsx`, `palette.ts` | the 41 existing files of `ui-next/plugins` (950 tests) pass with the page registered |

Static: eslint (`--report-unused-disable-directives`) on the page and the four host files: exit 0; both tsc projects: no error in these files; the kit's vocabulary guard (`eslint/vocabulary.test.mjs`): 28 of 28; `pnpm lint:ui-policy`: exit 0; `OMNIVIEW_UI=next vite build`: builds. `pnpm lint:css` found one error in `PluginsPage.module.css` (a 5 px gap off the closed scale), fixed with a gutter track and not re-run.

Tests-first: the model, state, inventory, events, availability, failure report and words tests were written before their code (module-not-found red runs for events, inventory, the model); the rest (state, availability, the list, the detail, the confirm) were written beside their code and mutation-checked by hand only in part. The mutation runs (each rule broken once, its test red) are NOT done.

## What is not done, in the order to do it

1. **The probe and its fixture** (`probes/fixture.tsx`, `plugins-probe.mjs`): the real `Shell` and `PluginHost` over invented plugins (`probes/world.mjs`), the page registered over fakes (`registerHostPage(createPluginsPage(fakeDeps))`), both engines at 1440 x 900 and 1280 x 800, against `probes/mock-plugins.json` (sizes and offsets INSIDE each pane: the rail adds 40 px and the mock has none on this page; the DOM contract is the `data-pl-part` values in the components), axe, the keyboard path, the confirm's focus and Escape, and the negative controls (each trips only its named assertion, and passes undetected with it removed). Run with `FONT_DELAY_MS=40`, a clean environment and `uptime` recorded. Its shard-table entry waits for PR #656.
2. **Performance in a production build**: 200 plugins in one commit (React's profiling build or the development build for the commit count, as the other probes do), a state event updating one row in one commit, opening the page in under two frames, idle = 0 commits and 0 timers.
3. **Seam scenario `t`** on the real host with the fixture plugins (`ui-next/plugins/e2e/seam.check.mjs`, one function and one orchestrator call): open Plugins (palette or `#/host/plugins`); the list matches `ListPlugins`; Reload a fixture plugin (the row goes through "Starting again" by events and the rail agrees); kill the process by pid (the row says Stopped and offers the Retry the rail's tab offers); uninstall a plugin installed for the test (the row and the rail entry leave on the event; a second page, which is a second window in server mode, agrees). The seam's scenario `j` already lists the new command ("Command: Plugins, Window").
4. Screenshots (WebKit, void, 1440 x 900, beside the mock) under `~/Notes/omniview/ui-migration/status/PL1-assets/` and a list of what is wrong in them; the kit's `verify`, the root `pnpm test`, `pnpm lint`, the three tsc projects, the probes with `FONT_DELAY_MS=40`; then ONE commit, ONE push, the PR, CodeRabbit.
5. Known visual gaps the components report (the probe will measure them): the row's tile is a local 24 px tile (the kit's `KindTile` has no 24 px size); the header's More trigger is the kit's 24 px `RowMenuTrigger` in a 28 px slot; the version chip is a local span (the kit's `Chip` has no mono); the confirm's scrim is transparent (no translucent scrim token) and its box is shorter than the mock's (no tile, no checkbox row, no hint). Glyphs the page wants and the kit lacks (list for the icons step; the mock's SVG source is the Lucide set it names): `puzzle` (the page's own glyph: `blocks` is used), `power` and `power-off` (Enable and Disable: `play` is used), `rotate-cw` (Retry: `refresh` is used), `package` (a plugin with no glyph: `box` is used).

## Decisions for the lead

1. The list lives in the page's island, not the shell's sidebar slot (see "The container"); a custom sidebar body is the shell owner's change.
2. Palette command only: the rail has no host entries by design (README of the shell, decision 1) and the New tab menu (S34) is not built; both entries wait for those. `PluginHost.tsx` gets the registration (`registerHostPage(pluginsPage)`), `contributions.ts` and `palette.ts` read `hostPages.ts`; a host page's tab has the window's rail and no sidebar, and choosing a plugin on the rail opens it. Merge order: Settings (a sheet and a palette command) and the Terminal tool touch `palette.ts`, `PluginHost.tsx` and the seam's scenario `j` list too; the conflicts are lines, not logic.
3. Enable is two calls until `SetPluginEnabled(true)` starts the plugin (PL1-07); a failed second call leaves the plugin ON and not running, which the row says (Did not start, with Retry).
4. A failure is worded by the error's CLASS, never by its text (PL1-04, PL1-20).
5. The uninstall confirm says what the host does (the profiles and credentials go; the declared settings stay) and offers no box the host cannot honour.

## Dev tools

- `ui-next/shell/plugins-page/probes/mock-plugins-measure.mjs` (`env -i PATH="$PATH" HOME="$HOME" node ...`: serves the mock on port 49475, writes `mock-plugins.json`, 159 s for both engines and both viewports at a load of 23; `MOCK_URL=`, `ENGINES=`, `VIEWPORTS=`, `SCENES=`, `SHOTS=<dir>` narrow it) and `probes/world.mjs`.
- `ui-next/shell/plugins-page/core/testing.ts`: the model's test support (an invented inventory, the window's store as a table, the host's actions as spies).
## Log

- 2026-11-22: worktree from `origin/main` 7471b52f; `pnpm install --frozen-lockfile`, `task packages`; read AGENTS, decisions, PU1, PU2, the mock's Plugins page and chapter 16 section I (S133 to S136), the legacy page, the backend (two read-only investigations: `BackendTruth`, `LegacyPluginsUi`).
- 2026-11-22: the mock measured (`mock-plugins.json`), the model and its tests, the failure report, the list, the detail and the confirm (three subagents), the host registration and the palette command; the page's jsdom tests and the existing host tests pass; saved on `wip/ui-next-pl1-plugins-page`; stopped at the request budget with the probe, the seam scenario and the PR not done.
