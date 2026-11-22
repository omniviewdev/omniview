# PL1: the Plugins page, first slice (Installed list and the detail of one installed plugin, on real state)

Row: PL1 in the lead's tracker (not edited here). Worktree `~/Repos/omniviewdev/worktrees/ui-next-pl1-plugins-page`, branch `ui-next/pl1-plugins-page` (the work in progress was saved on `wip/ui-next-pl1-plugins-page`, no PR), rebased on `origin/main` 77ce06f8. Seam scenario letter `t` (Main's correction: Terminal has `r`, Settings `s`); the seam file is `ui-next/plugins/e2e/seam.check.mjs` (there is no `scripts/ui-next-seam/`).

**State (2026-11-22): READY FOR REVIEW.** One commit on `origin/main` 77ce06f8: the first slice (the Installed list and one plugin's detail, on the host's real state and events; Reload, Retry, Enable, Disable and Uninstall behind a confirm), the host's registry of its own pages, seam scenario `t` on the real host, and the page's probe against the mock, registered in `scripts/ci/probe-units/plugins-page.mjs` (five units, run through two wrappers that the manifest lists: see "What is not done"). Order of proof (the lead's): (A) the page on the real host in WebKit and Chromium, looked at; (B) seam `t`; (C) the commands CI runs; (D) the probe against the mock, its controls, axe and the production-build numbers. What is NOT done is under "What is not done".

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

## Backend catalog: where the page would have to GUESS (producer-side signals; none is worked around; locations read at 7471b52f and checked on 232abbab)

Classes: BLOCKER (the UI cannot behave properly without it), TANGENTIAL (an independent gain or fix), WIRE (it changes the plugin protocol).

| id | the page wants | the backend gives | class | the signal that would fix it |
|---|---|---|---|---|
| PL1-01 | a stable row order | a Go map's order (`manager.go:868`) | TANGENTIAL | sort in `ListPlugins` |
| PL1-02 | install and update dates, a size | none (`installedAt` is dropped and is the last load's) | TANGENTIAL | carry `installedAt` through loads; add it and `updatedAt` to `PluginInfo` |
| PL1-03 | a row that stays while the plugin restarts, in a window opened at that moment too | the record is deleted for the whole (re)load (`loader.go:244-247`) | BLOCKER | keep a `Starting` or `Recovering` record, or `PluginInfo.operation`. Interim: the window's plugin store holds the plugin through a reload and the page keeps the row; a window opened mid-reload shows it only if its store has it |
| PL1-04 | one honest failure sentence | `lastError` is raw (go-plugin's first stdout line, absolute paths, recovery directories, joined causes) and NO gate is applied: `apperror.PublicText` has three call sites, all in `ForResource`; the raw assignments are at `backend/pkg/plugin/loader.go:423,1015`, `installer.go:323,611`, `health.go:318`, `catalog.go:157,309`, `archive_recovery.go:428,501-506` | BLOCKER | a host-worded cause code plus gated detail at each `lastError` assignment. Interim: the page never reads `lastError`; it says the host's own sentence for the cause the events carry (`failure.ts`, the rail's words) |
| PL1-05 | whether Retry helps for THIS failure | `Failed` has no kind; an incomplete uninstall is a `Failed` record that looks like a failed start (`installer.go:557`, guard `uninstall_recovery.go:328`), and Reload and Retry on it answer "uninstall requires recovery" | BLOCKER | a `failureKind` enum on `PluginInfo` |
| PL1-06 | live updates from events alone | no `unloaded`/`state_change` for a fatal source transport (`source_transport_health.go:33`), a failed stop or unload (PU1-03, PU2-04), an uninstall that did not complete (`installer.go:611`: the phase becomes Stopped or Failed with a raw `lastError`), a built-in that collides with an installed plugin (`catalog.go:157`); records with no state observer never emit `state_change` | BLOCKER | one emit at each of those sites, or an inventory event that names the plugin. Interim: the page reads the inventory again when an action it ran ends, whatever the answer |
| PL1-07 | "Enable" means on AND running | `SetPluginEnabled(true)` only persists, by design: `backend/pkg/plugin/catalog.go:237` ("SetPluginEnabled persists user preference independently from activation"), bound as `backend/pkg/plugin/service_wrapper.go:17`; it emits `plugin/enablement_changed` and nothing else for `true` (the `false` branch, `catalog.go:298-301`, also emits `unloaded {disabled}`). `LoadPlugin(id, null)` ignores `enabled` | BLOCKER | One host operation that turns a plugin on AND starts it (or `SetPluginEnabled(true)` that does, in the same lifecycle transaction), so that one call has one outcome. Interim, a consumer-side workaround kept for this slice ONLY because the half-done state is truthful: Enable is `SetPluginEnabled(true)` then `ReloadPlugin` (`backend/pkg/plugin/loader.go:626`); when the second call fails, or the window is gone between the two, the plugin is ON and NOT RUNNING and every window says exactly that from the host's inventory and events (enabled, the host's phase, the class-worded reason, a Retry that STARTS it and does not turn it on again). Proof: `core/operations.test.ts` "Enable, when it is only half done" (the failed second call; the window gone between the calls, seen from a second window and from one opened later; the notice's Retry) and seam scenario `t` on the real host (an unstartable binary) |
| PL1-08 | Reload and Retry only where they can run | on a disabled plugin `ReloadPlugin` (`loader.go:626`) sends `unloaded {reloaded}` (`loader.go:697`) and then nothing | BLOCKER | refuse with an `apperror` when `!enabled`, or emit a not-started cause. Interim: the page does not offer them |
| PL1-09 | Disable ends cleanly | `enablement_changed` and `unloaded` fire BEFORE the teardown | TANGENTIAL | an event after the teardown |
| PL1-10 | an uninstall's result, and a second window agreeing | `UninstallPlugin` (`installer.go:495`) answers the pre-uninstall record; `inventory_changed` (`events.go:72`) has no payload; a rollback (`installer.go:611`) is silent after `unloaded {uninstalled}` was told | BLOCKER (second window) | `inventory_changed {pluginID, change}`, also on rollback. Interim: the row leaves on `unloaded {uninstalled}` (the rail's moment); the window that ran the call reads the inventory again when it answers and the plugin comes back if the host kept it; another window shows it gone until its next read |
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
| PL1-28 | the rail and the page agree between Enable's two calls | after `SetPluginEnabled(true)` the window's plugin store takes the plugin as loadable and the rail lists it as healthy, while the host has not started it and the page says Stopped (seam `t`, step 4) | TANGENTIAL | the store waits for the host's `state_change` to Running before it lists an interface it has loaded for a plugin the host does not run; or one host call for Enable (PL1-07) |
| PL1-29 | the rail keeps a reloading plugin | for about 8 ms of a reload the rail drops the plugin's entry (the store is `loading` while the interface loads again); seen in seam `t`, step 3 | TANGENTIAL | the store keeps the entry through a reload (PU1) |
| PL1-30 | no state the host did not mean | the host sends `state_change Running to Stopped` BEFORE `unloaded {reloaded}`, so the row says Stopped for 1 to 2 ms of a reload; the page says what the events say, in the order they come (seam `t`) | TANGENTIAL | `unloaded {reloaded}` first, or the cause on the `state_change` |

## The page on the real host, looked at (A)

How: seam scenario `t` starts the real host (`bin/Omniview-server`, `OMNIVIEW_UI=next task build:server`) with the fixture plugins (one with a process, one without, and the product's own built-in plugin that the host always lists), opens the page from the palette as a person does, and writes WebKit's pictures (`SEAM_SHOTS=<dir>`, theme void, 1440 x 900) under `~/Notes/omniview/ui-migration/status/PL1-assets/`: `plugins-page-{running,disabled,did-not-start,stopped,uninstall,uninstalled}-webkit-void-1440x900.png` (the mock's own are `mock-{running,failed,disabled,uninstall}-webkit-1440x900.png` there; the probe's are `plugins-{running,failed,disabled,uninstall}-webkit-void-1440x900.png`, the invented six plugins, beside them). I looked at them; Chromium at 1440 x 900 and WebKit at 1280 x 800 were looked at too (the page's frame measured on the real host: `[45, 40, 1390, 823]` and `[45, 40, 1230, 723]`).

Plainly wrong, and fixed because of it:
1. The list was inset 12 px from the island and the panes sat on a darker band: the shell insets every page 12 px and the mock's list is flush. The page now takes the inset back (`PluginsPage.module.css`), so the list is `[45, 40, 340, 823]` and the detail island runs to the frame, with its own 12 px inside, as the mock's.
2. The rail had its first plugin selected while the Plugins page was on screen: a host page selects no plugin on the rail (`PluginHost.tsx`).
3. The header said nothing of a plugin that runs; the mock's chip says Running.
4. (From the probe.) The header tile was a 20 px kit tile; the tint and the 28 px size are the mock's. The lane was an info notice for a plugin on its way; the mock's is the quiet lane, also while this page's own work runs. The confirm's fill, close button, footer width and version size were off. A tile went grey for the length of a reload (the model keeps the tile a plugin was last placed with). Each has a test.

Different from the mock and LEFT (the slice's scope, each is a later slice): the list in the page's island, not the shell's sidebar slot (next section); no segmented Installed/Marketplace control, search, filter, sort or row switch; no tabs, readme, extra facts or settings buttons in the detail, so the details card stands under the lane (the mock has it in a right column beside "About"); a built-in plugin has no publisher or licence, so its facts line is an empty line; the failed lane has no "Open logs" (no host Logs session for a plugin's own output); the confirm has no tile, no data checkbox and a transparent scrim (there is no scrim token); the header's state chip is a filled glyph where the mock's is an outline (the kit's `Status`); the status bar has no "1 plugin failed" item (shell). No rail or New tab menu entry (the palette command is how the page opens).

## Seam scenario `t` on the real host (B)

`ui-next/plugins/e2e/seam.check.mjs`: `checkPluginsPage` (a host of its own, like `n` and `p`), one orchestrator call, `SEAM_ONLY=plugins-page` to run it alone, `SEAM_CONTROL=plugins-page` for its 15 controls. Steps: (1) the palette chord, the word Plugins and Enter open the one tab in two windows (a second browser page; it is never reloaded); (2) the rows (name, version, order), the heading and footer counts equal `ListPlugins`, and no rail entry is current; (3) Reload with the call held before it reaches the host: the header says Reloading, no event has come, then `plugin/unloaded {reloaded}` and `state_change Running` and the row goes through Starting again to running, the rail and the second window agree; (4) Disable (the row says Disabled from `enablement_changed` while the call is open) and Enable (TWO calls; Stopped, then Starting, then running); (5) Enable with the execute bit off: the host's record is `enabled` and `Failed`, the row and the second window say Did not start with the host's sentence and a Retry, the rail says so, the sticky notice has a Retry that STARTS the plugin without calling `SetPluginEnabled` again, no raw host text is on screen; (6) a kill by the pid the host names (never a pattern): Stopped with the crash sentence in both windows, the header Retry and the rail's tip agree, Retry calls `RetryFailedPlugin` once and the plugin runs; (7) Uninstall: the confirm shows the page's own words (files, connection profiles and credentials erased, declared settings kept), Cancel and Escape close it, return the focus to the More button and call nothing, Confirm: the row and the rail entry leave on `plugin/unloaded {uninstalled}` while the call is held open, `ListPlugins` drops it, the plugin's directory is gone and the second window loses the row with no reload; (8) no page error and no failed request outside `RUNTIME_ALLOW` (one entry: the 422 of `ReloadPlugin` when Enable's second call fails, only in this scenario's phase).

## Mutation checks: each rule broken once in a scratch copy, its test red

| Rule broken | Result |
|---|---|
| a plugin that is off is reloaded (`availability.ts`) | not detected by the first set; a test at the availability level was added ("is not reloaded whatever state the page holds for it") |
| turned off no longer outranks the store's failure (`state.ts`) | red, 3 tests |
| the notice's Retry runs the same call again (`model.ts`) | red, 1 test (it would run Enable on a plugin that is already on: nothing) |
| Enable reloads before it persists | red, 5 tests |
| the error's own text reaches the notice (`failureReport.ts`) | red, 7 tests |
| any address is a link (`inventory.ts`) | red, 1 test |
| an uninstalled plugin does not leave on the event | red, 3 tests |
| the store's failure is ignored (`state.ts`) | red, 7 tests |
| a cancellation is a failure (`failureReport.ts`) | red, 2 tests |
| a plugin goes with the host's record (`model.ts`) | red, 2 tests |
| a failed plugin has no Retry (`availability.ts`) | red, 6 tests |
| one event settles the whole list instead of one row | NOT detected: no behaviour differs (an unchanged row is not told, so no commit and no DOM change differs); what it saves is the work of the other rows (O(rows) per event), so it stays as a documented optimisation, not a rule a test can pin |

## The probe against the mock (D)

`probes/plugins-probe.mjs` (+ `fixture.tsx`, `fixture.html`, `plugins-perf.mjs`, `world.d.mts`): the real shell and `PluginHost` over fake host dependencies and the six invented plugins, both engines, 1440 x 900 and 1280 x 800, theme void; against `probes/mock-plugins.json`, sizes and offsets INSIDE each pane (the rail adds 40 px; the mock has none on this page). Assertions (counts of checks; worst difference in px): `geometry.{list,row,header,slots,lane,card,dialog,empty}` (row 4,116 checks at 0 px; header 1,044 at 0 px; dialog at 0 px; slots worst 4 px: the kit's 24 px More trigger in the mock's 28 px slot), `paint.{row,header,buttons,card,dialog,lane,list}`, `tokens` (2,520 checks in a light theme: every colour comes from a token and changes with the theme), `a11y` (axe: the scenes, the open More menu and the confirm), `keyboard.{stop,order,free,arrows,choose,menu,progress,confirm}`, `perf.{mount,event,open,idle}`. Documented differences: the tile's hue is the plugin's accent as the kit's `KindTile` and the shell's tree draw it (`--ov-brand-*`), where the mock's is a name hash over a chart palette that a host cannot reproduce. 24 negative controls, 19 for the boxes, the paint, the tokens, axe and the keyboard and 5 for the cost (`CONTROLS=1` lists them; `NEGATIVE_CONTROL=<name>` runs one, `ASSERTION_OFF=<pattern>` removes its assertion): each is detected by its own assertion and by no other, and passes undetected with the assertion removed (one, `rows-tabbable`, was not detected because the kit's roving group undoes a stray tab stop; it was replaced by `extra-stop`).

Performance (200 plugins; the development build for the counts of commits, the production build for the rest, as the neighbours do). EVERY ASSERTION IS A COUNT, because a bound in milliseconds failed three pull requests on the runner (N25): the list mounts in ONE commit and in one DOM batch (when the window's inventory is older than the host's answer for one plugin there is one more commit that changes no node: `mountStale`); ONE state event is one page commit, one row and two DOM nodes (the plugin on screen: its row and the detail, 22 nodes); opening: the first window commit after the command holds every row (ONE commit), and in the production build (20 runs at 200 plugins and 8 at 6) the median animation frame the list is in the document at is 1, none is later than 2, and the open is one DOM batch; the milliseconds are printed and held only against a 400 ms catastrophe bound (this laptop at a load of 8: p50/p95 33/36 ms in WebKit, 27/34 ms in Chromium; the brief's two frames, 33.3 ms, is a number to read here, not one asserted); idle is 0 commits, 0 timers, 0 frames and 0 DOM changes in 3 s (Chromium: also 0 layouts and style recalculations). Units (`scripts/ci/probe-units/plugins-page.mjs`; their `seconds` are 4 x this laptop's quiet seconds, until the first CI summary prints the runner's): `plugins-page` 236 (59 s here at a load of 8), `plugins-page-perf` 224 (55 s; 120 s at a load of 17, with cold builds), and the controls: boxes 56 (15 controls), page 24 (4), perf 108 (5). The geometry tolerance is the repository's 1 px for a reference measured on another platform (every box still reads 0 px off here; the smallest control moves 2 px); the probe's wait for a quiet machine is skipped on the runner.

Not covered by the probe: the tokens ran in one light theme and not nine; the More menu's geometry is not compared; axe ran on the page region and not the whole document; no control for `keyboard.{order,free,arrows,choose,menu,progress}` and `premise`; a failed action's notice, install and update are not driven (the notices are the host's and have their own probe; install and update are later slices).

## Kit gaps, and the glyphs (do NOT edit `packages/kit/**`; what exists is used)

Kit: a `Chip` with a mono option (the version chip is a local span); `KindTile` at 24 and 28 px with a tinted fill (the page's `Tile.tsx` is local, with ONE justified stylelint disable for `color-mix`); a 28 px `RowMenuTrigger` (the header's is the kit's 24 px in a 28 px slot); a translucent scrim token (the confirm's scrim is transparent); `StateChip` accepting `data-*` (the row wraps it in a span). Glyphs the page wants and the kit lacks, with the mock's SVG source (`frontend/mock/icons.js` of the design's mock, one entry a line): `puzzle` (`LuPuzzle`, line 493: the page's own glyph; `blocks` is used), `power` (`LuPower`, 499: Enable; `play` is used), `power-off` (`LuPowerOff`, 500: Disable; the menu says it in words), `rotate-cw` (`LuRotateCw`, 434: Retry; `refresh` is used), `package` (`LuPackage`, 588: a plugin with no glyph; `box` is used); later slices: `external-link` (`LuExternalLink`, 1083), `link` (`LuLink`, 774), `lock` (`LuLock`, 744).

## Verification (rule 17: the commands CI runs; this laptop, 2026-11-22, one-minute load at the start of each run in brackets)

| Command | Result |
|---|---|
| `pnpm exec tsc -p tsconfig.app.json --noEmit`, `-p tsconfig.test.json`, `pnpm --filter @omniviewdev/kit run typecheck` | exit 0, all three |
| `pnpm lint` (eslint with `--report-unused-disable-directives`, `lint:ui-policy`, `lint:css`) | exit 0: 0 errors, 8 warnings (all in other packages, none new) |
| `pnpm test` (the whole root suite) | 342 files, 5,797 tests pass (3 skipped, as on main). One earlier run, at a load of 111 from other agents, timed out one panel fuzz test at 5 s; it passes alone in 2 s and in this run |
| `pnpm --filter @omniviewdev/kit run verify` (with `OMNIVIEW_UI=next`) | exit 0: 100 files, 2,788 tests, the vocabulary guard, the dist check, api-extractor |
| `OMNIVIEW_UI=next task build:server`, then the seam, the whole check, both engines | PASS in WebKit and Chromium, 409 s [load 10], scenario `t` included. `SEAM_ONLY=plugins-page` alone: 57 s an engine. Its 15 controls (`SEAM_CONTROL=plugins-page`): each detected by its own assertion and by no other, in both engines; the removal proof (`SEAM_CONTROL=<c> SEAM_REMOVE=<c>`: undetected with its assertion left out) for all 15, in WebKit only (57 to 76 s each) |
| The page's probe, clean env, `FONT_DELAY_MS=40`, both engines and both viewports | exit 0, 224 s [load 23] |
| Palette probe, palette plugins probe, strip probe, shell probe, rail probe (they mount the host or the palette, which this change touches) | exit 0: 246 s, 146 s, 181 s, 39 s, 14 s [load 5 to 7] |
| NOT run | the kit, table, fonts, tooltip and detail probes (no file of the kit or of the list pages is touched, and none reads the host's page registry); the host cluster check of `scripts/ui-next-pods/` (rule 30: it needs a cluster, and no list page, session tab or sidebar changed); the Go suites (no Go changed) |

## What is not done, in the order to do it

1. `PROBE_DIRS` (`scripts/ci/probe-shards.mjs:44`) does not scan `ui-next/shell/plugins-page/probes`, and a unit that names a script outside it turns two engine tests red (`probe-shards.test.mjs:1037` and `:1052`), so the units run two 3-line wrappers in `ui-next/shell/probes` (`plugins-page-probe.mjs`, `plugins-page-perf-probe.mjs`). The lead: add the directory to `PROBE_DIRS` and to its pin (`probe-shards.test.mjs:111`), and the wrappers can go and the units name the probe. The probe has never run on Linux or on the runner: the mock's text widths were measured on macOS and may need a look at the first CI run, and the `seconds` are estimates.
2. Every item of "Later slices" and every gap above that is marked BLOCKER (PL1-01 to PL1-08 among them) needs the host's producer-side signal first.
3. The probe's own "Not covered" list above.

## Later slices (each is built by nobody yet; nothing for them is drawn: no tab, no disabled button, no placeholder)

| Slice | What it needs, from the host and from the shell |
|---|---|
| Marketplace (Browse), search, filter, sort | The marketplace client in the window: `ListAvailablePlugins` pages the whole registry over the network (PL1-13), so the slice needs a cached list with an offline state; the filter menu's facets (category, status, publisher, origin) are in the inventory for the installed half. The Installed/Marketplace control with counts comes with it |
| Install, update, downgrade, "Other versions" | Progress with steps from the host (PL1-18), an update check (PL1-13), the registry's compatibility stored per installed version (PL1-14), a consent surface for permissions (PL1-17); the row's switch and "Update to X" primary |
| Install from a file, link a source folder | The host's native pickers (`InstallFromPathPrompt`, `InstallInDevMode`) or a path field, and a trust dialog (PL1-16) |
| Versions, changelog, readme | The registry's version history, notes and readme: network only (PL1-27) |
| Permissions, trust, signature | A grant model: the host has the declared capability kinds and `requires`/`exports` only (PL1-17); signing is not recorded (PL1-15) |
| Per-plugin settings, "Open {plugin}", connection profiles | The Settings sheet's plugin section (ST1) and the tab model's open from a host page; both are other steps |
| The row's switch | A roving grid with two cells per row, or a switch inside the roving cell with its own key handling; Enable and Disable are in the detail until then |
| The resize handle, collapse, remembered width | The shell's sidebar slot taking a host body (see "Visual gap" below); the list then moves into it |
| A rail entry and the New tab menu entry | The rail's host entries (README of the shell, decision 1) and the New tab menu (S34); the palette's command "Plugins" is how the page opens today |
| Release notes, "last operation" memory, copy-id | The page's own persisted state (`Shell.state.pluginsPage` in the mock): a decision on what the window remembers |

## Visual gap: the mock puts the list in the shell's sidebar slot

The mock draws the Installed and Marketplace lists in the FRAME'S SIDEBAR SLOT, not in the page: "Installed and Marketplace lists in the frame's sidebar (H.seg with counts, H.search, a filter menu of category, status, publisher and origin, a sort menu, H.listrows of 40px rows ...)" (`shell-page-plugins.js:5`); "THE SIDEBAR (S133): Installed and Marketplace lists in the frame's sidebar slot. A shell region: pure markup of the store, keyed, zero writes when unchanged." (`:761`); registered as `sidebarFrame = { sidebar: () => sidebarHtml(), defaults: { sidebar: { label: 'Plugins', min: 244, max: 480, default: 340, collapsible: true, handleLabel: 'Resize the plugin list' } } }` (`:867`) and `Shell.frame.page(PAGE, sidebarFrame)` (`:1496`). Accepted for this slice (the lead): the list is drawn in the page's own island, 340 px beside the detail. What differs from the mock because of it: the list is not collapsible by the shell's sidebar toggle, has no resize handle (min 244, max 480), its width is not remembered, and the shell's sidebar track is empty for this route (the frame is the rail and the island). Later slice: a shell sidebar slot that takes a host body (the shell owner's change); the page's list then moves into it with no change to `List.tsx`.

## Decisions for the lead

1. The list lives in the page's island, not the shell's sidebar slot (see "The container"); a custom sidebar body is the shell owner's change.
2. Palette command only: the rail has no host entries by design (README of the shell, decision 1) and the New tab menu (S34) is not built; both entries wait for those. `PluginHost.tsx` gets the registration (`registerHostPage(pluginsPage)`), `contributions.ts` and `palette.ts` read `hostPages.ts`; a host page's tab has the window's rail and no sidebar, and choosing a plugin on the rail opens it. Merge order: Settings (a sheet and a palette command) and the Terminal tool touch `palette.ts`, `PluginHost.tsx` and the seam's scenario `j` list too; the conflicts are lines, not logic.
3. Enable is two calls until `SetPluginEnabled(true)` starts the plugin (PL1-07); a failed second call leaves the plugin ON and not running, which the row says (Did not start, with Retry).
4. A failure is worded by the error's CLASS, never by its text (PL1-04, PL1-20).
5. The uninstall confirm says what the host does (the profiles and credentials go; the declared settings stay) and offers no box the host cannot honour.

## Dev tools

- `ui-next/shell/plugins-page/probes/mock-plugins-measure.mjs` (`env -i PATH="$PATH" HOME="$HOME" node ...`: serves the mock on port 49475, writes `mock-plugins.json`, 159 s for both engines and both viewports at a load of 23; `MOCK_URL=`, `ENGINES=`, `VIEWPORTS=`, `SCENES=`, `SHOTS=<dir>` narrow it) and `probes/world.mjs`.
- `ui-next/shell/plugins-page/core/testing.ts`: the model's test support (an invented inventory, the window's store as a table, the host's actions as spies).
- `ui-next/shell/plugins-page/probes/plugins-probe.mjs`, `plugins-perf.mjs`, `fixture.tsx`, `fixture.html`, `world.d.mts`: the page's probe. Run: `env -i PATH="$PATH" HOME="$HOME" FONT_DELAY_MS=40 node ui-next/shell/plugins-page/probes/plugins-probe.mjs` (`ENGINES=`, `VIEWPORTS=`, `SECTIONS=geometry,tokens,a11y,keyboard,perf` narrow it; `CONTROLS=1` lists the controls; `NEGATIVE_CONTROL=<name>` runs one; `ASSERTION_OFF=<pattern>` removes an assertion, which the control must then pass undetected).
- Seam: `SEAM_ONLY=plugins-page` runs scenario `t` alone, `SEAM_CONTROL=plugins-page` its controls (`SEAM_CONTROL=<name> SEAM_REMOVE=<name>` one control with its assertion removed), `SEAM_SHOTS=<dir>` writes WebKit's pictures. The host binary: `OMNIVIEW_UI=next GOWORK=off GOTOOLCHAIN=local task build:server` (`BIN_DIR=<dir>` builds it elsewhere, so a running check keeps its own).
- The mutation harness (a throwaway `_eval` over a scratch copy of `core/` that breaks one rule at a time and reads which tests go red) is not kept: the table above is its output.
## Log

- 2026-11-22: worktree from `origin/main` 7471b52f; `pnpm install --frozen-lockfile`, `task packages`; read AGENTS, decisions, PU1, PU2, the mock's Plugins page and chapter 16 section I (S133 to S136), the legacy page, the backend (two read-only investigations: `BackendTruth`, `LegacyPluginsUi`).
- 2026-11-22: the mock measured (`mock-plugins.json`), the model and its tests, the failure report, the list, the detail and the confirm (subagents), the host registration and the palette command; saved on `wip/ui-next-pl1-plugins-page`.
- 2026-11-22 (resumed): the page on the real host looked at and fixed (frame, rail, header chip); Enable's half-done state pinned at the model, the page and on the real host (the notice's Retry no longer ran a call the row no longer offered); seam `t`; the page's tests and the registry's tests (one defect found by them: the remembered selection was lost when the window held a plugin the inventory also lists and there was no seed); the probe against the mock (eight defects found, seven fixed, one reclassified); mutation checks; rebased on `origin/main` 232abbab; one commit.
