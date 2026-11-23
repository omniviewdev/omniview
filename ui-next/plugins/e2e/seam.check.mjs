// The seam check: the real Go host in server mode, built from `OMNIVIEW_UI=next`, loading plugin bundles that were built OUTSIDE the host's tree
// (ui-next/plugins/fixture/build.mjs), in WebKit and Chromium. What it proves (docs/ui-next/slices/n19-plugin-seam.md, 1.4):
//
//   a  a bundle built by its own Vite config is fetched from `/_/plugins/<id>/assets/entry.js`, linked to the host's React and kit, and contributes a sidebar
//      entry and a page to the shell; the window opens it with no route (no URL parameter and no hash: the default screen is the plugins'); the page's list opens in the sort its definition names and sorts by the columns that
//      declare a key (K3a: the host's list page holds the sort and the kit's table does it, a plugin built outside the host's tree states it as data)
//   b  ONE React and ONE kit: the bundle's imports are the registry's instances, and `useTheme()` in the plugin reads the host's provider
//   c  the negative control: the same plugin with its own copy of the kit fails that read, and the check sees it fail
//   d  a page that throws is contained: the frame, the sidebar and the other pages stay; Retry tries again
//   e  a bundle of the old shell is refused before it runs (the global it sets is never set); a plugin with no bundle is a named state
//   g  the rail (S2a): one entry for each plugin that contributes (the healthy plugin and its copy; the refused ones have none), in the order each declares; choosing the other entry shows its
//      sidebar and closes no tab, activating a tab makes its plugin current; closing the last tab leaves the empty window (decision A17), which opens nothing by itself and offers the plugins to open
//   h  the bottom panel (P1a, P1b-3a): the host's own Logs tool comes first (empty: it says how a session arrives and has no `+`), then the tool each plugin that contributes brings, "Streams" and "Streams copy", in the order of the rail
//      (the two say the same `order`, so the rail's order tells them apart, whichever plugin finishes loading first: R2), drawn by the host's strip over the plugin's own body; the status bar's toggle opens the panel, the tool's `+`
//      opens its three streams (running, ended, failed), a hidden stream keeps running while another is on screen and while the panel is hidden, and the card of a stream links to its item, which opens in a tab of the window
//   h2 the bottom panel when the rail's first plugin finishes loading LAST (R2): its bundle is held while the copy's tool is on screen with a stream open in it, then let through; the strip is in the rail's order, and the tool, the stream
//      and the body the person is on do not change (the tab of the copy moves right by the width of the tab that arrived, as the mock's does)
//   i  the session (S3a): the window opens EMPTY when nothing was saved (decision A17: no page opens by itself); two tabs of two plugins, the rail on the second and the panel open on the second plugin's tool
//      at a height the keyboard chose come back after a reload of the page, and after the host's process is stopped and started again (the packaged app's restart, in server mode); a session whose plugin is not
//      installed keeps its tab and says so; a session of a newer version, and a text that is no session, are kept aside in a slot of their own and never deleted, and the window opens empty. The session lives in
//      the host's window service (`backend/window`: `GetState` and `SaveState`, persisted to `windows.json` in the state root), the one the packaged app uses
//   j  the command palette (C1b, host providers): the chord opens it from a control of the page and the focus is in its input; typing the name of a page the plugin's sidebar opens finds it; the footer says the
//      four open keys the tab model has and none for a window (Shift Enter is refused, with the reason); Enter opens the page in the tab on screen (smart open: the same plugin), Option Enter opens it here (the tab
//      on screen goes to another plugin's page), Command or Control Enter opens a background tab, Command Shift Enter a new tab on screen; Escape gives the focus back to the control that had it, and so does the Search
//      control of the top row; the homes of the plugins that did not load say Degraded; the host's commands are exactly the ones it can run (Close tab, Toggle panel, Next tab, Previous tab in a browser tab),
//      each with the chord it is bound to; a kind with no provider (Settings) says Nothing to show yet. SHOTS=<dir> writes `host-<engine>-<state>.png` of the palette in those states
//   k  a plugin's unload and the Logs sessions (P1b-3c, A21): the fixture plugin's interface is unloaded while two Logs sessions follow its item, one that failed on its own and one that streams (the window's plugin
//      store, reached through React's hooks, since nothing in the product unloads a ready plugin yet; the bundle's request is held so the plugin stays off): both tabs STAY, in the same view with the lines they had
//      read, the streams closed once (the plugin counts it); the one that streamed ENDED, the one that had failed is AS IT WAS (its own words and time); each card says the plugin was unloaded and its resource link and
//      Open button cannot be used; the bundle is let through and nothing resumed, the link works, and a new press of Logs opens a NEW session beside them; closing the tabs frees every listener and closes each stream
//      once (SEAM_SHOTS=<dir> writes WebKit's pictures: before the unload, after it, after the reload; SEAM_CONTROL=<name> runs k alone with one perturbation that its named assertion must see)
//   l  the plugins' providers in the command palette (C1c), on the real host with two plugins loaded from bundles built outside the host's tree: each declares a `match` provider and three `search` providers in its
//      `contributionV1` (plugins/fixture/src/palette.ts), quiet until the check makes the page's control. With it: a typed item name finds the rows of both plugins, each plugin's section headed by its name, the fast
//      provider's before the slow one's; Enter opens the plugin's page in the tab on screen, Command Enter in a background tab, Option Enter here (the tab goes to the other plugin's page), Command Shift Enter in a new
//      tab; a plugin's command runs with its argument and the panel handle the host gave it; a provider that rejects is said in the band with a Retry (the plugin's words are not on screen); a plugin whose interface is
//      unloaded while the palette is open and its slow request in flight loses its section, the request is told to stop, and the other plugin's section stays; when it is loaded again its section comes back with no key
//      pressed; a plugin that fails to load loses its section the same way and gets it back with its bundle. SHOTS=<dir> writes `host-<engine>-providers.png` and `host-<engine>-providers-error.png`
//   m  a Logs session is its plugin and its target (P1b-3d, A22): pressing the command of a session that streams shows it and the plugin is asked for no second feed (it counts them); a target with the title of another and
//      another scope (the fixture's `app` and its twin in the south yard) is a second tab, each of the two draws its scope, and the tab that is left draws none when the other closes (a lone session draws no scope); a
//      session that ended on its own and one that failed are not shown again, a press opens a NEW session beside each, told by its ordinal, and no two tabs are named alike; closing every tab frees every listener and closes
//      each feed once (SEAM_SHOTS=<dir> writes WebKit's `identity-one-session.png` and `identity-twins.png`; SEAM_CONTROL=<name> runs m alone with one perturbation that its named assertion must see, and that
//      assertion only: a page that drew no tab, or the wrong one, is a failure of its own and never a detection)
//   n  a plugin that stops reaches the window (PU1, A21): the fixture plugin gets a PROCESS (`fixture/process`) and a host of its own (the other scenarios' plugins have none), the window shows its page, its Logs
//      session and its tool, and the check asks the host for the plugin's pid (`processinfo`, never a pattern), makes the plugin unable to start again (its binary loses its execute bit) and kills that pid. The host
//      finds the process gone on its next health check (up to 30 s) and says so with `plugin/unloaded` (the frames of the window's event socket are read: the plugin's id and `crashed`, no other member); what the
//      window shows is read: the rail names the plugin stopped, with the cause in its tip, its sidebar and its tool leave, its page's tab says why with a Retry, and the Logs session STAYS, ended with "The plugin was
//      unloaded." in the same view with its lines; the host's recovery reloads the plugin (a second `plugin/unloaded`, `reloaded`) and fails, and the rail still says stopped (the first cause stands); with the binary
//      back and the plugin loaded again the host says it runs (`plugin/state_change`), and the window shows one of everything again with no reload: one rail entry, one tab on its page, one tool, the session as it was, and the
//      sidebar as the user left it (S3, demo finding D5): the group of the page on screen is closed by the user before the plugin is killed, and it is still closed when the plugin is back (a tree that remembered nothing would open
//      it again for the entry the page is on), and the plugin's hook is told that no group is open (SEAM_SHOTS=<dir> writes WebKit's `sidebar-after-restart-webkit-void-1440x900.png` of the window then).
//      SEAM_CONTROL=process runs n alone with every perturbation of its controls (PROCESS_CONTROLS) made in turn just before the assertion each must trip, and passes when each tripped its own (one kill serves all of them:
//      the host's health check is up to 30 s); SEAM_CONTROL=<one of them> makes that one only, and SEAM_REMOVE=<one of them> leaves that control's assertion out, which must let its perturbation pass undetected
//   o  a page command that fails is a toast (O1b-1): on the item's detail page the fixture's Restart rejects as the runtime's hooks do (`window.__fixtureDetail`); the host's toast says `Timed out` with its one sentence and a Retry,
//      is an alert, is sticky (it is still there after 9 s, when a timed one would be gone) and takes no focus; F6 reaches it and Escape closes it and gives the focus back to where it was; a failure that is not the host's says
//      `Operation failed` and none of its text (a password in it is nowhere in the document); a cancelled command makes no toast; a failure that comes back after its toast was dismissed is the same record and its toast says `Timed out 2 times`,
//      and Retry makes the third: `Timed out 3 times` (each wait is on a state that lasts, never on the frame between them: O1b-2, status/O1b-2.md)
//
//   p  a plugin whose load fails reaches the window and can be retried (PU2, PU1-01 and PU1-02): the same host and fixture process as n, whose NEXT START the check makes fail with a file next to its binary (`start-mode`:
//      `exit` ends the process before it says it is ready, `hang` keeps it silent). The host is asked to reload the plugin (`ReloadPlugin`, as a rebuild does) and its load fails: the frames of the window's event socket are
//      read (`plugin/unloaded`: `reloaded`, then `failed`, the plugin's id and the cause and no other member, and no phase of Running); the rail names the plugin that did not start, with the host's sentence in its tip,
//      its tab says why with a Retry and draws no page and no spinner, the host kept a record of the plugin (it is listed as Failed, so Retry has something to retry), and a window that is opened then, which the host told nothing,
//      learns it from the inventory and shows the plugin failed from the first. The Retry asks the host: the plugin starts again, fails
//      again, and the window is back in the failed state, never in a spinner. With the process told to hang, Retry shows the plugin starting again (a spinner, no Retry to press twice) for as long as the host waits, and the
//      load ends as failed with the cause `timeout` within the loader's own start timeout (15 s); the sentence says it took too long. With the file gone, Retry runs the plugin: the host says it runs, and the window shows
//      one of everything again with no reload (SEAM_SHOTS=<dir> writes WebKit's pictures of the five states). The same process then speaks ANOTHER PLUGIN PROTOCOL (S4): the fixture's manifest says `sdk_protocol_version: 2`, the SDK's own override, so
//      the real process serves protocol 2 and the host refuses it by the number the handshake negotiated: `plugin/unloaded` says `incompatible` with the two numbers and no other member, the rail says update required, the tab says the host's sentence
//      and both versions and draws NO Retry (asking again cannot help) and no page, the host lists the plugin as Failed with the same two numbers, and a window opened then shows the same from the inventory; with the manifest put back the host
//      reloads the plugin and it runs again with no reload. SEAM_CONTROL=failed-load runs p alone with every perturbation of its controls (FAILED_CONTROLS) made in turn just before the assertion each must trip; SEAM_CONTROL=<one of them>
//      makes that one only, and SEAM_REMOVE=<one of them> leaves that control's assertion out, which must let its perturbation pass undetected (the proof that each control trips its own assertion and no other)
//
//   q  the notification centre (O1b-2): the history a failed page command leaves, read from the bell, over the real host. A failure whose toast the person DISMISSES is read (the model: S81): the bell has no dot (its name is
//      exactly `Notifications`), the centre opened from the bell lists the record, read, the focus is on its row's title, and Escape closes it and gives the focus back to the bell. A failure whose toast is NOT dismissed is an
//      unread record (`Notifications, 1 unread, 1 error`); opening the centre takes the toast out of the layer (one presenter: the stack waits while the centre is open) and a failure that arrives while it is open is in the
//      list with no toast; closing it with Escape after more than 1 s reads what it listed (the bell is `Notifications` again, no toast comes back, the focus is on the bell). After a RELOAD, once the window service holds the
//      history (the first time the history is read from it), the window restores it: the bell has no dot, the restored records raised no toast and no announcement, and a restored record's Retry is not offered: its row says
//      `Retry is unavailable. Not available after restart.`
//
//   s  Settings (ST1) over the real host, in the sheet and in the Settings window: a host of its own with no plugins (Settings needs the host's settings service, its window service and a state root nothing else wrote), six independent
//      parts, then the watch over errors that covers them. The sheet (what a browser has in place of the native window): the chord, the gear and the palette's command open it with the host's own rows; a toggle applies at once
//      and is still applied after a reload; a value the host refuses (`developer.pprof_port` 70000) says the host's words in its lane and the host keeps what it had; Escape closes it and the focus goes back. The window
//      (`/?screen=settings-window`, what the native window of kind `settings` draws): no shell, no dialog, a caption with Close; `OpenSettings` names its page and shows it, `HideSettings` hides it, a show again asks the host what it
//      holds now, and Escape, the close chord and Close hide it by asking the host. The two together: a change in one reaches the other within 2 s through the host's `settings/changed`, and a draft typed in the sheet survives a
//      change of another setting made in the window. The slots: 100 window pages opened and closed one after another all read their rows, and the window service lists the windows it listed before (the realm refuses a 64th LIVE
//      window and retires a closed page after about 3.4 s: INV2). The secrets (the host declares three, in Telemetry): one is saved through the sheet, is said to be saved after a reload, is cleared, and its value is never in the document,
//      in the host's snapshot or in the host's log. The popups: a tooltip inside the open sheet is shown above it, and a native select takes type-ahead. The log: no page error and no settings error in the host's log.
//      SEAM_CONTROL=settings runs s alone with every control of SETTINGS_PARTS made in turn; SEAM_CONTROL=<name> makes one, in the part it belongs to alone; SEAM_REMOVE=<name> leaves that control's assertion out, and its perturbation must then pass undetected
//   t  the Plugins page (PL1): the host's own page for the plugins that are installed, opened as a person opens it (the palette's command Plugins, no hash), on a host of its own whose fixture plugin has a PROCESS (as in n and p) and whose copy has none, and in a
//      second page, which is a second window in server mode, opened the same way and never reloaded. The list is the host's inventory (`ListPlugins`: the rows, their versions and their order, and the count the heading and the footer say). Each action
//      is read from the host's EVENTS, in the host's order, with the page's own call held on its way to the host (the page says that the work is going on and nothing of its result) or on its way back (the host has done it and told its events,
//      and the row has followed them with the call still open). RELOAD: `plugin/unloaded` (reloaded), then `plugin/state_change` (Running); the row and the header show the work and Starting again; the rail agrees. DISABLE: the row says Disabled
//      from `plugin/enablement_changed`. ENABLE is two host calls (`SetPluginEnabled(true)`, then `ReloadPlugin`): the half-way state is read, and so is the end of an Enable whose second call fails (the binary has lost its execute bit): the plugin is on
//      and did not start, and the row, the rail and the host's own record say so in the host's words and never in its text (the raw answer, the crash's error and the reasons of the events are nowhere in either window), with a sticky notice of the
//      host and a Retry that starts the plugin and does not turn it on again. KILL: the pid the host names (never a pattern), the row says Stopped with the host's sentence for a crash and offers Retry, the host gives up its recovery and the cause stands, and
//      Retry from the page asks the host and the plugin runs. UNINSTALL, behind the browser's own confirm (the page's words for what it erases and keeps; Cancel and Escape close it, give the focus back to the control that opened it and call nothing of
//      the host): the row and the rail entry leave on `plugin/unloaded` (uninstalled) with the call still open, the plugin's directory is gone, and the second window loses the row with no reload. SEAM_SHOTS=<dir> writes WebKit's
//      `plugins-page-<state>-webkit-void-1440x900.png`. SEAM_ONLY=plugins-page runs t alone; SEAM_CONTROL=plugins-page runs it alone with every perturbation of its controls (PAGE_CONTROLS) made in turn just before the assertion each must trip (one run
//      serves them all); SEAM_CONTROL=<one of them> makes that one only, and SEAM_REMOVE=<one of them> leaves that control's assertion out, which must let its perturbation pass undetected
//
//   The failed requests (INV1): every request any page of the run makes that answers 4xx or 5xx is recorded with the phase it happened in, and the phase fails unless each is in RUNTIME_ALLOW (an explicit list: the entry, its reason, the phases it
//   is expected in). SEAM_CONTROL=runtime-4xx plants one 422 in a clean page and passes when the phase's assertion saw it; SEAM_REMOVE=runtime-4xx leaves that assertion out, and the planted 422 must then pass undetected
//
//   Every scenario starts from a window with nothing saved: the host keeps ONE session for its main window, and a page that a scenario left behind would be restored by the next.
//
//   node ui-next/plugins/e2e/seam.check.mjs        needs bin/Omniview-server (OMNIVIEW_UI=next task build:server) and Playwright's browsers; ENGINES=webkit or ENGINES=chromium runs one engine
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { SHARED_SPECIFIERS_V1 } from '../loader/specifiers.ts';
import { buildProcess, writeAll, writePlugin } from '../fixture/build.mjs';
import { uninstallWords } from '../../shell/plugins-page/core/words.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = path.join(root, 'bin/Omniview-server');
const OK = 'fixture-a-ok';
const DUP = 'fixture-b-dup';
const OLD = 'fixture-c-old';
const MISSING = 'fixture-d-missing';

// The negative controls of scenarios k and m: SEAM_CONTROL=<name> runs the scenario the control belongs to alone, with one perturbation made just before the assertion that must see it and undone just after it, and passes (exit 0) when that assertion failed.
const CONTROLS = {
  'double-close': /the plugin's feeds were closed once each/,
  'new-view': /it is the same view/,
  'failed-ended': /the failed session stays failed/,
  'close-twice': /close was asked of each feed once \(the calls are counted/,
  'page-error': /the unload and the return wrote no page error/,
  // Scenario m, the identity of a Logs session (P1b-3d). Each control is detected by ITS assertion and by nothing else: what the perturbation needs of the page (the tab it changes, the counters it leaves alone) and the
  // baseline it starts from (one feed asked for, a tab with no scope part, tabs named apart: asserted under the control only, so that its assertion is not already failing before the perturbation) are asked for first, in
  // words none of these patterns match, so a page that drew no tab, or one that is wrong in another way, is a failure of its own and never a detection.
  'second-stream': /the second press of Logs: app showed the session and started no second stream/,
  'scope-lone': /a session with no twin draws no scope part/,
  'scope-kept': /the tab that is left when its twin closes draws no scope part/,
  'same-name': /no two session tabs are named alike/,
  // The watch over failed requests (INV1): a request the allow-list does not name fails its phase. The control plants one 422 in a page that is otherwise clean, and the assertion of the phase must see it; with SEAM_REMOVE=runtime-4xx that assertion is left out and the planted one must pass undetected.
  'runtime-4xx': /the requests that failed are all in the allow-list \(phase runtime-4xx\)/,
  // Scenario s, Settings (ST1): SEAM_CONTROL=<name> runs the part of s that holds the control alone, and makes one perturbation just before the assertion it is named for, which must fail with ITS words and no other (SETTINGS_PARTS). An assertion of s is a
  // read of what the perturbation changes: the acts that lead to it are made again under the perturbation, and again once it is undone. A page's own calls to the host are changed by a route of the page (a copy of what the host answers, never the host).
  'settings-persist': /a toggle applied in the sheet is still applied after the page is reloaded/,
  'settings-words': /the lane says the host's own words for a value it refuses/,
  'settings-hide': /Escape in the Settings window asks the host to hide it/,
  'settings-reach': /a change made in the Settings window reaches the sheet within 2 s/,
  'settings-draft': /a draft typed in the sheet is not replaced by a change made in the window/,
  'settings-slots': /window page 64 of 100 read its rows/,
  'settings-secret-saved': /after a reload the secret row says Saved · hidden/,
  'settings-secret-dom': /the secret is nowhere in the document/,
  'settings-secret-log': /the secret is not in the host's log/,
  'settings-tooltip': /the tooltip is painted above the sheet/,
  'settings-typeahead': /typing the first letters of an option in the sheet's select chooses it/,
  'settings-error': /no page of the scenario wrote an error/,
  'settings-log': /the host's log holds no settings error/,
};
const RUNTIME_CONTROL = 'runtime-4xx';
/** The controls that belong to scenario m; every other one runs scenario k. */
const IDENTITY_CONTROLS = ['second-stream', 'scope-lone', 'scope-kept', 'same-name'];
/** Scenario s runs alone under SEAM_CONTROL=settings with every control made in turn, or under the name of one control, in the part of the scenario that holds it (`checkSettings`). */
const SETTINGS_GROUP = 'settings';
const SETTINGS_PARTS = {
  'settings-persist': 'sheet',
  'settings-words': 'sheet',
  'settings-hide': 'window',
  'settings-reach': 'truth',
  'settings-draft': 'truth',
  'settings-slots': 'slots',
  'settings-secret-saved': 'secrets',
  'settings-secret-dom': 'secrets',
  'settings-secret-log': 'secrets',
  'settings-tooltip': 'popups',
  'settings-typeahead': 'popups',
  'settings-error': 'log',
  'settings-log': 'log',
};
// The negative controls of scenario n, the plugin that stops (PU1). Each is a perturbation made just before the assertion that must see it and undone right after, and the assertion must fail with ITS words and no
// other. One run serves them all (SEAM_CONTROL=process: the host finds a killed process on its next health check, up to 30 s, so a run for each would cost minutes); SEAM_CONTROL=<name> makes that one only. A page
// that is wrong in another way fails an assertion of its own, outside a perturbation, and is never taken for a detection.
const PROCESS_CONTROLS = {
  'pid-pattern': /the process the host names is the fixture plugin's own/,
  'frame-text': /the host's plugin\/unloaded carries the plugin's id and the cause and no other member/,
  'rail-fine': /the rail names the plugin that stopped, with the cause in its tip/,
  'page-drawn': /the tab of the plugin that stopped says why and draws no page of it/,
  'tool-stays': /the tool of the plugin that stopped leaves the panel and the other plugin's stays/,
  'session-live': /the Logs session stays, ended, in the same view with the lines it had/,
  'rail-moved-on': /the first cause stands while the host recovers the plugin: the rail still says stopped/,
  'rail-stuck': /the rail names the plugin that runs again, with no word of its stop/,
  'two-pages': /one of everything: one page, one sidebar entry, one tool/,
  'sidebar-reset': /the sidebar comes back as the user left it/,
};
// The negative controls of scenario p, a plugin whose load fails (PU2). As in n each is a perturbation made just before the assertion that must see it and undone right after, and the assertion must fail with ITS words and no other.
// One run serves them all (SEAM_CONTROL=failed-load); SEAM_CONTROL=<name> makes that one only; SEAM_REMOVE=<name> leaves that assertion out, and the perturbation must then pass undetected.
const FAILED_CONTROLS = {
  'told-frames': /the host's plugin\/unloaded carries the plugin's id and the cause and no other member \(a load that failed\)/,
  'told-failed': /the window was told the reload and then that the load failed, and the plugin did not run/,
  'rail-failed': /the rail names the plugin that did not start, with the host's sentence in its tip/,
  'tab-failed': /the tab of the plugin that did not start says why, with a Retry, and draws no page/,
  'no-spinner': /no spinner is left in the tab of a plugin that did not start/,
  'record-kept': /the host kept a record of the plugin that did not start/,
  reopened: /a window that opens while the plugin is failed shows it failed from the first: the rail, the sentence and the Retry/,
  'failed-again': /a second failure returns to the failed state: the rail, the sentence and the Retry/,
  progress: /Retry shows the plugin starting again, with no Retry to press twice/,
  'told-timeout': /the host said the load ran out of time/,
  'timeout-ends': /the plugin that did not answer ends as timed out and not as a spinner/,
  'rail-back': /the rail names the plugin that runs again, with no word of its failure/,
  'one-of-all': /after the retry that runs: one page, one sidebar entry, one tool/,
  incompatible: /a plugin the host refused for its protocol says why, with the two versions and no Retry/,
};
// The negative controls of scenario t, the Plugins page (PL1). As in n and p each is a perturbation made just before the assertion that must see it and undone right after, and the assertion must fail with ITS words and no other.
// One run serves them all (SEAM_CONTROL=plugins-page); SEAM_CONTROL=<name> makes that one only; SEAM_REMOVE=<name> leaves that assertion out, and the perturbation must then pass undetected.
const PAGE_CONTROLS = {
  'list-inventory': /the list is the host's inventory/,
  'reload-told': /the window was told the reload in the host's order/,
  'reload-progress': /the row and the header show the reload in progress and then the plugin running/,
  'reload-state': /after the reload the row says the plugin runs, with no word of its state/,
  'reload-rail': /after the reload the rail agrees with the row/,
  'disable-word': /Disable: the row says Disabled from the host's events while the call is still open/,
  'enable-runs': /Enable: the row goes from Disabled through Stopped and Starting to running/,
  'enable-half': /an Enable that could not start the plugin: the row says it is on and did not start/,
  'enable-notice': /an Enable that could not start the plugin: a sticky notice of the host/,
  'raw-text': /nothing the page draws holds the host's own words for an error/,
  'stopped-word': /a plugin whose process was killed: the row says it stopped/,
  'confirm-words': /the confirm says what an uninstall does, in the page's words/,
  'confirm-focus': /closing the confirm gives the focus back to the control that opened it/,
  'uninstall-gone': /Uninstall: the row and the rail entry leave on the host's event while the call is still open/,
  'second-list': /the second window's list lost the row with no reload/,
};
const FAILED_GROUP = 'failed-load';
const PAGE_GROUP = 'plugins-page';
const CONTROL = process.env.SEAM_CONTROL ?? '';
const REMOVE = process.env.SEAM_REMOVE ?? '';
// SEAM_ONLY=plugins-page runs scenario t alone, with no perturbation, held to the allow-list of failed requests as in a full run.
const ONLY = process.env.SEAM_ONLY ?? '';
if (ONLY !== '' && ONLY !== PAGE_GROUP) {
  throw new Error(`SEAM_ONLY must be ${PAGE_GROUP}`);
}
if (CONTROL !== '' && CONTROL !== 'process' && CONTROL !== FAILED_GROUP && CONTROL !== SETTINGS_GROUP && CONTROL !== PAGE_GROUP && CONTROLS[CONTROL] === undefined && PROCESS_CONTROLS[CONTROL] === undefined && FAILED_CONTROLS[CONTROL] === undefined && PAGE_CONTROLS[CONTROL] === undefined) {
  throw new Error(`SEAM_CONTROL must be one of ${[...Object.keys(CONTROLS), 'process', ...Object.keys(PROCESS_CONTROLS), FAILED_GROUP, ...Object.keys(FAILED_CONTROLS), PAGE_GROUP, ...Object.keys(PAGE_CONTROLS), SETTINGS_GROUP].join(', ')}`);
}
if (REMOVE !== '' && FAILED_CONTROLS[REMOVE] === undefined && PROCESS_CONTROLS[REMOVE] === undefined && PAGE_CONTROLS[REMOVE] === undefined && SETTINGS_PARTS[REMOVE] === undefined && REMOVE !== RUNTIME_CONTROL) {
  throw new Error(`SEAM_REMOVE must be one of ${[...Object.keys(PROCESS_CONTROLS), ...Object.keys(FAILED_CONTROLS), ...Object.keys(PAGE_CONTROLS), ...Object.keys(SETTINGS_PARTS), RUNTIME_CONTROL].join(', ')}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => {
        resolve(port);
      });
    });
    probe.on('error', reject);
  });
}

/** The state root of the host the check starts: what the window service persists (`windows.json`) lives here, and is kept when the host is started again. */
const stateRoot = (work) => path.join(work, 'home', '.omniview-feature-ui-next');

/**
 * Starts the host. `built` is what the plugins' build wrote: a host that is started again (the restart of scenario i) is given it and builds nothing, over the same state root. `write` is what builds them when
 * nothing was (`writeAll`: the four plugins of the fixture, none of them with a process; scenario n writes its own).
 */
async function startHost(work, port, built = undefined, write = writeAll) {
  const home = path.join(work, 'home');
  const plugins = path.join(stateRoot(work), 'plugins');
  await mkdir(plugins, { recursive: true });
  built ??= await write(plugins);
  const logFile = path.join(work, 'host.log');
  // A minimal environment, so nothing ambient (a credential, a config path of the developer's machine) reaches the host or a plugin: only the profile the check built.
  const { PATH, TMPDIR, LANG, USER } = process.env;
  const child = spawn(server, [], {
    env: { PATH, TMPDIR, LANG, USER, HOME: home, OMNIVIEW_CHANNEL: 'feature-ui-next', WAILS_SERVER_HOST: '127.0.0.1', WAILS_SERVER_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => lines.push(String(chunk)));
  }

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (exited) {
      throw new Error(`the host exited while starting:\n${lines.join('').slice(-2000)}`);
    }

    try {
      if ((await fetch(`http://127.0.0.1:${String(port)}/`)).ok) {
        return { child, built, base: `http://127.0.0.1:${String(port)}`, tail: () => lines.join('').slice(-3000), output: () => lines.join(''), logFile };
      }
    } catch {
      // not listening yet
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`the host did not answer in 60 s:\n${lines.join('').slice(-2000)}`);
}

/** The window as the native app opens it: `/`, no `?screen=`, no URL parameter at all; a hash only where a check names a page or a connection. */
async function open(page, base, hash = '') {
  await page.goto(`${base}/${hash}`, { waitUntil: 'load' });
}

const WINDOW_SERVICE = 'github.com/omniviewdev/omniview/backend/window.Service';
const PLUGIN_SERVICE = 'github.com/omniviewdev/omniview/backend/pkg/plugin.ServiceWrapper';
const PROCESS_SERVICE = 'github.com/omniviewdev/omniview/internal/processinfo.Service';
const SETTINGS_SERVICE = 'github.com/omniviewdev/omniview/backend/pkg/settings.Binding';

/** A call of a bound method of the host, by service and name, as the page's own runtime makes one, whatever the host answers: the status and the text of the answer. */
async function tryBound(base, service, method, ...args) {
  const response = await fetch(`${base}/wails/runtime`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wails-client-id': 'seam-check' },
    body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `seam-${method}-${Date.now()}`, methodName: `${service}.${method}`, args } }),
  });
  return { status: response.status, text: await response.text() };
}

/** A call of a bound method of the host, by service and name, as the page's own runtime makes one. The answer is the JSON of what the method returned; a method that returned an error is a failure of the check. */
async function callBound(base, service, method, ...args) {
  const { status, text } = await tryBound(base, service, method, ...args);
  assert.equal(status, 200, `${method} was answered ${String(status)}: ${text}`);
  return JSON.parse(text);
}

/** A call of a bound method of the window service: the window's slots are read and written through the same service the shell uses. */
async function callHost(base, method, ...args) {
  return callBound(base, WINDOW_SERVICE, method, ...args);
}

/**
 * Nothing saved for the main window: what a first run of the app finds, no session and no notification history. (The slots hold JSON, and JSON `null` is nothing: no session, no history.) A page that was just left may
 * still have a write on its way (the quiet time of the saver, then the call), and it would replace what is forgotten here: it lands first.
 */
async function forgetSession(base) {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await callHost(base, 'SaveState', 'main', 'session', 'null');
  await callHost(base, 'SaveState', 'main', 'notices', 'null');
}

/** A page of a window with nothing saved. A scenario that follows another starts here, so it never restores what the one before left. */
async function freshPage(browser, base) {
  await forgetSession(base);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  return page;
}

/** The empty window's way forward: the first plugin of the list opens in a tab. Decision A17 and S3a: no page opens by itself, so a check that is about a page opens one as a person does. */
async function openFirstPlugin(page, name = 'Seam Fixture') {
  await page.getByRole('region', { name: 'Plugins you can open' }).getByRole('button', { name, exact: true }).click();
}

/**
 * Every request that answers 4xx or 5xx, in any page the check opens, is recorded with the phase it happened in (`phase`), and a phase fails unless each of its failures is in RUNTIME_ALLOW: an explicit list, each entry with the reason
 * it is expected and the phases it is expected in. The check used to print them; the 422 `activity session unavailable` of Chromium on Linux (INV1) was printed in every run for as long as nobody read it. The browser's own console line for a
 * failed request ("Failed to load resource") is the same event and is not counted twice; any other console error is a scenario's own business (each asserts its page's errors).
 */
const failedRequests = [];
const pendingBodies = [];
const phasePages = [];
let currentPhase = '';
const RUNTIME_ALLOW = [
  {
    phases: null,
    reason: 'a plugin with no bundle is a named state (scenario e): every page load asks for the bundle of each installed plugin and the host answers 400 for the one that has none',
    test: (failure) => failure.status === 400 && failure.path === `/_/plugins/${MISSING}/assets/entry.js`,
  },
  {
    phases: ['process', 'failed-load'],
    reason: 'scenarios n and p take the plugin\'s process down or make its load fail; the page asks for the plugin\'s connections and the host answers with the load failure',
    test: (failure) => failure.status === 422 && failure.answered.includes('omniview:plugin/load-failed'),
  },
  {
    phases: ['plugins-page'],
    reason: 'scenario t presses Enable on a plugin whose binary has lost its execute bit: the second call of Enable, ReloadPlugin, is refused with the load failure, which is the half-done state the scenario asserts (the host answers 422)',
    test: (failure) => failure.status === 422 && failure.asked.includes(`"methodID":${String(methodIdOf(PLUGIN_SERVICE, 'ReloadPlugin'))},`) && failure.answered.includes('omniview:plugin/load-failed'),
  },
];

/** Records every failed request of the page, whichever phase is running when it answers. */
function watchRequests(page) {
  phasePages.push(page);
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    const failure = { phase: currentPhase, status: response.status(), method: request.method(), path: new URL(response.url()).pathname, asked: String(request.postData() ?? '').slice(0, 400), answered: '' };
    failedRequests.push(failure);
    pendingBodies.push(
      response.text().then(
        (body) => {
          failure.answered = body.slice(0, 400);
        },
        () => undefined,
      ),
    );
  });
}

/** Fails unless every request that failed in the phase is in RUNTIME_ALLOW, and names each one that is not with what was asked and what came back. */
async function unexpectedFailures(name) {
  await Promise.all(pendingBodies.splice(0));
  return failedRequests
    .filter((failure) => failure.phase === name)
    .filter((failure) => !RUNTIME_ALLOW.some((entry) => (entry.phases === null || entry.phases.includes(name)) && entry.test(failure)))
    .map((failure) => `${failure.method} ${failure.path} -> ${String(failure.status)}: asked ${failure.asked} | answered ${failure.answered}`);
}

async function assertExpectedFailures(name, engine) {
  assert.deepEqual(await unexpectedFailures(name), [], `${engine}: the requests that failed are all in the allow-list (phase ${name})`);
}

/** Runs one scenario (or a few that share a page) as a phase: the requests that fail while it runs are held to RUNTIME_ALLOW when it ends. */
async function phase(name, engine, run) {
  currentPhase = name;
  await run();
  // A page a scenario leaves open would go on calling the host (the activity provider's heartbeat is every 10 s) and its failures would land in the phase that follows, so the phase closes what it opened.
  for (const page of phasePages.splice(0)) if (!page.isClosed()) await page.close();
  await assertExpectedFailures(name, engine);
}

/**
 * The control of the watch over failed requests: a page that loads clean (its own calls all answer 2xx: asserted first, in words the control does not match, so a page that fails on its own is never taken for a detection), then one call that
 * must be refused is made from it, as the page's runtime makes a call (the activity service, a session the host never issued: 422). The assertion of the phase must fail with ITS words; the planted failure is then forgotten and the
 * assertion must pass again.
 */
async function checkRuntimeWatch(page, base, engine) {
  const { asserting, verdict } = withControls(RUNTIME_CONTROL, CONTROLS);
  currentPhase = RUNTIME_CONTROL;
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  assert.deepEqual(await unexpectedFailures(RUNTIME_CONTROL), [], `${engine}: the page made no failed request of its own before the planted one`);
  await asserting(
    RUNTIME_CONTROL,
    async () => {
      const status = await page.evaluate(async () => {
        const response = await fetch('/wails/runtime', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-wails-client-id': window._wails.clientId },
          body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `planted-${String(Date.now())}`, methodName: 'github.com/omniviewdev/omniview/backend/pkg/activity.FrontendService.Heartbeat', args: ['planted-session'] } }),
        });
        return response.status;
      });
      assert.equal(status, 422, `${engine}: the planted call was refused as a call with no session is`);
      for (let attempt = 0; attempt < 50 && failedRequests.every((failure) => failure.phase !== RUNTIME_CONTROL); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    },
    () => {
      for (let index = failedRequests.length - 1; index >= 0; index -= 1) if (failedRequests[index].phase === RUNTIME_CONTROL) failedRequests.splice(index, 1);
    },
    () => assertExpectedFailures(RUNTIME_CONTROL, engine),
  );
  await page.close();
  verdict(engine);
}

async function checkHealthy(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // The browser's own line for a request that answered 4xx is not a script error: the requests are listed below and each must be one the check expects.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(`console: ${message.text()}`);
  });
  // The fixture's `useConnections` swallows a failed call into an empty list, so the rendered count alone cannot tell a failure from an empty answer: the check
  // records how the host answered the Wails runtime calls that carry the fixture's plugin id (generated bindings are called by id, not by name; the only such call is
  // `ListConnections(pluginId)`).
  const connectionCalls = [];
  page.on('response', (response) => {
    const body = response.request().postData() ?? '';
    if (new URL(response.url()).pathname === '/wails/runtime' && body.includes(`"${OK}"`)) connectionCalls.push(response.status());
  });

  // a. no route at all and nothing saved: the window is EMPTY (decision A17, S3a: no page opens by itself; a first run has no session), with the plugins that can be opened. A plugin of the list opens its home page.
  await forgetSession(base);
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByRole('tab').count(), 0, `${engine}: nothing opened by itself`);
  await page.getByText('No tabs are open.').waitFor();
  await openFirstPlugin(page);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: 'Items', selected: true }).waitFor();
  for (const name of ['orders-api', 'ledger-sync', 'ghost-service', 'vault-keeper', 'flaky-gateway']) await page.getByRole('link', { name }).waitFor();
  // K3a. The list sorts, in a plugin built outside the host's tree: its definition says it opens on Name, ascending, and its Name and Group columns declare their keys (plugins/fixture/src/pages.tsx); its five items are in
  // neither order, and two of them (orders-api and ledger-sync) are of one group. The header of the sort in force says so (`aria-sort`), a press on another column sorts it ascending with the tie in the order the SOURCE gave
  // (not in the order of the name), a press on the column in force turns it round, Enter and Space on the header's button do the same and leave the focus on it, and a column that declares no key has no button.
  const itemsOrder = async () => (await page.locator('table tbody tr[data-ov-index] td:first-child').allInnerTexts()).map((text) => text.trim());
  const sortState = (name) => page.getByRole('columnheader', { name, exact: true }).getAttribute('aria-sort');
  const sortButton = (name) => page.getByRole('columnheader', { name, exact: true }).getByRole('button', { name, exact: true });
  assert.deepEqual(await itemsOrder(), ['flaky-gateway', 'ghost-service', 'ledger-sync', 'orders-api', 'vault-keeper'], `${engine}: the list opens in the sort its definition names, Name ascending, though the source gave the items in another order`);
  assert.deepEqual([await sortState('Name'), await sortState('Group'), await sortState('Opens as')], ['ascending', 'none', null], `${engine}: the header of the sort in force says so, the other sortable header says none, and a column with no key says nothing`);
  assert.equal(await page.getByRole('columnheader', { name: 'Opens as', exact: true }).getByRole('button').count(), 0, `${engine}: a column that declares no key has no sort button`);
  await sortButton('Group').click();
  assert.deepEqual(await itemsOrder(), ['vault-keeper', 'orders-api', 'ledger-sync', 'ghost-service', 'flaky-gateway'], `${engine}: a press sorts the column ascending, and the two items of one group tie in the source's order`);
  assert.deepEqual([await sortState('Name'), await sortState('Group')], ['none', 'ascending'], `${engine}: and the column that was in force says none`);
  await sortButton('Group').press('Enter');
  assert.deepEqual(await itemsOrder(), ['flaky-gateway', 'ghost-service', 'orders-api', 'ledger-sync', 'vault-keeper'], `${engine}: Enter on the header's button turns the column round, and the tie keeps the source's order in this direction too`);
  assert.ok(await sortButton('Group').evaluate((button) => button === document.activeElement), `${engine}: the focus stays on the header's button`);
  await sortButton('Group').press('Space');
  assert.equal(await sortState('Group'), 'ascending', `${engine}: Space on it turns it back`);
  await sortButton('Name').click();
  assert.deepEqual(await itemsOrder(), ['flaky-gateway', 'ghost-service', 'ledger-sync', 'orders-api', 'vault-keeper'], `${engine}: a press on another column sorts that one ascending`);
  // H7. A history entry carries the page state of the page it left, in the real host and a plugin built outside its tree: the list sorted by Group and searched for "yard" (three items, in an order that is not the name's)
  // is what Back gives after the first row's detail page: the same search in the field, the same header in force, the same rows in the same order, the same first row. The fixture's list has no quick filter and five
  // rows, so the search stands for the filter and there is nothing to scroll: the offset is the jsdom chain's (PluginHost.sort.test.tsx) and the page probe's. Left as it was found: no search, Name ascending.
  await sortButton('Group').click();
  const itemsSearch = page.getByRole('searchbox', { name: 'Search Items', exact: true });
  await itemsSearch.fill('yard');
  await itemsSearch.press('Enter');
  const leftAs = await itemsOrder();
  assert.deepEqual(leftAs, ['orders-api', 'ledger-sync', 'ghost-service'], `${engine}: the search keeps the three items of a yard, in the order of the Group sort (the tie in the source's order), which is not the order of the names`);
  // SEAM_SHOTS=<dir> writes WebKit's pair: the list as it is left, and as Back gives it.
  const shotH7 = async (name) => {
    if (process.env.SEAM_SHOTS === undefined || engine !== 'webkit') return;
    await mkdir(process.env.SEAM_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SEAM_SHOTS, name) });
  };
  await shotH7('h7-list-before-leaving-webkit-void-1440x900.png');
  await page.getByRole('link', { name: leftAs[0], exact: true }).click();
  await itemsSearch.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await itemsSearch.waitFor();
  await shotH7('h7-list-after-back-webkit-void-1440x900.png');
  assert.equal(await itemsSearch.inputValue(), 'yard', `${engine}: Back gives the list its search`);
  assert.deepEqual(await itemsOrder(), leftAs, `${engine}: and its rows in the order it was left in, the first row the same`);
  assert.deepEqual([await sortState('Name'), await sortState('Group')], ['none', 'ascending'], `${engine}: with the header of the sort it was left in`);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await sortButton('Name').click();
  assert.deepEqual(await itemsOrder(), ['flaky-gateway', 'ghost-service', 'ledger-sync', 'orders-api', 'vault-keeper'], `${engine}: the list is as it was found`);
  // The sidebar's hook answers 150 ms after it mounts: the skeleton gives way to the entries with their count. The entry declares its count slot in the skeleton (`count: null`) and the hook answers an estimate
  // (`{ value: 5, approximate: true }`), which the shell draws as "~5" and names "about 5" (Q2a).
  await page.getByRole('treeitem', { name: 'Items about 5' }).waitFor();
  assert.equal(await page.getByRole('treeitem', { name: 'Items about 5' }).locator('[data-shell-part="count"] [aria-hidden="true"]').innerText(), '~5', `${engine}: an estimate is drawn with a tilde`);
  // The host tells the plugin's hook which groups of its tree are open on screen: the group of the page on screen is open when the tree mounts, and the list follows the user's clicks on it (Q2a).
  const told = () => page.evaluate(() => window.__fixtureSidebar?.open ?? null);
  assert.deepEqual(await told(), ['things'], `${engine}: the hook was told that the group of the page on screen is open`);
  await page.getByRole('treeitem', { name: 'Things' }).click();
  await page.waitForFunction(() => JSON.stringify(window.__fixtureSidebar?.open) === '[]');
  assert.equal(await page.getByRole('treeitem', { name: 'Items about 5' }).count(), 0, `${engine}: the entries of a closed group are not on screen`);
  await page.getByRole('treeitem', { name: 'Things' }).click();
  await page.waitForFunction(() => JSON.stringify(window.__fixtureSidebar?.open) === '["things"]');
  await page.getByRole('treeitem', { name: 'Items about 5' }).waitFor();
  await page.getByRole('navigation', { name: 'Seam Fixture navigation' }).waitFor();
  await page.getByRole('main', { name: 'Seam Fixture workspace' }).waitFor();
  assert.equal(await page.evaluate(() => location.hash), '', `${engine}: the window opened with no hash`);

  // b. one React, one kit: the plugin's own `useTheme()` (a plugin of its own copy throws, c) shows the theme the host's provider holds.
  const theme = (await page.locator('[data-fixture=theme]').first().innerText()).trim();
  const attribute = await page.evaluate(() => document.documentElement.getAttribute('data-ov-theme'));
  assert.ok(theme.length > 0 && attribute !== null, `${engine}: the Theme cell reads the host's provider (${theme} / ${String(attribute)})`);
  const identity = await page.evaluate(async (entry) => {
    const bundle = System.get(entry);
    const kit = System.get('shared://@omniviewdev/kit');
    const react = System.get('shared://react');
    const runtime = System.get('shared://@omniviewdev/runtime/ui/v1');
    return {
      bundleLoaded: bundle !== null,
      sameReact: bundle.imports.useState === react.useState,
      sameKitText: bundle.imports.Text === kit.Text,
      sameKitUseTheme: bundle.imports.useTheme === kit.useTheme,
      sameRuntimeUseConnections: bundle.imports.useConnections === runtime.useConnections,
      registered: [...System.entries()].map(([id]) => id).filter((id) => id.startsWith('shared://')),
    };
  }, `${base}/_/plugins/${OK}/assets/entry.js`);
  assert.deepEqual(
    { ...identity, registered: undefined },
    { bundleLoaded: true, sameReact: true, sameKitText: true, sameKitUseTheme: true, sameRuntimeUseConnections: true, registered: undefined },
    `${engine}: the bundle holds the registry's instances`,
  );

  // The runtime read: the plugin's `useConnections()` is the host's shared one, so it ran in the host's QueryClient and activity provider, asked the real host over
  // the Wails runtime and got its answer back (the fixture has no backend, so the answer is an empty list). Until then the cell says `reading`.
  await page.waitForFunction(() => /^\d+ connections$/.test(document.querySelector('[data-fixture=connections]')?.textContent?.trim() ?? ''), null, { timeout: 20_000 });
  console.log(`${engine}: the fixture read through the shared runtime entry: "${(await page.locator('[data-fixture=connections]').first().innerText()).trim()}"`);
  // The cell cannot tell a failed call from an empty answer (the hook turns a failure into an empty list), so the host's answer to each call is checked too.
  assert.ok(connectionCalls.length > 0 && connectionCalls.every((status) => status === 200), `${engine}: the host answered the plugin's ListConnections call with success (${connectionCalls.join(', ') || 'none seen'})`);

  // The plugin's own CSS arrived inside the kit's plugin layer, and styles its own element.
  const css = await page.evaluate((id) => document.querySelector(`style[data-omniview-plugin-css="${id}"]`)?.textContent ?? '', OK);
  assert.ok(css.startsWith('@layer ov.plugin {'), `${engine}: the plugin's stylesheet is in the plugin layer`);
  assert.equal(await page.locator('[data-fixture=theme]').first().evaluate((element) => getComputedStyle(element).outlineStyle), 'dotted', `${engine}: and it applies`);

  // d. a page that throws is a state of that page only.
  await page.getByRole('treeitem', { name: 'Crash' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Crash[\s\S]*This page failed to display\./);
  // A sidebar entry opens the page through the tab model: the tab on screen is navigated in place (same plugin), so there is still one tab, and the address is not written (it is an input).
  await page.getByRole('tab', { name: 'Crash' }).waitFor();
  assert.equal(await page.getByRole('tab').count(), 1, `${engine}: a sidebar entry navigates the tab on screen in place`);
  assert.equal(await page.evaluate(() => location.hash), '', `${engine}: the window never writes the address`);
  assert.ok(await page.getByRole('navigation', { name: 'Seam Fixture navigation' }).isVisible(), `${engine}: the sidebar stays beside a failed page`);
  assert.equal(await page.getByText('crashed on purpose').count(), 0, `${engine}: the plugin's own words are not drawn`);
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('alert').waitFor();
  await page.getByRole('treeitem', { name: 'Items' }).click();
  await page.getByText('orders-api', { exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, `${engine}: another page of the same plugin draws`);

  // f. a list row opens its detail page (the contract's detail kind, with the object's identity in the route): a plain click is smart open and navigates this tab, the tab is called
  // `{name} · {Kind}`, the page loads and is ready, a command reports to the plugin's callback, and the back path leads to the list.
  await page.getByRole('link', { name: 'orders-api' }).click();
  await page.getByRole('tab', { name: /orders-api · Item/ }).waitFor();
  await page.getByRole('heading', { level: 1, name: 'orders-api' }).waitFor();
  await page.getByRole('heading', { level: 2, name: 'Details' }).waitFor({ timeout: 10_000 });
  assert.equal(await page.getByRole('heading', { name: 'Budget' }).count(), 0, `${engine}: a section with nothing to say is not drawn`);
  assert.equal(await page.getByRole('tab').filter({ hasText: 'Item' }).count(), 1, `${engine}: a plain click navigated the tab on screen`);
  await page.getByText('2 desired · 2 ready · 2 up to date').waitFor();
  await page.getByRole('button', { name: 'Scale' }).click();
  await page.getByText('3 desired · 3 ready · 3 up to date').waitFor();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Items' }).click();
  await page.getByRole('link', { name: 'ghost-service' }).waitFor();
  // Command (Control elsewhere) opens a background tab; each data state has its own words, and a Retry that is the plugin's.
  const key = (await page.evaluate(() => navigator.platform.includes('Mac'))) ? 'Meta' : 'Control';
  for (const name of ['ghost-service', 'vault-keeper', 'flaky-gateway']) await page.getByRole('link', { name }).click({ modifiers: [key] });
  assert.equal(await page.getByRole('tab').filter({ hasText: '· Item' }).count(), 3, `${engine}: three background tabs beside the list`);
  const states = [['ghost-service', /ghost-service was not found/], ['vault-keeper', /Access to vault-keeper is denied/], ['flaky-gateway', /Couldn't load flaky-gateway/]];
  for (const [name, words] of states) {
    await page.getByRole('tab', { name: new RegExp(`${name} · Item`) }).click();
    await page.getByRole('heading', { level: 1, name }).waitFor();
    await page.getByText(words).waitFor({ timeout: 10_000 });
  }
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('heading', { level: 2, name: 'Details' }).waitFor({ timeout: 10_000 });
  // Smart open re-activates: the link of an object that has a tab shows that tab and makes no twin.
  await page.getByRole('tab', { name: /^Items/ }).click();
  await page.getByRole('link', { name: 'vault-keeper' }).click();
  assert.equal(await page.getByRole('tab').filter({ hasText: '· Item' }).count(), 3, `${engine}: smart open showed the tab that had the object`);
  await page.getByRole('heading', { level: 1, name: 'vault-keeper' }).waitFor();

  const unexpected = errors.filter((entry) => !entry.includes('[plugins] fixture-a-ok page crash failed to render') && !entry.includes('crashed on purpose'));
  assert.deepEqual(unexpected, [], `${engine}: the healthy flow wrote no console error`);
  // The requests that failed are asserted by the phase (`phase`, `assertExpectedFailures`): each must be in the allow-list. Here only what this scenario needs of them: the plugin with no bundle is answered 400, always.
  const missing = failedRequests.filter((entry) => entry.phase === currentPhase && entry.path.includes(MISSING));
  assert.ok(missing.length > 0 && missing.every((entry) => entry.status === 400), `${engine}: the plugin with no bundle was answered 400 (${missing.map((entry) => String(entry.status)).join(', ')})`);
}

async function checkRefusals(page, base, engine) {
  const go = async (id) => {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, `#/${id}`);
  };

  // c. the negative control: the copy of the kit has no provider above it.
  await go(DUP);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Items[\s\S]*This page failed to display\./, `${engine}: a plugin with its own kit fails the Theme read`);

  // e. an old-shell bundle is refused before it ran; a plugin with no bundle says so.
  await go(OLD);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Seam Fixture Old[\s\S]*built for another version of the app/, `${engine}: the old bundle is refused by name`);
  assert.equal(await page.evaluate(() => window.__fixtureOldBundleRan), undefined, `${engine}: and it never ran`);
  await go(MISSING);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Seam Fixture Missing[\s\S]*could not be read/, `${engine}: no bundle is a named state`);
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('alert').waitFor();

  // and the healthy plugin is still there after all of it.
  await go(OK);
  await page.getByText('orders-api', { exact: true }).waitFor();
}

/**
 * g. The rail and the empty window, in a page of their own: `fixture-a-ok` declares the first place and `fixture-b-dup` the second, so they are listed in that order; a page of the second
 * fails (it has its own copy of the kit), which is how the check knows whose sidebar and whose page it is looking at, the two plugins being built from one source.
 */
async function checkRail(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, base);
  const chord = `${(await page.evaluate(() => navigator.platform.includes('Mac'))) ? 'Meta' : 'Control'}+KeyW`;
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  // With nothing saved the window is empty: the rail lists the plugins that contribute, the first current, before any tab is open.
  await openFirstPlugin(page);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });

  // One entry for each plugin that contributes, in the declared order; the window opened on the first, and its entry is the current one.
  const entries = page.getByRole('group', { name: 'Plugins' }).getByRole('button');
  // The plugins that contribute, in their declared order, then the ones that did not load (the old-shell bundle, the plugin with no bundle), by name, each named for what happened.
  assert.deepEqual(
    await entries.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
    ['Seam Fixture', 'Seam Fixture Copy', 'Seam Fixture Missing, did not load', 'Seam Fixture Old, did not load'],
    `${engine}: the rail lists the two plugins that contribute, in their declared order, and then the two that did not load`,
  );
  const current = (name) => page.locator(`[data-shell-part="rail"] [aria-label="${name}"][aria-current="true"]`);
  await current('Seam Fixture').waitFor();
  assert.equal(await current('Seam Fixture Copy').count(), 0, `${engine}: one entry is current`);

  // Choosing the other entry shows its sidebar and closes no tab: the page on screen is still the first plugin's.
  await entries.nth(1).click();
  await current('Seam Fixture Copy').waitFor();
  assert.equal(await page.getByRole('tab').count(), 1, `${engine}: choosing an entry closed no tab`);
  await page.getByRole('link', { name: 'orders-api' }).waitFor();
  assert.equal(await page.getByRole('treeitem', { selected: true }).count(), 0, `${engine}: the page on screen is not in the sidebar that is shown`);

  // An entry of that sidebar opens its plugin's page in a tab of its own, beside the first (the plugin's groups start closed: its page is not on screen to reveal).
  await page.getByRole('treeitem', { name: 'Things' }).click();
  await page.getByRole('treeitem', { name: 'Items' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Items[\s\S]*This page failed to display\./, `${engine}: the entry of the second plugin's sidebar opened the second plugin's page`);
  assert.equal(await page.getByRole('tab').count(), 2, `${engine}: the tabs of both plugins are open`);
  await current('Seam Fixture Copy').waitFor();

  // Activating a tab makes its plugin current again.
  await page.getByRole('tab').first().click();
  await page.getByRole('link', { name: 'orders-api' }).waitFor();
  await current('Seam Fixture').waitFor();
  assert.equal(await page.getByRole('tab').count(), 2, `${engine}: activating a tab closed none`);

  // Decision A17: closing the last tab leaves an empty window, and nothing opens a page by itself.
  await page.keyboard.press(chord);
  await page.keyboard.press(chord);
  await page.getByText('No tabs are open.').waitFor();
  assert.equal(await page.getByRole('tab').count(), 0, `${engine}: no tab is left`);
  await page.getByRole('heading', { level: 1, name: 'Home' }).waitFor();
  const home = page.getByRole('region', { name: 'Plugins you can open' });
  // The plugins that did not load are places to go too: their tab says what happened and offers Retry; the row says so in a word after the name.
  assert.deepEqual(await home.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim())), ['Seam Fixture', 'Seam Fixture Copy', 'Seam Fixture MissingDid not load', 'Seam Fixture OldDid not load'], `${engine}: the empty window lists the plugins to open: those that contribute in the order of the rail, then the others by name`);
  assert.equal(await entries.count(), 4, `${engine}: the rail stays beside the empty window`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(await page.getByRole('tab').count(), 0, `${engine}: nothing opened a page by itself`);
  // In a browser tab there is no window of the app's own to close: the close chord has no tab to close and does nothing.
  await page.keyboard.press(chord);
  await page.getByText('No tabs are open.').waitFor();

  // A way forward: a plugin of the list opens in a tab.
  await home.getByRole('button', { name: 'Seam Fixture', exact: true }).click();
  await page.getByRole('tab', { name: 'Items' }).waitFor();
  await page.getByRole('link', { name: 'orders-api' }).waitFor();

  // A plugin that did not load is found from the rail, not only from a page (a window with nothing saved opens empty): its entry carries what the host says in its tip, which a hover and a focus show, and
  // choosing it opens the plugin's page in a tab, naming what happened, while the rail's current entry and its sidebar stay.
  const missing = entries.and(page.getByRole('button', { name: 'Seam Fixture Missing, did not load' }));
  assert.match((await missing.getAttribute('data-ov-tip')) ?? '', /^Seam Fixture Missing, did not load\n.*could not be read/, `${engine}: the entry of a plugin with no bundle says why in its tip`);
  await missing.click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Seam Fixture Missing[\s\S]*could not be read/, `${engine}: choosing it opens the page that names the failure`);
  assert.equal(await page.getByRole('tab').count(), 2, `${engine}: in a tab of its own`);
  await current('Seam Fixture').waitFor();
  assert.deepEqual(errors, [], `${engine}: the rail and the empty window wrote no page error`);
}

/**
 * h. The bottom panel, in a page of its own: each plugin that contributes brings a tool (`fixture-a-ok`: "Streams", the copy: "Streams copy"), which the host draws as a tab of its strip over the plugin's
 * body, and sessions the plugin opens through the tool's `+`. What is checked is the seam: a tool and its body from a bundle built outside the host, a card the plugin describes, a route the host opens. The two tools
 * say the same place (`order` 40), so the strip tells them apart by the rail's order, which is `fixture-a-ok` first: the order is the rail's whichever of the two plugins finishes loading first (R2; h2 forces the other end).
 */
async function checkPanel(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  await openFirstPlugin(page);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  const toggle = page.getByRole('button', { name: 'Panel', exact: true });
  const region = page.locator('[data-shell-region="panel"]');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false', `${engine}: the panel starts closed`);
  assert.equal(await region.isVisible(), false, `${engine}: and draws nothing`);
  await toggle.click();
  await region.waitFor({ state: 'visible' });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true', `${engine}: the toggle is pressed once it is open`);
  // The host's own Logs tool comes first and is on screen (it says how a session arrives, and has no `+`); then one tool for each plugin that contributes, in the order of the rail and in the plugin's own words.
  const tools = page.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab');
  assert.deepEqual((await tools.allTextContents()).map((text) => text.trim()), ['Logs', 'Streams', 'Streams copy'], `${engine}: the strip draws the host's Logs tool, then the tool of each plugin that contributes, in the order of the rail (the first plugin's, then the copy's)`);
  assert.equal(await tools.first().getAttribute('aria-selected'), 'true', `${engine}: the Logs tool is on screen`);
  await page.getByText('No log sessions').waitFor();
  assert.equal(await page.locator('[data-shell-part="sessionAdd"]').count(), 0, `${engine}: the Logs tool has no \`+\` (decision A20)`);
  // The rail's first plugin brings the tool the rest of this scenario uses.
  await tools.nth(1).click();
  assert.equal(await tools.nth(1).getAttribute('aria-selected'), 'true', `${engine}: Streams is on screen once it is chosen`);
  await page.getByText('No sessions').waitFor();
  // The tool's `+` starts a stream; three in turn: running, ended and failed.
  const add = page.getByRole('button', { name: 'New stream' }).first();
  for (let opened = 0; opened < 3; opened += 1) await add.click();
  const sessions = page.getByRole('tablist', { name: 'Streams sessions' }).getByRole('tab');
  await page.waitForFunction(() => document.querySelectorAll('[data-shell-part="sessionTab"]').length === 3);
  assert.deepEqual(await sessions.evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label'))), ['stream-alpha', 'stream-beta, ended', 'stream-gamma, failed'], `${engine}: the three sessions, with the state of each in its name and no scope (none has a twin)`);
  assert.equal(await sessions.last().getAttribute('aria-selected'), 'true', `${engine}: the last one opened is on screen`);
  await page.locator('[data-fixture="stream"][data-visible="true"]').filter({ hasText: 'stream-gamma · failed' }).waitFor();
  // The plugin's body of the running stream counts lines while it is not on screen: a session body is kept while another is shown, and while the panel is hidden.
  const lines = () => page.evaluate(() => Number(document.querySelector('[data-fixture="stream"][data-session="stream-alpha"]')?.getAttribute('data-lines') ?? -1));
  const first = await lines();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok((await lines()) > first, `${engine}: the running stream kept counting while another was on screen (${first} lines)`);
  assert.equal(await page.locator('[data-fixture="stream"][data-session="stream-alpha"]').evaluate((element) => element.closest('[hidden]') !== null), true, `${engine}: and is not drawn`);
  // The card the plugin describes: its item as a link, the state in its words and the reason of a failure; its link opens the item's page in a tab, as every link of the window does.
  await sessions.last().hover();
  const card = page.locator('[popover]:popover-open');
  await card.waitFor();
  assert.match(await card.innerText(), /Stream[\s\S]*Item ghost-service[\s\S]*Source\s+south-yard[\s\S]*State\s+Failed[\s\S]*The source did not answer\. Check the source, then open the stream again\./, `${engine}: the card says what the plugin says`);
  await card.getByRole('link', { name: 'Item ghost-service' }).click();
  await page.getByRole('tab', { name: /ghost-service · Item/ }).waitFor();
  await page.getByRole('heading', { level: 1, name: 'ghost-service' }).waitFor();
  assert.equal(await region.isVisible(), true, `${engine}: opening an item leaves the panel as it was`);
  // Hiding the panel draws nothing and unmounts nothing: the running stream goes on.
  const hiddenAt = await lines();
  await toggle.click();
  await region.waitFor({ state: 'hidden' });
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok((await lines()) > hiddenAt, `${engine}: the running stream kept counting while the panel was hidden (${hiddenAt} lines)`);
  assert.deepEqual(errors, [], `${engine}: the panel wrote no page error`);
}

/**
 * h2. The bottom panel when the plugin the rail puts first finishes loading last (R2), in a page of its own. The bundle of `fixture-a-ok` (the rail's first place, "Streams") is held, so the copy (the rail's second place,
 * "Streams copy") is ready first and the window is up, with the panel open on the copy's tool and a stream open in it, while the first plugin is still loading; then the bundle is let through. The strip must be in the rail's
 * order, `Logs`, `Streams`, `Streams copy`, as it is in scenario h when the loads end the other way round: a plugin that loads late takes its place, it is not put after the other. Before R2 the strip read `Logs`, `Streams copy`,
 * `Streams` here, and in scenario h on the runs in which the copy happened to finish first (the CI failure of #635): the tie between two tools of one `order` was settled by the order the plugins arrived in.
 *
 * What the person is on does not move: the copy's tool is still the one on screen, its stream is still the session on screen and its body is the same element, not remounted and still counting. What does move is the copy's
 * tab, to the right by the width of the tab that arrived. The mock does the same (a tool is added at its sorted place the moment its plugin is live and nothing is held back: `shell-regions.js` `declaredTools` and `visibleTools`), and the
 * line the check prints says by how much.
 */
async function checkPanelLate(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const held = [];
  let released = false;
  await page.route(`**/_/plugins/${OK}/**`, (route) => {
    if (released) void route.continue();
    else held.push(route);
  });
  await open(page, base);
  const toggle = page.getByRole('button', { name: 'Panel', exact: true });
  await toggle.click();
  await page.locator('[data-shell-region="panel"]').waitFor({ state: 'visible' });
  const tools = page.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab');
  const names = async () => (await tools.allTextContents()).map((text) => text.trim());
  // The copy is ready and the first plugin is not: the strip has the host's tool and the copy's.
  await page.waitForFunction(() => [...document.querySelectorAll('[role=tablist][aria-label="Panel tools"] [role=tab]')].map((tab) => tab.textContent.trim()).join('|') === 'Logs|Streams copy', null, { timeout: 30_000 });
  assert.equal(held.length > 0, true, `${engine}: the first plugin's bundle was asked for and is held`);
  // The person is on the copy's tool, with a stream open in it.
  await tools.nth(1).click();
  await page.getByRole('button', { name: 'New stream' }).first().click();
  const stream = page.locator('[data-fixture="stream"][data-session="stream-alpha"]');
  await stream.waitFor();
  const body = await stream.elementHandle();
  const lines = () => stream.evaluate((element) => Number(element.getAttribute('data-lines')));
  const linesBefore = await lines();
  const copyBefore = (await tools.nth(1).boundingBox())?.x ?? NaN;
  assert.equal(await tools.nth(1).getAttribute('aria-selected'), 'true', `${engine}: the copy's tool is on screen before the first plugin arrives`);

  // The first plugin's bundle is let through: it finishes after the copy.
  released = true;
  for (const route of held.splice(0)) await route.continue();
  await page.waitForFunction(() => document.querySelectorAll('[role=tablist][aria-label="Panel tools"] [role=tab]').length === 3, null, { timeout: 30_000 });
  assert.deepEqual(await names(), ['Logs', 'Streams', 'Streams copy'], `${engine}: the first plugin took its place in the strip, in the order of the rail, though it finished after the copy`);
  assert.equal(await tools.nth(2).getAttribute('aria-selected'), 'true', `${engine}: the copy's tool is still the one on screen`);
  assert.equal(await tools.nth(1).getAttribute('aria-selected'), 'false', `${engine}: and the tool that arrived did not take the panel`);
  assert.equal(await page.getByRole('tab', { name: 'stream-alpha', selected: true }).count(), 1, `${engine}: the stream is still the session on screen`);
  assert.equal(await body.evaluate((element) => element.isConnected), true, `${engine}: and its body is the same element, not drawn again`);
  assert.ok((await lines()) >= linesBefore, `${engine}: and its count did not start again (${String(linesBefore)} lines, then ${String(await lines())})`);
  const moved = ((await tools.nth(2).boundingBox())?.x ?? NaN) - copyBefore;
  console.log(`${engine}: the copy's tab moved ${moved.toFixed(1)} px to the right when the first plugin's tab arrived ahead of it; the tool, the stream and the body on screen did not change`);
  // The window settles: with every plugin loaded and no tab open it is the empty window, which lists the plugins to open.
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  await page.unroute(`**/_/plugins/${OK}/**`);
  assert.deepEqual(errors, [], `${engine}: the panel wrote no page error while the first plugin loaded late`);
}

/**
 * j. The host's Logs tool (P1b-3a), in a page of its own: a command in the fixture item's menu opens a Logs session through `ctx.panel`, the plugin handing the host a feed (a synthetic one, bundled in the
 * plugin) and the host drawing it in the kit's log view. What is checked is the seam: lines appear and fill the panel's body, the card is the host's, switching tool and back keeps the lines and the scroll
 * place, and closing the tab releases every listener on the plugin's feed and closes it, which the plugin counts (`window.__fixtureLogs`).
 */
async function checkLogs(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  await openFirstPlugin(page);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  await page.getByRole('link', { name: 'orders-api' }).click();
  await page.getByRole('heading', { level: 1, name: 'orders-api' }).waitFor();
  await page.getByRole('button', { name: 'More actions for orders-api' }).click();
  await page.getByRole('menuitem', { name: 'Logs: app' }).click();
  // The panel opens on the Logs tool, on the new session; its lines appear in the host's log view, which fills the body the panel gives it (a flex item sizes to its content unless it is told to fill).
  await page.locator('[data-shell-region="panel"]').waitFor({ state: 'visible' });
  const grid = page.getByRole('group', { name: 'Log, orders-api/app · north-yard' }).getByRole('grid');
  await grid.waitFor();
  await page.waitForFunction(() => Number(document.querySelector('[data-log-session] [role=grid]')?.getAttribute('aria-rowcount') ?? 0) > 20, null, { timeout: 15_000 });
  const box = await page.evaluate(() => {
    const read = (element) => {
      const { x, width, height } = element.getBoundingClientRect();
      return [x, width, height].map((n) => Math.round(n));
    };
    return {
      body: read(document.querySelector('[data-shell-part="panelBody"]:not([hidden])')),
      column: read(document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-shell-part="logsTools"]')),
      view: read(document.querySelector('[data-log-session]')),
    };
  });
  // The body is the toolbar's column (the mock's 40 px: `.panel__tools`) and the log view beside it, which fills the rest (P1b-4a).
  const [bodyX, bodyWidth, bodyHeight] = box.body;
  const [columnX, columnWidth, columnHeight] = box.column;
  const [viewX, viewWidth, viewHeight] = box.view;
  assert.ok(Math.abs(columnX - bodyX) <= 1 && Math.abs(columnWidth - 40) <= 1 && Math.abs(columnHeight - bodyHeight) <= 1, `${engine}: the toolbar's column is the body's left 40 px (${JSON.stringify(box)})`);
  assert.ok(Math.abs(viewX - (bodyX + columnWidth)) <= 1 && Math.abs(viewWidth - (bodyWidth - columnWidth)) <= 1 && Math.abs(viewHeight - bodyHeight) <= 1, `${engine}: the log view fills the panel's body beside the column (${JSON.stringify(box)})`);
  assert.deepEqual(await page.evaluate(() => ({ ...Reflect.get(window, '__fixtureLogs') })), { opened: 1, closed: 0, listeners: 3 }, `${engine}: one feed opened; the registry and the view (two) listen to it`);
  // The card is the host's: the kind, the item as a link, the state in a log's words.
  const tab = page.getByRole('tab', { name: 'orders-api/app', exact: true });
  await tab.hover();
  const card = page.locator('[popover]:popover-open');
  await card.waitFor();
  assert.match(await card.innerText(), /Logs[\s\S]*Item orders-api[\s\S]*State\s+Streaming/, `${engine}: the card says what the host says of a log session`);
  await page.mouse.move(2, 2);
  // Scroll up (the view stops following), switch tool and back: the same lines, the same place.
  const place = () => grid.evaluate((element) => ({ top: Math.round(element.scrollTop), first: element.querySelector('[data-n]')?.getAttribute('data-n') ?? '', rows: Number(element.getAttribute('aria-rowcount')) }));
  await grid.evaluate((element) => {
    element.scrollTop = 0;
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const before = await place();
  await page.getByRole('tab', { name: 'Streams', exact: true }).click();
  await grid.waitFor({ state: 'hidden' });
  await new Promise((resolve) => setTimeout(resolve, 800));
  await page.getByRole('tab', { name: 'Logs', exact: true }).click();
  await grid.waitFor();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = await place();
  assert.deepEqual({ top: after.top, first: after.first }, { top: before.top, first: before.first }, `${engine}: switching tool and back keeps the scroll place (${JSON.stringify({ before, after })})`);
  assert.ok(after.rows >= before.rows, `${engine}: and the lines it had (${String(before.rows)} then ${String(after.rows)})`);
  // The toolbar's Pause (P1b-4a): the stream goes on and the view draws no more; the strip counts the lines that arrive (they are the stream's: the plugin's own count says so), and a press again draws them.
  const waitingOf = async () => Number((/Paused, ([\d,]+) new lines? waiting/.exec(await page.getByRole('group', { name: 'Session status' }).innerText())?.[1] ?? '-1').replace(/,/g, ''));
  const drawn = () => grid.evaluate((element) => Number(element.getAttribute('aria-rowcount')));
  const pause = page.getByRole('button', { name: 'Pause log updates' });
  assert.equal(await pause.getAttribute('aria-pressed'), 'false', `${engine}: Pause is not pressed while the stream runs`);
  await pause.click();
  await page.waitForFunction(() => /Paused, [\d,]+ new lines? waiting/.test(document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [aria-label="Session status"]')?.textContent ?? ''), null, { timeout: 15_000 });
  assert.equal(await pause.getAttribute('aria-pressed'), 'true', `${engine}: Pause says it is pressed`);
  const stopped = await drawn();
  const first = await waitingOf();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const later = await waitingOf();
  assert.ok(later >= first + 15, `${engine}: the lines kept arriving while paused and the strip counted them (${String(first)} waiting, then ${String(later)} 1.5 s later: the stream makes 20 a second)`);
  assert.equal(await drawn(), stopped, `${engine}: and the view drew none of them (${String(stopped)} rows, then ${String(await drawn())})`);
  assert.equal((await page.evaluate(() => ({ ...Reflect.get(window, '__fixtureLogs') }))).listeners, 3, `${engine}: the pause held the one feed the host already listens to (no listener more)`);
  // The source is stopped while the feed is still paused, so that no line arrives from here on: the lines the stream holds are then exactly the lines that wait, and Pause let go must draw every one of them (a view that threw
  // some away could not make up the difference from new arrivals, as there are none). The plugin's feed stays open.
  await page.evaluate(() => Reflect.get(window, '__fixtureLogs').stopSources());
  await new Promise((resolve) => setTimeout(resolve, 400));
  const waiting = await waitingOf();
  assert.ok(waiting >= 25, `${engine}: enough lines wait for the check to mean something (${String(waiting)})`);
  await pause.click();
  await page.waitForFunction((rows) => Number(document.querySelector('[data-log-session] [role=grid]')?.getAttribute('aria-rowcount') ?? 0) >= rows, stopped + waiting, { timeout: 5_000 });
  assert.equal(await pause.getAttribute('aria-pressed'), 'false', `${engine}: pressed again, Pause is not pressed`);
  // Closing the tab closes the plugin's feed and every listener on it is gone.
  await tab.focus();
  await page.keyboard.press('Delete');
  await page.getByText('No log sessions').waitFor();
  await page.waitForFunction(() => Reflect.get(window, '__fixtureLogs')?.listeners === 0);
  assert.deepEqual(await page.evaluate(() => ({ ...Reflect.get(window, '__fixtureLogs') })), { opened: 1, closed: 1, listeners: 0 }, `${engine}: closing the tab closed the feed and released every listener`);
  assert.deepEqual(errors, [], `${engine}: the Logs tool wrote no page error`);
}

/**
 * j. The command palette (C1b), on the real host with the fixture plugins loaded: the host's own sources (the pages the plugins' sidebars open, the open tabs, the host's commands) and the view over them, in a
 * page of its own. Nothing of it is a plugin's: the palette offers a plugin's pages because the host reads them from the contribution it admitted. What it lists and says is what is real: the host's commands
 * and no others, the four open keys the tab model has and no key for a window this host cannot open. The two plugins declare one name here, so a page of each reads alike and stays so (a name that says the same tells
 * nothing); `checkTwins` is the scenario where they declare two, and the rows are told apart.
 */
async function checkPalette(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  await openFirstPlugin(page);
  const items = page.getByRole('tab', { name: 'Items' });
  await items.waitFor({ timeout: 30_000 });
  const mac = await page.evaluate(() => navigator.platform.includes('Mac'));
  const mod = mac ? 'Meta' : 'Control';
  const dialog = page.getByRole('dialog', { name: 'Search' });
  const field = dialog.getByRole('combobox');
  const foot = dialog.locator('[data-palette-part="foot"]');
  const hasFocus = (locator) => locator.evaluate((element) => element === document.activeElement);
  const shot = async (state) => {
    if (process.env.SHOTS === undefined) return;
    await mkdir(process.env.SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SHOTS, `host-${engine}-${state}.png`) });
  };
  /** Opens the palette from the chord and types a query. */
  const ask = async (query) => {
    await page.keyboard.press(`${mod}+KeyK`);
    await dialog.waitFor();
    await page.keyboard.type(query, { delay: 20 });
  };

  // From a control of the page: the chord opens it, the focus is in the input, and Escape gives the focus back where it was.
  await items.focus();
  await page.keyboard.press(`${mod}+KeyK`);
  await dialog.waitFor();
  assert.ok(await hasFocus(field), `${engine}: the focus is in the palette's input when it opens`);
  await shot('empty');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab');
  assert.ok(await hasFocus(items), `${engine}: Escape gave the focus back to the control that had it`);

  // A plugin's page is found by its name, from the sidebar the plugin published. The two plugins are built from one source, so each has a Crash page in a group called Things and the same name inside its bundle: two
  // rows that read alike, and a name that says the same cannot tell them apart, so each reads as a page does (the group it sits in; with no connection there is nothing before it). The first plugin's (the rail's
  // first) is the first row, which is the active one.
  await ask('crash');
  const crash = dialog.getByRole('option', { name: /^Page: Crash/ }).first();
  await crash.waitFor();
  assert.equal(await crash.getAttribute('aria-label'), 'Page: Crash, Things', `${engine}: a page row says the group it sits in`);
  assert.equal(await dialog.locator('[data-palette-row*="fixture-b-dup:crash"]').getAttribute('aria-label'), 'Page: Crash, Things', `${engine}: and so does the page of the plugin that declares the same name: the name would tell nothing`);
  assert.equal(await crash.getAttribute('aria-selected'), 'true', `${engine}: the page that matched is the active row`);
  await shot('page');

  // The footer says the four open keys the tab model has, and none for a window. This host cannot open one: Shift Enter is refused with the reason, the palette stays open and nothing opens.
  const keys = await foot.innerText();
  for (const label of ['Open', 'Here', 'New tab', 'Background tab']) assert.ok(keys.includes(label), `${engine}: the footer says ${label} (${keys})`);
  assert.ok(!keys.includes('New window'), `${engine}: and does not say New window (${keys})`);
  await page.keyboard.press('Shift+Enter');
  await foot.getByText('This window cannot open another one yet.').waitFor();
  assert.ok(await dialog.isVisible(), `${engine}: the palette stayed open`);
  assert.equal(await page.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab').count(), 1, `${engine}: and opened nothing (the palette's own kinds are tabs too, so the strip is counted)`);

  // Enter opens the page in the tab on screen (the same plugin: smart open), and the palette gives the focus back.
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('tab', { name: 'Crash' }).waitFor();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('tab').count(), 1, `${engine}: a page of the same plugin opened in the tab on screen`);
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab');

  // Command (Control elsewhere) Enter opens a place in a background tab: the tab on screen stays. The first plugin's home is a place of the plugin the tab on screen is of, so a plain Enter would navigate that tab.
  await ask('items');
  const home = dialog.getByRole('option', { name: /^Plugin home: Seam Fixture/ }).first();
  await home.waitFor();
  assert.equal(await home.getAttribute('aria-selected'), 'true', `${engine}: the home that matched is the active row`);
  await page.keyboard.press(`${mod}+Enter`);
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('tab').count(), 2, `${engine}: a background tab opened`);
  assert.equal(await page.getByRole('tab', { name: 'Crash' }).getAttribute('aria-selected'), 'true', `${engine}: and the tab on screen stayed`);

  // Option Enter opens HERE: the tab on screen goes to the place whatever plugin it is of, where a plain Enter on another plugin's page would open a tab of its own. The tab on screen is called Crash too and
  // leads the list, so the second plugin's Crash page is the row the pointer is moved onto.
  await ask('crash');
  const copyCrash = dialog.locator('[data-palette-row*="fixture-b-dup:crash"]');
  await copyCrash.waitFor();
  await copyCrash.hover();
  assert.equal(await copyCrash.getAttribute('aria-selected'), 'true', `${engine}: the pointer moved the active row onto the second plugin's page`);
  await page.keyboard.press('Alt+Enter');
  await dialog.waitFor({ state: 'detached' });
  await page.locator('[data-shell-part="rail"] [aria-label="Seam Fixture Copy"][aria-current="true"]').waitFor();
  assert.equal(await page.getByRole('tab').count(), 2, `${engine}: here opened no tab: the tab on screen went to the other plugin's page`);

  // Command Shift Enter opens a NEW tab and shows it, even for a place that has a tab.
  await ask('items');
  await dialog.getByRole('option', { name: /^Plugin home: Seam Fixture/ }).first().waitFor();
  await page.keyboard.press(`${mod}+Shift+Enter`);
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('tab').count(), 3, `${engine}: a new tab opened`);
  await page.getByRole('tab', { name: 'Items', selected: true }).waitFor();

  // The plugins that did not load are places to go: their homes say Degraded.
  await ask('seam fixture m');
  const missing = dialog.getByRole('option', { name: /^Plugin home: Seam Fixture Missing/ });
  await missing.waitFor();
  assert.equal(await missing.getAttribute('data-state'), 'degraded', `${engine}: the home of a plugin that did not load opens its page that says so, and the row says Degraded`);
  assert.match(await missing.innerText(), /Degraded/, `${engine}: in a word`);

  // The host's own commands, all of them and no others: what it can run now, with the chord each is bound to (a browser tab has no window of its own, so there is no Close window, and it keeps Command and Control W and J for itself, so the chords said are the shell's Control Option ones; Next and Previous have no chord).
  await field.fill('');
  await page.keyboard.type('>', { delay: 20 });
  await dialog.getByRole('option', { name: /^Command: Close tab/ }).waitFor();
  assert.deepEqual(
    await dialog.getByRole('option').evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label'))),
    [`Command: Close tab, Tabs, ${mac ? '⌃⌥W' : 'Ctrl+Alt+W'}`, `Command: Toggle panel, Panel, ${mac ? '⌃⌥J' : 'Ctrl+Alt+J'}`, `Command: Settings, Window, ${mac ? '⌃⌥,' : 'Ctrl+Alt+,'}`, 'Command: Next tab, Tabs', 'Command: Previous tab, Tabs', 'Command: Plugins, Window'],
    `${engine}: the commands are the host's, and only those`,
  );
  await shot('commands');
  await dialog.getByRole('tab', { name: 'All' }).click();
  await field.fill('close');
  await dialog.getByRole('option', { name: /^Command: Close tab/ }).waitFor();
  await shot('close');

  // A kind with no provider behind it (Settings is the mock's, and nothing here provides it yet) says so, in the mock's words, and offers the plugin homes as somewhere to go from.
  await field.fill('');
  await dialog.getByRole('tab', { name: 'Settings' }).click();
  await dialog.locator('[data-palette-part="note"]').getByText('Nothing to show yet').waitFor();
  await shot('settings');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  // The keywords of a plugin's sidebar entry (C1e) are other names for its page: the fixture gives Crash `boom` and `bang` and Items `stuff` and `inventory` (plugins/fixture/src/entry.tsx), none of them a letter of its label, so
  // a page found by one is found by the keyword and by nothing else. Typed whole, a keyword ranks the page as its label does: it is the first row, the active one, and nothing of the keyword is on it; a plain Enter opens it in
  // the tab on screen (the same plugin, so smart open navigates that tab: the strip holds the three tabs it held). The leaf that opens the plugin's home gives its keywords to the home's row, which is the one row for that page.
  await ask('stuff');
  const itemsHome = dialog.getByRole('option').first();
  await itemsHome.waitFor();
  assert.equal(await itemsHome.getAttribute('aria-label'), 'Plugin home: Seam Fixture, Items', `${engine}: a keyword of the leaf that opens the plugin's home finds the home`);
  assert.equal(await itemsHome.getAttribute('aria-selected'), 'true', `${engine}: and it is the active row`);
  await field.fill('');
  await page.keyboard.type('boom', { delay: 20 });
  const named = dialog.getByRole('option', { name: /^Page: Crash/ }).first();
  await named.waitFor();
  assert.equal(await dialog.getByRole('option').first().getAttribute('data-palette-row'), await named.getAttribute('data-palette-row'), `${engine}: the page a keyword names is the first row`);
  assert.match((await named.getAttribute('data-palette-row')) ?? '', /fixture-a-ok:crash$/, `${engine}: of the first plugin (the rail's first), whose page and whose copy hold the same keyword`);
  assert.equal(await named.getAttribute('aria-label'), 'Page: Crash, Things', `${engine}: the row says what it said for the label`);
  assert.equal(await named.getAttribute('aria-selected'), 'true', `${engine}: it is the active row`);
  assert.ok(!(await named.innerText()).includes('boom'), `${engine}: and nothing of the keyword is drawn on it`);
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('tab', { name: 'Crash', selected: true }).waitFor();
  await page.locator('[data-shell-part="rail"] [aria-label="Seam Fixture"][aria-current="true"]').waitFor();
  assert.equal(await page.getByRole('tab').count(), 3, `${engine}: a plain Enter on the page a keyword names opened it in the tab on screen`);

  // The Search control of the top row opens it with a click, and Escape gives the focus back to the control.
  const search = page.getByRole('button', { name: /^Search / });
  await search.click();
  await dialog.waitFor();
  assert.ok(await hasFocus(field), `${engine}: the Search control opens the palette with the focus in its input`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-shell-part') === 'search');
  assert.ok(await hasFocus(search), `${engine}: Escape gave the focus back to the Search control`);
  assert.deepEqual(errors.filter((message) => !/access control checks|Load failed|Failed to fetch|NetworkError/i.test(message)), [], `${engine}: the palette wrote no page error`);
}

/**
 * j2. Two pages that would read alike, of two plugins of two names, are told apart by the plugin's name, first, on those two rows only (C1e, the lead's ruling: the rule the scope of a session tab follows for twins), in the
 * text the row draws and so in its accessible name. The two plugins are built from one source and declare one name (the checks that order rows by their ids need rows that read alike), so this scenario asks the page, before
 * the bundles load, for the names their rail entries say (`window.__fixtureOwnNames`, read by the bundle as it loads): two plugins have two names.
 */
async function checkTwins(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Reflect.set(window, '__fixtureOwnNames', true);
  });
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  await openFirstPlugin(page);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  const mac = await page.evaluate(() => navigator.platform.includes('Mac'));
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await page.keyboard.press(`${mac ? 'Meta' : 'Control'}+KeyK`);
  await dialog.waitFor();
  await page.keyboard.type('crash', { delay: 20 });
  const first = dialog.locator('[data-palette-row*="fixture-a-ok:crash"]');
  const second = dialog.locator('[data-palette-row*="fixture-b-dup:crash"]');
  await first.waitFor();
  await second.waitFor();
  assert.equal(await first.getAttribute('aria-label'), 'Page: Crash, Seam Fixture · Things', `${engine}: a page that reads like another plugin's page says its plugin's name first, in its accessible name`);
  assert.equal(await second.getAttribute('aria-label'), 'Page: Crash, Seam Fixture Copy · Things', `${engine}: and so does the other plugin's page, with its own plugin's name`);
  assert.match(await first.innerText(), /Seam Fixture · Things/, `${engine}: the text the row draws says it too`);
  assert.match(await second.innerText(), /Seam Fixture Copy · Things/, `${engine}: and the other's`);
  assert.equal(await dialog.getByRole('option', { name: /^Page: Crash/ }).count(), 2, `${engine}: two rows, one for each plugin's page`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(errors.filter((message) => !/access control checks|Load failed|Failed to fetch|NetworkError/i.test(message)), [], `${engine}: the twins wrote no page error`);
}

/**
 * j3. The connection a row says (C1f), on the real host. The window is opened by an address that names a connection by its KEY (`#/fixture-a-ok/items?connection=north-57a082bd74`: the way a link does, in the shape the host's own keys
 * have), and the fixture's page says its NAME in its scope lane (`north`, laneOf in the fixture). The palette says the name, in its chips and, once they are removed, in the rows of Go to and their accessible names, and the key is in
 * nothing it draws: no text and no accessible name. The shell says it the same way (C1g): the tab on screen says it in its accessible name and its tooltip, and on a detail page opened by an address that names the item and the
 * connection (the path of a detail page is the host's, made from the route; a list page's is the plugin's own words) the status bar's path and the header's breadcrumb say `north` too. The key is in no text, no accessible name, no
 * tooltip and no title the window draws (the address carries it; the page does not show it). SHOTS=<dir> writes WebKit's `connection-names-webkit-void-1440x900.png` of that detail page.
 */
async function checkConnection(page, base, engine) {
  const key = 'north-57a082bd74';
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, base, `#/${OK}/items?connection=${key}`);
  await page.getByRole('tab', { name: /^Items/ }).waitFor({ timeout: 30_000 });
  // The lane is the page's: the palette is opened once it says the name.
  await page.locator('[data-shell-part="lane"]').getByText('north', { exact: true }).waitFor({ timeout: 30_000 });
  const mac = await page.evaluate(() => navigator.platform.includes('Mac'));
  const dialog = page.getByRole('dialog', { name: 'Search' });
  /** Everything the dialog draws and every accessible name in it. */
  const drawn = () => dialog.evaluate((element) => [element.innerText, ...[...element.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label') ?? '')].join('\n'));
  await page.keyboard.press(`${mac ? 'Meta' : 'Control'}+KeyK`);
  await dialog.waitFor();
  const chips = dialog.locator('[data-palette-part="chips"]');
  await chips.waitFor();
  assert.match(await chips.innerText(), /north/, `${engine}: the chip that narrows the palette to the connection says its name`);
  assert.ok(!(await drawn()).includes(key), `${engine}: the key of the connection is in nothing the palette draws with its chips: no text and no accessible name`);
  // Without the chips the rows say the connection: by its name, and the key nowhere.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('crash', { delay: 20 });
  const crash = dialog.locator(`[data-palette-row*="${OK}:crash"]`);
  await crash.waitFor();
  assert.equal(await crash.getAttribute('aria-label'), 'Page: Crash, north · Things', `${engine}: a page row says the connection by its name`);
  assert.ok(!(await drawn()).includes(key), `${engine}: and the key of the connection is in no row text and no accessible name`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  // The shell's own surfaces (C1g), read as a person and a screen reader read them: the text of the window and every attribute that names or describes an element (a tab's accessible name, its tooltip, a title).
  const shellOf = () =>
    page.evaluate(() => {
      const named = ['aria-label', 'title', 'alt', 'placeholder', 'data-ov-tip'];
      const attributes = [...document.querySelectorAll('*')].flatMap((node) => named.flatMap((name) => (node.hasAttribute(name) ? [`${name}: ${node.getAttribute(name)}`] : [])));
      const tab = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
      return {
        drawn: [document.body.innerText, ...attributes],
        tab: { name: tab?.getAttribute('aria-label') ?? null, tip: tab?.getAttribute('data-ov-tip') ?? null },
        status: [...document.querySelectorAll('nav[aria-label="Current resource"] li')].map((item) => item.textContent ?? ''),
        header: document.querySelector('header nav[aria-label="Breadcrumb"]')?.textContent ?? null,
      };
    });
  const says = (text) => typeof text === 'string' && /\bnorth\b/.test(text);
  // A list page's path is the plugin's own words (the fixture's says `Seam Fixture › Items`), and a detail page's is the host's, made from the route: it says the connection by its name, so only a detail page is held to say it.
  const sound = (shell, what, pathSaysIt) => {
    assert.ok(says(shell.tab.name), `${engine}: ${what}: the tab on screen says the connection by its name in its accessible name: ${JSON.stringify(shell.tab)}`);
    assert.ok(says(shell.tab.tip), `${engine}: ${what}: the tab on screen says the connection by its name in its tooltip: ${JSON.stringify(shell.tab)}`);
    assert.ok(!pathSaysIt || shell.status.some(says), `${engine}: ${what}: the status bar's path says the connection by its name: ${JSON.stringify(shell.status)}`);
    assert.deepEqual(shell.drawn.filter((text) => text.includes(key)), [], `${engine}: ${what}: the key of the connection is in no text, accessible name, tooltip or title the window draws`);
  };
  sound(await shellOf(), 'the list page', false);

  // A detail page of an item of the connection, opened by the address a link makes: its header, the strip and the status bar say the name; the page is loaded afresh (a hash alone does not open a link).
  await page.goto('about:blank');
  await open(page, base, `#/${OK}/item?name=alpha&group=east&connection=${key}`);
  await page.locator('header nav[aria-label="Breadcrumb"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-shell-part="lane"]').getByText('north', { exact: true }).waitFor({ timeout: 30_000 });
  const detail = await shellOf();
  sound(detail, 'the detail page', true);
  // The breadcrumb's text is its crumbs one after the other, with no separator between them (`Seam FixturenorthItemsalpha`): the name is in it, and the key (above) is in no text of the window.
  assert.ok(typeof detail.header === 'string' && detail.header.includes('north'), `${engine}: the header of the detail page says the connection by its name: ${JSON.stringify(detail.header)}`);
  if (process.env.SHOTS !== undefined && engine === 'webkit') {
    await mkdir(process.env.SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SHOTS, 'connection-names-webkit-void-1440x900.png') });
  }
  assert.deepEqual(errors.filter((message) => !/access control checks|Load failed|Failed to fetch|NetworkError/i.test(message)), [], `${engine}: the connection scenario wrote no page error`);
}

/** The plugin's `retry` on the window's plugin store, which is where the window keeps it (the hooks of `PluginHostScreen`, reached from any element React drew): what a reload of a plugin's interface is. The store's entry goes to `loading` at once. */
async function reloadPlugin(page, id) {
  const found = await page.evaluate((plugin) => {
    const start = document.querySelector('[data-shell-part="window"]');
    const key = start === null ? undefined : Object.keys(start).find((name) => name.startsWith('__reactFiber$'));
    for (let fiber = key === undefined ? null : start[key]; fiber; fiber = fiber.return) {
      for (let hook = fiber.memoizedState; hook !== null && typeof hook === 'object' && 'next' in hook; hook = hook.next) {
        const value = hook.memoizedState;
        if (value !== null && typeof value === 'object' && typeof value.retry === 'function' && typeof value.getSnapshot === 'function') {
          const entry = value.getSnapshot().find((candidate) => candidate.id === plugin);
          void value.retry({ id: plugin, name: entry.name });
          return true;
        }
      }
    }
    return false;
  }, id);
  assert.equal(found, true, "the window's plugin store was found in its component's hooks");
}

/**
 * l. The plugins' providers in the command palette (C1c), on the real host. Both fixture plugins that load (`fixture-a-ok` and its copy, built from one source and named alike inside their bundles) declare providers in
 * their `contributionV1`; the check makes the page's control (`window.__fixturePalette`) and the palette asks them. The two plugins' sections read alike ("Seam Fixture · Items"), so each is told by the id its rows are
 * named with (`fixture-a-ok:quick|...`): the model names a row `<section>|<provider>|<id>` and a section `<plugin id>:<its own>`.
 */
async function checkProviders(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  await openFirstPlugin(page);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  const mac = await page.evaluate(() => navigator.platform.includes('Mac'));
  const mod = mac ? 'Meta' : 'Control';
  const dialog = page.getByRole('dialog', { name: 'Search' });
  const rows = (plugin, provider = '') => dialog.locator(`[data-palette-row^="${plugin}:${provider}"]`);
  const headings = () => dialog.locator('[data-palette-part="label"]').allTextContents();
  const strip = () => page.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
  const shot = async (state) => {
    if (process.env.SHOTS === undefined) return;
    await mkdir(process.env.SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SHOTS, `host-${engine}-${state}.png`) });
  };
  const ask = async (query) => {
    await page.keyboard.press(`${mod}+KeyK`);
    await dialog.waitFor();
    await page.keyboard.type(query, { delay: 20 });
  };
  const close = async () => {
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  };
  const stats = () => page.evaluate(() => JSON.parse(JSON.stringify(Reflect.get(window, '__fixturePalette').stats)));

  // The fixture's providers are quiet until the check makes the control: the plugins are loaded, their providers registered, and the palette asks none of them, so nothing of theirs is listed.
  await ask('orders');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(await dialog.locator('[data-palette-row^="fixture-"]').count(), 0, `${engine}: the fixture plugins' providers are quiet until a check asks for them`);
  await close();
  // The slow provider takes 800 ms here and not the probe's 300: a page call of the check takes tens of milliseconds on a loaded machine, and the order the rows arrive in must not depend on it.
  await page.evaluate(() => {
    Reflect.set(window, '__fixturePalette', { stats: {}, commands: [], quick: { delay: 0, size: 5 }, slow: { delay: 800, size: 5 }, big: { delay: 0, size: 0 } });
  });

  // A typed item name finds the rows of both plugins: each plugin's section is headed by its name, and the fast provider's rows are on screen before the slow provider's.
  await ask('orders');
  await rows('fixture-a-ok', 'quick|').first().waitFor();
  assert.equal(await rows('fixture-a-ok', 'slow|').count(), 0, `${engine}: the fast provider's rows are on screen while the slow provider has not answered`);
  assert.deepEqual((await headings()).slice(0, 2), ['Seam Fixture · Items', 'Seam Fixture · Items'], `${engine}: each plugin's section is headed by the plugin's name`);
  assert.equal(await rows('fixture-b-dup', 'quick|').count(), 1, `${engine}: the other plugin's rows are there too`);
  await rows('fixture-a-ok', 'slow|').first().waitFor();
  await rows('fixture-b-dup', 'slow|').first().waitFor();
  // The model orders a plugin's sections by the order its providers registered in, and the plugins by id: the first plugin's two, then the second's.
  assert.deepEqual(await headings(), ['Seam Fixture · Items', 'Seam Fixture · Slow items', 'Seam Fixture · Items', 'Seam Fixture · Slow items'], `${engine}: the four sections, a plugin's together, the first plugin's before the second's`);
  const first = dialog.getByRole('option').first();
  assert.equal(await first.getAttribute('aria-label'), 'Resource: orders-api, Item · north-yard', `${engine}: a row says what it is, its words, and where it is`);
  assert.equal(await first.getAttribute('aria-selected'), 'true', `${engine}: the first plugin's row is the active one`);
  // The two plugins' rows read alike, so the order is told by the ids of the rows. The sections of plugins that match equally keep the rail's order, whichever plugin loaded first, so one input does one thing on every run.
  const leading = (await dialog.getByRole('option').evaluateAll((options) => options.map((option) => option.getAttribute('data-palette-row')?.split('|')[0]))).filter((provider, index, all) => provider !== all[index - 1]);
  assert.deepEqual(leading, ['fixture-a-ok:quick', 'fixture-a-ok:slow', 'fixture-b-dup:quick', 'fixture-b-dup:slow'], `${engine}: the first plugin's sections lead, the second's follow (the rail's order, not the order the plugins loaded in)`);
  await shot('providers');

  // Enter opens the plugin's page in the tab on screen (the same plugin: smart open).
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('heading', { level: 1, name: 'orders-api' }).waitFor({ timeout: 15_000 });
  assert.equal(await strip().count(), 1, `${engine}: the plugin's page opened in the tab on screen`);

  // Command Enter opens a background tab, and the tab on screen stays; Option Enter opens here: the tab on screen goes to the other plugin's page; Command Shift Enter opens a new tab and shows it.
  await ask('ledger');
  await rows('fixture-a-ok', 'quick|').first().waitFor();
  await page.keyboard.press(`${mod}+Enter`);
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await strip().count(), 2, `${engine}: a background tab opened`);
  assert.equal(await strip().first().getAttribute('aria-selected'), 'true', `${engine}: and the tab on screen stayed`);
  await ask('vault');
  const copy = rows('fixture-b-dup', 'quick|').first();
  await copy.waitFor();
  await copy.hover();
  assert.equal(await copy.getAttribute('aria-selected'), 'true', `${engine}: the pointer moved the active row onto the other plugin's row`);
  await page.keyboard.press('Alt+Enter');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('heading', { level: 1, name: 'vault-keeper' }).waitFor({ timeout: 15_000 });
  assert.equal(await strip().count(), 2, `${engine}: here opened no tab: the tab on screen went to the other plugin's page`);
  await ask('ghost');
  await rows('fixture-a-ok', 'quick|').first().waitFor();
  await page.keyboard.press(`${mod}+Shift+Enter`);
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await strip().count(), 3, `${engine}: a new tab opened`);
  await page.getByRole('heading', { level: 1, name: 'ghost-service' }).waitFor({ timeout: 15_000 });

  // A plugin's command, from its match provider: it runs with the argument its row carried and the panel handle the host gave the plugin, and the palette closes.
  await ask('reset fixture');
  const reset = dialog.getByRole('option', { name: 'Command: Reset fixture counters, Command' }).first();
  await reset.waitFor();
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, '__fixturePalette').commands), [{ arg: { owner: 'Seam Fixture' }, plugin: 'fixture-a-ok', panel: true }], `${engine}: the command ran with its argument and the plugin's panel handle`);

  // A provider that rejects: said in the band with a Retry, and nothing of the plugin's own words is on screen; the others answer.
  await page.evaluate(() => Object.assign(Reflect.get(window, '__fixturePalette').quick, { fail: 'reject' }));
  await ask('orders');
  const band = dialog.locator('[data-palette-part="band"]');
  await band.getByText('Items: Unavailable').first().waitFor();
  assert.ok((await band.getByRole('button').allTextContents()).concat(await band.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''))).some((text) => /^Retry/.test(text.trim())), `${engine}: the band offers a Retry`);
  assert.ok(!(await dialog.innerText()).includes('rejected on purpose'), `${engine}: the plugin's own words are not on screen`);
  await rows('fixture-a-ok', 'slow|').first().waitFor();
  await shot('providers-error');
  await close();
  await page.evaluate(() => Object.assign(Reflect.get(window, '__fixturePalette').quick, { fail: '' }));

  // A plugin that is unloaded while the palette is open and its slow request is in flight. The slow providers take four seconds, so the request is still going when the plugin leaves.
  await page.evaluate(() => Object.assign(Reflect.get(window, '__fixturePalette').slow, { delay: 4000 }));
  await ask('orders');
  await rows('fixture-a-ok', 'quick|').first().waitFor();
  await rows('fixture-b-dup', 'quick|').first().waitFor();
  await page.waitForFunction(() => Reflect.get(window, '__fixturePalette').stats['Seam Fixture/slow']?.active === 1 && Reflect.get(window, '__fixturePalette').stats['Seam Fixture Copy/slow']?.active === 1, null, { timeout: 15_000 });
  // The earlier steps told slow requests to stop too (each closed the palette on a request still going), so what the plugin's leaving does is read as the change from here.
  const beforeLeaving = await stats();
  const held = [];
  let released = false;
  await page.route(`**/_/plugins/${OK}/**`, (route) => {
    if (released) void route.continue();
    else held.push(route);
  });
  await reloadPlugin(page, OK);
  await page.waitForFunction(() => document.querySelector('[data-palette-row^="fixture-a-ok:"]') === null, null, { timeout: 15_000 });
  assert.ok(await rows('fixture-b-dup', 'quick|').count() > 0, `${engine}: the other plugin's section stays when a plugin leaves`);
  assert.ok(await dialog.isVisible(), `${engine}: the palette stayed open, with its query`);
  assert.equal(await dialog.getByRole('combobox').inputValue(), 'orders', `${engine}: and its query`);
  await page.waitForFunction((count) => Reflect.get(window, '__fixturePalette').stats['Seam Fixture/slow']?.aborted === count + 1, beforeLeaving['Seam Fixture/slow'].aborted, { timeout: 15_000 });
  const leaving = await stats();
  assert.deepEqual(
    [leaving['Seam Fixture/slow'].active, leaving['Seam Fixture Copy/slow'].active, leaving['Seam Fixture Copy/slow'].aborted - beforeLeaving['Seam Fixture Copy/slow'].aborted],
    [0, 1, 0],
    `${engine}: the leaving plugin's slow request was told to stop and the other plugin's was not`,
  );
  // Its bundle is let through: the plugin is back, and its section comes back with no key pressed.
  released = true;
  for (const route of held.splice(0)) await route.continue();
  await rows('fixture-a-ok', 'quick|').first().waitFor({ timeout: 30_000 });
  await page.unroute(`**/_/plugins/${OK}/**`);

  // A plugin that does not load loses its section the same way, and gets it back with its bundle.
  await page.route(`**/_/plugins/${OK}/**`, (route) => route.abort());
  await reloadPlugin(page, OK);
  await page.waitForFunction(() => document.querySelector('[data-palette-row^="fixture-a-ok:"]') === null, null, { timeout: 30_000 });
  assert.ok(await rows('fixture-b-dup', 'quick|').count() > 0, `${engine}: the other plugin's section stays when a plugin fails`);
  await page.unroute(`**/_/plugins/${OK}/**`);
  await reloadPlugin(page, OK);
  await rows('fixture-a-ok', 'quick|').first().waitFor({ timeout: 30_000 });
  await close();

  // A reload, a plugin whose bundle was cut and a page that went away report errors of the kind a cut request makes: they are the check's own doing, and nothing else is excused.
  const cut = /access control checks|Load failed|Failed to fetch|NetworkError|network connection was lost/i;
  assert.deepEqual(errors.filter((message) => !cut.test(message)), [], `${engine}: the providers wrote no page error`);
}

/**
 * k. A plugin's unload and the Logs sessions (P1b-3c, A21), in a page of its own. Two Logs sessions of the fixture plugin follow an item: `sync`, which fails on its own, and `app`, which streams. The plugin's
 * interface is unloaded (the window's plugin store takes it out of the live set, and the request for its bundle is held, so the window with the plugin off lasts as long as the check looks at it); both tabs STAY,
 * each in the same view with the lines it had read, the streams closed once and the plugin's counters saying so: `app` ENDED, `sync` is AS IT WAS (failed, with its own words and time); the card of each says the
 * plugin was unloaded, its resource is no link and its Open button is unavailable. The bundle is let through: the plugin is back and nothing resumed, the card's link and button work; a new press of Logs opens a
 * NEW session beside them, told by its ordinal; closing the tabs frees every listener and closes each stream once. Nothing in the product unloads a ready plugin yet (`PluginStore` only adds, `retry` is offered for a plugin
 * that failed), so the check takes the store from where the window keeps it (the hooks of `PluginHostScreen`, reached from any element React drew) and does what a reload of a plugin's interface is: `retry`.
 * SEAM_SHOTS=<dir> writes the pictures of WebKit. SEAM_CONTROL=<name> makes one perturbation that one assertion must see (see CONTROLS).
 */
async function checkKept(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const shot = async (name) => {
    if (process.env.SEAM_SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(process.env.SEAM_SHOTS, `kept-${name}-${engine}.png`) });
  };
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  await openFirstPlugin(page);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  await page.getByRole('link', { name: 'orders-api' }).click();
  await page.getByRole('heading', { level: 1, name: 'orders-api' }).waitFor();
  const press = async (command) => {
    await page.getByRole('button', { name: 'More actions for orders-api' }).click();
    await page.getByRole('menuitem', { name: command }).click();
  };
  const counters = () => page.evaluate(() => ({ ...Reflect.get(window, '__fixtureLogs') }));
  const kept = page.getByRole('tab', { name: 'orders-api/app, ended' });
  const failed = page.getByRole('tab', { name: 'orders-api/sync, failed' });
  const card = page.locator('[popover]:popover-open');
  /** What the card of a tab says, in one line, and the mouse away again. */
  const cardOf = async (tab) => {
    await tab.hover();
    await card.waitFor();
    const text = (await card.innerText()).replace(/\s+/g, ' ').trim();
    await page.mouse.move(2, 2);
    await card.waitFor({ state: 'hidden' });
    return text;
  };
  // A session that fails on its own (the fixture's `sync` fails 1.5 s after it opens), before the plugin leaves.
  await press('Logs: sync (fails)');
  await failed.waitFor({ timeout: 15_000 });
  const failedBefore = await cardOf(failed);
  assert.match(failedBefore, /State Failed · since .+ The log stream stopped\. The source did not answer\. Open Item$/, `${engine}: the failed session's card says what happened to it`);
  await press('Logs: app');
  const log = page.getByRole('group', { name: 'Log, orders-api/app · north-yard' });
  const grid = log.getByRole('grid');
  const failedGrid = page.locator('[role=group][aria-label="Log, orders-api/sync · north-yard"] [role=grid]');
  await grid.waitFor();
  await page.waitForFunction(() => Number(document.querySelector('[role=group][aria-label="Log, orders-api/app · north-yard"] [role=grid]')?.getAttribute('aria-rowcount') ?? 0) > 20, null, { timeout: 15_000 });
  // Both views are marked: the same elements must still be there, with their lines, after everything that follows.
  await grid.evaluate((element) => {
    element.__kept = true;
  });
  await failedGrid.evaluate((element) => {
    element.__kept = true;
  });
  const rowsOf = () => grid.evaluate((element) => Number(element.getAttribute('aria-rowcount')));
  const rowsBefore = await rowsOf();
  const failedRowsBefore = await failedGrid.evaluate((element) => Number(element.getAttribute('aria-rowcount')));
  assert.deepEqual(await counters(), { opened: 2, closed: 0, listeners: 4 }, `${engine}: two feeds opened; the registry listens to both and the view on screen (two) to its own`);
  await shot('before-unload');

  // The unload. The bundle's requests are held first, so that the plugin stays off until the check lets them through.
  const held = [];
  let released = false;
  await page.route(`**/_/plugins/${OK}/**`, (route) => {
    if (released) void route.continue();
    else held.push(route);
  });
  const found = await page.evaluate((id) => {
    const start = document.querySelector('[data-shell-part="window"]');
    const key = start === null ? undefined : Object.keys(start).find((name) => name.startsWith('__reactFiber$'));
    for (let fiber = key === undefined ? null : start[key]; fiber; fiber = fiber.return) {
      for (let hook = fiber.memoizedState; hook !== null && typeof hook === 'object' && 'next' in hook; hook = hook.next) {
        const value = hook.memoizedState;
        if (value !== null && typeof value === 'object' && typeof value.retry === 'function' && typeof value.getSnapshot === 'function') {
          const entry = value.getSnapshot().find((candidate) => candidate.id === id);
          void value.retry({ id, name: entry.name });
          return true;
        }
      }
    }
    return false;
  }, OK);
  assert.equal(found, true, `${engine}: the window's plugin store was found in its component's hooks`);
  // The panel reads the plugin leaving in the commit it happens in: the tab stays and says it ended.
  await kept.waitFor({ timeout: 15_000 });
  assert.equal(await page.getByRole('tab').filter({ hasText: 'orders-api/app' }).count(), 1, `${engine}: one tab for the session`);
  // The negative control `new-view`: the marker of the view is taken off, as if the view had been made again.
  if (CONTROL === 'new-view') {
    await grid.evaluate((element) => {
      delete element.__kept;
    });
  }

  assert.equal(await grid.evaluate((element) => element.__kept === true), true, `${engine}: it is the same view (not made again)`);
  if (CONTROL === 'new-view') {
    await grid.evaluate((element) => {
      element.__kept = true;
    });
  }

  const rowsOff = await rowsOf();
  assert.ok(rowsOff >= rowsBefore, `${engine}: the lines it had stay (${String(rowsBefore)} then ${String(rowsOff)})`);
  await log.getByText('Stream ended').waitFor();
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(await rowsOf(), rowsOff, `${engine}: and no line comes after the end`);
  // The negative control `double-close`: the plugin's count of closes is one more, as if the host had closed a feed twice.
  if (CONTROL === 'double-close') {
    await page.evaluate(() => {
      Reflect.get(window, '__fixtureLogs').closed += 1;
    });
  }

  assert.deepEqual(await counters(), { opened: 2, closed: 2, listeners: 2 }, `${engine}: the plugin's feeds were closed once each and the registry let go of them (the view's two stay)`);
  if (CONTROL === 'double-close') {
    await page.evaluate(() => {
      Reflect.get(window, '__fixtureLogs').closed -= 1;
    });
  }
  const calls = () => page.evaluate(() => [...Reflect.get(window, '__fixtureLogs').closeCalls]);
  // The negative control `close-twice`: the plugin's count of the calls to the first feed's close is one more, as if the host had called it twice (`closed` counts a feed once, so only the calls show it); put back right after.
  if (CONTROL === 'close-twice') {
    await page.evaluate(() => {
      Reflect.get(window, '__fixtureLogs').closeCalls[0] += 1;
    });
  }

  assert.deepEqual(await calls(), [1, 1], `${engine}: close was asked of each feed once (the calls are counted, repeats too)`);
  if (CONTROL === 'close-twice') {
    await page.evaluate(() => {
      Reflect.get(window, '__fixtureLogs').closeCalls[0] -= 1;
    });
  }

  // The session that had failed on its own stays as it was: the same tab (failed, not ended), the same view and lines, and the card says its own words and time, and then that the plugin was unloaded.
  // The negative control `failed-ended`: its tab's name says ended, as if the unload had ended it.
  if (CONTROL === 'failed-ended') {
    await page.locator('[role=tab][aria-label^="orders-api/sync"]').evaluate((element) => {
      element.setAttribute('aria-label', 'orders-api/sync, ended');
    });
  }

  assert.equal(await failed.count(), 1, `${engine}: the failed session stays failed`);
  if (CONTROL === 'failed-ended') {
    await page.locator('[role=tab][aria-label^="orders-api/sync"]').evaluate((element) => {
      element.setAttribute('aria-label', 'orders-api/sync, failed');
    });
  }

  assert.equal(await failedGrid.evaluate((element) => element.__kept === true), true, `${engine}: the failed session is the same view`);
  assert.equal(await failedGrid.evaluate((element) => Number(element.getAttribute('aria-rowcount'))), failedRowsBefore, `${engine}: and has the lines it had`);
  assert.equal(await cardOf(failed), failedBefore.replace(/ Open Item$/, ' The plugin was unloaded. Open Item'), `${engine}: the failed session's card keeps its own words and time and adds that the plugin was unloaded`);
  await shot('after-unload');
  await kept.hover();
  await card.waitFor();
  assert.match(await card.innerText(), /Logs[\s\S]*Item orders-api[\s\S]*State\s+Stream ended[\s\S]*The plugin was unloaded\./, `${engine}: the card says the plugin was unloaded`);
  assert.equal(await card.getByRole('link').count(), 0, `${engine}: the resource is no link while the plugin is off`);
  assert.equal(await card.getByRole('button', { name: 'Open Item' }).getAttribute('aria-disabled'), 'true', `${engine}: and the Open button is unavailable`);
  await page.mouse.move(2, 2);

  // The plugin is back: its bundle is let through.
  released = true;
  for (const route of held.splice(0)) await route.continue();
  await page.getByRole('heading', { level: 1, name: 'orders-api' }).waitFor({ timeout: 30_000 });
  await kept.waitFor();
  assert.equal(await grid.evaluate((element) => element.__kept === true), true, `${engine}: still the same view`);
  assert.equal(await rowsOf(), rowsOff, `${engine}: nothing resumed: the same lines`);
  assert.deepEqual(await counters(), { opened: 2, closed: 2, listeners: 2 }, `${engine}: no stream was opened or closed by the plugin's return`);
  await kept.hover();
  await card.waitFor();
  assert.equal(await card.getByRole('link', { name: 'Item orders-api' }).count(), 1, `${engine}: the card's link works again`);
  assert.equal(await card.getByRole('button', { name: 'Open Item' }).getAttribute('aria-disabled'), null, `${engine}: and so does the Open button`);
  await page.mouse.move(2, 2);
  assert.equal(await failed.count(), 1, `${engine}: the failed session is still failed when the plugin is back`);

  // A new press of Logs: a new session beside the held ones, with a stream of its own.
  await press('Logs: app');
  await page.getByRole('tab', { name: 'orders-api/app (2)' }).waitFor({ timeout: 15_000 });
  assert.equal(await kept.count(), 1, `${engine}: the held session is still there, ended`);
  // The new session is on screen and the held ones are not: a hidden view holds no listener (the registry's one and the new view's two are the three), and the held streams are closed, once each.
  assert.deepEqual(await counters(), { opened: 3, closed: 2, listeners: 3 }, `${engine}: a third feed opened; the held ones are untouched`);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-log-session] [role=grid]')].some((element) => !('__kept' in element) && Number(element.getAttribute('aria-rowcount')) > 5), null, { timeout: 15_000 });
  await kept.click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-log-session] [role=grid]')].some((element) => element.__kept === true && element.getClientRects().length > 0), null, { timeout: 15_000 });
  await shot('after-reload');

  // Closing the tabs frees every listener and closes each stream once.
  await kept.focus();
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => Reflect.get(window, '__fixtureLogs')?.listeners === 3);
  assert.deepEqual(await counters(), { opened: 3, closed: 2, listeners: 3 }, `${engine}: closing the held tab closed nothing twice and freed its view's listeners`);
  // The session that is left of its name is the first of its name now: closing one of two sessions of a title gives the other its name back (no ordinal).
  await page.getByRole('tab', { name: 'orders-api/app', exact: true }).focus();
  await page.keyboard.press('Delete');
  await failed.focus();
  await page.keyboard.press('Delete');
  await page.getByText('No log sessions').waitFor();
  await page.waitForFunction(() => Reflect.get(window, '__fixtureLogs')?.listeners === 0);
  assert.deepEqual(await counters(), { opened: 3, closed: 3, listeners: 0 }, `${engine}: the three streams closed once each, no listener left`);
  assert.deepEqual(await calls(), [1, 1, 1], `${engine}: in all, each feed's close was asked for once`);
  await page.unroute(`**/_/plugins/${OK}/**`);
  // The negative control `page-error`: the page raises an error of the kind a failed request makes, which nothing in this scenario interrupted on purpose: it must be reported, not excused.
  if (CONTROL === 'page-error') {
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('Failed to fetch');
      }, 0);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // No request is interrupted in this scenario (the plugin's bundle is held and then let through, never aborted), so no page error is excused: any one is the plugin's or the host's, and is reported.
  assert.deepEqual(errors, [], `${engine}: the unload and the return wrote no page error`);
}

/**
 * m. A Logs session is its plugin and its target (P1b-3d, A22), in a page of its own, pressed from the item's menu as a person does. The fixture's item has a target that streams (`app`), the same title in another yard
 * (its twin: a target of its own, with the south yard for its scope) and two that stop by themselves, one that ends and one that fails (`migrate`, `sync`). Pressing the command of a session that streams shows it and
 * opens no second feed (the plugin counts the feeds it was asked for); the twins are two tabs and each draws its scope, and the tab that is left draws none once the other has closed (a session with no twin draws no
 * scope); a session that ended and one that failed are not shown again: a press opens a NEW one beside each, which the strip tells by its ordinal, and no two tabs are named alike; closing every tab frees every listener
 * and closes each feed once. SEAM_SHOTS=<dir> writes the pictures of WebKit (`identity-one-session.png`, `identity-twins.png`). SEAM_CONTROL=<name> makes one perturbation that one assertion must see (see CONTROLS), and only
 * that one: the tab a perturbation changes (`tabNamed`), the counters it leaves alone and the baseline it starts from (a page that is not there would fail the assertion without any perturbation) are asked for first, under
 * the control only and in words of their own, so a page that drew no tab, or the wrong one, or was not at the baseline, fails there and is never taken for a detection.
 */
async function checkIdentity(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const shot = async (name) => {
    if (process.env.SEAM_SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(process.env.SEAM_SHOTS, `${name}.png`) });
  };
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  await openFirstPlugin(page);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  await page.getByRole('link', { name: 'orders-api' }).click();
  await page.getByRole('heading', { level: 1, name: 'orders-api' }).waitFor();
  const press = async (command) => {
    await page.getByRole('button', { name: 'More actions for orders-api' }).click();
    await page.getByRole('menuitem', { name: command }).click();
  };
  const counters = () => page.evaluate(() => ({ ...Reflect.get(window, '__fixtureLogs') }));
  const calls = () => page.evaluate(() => [...Reflect.get(window, '__fixtureLogs').closeCalls]);
  /** What the plugin counted of the feeds, the listeners left out: they come and go with the views, which mount and let go a moment after the panel shows or hides them. */
  const fed = async () => {
    const { opened, closed } = await counters();
    return { opened, closed };
  };
  /** Waits until `count` listeners are on the plugin's feeds; when they never are, the assertion that reads the counters next says what they were. */
  const settle = async (count) => {
    await page.waitForFunction((wanted) => Reflect.get(window, '__fixtureLogs')?.listeners === wanted, count, { timeout: 10_000 }).catch(() => undefined);
  };
  const strip = page.getByRole('tablist', { name: 'Logs sessions' });
  const tabs = strip.getByRole('tab');
  /** The accessible name of each session tab of the Logs tool, in the strip's order. */
  const names = () => tabs.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')));
  /** The scope each tab draws, in the same order: its words, or `null` for a tab that draws none. */
  const scopesOf = () => tabs.evaluateAll((elements) => elements.map((element) => element.querySelector('[data-shell-part="sessionScope"]')?.textContent?.trim() ?? null));
  /**
   * The tab with this accessible name, which has to be on screen once. A page that drew none (or two) fails HERE, in words of its own: what a tab draws is never asked of a tab that is not there, so "draws no scope" is
   * not the answer of a page with no tab, and a negative control is not detected by one (the patterns of CONTROLS match the assertions they are named for, and nothing in this message).
   */
  const tabNamed = async (name, why) => {
    const tab = strip.getByRole('tab', { name, exact: true });
    assert.equal(await tab.count(), 1, `${engine}: one session tab named "${name}" is on screen (${why})`);
    return tab;
  };
  /** The words of the scope part the tab with this name draws, or `null` when it draws none. Only the tab's own part counts: a scope part that stands somewhere else in the strip is not its scope. */
  const scopeOfTab = async (name) => {
    const part = (await tabNamed(name, 'its scope is asked of it')).locator('[data-shell-part="sessionScope"]');
    return (await part.count()) === 0 ? null : ((await part.first().textContent()) ?? '').trim();
  };
  /** A session's view is on screen with lines in it. The view is named for its session's own title and scope, whatever its tab draws. */
  const viewed = async (label) => {
    await page.getByRole('group', { name: `Log, ${label}` }).getByRole('grid').waitFor();
    await page.waitForFunction((name) => Number(document.querySelector(`[role=group][aria-label="${name}"] [role=grid]`)?.getAttribute('aria-rowcount') ?? 0) > 20, `Log, ${label}`, { timeout: 15_000 });
  };
  /** A scope part the shell did not draw, put into the tab with this name (`takeScope` takes it out again): what the controls `scope-lone` and `scope-kept` do. A tab that is not there takes none, and says so in words of its own. */
  const putScope = async (name) => {
    const tab = await tabNamed(name, 'the control puts a scope part into it');
    await tab.evaluate((element) => {
      element.querySelector('[data-shell-part="sessionLabel"]').insertAdjacentHTML('beforeend', '<span data-shell-part="sessionScope" data-seam-fake="">north-yard</span>');
    });
  };
  const takeScope = () =>
    page.evaluate(() => {
      for (const part of document.querySelectorAll('[data-seam-fake]')) part.remove();
    });

  // 1. Pressing Logs: app twice. Another tool is chosen between the two presses, so the second has something to show: the Logs tool comes back with the session, and the plugin is asked for no second feed.
  await press('Logs: app');
  await page.locator('[data-shell-region="panel"]').waitFor({ state: 'visible' });
  await viewed('orders-api/app · north-yard');
  await page.getByRole('tab', { name: 'Streams', exact: true }).click();
  await page.getByRole('group', { name: 'Log, orders-api/app · north-yard' }).waitFor({ state: 'hidden' });
  await press('Logs: app');
  await viewed('orders-api/app · north-yard');
  assert.equal(await page.getByRole('tab', { name: 'Logs', exact: true }).getAttribute('aria-selected'), 'true', `${engine}: the second press chose the Logs tool again`);
  assert.deepEqual(await names(), ['orders-api/app'], `${engine}: two presses of Logs: app leave ONE session tab, named by its title alone`);
  // The negative control `scope-lone`: a scope part the shell did not draw is put into the tab. It starts from a tab with no scope part of its own, asserted first (under this control only) in words of its own: a tab that
  // already drew one would fail the assertion below without the perturbation. The tab is asked for by its name, once (`scopeOfTab`): a page that drew none says so in words of its own and is no detection.
  if (CONTROL === 'scope-lone') {
    const own = await scopeOfTab('orders-api/app');
    assert.equal(own, null, `${engine}: the control starts from a tab with no scope part of its own (it draws ${JSON.stringify(own)})`);
    await putScope('orders-api/app');
  }

  const loneScope = await scopeOfTab('orders-api/app');
  assert.equal(loneScope, null, `${engine}: a session with no twin draws no scope part (the tab draws ${JSON.stringify(loneScope)})`);
  if (CONTROL === 'scope-lone') await takeScope();
  await settle(3);
  // What the second press did not touch is read before anything is perturbed, in words of its own: nothing was closed, and the registry and the view (two) listen to the one feed that is open. A page that drew no view
  // fails here, and is never the answer of the assertion below, which is about the feeds the plugin was asked for and nothing else.
  const idle = await counters();
  assert.deepEqual({ closed: idle.closed, listeners: idle.listeners }, { closed: 0, listeners: 3 }, `${engine}: no feed was closed, and the registry and the view (two) listen to the one that is open`);
  // The negative control `second-stream`: the plugin's count of the feeds it opened is one more, as if the second press had started a second stream. It starts from the count the page has, which has to be one (read above,
  // before anything is perturbed): on a page that had already been asked for two feeds the assertion below fails without the perturbation. That baseline is asserted first (under this control only), in words of its own.
  if (CONTROL === 'second-stream') {
    assert.equal(idle.opened, 1, `${engine}: the control starts from one feed asked for (the plugin had been asked for ${String(idle.opened)} before the count was raised)`);
    await page.evaluate(() => {
      Reflect.get(window, '__fixtureLogs').opened += 1;
    });
  }

  const asked = (await counters()).opened;
  assert.equal(asked, 1, `${engine}: the second press of Logs: app showed the session and started no second stream (the plugin was asked for ${String(asked)} feeds)`);
  if (CONTROL === 'second-stream') {
    await page.evaluate(() => {
      Reflect.get(window, '__fixtureLogs').opened -= 1;
    });
  }

  await page.mouse.move(2, 2);
  await shot('identity-one-session');

  // 2. The same title in the south yard is a target of its own, so a second session: two tabs of one title and two scopes, and each draws its scope to tell the two apart.
  await press('Logs: its twin in the south yard');
  await viewed('orders-api/app · south-yard');
  assert.deepEqual(await names(), ['orders-api/app · north-yard', 'orders-api/app · south-yard'], `${engine}: the twin opens a second tab, and each of the two is named by its title and its scope`);
  assert.deepEqual(await scopesOf(), ['north-yard', 'south-yard'], `${engine}: each of the two draws its own scope`);
  assert.deepEqual(await fed(), { opened: 2, closed: 0 }, `${engine}: a second feed opened, for the twin`);
  await page.mouse.move(2, 2);
  await shot('identity-twins');
  // A press of either command shows its session's tab and starts nothing: the first tab is chosen by hand, then each command chooses its own.
  await tabs.first().click();
  await press('Logs: its twin in the south yard');
  await page.getByRole('tab', { name: 'orders-api/app · south-yard', exact: true, selected: true }).waitFor();
  await press('Logs: app');
  await page.getByRole('tab', { name: 'orders-api/app · north-yard', exact: true, selected: true }).waitFor();
  assert.deepEqual(await names(), ['orders-api/app · north-yard', 'orders-api/app · south-yard'], `${engine}: pressing either command again shows its own tab and leaves the same two`);
  assert.deepEqual(await fed(), { opened: 2, closed: 0 }, `${engine}: and opens no third feed`);

  // 3. The south tab closes: the tab that is left has no twin now, and draws no scope.
  await page.getByRole('tab', { name: 'orders-api/app · south-yard', exact: true }).focus();
  await page.keyboard.press('Delete');
  await page.getByRole('tab', { name: 'orders-api/app', exact: true }).waitFor();
  assert.deepEqual(await names(), ['orders-api/app'], `${engine}: the tab that is left is named by its title alone`);
  // The negative control `scope-kept`: a scope part the shell did not draw is put into the tab that is left (asked for by its name, and started from a tab with no scope part of its own, as above).
  if (CONTROL === 'scope-kept') {
    const own = await scopeOfTab('orders-api/app');
    assert.equal(own, null, `${engine}: the control starts from a tab with no scope part of its own (it draws ${JSON.stringify(own)})`);
    await putScope('orders-api/app');
  }

  const leftScope = await scopeOfTab('orders-api/app');
  assert.equal(leftScope, null, `${engine}: the tab that is left when its twin closes draws no scope part (the tab draws ${JSON.stringify(leftScope)})`);
  if (CONTROL === 'scope-kept') await takeScope();
  await settle(3);
  assert.deepEqual(await counters(), { opened: 2, closed: 1, listeners: 3 }, `${engine}: closing the twin closed its feed once and released its listeners`);

  // 4. A session that ended on its own is not shown again: a press opens a new session beside it, which the strip tells by its ordinal, and the ended one stays. So does one that failed.
  await press('Logs: migrate (ends)');
  await page.getByRole('tab', { name: 'orders-api/migrate, ended', exact: true }).waitFor({ timeout: 15_000 });
  await press('Logs: migrate (ends)');
  await page.getByRole('tab', { name: /^orders-api\/migrate \(2\)/ }).waitFor();
  assert.deepEqual(await fed(), { opened: 4, closed: 1 }, `${engine}: a press of a session that ended opened a new feed (the ended one is not shown again)`);
  // The new session ends by itself, too: the names are read when nothing changes any more.
  await page.getByRole('tab', { name: 'orders-api/migrate (2), ended', exact: true }).waitFor({ timeout: 15_000 });
  assert.deepEqual(await names(), ['orders-api/app', 'orders-api/migrate, ended', 'orders-api/migrate (2), ended'], `${engine}: the new session is a tab beside the ended one, told by its ordinal, and the ended one stays`);
  // The negative control `same-name`: the new tab's name is set to the name of the ended one. It starts from tabs named apart, asserted first (under this control only) in words of its own: tabs that were already alike
  // would fail the assertion below without the perturbation. The tab is asked for by its name: one that is not there is a failure of its own.
  if (CONTROL === 'same-name') {
    const apart = await names();
    assert.equal(new Set(apart).size, apart.length, `${engine}: the control starts from tabs named apart (${JSON.stringify(apart)})`);
    await (await tabNamed('orders-api/migrate (2), ended', 'the control gives it the name of the ended one')).evaluate((tab) => {
      tab.setAttribute('aria-label', 'orders-api/migrate, ended');
    });
  }

  const named = await names();
  assert.equal(new Set(named).size, named.length, `${engine}: no two session tabs are named alike (${JSON.stringify(named)})`);
  if (CONTROL === 'same-name') {
    await tabs.last().evaluate((tab) => {
      tab.setAttribute('aria-label', 'orders-api/migrate (2), ended');
    });
  }

  await press('Logs: sync (fails)');
  await page.getByRole('tab', { name: 'orders-api/sync, failed', exact: true }).waitFor({ timeout: 15_000 });
  await press('Logs: sync (fails)');
  await page.getByRole('tab', { name: /^orders-api\/sync \(2\)/ }).waitFor();
  assert.deepEqual(await fed(), { opened: 6, closed: 1 }, `${engine}: a press of a session that failed opened a new feed (the failed one is not shown again)`);
  await page.getByRole('tab', { name: 'orders-api/sync (2), failed', exact: true }).waitFor({ timeout: 15_000 });
  assert.deepEqual(await names(), ['orders-api/app', 'orders-api/migrate, ended', 'orders-api/migrate (2), ended', 'orders-api/sync, failed', 'orders-api/sync (2), failed'], `${engine}: the failed session stays, and the new one is told by its ordinal`);
  assert.deepEqual(await scopesOf(), [null, null, null, null, null], `${engine}: sessions of one title and one scope are told by their ordinal, and none of the five draws a scope part`);

  // 5. Closing every tab frees every listener and closes each feed once.
  for (let left = await tabs.count(); left > 0; left -= 1) {
    await tabs.first().focus();
    await page.keyboard.press('Delete');
    await page.waitForFunction((count) => document.querySelectorAll('[data-shell-part="sessionTab"]').length === count, left - 1);
  }

  await page.getByText('No log sessions').waitFor();
  await settle(0);
  assert.deepEqual(await counters(), { opened: 6, closed: 6, listeners: 0 }, `${engine}: every feed that was opened was closed, and no listener is left`);
  assert.deepEqual(await calls(), [1, 1, 1, 1, 1, 1], `${engine}: and each feed's close was asked for once`);
  assert.deepEqual(errors, [], `${engine}: pressing the commands and closing the sessions wrote no page error`);
}

/** Polls `ready` until it answers true: the host answers on its own clock (its health check ticks every 30 s), so the check waits for what the host does and not for a time. */
async function waitUntil(what, ready, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`timed out after ${String(ms)} ms waiting for ${what}`);
}

/**
 * n. A plugin that stops reaches the window (PU1, decision A21), on a host of its own whose fixture plugin has a PROCESS (the Go program of `fixture/process`, built once). The window shows the plugin's page, its Logs
 * session and its tool; the check asks the host for the plugin's pid (`processinfo`, with the executable it is running: never a pattern), takes the execute bit off its binary (so that the host's recovery cannot start it) and
 * kills that pid. The host finds the process gone on its next health check, which ticks every 30 s, and tells the window with `plugin/unloaded`: the frames of the window's event socket are the evidence of what it
 * was told, and the page is what it did with it. Then the host's recovery reloads the plugin and fails (a second `plugin/unloaded`, `reloaded`: the cause the plugin went away with stands), the binary is put back, the
 * plugin is loaded again and the host says it runs (`plugin/state_change`): the window shows one of everything again, with no reload.
 * Every negative control of this scenario is made here, in turn, when SEAM_CONTROL asks (`asserting`; PROCESS_CONTROLS).
 */
async function checkProcess(browser, engine, binary, work) {
  const dir = await mkdtemp(path.join(work, `process-${engine}-`));
  const host = await startHost(dir, await freePort(), undefined, async (plugins) => [await writePlugin(plugins, OK, binary), await writePlugin(plugins, DUP)]);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // What the window is told: every `plugin/*` event that reaches its event socket, as the host sent it.
  const frames = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (typeof message?.name === 'string' && message.name.startsWith('plugin/')) frames.push({ name: message.name, data: message.data });
      } catch {
        // not an event
      }
    });
  });
  const controlled = [];
  /**
   * An assertion of this scenario. Under SEAM_CONTROL (`process`, or the name of the control) the perturbation is made first and the assertion is run, in a try: it must fail, and with ITS words; the perturbation
   * is undone and the assertion run as it stands, which is the check.
   */
  const asserting = async (name, perturb, undo, assertion) => {
    if (CONTROL === 'process' || CONTROL === name) {
      await perturb();
      let message = '';
      if (REMOVE !== name) {
        try {
          await assertion();
        } catch (error) {
          message = String(error?.message ?? error);
        }
      }

      await undo();
      controlled.push({ name, message });
    }

    if (REMOVE !== name) await assertion();
  };
  const entries = page.getByRole('group', { name: 'Plugins' }).getByRole('button');
  const railNames = async () => entries.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  const strip = page.getByRole('tablist', { name: 'Open tabs' });
  const pageTabs = async () => strip.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => tab.textContent));
  const streams = page.getByRole('tab', { name: 'Streams', exact: true });
  const copyStreams = page.getByRole('tab', { name: 'Streams copy', exact: true });
  const itemHeading = page.getByRole('heading', { level: 1, name: 'orders-api' });
  const kept = page.getByRole('tab', { name: 'orders-api/app, ended' });
  const log = page.getByRole('group', { name: 'Log, orders-api/app · north-yard' });
  const grid = log.getByRole('grid');
  const counters = async () => page.evaluate(() => ({ ...Reflect.get(window, '__fixtureLogs') }));
  const card = page.locator('[popover]:popover-open');
  const told = () => frames.filter((frame) => frame.name === 'plugin/unloaded').map((frame) => frame.data);
  const CRASHED = "The plugin process stopped unexpectedly, so its pages can't load data.";
  const exited = new Promise((resolve) => host.child.once('exit', resolve));
  try {
    await open(page, host.base);
    await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
    await openFirstPlugin(page);
    await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
    await page.getByRole('link', { name: 'orders-api' }).click();
    await itemHeading.waitFor();
    await page.getByRole('button', { name: 'More actions for orders-api' }).click();
    await page.getByRole('menuitem', { name: 'Logs: app' }).click();
    await grid.waitFor();
    await page.waitForFunction(() => Number(document.querySelector('[role=group][aria-label="Log, orders-api/app · north-yard"] [role=grid]')?.getAttribute('aria-rowcount') ?? 0) > 20, null, { timeout: 15_000 });
    // The view is marked: the same element must still be there, with its lines, after everything that follows.
    await grid.evaluate((element) => {
      element.__kept = true;
    });
    const rowsOf = async () => grid.evaluate((element) => Number(element.getAttribute('aria-rowcount')));
    const rowsBefore = await rowsOf();
    // The baseline: what is on screen before the plugin stops, asked for in words none of the controls' patterns match.
    assert.deepEqual(await railNames(), ['Seam Fixture', 'Seam Fixture Copy'], `${engine}: before the process ends the rail lists the two plugins`);
    assert.equal(await streams.count(), 1, `${engine}: before the process ends the plugin's tool is in the panel`);
    assert.equal(await copyStreams.count(), 1, `${engine}: and so is the other plugin's`);
    assert.deepEqual(await counters(), { opened: 1, closed: 0, listeners: 3 }, `${engine}: before the process ends one feed is open, and the registry and the view listen to it`);
    // The sidebar: the page on screen is an object of the list `Items`, in the group `Things`, which is open for it. The user closes the group; whether it is still closed when the plugin is back is what D5 is about.
    const things = page.getByRole('treeitem', { name: 'Things', exact: true });
    assert.equal(await things.getAttribute('aria-expanded'), 'true', `${engine}: before the process ends the group of the page on screen is open in the sidebar`);
    await things.click();
    assert.equal(await things.getAttribute('aria-expanded'), 'false', `${engine}: and the user closed it`);
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, '__fixtureSidebar')), { open: [] }, `${engine}: the plugin's hook was told that no group is open`);

    // The process is the host's to name. It reports each plugin's pid with the executable behind it; the check kills what the host reported and nothing it found by a name.
    const snapshot = await callBound(host.base, PROCESS_SERVICE, 'GetSnapshot');
    const row = snapshot.processes.find((candidate) => candidate.key === `plugin:${OK}`);
    assert.ok(row?.ownership === 'verified' && row.identity?.pid > 0, `${engine}: the host names the plugin's process: ${JSON.stringify(row)}`);
    const { pid, executable } = row.identity;
    await asserting(
      'pid-pattern',
      async () => {
        row.identity.executable = '/usr/local/bin/node';
      },
      async () => {
        row.identity.executable = executable;
      },
      async () => {
        assert.ok(row.identity.executable.endsWith(`/plugins/${OK}/bin/plugin`), `${engine}: the process the host names is the fixture plugin's own (${row.identity.executable})`);
      },
    );
    process.kill(pid, 0);
    // With the execute bit off the host's recovery cannot load the plugin again, so it stays down until the check says: that is what makes the state under test hold still.
    await chmod(path.join(stateRoot(dir), 'plugins', OK, 'bin', 'plugin'), 0o644);
    const mark = frames.length;
    process.kill(pid, 'SIGKILL');
    await waitUntil(`the host to see process ${String(pid)} end`, () => host.output().includes(`id=${String(pid)} error="signal: killed"`), 15_000);

    // The host's health check finds it (up to 30 s) and the window is told.
    await entries.nth(1).waitFor();
    await page.getByRole('button', { name: 'Seam Fixture, stopped' }).waitFor({ timeout: 75_000 });
    assert.match(host.output(), /plugin lifecycle transition.*"from": "Running", "to": "Recovering", "reason": "crash detected"/, `${engine}: the host says it detected the crash`);
    assert.equal(told()[0]?.pluginID, OK, `${engine}: the first plugin/unloaded names the plugin`);
    assert.equal(told()[0]?.cause, 'crashed', `${engine}: and says it crashed`);
    // The perturbation is a frame of the shape a text-carrying event would have; it is removed by identity (a real `plugin/crash` frame carries an `error` too).
    const forged = { name: 'plugin/unloaded', data: { pluginID: OK, cause: 'crashed', error: 'panic at /Users/someone/.omniview/plugins' } };
    await asserting(
      'frame-text',
      async () => {
        frames.push(forged);
      },
      async () => {
        frames.splice(frames.indexOf(forged), 1);
      },
      async () => {
        for (const data of told()) assert.deepEqual(Object.keys(data).sort(), ['cause', 'pluginID'], `${engine}: the host's plugin/unloaded carries the plugin's id and the cause and no other member`);
      },
    );
    assert.ok(frames.some((frame) => frame.name === 'plugin/state_change' && frame.data?.to === 'Recovering'), `${engine}: the window was told the phase too`);
    assert.equal(frames.slice(mark).some((frame) => frame.name === 'plugin/state_change' && frame.data?.to === 'Running'), false, `${engine}: and it does not run again while the check keeps it down`);

    // What the window did with it.
    await asserting(
      'rail-fine',
      async () => {
        await entries.nth(1).evaluate((button) => button.setAttribute('aria-label', 'Seam Fixture'));
      },
      async () => {
        await entries.nth(1).evaluate((button) => button.setAttribute('aria-label', 'Seam Fixture, stopped'));
      },
      async () => {
        assert.deepEqual(await railNames(), ['Seam Fixture Copy', 'Seam Fixture, stopped'], `${engine}: the rail names the plugin that stopped, with the cause in its tip (its name)`);
        assert.equal(await entries.nth(1).getAttribute('data-ov-tip'), `Seam Fixture, stopped\n${CRASHED}`, `${engine}: the rail names the plugin that stopped, with the cause in its tip (the tip)`);
      },
    );
    await page.getByRole('alert').waitFor();
    await asserting(
      'page-drawn',
      async () => {
        await page.evaluate(() => {
          const decoy = document.createElement('h1');
          decoy.textContent = 'orders-api';
          decoy.setAttribute('data-decoy', '');
          document.body.append(decoy);
        });
      },
      async () => {
        await page.evaluate(() => {
          document.querySelector('[data-decoy]')?.remove();
        });
      },
      async () => {
        assert.deepEqual(await pageTabs(), ['Seam Fixture'], `${engine}: the tab of the plugin that stopped says why and draws no page of it (the tab keeps its route under the plugin's name)`);
        assert.match(await page.getByRole('alert').innerText(), new RegExp(`Couldn't load Seam Fixture[\\s\\S]*${CRASHED.replace(/[.']/g, '\\$&')}`), `${engine}: the tab of the plugin that stopped says why and draws no page of it (the sentence)`);
        assert.equal(await page.getByRole('button', { name: 'Retry' }).count(), 1, `${engine}: the tab of the plugin that stopped says why and draws no page of it (the Retry the mock has)`);
        assert.equal(await itemHeading.count(), 0, `${engine}: the tab of the plugin that stopped says why and draws no page of it (no heading)`);
      },
    );
    await asserting(
      'tool-stays',
      async () => {
        await page.evaluate(() => {
          const decoy = document.createElement('div');
          decoy.setAttribute('role', 'tab');
          decoy.setAttribute('aria-label', 'Streams');
          decoy.setAttribute('data-decoy', '');
          document.body.append(decoy);
        });
      },
      async () => {
        await page.evaluate(() => {
          document.querySelector('[data-decoy]')?.remove();
        });
      },
      async () => {
        assert.equal(await streams.count() + (await copyStreams.count()) * 10, 10, `${engine}: the tool of the plugin that stopped leaves the panel and the other plugin's stays`);
      },
    );

    // The Logs session of the host's own tool stays (A21): ended, with the cause, in the same view with its lines, its stream closed once.
    await asserting(
      'session-live',
      async () => {
        await page.locator('[role=tab][aria-label^="orders-api/app"]').evaluate((element) => element.setAttribute('aria-label', 'orders-api/app'));
      },
      async () => {
        await page.locator('[role=tab][aria-label^="orders-api/app"]').evaluate((element) => element.setAttribute('aria-label', 'orders-api/app, ended'));
      },
      async () => {
        assert.equal(await kept.count(), 1, `${engine}: the Logs session stays, ended, in the same view with the lines it had (the tab)`);
        assert.equal(await grid.evaluate((element) => element.__kept === true), true, `${engine}: the Logs session stays, ended, in the same view with the lines it had (the view)`);
        assert.ok((await rowsOf()) >= rowsBefore, `${engine}: the Logs session stays, ended, in the same view with the lines it had (the lines)`);
      },
    );
    await log.getByText('Stream ended').waitFor();
    await kept.hover();
    await card.waitFor();
    assert.match(await card.innerText(), /State\s+Stream ended[\s\S]*The plugin was unloaded\./, `${engine}: the card of the kept session says the plugin was unloaded`);
    await page.mouse.move(2, 2);
    assert.deepEqual(await counters(), { opened: 1, closed: 1, listeners: 2 }, `${engine}: the stream was closed once and the registry let go of it (the view's stay)`);

    // The host's recovery reloads the plugin, which fails (the binary cannot run), and says it as well: the window keeps the cause the plugin went away with.
    await waitUntil('the window to be told of the reload the recovery makes', () => told().some((data) => data.cause === 'reloaded'), 30_000);
    await asserting(
      'rail-moved-on',
      async () => {
        await entries.nth(1).evaluate((button) => button.setAttribute('aria-label', 'Seam Fixture, starting again'));
      },
      async () => {
        await entries.nth(1).evaluate((button) => button.setAttribute('aria-label', 'Seam Fixture, stopped'));
      },
      async () => {
        assert.deepEqual(await railNames(), ['Seam Fixture Copy', 'Seam Fixture, stopped'], `${engine}: the first cause stands while the host recovers the plugin: the rail still says stopped`);
      },
    );
    // What the window was told of the stop: the crash, then each attempt of the recovery, which reloads the plugin (`reloaded`) and fails because the binary cannot run (`failed`, PU2: a load that fails says so), and nothing else.
    const recovering = (causes) => causes[0] === 'crashed' && causes.length > 1 && causes.slice(1).every((cause) => cause === 'reloaded' || cause === 'failed');
    assert.ok(recovering(told().map((data) => data.cause)), `${engine}: the window was told the crash and then the reload that recovers it and the failure of its load, and nothing else (${JSON.stringify(told().map((data) => data.cause))})`);
    await waitUntil('the host to give up the recovery', () => host.output().includes('max crash recovery attempts reached'), 45_000);
    await waitUntil('the window to be told that the recovery\'s last load failed', () => told().at(-1)?.cause === 'failed', 15_000);
    const stopped = told().map((data) => data.cause);
    assert.ok(recovering(stopped) && stopped.at(-1) === 'failed', `${engine}: the recovery's last attempt failed to load the plugin and said so (${JSON.stringify(stopped)})`);
    assert.equal(frames.slice(mark).some((frame) => frame.name === 'plugin/state_change' && frame.data?.to === 'Running'), false, `${engine}: the plugin did not run while the binary could not`);

    // The plugin is started again: its binary is back and the host loads it. The host says it runs, and the window loads the interface again with no reload of the page.
    await chmod(path.join(stateRoot(dir), 'plugins', OK, 'bin', 'plugin'), 0o755);
    const reload = frames.length;
    await callBound(host.base, PLUGIN_SERVICE, 'LoadPlugin', OK, null);
    await page.getByRole('button', { name: 'Seam Fixture', exact: true }).waitFor({ timeout: 30_000 });
    await itemHeading.waitFor({ timeout: 30_000 });
    assert.ok(frames.slice(reload).some((frame) => frame.name === 'plugin/state_change' && frame.data?.pluginID === OK && frame.data?.to === 'Running'), `${engine}: the host said the plugin runs (plugin/state_change)`);
    assert.deepEqual(told().map((data) => data.cause), stopped, `${engine}: and said nothing more of it stopping`);
    await asserting(
      'rail-stuck',
      async () => {
        await entries.nth(0).evaluate((button) => button.setAttribute('aria-label', 'Seam Fixture, stopped'));
      },
      async () => {
        await entries.nth(0).evaluate((button) => button.setAttribute('aria-label', 'Seam Fixture'));
      },
      async () => {
        assert.deepEqual(await railNames(), ['Seam Fixture', 'Seam Fixture Copy'], `${engine}: the rail names the plugin that runs again, with no word of its stop`);
      },
    );
    await asserting(
      'two-pages',
      async () => {
        await streams.evaluate((tab) => {
          const twin = tab.cloneNode(true);
          twin.setAttribute('data-decoy', '');
          tab.parentElement?.append(twin);
        });
      },
      async () => {
        await page.evaluate(() => {
          document.querySelector('[data-decoy]')?.remove();
        });
      },
      async () => {
        assert.deepEqual(await pageTabs(), ['orders-api · Item'], `${engine}: one of everything: one page, one sidebar entry, one tool (the tab)`);
        assert.equal(await itemHeading.count(), 1, `${engine}: one of everything: one page, one sidebar entry, one tool (the page)`);
        assert.equal(await page.getByRole('navigation', { name: 'Seam Fixture navigation' }).count(), 1, `${engine}: one of everything: one page, one sidebar entry, one tool (the sidebar)`);
        assert.equal(await streams.count(), 1, `${engine}: one of everything: one page, one sidebar entry, one tool (the tool)`);
        assert.equal(await copyStreams.count(), 1, `${engine}: and the other plugin's tool is as it was`);
      },
    );
    // The sidebar is the sidebar the user left (S3, D5): the group they closed is closed, though the entry the page is on is inside it, and the plugin's hook, which runs again, is told that no group is open. The window's own
    // memory of its trees is what keeps it: the sidebar left with the plugin and its tree was drawn again.
    await asserting(
      'sidebar-reset',
      async () => {
        await things.click();
      },
      async () => {
        await things.click();
      },
      async () => {
        assert.equal(await things.getAttribute('aria-expanded'), 'false', `${engine}: the sidebar comes back as the user left it: the group they closed is closed (the group)`);
        assert.equal(await page.getByRole('treeitem', { name: /^Items/ }).count(), 0, `${engine}: the sidebar comes back as the user left it: the group they closed is closed (its entries)`);
        assert.deepEqual(await page.evaluate(() => Reflect.get(window, '__fixtureSidebar')), { open: [] }, `${engine}: the sidebar comes back as the user left it: the plugin's hook is told that no group is open`);
      },
    );
    if (process.env.SEAM_SHOTS !== undefined && engine === 'webkit') {
      await mkdir(process.env.SEAM_SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SEAM_SHOTS, 'sidebar-after-restart-webkit-void-1440x900.png') });
    }
    // The Logs session is as it was: still ended, the same view, nothing resumed, nothing opened or closed again.
    assert.equal(await kept.count(), 1, `${engine}: the kept session is still there, ended, when the plugin is back`);
    assert.equal(await grid.evaluate((element) => element.__kept === true), true, `${engine}: and is still the same view`);
    assert.deepEqual(await counters(), { opened: 1, closed: 1, listeners: 2 }, `${engine}: nothing was opened or closed by the plugin's return`);
    assert.deepEqual(errors, [], `${engine}: the process ending and the plugin coming back wrote no page error`);
    console.log(`${engine}: process ${String(pid)} killed; the window was told ${JSON.stringify(told())} and then ${JSON.stringify(frames.slice(reload).filter((frame) => frame.name === 'plugin/state_change').map((frame) => frame.data?.to))}`);

    if (controlled.length > 0) {
      const lost = [];
      for (const { name, message } of controlled) {
        if (REMOVE === name) {
          // The assertion the control is named for is left out (SEAM_REMOVE): its perturbation must pass undetected, as the proof that it trips that assertion and no other.
          if (message === '') console.log(`NEGATIVE CONTROL "${name}": NOT DETECTED in ${engine} with its assertion removed, as it must be`);
          else lost.push(`NEGATIVE CONTROL "${name}": detected in ${engine} with its assertion removed, by ${message}`);
        } else if (PROCESS_CONTROLS[name].test(message)) console.log(`NEGATIVE CONTROL "${name}": detected in ${engine}: ${message.split('\n')[0]}`);
        else lost.push(message === '' ? `NEGATIVE CONTROL "${name}": NOT DETECTED in ${engine}` : `NEGATIVE CONTROL "${name}": failed in ${engine}, but not the assertion it is named for: ${message}`);
      }

      if (lost.length > 0) throw new Error(lost.join('\n'));
    }
  } finally {
    await page.close();
    host.child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8000))]);
  }
}

/**
 * The assertions of a scenario that has negative controls. `asserting(name, perturb, undo, assertion)` runs `assertion` as the check; under SEAM_CONTROL (the group's name or the control's own) it first makes the perturbation, runs the
 * assertion in a try (it must fail, and with ITS words) and undoes the perturbation. Under SEAM_REMOVE=<name> that assertion is left out altogether, so its perturbation must pass undetected: what shows that the control trips the assertion it is
 * named for and no other. `verdict(engine)` says, for each control that was made, whether the assertion it is named for saw it, and throws when one did not (or, for the one removed, when anything did).
 */
function withControls(group, table) {
  const made = [];
  const asserting = async (name, perturb, undo, assertion) => {
    if (CONTROL === group || CONTROL === name) {
      await perturb();
      let message = '';
      if (REMOVE !== name) {
        try {
          await assertion();
        } catch (error) {
          message = String(error?.message ?? error);
        }
      }

      await undo();
      made.push({ name, message });
    }

    if (REMOVE !== name) await assertion();
  };
  const verdict = (engine) => {
    const lost = [];
    for (const { name, message } of made) {
      if (REMOVE === name) {
        if (message === '') console.log(`NEGATIVE CONTROL "${name}": NOT DETECTED in ${engine} with its assertion removed, as it must be`);
        else lost.push(`NEGATIVE CONTROL "${name}": detected in ${engine} with its assertion removed, by ${message}`);
      } else if (table[name].test(message)) console.log(`NEGATIVE CONTROL "${name}": detected in ${engine}: ${message.split('\n')[0]}`);
      else lost.push(message === '' ? `NEGATIVE CONTROL "${name}": NOT DETECTED in ${engine}` : `NEGATIVE CONTROL "${name}": failed in ${engine}, but not the assertion it is named for: ${message}`);
    }

    if (lost.length > 0) throw new Error(lost.join('\n'));
  };
  return { asserting, verdict };
}

/**
 * p. A plugin whose load fails reaches the window and can be retried (PU2: PU1-01 and PU1-02), on a host of its own whose fixture plugin has a PROCESS, as in n. What the process does at its next start is a file the check writes next to
 * its binary (`fixture/process`, `start-mode`): `exit` ends it before it says it is ready, `hang` keeps it silent. The host is asked to reload the plugin (`ReloadPlugin`, the call a rebuild makes) and the load fails; the frames of the window's
 * event socket are the evidence of what the host said, and the page is what the window did with it. Then Retry, in the tab, asks the host: the load fails again and the window returns to the failed state. With the process told to hang,
 * Retry shows the plugin starting again for as long as the host waits and the load ends as failed with the cause `timeout`, within the loader's own start timeout (15 s). With the file gone, Retry runs the plugin and the window shows one of
 * everything again, with no reload. Then the same process speaks another plugin protocol (S4: the fixture's manifest says `sdk_protocol_version: 2`) and the host refuses it by number: the window is told `incompatible` with two numbers, shows the
 * sentence and both versions with no Retry, and a window opened then shows the same from the inventory. Every negative control of this scenario is made here, in turn, when SEAM_CONTROL asks (`withControls`; FAILED_CONTROLS).
 */
async function checkFailedLoad(browser, engine, binary, work) {
  const dir = await mkdtemp(path.join(work, `failed-${engine}-`));
  const host = await startHost(dir, await freePort(), undefined, async (plugins) => [await writePlugin(plugins, OK, binary), await writePlugin(plugins, DUP)]);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // What the window is told: every `plugin/*` event that reaches its event socket, as the host sent it.
  const frames = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (typeof message?.name === 'string' && message.name.startsWith('plugin/')) frames.push({ name: message.name, data: message.data });
      } catch {
        // not an event
      }
    });
  });
  const { asserting, verdict } = withControls(FAILED_GROUP, FAILED_CONTROLS);
  const entries = page.getByRole('group', { name: 'Plugins' }).getByRole('button');
  const railNames = async () => entries.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  const strip = page.getByRole('tablist', { name: 'Open tabs' });
  const pageTabs = async () => strip.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => tab.textContent));
  const streams = page.getByRole('tab', { name: 'Streams', exact: true });
  const copyStreams = page.getByRole('tab', { name: 'Streams copy', exact: true });
  const itemHeading = page.getByRole('heading', { level: 1, name: 'orders-api' });
  const details = page.getByRole('heading', { level: 2, name: 'Details' });
  const sidebar = page.getByRole('navigation', { name: 'Seam Fixture navigation' });
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  /** The loading states on screen: the kit's skeleton is a status that is busy. */
  const spinners = async () => page.locator('[role="status"][aria-busy="true"]').count();
  /** What the host told the window of plugins that are not there, from the frame `from` on: the causes, in order. */
  const told = (from = 0) => frames.slice(from).filter((frame) => frame.name === 'plugin/unloaded').map((frame) => frame.data);
  const causes = (from = 0) => told(from).map((data) => data.cause);
  const ran = (from) => frames.slice(from).some((frame) => frame.name === 'plugin/state_change' && frame.data?.pluginID === OK && frame.data?.to === 'Running');
  const COULD_NOT_START = "The plugin could not start, so its pages can't load data.";
  const TOOK_TOO_LONG = "The plugin took too long to start, so its pages can't load data.";
  const escaped = (text) => text.replace(/[.']/g, '\\$&');
  const decoy = async (html) => page.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), html);
  const undecoy = async () => page.evaluate(() => document.querySelectorAll('[data-decoy]').forEach((element) => element.remove()));
  const relabel = async (index, label) => entries.nth(index).evaluate((button, name) => button.setAttribute('aria-label', name), label);
  /** SEAM_SHOTS=<dir> writes WebKit's pictures of the states (theme void, 1440 x 900). */
  const shot = async (name) => {
    if (!process.env.SEAM_SHOTS || engine !== 'webkit') return;
    await mkdir(process.env.SEAM_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SEAM_SHOTS, `failed-load-${name}-webkit-void-1440x900.png`) });
  };
  /** What the next start of the fixture's process does (`fixture/process`): a word in a file next to its binary, or no file. */
  const mode = path.join(stateRoot(dir), 'plugins', OK, 'start-mode');
  const exited = new Promise((resolve) => host.child.once('exit', resolve));
  try {
    await open(page, host.base);
    await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
    await openFirstPlugin(page);
    await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
    await page.getByRole('link', { name: 'orders-api' }).click();
    await itemHeading.waitFor();
    await details.waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Panel', exact: true }).click();
    await streams.waitFor();
    // The baseline: what is on screen before the load fails, asked for in words none of the controls' patterns match.
    assert.deepEqual(await railNames(), ['Seam Fixture', 'Seam Fixture Copy'], `${engine}: before the load fails the rail lists the two plugins`);
    assert.equal(await copyStreams.count(), 1, `${engine}: and the panel has both plugins' tools`);
    assert.equal(await spinners(), 0, `${engine}: and nothing is loading`);

    // The next start fails, and the host is asked to reload the plugin: the load fails.
    await writeFile(mode, 'exit');
    const first = frames.length;
    const reloading = tryBound(host.base, PLUGIN_SERVICE, 'ReloadPlugin', OK);
    await page.getByRole('button', { name: 'Seam Fixture, did not start' }).waitFor({ timeout: 30_000 });
    const answer = await reloading;
    assert.notEqual(answer.status, 200, `${engine}: the host answered the reload of a plugin that cannot start with an error`);
    // What the host said: the frames of the event socket. A perturbation is a frame of the shape a text-carrying event would have, removed by identity.
    const forged = { name: 'plugin/unloaded', data: { pluginID: OK, cause: 'failed', error: 'panic at /Users/someone/.omniview/plugins' } };
    await asserting(
      'told-frames',
      async () => {
        frames.push(forged);
      },
      async () => {
        frames.splice(frames.indexOf(forged), 1);
      },
      async () => {
        for (const data of told()) assert.deepEqual(Object.keys(data).sort(), ['cause', 'pluginID'], `${engine}: the host's plugin/unloaded carries the plugin's id and the cause and no other member (a load that failed)`);
      },
    );
    let removed;
    let at = -1;
    await asserting(
      'told-failed',
      async () => {
        at = frames.findIndex((frame, index) => index >= first && frame.name === 'plugin/unloaded' && frame.data?.cause === 'failed');
        [removed] = frames.splice(at, 1);
      },
      async () => {
        frames.splice(at, 0, removed);
      },
      async () => {
        assert.deepEqual(causes(first), ['reloaded', 'failed'], `${engine}: the window was told the reload and then that the load failed, and the plugin did not run (the causes)`);
        assert.equal(ran(first), false, `${engine}: the window was told the reload and then that the load failed, and the plugin did not run (it did not run)`);
      },
    );

    // What the window did with it.
    await page.getByRole('alert').waitFor();
    await asserting(
      'rail-failed',
      async () => relabel(1, 'Seam Fixture, stopped'),
      async () => relabel(1, 'Seam Fixture, did not start'),
      async () => {
        assert.deepEqual(await railNames(), ['Seam Fixture Copy', 'Seam Fixture, did not start'], `${engine}: the rail names the plugin that did not start, with the host's sentence in its tip (the name)`);
        assert.equal(await entries.nth(1).getAttribute('data-ov-tip'), `Seam Fixture, did not start\n${COULD_NOT_START}`, `${engine}: the rail names the plugin that did not start, with the host's sentence in its tip (the tip)`);
      },
    );
    await asserting(
      'tab-failed',
      async () => decoy('<h1 data-decoy>orders-api</h1>'),
      undecoy,
      async () => {
        assert.deepEqual(await pageTabs(), ['Seam Fixture'], `${engine}: the tab of the plugin that did not start says why, with a Retry, and draws no page (the tab keeps its route under the plugin's name)`);
        assert.match(await page.getByRole('alert').innerText(), new RegExp(`Couldn't load Seam Fixture[\\s\\S]*${escaped(COULD_NOT_START)}`), `${engine}: the tab of the plugin that did not start says why, with a Retry, and draws no page (the sentence)`);
        assert.equal(await retry.count(), 1, `${engine}: the tab of the plugin that did not start says why, with a Retry, and draws no page (the Retry)`);
        assert.equal(await itemHeading.count(), 0, `${engine}: the tab of the plugin that did not start says why, with a Retry, and draws no page (no heading)`);
      },
    );
    await asserting(
      'no-spinner',
      async () => decoy('<div data-decoy role="status" aria-busy="true"></div>'),
      undecoy,
      async () => {
        assert.equal(await spinners(), 0, `${engine}: no spinner is left in the tab of a plugin that did not start`);
      },
    );
    assert.equal((await streams.count()) + (await copyStreams.count()) * 10, 10, `${engine}: its tool left the panel and the other plugin's stayed`);
    await shot('did-not-start');
    // The record: a plugin whose load failed stays in the host's inventory, so that Retry has something to retry (it used to vanish, and Retry answered "not loaded").
    const record = await callBound(host.base, PLUGIN_SERVICE, 'GetPlugin', OK);
    const phase = record.phase;
    await asserting(
      'record-kept',
      async () => {
        record.phase = 'Running';
      },
      async () => {
        record.phase = phase;
      },
      async () => {
        assert.equal(record.phase, 'Failed', `${engine}: the host kept a record of the plugin that did not start: it is listed as Failed, so a retry has something to retry (${String(record.phase)})`);
      },
    );

    // A window that opens while the plugin is failed was told nothing (the host's events reach the windows that are open): the inventory lists the plugin as Failed, and the window shows it so from the first, with its Retry.
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('button', { name: 'Seam Fixture, did not start' }).waitFor({ timeout: 30_000 });
    await page.getByRole('alert').waitFor();
    // The panel is the window's own state: a reload brings back what the session held of it, which is not what this check is about, so it is opened if it is not.
    const toggle = page.getByRole('button', { name: 'Panel', exact: true });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    await copyStreams.waitFor();
    const opened = 'a window that opens while the plugin is failed shows it failed from the first: the rail, the sentence and the Retry';
    await asserting(
      'reopened',
      async () => relabel(1, 'Seam Fixture, stopped'),
      async () => relabel(1, 'Seam Fixture, did not start'),
      async () => {
        assert.deepEqual(await railNames(), ['Seam Fixture Copy', 'Seam Fixture, did not start'], `${engine}: ${opened} (the rail)`);
        assert.match(await page.getByRole('alert').innerText(), new RegExp(escaped(COULD_NOT_START)), `${engine}: ${opened} (the sentence)`);
        assert.equal(await retry.count(), 1, `${engine}: ${opened} (the Retry)`);
        assert.equal(await spinners(), 0, `${engine}: ${opened} (no spinner)`);
      },
    );

    // Retry asks the host, which starts the plugin again, and the load fails again: the window is back in the failed state.
    const second = frames.length;
    await retry.click();
    await waitUntil('the host to say that the retry failed too', () => causes(second).includes('failed'), 30_000);
    await retry.waitFor();
    assert.deepEqual(causes(second), ['reloaded', 'failed'], `${engine}: the Retry asked the host: it reloaded the plugin and said the load failed again`);
    const again = 'a second failure returns to the failed state: the rail, the sentence and the Retry';
    await asserting(
      'failed-again',
      async () => relabel(1, 'Seam Fixture, starting again'),
      async () => relabel(1, 'Seam Fixture, did not start'),
      async () => {
        assert.deepEqual(await railNames(), ['Seam Fixture Copy', 'Seam Fixture, did not start'], `${engine}: ${again} (the rail)`);
        assert.match(await page.getByRole('alert').innerText(), new RegExp(escaped(COULD_NOT_START)), `${engine}: ${again} (the sentence)`);
        assert.equal(await retry.count(), 1, `${engine}: ${again} (the Retry)`);
        assert.equal(await spinners(), 0, `${engine}: ${again} (no spinner)`);
      },
    );

    // The process says nothing at all: Retry shows the plugin starting again for as long as the host waits, and the load ends, within the loader's own start timeout, as a plugin that took too long.
    await writeFile(mode, 'hang');
    const third = frames.length;
    const pressed = Date.now();
    await retry.click();
    await page.getByRole('button', { name: 'Seam Fixture, starting again' }).waitFor({ timeout: 15_000 });
    await asserting(
      'progress',
      async () => decoy('<button data-decoy type="button">Retry</button>'),
      undecoy,
      async () => {
        assert.deepEqual(await railNames(), ['Seam Fixture Copy', 'Seam Fixture, starting again'], `${engine}: Retry shows the plugin starting again, with no Retry to press twice (the rail)`);
        assert.equal(await spinners(), 1, `${engine}: Retry shows the plugin starting again, with no Retry to press twice (the spinner)`);
        assert.equal(await retry.count(), 0, `${engine}: Retry shows the plugin starting again, with no Retry to press twice (no Retry)`);
      },
    );
    await shot('starting-again');
    await page.getByRole('button', { name: 'Seam Fixture, timed out' }).waitFor({ timeout: 60_000 });
    const took = Date.now() - pressed;
    assert.ok(took < 45_000, `${engine}: the load of a process that says nothing ended within the loader's own start timeout of 15 s (it ended after ${String(took)} ms)`);
    let silent;
    let place = -1;
    await asserting(
      'told-timeout',
      async () => {
        place = frames.findIndex((frame, index) => index >= third && frame.name === 'plugin/unloaded' && frame.data?.cause === 'timeout');
        [silent] = frames.splice(place, 1);
      },
      async () => {
        frames.splice(place, 0, silent);
      },
      async () => {
        assert.deepEqual(causes(third), ['reloaded', 'timeout'], `${engine}: the host said the load ran out of time, in the code and no text`);
      },
    );
    await asserting(
      'timeout-ends',
      async () => decoy('<div data-decoy role="status" aria-busy="true"></div>'),
      undecoy,
      async () => {
        assert.deepEqual(await railNames(), ['Seam Fixture Copy', 'Seam Fixture, timed out'], `${engine}: the plugin that did not answer ends as timed out and not as a spinner (the rail)`);
        assert.equal(await entries.nth(1).getAttribute('data-ov-tip'), `Seam Fixture, timed out\n${TOOK_TOO_LONG}`, `${engine}: the plugin that did not answer ends as timed out and not as a spinner (the tip)`);
        assert.match(await page.getByRole('alert').innerText(), new RegExp(escaped(TOOK_TOO_LONG)), `${engine}: the plugin that did not answer ends as timed out and not as a spinner (the sentence)`);
        assert.equal(await retry.count(), 1, `${engine}: the plugin that did not answer ends as timed out and not as a spinner (the Retry)`);
        assert.equal(await spinners(), 0, `${engine}: the plugin that did not answer ends as timed out and not as a spinner (no spinner)`);
      },
    );

    await shot('timed-out');
    // The start is let through: Retry runs the plugin, the host says it runs, and the window shows one of everything again with no reload.
    await rm(mode);
    const fourth = frames.length;
    await retry.click();
    await page.getByRole('button', { name: 'Seam Fixture', exact: true }).waitFor({ timeout: 30_000 });
    await itemHeading.waitFor({ timeout: 30_000 });
    await details.waitFor({ timeout: 15_000 });
    assert.ok(ran(fourth), `${engine}: the host said the plugin runs (plugin/state_change)`);
    assert.deepEqual(causes(fourth), ['reloaded'], `${engine}: and said nothing more of a load failing`);
    await asserting(
      'rail-back',
      async () => relabel(0, 'Seam Fixture, did not start'),
      async () => relabel(0, 'Seam Fixture'),
      async () => {
        assert.deepEqual(await railNames(), ['Seam Fixture', 'Seam Fixture Copy'], `${engine}: the rail names the plugin that runs again, with no word of its failure`);
      },
    );
    await asserting(
      'one-of-all',
      async () => {
        await streams.evaluate((tab) => {
          const twin = tab.cloneNode(true);
          twin.setAttribute('data-decoy', '');
          tab.parentElement?.append(twin);
        });
      },
      undecoy,
      async () => {
        assert.deepEqual(await pageTabs(), ['orders-api · Item'], `${engine}: after the retry that runs: one page, one sidebar entry, one tool (the tab)`);
        assert.equal(await itemHeading.count(), 1, `${engine}: after the retry that runs: one page, one sidebar entry, one tool (the page)`);
        assert.equal(await sidebar.count(), 1, `${engine}: after the retry that runs: one page, one sidebar entry, one tool (the sidebar)`);
        assert.equal(await streams.count(), 1, `${engine}: after the retry that runs: one page, one sidebar entry, one tool (the tool)`);
        assert.equal(await copyStreams.count(), 1, `${engine}: and the other plugin's tool is as it was`);
      },
    );
    assert.equal(await spinners(), 0, `${engine}: and nothing is loading`);
    await shot('recovered');

    // The same process on another plugin protocol: the manifest says it, the SDK serves it, and the host refuses it by the number the handshake negotiated (S4). Asking again cannot help, so there is no Retry; the page says why.
    const manifestFile = path.join(stateRoot(dir), 'plugins', OK, 'plugin.yaml');
    const manifestOf = await readFile(manifestFile, 'utf8');
    await writeFile(manifestFile, `${manifestOf}sdk_protocol_version: 2\n`);
    const fifth = frames.length;
    const refusing = tryBound(host.base, PLUGIN_SERVICE, 'ReloadPlugin', OK);
    await page.getByRole('button', { name: 'Seam Fixture, update required' }).waitFor({ timeout: 30_000 });
    const refusal = await refusing;
    assert.notEqual(refusal.status, 200, `${engine}: the host answered the reload of a plugin that speaks another protocol with an error`);
    assert.match(refusal.text, /different version of Omniview/, `${engine}: and the error says the host's sentence`);
    assert.doesNotMatch(refusal.text, /Client versions|incompatible API version/, `${engine}: and none of go-plugin's own words`);
    const REFUSED_SAYS = 'This plugin was built for a different version of Omniview. It uses plugin protocol 2; this Omniview accepts protocol 1.';
    const refused = 'a plugin the host refused for its protocol says why, with the two versions and no Retry';
    await page.getByRole('alert').waitFor();
    await asserting(
      'incompatible',
      async () => decoy('<button data-decoy type="button">Retry</button>'),
      undecoy,
      async () => {
        assert.deepEqual(causes(fifth), ['reloaded', 'incompatible'], `${engine}: ${refused} (what the host said: the reload, then the refusal)`);
        const said = told(fifth).find((data) => data.cause === 'incompatible');
        assert.deepEqual(Object.keys(said).sort(), ['cause', 'incompatibility', 'pluginID'], `${engine}: ${refused} (the event carries the id, the cause and the facts, no other member)`);
        assert.deepEqual(said.incompatibility, { pluginProtocol: 2, accepted: { oldest: 1, newest: 1 } }, `${engine}: ${refused} (the two numbers, and no text)`);
        assert.deepEqual(await railNames(), ['Seam Fixture Copy', 'Seam Fixture, update required'], `${engine}: ${refused} (the rail)`);
        assert.equal(await entries.nth(1).getAttribute('data-ov-tip'), `Seam Fixture, update required\n${REFUSED_SAYS}`, `${engine}: ${refused} (the tip)`);
        assert.deepEqual(await pageTabs(), ['Seam Fixture'], `${engine}: ${refused} (the tab keeps its route under the plugin's name)`);
        assert.match(await page.getByRole('alert').innerText(), new RegExp(`Couldn't load Seam Fixture[\\s\\S]*${escaped(REFUSED_SAYS)}`), `${engine}: ${refused} (the sentence and the versions)`);
        assert.equal(await retry.count(), 0, `${engine}: ${refused} (the Retry)`);
        assert.equal(await itemHeading.count(), 0, `${engine}: ${refused} (no page)`);
        assert.equal(await spinners(), 0, `${engine}: ${refused} (no spinner)`);
      },
    );
    assert.equal((await streams.count()) + (await copyStreams.count()) * 10, 10, `${engine}: its tool left the panel and the other plugin's stayed`);
    await shot('incompatible');
    // The host holds the plugin as Failed, with the same two numbers: what a window that was not open reads.
    const held = await callBound(host.base, PLUGIN_SERVICE, 'GetPlugin', OK);
    assert.equal(held.phase, 'Failed', `${engine}: the host lists the plugin that speaks another protocol as Failed`);
    assert.deepEqual(held.incompatible, { pluginProtocol: 2, accepted: { oldest: 1, newest: 1 } }, `${engine}: with the two numbers it decided on, in the inventory`);
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('button', { name: 'Seam Fixture, update required' }).waitFor({ timeout: 30_000 });
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), new RegExp(escaped(REFUSED_SAYS)), `${engine}: a window that opens while the plugin is refused shows the sentence and the versions from the first (the sentence)`);
    assert.equal(await retry.count(), 0, `${engine}: a window that opens while the plugin is refused shows the sentence and the versions from the first (no Retry)`);
    assert.equal(await spinners(), 0, `${engine}: a window that opens while the plugin is refused shows the sentence and the versions from the first (no spinner)`);
    // The manifest put back, the host reloads the plugin and it runs: the window shows one of everything again, with no reload.
    await writeFile(manifestFile, manifestOf);
    const sixth = frames.length;
    assert.equal((await tryBound(host.base, PLUGIN_SERVICE, 'ReloadPlugin', OK)).status, 200, `${engine}: the host reloaded the plugin on the protocol it runs`);
    await page.getByRole('button', { name: 'Seam Fixture', exact: true }).waitFor({ timeout: 30_000 });
    await details.waitFor({ timeout: 30_000 });
    assert.ok(ran(sixth), `${engine}: the host said the plugin runs again (plugin/state_change)`);
    assert.deepEqual(causes(sixth), ['reloaded'], `${engine}: and said nothing more of a refusal`);
    assert.equal(await retry.count(), 0, `${engine}: and nothing is offered to retry`);
    // A reload of the page cuts the calls that are in flight, which an engine reports as a page error ("Load failed", "due to access control checks", "Failed to fetch"): they are the page's going away, not the plugin's (scenario i does the same).
    const cut = /access control checks|Load failed|Failed to fetch|NetworkError|network connection was lost/i;
    assert.deepEqual(errors.filter((message) => !cut.test(message)), [], `${engine}: the load failing, the retries and the plugin coming back wrote no page error`);
    console.log(`${engine}: the load failed and the window was told ${JSON.stringify(causes(first, ))}; it took ${String(took)} ms to end as timed out; the plugin runs again after ${String(frames.slice(fourth).filter((frame) => frame.name === 'plugin/state_change').length)} state changes`);
    verdict(engine);
  } finally {
    await page.close();
    host.child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8000))]);
  }
}

/**
 * What the Plugins page DID, as a window sees it, kept from the first script of every document (a read-only observer, as `WATCH_NOTICES` is): a state that lasts a frame is a state that was drawn, and the check, which polls, would
 * miss it. `rows` has one entry for each change of a row of the list (its plugin's id, the state the page says, the chip's word and whether it is busy), `rail` one for each change of the names the rail lists, and `head`
 * one for each change of the header of the detail (the plugin it is of, the progress it shows and the chip of its state).
 */
const WATCH_PLUGINS = `(() => {
  window.__plSeen = { rows: [], rail: [], head: [] };
  const last = { rows: new Map(), rail: '', head: '' };
  const note = () => {
    const at = performance.now();
    const present = new Set();
    for (const row of document.querySelectorAll('[data-pl-part="row"]')) {
      const id = row.getAttribute('data-pl-id') ?? '';
      present.add(id);
      const seen = { id, state: row.getAttribute('data-pl-state') ?? '', chip: row.querySelector('[data-pl-part="row-chip"]')?.textContent ?? '', busy: row.getAttribute('aria-busy') === 'true' };
      const key = JSON.stringify(seen);
      if (last.rows.get(id) !== key) {
        last.rows.set(id, key);
        window.__plSeen.rows.push({ at, ...seen });
      }
    }
    for (const [id, key] of last.rows) {
      if (!present.has(id) && key !== 'gone') {
        last.rows.set(id, 'gone');
        window.__plSeen.rows.push({ at, id, gone: true });
      }
    }
    const rail = JSON.stringify([...document.querySelectorAll('[data-shell-part="rail"] button')].map((button) => button.getAttribute('aria-label')));
    if (rail !== last.rail) {
      last.rail = rail;
      window.__plSeen.rail.push({ at, names: JSON.parse(rail) });
    }
    const detail = document.querySelector('[data-pl-part="detail"]');
    const head = JSON.stringify({ name: detail?.getAttribute('aria-label') ?? '', progress: detail?.querySelector('[data-pl-part="head-progress"]')?.textContent ?? '', chip: detail?.querySelector('[data-pl-part="head-chip"]')?.textContent ?? '' });
    if (head !== last.head) {
      last.head = head;
      window.__plSeen.head.push({ at, ...JSON.parse(head) });
    }
  };
  new MutationObserver(note).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
})()`;

/** The id the host's bindings give a method (`$Call.ByID`): the 32-bit FNV-1a hash of its full name. A call the page makes carries that and not the name, so a check that counts or holds the page's calls says it the same way. */
function methodIdOf(service, method) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(`${service}.${method}`)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

/** The calls of the host's plugin service that the Plugins page makes, by the id its call carries: what it asks of the host. */
const PLUGIN_CALLS = new Map(['ReloadPlugin', 'RetryFailedPlugin', 'SetPluginEnabled', 'UninstallPlugin'].map((method) => [methodIdOf(PLUGIN_SERVICE, method), method]));

/**
 * Holds the next call `target` makes of `method` of the host's plugin service, so that what the page shows while a call is open is a state that lasts and can be read (the host answers in tens of milliseconds). `before`: the call waits on its way
 * to the host, which has done nothing, so the page can say only that its work is going on. `after`: the host has done it and its answer waits, so the host's events have been told and the page must have followed them with its call still open.
 * `held()` says the call is held; `release()` lets it go on and gives the page back as it was.
 */
async function holdCall(target, method, when) {
  const methodID = methodIdOf(PLUGIN_SERVICE, method);
  const gate = Promise.withResolvers();
  const done = Promise.withResolvers();
  let held = false;
  let taken = false;
  const handler = async (route) => {
    if (taken || JSON.parse(route.request().postData() ?? 'null')?.args?.methodID !== methodID) {
      await route.continue();
      return;
    }

    taken = true;
    if (when === 'before') {
      held = true;
      await gate.promise;
      await route.continue();
    } else {
      const response = await route.fetch();
      held = true;
      await gate.promise;
      await route.fulfill({ response });
    }

    done.resolve();
  };
  await target.route('**/wails/runtime', handler);
  return {
    held: () => held,
    release: async () => {
      gate.resolve();
      await done.promise;
      await target.unroute('**/wails/runtime', handler);
    },
  };
}

/** `wanted` is in `list` in that order, with anything between. */
function inOrder(list, wanted) {
  let at = 0;
  for (const item of list) if (item === wanted[at]) at += 1;
  return at === wanted.length;
}

/**
 * t. The Plugins page (PL1) over the real host, on a host of its own whose fixture plugin `OK` has a PROCESS (the Go program of `fixture/process`, as in n and p) and whose copy `DUP` has none: `OK` is the one that is killed, and `DUP` is the one that is
 * turned off, turned on and uninstalled. The page is opened as a person opens it, from the palette's command; a second page, which is a second window in server mode, opens it too and stays open and is never reloaded. What the list says is the
 * host's inventory, and what each action came to is what the host's EVENTS said (the frames of the window's event socket are read, and the page's own calls are held on their way to the host or on their way back, so that what it shows while
 * a call is open can be read): never what the page hoped. Every negative control of this scenario is made here, in turn, when SEAM_CONTROL asks (`withControls`; PAGE_CONTROLS).
 */
async function checkPluginsPage(browser, engine, binary, work) {
  const dir = await mkdtemp(path.join(work, `plugins-page-${engine}-`));
  const host = await startHost(dir, await freePort(), undefined, async (plugins) => [await writePlugin(plugins, OK, binary), await writePlugin(plugins, DUP)]);
  const exited = new Promise((resolve) => host.child.once('exit', resolve));
  const { asserting, verdict } = withControls(PAGE_GROUP, PAGE_CONTROLS);
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const second = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const target of [page, second]) {
    target.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await target.addInitScript(WATCH_PLUGINS);
  }

  /** What the host tells a window: every `plugin/*` event that reaches its event socket, as the host sent it. */
  const hear = (target) => {
    const heard = [];
    target.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        try {
          const message = JSON.parse(String(payload));
          if (typeof message?.name === 'string' && message.name.startsWith('plugin/')) heard.push({ name: message.name, data: message.data });
        } catch {
          // not an event
        }
      });
    });
    return heard;
  };
  const frames = hear(page);
  const framesSecond = hear(second);
  // What the first page asks of the host (its calls of the plugin service, by name and with their arguments, in the order it asks) and what the host answers when it refuses one.
  const calls = [];
  const refused = [];
  page.on('request', (request) => {
    if (!request.url().endsWith('/wails/runtime')) return;
    try {
      const { args } = JSON.parse(request.postData() ?? 'null') ?? {};
      const method = PLUGIN_CALLS.get(args?.methodID);
      if (method !== undefined) calls.push([method, ...args.args]);
    } catch {
      // not a call
    }
  });
  page.on('response', async (response) => {
    if (response.url().endsWith('/wails/runtime') && response.status() >= 400) refused.push(await response.text().catch(() => ''));
  });

  const CRASHED = "The plugin process stopped unexpectedly, so its pages can't load data.";
  const COULD_NOT_START = "The plugin could not start, so its pages can't load data.";
  const binaryPath = path.join(stateRoot(dir), 'plugins', OK, 'bin', 'plugin');
  const layer = page.locator('[data-notices-part="layer"]');
  const progress = page.locator('[data-pl-part="head-progress"]');
  /** SEAM_SHOTS=<dir> writes WebKit's pictures of the states (theme void, 1440 x 900). */
  const shot = async (name) => {
    if (!process.env.SEAM_SHOTS || engine !== 'webkit') return;
    await page.mouse.move(2, 2);
    await mkdir(process.env.SEAM_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SEAM_SHOTS, `plugins-page-${name}-webkit-void-1440x900.png`) });
  };
  /** Opens the page as a person does: the palette's chord, the word Plugins, and Enter on the command that says it. The tab it opens is the singleton `host:plugins`; no hash names it. */
  const openPlugins = async (target) => {
    await open(target, host.base);
    await target.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
    const palette = target.getByRole('dialog', { name: 'Search' });
    await target.keyboard.press(`${(await target.evaluate(() => navigator.platform.includes('Mac'))) ? 'Meta' : 'Control'}+KeyK`);
    await palette.waitFor();
    await target.keyboard.type('Plugins', { delay: 20 });
    const command = palette.getByRole('option', { name: 'Command: Plugins, Window' });
    await command.waitFor();
    assert.equal(await command.getAttribute('aria-selected'), 'true', `${engine}: the command Plugins is the active row of the palette`);
    await target.keyboard.press('Enter');
    await palette.waitFor({ state: 'detached' });
    await target.getByRole('tab', { name: 'Plugins', exact: true }).waitFor({ timeout: 15_000 });
    await target.getByRole('region', { name: 'Installed plugins' }).waitFor({ timeout: 15_000 });
    await target.locator('[data-pl-part="row"]').first().waitFor({ timeout: 15_000 });
  };
  const row = (target, id) => target.locator(`[data-pl-part="row"][data-pl-id="${id}"]`);
  /** The row of a plugin once it says `state`: the page says it from the host's events, so the check waits for it and never for a time. */
  const saying = (target, id, state) => row(target, id).and(target.locator(`[data-pl-state="${state}"]`));
  const rail = (target, name) => target.locator(`[data-shell-part="rail"] button[aria-label="${name}"]`);
  const rowsOf = async (target) =>
    target.locator('[data-pl-part="row"]').evaluateAll((rows) =>
      rows.map((element) => ({
        id: element.getAttribute('data-pl-id'),
        name: element.querySelector('[data-pl-part="row-name"]')?.textContent ?? '',
        version: element.querySelector('[data-pl-part="row-version"]')?.textContent ?? '',
        state: element.getAttribute('data-pl-state'),
        chip: element.querySelector('[data-pl-part="row-chip"]')?.textContent ?? '',
        sentence: element.querySelector('[data-pl-part="row-sentence"]')?.textContent ?? '',
        busy: element.getAttribute('aria-busy') === 'true',
        selected: element.getAttribute('aria-current') === 'true',
      })),
    );
  const railOf = async (target) => target.locator('[data-shell-part="rail"] button').evaluateAll((buttons) => buttons.map((button) => ({ name: button.getAttribute('aria-label'), tip: button.getAttribute('data-ov-tip') })));
  /** What the rail should list for the plugins the rows show, in the rail's own order: the plugins that run, in the order each declares (the fixture's two), then the ones that stopped, by name, with the row's word for them in lower case. A plugin that is turned off has no entry. */
  const railFor = (rows) => {
    const fixtures = [OK, DUP].map((id) => rows.find((entry) => entry.id === id)).filter((entry) => entry !== undefined);
    return [
      ...fixtures.filter((entry) => entry.state === 'running').map((entry) => entry.name),
      ...fixtures.filter((entry) => entry.state === 'failed' || entry.state === 'starting').map((entry) => `${entry.name}, ${entry.chip.toLowerCase()}`).sort(),
    ];
  };
  const lane = async (target) => (await target.locator('[data-pl-part="lane"]').innerText()).replace(/\s+/g, ' ').trim();
  const marks = async (target) => target.evaluate(() => ({ rows: window.__plSeen.rows.length, rail: window.__plSeen.rail.length, head: window.__plSeen.head.length }));
  const seenSince = async (target, from) => target.evaluate((start) => ({ rows: window.__plSeen.rows.slice(start.rows), rail: window.__plSeen.rail.slice(start.rail), head: window.__plSeen.head.slice(start.head) }), from);
  /** What the host told this window of one plugin, from the frame `from` on. */
  const toldOf = (heard, id, from = 0) => heard.slice(from).filter((frame) => frame.data?.pluginID === id);
  const causesOf = (heard, id, from = 0) => toldOf(heard, id, from).filter((frame) => frame.name === 'plugin/unloaded').map((frame) => frame.data.cause);
  const ranAgain = (heard, id, from = 0) => toldOf(heard, id, from).some((frame) => frame.name === 'plugin/state_change' && frame.data.to === 'Running');
  const decoy = async (target, html) => target.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), html);
  const undecoy = async (target) => target.evaluate(() => document.querySelectorAll('[data-decoy]').forEach((element) => element.remove()));
  /** A row of the uninstalled plugin that is still drawn: a twin of another row under the removed plugin's id. */
  const stale = async (target) =>
    row(target, OK).evaluate((element, id) => {
      const twin = element.cloneNode(true);
      twin.setAttribute('data-pl-id', id);
      twin.setAttribute('data-decoy', '');
      element.parentElement?.append(twin);
    }, DUP);
  /** The words of the host that the page must never draw: the free text its events carry (the crash's error and the reasons of a state change), what it answered when it refused a call (the title and the detail of its error, with paths in them), and the words of the operating system. */
  const rawTexts = () => {
    const found = ['not executable', 'permission denied', 'fork/exec', 'exit status', 'signal: killed', 'plugin process exited', 'max crash recovery', 'failed validation', path.basename(dir)];
    for (const frame of frames) for (const text of [frame.data?.error, frame.data?.reason]) if (typeof text === 'string' && text.length >= 12) found.push(text);
    for (const body of refused) {
      try {
        const inner = JSON.parse(JSON.parse(body).message);
        for (const text of [inner.title, inner.detail]) if (typeof text === 'string' && text !== '') found.push(text);
      } catch {
        // the answer is not an error of the host's own kind
      }
    }

    return found;
  };
  /** The raw texts that the window draws: in its words, its attributes (the rail's tip) and its notices. */
  const rawIn = async (target) => {
    const drawn = await target.evaluate(() => `${document.body.innerText}\n${document.body.textContent}\n${document.documentElement.outerHTML}`);
    return rawTexts().filter((text) => drawn.includes(text));
  };
  const plain = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  /** The order of the list: by name as plain text, then by id (the host's own order is a map's, and a machine's locale moves nothing). */
  const byName = (a, b) => plain(a.metadata.name.toLowerCase(), b.metadata.name.toLowerCase()) || plain(a.metadata.name, b.metadata.name) || plain(a.id, b.id);
  /** The primary action of the header (Retry, Enable, Start) by its name. */
  const primary = (name) => page.locator('[data-pl-part="slot-primary"]').getByRole('button', { name, exact: true });
  const gone = async () => page.waitForFunction(() => document.querySelector('[data-pl-part="head-progress"]') === null);
  try {
    await forgetSession(host.base);
    await openPlugins(page);
    assert.deepEqual(await page.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => tab.textContent)), ['Plugins'], `${engine}: the command opened one tab, the page's`);
    // The second window opens on a window with nothing saved, as the first did: what the first saved is forgotten, so that it opens the page itself, from the palette. It is never reloaded: the marker is how the check knows.
    await forgetSession(host.base);
    await openPlugins(second);
    await second.evaluate(() => {
      window.__plSameDocument = true;
    });

    // 2. THE LIST is the host's inventory: the rows, their versions and their order, and the count the heading and the footer say, in both windows.
    const inventory = await callBound(host.base, PLUGIN_SERVICE, 'ListPlugins');
    const builtins = inventory.filter((entry) => entry.origin === 'builtin');
    assert.ok(builtins.length > 0 && builtins.every((entry) => entry.phase === 'Installed' && entry.enabled), `${engine}: the host holds its own plugins, which no window has started: ${JSON.stringify(builtins.map((entry) => [entry.id, entry.phase]))}`);
    assert.deepEqual(
      inventory.filter((entry) => entry.origin !== 'builtin').map((entry) => [entry.id, entry.phase, entry.enabled]).sort(),
      [[OK, 'Running', true], [DUP, 'Running', true]],
      `${engine}: and the two fixture plugins, which run`,
    );
    for (const [target, which] of [[page, 'first'], [second, 'second']]) {
      assert.deepEqual(
        (await rowsOf(target)).map((entry) => [entry.id, entry.state, entry.chip, entry.selected]),
        inventory.toSorted(byName).map((entry, index) => [entry.id, entry.origin === 'builtin' ? 'stopped' : 'running', entry.origin === 'builtin' ? 'Stopped' : '', index === 0]),
        `${engine}: the rows say what the host's phases mean (a plugin nobody started is Stopped, one that runs says nothing) and the first is the one shown (${which} window)`,
      );
      assert.equal(await target.locator('[data-shell-part="rail"] [aria-current="true"]').count(), 0, `${engine}: no entry of the rail is current on the Plugins page, which is no plugin's (${which} window)`);
    }

    let dropped;
    await asserting(
      'list-inventory',
      async () => {
        dropped = inventory.pop();
      },
      async () => {
        inventory.push(dropped);
      },
      async () => {
        const expected = inventory.toSorted(byName).map((entry) => ({ id: entry.id, name: entry.metadata.name, version: entry.metadata.version }));
        for (const [target, which] of [[page, 'first'], [second, 'second']]) {
          assert.deepEqual((await rowsOf(target)).map(({ id, name, version }) => ({ id, name, version })), expected, `${engine}: the list is the host's inventory: its rows, their versions and their order (${which} window)`);
          assert.equal(await target.locator('[data-pl-part="list-head"]').textContent(), `Installed${String(expected.length)}`, `${engine}: the list is the host's inventory: the count in its heading (${which} window)`);
          assert.equal(await target.locator('[data-pl-part="list-foot"]').textContent(), `${String(expected.length)} plugins`, `${engine}: the list is the host's inventory: the count in its footer (${which} window)`);
        }
      },
    );
    await row(page, OK).click();
    await page.getByRole('region', { name: 'Seam Fixture', exact: true }).waitFor();
    await shot('running');

    // 3. RELOAD, through the page. The call is held on its way to the host, which has done nothing yet: the page says that the work is going on and says nothing of its result. Then it is let through, and what the page shows is
    // what the host's events say, in the host's order.
    const waiting = await holdCall(page, 'ReloadPlugin', 'before');
    const reloadAt = frames.length;
    const reloadCalls = calls.length;
    const reloadSeen = await marks(page);
    const reloadSeenSecond = await marks(second);
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await waitUntil('the page to ask the host to reload the plugin', waiting.held, 15_000);
    const waits = 'while the call waits for the host the page says the work is going on and nothing of its result';
    assert.equal(await progress.innerText(), 'Reloading…', `${engine}: ${waits} (the header's progress)`);
    assert.equal(await row(page, OK).getAttribute('aria-busy'), 'true', `${engine}: ${waits} (the row is busy)`);
    assert.deepEqual((await rowsOf(page)).filter((entry) => entry.id === OK).map(({ state, chip }) => ({ state, chip })), [{ state: 'running', chip: '' }], `${engine}: ${waits} (the row says what the host last said)`);
    assert.deepEqual(toldOf(frames, OK, reloadAt), [], `${engine}: ${waits} (the host has told nothing)`);
    await waiting.release();
    await waitUntil('the host to say that the plugin runs again', () => ranAgain(frames, OK, reloadAt), 30_000);
    await Promise.all([rail(page, 'Seam Fixture').waitFor(), rail(second, 'Seam Fixture').waitFor(), gone()]);
    assert.deepEqual(calls.slice(reloadCalls), [['ReloadPlugin', OK]], `${engine}: the page asked the host for one thing, to reload the plugin`);

    let forged;
    let forgedAt = -1;
    await asserting(
      'reload-told',
      async () => {
        forgedAt = frames.findIndex((frame, index) => index >= reloadAt && frame.name === 'plugin/unloaded' && frame.data?.pluginID === OK);
        [forged] = frames.splice(forgedAt, 1);
      },
      async () => {
        frames.splice(forgedAt, 0, forged);
      },
      async () => {
        const told = toldOf(frames, OK, reloadAt);
        const order = "the window was told the reload in the host's order: the plugin stopped serving (unloaded: reloaded) and then ran again (state_change: Running)";
        assert.deepEqual(told.filter((frame) => frame.name === 'plugin/unloaded').map((frame) => frame.data), [{ pluginID: OK, cause: 'reloaded' }], `${engine}: ${order} (the cause, and no other member)`);
        assert.ok(told.findIndex((frame) => frame.name === 'plugin/unloaded') < told.findLastIndex((frame) => frame.name === 'plugin/state_change' && frame.data.to === 'Running'), `${engine}: ${order} (the order)`);
        assert.equal(told.at(-1)?.name === 'plugin/state_change' && told.at(-1)?.data.to === 'Running', true, `${engine}: ${order} (the last thing it was told)`);
      },
    );
    const reloaded = await seenSince(page, reloadSeen);
    let seenRows;
    await asserting(
      'reload-progress',
      async () => {
        seenRows = reloaded.rows;
        reloaded.rows = seenRows.filter((entry) => entry.chip !== 'Starting again');
      },
      async () => {
        reloaded.rows = seenRows;
      },
      async () => {
        const mine = reloaded.rows.filter((entry) => entry.id === OK);
        const shown = 'the row and the header show the reload in progress and then the plugin running';
        assert.ok(mine.some((entry) => entry.state === 'starting' && entry.chip === 'Starting again' && entry.busy), `${engine}: ${shown} (the row says Starting again while the call is open)`);
        assert.deepEqual([mine.at(-1)?.state, mine.at(-1)?.chip, mine.at(-1)?.busy], ['running', '', false], `${engine}: ${shown} (and ends running, with no word and no work)`);
        assert.ok(reloaded.head.some((entry) => entry.name === 'Seam Fixture' && entry.progress === 'Reloading…'), `${engine}: ${shown} (the header says Reloading)`);
        assert.deepEqual([reloaded.head.at(-1)?.progress, reloaded.head.at(-1)?.chip], ['', 'Running'], `${engine}: ${shown} (and the header ends with no progress and the chip Running)`);
      },
    );
    await asserting(
      'reload-state',
      async () => {
        await row(page, OK).locator('[data-pl-part="row-line2"]').evaluate((line) => line.insertAdjacentHTML('afterbegin', '<span data-pl-part="row-chip" data-decoy>Starting again</span>'));
      },
      async () => undecoy(page),
      async () => {
        const says = 'after the reload the row says the plugin runs, with no word of its state';
        const mine = (await rowsOf(page)).find((entry) => entry.id === OK);
        assert.deepEqual({ state: mine.state, chip: mine.chip, sentence: mine.sentence, busy: mine.busy }, { state: 'running', chip: '', sentence: '', busy: false }, `${engine}: ${says} (the row)`);
        assert.equal(await page.locator('[data-pl-part="head-chip"]').innerText(), 'Running', `${engine}: ${says} (the header's chip says Running: the header always says the state, the list says nothing of a plugin that runs)`);
        assert.equal(await lane(page), 'Seam Fixture is running The plugin is running. Its pages open as usual.', `${engine}: ${says} (the lane)`);
        assert.equal(await primary('Retry').count(), 0, `${engine}: ${says} (no Retry)`);
        assert.equal(await page.getByRole('button', { name: 'Reload', exact: true }).count(), 1, `${engine}: ${says} (Reload is there again)`);
      },
    );
    await asserting(
      'reload-rail',
      async () => {
        await rail(page, 'Seam Fixture').evaluate((button) => button.setAttribute('aria-label', 'Seam Fixture, starting again'));
      },
      async () => {
        await rail(page, 'Seam Fixture, starting again').evaluate((button) => button.setAttribute('aria-label', 'Seam Fixture'));
      },
      async () => {
        const agrees = 'after the reload the rail agrees with the row: the plugin is listed by its name alone, as a plugin that runs is';
        assert.deepEqual((await railOf(page)).map((entry) => entry.name), ['Seam Fixture', 'Seam Fixture Copy'], `${engine}: ${agrees} (the names)`);
        assert.deepEqual((await railOf(page)).map((entry) => entry.name), railFor(await rowsOf(page)), `${engine}: ${agrees} (the rows)`);
        assert.ok(reloaded.rail.some((entry) => entry.names.includes('Seam Fixture, starting again')), `${engine}: ${agrees} (it said Starting again while the row did)`);
        assert.deepEqual(reloaded.rail.at(-1)?.names, ['Seam Fixture', 'Seam Fixture Copy'], `${engine}: ${agrees} (and it ends listing the plugin by its name)`);
      },
    );
    // The second window was told the same, and followed with no reload of its page.
    assert.deepEqual(causesOf(framesSecond, OK, 0).slice(-1), ['reloaded'], `${engine}: the second window was told the reload too`);
    const reloadedSecond = await seenSince(second, reloadSeenSecond);
    assert.ok(inOrder(reloadedSecond.rows.filter((entry) => entry.id === OK).map((entry) => entry.state), ['starting', 'running']), `${engine}: the second window's row went through Starting again to running`);
    assert.deepEqual((await rowsOf(second)).find((entry) => entry.id === OK), { id: OK, name: 'Seam Fixture', version: '0.0.1', state: 'running', chip: '', sentence: '', busy: false, selected: false }, `${engine}: after the reload the second window's row says the plugin runs`);
    assert.deepEqual((await railOf(second)).map((entry) => entry.name), ['Seam Fixture', 'Seam Fixture Copy'], `${engine}: and its rail lists the plugin by its name alone`);
    assert.equal(await second.evaluate(() => window.__plSameDocument === true), true, `${engine}: and the second window was never reloaded`);

    // 4. DISABLE, then ENABLE, the copy. The host's answer to the disabling is held after the host did it: the row says Disabled from the host's events while the call is still open.
    await row(page, DUP).click();
    const off = await holdCall(page, 'SetPluginEnabled', 'after');
    const offAt = frames.length;
    const offCalls = calls.length;
    await page.getByRole('button', { name: 'More actions for Seam Fixture Copy', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Disable', exact: true }).click();
    await waitUntil('the host to have turned the plugin off', off.held, 15_000);
    await saying(page, DUP, 'disabled').waitFor();
    await saying(second, DUP, 'disabled').waitFor();
    await asserting(
      'disable-word',
      async () => {
        await row(page, DUP).evaluate((element) => element.setAttribute('data-pl-state', 'running'));
      },
      async () => {
        await row(page, DUP).evaluate((element) => element.setAttribute('data-pl-state', 'disabled'));
      },
      async () => {
        const says = 'Disable: the row says Disabled from the host\'s events while the call is still open';
        const mine = (await rowsOf(page)).find((entry) => entry.id === DUP);
        assert.deepEqual({ state: mine.state, chip: mine.chip, busy: mine.busy }, { state: 'disabled', chip: 'Disabled', busy: true }, `${engine}: ${says} (the row)`);
        assert.equal(await progress.innerText(), 'Disabling…', `${engine}: ${says} (the header still shows the work)`);
        assert.equal(await page.locator('[data-pl-part="head-chip"]').innerText(), 'Disabled', `${engine}: ${says} (the header's chip)`);
        assert.equal(await lane(page), 'Seam Fixture Copy is disabled Enable it to open its pages.', `${engine}: ${says} (the lane)`);
        assert.deepEqual((await railOf(page)).map((entry) => entry.name), ['Seam Fixture'], `${engine}: ${says} (the rail's entry left)`);
        assert.deepEqual(toldOf(frames, DUP, offAt).filter((frame) => frame.name !== 'plugin/state_change').map((frame) => [frame.name, frame.data]), [['plugin/enablement_changed', { pluginID: DUP, enabled: false }], ['plugin/unloaded', { pluginID: DUP, cause: 'disabled' }]], `${engine}: ${says} (the host's events)`);
        assert.deepEqual((await rowsOf(second)).find((entry) => entry.id === DUP)?.chip, 'Disabled', `${engine}: ${says} (the second window)`);
        assert.deepEqual((await railOf(second)).map((entry) => entry.name), ['Seam Fixture'], `${engine}: ${says} (the second window's rail)`);
      },
    );
    await off.release();
    await gone();
    assert.deepEqual(calls.slice(offCalls), [['SetPluginEnabled', DUP, false]], `${engine}: the page asked the host for one thing, to turn the plugin off`);
    assert.equal((await callBound(host.base, PLUGIN_SERVICE, 'ListPlugins')).find((entry) => entry.id === DUP)?.enabled, false, `${engine}: and the host says the plugin is turned off`);
    assert.equal(await row(page, DUP).getAttribute('aria-busy'), null, `${engine}: the call ended and the row is still Disabled, not busy`);
    await shot('disabled');

    // ENABLE is two calls (the host's `SetPluginEnabled(true)` only persists the choice): the second is held, so the half-way state, the plugin on and not started, is on screen to be read.
    const middle = await holdCall(page, 'ReloadPlugin', 'before');
    const onAt = frames.length;
    const onCalls = calls.length;
    const onSeen = await marks(page);
    await primary('Enable').click();
    await waitUntil('the page to ask the host to start the plugin it turned on', middle.held, 15_000);
    await Promise.all([rail(page, 'Seam Fixture Copy').waitFor(), rail(second, 'Seam Fixture Copy').waitFor()]);
    const half = 'the first call of Enable is done: the host says the plugin is on and does not run, and the row says Stopped, with the work still going on';
    assert.deepEqual((await rowsOf(page)).filter((entry) => entry.id === DUP).map(({ state, chip, busy }) => ({ state, chip, busy })), [{ state: 'stopped', chip: 'Stopped', busy: true }], `${engine}: ${half} (the row)`);
    assert.equal(await progress.innerText(), 'Enabling…', `${engine}: ${half} (the header)`);
    const record = await callBound(host.base, PLUGIN_SERVICE, 'GetPlugin', DUP);
    assert.deepEqual([record.enabled, record.phase], [true, 'Installed'], `${engine}: ${half} (the host's record)`);
    await middle.release();
    await Promise.all([saying(page, DUP, 'running').waitFor({ timeout: 30_000 }), saying(second, DUP, 'running').waitFor({ timeout: 30_000 }), rail(page, 'Seam Fixture Copy').waitFor(), gone()]);
    const enabled = await seenSince(page, onSeen);
    let seenOn;
    await asserting(
      'enable-runs',
      async () => {
        seenOn = enabled.rows;
        enabled.rows = seenOn.filter((entry) => entry.state !== 'starting');
      },
      async () => {
        enabled.rows = seenOn;
      },
      async () => {
        const runs = 'Enable: the row goes from Disabled through Stopped and Starting to running, and the host says so in its own order';
        assert.ok(inOrder(enabled.rows.filter((entry) => entry.id === DUP).map((entry) => entry.state), ['disabled', 'stopped', 'starting', 'running']), `${engine}: ${runs} (the row)`);
        assert.ok(inOrder(enabled.head.map((entry) => entry.progress), ['Enabling…', '']), `${engine}: ${runs} (the header's progress, to its end)`);
        const told = toldOf(frames, DUP, onAt).map((frame) => (frame.name === 'plugin/enablement_changed' ? `enabled:${String(frame.data.enabled)}` : frame.name === 'plugin/unloaded' ? `unloaded:${frame.data.cause}` : `phase:${frame.data.to}`));
        assert.ok(inOrder(told, ['enabled:true', 'unloaded:reloaded', 'phase:Running']), `${engine}: ${runs} (the host's events: ${JSON.stringify(told)})`);
      },
    );
    assert.deepEqual(calls.slice(onCalls), [['SetPluginEnabled', DUP, true], ['ReloadPlugin', DUP]], `${engine}: Enable is two calls of the host: turn it on, then start it`);
    assert.deepEqual((await railOf(page)).map((entry) => entry.name), railFor(await rowsOf(page)), `${engine}: after Enable the rail lists the plugin again, as its row says`);
    assert.deepEqual((await railOf(second)).map((entry) => entry.name), ['Seam Fixture', 'Seam Fixture Copy'], `${engine}: and so does the second window's`);

    // The same two calls on the plugin with a process, whose binary cannot start (it has lost its execute bit): the first call succeeds and the second fails. The plugin is ON and does NOT run, and the row says exactly that.
    await row(page, OK).click();
    await page.getByRole('button', { name: 'More actions for Seam Fixture', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Disable', exact: true }).click();
    await saying(page, OK, 'disabled').waitFor();
    await gone();
    await chmod(binaryPath, 0o644);
    const failing = await holdCall(page, 'ReloadPlugin', 'before');
    const halfAt = frames.length;
    const halfCalls = calls.length;
    await primary('Enable').click();
    await waitUntil('the page to ask the host to start the plugin it turned on', failing.held, 15_000);
    // Both windows have the plugin's interface by now (the inventory is read again when the host says a plugin was turned on), so each is told what follows in the same state.
    await Promise.all([rail(page, 'Seam Fixture').waitFor(), rail(second, 'Seam Fixture').waitFor()]);
    await failing.release();
    const notice = layer.getByRole('alert', { name: "Error: Couldn't enable Seam Fixture" });
    await notice.waitFor({ timeout: 30_000 });
    await Promise.all([saying(page, OK, 'failed').waitFor(), saying(second, OK, 'failed').waitFor({ timeout: 15_000 }), gone()]);
    assert.deepEqual(calls.slice(halfCalls), [['SetPluginEnabled', OK, true], ['ReloadPlugin', OK]], `${engine}: Enable asked the host twice, as it always does`);
    const hostSays = await callBound(host.base, PLUGIN_SERVICE, 'GetPlugin', OK);
    assert.deepEqual([hostSays.enabled, hostSays.phase], [true, 'Failed'], `${engine}: the host says the plugin is turned on and failed to start`);
    assert.equal(toldOf(frames, OK, halfAt).some((frame) => frame.name === 'plugin/state_change' && frame.data.to === 'Running'), false, `${engine}: and it did not run`);
    assert.equal(causesOf(frames, OK, halfAt).at(-1), 'failed', `${engine}: the host told the window that the load failed`);
    await shot('did-not-start');
    await asserting(
      'enable-half',
      async () => {
        await row(page, OK).evaluate((element) => element.setAttribute('data-pl-state', 'disabled'));
      },
      async () => {
        await row(page, OK).evaluate((element) => element.setAttribute('data-pl-state', 'failed'));
      },
      async () => {
        const says = 'an Enable that could not start the plugin: the row says it is on and did not start, in the host\'s words, and offers Retry';
        for (const [target, which] of [[page, 'first'], [second, 'second']]) {
          const mine = (await rowsOf(target)).find((entry) => entry.id === OK);
          assert.deepEqual({ state: mine.state, chip: mine.chip, sentence: mine.sentence, busy: mine.busy }, { state: 'failed', chip: 'Did not start', sentence: COULD_NOT_START, busy: false }, `${engine}: ${says} (the row, ${which} window)`);
        }

        assert.equal(await page.locator('[data-pl-part="head-chip"]').innerText(), 'Did not start', `${engine}: ${says} (the header's chip)`);
        assert.equal(await lane(page), `Seam Fixture didn't start ${COULD_NOT_START}`, `${engine}: ${says} (the lane)`);
        assert.equal(await primary('Retry').count(), 1, `${engine}: ${says} (the Retry)`);
        await page.getByRole('button', { name: 'More actions for Seam Fixture', exact: true }).click();
        assert.deepEqual(await page.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.textContent)), ['Disable', 'Uninstall…'], `${engine}: ${says} (the menu offers Disable: the plugin is on)`);
        await page.keyboard.press('Escape');
        assert.deepEqual((await railOf(page)).map((entry) => entry.name), ['Seam Fixture Copy', 'Seam Fixture, did not start'], `${engine}: ${says} (the rail, first window)`);
        assert.equal((await railOf(page))[1].tip, `Seam Fixture, did not start\n${COULD_NOT_START}`, `${engine}: ${says} (the rail's tip)`);
        assert.deepEqual((await railOf(second)).map((entry) => entry.name), ['Seam Fixture Copy', 'Seam Fixture, did not start'], `${engine}: ${says} (the rail, second window)`);
      },
    );
    await asserting(
      'enable-notice',
      async () => {
        await page.evaluate(() => document.querySelector('[data-notices-part="toast"]')?.removeAttribute('data-sticky'));
      },
      async () => {
        await page.evaluate(() => document.querySelector('[data-notices-part="toast"]')?.setAttribute('data-sticky', ''));
      },
      async () => {
        const says = 'an Enable that could not start the plugin: a sticky notice of the host, worded by the class of the error, with a Retry';
        assert.equal(await layer.locator('[data-notices-part="toast"]').count(), 1, `${engine}: ${says} (one notice)`);
        assert.equal(await notice.getAttribute('data-severity'), 'error', `${engine}: ${says} (an error)`);
        assert.notEqual(await notice.getAttribute('data-sticky'), null, `${engine}: ${says} (sticky)`);
        assert.equal((await notice.innerText()).replace(/\s+/g, ' ').trim(), "Error: Couldn't enable Seam Fixture The host couldn't stop it or start it. Retry", `${engine}: ${says} (its words)`);
        assert.equal(await notice.getByRole('button', { name: 'Retry', exact: true }).count(), 1, `${engine}: ${says} (the Retry)`);
      },
    );
    assert.match(refused.join('\n'), /not executable/, `${engine}: the host's own answer to the second call holds the raw reason that the page must not draw`);
    await asserting(
      'raw-text',
      async () => decoy(page, '<p data-decoy>resource plugin binary is not executable</p>'),
      async () => undecoy(page),
      async () => {
        assert.deepEqual(await rawIn(page), [], `${engine}: nothing the page draws holds the host's own words for an error (the first window)`);
        assert.deepEqual(await rawIn(second), [], `${engine}: nothing the page draws holds the host's own words for an error (the second window)`);
      },
    );

    // The binary is back, and the Retry of the notice starts the plugin: it is on already, so it does not turn it on again.
    await chmod(binaryPath, 0o755);
    const retryAt = frames.length;
    const retryCalls = calls.length;
    await notice.getByRole('button', { name: 'Retry', exact: true }).click();
    await Promise.all([saying(page, OK, 'running').waitFor({ timeout: 30_000 }), saying(second, OK, 'running').waitFor({ timeout: 30_000 })]);
    await Promise.all([rail(page, 'Seam Fixture').waitFor(), rail(second, 'Seam Fixture').waitFor(), gone()]);
    assert.equal(calls.slice(retryCalls).some(([method]) => method === 'SetPluginEnabled'), false, `${engine}: the Retry of the notice did not turn the plugin on again`);
    assert.equal(calls.slice(retryCalls).filter(([method]) => method === 'RetryFailedPlugin' || method === 'ReloadPlugin').length, 1, `${engine}: it asked the host once to start it`);
    assert.equal(ranAgain(frames, OK, retryAt), true, `${engine}: and the host said the plugin runs`);
    assert.equal(await layer.locator('[data-notices-part="toast"]').count(), 0, `${engine}: the notice is gone`);
    assert.deepEqual((await railOf(page)).map((entry) => entry.name), railFor(await rowsOf(page)), `${engine}: and the rail agrees with the row`);

    // 5. KILL BY PID. The process is the host's to name: it reports each plugin's pid with the executable behind it, and the check kills what the host reported and nothing it found by a name. With its execute bit off the host's recovery
    // cannot start the plugin again, which is what makes the state under test hold still.
    const owned = (await callBound(host.base, PROCESS_SERVICE, 'GetSnapshot')).processes.find((candidate) => candidate.key === `plugin:${OK}`);
    assert.ok(owned?.ownership === 'verified' && owned.identity?.pid > 0 && owned.identity.executable.endsWith(`/plugins/${OK}/bin/plugin`), `${engine}: the host names the plugin's process, with the executable it runs: ${JSON.stringify(owned)}`);
    const { pid } = owned.identity;
    process.kill(pid, 0);
    await chmod(binaryPath, 0o644);
    const killAt = frames.length;
    const killSeen = await marks(page);
    process.kill(pid, 'SIGKILL');
    await waitUntil(`the host to see process ${String(pid)} end`, () => host.output().includes(`id=${String(pid)} error="signal: killed"`), 15_000);
    // The host's health check finds it (up to 30 s) and tells the window.
    await Promise.all([saying(page, OK, 'failed').waitFor({ timeout: 75_000 }), saying(second, OK, 'failed').waitFor({ timeout: 75_000 })]);
    assert.equal(causesOf(frames, OK, killAt)[0], 'crashed', `${engine}: the host said the plugin crashed`);
    await asserting(
      'stopped-word',
      async () => {
        await row(page, OK).evaluate((element) => element.setAttribute('data-pl-state', 'running'));
      },
      async () => {
        await row(page, OK).evaluate((element) => element.setAttribute('data-pl-state', 'failed'));
      },
      async () => {
        const says = 'a plugin whose process was killed: the row says it stopped, in the host\'s words, and offers Retry';
        for (const [target, which] of [[page, 'first'], [second, 'second']]) {
          const mine = (await rowsOf(target)).find((entry) => entry.id === OK);
          assert.deepEqual({ state: mine.state, chip: mine.chip, sentence: mine.sentence, busy: mine.busy }, { state: 'failed', chip: 'Stopped', sentence: CRASHED, busy: false }, `${engine}: ${says} (the row, ${which} window)`);
        }

        assert.equal(await page.locator('[data-pl-part="head-chip"]').innerText(), 'Stopped', `${engine}: ${says} (the header's chip)`);
        assert.equal(await lane(page), `Seam Fixture stopped ${CRASHED}`, `${engine}: ${says} (the lane)`);
        assert.equal(await primary('Retry').count(), 1, `${engine}: ${says} (the Retry)`);
        assert.deepEqual((await railOf(page)).map((entry) => entry.name), ['Seam Fixture Copy', 'Seam Fixture, stopped'], `${engine}: ${says} (the rail)`);
        assert.equal((await railOf(page))[1].tip, `Seam Fixture, stopped\n${CRASHED}`, `${engine}: ${says} (the rail's tip)`);
        assert.deepEqual((await railOf(second)).map((entry) => entry.name), ['Seam Fixture Copy', 'Seam Fixture, stopped'], `${engine}: ${says} (the second window's rail)`);
      },
    );
    assert.deepEqual(await rawIn(page), [], `${engine}: the crash's own text is nowhere on the page (the first window)`);
    assert.deepEqual(await rawIn(second), [], `${engine}: the crash's own text is nowhere on the page (the second window)`);
    await shot('stopped');
    // The host's recovery reloads the plugin and fails, three times, and gives up; the cause the plugin went away with stands. Then the binary is back and Retry, from the page, asks the host to start it.
    await waitUntil('the host to give up the recovery', () => host.output().includes('max crash recovery attempts reached'), 45_000);
    await waitUntil("the window to be told that the recovery's last load failed", () => causesOf(frames, OK, killAt).at(-1) === 'failed', 15_000);
    assert.equal((await rowsOf(page)).find((entry) => entry.id === OK)?.chip, 'Stopped', `${engine}: the first cause stands while the host gives up: the row still says Stopped`);
    await chmod(binaryPath, 0o755);
    const restartAt = frames.length;
    const restartCalls = calls.length;
    const restartSeen = await marks(page);
    await primary('Retry').click();
    await Promise.all([saying(page, OK, 'running').waitFor({ timeout: 30_000 }), saying(second, OK, 'running').waitFor({ timeout: 30_000 })]);
    await Promise.all([rail(page, 'Seam Fixture').waitFor(), rail(second, 'Seam Fixture').waitFor(), gone()]);
    assert.deepEqual(calls.slice(restartCalls), [['RetryFailedPlugin', OK]], `${engine}: Retry asked the host for one thing, the retry the rail's failed page offers`);
    assert.ok(ranAgain(frames, OK, restartAt), `${engine}: the host said the plugin runs`);
    assert.ok(inOrder((await seenSince(page, restartSeen)).rows.filter((entry) => entry.id === OK).map((entry) => entry.state), ['starting', 'running']), `${engine}: the row went through Starting again to running`);
    assert.deepEqual((await railOf(page)).map((entry) => entry.name), railFor(await rowsOf(page)), `${engine}: and the rail agrees with the row`);
    assert.deepEqual((await railOf(second)).map((entry) => entry.name), ['Seam Fixture', 'Seam Fixture Copy'], `${engine}: and so does the second window's`);
    assert.equal((await rowsOf(second)).find((entry) => entry.id === OK)?.chip, '', `${engine}: the second window's row says nothing of a state: the plugin runs`);
    assert.equal(killSeen.rows < (await marks(page)).rows, true, `${engine}: the first window's page drew each change, in order`);

    // 6. UNINSTALL the copy. The confirm is the browser's own dialog, with the page's words for what an uninstall does; Cancel and Escape each close it, give the focus back to the control that opened it and call nothing of the host.
    await row(page, DUP).click();
    const trigger = page.getByRole('button', { name: 'More actions for Seam Fixture Copy', exact: true });
    const words = uninstallWords('Seam Fixture Copy', false, 0);
    const confirm = page.getByRole('dialog', { name: words.title });
    const uninstallCalls = calls.length;
    const opens = async () => {
      await trigger.click();
      await page.getByRole('menuitem', { name: 'Uninstall…', exact: true }).click();
      await confirm.waitFor();
    };
    await opens();
    await asserting(
      'confirm-words',
      async () => {
        await confirm.locator('[data-pl-part="confirm-section"] p').last().evaluate((text) => {
          text.textContent = 'The settings it declares are erased with it.';
        });
      },
      async () => {
        await confirm.locator('[data-pl-part="confirm-section"] p').last().evaluate((text, said) => {
          text.textContent = said;
        }, words.sections.at(-1).text);
      },
      async () => {
        const says = "the confirm says what an uninstall does, in the page's words: files, connection profiles and credentials erased, the settings it declares kept";
        const shown = await confirm.evaluate((dialog) => ({
          title: dialog.querySelector('[data-pl-part="confirm-title"]')?.textContent,
          version: dialog.querySelector('[data-pl-part="confirm-version"]')?.textContent,
          intro: dialog.querySelector('[data-pl-part="confirm-body"]')?.textContent,
          sections: [...dialog.querySelectorAll('[data-pl-part="confirm-section"]')].map((section) => ({ heading: section.querySelector('h3')?.textContent, text: section.querySelector('p')?.textContent })),
          buttons: [...dialog.querySelectorAll('button')].map((button) => button.textContent),
          inputs: dialog.querySelectorAll('input, select, textarea').length,
        }));
        assert.deepEqual(shown, { title: words.title, version: '0.0.1', intro: words.intro, sections: words.sections, buttons: ['', 'Cancel', words.confirm], inputs: 0 }, `${engine}: ${says} (the words, the buttons and no choice)`);
        assert.match(shown.intro, /its files are removed\.$/, `${engine}: ${says} (its files)`);
        assert.match(shown.sections[1].text, /connection profiles and the credentials it saved are erased/, `${engine}: ${says} (its profiles and credentials)`);
        assert.match(shown.sections[2].text, /settings it declares are kept/, `${engine}: ${says} (its settings)`);
      },
    );
    assert.equal(await confirm.evaluate((dialog) => dialog.open && document.activeElement === dialog.querySelector('[data-pl-part="confirm-cancel"]')), true, `${engine}: the confirm is open and the keyboard is on Cancel, never on the destructive button`);
    await shot('uninstall');
    for (const [way, close] of [['Cancel', async () => confirm.getByRole('button', { name: 'Cancel', exact: true }).click()], ['Escape', async () => page.keyboard.press('Escape')]]) {
      await close();
      await confirm.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-pl-part') === 'head-more');
      const closes = `closing the confirm gives the focus back to the control that opened it (${way})`;
      if (way === 'Cancel') {
        await asserting(
          'confirm-focus',
          async () => {
            await page.evaluate(() => document.activeElement?.blur());
          },
          async () => trigger.focus(),
          async () => {
            assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'More actions for Seam Fixture Copy', `${engine}: ${closes}`);
          },
        );
      } else {
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'More actions for Seam Fixture Copy', `${engine}: ${closes}`);
      }

      assert.equal(await row(page, DUP).count(), 1, `${engine}: and the plugin is still listed (${way})`);
      assert.deepEqual(calls.slice(uninstallCalls), [], `${engine}: and nothing was asked of the host (${way})`);
      await opens();
    }

    // Confirmed. The host's answer is held after the host did it: the row and the rail entry LEAVE on `plugin/unloaded` (uninstalled), with the call still open, and the second window's list loses the row with no reload.
    const remaining = inventory.filter((entry) => entry.id !== DUP).toSorted(byName);
    const removing = await holdCall(page, 'UninstallPlugin', 'after');
    const removeAt = frames.length;
    await confirm.getByRole('button', { name: words.confirm, exact: true }).click();
    await waitUntil('the host to have uninstalled the plugin', removing.held, 30_000);
    await Promise.all([row(page, DUP).waitFor({ state: 'detached' }), row(second, DUP).waitFor({ state: 'detached' })]);
    await asserting(
      'uninstall-gone',
      async () => stale(page),
      async () => undecoy(page),
      async () => {
        const leaves = 'Uninstall: the row and the rail entry leave on the host\'s event while the call is still open';
        assert.equal(removing.held(), true, `${engine}: ${leaves} (the call is still held)`);
        assert.deepEqual((await rowsOf(page)).map((entry) => entry.id), remaining.map((entry) => entry.id), `${engine}: ${leaves} (the row)`);
        assert.deepEqual((await railOf(page)).map((entry) => entry.name), ['Seam Fixture'], `${engine}: ${leaves} (the rail's entry)`);
        assert.equal(await page.locator('[data-pl-part="list-head"]').textContent(), `Installed${String(remaining.length)}`, `${engine}: ${leaves} (the count)`);
        assert.deepEqual(toldOf(frames, DUP, removeAt).filter((frame) => frame.name !== 'plugin/state_change').map((frame) => [frame.name, frame.data?.cause]), [['plugin/unloaded', 'uninstalled']], `${engine}: ${leaves} (the host's event)`);
        assert.equal(frames.slice(removeAt).some((frame) => frame.name === 'plugin/inventory_changed'), true, `${engine}: ${leaves} (and it says the inventory changed)`);
      },
    );
    await asserting(
      'second-list',
      async () => stale(second),
      async () => undecoy(second),
      async () => {
        const lost = "the second window's list lost the row with no reload, and its rail lost the entry";
        assert.deepEqual((await rowsOf(second)).map((entry) => entry.id), remaining.map((entry) => entry.id), `${engine}: ${lost} (the row)`);
        assert.equal(await second.locator('[data-pl-part="list-foot"]').textContent(), `${String(remaining.length)} plugins`, `${engine}: ${lost} (the count)`);
        assert.deepEqual((await railOf(second)).map((entry) => entry.name), ['Seam Fixture'], `${engine}: ${lost} (the rail)`);
        assert.equal(await second.evaluate(() => window.__plSameDocument === true), true, `${engine}: ${lost} (the page was never reloaded)`);
        assert.deepEqual(causesOf(framesSecond, DUP, 0).slice(-1), ['uninstalled'], `${engine}: ${lost} (it was told by the host's event)`);
      },
    );
    await removing.release();
    await page.waitForTimeout(500);
    assert.deepEqual(calls.slice(uninstallCalls), [['UninstallPlugin', DUP]], `${engine}: the page asked the host for one thing, to uninstall the plugin`);
    assert.deepEqual((await callBound(host.base, PLUGIN_SERVICE, 'ListPlugins')).map((entry) => entry.id).sort(), remaining.map((entry) => entry.id).sort(), `${engine}: the host no longer lists the plugin`);
    assert.deepEqual((await rowsOf(page)).map((entry) => entry.id), remaining.map((entry) => entry.id), `${engine}: and the page, whose call has ended and which read the inventory again, does not bring it back`);
    await assert.rejects(stat(path.join(stateRoot(dir), 'plugins', DUP)), { code: 'ENOENT' }, `${engine}: the plugin's directory is gone from the host's plugins directory`);
    const shown = await page.locator('[data-pl-part="detail"]').getAttribute('aria-label');
    assert.ok(remaining.some((entry) => entry.metadata.name === shown), `${engine}: the detail moved on to a plugin that is still listed (${String(shown)})`);
    await shot('uninstalled');

    assert.deepEqual(await rawIn(page), [], `${engine}: at the end nothing the page draws holds the host's own words for an error (the first window)`);
    assert.deepEqual(await rawIn(second), [], `${engine}: at the end nothing the page draws holds the host's own words for an error (the second window)`);
    assert.deepEqual(errors, [], `${engine}: the whole scenario wrote no page error`);
    console.log(`${engine}: the Plugins page followed the host through a reload, a disable and an enable, an enable that left a plugin on and not started, a process killed by its pid and an uninstall (${String(frames.length)} plugin events told); the second window agreed with no reload`);
    verdict(engine);
  } finally {
    await page.close();
    await second.close();
    host.child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8000))]);
  }
}

/**
 * i. The session (S3a). The window starts empty; two tabs of two plugins, the rail on the second plugin and the panel open on the second plugin's tool at a height the keyboard chose are what a person
 * leaves. They are what the host holds after a quiet moment, what a reload of the page brings back, and what a host that was stopped and started again (the app's restart; the state root is kept) brings
 * back. Then what is saved is made unusable in the ways that matter, through the window service the shell uses: a tab of a plugin that is not installed (the tab stays, and says so), a session of a
 * newer version and a text that is no session (kept aside in a slot of their own, whole, and the window opens empty).
 */
async function checkSession(browser, getHost, restart, engine) {
  const errors = [];
  const notes = [];
  const watch = (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.text().startsWith('[session]')) notes.push(message.text());
    });
  };
  const strip = (page) => page.getByRole('tablist', { name: 'Open tabs' });
  const toggleOf = (page) => page.getByRole('button', { name: 'Panel', exact: true });
  const slots = async () => callHost(getHost().base, 'GetState', 'main');
  const kept = async () => Object.entries(await slots()).filter(([name]) => name.startsWith('session.invalid.'));
  // The host's window keeps what an earlier run of this check set aside (the other engine's): what is counted is what this one adds.
  const before = (await kept()).length;
  const until = async (what, read, done) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const value = await read();
      if (done(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`${engine}: ${what} did not come in 15 s (the console said: ${notes.join(' | ') || 'nothing'}; the host holds ${JSON.stringify(await slots()).slice(0, 400)})`);
  };
  /** What a person sees of the window: the tabs and the one on screen, the rail's entry and the sidebar, the panel's toggle, tool and height. */
  const look = async (page) => {
    const panelOpen = (await toggleOf(page).getAttribute('aria-pressed')) === 'true';
    return {
      tabs: await strip(page).getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => tab.textContent?.trim())),
      active: await strip(page).getByRole('tab', { selected: true }).evaluateAll((tabs) => tabs.map((tab) => tab.textContent?.trim())),
      rail: await page.locator('[data-shell-part="rail"] [aria-current="true"]').evaluateAll((entries) => entries.map((entry) => entry.getAttribute('aria-label'))),
      sidebar: await page.locator('[data-shell-region="sidebar"]').getAttribute('aria-label'),
      panel: panelOpen
        ? {
            open: true,
            tool: await page.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { selected: true }).innerText(),
            height: Number(await page.getByRole('separator', { name: 'Resize panel' }).getAttribute('aria-valuenow')),
          }
        : { open: false },
    };
  };

  // A first run: nothing saved, nothing opens by itself.
  const page = await freshPage(browser, getHost().base);
  watch(page);
  await open(page, getHost().base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  assert.equal(await strip(page).getByRole('tab').count(), 0, `${engine}: a window with nothing saved opens no tab`);

  // Two tabs of two plugins, the second's (a page that fails by design: its bundle has its own copy of the kit, which is how the check knows whose it is) on screen, the rail and the sidebar on the second.
  await openFirstPlugin(page);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  await page.getByRole('group', { name: 'Plugins' }).getByRole('button').nth(1).click();
  await page.getByRole('treeitem', { name: 'Things' }).click();
  await page.getByRole('treeitem', { name: 'Items' }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await strip(page).getByRole('tab').count(), 2, `${engine}: the tabs of both plugins are open`);
  // The panel: open, on the second plugin's tool, and a height the keyboard chose (Up grows it by 16 px).
  await toggleOf(page).click();
  await page.locator('[data-shell-region="panel"]').waitFor({ state: 'visible' });
  const tools = page.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab');
  await tools.nth(2).click();
  await page.getByRole('separator', { name: 'Resize panel' }).focus();
  for (let press = 0; press < 3; press += 1) await page.keyboard.press('ArrowUp');
  const left = await look(page);
  // Two tabs that read alike are told apart by the model (the plugin's name), so what is checked is the shape: two tabs, the second on screen, the second plugin's entry current, its tool on screen.
  assert.equal(left.tabs.length, 2, `${engine}: two tabs (${left.tabs.join(' | ')})`);
  assert.deepEqual(left.active, [left.tabs[1]], `${engine}: the second is on screen`);
  assert.deepEqual({ rail: left.rail, open: left.panel.open, tool: left.panel.tool }, { rail: ['Seam Fixture Copy'], open: true, tool: 'Streams copy' }, `${engine}: the window as it was left`);
  const fresh = await page.getByRole('separator', { name: 'Resize panel' }).getAttribute('aria-valuenow');
  assert.ok(Number(fresh) > 0, `${engine}: the panel has a height (${String(fresh)})`);

  // The host holds it after the quiet moment: the document the window service answers is the session, whole.
  const held = await until('the saved session', async () => (await slots()).session, (text) => typeof text === 'string' && JSON.parse(text)?.panel?.open === true && JSON.parse(text)?.panel?.height !== null && JSON.parse(text)?.rail !== null);
  const saved = JSON.parse(held);
  assert.deepEqual({ version: saved.version, tabs: saved.tabs.tabs.length, active: saved.tabs.active === saved.tabs.tabs[1]?.id, rail: saved.rail, tool: saved.panel.tool }, { version: 1, tabs: 2, active: true, rail: DUP, tool: `${DUP}:streams` }, `${engine}: what the host holds`);

  // A reload of the whole page: the same tabs, the same one on screen, the same rail and sidebar, the same panel at the same height.
  await page.reload({ waitUntil: 'load' });
  await strip(page).getByRole('tab').first().waitFor({ timeout: 30_000 });
  await page.getByRole('alert').waitFor();
  assert.deepEqual(await look(page), left, `${engine}: a reload brings back what the window was`);
  // Only the tab on screen has a page: the first is restored, not mounted.
  assert.equal(await page.getByText('orders-api', { exact: true }).count(), 0, `${engine}: a restored tab that is not on screen has no page`);
  await strip(page).getByRole('tab').first().click();
  await page.getByText('orders-api', { exact: true }).waitFor();
  assert.deepEqual((await look(page)).rail, ['Seam Fixture'], `${engine}: choosing the first tab makes its plugin current again`);
  await strip(page).getByRole('tab').nth(1).click();
  await page.getByRole('alert').waitFor();

  // The app's restart: the host is stopped (the window service writes `windows.json` into the state root) and started again over the same state root, and a new page finds the window as it was left.
  const onDisk = async () => JSON.parse(await readFile(path.join(stateRoot(work), 'windows.json'), 'utf8')).states?.main?.session;
  await until('the session on disk', onDisk, (text) => typeof text === 'string' && JSON.parse(text)?.tabs?.active === saved.tabs.tabs[1]?.id);
  await page.close();
  await restart();
  const again = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(again);
  await open(again, getHost().base);
  await strip(again).getByRole('tab').first().waitFor({ timeout: 30_000 });
  await again.getByRole('alert').waitFor();
  assert.deepEqual(await look(again), left, `${engine}: a restart of the host brings back what the window was`);

  // A tab of a plugin that is not installed: it stays, in its place and on screen, and its page says why. (Written through the service the shell uses, as a run with the plugin removed would have left it.)
  const route = (plugin, contribution) => ({ plugin, contribution, params: {} });
  const tab = (id, plugin, contribution, title) => ({ id, route: route(plugin, contribution), key: `${plugin}:${contribution}`, face: { title, icon: 'box', path: [], facets: [], pluginName: 'Gone Plugin', singleton: false, identity: 'key' }, pinned: false, preview: false, history: { entries: [route(plugin, contribution)], index: 0 } });
  const document = (version, tabs, active) => JSON.stringify({ version, tabs: { version: 1, active, tabs }, rail: null, panel: { version: 1 } });
  // A slot holds JSON: the session is the text of its document.
  // The page that is open saves its own window a quiet moment after it changes (a plugin that registers describes its tabs again): that lands first, or it would replace what is written here.
  const write = async (text) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return callHost(getHost().base, 'SaveState', 'main', 'session', text);
  };
  await write(document(1, [tab('a', 'fixture-z-gone', 'items', 'Gone page'), tab('b', OK, 'items', 'Items')], 'a'));
  await again.reload({ waitUntil: 'load' });
  await strip(again).getByRole('tab').first().waitFor({ timeout: 30_000 });
  await again.getByRole('alert').waitFor();
  assert.match(await again.getByRole('alert').innerText(), /Couldn't load Gone Plugin[\s\S]*This plugin is not installed, or is turned off\./, `${engine}: the page of a tab whose plugin is not installed says so`);
  assert.deepEqual((await look(again)).tabs, ['Gone page', 'Items'], `${engine}: and the tab stays, with the face it was saved with`);
  assert.equal((await kept()).length, before, `${engine}: a plugin that is gone is no reason to keep a session aside`);

  // A session of a newer version, and a text that is no session: kept aside whole, in slots of their own that nothing replaces, and the window opens empty, with a note.
  const newer = document(99, [tab('a', OK, 'items', 'Items')], 'a');
  const nonsense = '"these are just words"';
  let count = before;
  for (const text of [newer, nonsense]) {
    count += 1;
    notes.length = 0;
    await write(text);
    await again.reload({ waitUntil: 'load' });
    await again.getByText('No tabs are open.').waitFor({ timeout: 30_000 });
    assert.equal(await strip(again).getByRole('tab').count(), 0, `${engine}: a session that cannot be used opens an empty window`);
    const aside = await until('the text kept aside', kept, (entries) => entries.length === count);
    assert.ok(notes.some((note) => note.includes('kept aside')), `${engine}: the console says so (${notes.join(' | ')})`);
    // The slot holds the record as a JSON string: the record is JSON text inside it.
    const record = JSON.parse(JSON.parse(aside.at(-1)[1]));
    assert.equal(record.text, text, `${engine}: the text is kept exactly as it was`);
    assert.equal(record.reason, text === newer ? 'foreign-version' : 'unreadable', `${engine}: with its reason`);
    // What the window holds from now on is a session of this version, not the text that was kept: the next start does not find it again.
    await until('the session replaced', async () => (await slots()).session, (value) => typeof value === 'string' && JSON.parse(value)?.version === 1 && JSON.parse(value)?.tabs?.tabs?.length === 0);
  }

  // A reload, a closed page and a host that was stopped cut the calls that are in flight, which an engine reports as a page error ("Load failed", "due to access control checks", "Failed to fetch"):
  // they are the page's going away, not the session's. Anything else is.
  const cut = /access control checks|Load failed|Failed to fetch|NetworkError|network connection was lost/i;
  assert.deepEqual(errors.filter((message) => !cut.test(message)), [], `${engine}: the session wrote no page error`);
  await again.close();
}

/**
 * o. a page command that fails is a toast (O1b-1). Over the real host: the fixture's item page, its header command Restart, `window.__fixtureDetail` to make it fail the way the runtime's hooks do (plugins/fixture/src/failure.ts).
 * The focus is put on Restart with the keyboard's own focus call and the command is pressed with Enter: an engine may not focus a button that a click presses, and the check is about where the focus is.
 */
async function checkToasts(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  await openFirstPlugin(page);
  await page.getByRole('link', { name: 'orders-api' }).click();
  await page.getByRole('heading', { level: 2, name: 'Details' }).waitFor({ timeout: 30_000 });

  const layer = page.locator('[data-notices-part="layer"]');
  const toasts = layer.locator('[data-notices-part="toast"]');
  const restart = page.getByRole('button', { name: 'Restart', exact: true });
  /** Where the focus is: the element's tag and its text, and whether it is a toast. */
  const focused = () => page.evaluate(() => ({ tag: document.activeElement?.tagName ?? '', text: (document.activeElement?.textContent ?? '').trim(), toast: document.activeElement?.matches('[data-notices-part="toast"]') ?? false }));
  const onRestart = { tag: 'BUTTON', text: 'Restart', toast: false };
  const press = async () => {
    await restart.focus();
    assert.deepEqual(await focused(), onRestart, `${engine}: the focus is on Restart before it is pressed`);
    await page.keyboard.press('Enter');
  };
  const fail = (failure) =>
    page.evaluate((name) => {
      window.__fixtureDetail = { failure: name, runs: [] };
    }, failure);
  const runs = () => page.evaluate(() => window.__fixtureDetail.runs.length);
  const noToast = () => page.waitForFunction(() => document.querySelectorAll('[data-notices-part="layer"] [data-notices-part="toast"]').length === 0);

  assert.equal(await layer.count(), 1, `${engine}: the toast layer is always there`);
  assert.equal(await toasts.count(), 0, `${engine}: no toast before a command failed`);
  // Quiet by default: a Restart that nobody made fail does nothing and says nothing.
  await restart.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  assert.equal(await toasts.count(), 0, `${engine}: a Restart that does not fail makes no toast`);

  // a failure of the host's own kind: the class's title, one sentence, a Retry; sticky, an alert, and the focus stays where it was.
  await fail('timeout');
  await press();
  const timeout = layer.getByRole('alert', { name: 'Error: Timed out' });
  await timeout.waitFor({ timeout: 10_000 });
  assert.equal(await toasts.count(), 1, `${engine}: one toast for one failure`);
  assert.equal(await runs(), 1, `${engine}: Restart ran once`);
  assert.equal(await timeout.getAttribute('data-severity'), 'error', `${engine}: the timeout is an error toast`);
  assert.match(await timeout.innerText(), /The cluster did not complete the request in time\./, `${engine}: the toast says the host's sentence`);
  assert.equal(await timeout.getByRole('button', { name: 'Retry', exact: true }).count(), 1, `${engine}: the toast has a Retry button`);
  assert.notEqual(await timeout.getAttribute('data-sticky'), null, `${engine}: a failure toast is sticky`);
  assert.deepEqual(await focused(), onRestart, `${engine}: the toast took no focus when it appeared`);
  // A timed toast closes at 8 s: this one is still there after 9 s of real time.
  await page.waitForTimeout(9000);
  assert.equal(await toasts.count(), 1, `${engine}: the failure toast is still there after 9 s`);
  assert.notEqual(await timeout.getAttribute('data-sticky'), null, `${engine}: and still sticky`);
  assert.deepEqual(await focused(), onRestart, `${engine}: and the focus never moved`);

  // F6 reaches the toast (the first toast is its stop); Escape closes it and the focus goes back to Restart.
  let presses = 0;
  for (; presses < 10 && !(await focused()).toast; presses += 1) await page.keyboard.press('F6');
  assert.equal((await focused()).toast, true, `${engine}: F6 reached the toast in ${String(presses)} presses`);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''), 'Error: Timed out', `${engine}: the focus is on the first toast`);
  await page.keyboard.press('Escape');
  await noToast();
  assert.deepEqual(await focused(), onRestart, `${engine}: Escape closed the toast and the focus went back to the Restart button`);

  // Retry asks the same command again. A failure that comes back is the SAME record whether or not its toast was dismissed: the model folds the same notice inside a minute (core/notices/store.ts, post(); the mock's `foldTarget`,
  // shell-notify.js:315-324) and raises the toast again, because a failure must not vanish (S78; the mock's `decide`, :1062-1065). So the press after the Escape above is the second failure and the toast that comes back says `Timed out 2
  // times`; Retry makes the third and it says `Timed out 3 times`. Each is a state that lasts (a failure toast is sticky), and each wait is on its state, never on the frame between them: the model tells the view at most once a frame,
  // and a wait for the label the toast had before the third failure passed in the 15 ms before the next frame and timed out when the page was a little late (about one run in twenty, with or without load, in both builds).
  await fail('timeout');
  await press();
  const second = layer.getByRole('alert', { name: 'Error: Timed out 2 times' });
  await second.waitFor({ timeout: 10_000 });
  await second.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => window.__fixtureDetail.runs.length === 2);
  await layer.getByRole('alert', { name: 'Error: Timed out 3 times' }).waitFor({ timeout: 10_000 });
  assert.equal(await toasts.count(), 1, `${engine}: the second and the third failure are counts on the one toast`);
  assert.equal(await runs(), 2, `${engine}: Retry asked the command again, once`);
  await toasts.first().getByRole('button', { name: /^Dismiss/ }).click();
  await noToast();

  // a failure that is not the host's: its words are never shown (a plugin's text may hold a credential).
  await fail('generic');
  await press();
  const generic = layer.getByRole('alert', { name: 'Error: Operation failed' });
  await generic.waitFor({ timeout: 10_000 });
  assert.match(await generic.innerText(), /The operation could not be completed\./, `${engine}: a generic failure says the generic sentence`);
  const everything = await page.evaluate(() => `${document.body.innerText}\n${document.body.textContent}\n${document.documentElement.outerHTML}`);
  for (const secret of ['hunter2', 'ECONNREFUSED', '10.0.0.5']) assert.equal(everything.includes(secret), false, `${engine}: ${secret} is nowhere in the document`);
  await generic.getByRole('button', { name: /^Dismiss/ }).click();
  await noToast();

  // a cancelled command is no failure: once it has rejected and the page has settled there is still no toast.
  await fail('cancelled');
  await press();
  await page.waitForFunction(() => window.__fixtureDetail.runs.length === 1);
  await page.waitForTimeout(1500);
  assert.equal(await toasts.count(), 0, `${engine}: a cancelled command makes no toast`);
  assert.equal(await runs(), 1, `${engine}: and the cancelled command ran once`);

  assert.deepEqual(errors, [], `${engine}: the failing commands wrote no page error`);
  await page.close();
}

/**
 * Watches the notices of the page from the first script of every document: it counts the toasts the page DRAWS (a toast node added to the document: a toast that came and went between two reads of the check is still counted)
 * and keeps what the window's two live regions are TOLD, one entry for each announcement (the region draws a new node with its words each time).
 */
const WATCH_NOTICES = `(() => {
  window.__toastsDrawn = 0;
  window.__told = [];
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[data-notices-part="toast"]') || node.querySelector('[data-notices-part="toast"]') !== null) window.__toastsDrawn += 1;
        const part = node.parentElement?.getAttribute('data-notices-part');
        if ((part === 'live' || part === 'alert') && (node.textContent ?? '') !== '') window.__told.push(part + ': ' + node.textContent);
      }
    }
  }).observe(document, { childList: true, subtree: true });
})()`;

/**
 * q. the notification centre (O1b-2), over the real host: the fixture's item page and its failing Restart (as `checkToasts`), the bell of the status bar and the centre it opens. The focus is put on Restart with the keyboard's
 * own focus call and Enter presses it (a click may not focus a button in WebKit, and the check is about where the focus is). Three failures of three kinds, so that a repeat never folds into the record before it (the model folds
 * the same notice within 60 s): a timeout whose toast is dismissed, a refusal whose toast is not, and a failure of the plugin's own that arrives while the centre is open.
 */
async function checkCentre(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.addInitScript(WATCH_NOTICES);
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  await openFirstPlugin(page);
  await page.getByRole('link', { name: 'orders-api' }).click();
  await page.getByRole('heading', { level: 2, name: 'Details' }).waitFor({ timeout: 30_000 });

  const layer = page.locator('[data-notices-part="layer"]');
  const toasts = layer.locator('[data-notices-part="toast"]');
  const restart = page.getByRole('button', { name: 'Restart', exact: true });
  const bell = page.locator('[data-notices-part="bell"]');
  const centre = page.locator('[data-notices-part="centre"]');
  const rows = centre.locator('[data-notices-part="row"]');
  const toggleOf = (row) => row.locator('[data-notices-part="rowToggle"]');
  const quiet = () => page.waitForTimeout(500);
  const drawn = () => page.evaluate(() => window.__toastsDrawn);
  const told = () => page.evaluate(() => window.__told);
  const forgetNotices = () =>
    page.evaluate(() => {
      window.__toastsDrawn = 0;
      window.__told = [];
    });
  const bellName = () => bell.getAttribute('aria-label');
  const onBell = () => page.evaluate(() => document.activeElement?.matches('[data-notices-part="bell"]') ?? false);
  /** The row the focus is in, and whether the focus is on its title button: the title's words and its id. */
  const focusedRow = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      return {
        title: active?.matches('[data-notices-part="rowToggle"]') ? (active.querySelector('[data-notices-part="rowTitle"]')?.textContent ?? '') : '',
        id: active?.closest('[data-notices-part="row"]')?.getAttribute('data-notices-id') ?? '',
      };
    });
  const fail = (failure) =>
    page.evaluate((name) => {
      window.__fixtureDetail = { failure: name, runs: [] };
    }, failure);
  const press = async () => {
    await restart.focus();
    await page.keyboard.press('Enter');
  };
  const openCentre = async () => {
    await bell.click();
    await centre.waitFor({ timeout: 10_000 });
  };
  const closeWithEscape = async () => {
    await page.keyboard.press('Escape');
    await centre.waitFor({ state: 'detached', timeout: 10_000 });
  };

  assert.equal(await bellName(), 'Notifications', `${engine}: a window with no history has a bell with no dot`);
  assert.equal(await centre.count(), 0, `${engine}: a closed centre is not drawn`);

  // (a) a failure whose toast is dismissed: the record is READ (S81). Nothing is unread, the bell has no dot, and the centre lists the record, read.
  await fail('timeout');
  await press();
  const timeout = layer.getByRole('alert', { name: 'Error: Timed out' });
  await timeout.waitFor({ timeout: 10_000 });
  assert.equal(await bellName(), 'Notifications, 1 unread, 1 error', `${engine}: a failure that nobody has seen is unread, and the bell says so in words`);
  await timeout.getByRole('button', { name: /^Dismiss/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-notices-part="layer"] [data-notices-part="toast"]').length === 0);
  await quiet();
  assert.equal(await bellName(), 'Notifications', `${engine}: a dismissed toast's record is read: the bell's name is exactly Notifications`);
  assert.equal(await bell.locator('[data-notices-part="bellDot"]').count(), 0, `${engine}: and the bell has no dot`);

  await openCentre();
  assert.equal(await rows.count(), 1, `${engine}: the centre lists the one record`);
  const dismissed = rows.first();
  assert.match(await dismissed.locator('[data-notices-part="rowTitle"]').innerText(), /Timed out/, `${engine}: the record's title is Timed out`);
  assert.match(await dismissed.locator('[data-notices-part="rowText"]').innerText(), /The cluster did not complete the request in time\./, `${engine}: and its sentence is the plugin's`);
  assert.equal(await dismissed.getAttribute('data-unread'), null, `${engine}: the dismissed toast's row is read (no data-unread)`);
  assert.doesNotMatch(await dismissed.textContent(), /Unread/, `${engine}: and does not say Unread`);
  assert.deepEqual(await focusedRow(), { title: await dismissed.locator('[data-notices-part="rowTitle"]').textContent(), id: await dismissed.getAttribute('data-notices-id') }, `${engine}: opening the centre puts the focus on its row's title`);
  // The record can be run again while this window is the one that made it (the contrast to the restored record, below).
  await page.keyboard.press('Enter');
  assert.notEqual(await dismissed.getAttribute('data-expanded'), null, `${engine}: Enter on the title opens the row`);
  assert.equal(await dismissed.getByRole('button', { name: 'Retry', exact: true }).count(), 1, `${engine}: the row of a record of this window offers Retry`);
  await closeWithEscape();
  assert.equal(await centre.count(), 0, `${engine}: Escape closes the centre and a closed centre is not drawn`);
  assert.equal(await onBell(), true, `${engine}: and the focus is on the bell`);
  assert.equal(await toasts.count(), 0, `${engine}: no toast came back`);

  // (b) a failure whose toast is NOT dismissed is unread; the centre takes the toast out of the layer while it is open (one presenter), a failure that arrives then is in the list with no toast, and
  // closing it after more than 1 s reads what it listed.
  await fail('forbidden');
  await press();
  await toasts.first().waitFor({ timeout: 10_000 });
  assert.equal(await toasts.count(), 1, `${engine}: the second failure is a toast`);
  assert.equal(await bellName(), 'Notifications, 1 unread, 1 error', `${engine}: one unread error, in words`);
  await forgetNotices();
  await openCentre();
  await quiet();
  assert.equal(await toasts.count(), 0, `${engine}: opening the centre takes the toast out of the layer (one presenter)`);
  assert.equal(await rows.count(), 2, `${engine}: the centre lists both records`);
  assert.equal(await centre.locator('[data-notices-part="row"][data-unread]').count(), 1, `${engine}: one of them is unread: the one whose toast nobody dismissed`);
  assert.equal(await rows.first().getAttribute('data-unread'), '', `${engine}: and it is the newest`);
  await page.waitForTimeout(1500);
  // a failure that arrives while the centre is open: in the list, no toast. (Restart is pressed from the page: the centre is not modal.)
  await fail('generic');
  await press();
  await page.waitForFunction(() => document.querySelectorAll('[data-notices-part="centre"] [data-notices-part="row"]').length === 3);
  await quiet();
  assert.equal(await toasts.count(), 0, `${engine}: a notice that arrives while the centre is open has no toast`);
  assert.equal(await drawn(), 0, `${engine}: and none was drawn and taken away again while it was open`);
  assert.equal(await rows.first().getAttribute('data-unread'), '', `${engine}: the notice that arrived while the centre was open is in the list, unread`);
  assert.match(await rows.first().locator('[data-notices-part="rowTitle"]').innerText(), /Operation failed/, `${engine}: and it is the plugin's own failure, said in the generic words`);
  const announced = await told();
  assert.equal(announced.length, 1, `${engine}: and it was told ONCE, in the window's live regions, as a notice without a toast is: ${JSON.stringify(announced)}`);
  assert.match(announced[0] ?? '', /^(alert|live): .*Operation failed/, `${engine}: and the words are the failure's title: ${JSON.stringify(announced)}`);
  await page.waitForTimeout(1500);
  await toggleOf(rows.first()).focus();
  await closeWithEscape();
  await quiet();
  assert.equal(await bellName(), 'Notifications', `${engine}: closing the centre after more than 1 s reads what it listed: the bell's name is exactly Notifications`);
  assert.equal(await toasts.count(), 0, `${engine}: no toast came back when the centre closed`);
  assert.equal(await drawn(), 0, `${engine}: and none was drawn from the moment the second failure's toast was there`);
  assert.equal(await onBell(), true, `${engine}: Escape gave the focus back to the bell`);

  // (c) the history comes back after a reload: it is in the window service's slot of its own, and the window restores it, read, with no toast and no announcement.
  const slot = async () => JSON.stringify((await callHost(base, 'GetState', 'main')).notices ?? null);
  for (let attempt = 0; attempt < 60 && !(await slot()).includes('Operation failed'); attempt += 1) await page.waitForTimeout(250);
  assert.match(await slot(), /Operation failed/, `${engine}: the window service holds the history (the saver's 400 ms, then the write)`);
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'load' });
  await bell.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  assert.equal(await bellName(), 'Notifications', `${engine}: the restored history is read, as it was saved: the bell has no dot`);
  assert.equal(await toasts.count(), 0, `${engine}: the restore raised no toast`);
  assert.equal(await drawn(), 0, `${engine}: and no toast was drawn by the restore`);
  for (const part of ['live', 'alert']) assert.equal(((await page.locator(`[data-notices-part="${part}"]`).textContent()) ?? '').trim(), '', `${engine}: the restore told nothing in the window's ${part} region`);
  await openCentre();
  assert.equal(await rows.count(), 3, `${engine}: the centre lists the three restored records`);
  assert.equal(await centre.locator('[data-notices-part="row"][data-unread]').count(), 0, `${engine}: none of them is unread`);
  const restored = rows.filter({ hasText: 'Timed out' });
  assert.equal(await restored.count(), 1, `${engine}: one of them is the Timed out record`);
  await toggleOf(restored).focus();
  await page.keyboard.press('Enter');
  assert.notEqual(await restored.getAttribute('data-expanded'), null, `${engine}: Enter on the restored title opens its row`);
  assert.equal(await restored.getByRole('button', { name: 'Retry', exact: true }).count(), 0, `${engine}: a restored record offers no Retry`);
  assert.match(await restored.innerText(), /Retry is unavailable\. Not available after restart\./, `${engine}: and its row says why`);
  await closeWithEscape();
  assert.equal(await onBell(), true, `${engine}: Escape gave the focus back to the bell after the reload`);

  assert.deepEqual(errors, [], `${engine}: the centre wrote no page error`);
  await page.close();
}

/**
 * A page's call of the host is `POST /wails/runtime` with the method's id (the bindings write `$Call.ByID(<id>, ...)`): the 32-bit FNV-1a hash of the method's full name, the name `callBound` sends.
 */
function methodId(service, method) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(`${service}.${method}`)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

const SETTINGS_CALLS = {
  snapshot: methodId(SETTINGS_SERVICE, 'GetSnapshot'),
  validate: methodId(SETTINGS_SERVICE, 'Validate'),
  hide: methodId(WINDOW_SERVICE, 'HideSettings'),
};

/** The bound method a request of a page asks for, or `undefined` when it is not a call of the runtime. */
function calledMethod(request) {
  try {
    return JSON.parse(request.postData() ?? '{}')?.args?.methodID;
  } catch {
    return undefined;
  }
}

/** Answers a call of a page in the host's place, with `body` (JSON text, or what is turned into it). Returns true: the call is taken. */
async function answerWith(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) });
  return true;
}

/**
 * Takes the host's place in one page for the calls `answer` wants: `answer(route, id)` takes the call (`answerWith`) and returns true, or returns false and the call goes on to the host. This is how a control changes what the host
 * answers a page: in a copy of the page's view of the host, never in the host. Returns what puts the page back.
 */
async function standIn(page, answer) {
  const handler = async (route) => {
    if (!(await answer(route, calledMethod(route.request())))) await route.continue();
  };
  await page.route('**/wails/runtime', handler);
  return async () => page.unroute('**/wails/runtime', handler);
}

/** The pages of Settings in the order the sheet lists them (the design's table), and what it leaves out of its first slice: two settings that are pickers in the old window, and whatever is for developers only. */
const SETTINGS_PAGE_ORDER = ['appearance', 'general', 'editor', 'terminal', 'notifications', 'telemetry', 'developer'];
const SETTINGS_NOT_DRAWN = ['appearance.theme', 'terminal.nativeApplication'];
const SETTINGS_DRAWN_TYPES = ['toggle', 'integer', 'float', 'password', 'text', 'select'];

/** The rows a page of Settings draws for one category of the host's snapshot, in the order it draws them (by id) and with the host's own label: what the host declares, less what the first slice leaves out. */
function settingsRowsOf(snapshot, category) {
  const settings = snapshot.categories[category]?.settings ?? {};
  return Object.keys(settings)
    .sort()
    .map((key) => ({ id: `${category}.${key}`, setting: settings[key] }))
    .filter(({ id, setting }) => {
      const secret = setting.sensitive === true || setting.type === 'password';
      return !SETTINGS_NOT_DRAWN.includes(id) && setting.devOnly !== true && SETTINGS_DRAWN_TYPES.includes(setting.type) && (!secret || snapshot.stored?.[id] !== undefined);
    })
    .map(({ id, setting }) => ({ id, label: setting.label === '' ? setting.id : setting.label }));
}

/** The pages the sheet lists for the host's snapshot: the categories that have a row to draw, the design's order first and the others after them, by label. */
function settingsPagesOf(snapshot) {
  const rank = (id) => {
    const index = SETTINGS_PAGE_ORDER.indexOf(id);
    return index === -1 ? SETTINGS_PAGE_ORDER.length : index;
  };
  return Object.entries(snapshot.categories)
    .filter(([id]) => settingsRowsOf(snapshot, id).length > 0)
    .sort(([a, left], [b, right]) => rank(a) - rank(b) || (left.label || a).localeCompare(right.label || b, 'en'))
    .map(([id, entry]) => ({ id, title: entry.label === '' ? id : entry.label }));
}

/** The rows a root has drawn, with the labels they carry. */
const rowsDrawn = async (root) => root.locator('[data-settings-row]').evaluateAll((rows) => rows.map((row) => ({ id: row.getAttribute('data-settings-row'), label: row.querySelector('label')?.textContent ?? '' })));

/** The part of a box that two boxes share, or `undefined` when they do not meet. */
function overlap(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

/** A picture of a part of the page once it holds still: two pictures of it in a row are the same bytes. */
async function stillPicture(page, clip, engine) {
  let last = await page.screenshot({ clip });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const next = await page.screenshot({ clip });
    if (next.equals(last)) return next;
    last = next;
  }

  throw new Error(`${engine}: the sheet holds still for a picture`);
}

/** Two frames of the page have been drawn: what a commit scheduled for after it has run, as the effect that puts the shell's chords on the window does after the first frame of the shell. */
async function afterFrames(page) {
  await page.evaluate(
    async () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(undefined);
          });
        });
      }),
  );
}

/** The sheet of a page of the shell, opened by the platform's chord from wherever the focus is, once the shell's chords are on the window; returned when its pages and rows are drawn. */
async function sheetByChord(page) {
  const mac = await page.evaluate(() => navigator.platform.includes('Mac'));
  await page.locator('[data-shell-part="settings"]').waitFor({ timeout: 30_000 });
  await afterFrames(page);
  await page.keyboard.press(`${mac ? 'Meta' : 'Control'}+Comma`);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.locator('[data-settings-part="layout"]').waitFor({ timeout: 15_000 });
  return dialog;
}

/**
 * Part of s, the sheet: the chord, the chord a browser tab answers, the gear and the palette's command each open it, from a control that holds the focus, with the host's own rows, and Escape closes it and gives the focus back; a
 * toggle pressed in it is applied on the host at once and is still applied after the page is reloaded; a value the host refuses says the host's words in the lane, keeps the typed text and leaves the host's value alone.
 */
async function settingsSheet(c) {
  const { engine, base, asserting } = c;
  await c.commit({ 'terminal.cursorBlink': true });
  const page = await c.page(1440, 900);
  const mac = await page.evaluate(() => navigator.platform.includes('Mac'));
  const mod = mac ? 'Meta' : 'Control';
  await open(page, base);
  const gear = page.locator('[data-shell-part="settings"]');
  const search = page.locator('[data-shell-part="search"]');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const palette = page.getByRole('dialog', { name: 'Search' });
  const nav = dialog.getByRole('navigation', { name: 'Settings pages' });
  const toPage = async (title) => nav.getByRole('button', { name: title, exact: true }).click();
  const hasFocus = async (locator) => locator.evaluate((element) => element === document.activeElement);
  const onPage = async () => nav.locator('[aria-current="page"]').getAttribute('data-settings-page');
  await gear.waitFor({ timeout: 30_000 });
  await afterFrames(page);
  const snapshot = await c.snapshot();
  const pages = settingsPagesOf(snapshot);
  assert.equal(await page.locator('[data-settings-part="sheet"]').count(), 0, `${engine}: a closed sheet draws nothing`);

  const chord = async () => {
    await search.focus();
    await page.keyboard.press(`${mod}+Comma`);
  };
  const openers = [
    { how: 'the chord', origin: search, opens: chord },
    { how: 'the gear', origin: gear, opens: async () => gear.click() },
    {
      how: 'the chord a browser tab answers',
      origin: search,
      opens: async () => {
        await search.focus();
        await page.keyboard.press('Control+Alt+Comma');
      },
    },
    {
      how: 'the palette command',
      origin: search,
      opens: async () => {
        await search.focus();
        await page.keyboard.press(`${mod}+KeyK`);
        await palette.waitFor();
        await page.keyboard.type('>Settings', { delay: 20 });
        const command = palette.getByRole('option', { name: /^Command: Settings/ });
        await command.waitFor();
        assert.equal(await command.getAttribute('aria-label'), `Command: Settings, Window, ${mac ? '⌃⌥,' : 'Ctrl+Alt+,'}`, `${engine}: the palette lists the Settings command with the chord a browser tab answers`);
        await page.keyboard.press('Enter');
      },
    },
  ];
  for (const { how, origin, opens } of openers) {
    await opens();
    await dialog.waitFor();
    await dialog.locator('[data-settings-part="layout"]').waitFor({ timeout: 15_000 });
    assert.equal(await page.locator('dialog[open]').count(), 1, `${engine}: ${how} opens one dialog`);
    assert.equal(await dialog.getAttribute('data-settings-part'), 'sheet', `${engine}: ${how} opens the Settings sheet`);
    const frame = await dialog.locator('[data-ov-part="frame"]').boundingBox();
    assert.deepEqual([Math.round(frame.width), Math.round(frame.height)], [1060, 640], `${engine}: ${how}: the sheet is 1060 by 640 px`);
    assert.ok(Math.abs(frame.x + frame.width / 2 - 720) <= 1 && Math.abs(frame.y + frame.height / 2 - 450) <= 1, `${engine}: ${how}: and is centred in the window`);
    assert.equal(Math.round((await dialog.locator('[data-ov-part="header"]').boundingBox()).height), 41, `${engine}: ${how}: its header is 41 px`);
    assert.equal(await dialog.locator('[data-ov-part="header"]').getByRole('button', { name: 'Close', exact: true }).count(), 1, `${engine}: ${how}: and holds its Close`);
    assert.deepEqual(await nav.getByRole('button').allInnerTexts(), pages.map((entry) => entry.title), `${engine}: ${how}: the pages are the host's categories, in the design's order`);
    assert.equal(await onPage(), pages[0].id, `${engine}: ${how}: the sheet opens on the first page`);
    assert.deepEqual(await rowsDrawn(dialog), settingsRowsOf(snapshot, pages[0].id), `${engine}: ${how}: the rows are the host's own, with the host's labels`);
    assert.ok(await hasFocus(nav.locator('[aria-current="page"]')), `${engine}: ${how}: the focus is on the page that is on screen`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.ok(await c.until(5000, async () => hasFocus(origin)), `${engine}: Escape closes the sheet that ${how} opened and gives the focus back to the control that had it`);
  }

  // A toggle: pressed, applied on the host at once, and still applied after the page is reloaded (the reload is the sheet's own: a copy of the host's answer that forgets it makes the assertion fail).
  await chord();
  await dialog.waitFor();
  await toPage('Terminal');
  const blink = dialog.getByRole('switch', { name: 'Cursor Blink' });
  const reset = dialog.getByRole('button', { name: 'Reset Cursor Blink to default' });
  assert.equal(await blink.getAttribute('aria-checked'), 'true', `${engine}: the cursor blinks, which is the host's default`);
  assert.equal(await reset.count(), 0, `${engine}: and a row at its default has no Reset`);
  await blink.click();
  assert.ok(await c.until(5000, async () => (await c.held('terminal.cursorBlink')) === false), `${engine}: a toggle pressed in the sheet is applied on the host at once, with no Save`);
  await reset.waitFor();
  const reopen = async () => {
    await page.reload({ waitUntil: 'load' });
    await sheetByChord(page);
    await toPage('Terminal');
    await blink.waitFor();
  };
  const forgetsBlink = async (route, id) => {
    if (id !== SETTINGS_CALLS.snapshot) return false;
    const response = await route.fetch();
    const answer = await response.json();
    answer.categories.terminal.settings.cursorBlink.value = true;
    return answerWith(route, answer);
  };
  let putBack;
  await reopen();
  await asserting(
    'settings-persist',
    async () => {
      putBack = await standIn(page, forgetsBlink);
      await reopen();
    },
    async () => {
      await putBack();
      await reopen();
    },
    async () => {
      assert.equal(await blink.getAttribute('aria-checked'), 'false', `${engine}: a toggle applied in the sheet is still applied after the page is reloaded`);
    },
  );
  await reset.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.keyboard.press(`${mod}+Comma`);
  await dialog.waitFor();
  assert.equal(await onPage(), 'terminal', `${engine}: the sheet opens on the page it was left on`);
  await blink.click();
  assert.ok(await c.until(5000, async () => (await c.held('terminal.cursorBlink')) === true), `${engine}: pressed again, the toggle is applied again`);
  await reset.waitFor({ state: 'detached' });

  // A value the host refuses: its words in the lane, the typed text kept, the host's value untouched. Escape takes the draft first and closes the sheet second.
  await toPage('Developer Settings');
  const port = dialog.getByRole('spinbutton', { name: 'Host profiling port' });
  const lane = dialog.locator('[data-settings-row="developer.pprof_port"] [data-ov-part="lane"]');
  const kept = await c.held('developer.pprof_port');
  const refusal = await c.call(SETTINGS_SERVICE, 'Validate', { kind: 'host' }, 'developer.pprof_port', 70000);
  assert.equal(refusal.valid, false, `${engine}: the host refuses port 70000`);
  const refuse = async () => {
    if ((await port.inputValue()) !== String(kept)) await port.press('Escape');
    await port.fill('70000');
    await port.press('Enter');
    assert.ok(await c.until(10_000, async () => (await port.getAttribute('aria-invalid')) === 'true' && ((await lane.textContent()) ?? '') !== ''), `${engine}: a value the host refuses is marked invalid, with a word in its lane`);
  };
  const plantsWords = async (route, id) => (id === SETTINGS_CALLS.validate ? answerWith(route, { valid: false, code: 'planted', message: 'Planted words.' }) : false);
  await refuse();
  await asserting(
    'settings-words',
    async () => {
      putBack = await standIn(page, plantsWords);
      await refuse();
    },
    async () => {
      await putBack();
      await refuse();
    },
    async () => {
      assert.equal(await lane.textContent(), `Error: ${refusal.message}`, `${engine}: the lane says the host's own words for a value it refuses`);
    },
  );
  assert.equal(await port.inputValue(), '70000', `${engine}: the field keeps the text that was typed`);
  assert.equal(await c.held('developer.pprof_port'), kept, `${engine}: and the host keeps the port it had`);
  assert.ok(await c.until(5000, async () => (await dialog.locator('[data-settings-part="live"]').textContent()) === `Host profiling port: ${refusal.message}`), `${engine}: the sheet says the refusal in its own polite live region`);
  await port.press('Escape');
  assert.equal(await port.inputValue(), String(kept), `${engine}: Escape in a field with a refused draft takes the draft`);
  assert.equal(await dialog.count(), 1, `${engine}: and the sheet stays`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
}

/**
 * Part of s, the Settings window: what the native window of kind `settings` draws, in a browser page (`/?screen=settings-window`), with no shell and no dialog and a 41 px caption that moves the window and holds Close; it follows
 * the host's request (`OpenSettings` shows it, on the page it names; `HideSettings` hides it; shown again it asks the host what it holds now) and hides itself, by asking the host, on Escape, the close chord and Close.
 */
async function settingsWindow(c) {
  const { engine, base, asserting } = c;
  const snapshot = await c.snapshot();
  await c.call(WINDOW_SERVICE, 'HideSettings');
  const page = await c.page(1060, 640);
  const mac = await page.evaluate(() => navigator.platform.includes('Mac'));
  const mod = mac ? 'Meta' : 'Control';
  let asked = 0;
  page.on('request', (request) => {
    if (calledMethod(request) === SETTINGS_CALLS.snapshot) asked += 1;
  });
  await page.goto(`${base}/?screen=settings-window`, { waitUntil: 'load' });
  const frame = page.locator('[data-settings-part="window"]');
  const state = async () => c.call(WINDOW_SERVICE, 'GetSettingsState');
  const shown = async (want) => c.until(10_000, async () => (await frame.getAttribute('data-visible')) === String(want));
  const skipped = async () => frame.evaluate((element) => getComputedStyle(element).contentVisibility);
  const read = async () =>
    page.evaluate(() => {
      const caption = document.querySelector('[data-settings-part="caption"]');
      const close = caption?.querySelector('button');
      return {
        shell: document.querySelectorAll('[data-shell-part="window"]').length,
        dialogs: document.querySelectorAll('dialog').length,
        caption: caption === null ? null : { height: Math.round(caption.getBoundingClientRect().height), title: caption.querySelector('h1')?.textContent, close: close?.getAttribute('aria-label'), drag: getComputedStyle(caption).getPropertyValue('--wails-draggable').trim(), closeDrag: close === null || close === undefined ? '' : getComputedStyle(close).getPropertyValue('--wails-draggable').trim() },
        current: document.querySelector('[aria-current="page"]')?.getAttribute('data-settings-page'),
        rows: [...document.querySelectorAll('[data-settings-row]')].map((row) => ({ id: row.getAttribute('data-settings-row'), label: row.querySelector('label')?.textContent ?? '' })),
      };
    });
  const onPage = async (id) =>
    page.waitForFunction(
      (wanted) => document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible') === 'true' && document.querySelector('[aria-current="page"]')?.getAttribute('data-settings-page') === wanted && document.querySelectorAll('[data-settings-row]').length > 0,
      id,
      { timeout: 15_000 },
    );

  assert.ok(await shown(false), `${engine}: a window the host has not asked to show draws nothing visible`);
  assert.equal(await skipped(), 'hidden', `${engine}: its content is skipped, not laid out`);
  assert.equal(await c.show('/settings?category=terminal'), 'settings', `${engine}: the host answers OpenSettings with the window it shows`);
  await onPage('terminal');
  assert.deepEqual(
    await read(),
    { shell: 0, dialogs: 0, caption: { height: 41, title: 'Settings', close: 'Close', drag: 'drag', closeDrag: 'no-drag' }, current: 'terminal', rows: settingsRowsOf(snapshot, 'terminal') },
    `${engine}: the window draws the page the host named with the host's rows, and nothing of the shell: no shell, no dialog, a 41 px caption that moves the window, with a Close that does not`,
  );
  const first = await state();
  assert.deepEqual([first.target, first.visible], ['/settings?category=terminal', true], `${engine}: the host's request names the page and says it is shown`);
  await c.show('/settings?category=developer');
  await onPage('developer');
  const second = await state();
  assert.deepEqual([second.requestId - first.requestId, second.target], [1, '/settings?category=developer'], `${engine}: a second request makes a new request id and names another page`);
  assert.deepEqual((await read()).rows, settingsRowsOf(snapshot, 'developer'), `${engine}: and the window is on it, with the host's rows`);

  await c.call(WINDOW_SERVICE, 'HideSettings');
  assert.ok(await shown(false), `${engine}: HideSettings hides the window`);
  assert.equal(await skipped(), 'hidden', `${engine}: and its content is skipped`);
  assert.equal((await state()).visible, false, `${engine}: the host says it is hidden`);
  const before = asked;
  await c.show('');
  assert.ok(await shown(true), `${engine}: an empty request shows it again`);
  assert.equal((await read()).current, 'developer', `${engine}: on the page it was left on`);
  assert.equal((await state()).requestId, second.requestId, `${engine}: an empty request makes no new request id`);
  assert.ok(await c.until(5000, async () => asked > before), `${engine}: a window shown again asks the host what it holds now`);

  // Three ways to close it, each of them by asking the host: the Escape is the one with a control.
  const show = async () => {
    await c.show('');
    assert.ok(await shown(true), `${engine}: the window is shown`);
  };
  const hidByHost = async () => c.until(5000, async () => (await state()).visible === false);
  const swallowsHide = async (route, id) => (id === SETTINGS_CALLS.hide ? answerWith(route, '{}') : false);
  let putBack;
  const closers = [
    { how: 'Escape', press: async () => page.keyboard.press('Escape') },
    { how: 'the close chord', press: async () => page.keyboard.press(`${mod}+KeyW`) },
    { how: 'Close', press: async () => page.getByRole('button', { name: 'Close', exact: true }).click() },
  ];
  for (const { how, press } of closers) {
    await show();
    await press();
    if (how === 'Escape') {
      await asserting(
        'settings-hide',
        async () => {
          putBack = await standIn(page, swallowsHide);
          await show();
          await press();
        },
        async () => {
          await putBack();
          await show();
          await press();
        },
        async () => {
          assert.ok(await hidByHost(), `${engine}: Escape in the Settings window asks the host to hide it`);
        },
      );
    } else {
      assert.ok(await hidByHost(), `${engine}: ${how} in the Settings window asks the host to hide it`);
    }

    assert.ok(await shown(false), `${engine}: ${how}: and the window draws nothing visible`);
  }
}

/**
 * Part of s, the two together: the sheet in one page and the Settings window in another, on one host. A change in either reaches the other through the host's `settings/changed` within 2 s (the milliseconds are reported),
 * and a draft typed in the sheet is not replaced when the window changes another setting.
 */
async function settingsTruth(c) {
  const { engine, base, asserting } = c;
  await c.commit({ 'terminal.cursorBlink': true });
  const sheet = await c.page(1440, 900);
  await open(sheet, base);
  const dialog = await sheetByChord(sheet);
  await dialog.getByRole('navigation', { name: 'Settings pages' }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const windowPage = await c.page(1060, 640);
  await windowPage.goto(`${base}/?screen=settings-window`, { waitUntil: 'load' });
  await c.show('/settings?category=terminal');
  await windowPage.waitForFunction(
    () => document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible') === 'true' && document.querySelector('[aria-current="page"]')?.getAttribute('data-settings-page') === 'terminal' && document.querySelectorAll('[data-settings-row]').length > 0,
    null,
    { timeout: 15_000 },
  );
  const toggle = '[data-settings-row="terminal.cursorBlink"] [role="switch"]';
  const inSheet = dialog.locator(toggle);
  const inWindow = windowPage.locator(toggle);
  // What the last press asked the host for: the toggle flips, so it is the opposite of what the pressed page showed BEFORE the press. The host is not read after the click (the click returns before the commit has reached the host, and a
  // read in between gives the old value, which the other page may already have left: a false "did not arrive", seen in 3 of about 160 changes by the review of #662). The host's committed state is waited for, then the other page's, which
  // shows it within `ms` and is polled every 20 ms on the page's own clock.
  let asked = '';
  const reaches = async (page, ms) => {
    await c.until(5000, async () => String(await c.held('terminal.cursorBlink')) === asked);
    return page.waitForFunction(({ selector, wanted }) => document.querySelector(selector)?.getAttribute('aria-checked') === wanted, { selector: toggle, wanted: asked }, { polling: 20, timeout: ms }).then(
      () => true,
      () => false,
    );
  };
  // The clock starts when the press has been delivered: what is measured is the way from one page to the other through the host, not the time the engine takes to find the button stable.
  // A miss is told apart, so that a failure says what happened and is not a bare timeout: LATE (it arrived, and about how late) or NEVER (30 s more, and what the host holds and what the page shows).
  const describeMiss = async (page) => {
    const started = Date.now();
    const value = String(await c.held('terminal.cursorBlink'));
    const arrived = await page
      .waitForFunction(({ selector, wanted }) => document.querySelector(selector)?.getAttribute('aria-checked') === wanted, { selector: toggle, wanted: value }, { polling: 100, timeout: 30_000 })
      .then(() => true, () => false);
    const shown = await page.locator(toggle).getAttribute('aria-checked');
    return arrived ? `it arrived LATE, ${String(2000 + Date.now() - started)} ms after the press at the most` : `it NEVER arrived (30 s more): the host holds ${value} and the page shows ${String(shown)}`;
  };
  let pressedAt = 0;
  const press = async (locator) => {
    asked = (await locator.getAttribute('aria-checked')) === 'true' ? 'false' : 'true';
    await locator.click();
    pressedAt = Date.now();
  };
  const change = async () => press(inWindow);
  const lag = { toSheet: 0, toWindow: 0 };
  const reachesSheet = async () => {
    const reached = await reaches(sheet, 2000);
    lag.toSheet = Date.now() - pressedAt;
    assert.ok(reached && lag.toSheet < 2000, `${engine}: a change made in the Settings window reaches the sheet within 2 s (${reached ? `${String(lag.toSheet)} ms` : await describeMiss(sheet)})`);
  };
  const staleSnapshot = (text) => async (route, id) => (id === SETTINGS_CALLS.snapshot ? answerWith(route, text) : false);
  let putBack;
  await change();
  await asserting(
    'settings-reach',
    async () => {
      putBack = await standIn(sheet, staleSnapshot(JSON.stringify(await c.snapshot())));
      await change();
    },
    async () => {
      await putBack();
      await change();
    },
    reachesSheet,
  );
  await press(inSheet);
  const reached = await reaches(windowPage, 2000);
  lag.toWindow = Date.now() - pressedAt;
  assert.ok(reached && lag.toWindow < 2000, `${engine}: a change made in the sheet reaches the Settings window within 2 s (${reached ? `${String(lag.toWindow)} ms` : await describeMiss(windowPage)})`);
  console.log(`${engine}: a change made in the Settings window reached the sheet in ${String(lag.toSheet)} ms, and a change made in the sheet reached the window in ${String(lag.toWindow)} ms (the bound is 2000)`);

  // A draft in the sheet, and the window changes a different setting: the sheet takes the change and keeps the draft.
  const shell = dialog.getByRole('textbox', { name: 'Default Shell' });
  const lane = dialog.locator('[data-settings-row="terminal.defaultShell"] [data-ov-part="lane"]');
  const had = await c.held('terminal.defaultShell');
  const draft = '/bin/ba';
  await shell.fill(draft);
  await change();
  assert.ok(await reaches(sheet, 2000), `${engine}: the sheet that holds a draft follows a change made in the window`);
  await asserting(
    'settings-draft',
    async () => {
      await shell.fill('/bin/clobbered');
    },
    async () => {
      await shell.fill(draft);
    },
    async () => {
      assert.equal(await shell.inputValue(), draft, `${engine}: a draft typed in the sheet is not replaced by a change made in the window`);
    },
  );
  assert.equal(await c.held('terminal.defaultShell'), had, `${engine}: the host keeps the shell it had: the draft was never sent`);
  assert.equal(((await lane.textContent()) ?? '').trim(), '', `${engine}: and the draft's row says nothing of a change elsewhere: the setting that changed is another`);
  await shell.press('Escape');
  assert.equal(await shell.inputValue(), had, `${engine}: Escape takes the draft`);
  assert.equal(await dialog.count(), 1, `${engine}: and the sheet stays`);
  await c.commit({ 'terminal.cursorBlink': true });
}

/**
 * Part of s, the slots: a Settings window page opened and closed 100 times in a row (goto, wait for its rows, close the page). The realm of the host's window service refuses a 64th LIVE window and retires a closed page after about
 * 3.4 s (INV2): every one of the 100 reads its rows, and the window service lists the windows it listed before the first. Reports the seconds.
 */
async function settingsSlots(c) {
  const { engine, base, asserting } = c;
  const PAGES = 100;
  await c.show('/settings?category=terminal');
  const expected = settingsRowsOf(await c.snapshot(), 'terminal').map((row) => row.id);
  const windows = async () => (await c.call(WINDOW_SERVICE, 'List')).map((entry) => `${entry.name}:${entry.kind}`).sort();
  const baseline = await windows();
  let refused = false;
  const refusal = async (route, id) => (id === SETTINGS_CALLS.snapshot ? answerWith(route, { message: 'The operation exceeds a host resource limit.', code: 'RESOURCE_LIMIT' }, 429) : false);
  const read = async (number) => {
    const page = await c.page(1060, 640);
    try {
      if (refused) await standIn(page, refusal);
      await page.goto(`${base}/?screen=settings-window`, { waitUntil: 'load' });
      await page.waitForFunction(() => (document.querySelector('[aria-current="page"]')?.getAttribute('data-settings-page') === 'terminal' && document.querySelectorAll('[data-settings-row]').length > 0) || document.querySelector('[data-settings-state="failed"]') !== null, null, { timeout: 30_000 });
      assert.deepEqual(
        await page.locator('[data-settings-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-settings-row'))),
        expected,
        `${engine}: window page ${String(number)} of ${String(PAGES)} read its rows`,
      );
    } finally {
      await page.close();
    }
  };
  // The control plants the realm's refusal in the 64th page and needs no page after it.
  const limit = CONTROL === 'settings-slots' ? 64 : PAGES;
  const started = Date.now();
  for (let number = 1; number <= limit; number += 1) {
    if (number === 64) {
      await asserting(
        'settings-slots',
        async () => {
          refused = true;
        },
        async () => {
          refused = false;
        },
        async () => read(number),
      );
    } else {
      await read(number);
    }
  }

  const seconds = (Date.now() - started) / 1000;
  assert.deepEqual(await windows(), baseline, `${engine}: the window service lists the windows it listed before the pages: they are the browser's, not the host's`);
  console.log(`${engine}: ${String(limit)} Settings window pages opened and closed one after another in ${seconds.toFixed(1)} s (${((seconds * 1000) / limit).toFixed(0)} ms a page), every one read its rows; the window service lists ${baseline.join(', ')} as before`);
}

/**
 * Part of s, the secrets. The host declares three sensitive settings, all in Telemetry (`internal/settings/telemetry.go`: the OTLP, Loki and OTLP-log auth values), and its snapshot says for each whether it holds a value (`stored`) and
 * never what the value is. One is saved through the sheet, reads as saved after a reload, and is cleared by its Reset; at every step its text is nowhere in the document, in the host's snapshot or in the host's log.
 */
async function settingsSecrets(c) {
  const { engine, host, base, asserting } = c;
  const ID = 'telemetry.auth_value';
  const SECRET = `seam-secret-${crypto.randomUUID()}`;
  c.secrets.push(SECRET);
  const snapshot = await c.snapshot();
  const sensitive = Object.entries(snapshot.categories)
    .flatMap(([category, entry]) => Object.entries(entry.settings).filter(([, setting]) => setting.sensitive === true || setting.type === 'password').map(([key]) => `${category}.${key}`))
    .sort();
  assert.ok(sensitive.includes(ID), `${engine}: the host declares ${ID} as a sensitive setting (it declares ${sensitive.join(', ')})`);
  assert.deepEqual(Object.keys(snapshot.stored ?? {}).sort(), sensitive, `${engine}: the snapshot says whether each sensitive setting holds a value, and no other`);
  for (const id of sensitive) {
    const [category, key] = id.split('.');
    const { value, default: initial } = snapshot.categories[category].settings[key];
    assert.deepEqual([value, initial, snapshot.stored[id]], [null, null, false], `${engine}: ${id} carries no value and no default, and the host holds none`);
  }

  const page = await c.page(1440, 900);
  await open(page, base);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const row = dialog.locator(`[data-settings-row="${ID}"]`);
  const reopen = async () => {
    await sheetByChord(page);
    await dialog.getByRole('navigation', { name: 'Settings pages' }).getByRole('button', { name: 'Telemetry', exact: true }).click();
    await row.waitFor();
  };
  const field = row.locator('[data-ov-part="secret"]');
  const input = row.locator('input');
  const saved = async () => ({ state: await field.getAttribute('data-ov-state'), placeholder: await input.getAttribute('placeholder') });
  const reads = {
    document: async () => page.evaluate(() => `${document.documentElement.outerHTML}\n${[...document.querySelectorAll('input, textarea')].map((control) => control.value).join('\n')}`),
    snapshot: async () => JSON.stringify(await c.snapshot()),
    log: async () => host.output(),
  };
  const noneInDocument = async () => {
    assert.ok(!(await reads.document()).includes(SECRET), `${engine}: the secret is nowhere in the document`);
  };
  const noneInLog = async () => {
    assert.ok(!(await reads.log()).includes(SECRET), `${engine}: the secret is not in the host's log`);
  };
  // The three places the secret must not be in. The first time they are read, the controls plant the text in two of them in turn; every other time they are read as they stand.
  const holdsNone = async (controlled) => {
    assert.ok(!(await reads.snapshot()).includes(SECRET), `${engine}: the secret is not in the host's snapshot`);
    if (!controlled) {
      await noneInDocument();
      await noneInLog();
      return;
    }

    await asserting(
      'settings-secret-dom',
      async () => {
        await page.evaluate((text) => {
          const planted = document.createElement('i');
          planted.id = 'seam-planted';
          planted.textContent = text;
          document.body.append(planted);
        }, SECRET);
      },
      async () => {
        await page.evaluate(() => {
          document.getElementById('seam-planted')?.remove();
        });
      },
      noneInDocument,
    );
    await asserting(
      'settings-secret-log',
      async () => {
        reads.log = async () => `${host.output()}\n${SECRET}`;
      },
      async () => {
        reads.log = async () => host.output();
      },
      noneInLog,
    );
  };
  await reopen();
  assert.deepEqual(await saved(), { state: 'unset', placeholder: 'Not set' }, `${engine}: a secret the host holds no value for reads Not set`);
  await input.fill(SECRET);
  await input.press('Enter');
  assert.ok(await c.until(10_000, async () => (await field.getAttribute('data-ov-state')) === 'locked'), `${engine}: a secret typed in the sheet and committed with Enter is saved`);
  assert.equal(await input.inputValue(), '', `${engine}: the field lets go of the text it was given`);
  assert.equal((await c.snapshot()).stored[ID], true, `${engine}: and the host holds the value`);
  await holdsNone(true);

  const forgetsStored = async (route, id) => {
    if (id !== SETTINGS_CALLS.snapshot) return false;
    const response = await route.fetch();
    const answer = await response.json();
    answer.stored[ID] = false;
    return answerWith(route, answer);
  };
  let putBack;
  await page.reload({ waitUntil: 'load' });
  await reopen();
  await asserting(
    'settings-secret-saved',
    async () => {
      putBack = await standIn(page, forgetsStored);
      await page.reload({ waitUntil: 'load' });
      await reopen();
    },
    async () => {
      await putBack();
      await page.reload({ waitUntil: 'load' });
      await reopen();
    },
    async () => {
      assert.deepEqual(await saved(), { state: 'locked', placeholder: 'Saved · hidden' }, `${engine}: after a reload the secret row says Saved · hidden`);
    },
  );
  await holdsNone();

  await row.getByRole('button', { name: /^Reset .* to default$/ }).click();
  assert.ok(await c.until(10_000, async () => (await field.getAttribute('data-ov-state')) === 'unset'), `${engine}: a cleared secret reads as not saved`);
  assert.deepEqual(await saved(), { state: 'unset', placeholder: 'Not set' }, `${engine}: and says Not set`);
  assert.ok(await c.until(5000, async () => (await c.snapshot()).stored[ID] === false), `${engine}: the host holds no value`);
  await holdsNone();
}

/**
 * Part of s, the popups of the open sheet. A row that differs from its default draws a Reset: hovered, its tooltip (the kit's one TooltipHost popover, which lives outside the dialog) is open, is not inert, lies inside the
 * viewport and is painted above the sheet; a native select inside the sheet takes type-ahead. The tooltip cannot be hit-tested here: a modal dialog blocks the rest of the document for hit-testing, a popover that is opened after
 * it included (`document.elementFromPoint` at the tooltip's centre answers the row under it, in both engines, and answers the tooltip itself when no dialog is open), so what is on top is read from the pixels: the part of the
 * tooltip that lies over the sheet is a picture that changes when the tooltip goes.
 */
async function settingsPopups(c) {
  const { engine, base, asserting } = c;
  await c.commit({ 'terminal.cursorBlink': false, 'appearance.density': 'comfortable' });
  const page = await c.page(1440, 900);
  await open(page, base);
  const dialog = await sheetByChord(page);
  const toPage = async (title) => dialog.getByRole('navigation', { name: 'Settings pages' }).getByRole('button', { name: title, exact: true }).click();
  await toPage('Terminal');
  const reset = dialog.getByRole('button', { name: 'Reset Cursor Blink to default' });
  await reset.waitFor();
  const tipSelector = '[role="tooltip"][popover]';
  const tip = page.locator(tipSelector);
  let facts;
  let shown;
  let hidden;
  let inside;
  const paint = async (covered) => {
    await reset.hover();
    await page.waitForFunction((selector) => document.querySelector(selector)?.matches(':popover-open') === true, tipSelector, { timeout: 10_000 });
    facts = await tip.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { open: element.matches(':popover-open'), text: element.textContent, inert: element.inert || element.closest('[inert]') !== null, box: { x: box.x, y: box.y, width: box.width, height: box.height }, viewport: { width: innerWidth, height: innerHeight } };
    });
    inside = overlap(facts.box, await dialog.locator('[data-ov-part="frame"]').boundingBox());
    assert.ok(inside !== undefined && inside.width >= 20 && inside.height >= 20, `${engine}: the tooltip lies over the sheet, so that what is on top shows in the pixels`);
    const clip = { x: Math.ceil(inside.x), y: Math.ceil(inside.y), width: Math.floor(inside.width) - 1, height: Math.floor(inside.height) - 1 };
    if (covered) {
      // Something shown after the tooltip, as a tooltip that the sheet covers would be.
      await page.evaluate(() => {
        const cover = document.createElement('div');
        cover.id = 'seam-cover';
        cover.setAttribute('popover', 'manual');
        cover.style.cssText = 'position:fixed;inset:0;margin:0;padding:0;border:0;width:100vw;height:100vh;background:rgb(255,0,255)';
        document.body.append(cover);
        cover.showPopover();
      });
    }

    shown = await stillPicture(page, clip, engine);
    await page.mouse.move(5, 5);
    await page.waitForFunction((selector) => document.querySelector(selector)?.matches(':popover-open') !== true, tipSelector, { timeout: 10_000 });
    hidden = await stillPicture(page, clip, engine);
    if (covered) {
      await page.evaluate(() => {
        const cover = document.getElementById('seam-cover');
        cover?.hidePopover();
        cover?.remove();
      });
    }
  };
  await paint(false);
  assert.equal(facts.open, true, `${engine}: the tooltip of the Reset button is open inside the open sheet (:popover-open)`);
  assert.equal(facts.text, 'Reset Cursor Blink to default', `${engine}: and says what the button does`);
  assert.equal(facts.inert, false, `${engine}: the tooltip is not inert`);
  assert.ok(facts.box.x >= 0 && facts.box.y >= 0 && facts.box.x + facts.box.width <= facts.viewport.width && facts.box.y + facts.box.height <= facts.viewport.height, `${engine}: and lies inside the viewport`);
  await asserting(
    'settings-tooltip',
    async () => paint(true),
    async () => paint(false),
    async () => {
      assert.ok(!shown.equals(hidden), `${engine}: the tooltip is painted above the sheet: the pixels under it change when it goes`);
    },
  );

  // Type-ahead in a native select inside the sheet: the first letters of an option choose it, and the host takes the choice.
  await toPage('Appearance');
  const density = dialog.locator('[data-settings-row="appearance.density"] select');
  const typeAhead = async () => {
    await c.commit({ 'appearance.density': 'comfortable' });
    assert.ok(await c.until(5000, async () => (await density.inputValue()) === 'comfortable'), `${engine}: the sheet follows the host to the first option of the select`);
    await density.focus();
    await page.keyboard.type('Compa', { delay: 30 });
  };
  await typeAhead();
  await asserting(
    'settings-typeahead',
    async () => {
      await density.evaluate((element) => {
        element.disabled = true;
      });
      await typeAhead();
    },
    async () => {
      await density.evaluate((element) => {
        element.disabled = false;
      });
      await typeAhead();
    },
    async () => {
      assert.equal(await density.inputValue(), 'compact', `${engine}: typing the first letters of an option in the sheet's select chooses it`);
    },
  );
  assert.ok(await c.until(5000, async () => (await c.held('appearance.density')) === 'compact'), `${engine}: and the host holds the choice`);
  await c.commit({ 'terminal.cursorBlink': true, 'appearance.density': 'comfortable' });
}

/** Part of s, the watch over errors, after the others: no page of the scenario wrote an error, the host's log holds no settings error, and none of the secrets that were typed is in it. */
async function settingsLog(c) {
  const { engine, host, errors, secrets, asserting } = c;
  let scratch;
  let planted = '';
  const logged = () =>
    `${host.output()}${planted}`
      .split('\n')
      .filter((line) => /\[settings\]|window realm refused/.test(line) || (/\b(ERROR|WARN|FATAL|PANIC)\b/.test(line) && /settings/i.test(line)));
  let at = 0;
  await asserting(
    'settings-error',
    async () => {
      at = errors.length;
      scratch = await c.page(800, 600);
      await scratch.evaluate(() => {
        setTimeout(() => {
          throw new Error('planted page error');
        }, 0);
      });
      assert.ok(await c.until(5000, async () => errors.length > at), `${engine}: the planted page error was heard`);
    },
    async () => {
      errors.splice(at);
      await scratch.close();
    },
    async () => {
      assert.deepEqual(errors, [], `${engine}: no page of the scenario wrote an error`);
    },
  );
  await asserting(
    'settings-log',
    async () => {
      planted = '\n2026-11-22T00:00:00.000+0000\tERROR\tsettings persist failed\t{"planted": true}';
    },
    async () => {
      planted = '';
    },
    async () => {
      assert.deepEqual(logged(), [], `${engine}: the host's log holds no settings error`);
    },
  );
  for (const secret of secrets) assert.ok(!host.output().includes(secret), `${engine}: and none of the secrets that were typed is in it`);
}

/**
 * s. Settings (ST1) on the real host, in server mode, in six independent parts over a host of its own that has no plugins, then the watch over errors: the sheet (`settingsSheet`), the Settings window (`settingsWindow`), the two
 * together (`settingsTruth`), the slots (`settingsSlots`), the secrets (`settingsSecrets`), the popups of the sheet (`settingsPopups`) and the log (`settingsLog`). A part makes its own pages and leaves the host as it found it, so
 * that a negative control runs the part it belongs to alone. Every negative control of this scenario is made here, in turn, when SEAM_CONTROL asks (`withControls`; SETTINGS_PARTS).
 */
async function checkSettings(browser, engine, work) {
  const dir = await mkdtemp(path.join(work, `settings-${engine}-`));
  const host = await startHost(dir, await freePort(), undefined, async () => []);
  const exited = new Promise((resolve) => host.child.once('exit', resolve));
  const { asserting, verdict } = withControls(SETTINGS_GROUP, CONTROLS);
  const pages = [];
  const call = async (service, method, ...args) => callBound(host.base, service, method, ...args);
  const snapshot = async () => call(SETTINGS_SERVICE, 'GetSnapshot', { kind: 'host' });
  const c = {
    engine,
    host,
    base: host.base,
    asserting,
    errors: [],
    secrets: [],
    call,
    snapshot,
    commit: async (values) => call(SETTINGS_SERVICE, 'Commit', { kind: 'host' }, values),
    // OpenSettings answers with the name of the window it shows, as plain text (the other answers are JSON).
    show: async (target) => {
      const { status, text } = await tryBound(host.base, WINDOW_SERVICE, 'OpenSettings', target);
      assert.equal(status, 200, `${engine}: OpenSettings was answered ${String(status)}: ${text}`);
      return text;
    },
    held: async (id) => {
      const [category, key] = id.split('.');
      return (await snapshot()).categories[category].settings[key].value;
    },
    // Polls `ready` until it answers true or `ms` have passed: whether it did, so that the assertion says its own words.
    until: async (ms, ready) => {
      const deadline = Date.now() + ms;
      for (;;) {
        if (await ready()) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    // A page of the engine, whose errors are kept: a script error, and a console error that Settings itself wrote (`[settings] ...`).
    page: async (width, height) => {
      const page = await browser.newPage({ viewport: { width, height } });
      pages.push(page);
      page.on('pageerror', (error) => c.errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error' && message.text().startsWith('[settings]')) c.errors.push(`console: ${message.text()}`);
      });
      return page;
    },
  };
  const only = SETTINGS_PARTS[CONTROL];
  const started = Date.now();
  try {
    for (const [name, part] of [['sheet', settingsSheet], ['window', settingsWindow], ['truth', settingsTruth], ['slots', settingsSlots], ['secrets', settingsSecrets], ['popups', settingsPopups]]) {
      if (only !== undefined && only !== name) continue;
      const partStarted = Date.now();
      try {
        await part(c);
      } finally {
        for (const page of pages.splice(0)) if (!page.isClosed()) await page.close();
      }

      console.log(`${engine}: settings, the ${name} part: ${((Date.now() - partStarted) / 1000).toFixed(1)} s`);
    }

    await settingsLog(c);
    verdict(engine);
    console.log(`${engine}: scenario s (Settings) ran in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    for (const page of pages.splice(0)) if (!page.isClosed()) await page.close();
    host.child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8000))]);
  }
}

const work = await mkdtemp(path.join(os.tmpdir(), 'omniview-seam-'));
let host;
try {
  const port = await freePort();
  host = await startHost(work, port);
  // What the build wrote: the healthy bundle imports only what the host serves, the copy lacks the kit, the old one needs the old library.
  const dependencies = Object.fromEntries(host.built.map(({ id, dependencies: names }) => [id, names]));
  for (const name of dependencies[OK]) assert.ok(SHARED_SPECIFIERS_V1.includes(name), `${OK} imports ${name}, which is not on the shared list`);
  assert.ok(dependencies[OK].includes('@omniviewdev/kit') && !dependencies[DUP].includes('@omniviewdev/kit'));
  assert.deepEqual(dependencies[OLD], ['@omniviewdev/base-ui']);
  const bytes = (await readFile(path.join(work, 'home/.omniview-feature-ui-next/plugins', OK, 'assets/entry.js'))).length;

  /** Stops the host, which writes its state root, and starts it again over the same one: what quitting the app and opening it again does to the host. */
  const restart = async () => {
    const stopped = host;
    stopped.child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (stopped.child.exitCode !== null) resolve();
      else stopped.child.once('exit', resolve);
      setTimeout(resolve, 8000);
    });
    host = await startHost(work, port, stopped.built);
  };

  /** The fixture's process, built once for every host scenario n starts (the Go build is the one thing in this check that is not about a page). */
  let processBinary;
  const processFixture = async () => (processBinary ??= await buildProcess(path.join(work, 'process-binary')));

  // ENGINES=webkit (or chromium) runs one engine, for a developer who is chasing one.
  for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]].filter(([name]) => (process.env.ENGINES ?? 'webkit,chromium').split(',').includes(name))) {
    const browser = await engine.launch();
    failedRequests.length = 0;
    // Every page of the engine's run, whoever opens it, has its failed requests recorded (`watchRequests`).
    const openPage = browser.newPage.bind(browser);
    browser.newPage = async (...options) => {
      const page = await openPage(...options);
      watchRequests(page);
      return page;
    };
    try {
      // SEAM_PROVIDERS_REPEAT=<n> runs scenario l alone, n times in a row, for a developer who is chasing a flake of it (the order of two plugins' sections that load together was found this way, on a loaded machine).
      if (process.env.SEAM_PROVIDERS_REPEAT !== undefined) {
        for (let run = 0; run < Number(process.env.SEAM_PROVIDERS_REPEAT); run += 1) {
          await checkProviders(await freshPage(browser, host.base), host.base, name);
          console.log(`providers ${name} run ${String(run)} ok`);
        }

        continue;
      }

      // SEAM_PANEL_REPEAT=<n> runs scenarios h and h2 alone, n times in a row, for a developer who is chasing a flake of them (R2: two plugins' tools that tied in `order` were in the order the plugins finished loading in, which failed one run in
      // CI and passed on the rerun). h2 forces the end h reaches by chance; on a loaded machine h reaches both.
      if (process.env.SEAM_PANEL_REPEAT !== undefined) {
        for (let run = 0; run < Number(process.env.SEAM_PANEL_REPEAT); run += 1) {
          for (const [label, check] of [['panel', checkPanel], ['panel-late', checkPanelLate]]) {
            const page = await freshPage(browser, host.base);
            await check(page, host.base, name);
            await page.close();
            console.log(`${label} ${name} run ${String(run)} ok`);
          }
        }

        continue;
      }

      if (CONTROL === SETTINGS_GROUP || SETTINGS_PARTS[CONTROL] !== undefined) {
        // The negative controls of scenario s: it runs alone, once (the part the control belongs to, or every part for the group), with the perturbations of the controls asked for, and says for each whether its own assertion saw it (`checkSettings`).
        try {
          await checkSettings(browser, name, work);
        } catch (error) {
          console.error(String(error?.message ?? error));
          process.exitCode = 1;
        }

        continue;
      }

      if (ONLY === PAGE_GROUP || CONTROL === PAGE_GROUP || PAGE_CONTROLS[CONTROL] !== undefined) {
        // Scenario t alone: clean under SEAM_ONLY, and under SEAM_CONTROL with the perturbations of the controls asked for, saying for each whether its own assertion saw it (`checkPluginsPage`). It runs as a phase, so the requests that fail are held to the allow-list as in a full run.
        try {
          await phase(PAGE_GROUP, name, async () => checkPluginsPage(browser, name, await processFixture(), work));
        } catch (error) {
          console.error(String(error?.message ?? error));
          process.exitCode = 1;
        }

        continue;
      }

      if (CONTROL === FAILED_GROUP || FAILED_CONTROLS[CONTROL] !== undefined) {
        // The negative controls of scenario p: it runs alone, once, with the perturbations of the controls asked for, and says for each whether its own assertion saw it (`checkFailedLoad`).
        try {
          await checkFailedLoad(browser, name, await processFixture(), work);
        } catch (error) {
          console.error(String(error?.message ?? error));
          process.exitCode = 1;
        }

        continue;
      }

      if (CONTROL === 'process' || PROCESS_CONTROLS[CONTROL] !== undefined) {
        // The negative controls of scenario n: it runs alone, once, with the perturbations of the controls asked for, and says for each whether its own assertion saw it (`checkProcess`).
        try {
          await checkProcess(browser, name, await processFixture(), work);
        } catch (error) {
          console.error(String(error?.message ?? error));
          process.exitCode = 1;
        }

        continue;
      }

      if (CONTROL === RUNTIME_CONTROL) {
        // The negative control of the watch over failed requests: one planted 422 in a clean page, and the phase's assertion must see it.
        try {
          await checkRuntimeWatch(await freshPage(browser, host.base), host.base, name);
        } catch (error) {
          console.error(String(error?.message ?? error));
          process.exitCode = 1;
        }

        continue;
      }

      if (CONTROL !== '') {
        // A negative control runs the scenario it belongs to (k or m) alone with one perturbation, and passes when the assertion it is named for saw it.
        const scenario = IDENTITY_CONTROLS.includes(CONTROL) ? checkIdentity : checkKept;
        try {
          await scenario(await freshPage(browser, host.base), host.base, name);
          console.error(`NEGATIVE CONTROL "${CONTROL}": NOT DETECTED in ${name}`);
          process.exitCode = 1;
        } catch (error) {
          const message = String(error?.message ?? error);
          if (CONTROLS[CONTROL].test(message)) console.log(`NEGATIVE CONTROL "${CONTROL}": detected in ${name}: ${message.split('\n')[0]}`);
          else {
            console.error(`NEGATIVE CONTROL "${CONTROL}": failed in ${name}, but not the assertion it is named for: ${message}`);
            process.exitCode = 1;
          }
        }

        continue;
      }

      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await phase('healthy', name, async () => {
        await checkHealthy(page, host.base, name);
        await checkRefusals(page, host.base, name);
        await page.close();
      });
      await phase('rail', name, async () => checkRail(await freshPage(browser, host.base), host.base, name));
      await phase('panel', name, async () => checkPanel(await freshPage(browser, host.base), host.base, name));
      await phase('panel-late', name, async () => checkPanelLate(await freshPage(browser, host.base), host.base, name));
      await phase('logs', name, async () => checkLogs(await freshPage(browser, host.base), host.base, name));
      await phase('palette', name, async () => checkPalette(await freshPage(browser, host.base), host.base, name));
      await phase('twins', name, async () => checkTwins(await freshPage(browser, host.base), host.base, name));
      await phase('connection', name, async () => checkConnection(await freshPage(browser, host.base), host.base, name));
      await phase('providers', name, async () => checkProviders(await freshPage(browser, host.base), host.base, name));
      await phase('kept', name, async () => checkKept(await freshPage(browser, host.base), host.base, name));
      await phase('identity', name, async () => checkIdentity(await freshPage(browser, host.base), host.base, name));
      await phase('toasts', name, async () => checkToasts(await freshPage(browser, host.base), host.base, name));
      await phase('centre', name, async () => checkCentre(await freshPage(browser, host.base), host.base, name));
      await phase('settings', name, async () => checkSettings(browser, name, work));
      await phase('session', name, () => checkSession(browser, () => host, restart, name));
      await phase('process', name, async () => checkProcess(browser, name, await processFixture(), work));
      await phase('failed-load', name, async () => checkFailedLoad(browser, name, await processFixture(), work));
      await phase('plugins-page', name, async () => checkPluginsPage(browser, name, await processFixture(), work));
      console.log(`PASS ${name}: contribute (sidebar entry, page, no route), one React and one kit, the control fails, containment, refusal, named states, the rail, the empty window, the bottom panel, the command palette, a failed page command's toast, the notification centre (the history read at the bell, one presenter, restored after a reload), the session (reload, restart, a plugin that is gone, a session kept aside), a plugin whose process is killed (the window drops it, keeps its Logs session and loads it again when the host says it runs), a plugin whose load fails (the window says so, Retry asks the host and ends in what it says, bounded by the loader's timeout), the Plugins page (the list is the host's inventory; a reload, a disable and an enable, an enable that leaves a plugin on and not started, a process killed by its pid and an uninstall are each read from the host's events, in two windows, with no raw text of the host or of a plugin on screen)`);
    } finally {
      await browser.close();
    }
  }

  console.log(`bundle ${OK}/assets/entry.js ${String(bytes)} B, imports [${dependencies[OK].join(', ')}]`);
} catch (error) {
  console.error(String(error?.stack ?? error));
  if (host !== undefined) console.error(`--- host output (tail)\n${host.tail()}`);
  process.exitCode = 1;
} finally {
  host?.child.kill();
  await new Promise((resolve) => {
    if (host === undefined || host.child.exitCode !== null) resolve();
    else host.child.once('exit', resolve);
    setTimeout(resolve, 8000);
  });
  await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
