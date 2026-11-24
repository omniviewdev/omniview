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
//      change of another setting made in the window. The events connection (a window page that is looked at all the while): its socket is dropped, a setting is changed from the host before the runtime opens another one, and the page shows the host's value once it is back, and follows the next change. The slots: 100 window pages opened and closed one after another all read their rows, and the window service lists the windows it listed before (the realm refuses a 64th LIVE
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
//   u  the connections (HM1), over the real host, on a host of its own whose plugin `fixture-f-conn` has a PROCESS that serves two connections (`north` starts in about 300 ms; `south` starts as the file `connection-mode` next to the plugin's binary says:
//      none, `unauthorized` or `unreachable`, which the host answers with a 422). Four windows, each with nothing saved. A: the empty window is Home and lists both connections as the host says them (Disconnected: nothing was started); rule R4: the
//      plugin's entry, with two connections and none used, opens a Home tab and no Items tab, and on Home it moves the focus to the plugin's connections; Home starts north (the start is held on its way: Connecting… on the row and no tab) and opens it in a
//      tab (Items; the chip is named Connection: north and the rows are north's) and says Connected; the chip's picker lists north (current, Connected) and south (Disconnected), type-to-filter says `No matches for "zz"`, Enter on south says Connecting…
//      on its row and then the picker closes with the focus on the chip, the chip and the rows are south's, no tab opened and Back does not return to north (the history entry was replaced). B: a Logs session started from the page's row through the host's
//      panel handle (decision A21) is still in the panel after the tab's connection changed, its card says Streaming and its lines keep coming, and closing it frees the plugin's feed. C: the palette has a row for each connection (`Connection: south,
//      Seam Connections · Disconnected`), found by its name, `switch` and `connection`; Enter has the host start it (the row is inert meanwhile) and moves the tab on screen to it; the command Home ranks first for `home` and opens a new Home tab each time.
//      D: a start the host refuses (south, `unauthorized`) says Needs sign-in and the host's sentence on the picker's row (the picker stays open, the tab stays on north, choosing north closes it), on Home's row (no tab opens) and in the palette (its footer
//      names the row and the reason, the row is inert while the host works and not after, Escape closes it with the window as it was); with the file gone the same choice starts south and goes to it, and `unreachable` says Not responding with its sentence.
//      Nothing in the window can stop a connection, so the check stops south as the host's operator (`StopConnection`) before each part that needs a start; the failed starts are the 422s of the allow-list. The plugin's process ends with the host's.
//      SEAM_ONLY=connections runs u alone; SEAM_CONTROL=connections runs it alone with every perturbation of its controls (CONNECTIONS_CONTROLS) made in turn just before the assertion each must trip (one run serves them all); SEAM_CONTROL=<one of
//      them> makes that one only, and SEAM_REMOVE=<one of them> leaves that control's assertion out, which must let its perturbation pass undetected
//
//   r  the Terminal tool on the host's own shell (T1, T2a), over the real host. Before the first terminal the emulator's code is not requested (no request for its chunk while the panel is open and says `No terminals`); `New terminal` starts a
//      shell of this machine (the host lists exactly one session), the code is fetched then, the emulator takes the keyboard (the person who pressed the button types) and a command with a known output is run: what the shell printed,
//      read from the host's own replay of the session (`AttachSession`: the GPU draws on a canvas, there is no text in the page), holds the output line of `echo SEAM_$((6*7))` and not only its echo. The session's tab is called by the shell
//      (`zsh`, `bash`: what the host answered to the call that started it, checked against what the shell says it is) and never Terminal, the emulator's input is `Terminal input, <name>` and the tool's own tab stays Terminal. The terminal starts
//      at the size the person sees: the call that starts it carries the rows and columns of the screen, the pty has them (`stty size` right after the first prompt) and they are the grid the emulator itself counts (asked of it with a cursor position report:
//      the rows exactly, the columns within one), and the page sends no resize after it
//      (no ResizeTerminal in the 90 frames after the first prompt); then the panel is raised with the End key on its handle and dragged shorter with the pointer, and each new size goes in a ResizeTerminal call. The page's input and size are ORDERED
//      calls on the wire: WriteTerminal and ResizeTerminal, never the legacy WriteSession and ResizeSession, with one sequence number for each call that counts up from 1 for each terminal, writes and resizes together. A keyboard user can always leave:
//      Escape stays in the shell, F6 moves the focus out of it, and on a Mac Command J hides the panel and gives the focus back to the page. Flow control, which the host paces the shell by (the page acknowledges every byte it parses, shown or hidden):
//      a flood of about 8 MB completes in the terminal that is on screen and the page's acknowledgements are the bytes of the flood; a flood of 50 MB completes with the panel HIDDEN (the hidden screen goes on reading, parsing and acknowledging, and
//      draws nothing): the shell is back at its prompt, the page acknowledged what it parsed, the host's own replay holds the end, shown again the end is in the emulator, and the shell answers a new command. A terminal that runs `sleep 60` asks when
//      it is closed (`Terminate session?`, naming the program as the host spells it once the host says `sleep`, Cancel has the focus); Cancel and Escape, whether the close was pressed with the pointer on the tab's close button or with Delete on the tab,
//      keep the session and the process and give the focus to the tab of that terminal (never to the close button, which only the pointer reaches); Terminate session ends both. A terminal at its prompt closes with no question (by the close button, and
//      by Delete, the page asking the host once what runs in it) and the focus goes to the tab that is left or to the tool's tab. A second terminal that runs `exit 3` is an ENDED session: its lane says `Exited with code 3` and `Input is off. Its output
//      stays readable here.`, the last line of the emulator is `[Process exited with code 3]`, its tab is announced as ended and stays, closing it asks nothing, and the host has no session left. No request failed and no page error was raised.
//   (r2 below r: the same terminal against the programs of the machine, `checkTerminalPrograms`, docs/ui-next/status/T1.md section 14.)
//
//   r3  a terminal outlives a reload of its page (T2b, `checkTerminalReattach`, docs/ui-next/status/T2-go.md), over the real host. The window's state holds a page key (a slot every page of the host shares), the terminal is opened with it, and a page that loads asks the host
//      for the terminals of its key and takes its saved tabs' terminals back. A reload in the middle of a session: the tab is back (the same name and place, running, never Connecting for good), the scrollback holds the markers written before it, `echo $$` prints the
//      same pid, typing works (the first numbered call after the attach carries exactly the `next_input_seq` the attach answered, which is one past the last number the first page sent; the numbers after it are consecutive, none is 0 and the host refuses none with SEQUENCE_STALE), the wire is one ListTerminals and one AttachTerminal (with the key and no offset) and no CreateTerminal, and the key is in no address and on no console line; the old window retired by the host while the new page's attach is on its way
//      (the page's DetachTerminal dropped, its attach held until the host says nobody holds the terminal and has told every window) tells the page nothing; two terminals come back in their order with their own shells and closing one ends its shell. A reload in the
//      middle of a flood of 3,000,000 numbered lines (about 26 MB through the pty): the end arrives, the lines the emulator holds at the end count up by one and the page acknowledged live bytes only; a slow stream across a reload is read in the emulator again and again, every reading counting up by one
//      at the join; a runaway producer (`yes`, which never ends) is read on after a reload and stopped by Control C typed in the terminal the page took back, the page acknowledging live bytes only. A full-screen program (the alternate screen of a program of the shell's own, one whose start has left the host's 1.25 MiB ring, and vim when the machine has it) is on the alternate screen with its text after the reload, and its end gives the shell back with
//      its earlier output. The seconds each took, the replay sizes and the words a person saw while the tab came back are told.
//   r4  one page holds a terminal at a time, and it does not outlive the host or its lease (T2b, `checkTerminalTakeover`). A second page of the same browser takes the terminal over: the first is told (`DETACHED` `taken-over`), says `Taken over by another tab` and that its input is
//      off, sends no write, and neither DetachTerminal nor CloseSession as it goes; the second page's terminal goes on running and takes input (its first numbered call carries the `next_input_seq` of its attach) after the first is closed and the host has retired its window. A restart of the host over the same state root: the saved tab
//      comes back ended, says the earlier output is gone, and no AttachTerminal succeeded and no terminal was started. A lease that runs out (a detach with 3 s): the host ends the terminal and says why, the page says `Closed: no tab took it back in time`, and a page that loads
//      later finds the tab ended with the earlier output gone.
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
import { buildConnectionsProcess, buildProcess, CONNECTIONS_ID, writeAll, writeConnectionsPlugin, writePlugin } from '../fixture/build.mjs';
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
  'settings-reconnect': /the Settings window follows the host after its events connection comes back/,
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
  'settings-reconnect': 'reconnect',
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
// The negative controls of scenario u, the connections (HM1). As in n, p and t each is a perturbation made just before the assertion that must see it and undone right after, and the assertion must fail with ITS words and no other. What a control
// adds to a page is markup that is nothing of the product's (`data-decoy`), or the change of one attribute or of the focus; it never replaces a node the page owns, so the scenario goes on over the page it perturbed. One run serves them all
// (SEAM_CONTROL=connections); SEAM_CONTROL=<name> makes that one only; SEAM_REMOVE=<name> leaves that assertion out, and the perturbation must then pass undetected.
const CONNECTIONS_CONTROLS = {
  'home-disconnected': /Home lists the plugin's two connections by name, both Disconnected/,
  'r4-home': /opens a tab titled Home and no Items tab/,
  'home-connecting': /Home says Connecting… on the row that was pressed/,
  'north-opens': /the three rows of the tab are north's/,
  'chip-options': /the picker lists the plugin's connections: north \(the current one, Connected\) and south \(Disconnected\)/,
  'chip-no-match': /type-to-filter with no match lists no connection/,
  'chip-focus': /the picker closes and the focus is on the chip/,
  'chip-replaced': /Back does not return to north/,
  'session-stays': /the Logs session started from north is still in the panel after the tab's connection changed/,
  'lines-grow': /the session's line count keeps growing after the switch/,
  'palette-row': /the name finds the connection's row/,
  'home-first': /the palette's Home command ranks first for home/,
  'fail-chip': /a start the host refused says Needs sign-in with its reason, on the row of the picker/,
  'fail-home': /Home says Needs sign-in on the row of south, with the reason under its name/,
  'fail-palette': /a start the host refused leaves the palette open with a notice that names the row and the reason/,
};
const FAILED_GROUP = 'failed-load';
const PAGE_GROUP = 'plugins-page';
const CONNECTIONS_GROUP = 'connections';
const CONTROL = process.env.SEAM_CONTROL ?? '';
const REMOVE = process.env.SEAM_REMOVE ?? '';
// SEAM_ONLY=plugins-page runs scenario t alone, and SEAM_ONLY=connections scenario u alone, with no perturbation, held to the allow-list of failed requests as in a full run.
const ONLY = process.env.SEAM_ONLY ?? '';
if (ONLY !== '' && ONLY !== PAGE_GROUP && ONLY !== CONNECTIONS_GROUP) {
  throw new Error(`SEAM_ONLY must be ${PAGE_GROUP} or ${CONNECTIONS_GROUP}`);
}
if (CONTROL !== '' && CONTROL !== 'process' && CONTROL !== FAILED_GROUP && CONTROL !== SETTINGS_GROUP && CONTROL !== PAGE_GROUP && CONTROL !== CONNECTIONS_GROUP && CONTROLS[CONTROL] === undefined && PROCESS_CONTROLS[CONTROL] === undefined && FAILED_CONTROLS[CONTROL] === undefined && PAGE_CONTROLS[CONTROL] === undefined && CONNECTIONS_CONTROLS[CONTROL] === undefined) {
  throw new Error(`SEAM_CONTROL must be one of ${[...Object.keys(CONTROLS), 'process', ...Object.keys(PROCESS_CONTROLS), FAILED_GROUP, ...Object.keys(FAILED_CONTROLS), PAGE_GROUP, ...Object.keys(PAGE_CONTROLS), CONNECTIONS_GROUP, ...Object.keys(CONNECTIONS_CONTROLS), SETTINGS_GROUP].join(', ')}`);
}
if (REMOVE !== '' && FAILED_CONTROLS[REMOVE] === undefined && PROCESS_CONTROLS[REMOVE] === undefined && PAGE_CONTROLS[REMOVE] === undefined && CONNECTIONS_CONTROLS[REMOVE] === undefined && SETTINGS_PARTS[REMOVE] === undefined && REMOVE !== RUNTIME_CONTROL) {
  throw new Error(`SEAM_REMOVE must be one of ${[...Object.keys(PROCESS_CONTROLS), ...Object.keys(FAILED_CONTROLS), ...Object.keys(PAGE_CONTROLS), ...Object.keys(CONNECTIONS_CONTROLS), ...Object.keys(SETTINGS_PARTS), RUNTIME_CONTROL].join(', ')}`);
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
  // SEAM_SHELL=<path> gives the host that SHELL, for a developer who runs the terminal scenarios (`r`, `r2`) against the shell of another machine (the CI image has bash, a Mac has zsh); by default the host picks its own.
  const shell = process.env.SEAM_SHELL === undefined ? {} : { SHELL: process.env.SEAM_SHELL };
  const child = spawn(server, [], {
    env: { PATH, TMPDIR, LANG, USER, ...shell, HOME: home, OMNIVIEW_CHANNEL: 'feature-ui-next', WAILS_SERVER_HOST: '127.0.0.1', WAILS_SERVER_PORT: String(port) },
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
const RESOURCE_SERVICE = 'github.com/omniviewdev/omniview/backend/pkg/plugin/resource.ServiceWrapper';
/** The keys the connections fixture's plugin gives its two connections (`fixture/connections-process/main.go`): a route carries them, and no window draws them. */
const NORTH_KEY = 'north-57a082bd74';
const SOUTH_KEY = 'south-0c3d9e1f42';

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
  {
    phases: [CONNECTIONS_GROUP],
    reason: "scenario u makes the start of south fail on purpose, with the connections fixture's file `connection-mode` (`unauthorized`, `unreachable`): the host answers StartConnection for it with a 422 (the class of the refusal is in the body), and the window says the refusal on the row, which is what the scenario asserts",
    test: (failure) => failure.status === 422 && failure.asked.includes(`"methodID":${String(methodIdOf(RESOURCE_SERVICE, 'StartConnection'))},`) && failure.asked.includes(SOUTH_KEY) && ['omniview:resource/unauthorized', 'omniview:connection/failed'].some((type) => failure.answered.includes(type)),
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
  const duplicate = await page.evaluate((entry) => {
    const bundle = System.get(entry);
    const kit = System.get('shared://@omniviewdev/kit');
    const react = System.get('shared://react');
    return {
      sameReact: bundle.imports.useState === react.useState,
      sameKitUseTheme: bundle.imports.useTheme === kit.useTheme,
    };
  }, `${base}/_/plugins/${DUP}/assets/entry.js`);
  assert.deepEqual(duplicate, { sameReact: true, sameKitUseTheme: false }, `${engine}: the duplicate control uses the host's React and its own kit`);

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
  const entries = page.getByRole('group', { name: 'Plugins', exact: true }).getByRole('button');
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
  // The host's own tools come first: Terminal, which the panel opens on, then Logs; then one tool for each plugin that contributes, in the order of the rail and in the plugin's own words.
  const tools = page.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab');
  assert.deepEqual((await tools.allTextContents()).map((text) => text.trim()), ['Terminal', 'Logs', 'Streams', 'Streams copy'], `${engine}: the strip draws the host's Terminal and Logs tools, then the tool of each plugin that contributes, in the order of the rail (the first plugin's, then the copy's)`);
  assert.equal(await tools.first().getAttribute('aria-selected'), 'true', `${engine}: the Terminal tool is on screen`);
  await page.getByText('No terminals', { exact: true }).waitFor();
  await tools.nth(1).click();
  assert.equal(await tools.nth(1).getAttribute('aria-selected'), 'true', `${engine}: the Logs tool is on screen once it is chosen`);
  await page.getByText('No log sessions').waitFor();
  assert.equal(await page.locator('[data-shell-part="sessionAdd"]').count(), 0, `${engine}: the Logs tool has no \`+\` (decision A20)`);
  // The rail's first plugin brings the tool the rest of this scenario uses.
  await tools.nth(2).click();
  assert.equal(await tools.nth(2).getAttribute('aria-selected'), 'true', `${engine}: Streams is on screen once it is chosen`);
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
  // The copy is ready and the first plugin is not: the strip has the host's tools and the copy's.
  await page.waitForFunction(() => [...document.querySelectorAll('[role=tablist][aria-label="Panel tools"] [role=tab]')].map((tab) => tab.textContent.trim()).join('|') === 'Terminal|Logs|Streams copy', null, { timeout: 30_000 });
  assert.equal(held.length > 0, true, `${engine}: the first plugin's bundle was asked for and is held`);
  // The person is on the copy's tool, with a stream open in it.
  await tools.nth(2).click();
  await page.getByRole('button', { name: 'New stream' }).first().click();
  const stream = page.locator('[data-fixture="stream"][data-session="stream-alpha"]');
  await stream.waitFor();
  const body = await stream.elementHandle();
  const lines = () => stream.evaluate((element) => Number(element.getAttribute('data-lines')));
  const linesBefore = await lines();
  const copyBefore = (await tools.nth(2).boundingBox())?.x ?? NaN;
  assert.equal(await tools.nth(2).getAttribute('aria-selected'), 'true', `${engine}: the copy's tool is on screen before the first plugin arrives`);

  // The first plugin's bundle is let through: it finishes after the copy.
  released = true;
  for (const route of held.splice(0)) await route.continue();
  await page.waitForFunction(() => document.querySelectorAll('[role=tablist][aria-label="Panel tools"] [role=tab]').length === 4, null, { timeout: 30_000 });
  assert.deepEqual(await names(), ['Terminal', 'Logs', 'Streams', 'Streams copy'], `${engine}: the first plugin took its place in the strip, in the order of the rail, though it finished after the copy`);
  assert.equal(await tools.nth(3).getAttribute('aria-selected'), 'true', `${engine}: the copy's tool is still the one on screen`);
  assert.equal(await tools.nth(2).getAttribute('aria-selected'), 'false', `${engine}: and the tool that arrived did not take the panel`);
  assert.equal(await page.getByRole('tab', { name: 'stream-alpha', selected: true }).count(), 1, `${engine}: the stream is still the session on screen`);
  assert.equal(await body.evaluate((element) => element.isConnected), true, `${engine}: and its body is the same element, not drawn again`);
  assert.ok((await lines()) >= linesBefore, `${engine}: and its count did not start again (${String(linesBefore)} lines, then ${String(await lines())})`);
  const moved = ((await tools.nth(3).boundingBox())?.x ?? NaN) - copyBefore;
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
    [`Command: Close tab, Tabs, ${mac ? '⌃⌥W' : 'Ctrl+Alt+W'}`, `Command: Toggle panel, Panel, ${mac ? '⌃⌥J' : 'Ctrl+Alt+J'}`, 'Command: Terminal: Toggle Screen Reader Mode, Panel', `Command: Settings, Window, ${mac ? '⌃⌥,' : 'Ctrl+Alt+,'}`, 'Command: Next tab, Tabs', 'Command: Previous tab, Tabs', 'Command: Plugins, Window', 'Command: Home, Window'],
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
  const entries = page.getByRole('group', { name: 'Plugins', exact: true }).getByRole('button');
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
    // What the window was told is what this reader recorded, not what the page shows: the host sends `plugin/unloaded` and, a few ms later on the same socket, `plugin/state_change` (`Recovering`), and the button above is
    // drawn on the first, so the second may not be recorded yet when it appears. The assertions below read the record once both frames are in it, in whichever order the reader saw them.
    await waitUntil('the window to be told the crash (plugin/unloaded) and the phase (plugin/state_change, Recovering)', () => told().length > 0 && frames.slice(mark).some((frame) => frame.name === 'plugin/state_change' && frame.data?.to === 'Recovering'), 15_000);
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
  const entries = page.getByRole('group', { name: 'Plugins', exact: true }).getByRole('button');
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
 * Holds the next call `target` makes of `method` of the host's plugin service (or of `service`: scenario u holds the resource service's `StartConnection`), so that what the page shows while a call is open is a state that lasts and can be
 * read (the host answers in tens of milliseconds). `before`: the call waits on its way to the host, which has done nothing, so the page can say only that its work is going on. `after`: the host has done it and its answer waits, so the
 * host's events have been told and the page must have followed them with its call still open. `held()` says the call is held; `release()` lets it go on and gives the page back as it was.
 */
async function holdCall(target, method, when, service = PLUGIN_SERVICE) {
  const methodID = methodIdOf(service, method);
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
 * u. The connections (HM1: the scope chip's picker, Home and the palette), over the real host, on a host of its own whose plugin `fixture-f-conn` (Seam Connections) has a PROCESS that serves two connections: `north`, which starts in
 * about 300 ms, and `south`, whose start is what the file `connection-mode` next to the plugin's binary says (no file: it starts; `unauthorized` and `unreachable`: the host answers the start with a 422). The window never starts a
 * connection by itself: a person chooses one, the HOST starts it (`StartConnection`, held on its way wherever the check must read a state that lasts: `Connecting…` is a few milliseconds long otherwise) and the window says what became of
 * it where the person chose. Four windows over the one host, each opened with nothing saved: A (Home, rule R4, the chip's picker), B (a Logs session started from the page stays when the tab's connection changes: decision A21), C (the
 * palette) and D (a start that fails, from the chip, from Home and from the palette, then the start that works, then the other failure). Nothing in the window can stop a connection, so the check does, as the host's operator
 * (`StopConnection`): `south` is Disconnected again before each part that needs a start. Every negative control of this scenario is made here, in turn, when SEAM_CONTROL asks (`withControls`; CONNECTIONS_CONTROLS).
 */
async function checkConnectionsAndHome(browser, engine, binary, work) {
  const dir = await mkdtemp(path.join(work, `connections-${engine}-`));
  const host = await startHost(dir, await freePort(), undefined, async (plugins) => [await writeConnectionsPlugin(plugins, binary)]);
  const exited = new Promise((resolve) => host.child.once('exit', resolve));
  const { asserting, verdict } = withControls(CONNECTIONS_GROUP, CONNECTIONS_CONTROLS);
  const errors = [];
  const windows = [];
  const modeFile = path.join(stateRoot(dir), 'plugins', CONNECTIONS_ID, 'connection-mode');
  const startId = methodIdOf(RESOURCE_SERVICE, 'StartConnection');
  const northRows = ['orders-api', 'ledger-sync', 'billing-sync'].map((name) => [name, 'north']);
  const southRows = ['harbor-gate', 'tide-table', 'keel-check'].map((name) => [name, 'south']);
  /** What the window says of a start that the host refused, by the class of the refusal: the word of the state and the one line of the reason (the host's own sentence for the class, never the plugin's text). */
  const NEEDS_SIGN_IN = { state: 'Needs sign-in', reason: 'The provider requires authentication.' };
  const NOT_RESPONDING = { state: 'Not responding', reason: 'The server did not answer.' };
  let mac = false;
  let pluginPid;

  /** What the host says of each connection of the plugin (`GetAllConnectionStates`), by name: the readiness word. The window must agree with it. */
  const readiness = async () => {
    const answer = await callBound(host.base, RESOURCE_SERVICE, 'GetAllConnectionStates');
    return Object.fromEntries((answer[CONNECTIONS_ID] ?? []).map((state) => [state.connection.name, state.readiness]));
  };
  /** What the next start of `south` does: the file the plugin reads on every start (`connections-process/main.go`). `ok` is no file. */
  const southStarts = async (mode) => {
    if (mode === 'ok') await rm(modeFile, { force: true });
    else await writeFile(modeFile, `${mode}\n`);
  };
  /** Nothing in the window can stop a connection, so the check does it as the host's operator: `south` is Disconnected again, and the window follows the host's event. */
  const stopSouth = async () => callBound(host.base, RESOURCE_SERVICE, 'StopConnection', CONNECTIONS_ID, SOUTH_KEY);
  /** A window with nothing saved, opened as the native app opens one (`/`, no hash), and what it asks of the host: the starts, each the plugin and the connection `StartConnection` was called with, in the order it asks. */
  const windowOf = async () => {
    const page = await freshPage(browser, host.base);
    windows.push(page);
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    const starts = [];
    page.on('request', (request) => {
      if (!request.url().endsWith('/wails/runtime')) return;
      try {
        const { args } = JSON.parse(request.postData() ?? 'null') ?? {};
        if (args?.methodID === startId) starts.push(args.args);
      } catch {
        // not a call
      }
    });
    await open(page, host.base);
    await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
    return { page, starts };
  };
  /** The next `StartConnection` the page makes is held on its way to the host: the window has said Connecting… (it says it at once) and the host has done nothing, so what the page shows is a state that lasts. */
  const holdStart = async (target) => holdCall(target, 'StartConnection', 'before', RESOURCE_SERVICE);
  const strip = (target) => target.getByRole('tablist', { name: 'Open tabs' });
  const tabsOf = async (target) => strip(target).getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => ({ title: tab.textContent ?? '', name: tab.getAttribute('aria-label') ?? '', selected: tab.getAttribute('aria-selected') === 'true' })));
  const tabShape = (tabs) => tabs.map(({ title, name, selected }) => [title, name, selected]);
  const chip = (target, name) => target.getByRole('button', { name: `Connection: ${name}`, exact: true });
  const focused = async (target) => target.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? '');
  /** The rows of the page that is on screen, as a person reads them: the name, the one line of the reason under it, the word of the state at the end, and whether a start is under way. */
  const homeRows = async (target) =>
    target
      .locator('[data-home-part="connection"]')
      .filter({ visible: true })
      .evaluateAll((rows) =>
        rows.map((row) => {
          const lines = [...row.querySelectorAll('[data-ov-clip]')].map((line) => line.textContent ?? '');
          return { name: lines[0] ?? '', state: row.querySelector('[data-ov-role]')?.textContent?.trim() ?? '', reason: lines[1] ?? '', busy: row.getAttribute('aria-busy') === 'true' };
        }),
      );
  const homeRow = (target, name) => target.locator('[data-home-part="connection"]', { has: target.getByText(name, { exact: true }) }).filter({ visible: true });
  /** The rows of the Items page on screen: the name and the connection each says. */
  const itemsShown = async (target) => target.locator('[data-shell-region="island"] tbody tr').filter({ visible: true }).evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? '')));
  const picker = (target) => target.locator('[data-shell-part="picker"]');
  const field = (target) => picker(target).getByRole('combobox', { name: 'Connections' });
  /** The options of the picker as a person reads them: the name, the word of the state, the reason, whether it is the current one (the dot and `aria-selected`), and whether a start is under way (`aria-disabled`). */
  const optionsOf = async (target) =>
    picker(target)
      .getByRole('option')
      .evaluateAll((options) =>
        options.map((option) => ({
          name: option.querySelector('[data-ov-clip]')?.textContent ?? '',
          state: option.querySelector('[data-shell-part="pickerState"]')?.textContent?.trim() ?? '',
          reason: option.querySelector('[data-shell-part="pickerReason"]')?.textContent ?? '',
          current: option.getAttribute('aria-selected') === 'true',
          mark: option.firstElementChild?.textContent ?? '',
          busy: option.getAttribute('aria-disabled') === 'true',
        })),
      );
  /**
   * Opens the picker of the chip: pressed with the pointer (the first time, where a person's first press is) or with the keys (the chip is a Tab stop: Enter opens it). A tooltip that a focused tab shows hangs below the strip, over the lane, and
   * takes a press that was meant for the chip, as it would for a person who had used the palette with the keys and then the pointer, so the keys are the way that does not depend on where the pointer or the focus last was.
   */
  const openPicker = async (target, name, how = 'keys') => {
    if (how === 'pointer') {
      await chip(target, name).click();
    } else {
      await chip(target, name).focus();
      await target.keyboard.press('Enter');
    }

    await field(target).waitFor();
  };
  const palette = (target) => target.getByRole('dialog', { name: 'Search' });
  const openPalette = async (target) => {
    await target.keyboard.press(`${mac ? 'Meta' : 'Control'}+KeyK`);
    await palette(target).waitFor();
  };
  /** The palette's row of a connection, by the id the host gives it (`<plugin>:<key>`), which does not change when the row's words do. */
  const rowOf = (target, key) => palette(target).locator(`[data-palette-row$="|${CONNECTIONS_ID}:${key}"]`);
  const footOf = async (target) => (await palette(target).locator('[data-palette-part="foot"]').innerText()).replace(/\s+/g, ' ').trim();
  /** The keys of the plugin's connections that a page draws, in its text or in an attribute that names or describes an element (an accessible name, a title, a tooltip, a placeholder): a key is the plugin's id for a connection, which a route carries and nobody reads. */
  const keysDrawn = async (target) =>
    target.evaluate((keys) => {
      const named = ['aria-label', 'title', 'alt', 'placeholder', 'data-ov-tip'];
      const drawn = [document.body.innerText, ...[...document.querySelectorAll('*')].flatMap((node) => named.flatMap((name) => (node.hasAttribute(name) ? [node.getAttribute(name) ?? ''] : [])))].join('\n');
      return keys.filter((key) => drawn.includes(key));
    }, [NORTH_KEY, SOUTH_KEY]);
  /** What a control adds to a page: markup that is nothing of the product's (`data-decoy`), put in the first element `selector` finds (at its end, or at its start with `where`), and taken out again. */
  const plant = async (target, selector, html, where = 'beforeend') => target.locator(selector).first().evaluate((element, [markup, place]) => element.insertAdjacentHTML(place, markup), [html, where]);
  const unplant = async (target) => target.evaluate(() => document.querySelectorAll('[data-decoy]').forEach((element) => element.remove()));
  const DECOY_ROW = '<button type="button" data-home-part="connection" data-decoy><span data-ov-clip>decoy</span><span data-ov-role="healthy">Connected</span></button>';
  const DECOY_OPTION = '<div role="option" aria-selected="false" data-decoy><span></span><span data-ov-clip>decoy</span><span data-shell-part="pickerState">Connected</span></div>';

  try {
    // Window A: Home, rule R4 and the chip's picker. -----------------------------------------------------------------------------------------------------------
    const { page, starts } = await windowOf();
    mac = await page.evaluate(() => navigator.platform.includes('Mac'));
    const pluginButton = page.getByRole('region', { name: 'Plugins you can open' }).getByRole('button', { name: 'Seam Connections', exact: true });
    // The plugin runs a process the host names (`processinfo`: its pid, with the executable it runs), so that the check can say that nothing of it is left when the host is gone.
    const owned = (await callBound(host.base, PROCESS_SERVICE, 'GetSnapshot')).processes.find((candidate) => candidate.key === `plugin:${CONNECTIONS_ID}`);
    assert.ok(owned?.ownership === 'verified' && owned.identity?.pid > 0 && owned.identity.executable.endsWith(`/plugins/${CONNECTIONS_ID}/bin/plugin`), `${engine}: the host names the connections plugin's process, with the executable it runs: ${JSON.stringify(owned)}`);
    pluginPid = owned.identity.pid;

    // 1. THE EMPTY WINDOW IS HOME: nothing was saved, so no tab is open and the page is Home, which lists the plugin's connections by name with the state each is in, and the host's state is what it says (nothing was started).
    await Promise.all([homeRow(page, 'north').waitFor({ timeout: 30_000 }), homeRow(page, 'south').waitFor({ timeout: 30_000 })]);
    assert.equal(await page.getByRole('heading', { level: 1, name: 'Home', exact: true }).count(), 1, `${engine}: a window with nothing saved shows Home`);
    assert.equal(await page.getByText('No tabs are open.', { exact: true }).count(), 1, `${engine}: and says that no tab is open`);
    assert.deepEqual(await tabsOf(page), [], `${engine}: and no tab is open`);
    assert.equal(await page.getByRole('region', { name: 'Connections', exact: true }).getByRole('heading', { level: 3 }).count(), 0, `${engine}: the plugin is the only one that has connections, so its group has no label of its own`);
    await asserting(
      'home-disconnected',
      async () => plant(page, '[aria-label="Connections"] [role="group"]', DECOY_ROW),
      async () => unplant(page),
      async () => {
        assert.deepEqual(
          await homeRows(page),
          [
            { name: 'north', state: 'Disconnected', reason: '', busy: false },
            { name: 'south', state: 'Disconnected', reason: '', busy: false },
          ],
          `${engine}: Home lists the plugin's two connections by name, both Disconnected (what the host says before any start)`,
        );
      },
    );
    assert.deepEqual(await readiness(), { north: 'DISCONNECTED', south: 'DISCONNECTED' }, `${engine}: the host says Disconnected for both before any start`);
    assert.deepEqual(await keysDrawn(page), [], `${engine}: the key of a connection is in nothing Home draws: no text, no accessible name, no tooltip`);
    assert.deepEqual(starts, [], `${engine}: a window that is only looked at starts nothing`);

    // 2. RULE R4: the plugin has two connections and none was used in this window, so its entry names no connection to open and the page that opens is Home, where they are listed: never the plugin's page on one of them chosen for the person.
    await pluginButton.click();
    await strip(page).getByRole('tab', { name: 'Home', exact: true }).waitFor({ timeout: 15_000 });
    await page.getByText('No tabs are open.', { exact: true }).waitFor({ state: 'detached' });
    // A tab that must NOT open cannot be waited for: the Home tab is there, and the window is given a moment in which the plugin's own page would have opened beside it.
    await page.waitForTimeout(300);
    await asserting(
      'r4-home',
      async () => plant(page, '[role="tablist"][aria-label="Open tabs"]', '<div role="tab" aria-label="Items, north" aria-selected="false" data-decoy>Items</div>'),
      async () => unplant(page),
      async () => {
        assert.deepEqual((await tabsOf(page)).map((tab) => [tab.title, tab.selected]), [['Home', true]], `${engine}: pressing the plugin in a window with two connections and none used opens a tab titled Home and no Items tab (the plugin does not land on an arbitrary connection)`);
      },
    );
    assert.deepEqual(starts, [], `${engine}: and the window started nothing`);
    assert.deepEqual(await readiness(), { north: 'DISCONNECTED', south: 'DISCONNECTED' }, `${engine}: and neither did the host`);
    // Home is what is on screen now, so the plugin's entry cannot open it again: it takes the person to the plugin's connections, the first of them, and opens no tab.
    await pluginButton.click();
    await waitUntil('the focus to be on a connection of the plugin', async () => page.evaluate(() => document.activeElement?.matches('[data-home-part="connection"][data-home-plugin="fixture-f-conn"]') === true), 10_000);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.startsWith('north') ?? false), true, `${engine}: the plugin's entry on Home gives the focus to the first connection of the plugin`);
    assert.deepEqual((await tabsOf(page)).map((tab) => tab.title), ['Home'], `${engine}: and opens no tab`);

    // 3. HOME starts a connection and opens it: the row that is pressed says Connecting… for as long as the host takes (the start is held on its way), no tab opens meanwhile, and then a tab Items opens in north with the chip named after it; Home's row says Connected.
    const startingNorth = await holdStart(page);
    await homeRow(page, 'north').click();
    await waitUntil('the window to ask the host to start north', startingNorth.held, 15_000);
    await asserting(
      'home-connecting',
      async () => plant(page, '[aria-label="Connections"] [role="group"]', DECOY_ROW),
      async () => unplant(page),
      async () => {
        assert.deepEqual(
          await homeRows(page),
          [
            { name: 'north', state: 'Connecting…', reason: '', busy: true },
            { name: 'south', state: 'Disconnected', reason: '', busy: false },
          ],
          `${engine}: Home says Connecting… on the row that was pressed and nothing of the other while the host starts the connection`,
        );
        assert.deepEqual((await tabsOf(page)).map((tab) => tab.title), ['Home'], `${engine}: Home says Connecting… and no tab opens while the host starts the connection`);
      },
    );
    assert.deepEqual(starts, [[CONNECTIONS_ID, NORTH_KEY]], `${engine}: the window asked the host for one thing: to start north`);
    await startingNorth.release();
    await strip(page).getByRole('tab', { name: 'Items, north', exact: true }).waitFor({ timeout: 30_000 });
    await chip(page, 'north').waitFor({ timeout: 30_000 });
    await page.locator('[data-shell-region="island"] tbody tr').nth(2).waitFor({ timeout: 30_000 });
    await asserting(
      'north-opens',
      async () => plant(page, '[data-shell-region="island"] tbody', '<tr data-decoy><td>harbor-gate</td><td>south</td></tr>'),
      async () => unplant(page),
      async () => {
        assert.deepEqual(tabShape(await tabsOf(page)), [['Home', 'Home', false], ['Items', 'Items, north', true]], `${engine}: a tab Items opens in north, beside Home and on screen`);
        assert.equal(await chip(page, 'north').count(), 1, `${engine}: the lane's chip of the tab that opened is named Connection: north`);
        assert.deepEqual(await itemsShown(page), northRows, `${engine}: and the three rows of the tab are north's`);
      },
    );
    await strip(page).getByRole('tab', { name: 'Home', exact: true }).click();
    await waitUntil('Home to say that north is connected', async () => (await homeRows(page))[0]?.state === 'Connected', 15_000);
    assert.deepEqual(
      await homeRows(page),
      [
        { name: 'north', state: 'Connected', reason: '', busy: false },
        { name: 'south', state: 'Disconnected', reason: '', busy: false },
      ],
      `${engine}: Home's row of north now says Connected, and south's still Disconnected`,
    );
    assert.deepEqual(await readiness(), { north: 'CONNECTED', south: 'DISCONNECTED' }, `${engine}: and the host agrees`);
    // Rule R4 again, from the other end: north was used in this window, so the plugin's entry opens the connection it was last used in, which is the tab that shows it, and opens no second one.
    await pluginButton.click();
    await waitUntil('the tab of north to be on screen', async () => (await tabsOf(page)).find((tab) => tab.selected)?.name === 'Items, north', 10_000);
    assert.equal((await tabsOf(page)).length, 2, `${engine}: the plugin's entry, with a connection used in this window, shows the tab of that connection and opens no tab`);

    // 4. THE CHIP: its picker lists the plugin's connections with their states, narrows as the person types, and Enter on a connection that is not connected has the host start it (Connecting… on the row, held on its way) and then moves THIS tab
    // to it: the picker closes with the focus on the chip, the chip and the rows are south's, no tab was opened and the change replaced the tab's history entry (Back does not return to north).
    await openPicker(page, 'north', 'pointer');
    assert.equal(await field(page).evaluate((element) => element === document.activeElement), true, `${engine}: the picker's field has the keyboard when it opens`);
    assert.equal(await picker(page).getByRole('listbox', { name: 'Connections' }).count(), 1, `${engine}: the picker is a listbox named Connections`);
    await asserting(
      'chip-options',
      async () => plant(page, '[data-shell-part="picker"] [role="listbox"]', DECOY_OPTION),
      async () => unplant(page),
      async () => {
        assert.deepEqual(
          await optionsOf(page),
          [
            { name: 'north', state: 'Connected', reason: '', current: true, mark: '•', busy: false },
            { name: 'south', state: 'Disconnected', reason: '', current: false, mark: '', busy: false },
          ],
          `${engine}: the picker lists the plugin's connections: north (the current one, Connected) and south (Disconnected)`,
        );
      },
    );
    assert.deepEqual(await keysDrawn(page), [], `${engine}: and the key of a connection is in nothing the picker draws`);
    await page.keyboard.type('zz', { delay: 20 });
    await waitUntil('the list to be narrowed to nothing', async () => (await optionsOf(page)).length === 0, 10_000);
    await asserting(
      'chip-no-match',
      async () => plant(page, '[data-shell-part="picker"] [role="listbox"]', DECOY_OPTION),
      async () => unplant(page),
      async () => {
        assert.deepEqual(await optionsOf(page), [], `${engine}: type-to-filter with no match lists no connection`);
        assert.equal(await picker(page).locator('[data-shell-part="pickerNote"]').textContent(), 'No matches for "zz"', `${engine}: type-to-filter with no match says No matches for "zz"`);
      },
    );
    await field(page).fill('');
    await page.keyboard.type('sou', { delay: 20 });
    await waitUntil('the list to be narrowed to south', async () => (await optionsOf(page)).length === 1, 10_000);
    assert.deepEqual((await optionsOf(page)).map((option) => [option.name, option.state]), [['south', 'Disconnected']], `${engine}: typing sou leaves one option, south`);
    const switching = await holdStart(page);
    await page.keyboard.press('Enter');
    await waitUntil('the window to ask the host to start south', switching.held, 15_000);
    assert.deepEqual(await optionsOf(page), [{ name: 'south', state: 'Connecting…', reason: '', current: false, mark: '', busy: true }], `${engine}: Enter on south: the row says Connecting… while the host starts it`);
    assert.equal(await picker(page).count(), 1, `${engine}: the picker stays open while the host starts the connection`);
    assert.equal(await chip(page, 'north').count(), 1, `${engine}: and the tab stays on north: the chip still says north`);
    assert.deepEqual(await itemsShown(page), northRows, `${engine}: and the rows are still north's`);
    assert.deepEqual(starts, [[CONNECTIONS_ID, NORTH_KEY], [CONNECTIONS_ID, SOUTH_KEY]], `${engine}: the window asked the host for one thing more: to start south`);
    await switching.release();
    await picker(page).waitFor({ state: 'detached', timeout: 30_000 });
    await chip(page, 'south').waitFor({ timeout: 30_000 });
    await page.locator('[data-shell-region="island"] tbody tr').nth(2).waitFor({ timeout: 30_000 });
    await waitUntil('the focus to be on the chip', async () => (await focused(page)) === 'Connection: south', 5_000).catch(() => undefined);
    await asserting(
      'chip-focus',
      async () => page.evaluate(() => document.activeElement?.blur()),
      async () => chip(page, 'south').focus(),
      async () => {
        assert.equal(await focused(page), 'Connection: south', `${engine}: the picker closes and the focus is on the chip, which is named Connection: south`);
      },
    );
    assert.deepEqual(await itemsShown(page), southRows, `${engine}: the rows of the tab are south's`);
    assert.deepEqual(tabShape(await tabsOf(page)), [['Home', 'Home', false], ['Items', 'Items, south', true]], `${engine}: the tab count did not change: the tab went to south and none opened`);
    assert.deepEqual(await readiness(), { north: 'CONNECTED', south: 'CONNECTED' }, `${engine}: the host started south`);
    const back = page.getByRole('button', { name: 'Back', exact: true });
    await asserting(
      'chip-replaced',
      async () => back.evaluate((element) => element.removeAttribute('aria-disabled')),
      async () => back.evaluate((element) => element.setAttribute('aria-disabled', 'true')),
      async () => {
        assert.equal(await back.getAttribute('aria-disabled'), 'true', `${engine}: Back does not return to north: the change replaced the history entry of the tab, so there is no earlier page`);
      },
    );
    // Back says why it does nothing and stays a control (`aria-disabled`), so a press is made as a keyboard or a pointer would, which the browser's own check for an enabled button would not allow.
    await back.click({ force: true });
    await page.waitForTimeout(300);
    assert.equal(await chip(page, 'south').count(), 1, `${engine}: and pressing Back leaves the tab on south`);
    await page.close();

    // Window B: a Logs session started from the page, in the host's panel, stays when the tab's connection changes (decision A21). ---------------------------------------------------------------
    const { page: second, starts: startsB } = await windowOf();
    // Both connections are connected now: a press on one starts nothing.
    await homeRow(second, 'north').waitFor({ timeout: 30_000 });
    await waitUntil('Home to say that both connections are connected', async () => (await homeRows(second)).every((row) => row.state === 'Connected') && (await homeRows(second)).length === 2, 15_000);
    await homeRow(second, 'north').click();
    await strip(second).getByRole('tab', { name: 'Items, north', exact: true }).waitFor({ timeout: 30_000 });
    await second.locator('[data-shell-region="island"] tbody tr').nth(2).waitFor({ timeout: 30_000 });
    assert.deepEqual(startsB, [], `${engine}: a connection that is connected is opened and not started again`);
    // 7. The name of a row is a button that asks the host's panel for the item's Logs session (the page's `ContextV1.panel`).
    await second.getByRole('button', { name: 'orders-api', exact: true }).click();
    const log = second.locator('[data-log-session] [role="grid"]');
    await log.waitFor({ timeout: 30_000 });
    const lines = async () => Number((await log.getAttribute('aria-rowcount')) ?? 0);
    await waitUntil('the stream to have written 30 lines', async () => (await lines()) >= 30, 30_000);
    const sessionTab = second.getByRole('tablist', { name: 'Logs sessions' }).getByRole('tab', { name: 'orders-api/app', exact: true });
    const counters = async () => second.evaluate(() => ({ ...Reflect.get(window, '__fixtureLogs') }));
    /** The card of the session's tab (hover): the host's own words for a log session. A tooltip the pointer left on its way is a popover too, so the card is the one that has a State in it. */
    const cardOf = async () => {
      await sessionTab.hover();
      const card = second.locator('[popover]:popover-open').filter({ hasText: 'State' });
      await card.waitFor();
      const text = await card.innerText();
      await second.mouse.move(2, 2);
      return text;
    };
    assert.equal(await sessionTab.count(), 1, `${engine}: the panel's Logs tool has the session of the row, named by the item and its source`);
    const firstCard = await cardOf();
    assert.match(firstCard, /Logs[\s\S]*Item orders-api[\s\S]*State\s+Streaming/, `${engine}: and its card says what the host says of a log session that streams (${JSON.stringify(firstCard)})`);
    const opening = await counters();
    assert.deepEqual([opening.opened, opening.closed], [1, 0], `${engine}: the plugin opened one feed and closed none`);
    const written = await lines();
    await openPicker(second, 'north');
    await second.keyboard.type('sou', { delay: 20 });
    await second.keyboard.press('Enter');
    await picker(second).waitFor({ state: 'detached', timeout: 30_000 });
    await chip(second, 'south').waitFor({ timeout: 30_000 });
    await second.locator('[data-shell-region="island"] tbody tr').nth(2).waitFor({ timeout: 30_000 });
    assert.deepEqual(await itemsShown(second), southRows, `${engine}: the tab went to south while its Logs session was running`);
    await asserting(
      'session-stays',
      async () => second.locator('[role="tablist"][aria-label="Logs sessions"] [role="tab"]').first().evaluate((element) => element.setAttribute('aria-hidden', 'true')),
      async () => second.locator('[role="tablist"][aria-label="Logs sessions"] [role="tab"]').first().evaluate((element) => element.removeAttribute('aria-hidden')),
      async () => {
        assert.equal(await sessionTab.count(), 1, `${engine}: the Logs session started from north is still in the panel after the tab's connection changed`);
        const card = await cardOf();
        assert.match(card, /State\s+Streaming/, `${engine}: the Logs session started from north is still in the panel after the tab's connection changed: its card still says Streaming (${JSON.stringify(card)})`);
        assert.deepEqual(await counters(), opening, `${engine}: the Logs session started from north is still in the panel after the tab's connection changed: its feed was not closed and none was opened again`);
      },
    );
    await asserting(
      'lines-grow',
      async () => second.getByRole('button', { name: 'Pause log updates' }).click(),
      async () => second.getByRole('button', { name: 'Pause log updates' }).click(),
      async () => {
        const first = await lines();
        await waitUntil('the session to write 15 more lines', async () => (await lines()) >= first + 15, 10_000).catch(() => undefined);
        assert.ok((await lines()) >= Math.max(first, written) + 15, `${engine}: the session's line count keeps growing after the switch (${String(written)} lines before it, ${String(first)} then ${String(await lines())} after: the stream makes 20 a second)`);
      },
    );
    await sessionTab.focus();
    await second.keyboard.press('Delete');
    await second.getByText('No log sessions').waitFor({ timeout: 15_000 });
    await waitUntil('every listener on the feed to be gone', async () => (await counters()).listeners === 0, 15_000);
    assert.deepEqual(await counters(), { opened: 1, closed: 1, listeners: 0 }, `${engine}: closing the session frees the plugin's feed and every listener on it`);
    await second.close();

    // Window C: the palette. -------------------------------------------------------------------------------------------------------------------------------------------------------------------
    const { page: third } = await windowOf();
    await homeRow(third, 'north').click();
    await strip(third).getByRole('tab', { name: 'Items, north', exact: true }).waitFor({ timeout: 30_000 });
    await chip(third, 'north').waitFor({ timeout: 30_000 });
    await stopSouth();
    // 6. With the tab on north the palette is narrowed to it (a chip for the plugin and one for the connection): the connection's chip is taken off, as a person widens a search, and the name finds the row of the other connection.
    await openPalette(third);
    await third.keyboard.press('Backspace');
    await third.keyboard.type('south', { delay: 20 });
    const southRow = rowOf(third, SOUTH_KEY);
    await southRow.waitFor({ timeout: 15_000 });
    await waitUntil('the palette to say that south is Disconnected', async () => (await southRow.getAttribute('aria-label')) === 'Connection: south, Seam Connections · Disconnected', 15_000);
    await asserting(
      'palette-row',
      async () => southRow.evaluate((element) => element.setAttribute('aria-label', 'Connection: south, Seam Connections · Connected')),
      async () => southRow.evaluate((element) => element.setAttribute('aria-label', 'Connection: south, Seam Connections · Disconnected')),
      async () => {
        assert.equal(await southRow.getAttribute('aria-label'), 'Connection: south, Seam Connections · Disconnected', `${engine}: the name finds the connection's row: Connection: south, with the plugin and the state it is in`);
        assert.equal(await southRow.getAttribute('aria-selected'), 'true', `${engine}: and it is the active row`);
      },
    );
    assert.deepEqual(await keysDrawn(third), [], `${engine}: and the key of a connection is in nothing the palette draws`);
    const connectionRows = async () => palette(third).locator('[data-palette-row*="|host:connections|"]').evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')));
    for (const word of ['switch', 'connection']) {
      await palette(third).getByRole('combobox').fill('');
      await third.keyboard.type(word, { delay: 20 });
      await waitUntil(`both connections to be listed for ${word}`, async () => (await connectionRows()).length === 2, 10_000);
      assert.deepEqual(await connectionRows(), ['Connection: north, Seam Connections · Connected', 'Connection: south, Seam Connections · Disconnected'], `${engine}: the word ${word} finds both connections`);
    }
    await palette(third).getByRole('combobox').fill('');
    await third.keyboard.type('south', { delay: 20 });
    await southRow.waitFor();
    const runningSouth = await holdStart(third);
    await third.keyboard.press('Enter');
    await waitUntil('the window to ask the host to start south', runningSouth.held, 15_000);
    assert.equal(await southRow.getAttribute('data-inert'), '', `${engine}: while the host starts the connection the palette's row is inert`);
    assert.equal(await southRow.getAttribute('aria-disabled'), 'true', `${engine}: and says so to assistive technology`);
    assert.equal(await palette(third).count(), 1, `${engine}: and the palette stays open`);
    await runningSouth.release();
    await palette(third).waitFor({ state: 'detached', timeout: 30_000 });
    await chip(third, 'south').waitFor({ timeout: 30_000 });
    await third.locator('[data-shell-region="island"] tbody tr').nth(2).waitFor({ timeout: 30_000 });
    assert.deepEqual(tabShape(await tabsOf(third)), [['Items', 'Items, south', true]], `${engine}: Enter on the row switched the tab on screen to south (no tab opened)`);
    assert.deepEqual(await itemsShown(third), southRows, `${engine}: and its rows are south's`);
    // Home is a command, and it opens a NEW Home tab each time. Every chip is taken off (the plugin's page narrows the palette to the plugin and to its connection), so that the other rows that say home are there to be ranked.
    const homeCommand = 'Command: Home, Window';
    const homeSearch = async () => {
      await openPalette(third);
      await third.keyboard.press('Backspace');
      await third.keyboard.press('Backspace');
      await third.keyboard.type('home', { delay: 20 });
      await palette(third).getByRole('option', { name: homeCommand, exact: true }).waitFor({ timeout: 15_000 });
    };
    await homeSearch();
    await asserting(
      'home-first',
      async () => plant(third, '[data-palette-part="results"] [role="listbox"]', '<div role="option" aria-label="Plugin home: decoy" aria-selected="false" data-decoy>decoy</div>', 'afterbegin'),
      async () => unplant(third),
      async () => {
        const rows = await palette(third).getByRole('option').evaluateAll((options) => options.map((option) => [option.getAttribute('aria-label'), option.getAttribute('aria-selected')]));
        assert.deepEqual(rows[0], [homeCommand, 'true'], `${engine}: the palette's Home command ranks first for home, and is the active row`);
      },
    );
    await third.keyboard.press('Enter');
    await palette(third).waitFor({ state: 'detached', timeout: 15_000 });
    await waitUntil('2 tabs to be open', async () => (await tabsOf(third)).length === 2, 10_000);
    assert.deepEqual((await tabsOf(third)).filter((tab) => tab.selected).map((tab) => tab.name), ['Home'], `${engine}: the command Home opens a Home tab, and it is on screen`);
    // A Home tab is open now, and its own row (`Tab: Home`) ranks above the command for the same word: from the tab of south the arrow keys take the command, and it opens a second Home tab.
    await strip(third).getByRole('tab', { name: 'Items, south', exact: true }).click();
    await homeSearch();
    const command = palette(third).getByRole('option', { name: homeCommand, exact: true });
    for (let press = 0; press < 4 && (await command.getAttribute('aria-selected')) !== 'true'; press += 1) await third.keyboard.press('ArrowDown');
    assert.equal(await command.getAttribute('aria-selected'), 'true', `${engine}: the arrow keys take the command Home when the row of the Home tab that is open ranks above it`);
    await third.keyboard.press('Enter');
    await palette(third).waitFor({ state: 'detached', timeout: 15_000 });
    await waitUntil('3 tabs to be open', async () => (await tabsOf(third)).length === 3, 10_000);
    assert.deepEqual((await tabsOf(third)).filter((tab) => tab.selected).map((tab) => tab.name), ['Home'], `${engine}: the command Home opens a second Home tab, and it is on screen`);
    assert.deepEqual((await tabsOf(third)).map((tab) => tab.name).toSorted(), ['Home', 'Home', 'Items, south'], `${engine}: the command opened a new Home tab each time, and the tab of south is still there`);
    await third.close();

    // Window D: a start that fails, from the chip, from Home and from the palette; then the start that works; then the other failure. ----------------------------------------------------------------
    const { page: fourth, starts: startsD } = await windowOf();
    await homeRow(fourth, 'north').click();
    await strip(fourth).getByRole('tab', { name: 'Items, north', exact: true }).waitFor({ timeout: 30_000 });
    // A Home tab beside it, from the palette's command, so that Home's part is read in a tab that stays.
    await openPalette(fourth);
    await fourth.keyboard.type('home', { delay: 20 });
    await palette(fourth).getByRole('option', { name: homeCommand, exact: true }).waitFor({ timeout: 15_000 });
    await fourth.keyboard.press('Enter');
    await palette(fourth).waitFor({ state: 'detached', timeout: 15_000 });
    await strip(fourth).getByRole('tab', { name: 'Home', exact: true }).waitFor({ timeout: 15_000 });
    await strip(fourth).getByRole('tab', { name: 'Items, north', exact: true }).click();
    await chip(fourth, 'north').waitFor({ timeout: 30_000 });
    await fourth.locator('[data-shell-region="island"] tbody tr').nth(2).waitFor({ timeout: 30_000 });
    await stopSouth();
    await southStarts('unauthorized');
    const tabsBefore = tabShape(await tabsOf(fourth));
    assert.deepEqual(tabsBefore, [['Items', 'Items, north', true], ['Home', 'Home', false]], `${engine}: the window has the tab of north and a Home tab`);

    // 5. A START THAT FAILS, from the chip: the row says what the host said in the window's words and the reason, the picker stays open, the tab stays on north, and choosing north, which is connected, closes it: the person is not stuck.
    await openPicker(fourth, 'north');
    await waitUntil('the picker to say that south is Disconnected', async () => (await optionsOf(fourth)).find((option) => option.name === 'south')?.state === 'Disconnected', 15_000);
    await fourth.keyboard.type('sou', { delay: 20 });
    await waitUntil('the list to be narrowed to south', async () => (await optionsOf(fourth)).length === 1, 10_000);
    const refusedByChip = await holdStart(fourth);
    await fourth.keyboard.press('Enter');
    await waitUntil('the window to ask the host to start south', refusedByChip.held, 15_000);
    await refusedByChip.release();
    await waitUntil('the row to say how the start failed', async () => (await optionsOf(fourth))[0]?.state === NEEDS_SIGN_IN.state, 15_000);
    await asserting(
      'fail-chip',
      async () => plant(fourth, '[data-shell-part="picker"] [role="listbox"]', DECOY_OPTION),
      async () => unplant(fourth),
      async () => {
        assert.deepEqual(
          await optionsOf(fourth),
          [{ name: 'south', state: NEEDS_SIGN_IN.state, reason: NEEDS_SIGN_IN.reason, current: false, mark: '', busy: false }],
          `${engine}: a start the host refused says Needs sign-in with its reason, on the row of the picker`,
        );
        assert.equal(await picker(fourth).count(), 1, `${engine}: a start the host refused leaves the picker open`);
        assert.equal(await chip(fourth, 'north').count(), 1, `${engine}: a start the host refused leaves the tab on north: the chip still says north`);
        assert.deepEqual(await itemsShown(fourth), northRows, `${engine}: a start the host refused leaves the rows of the tab north's`);
      },
    );
    assert.equal(await picker(fourth).locator('[data-shell-part="pickerLive"]').textContent(), `south: ${NEEDS_SIGN_IN.reason}`, `${engine}: and the picker says it aloud, by the name and the reason`);
    assert.deepEqual(startsD, [[CONNECTIONS_ID, SOUTH_KEY]], `${engine}: the window asked the host to start south, once`);
    assert.deepEqual(await readiness(), { north: 'CONNECTED', south: 'FAILED' }, `${engine}: and the host says south failed`);
    await field(fourth).fill('');
    await waitUntil('the whole list to be back', async () => (await optionsOf(fourth)).length === 2, 10_000);
    await fourth.keyboard.press('Enter');
    await picker(fourth).waitFor({ state: 'detached', timeout: 15_000 });
    assert.equal(await focused(fourth), 'Connection: north', `${engine}: choosing north, which is connected, closes the picker with the focus on the chip: the person is not stuck`);
    assert.deepEqual(tabShape(await tabsOf(fourth)), tabsBefore, `${engine}: and the tabs are as they were`);

    // The same from Home, in its tab: the row of south says Connecting…, then the class of the failure and the reason under the name, and no tab opens.
    await strip(fourth).getByRole('tab', { name: 'Home', exact: true }).click();
    await homeRow(fourth, 'south').waitFor({ timeout: 15_000 });
    const refusedByHome = await holdStart(fourth);
    await homeRow(fourth, 'south').click();
    await waitUntil('the window to ask the host to start south', refusedByHome.held, 15_000);
    assert.deepEqual((await homeRows(fourth)).map(({ name, state, busy }) => [name, state, busy]), [['north', 'Connected', false], ['south', 'Connecting…', true]], `${engine}: Home says Connecting… on the row of south while the host starts it`);
    await refusedByHome.release();
    await waitUntil('Home to say how the start failed', async () => (await homeRows(fourth))[1]?.state === NEEDS_SIGN_IN.state, 15_000);
    await asserting(
      'fail-home',
      async () => plant(fourth, '[aria-label="Connections"] [role="group"]', DECOY_ROW),
      async () => unplant(fourth),
      async () => {
        assert.deepEqual(
          await homeRows(fourth),
          [
            { name: 'north', state: 'Connected', reason: '', busy: false },
            { name: 'south', state: NEEDS_SIGN_IN.state, reason: NEEDS_SIGN_IN.reason, busy: false },
          ],
          `${engine}: Home says Needs sign-in on the row of south, with the reason under its name`,
        );
        assert.deepEqual(tabShape(await tabsOf(fourth)), [['Items', 'Items, north', false], ['Home', 'Home', true]], `${engine}: Home says Needs sign-in on the row of south and opens no tab`);
      },
    );
    assert.deepEqual(startsD, [[CONNECTIONS_ID, SOUTH_KEY], [CONNECTIONS_ID, SOUTH_KEY]], `${engine}: Home asked the host to start south, once`);

    // And from the palette, with the tab of north on screen: Enter on the row of south leaves the palette open with a notice that names the row and the reason, the row is inert while the host works and not after, and Escape closes it with the window as it was.
    await strip(fourth).getByRole('tab', { name: 'Items, north', exact: true }).click();
    await chip(fourth, 'north').waitFor({ timeout: 30_000 });
    await openPalette(fourth);
    await fourth.keyboard.press('Backspace');
    await fourth.keyboard.type('south', { delay: 20 });
    const refusedRow = rowOf(fourth, SOUTH_KEY);
    await refusedRow.waitFor({ timeout: 15_000 });
    await waitUntil('the row to say Needs sign-in', async () => (await refusedRow.getAttribute('aria-label')) === `Connection: south, Seam Connections · ${NEEDS_SIGN_IN.state}`, 15_000);
    const refusedByPalette = await holdStart(fourth);
    await fourth.keyboard.press('Enter');
    await waitUntil('the window to ask the host to start south', refusedByPalette.held, 15_000);
    assert.equal(await refusedRow.getAttribute('data-inert'), '', `${engine}: while the host works on it the row of south is inert`);
    await refusedByPalette.release();
    await waitUntil('the palette to say why', async () => (await footOf(fourth)) === `south: ${NEEDS_SIGN_IN.reason}`, 15_000);
    await asserting(
      'fail-palette',
      async () => plant(fourth, '[data-palette-part="foot"]', '<span data-decoy>Run</span>'),
      async () => unplant(fourth),
      async () => {
        assert.equal(await footOf(fourth), `south: ${NEEDS_SIGN_IN.reason}`, `${engine}: a start the host refused leaves the palette open with a notice that names the row and the reason`);
        assert.equal(await palette(fourth).count(), 1, `${engine}: a start the host refused leaves the palette open`);
        assert.equal(await refusedRow.getAttribute('data-inert'), null, `${engine}: and the row is not inert any more: another choice can be made`);
      },
    );
    assert.deepEqual(startsD.length, 3, `${engine}: the palette asked the host to start south, once`);
    await fourth.keyboard.press('Escape');
    await palette(fourth).waitFor({ state: 'detached', timeout: 15_000 });
    assert.deepEqual(tabShape(await tabsOf(fourth)), tabsBefore, `${engine}: Escape closes the palette with the window as it was: the tabs`);
    assert.equal(await chip(fourth, 'north').count(), 1, `${engine}: and the tab still on north`);
    assert.deepEqual(await itemsShown(fourth), northRows, `${engine}: with north's rows`);

    // The reason is gone: the file is removed and south is chosen again from the chip. It starts (Connecting…, then connected), and the tab goes to it.
    await southStarts('ok');
    await openPicker(fourth, 'north');
    await fourth.keyboard.type('sou', { delay: 20 });
    await waitUntil('the list to be narrowed to south', async () => (await optionsOf(fourth)).length === 1, 10_000);
    assert.deepEqual((await optionsOf(fourth)).map((option) => [option.name, option.state, option.reason]), [['south', NEEDS_SIGN_IN.state, NEEDS_SIGN_IN.reason]], `${engine}: the row still says how the last start failed until the person chooses it again`);
    const retrying = await holdStart(fourth);
    await fourth.keyboard.press('Enter');
    await waitUntil('the window to ask the host to start south', retrying.held, 15_000);
    assert.deepEqual((await optionsOf(fourth)).map((option) => [option.name, option.state, option.busy]), [['south', 'Connecting…', true]], `${engine}: chosen again, the row says Connecting…`);
    await retrying.release();
    await picker(fourth).waitFor({ state: 'detached', timeout: 30_000 });
    await chip(fourth, 'south').waitFor({ timeout: 30_000 });
    await fourth.locator('[data-shell-region="island"] tbody tr').nth(2).waitFor({ timeout: 30_000 });
    await waitUntil('the focus to be on the chip', async () => (await focused(fourth)) === 'Connection: south', 5_000).catch(() => undefined);
    assert.equal(await focused(fourth), 'Connection: south', `${engine}: the start that works closes the picker with the focus on the chip`);
    assert.deepEqual(await itemsShown(fourth), southRows, `${engine}: and the tab went to south`);
    assert.deepEqual(await readiness(), { north: 'CONNECTED', south: 'CONNECTED' }, `${engine}: the host says both are connected`);
    await strip(fourth).getByRole('tab', { name: 'Home', exact: true }).click();
    await waitUntil('Home to say that south is connected', async () => (await homeRows(fourth))[1]?.state === 'Connected', 15_000);
    assert.deepEqual((await homeRows(fourth)).map(({ state, reason }) => [state, reason]), [['Connected', ''], ['Connected', '']], `${engine}: Home says Connected for both, and no reason is left under south`);
    assert.equal(startsD.length, 4, `${engine}: the start that works was one start`);

    // The other failure: south is stopped and does not answer. The words are the class's, and the person is not stuck.
    await strip(fourth).getByRole('tab', { name: 'Items, south', exact: true }).click();
    await openPicker(fourth, 'south');
    await fourth.keyboard.type('nor', { delay: 20 });
    await waitUntil('the list to be narrowed to north', async () => (await optionsOf(fourth)).length === 1, 10_000);
    await fourth.keyboard.press('Enter');
    await picker(fourth).waitFor({ state: 'detached', timeout: 30_000 });
    await chip(fourth, 'north').waitFor({ timeout: 30_000 });
    await stopSouth();
    await southStarts('unreachable');
    await openPicker(fourth, 'north');
    await waitUntil('the picker to say that south is Disconnected', async () => (await optionsOf(fourth)).find((option) => option.name === 'south')?.state === 'Disconnected', 15_000);
    await fourth.keyboard.type('sou', { delay: 20 });
    await waitUntil('the list to be narrowed to south', async () => (await optionsOf(fourth)).length === 1, 10_000);
    await fourth.keyboard.press('Enter');
    await waitUntil('the row to say how the start failed', async () => (await optionsOf(fourth))[0]?.state === NOT_RESPONDING.state, 15_000);
    assert.deepEqual(
      await optionsOf(fourth),
      [{ name: 'south', state: NOT_RESPONDING.state, reason: NOT_RESPONDING.reason, current: false, mark: '', busy: false }],
      `${engine}: a server that does not answer says Not responding with its reason, on the row of the picker`,
    );
    assert.equal(await chip(fourth, 'north').count(), 1, `${engine}: and the tab stays on north`);
    assert.equal(startsD.length, 5, `${engine}: the window asked the host to start south once more, and it was refused`);
    await field(fourth).fill('');
    await waitUntil('the whole list to be back', async () => (await optionsOf(fourth)).length === 2, 10_000);
    await fourth.keyboard.press('Enter');
    await picker(fourth).waitFor({ state: 'detached', timeout: 15_000 });
    assert.equal(await focused(fourth), 'Connection: north', `${engine}: choosing north closes the picker with the focus on the chip`);
    await southStarts('ok');
    await fourth.close();
    assert.deepEqual(errors, [], `${engine}: the whole scenario wrote no page error`);

    // Nothing of the plugin is left when the host is: its process ends with the host's, and the file that made south fail is gone.
    host.child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8000))]);
    await waitUntil("the plugin's process to end with the host", async () => !alive(pluginPid), 10_000);
    await assert.rejects(stat(modeFile), { code: 'ENOENT' }, `${engine}: the file that makes south fail is not left behind`);
    console.log(`${engine}: the connections: Home lists them, a rule for a plugin with two and none used, the chip's picker, Home and the palette start a connection and say how it went (a start refused for sign-in and for a server that does not answer is said on the row, in the picker, in Home and in the palette), and a Logs session of the host's panel stays when the tab's connection changes`);
    verdict(engine);
  } finally {
    await rm(modeFile, { force: true });
    for (const target of windows) await target.close().catch(() => undefined);
    host.child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8000))]);
    if (pluginPid !== undefined && alive(pluginPid)) process.kill(pluginPid, 'SIGKILL');
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
  await page.getByRole('group', { name: 'Plugins', exact: true }).getByRole('button').nth(1).click();
  await page.getByRole('treeitem', { name: 'Things' }).click();
  await page.getByRole('treeitem', { name: 'Items' }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await strip(page).getByRole('tab').count(), 2, `${engine}: the tabs of both plugins are open`);
  // The panel: open, on the second plugin's tool, and a height the keyboard chose (Up grows it by 16 px).
  await toggleOf(page).click();
  await page.locator('[data-shell-region="panel"]').waitFor({ state: 'visible' });
  const tools = page.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab');
  await tools.nth(3).click();
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
  assert.deepEqual({ version: saved.version, tabs: saved.tabs.tabs.length, active: saved.tabs.active === saved.tabs.tabs[1]?.id, rail: saved.rail, tool: saved.panel.tool }, { version: 2, tabs: 2, active: true, rail: DUP, tool: `${DUP}:streams` }, `${engine}: what the host holds`);

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
    await until('the session replaced', async () => (await slots()).session, (value) => typeof value === 'string' && JSON.parse(value)?.version === 2 && JSON.parse(value)?.tabs?.tabs?.length === 0);
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
 * Part of s, the events connection of a page that stays looked at (F1 of the review of #662). A server-mode page hears the host on one WebSocket that the runtime opens again after a second when it drops, and nothing that was told while it was
 * down is replayed: a window page that is looked at all the while (no focus, no visibility change, no event reaches it) was left on the old value until the next change. The test drops the window page's events socket, changes a setting from the
 * host before the runtime opens another one (what another window does), and the page, which is touched in no other way, shows the host's value once its socket is back (`onEventsReconnect` makes the session ask the host again) and follows the next change.
 */
async function settingsReconnect(c) {
  const { engine, base, asserting } = c;
  await c.commit({ 'terminal.cursorBlink': true });
  const windowPage = await c.page(1060, 640);
  const sockets = [];
  await windowPage.routeWebSocket(/\/wails\/events/, (ws) => {
    const server = ws.connectToServer();
    sockets.push(ws);
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => ws.send(message));
    server.onClose(() => ws.close());
  });
  await windowPage.goto(`${base}/?screen=settings-window`, { waitUntil: 'load' });
  await c.show('/settings?category=terminal');
  const toggle = '[data-settings-row="terminal.cursorBlink"] [role="switch"]';
  await windowPage.locator(toggle).waitFor({ timeout: 20_000 });
  const shows = async () => windowPage.locator(toggle).getAttribute('aria-checked');
  const staleSnapshot = (text) => async (route, id) => (id === SETTINGS_CALLS.snapshot ? answerWith(route, text) : false);
  // The act, made again under a perturbation and once it is undone: the page's events socket is dropped, the host changes before the runtime opens another one (a second later), and the page is touched in no other way. `wanted` is what the
  // host holds after it.
  let wanted = 'true';
  const outage = async () => {
    await c.until(10_000, async () => sockets.length > 0);
    for (const ws of sockets.splice(0)) ws.close({ code: 1006, reason: 'the seam drops the events connection' });
    wanted = wanted === 'true' ? 'false' : 'true';
    await c.commit({ 'terminal.cursorBlink': wanted === 'true' });
  };
  const follows = async () =>
    windowPage
      .waitForFunction(({ selector, value }) => document.querySelector(selector)?.getAttribute('aria-checked') === value, { selector: toggle, value: wanted }, { polling: 50, timeout: 8000 })
      .then(() => true, () => false);
  await outage();
  assert.notEqual(await shows(), wanted, `${engine}: the window page has not heard of a change made while its events connection was down`);
  // A precondition of the control, in words of its own: the recovery is made before anything is perturbed, so that the perturbation answers a page that has recovered and a second outage that changes the host back is not read as already followed.
  assert.ok(await follows(), `${engine}: before anything is perturbed, the window page shows the host's value once its events connection is back (it shows ${String(await shows())}, the host holds ${wanted})`);
  let putBack;
  await asserting(
    'settings-reconnect',
    async () => {
      // The page asks the host again when its socket is back, and is answered with what the host held before this outage.
      putBack = await standIn(windowPage, staleSnapshot(JSON.stringify(await c.snapshot())));
      await outage();
    },
    async () => {
      await putBack();
      await outage();
    },
    async () => {
      assert.ok(await follows(), `${engine}: the Settings window follows the host after its events connection comes back (it shows ${String(await shows())}, the host holds ${wanted})`);
    },
  );
  // The new socket carries the host's events again.
  wanted = wanted === 'true' ? 'false' : 'true';
  await c.commit({ 'terminal.cursorBlink': wanted === 'true' });
  assert.ok(await follows(), `${engine}: the Settings window follows the next change on its new events connection`);
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
    for (const [name, part] of [['sheet', settingsSheet], ['window', settingsWindow], ['truth', settingsTruth], ['reconnect', settingsReconnect], ['slots', settingsSlots], ['secrets', settingsSecrets], ['popups', settingsPopups]]) {
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
/** The sessions the host lists for the exec lane: the ids, as the page's runtime asks for them. */
const EXEC_SERVICE = 'github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper';
async function terminalIds(base) {
  const sessions = await callBound(base, EXEC_SERVICE, 'ListSessions');
  return (sessions ?? []).map((session) => session.id);
}

/** What the shell of a session has printed, from the host's replay of it: the last bytes of the session as text. */
async function transcriptOf(base, id) {
  const [, bytes] = await callBound(base, EXEC_SERVICE, 'AttachSession', id);
  return Buffer.from(bytes ?? '', 'base64').toString('utf8');
}

/**
 * A transcript as a person reads it: the control sequences a shell writes around its output are taken out, and so are the carriage returns, so that a line of output starts after a line feed whichever shell wrote it. Bash ends
 * bracketed paste with `ESC [ ? 2004 l CR` right before the output of a command and zsh with a line feed, so a pattern that wants the output at the start of a line sees it in zsh and not in bash: the first CI run of scenario r
 * timed out on the runner's bash for that reason, where it had passed on a Mac's zsh (the bytes were captured in the CI image: `echo SEAM_$((6*7))` CR LF ESC[?2004l CR SEAM_42 CR LF).
 */
const plain = (text) => text.replace(/\u001b\[[0-9;?<>=]*[ -/]*[@-~]/g, '').replaceAll('\r', '');
async function plainTranscriptOf(base, id) {
  return plain(await transcriptOf(base, id));
}

/** SEAM_PLATFORM=linux makes the page say it runs on Linux, so that a Mac can run the Windows and Linux branch of the terminal scenarios (the chords, the Clear button) that the CI image runs. */
async function spoofPlatform(page) {
  if (process.env.SEAM_PLATFORM === 'linux') {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64', configurable: true });
    });
  }
}

/** A test browser refuses the clipboard: the page's copy lands where a check can read it. */
async function keepCopies(page) {
  await page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied.push(text); } } });
  });
}

/** What the whole buffer of the emulator holds, scrollback and screen, read as a person copies it: select all, copy. */
async function bufferOf(page, mac) {
  await page.evaluate(() => { window.__copied.length = 0; });
  await page.keyboard.press(mac ? 'Meta+a' : 'Control+Shift+A');
  await page.keyboard.press(mac ? 'Meta+c' : 'Control+Shift+C');
  await waitUntil('the copy of the buffer', () => page.evaluate(() => window.__copied.length > 0), 15_000);
  return page.evaluate(() => window.__copied.at(-1));
}

const lineIn = (text, line) => text.split('\n').some((row) => row.trimEnd() === line);

/** Types a line into the terminal the page has the keyboard in, and presses Enter. */
async function typeLine(page, text) {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/**
 * Turns the Terminal's screen reader mode on or off through its palette command, by the keyboard, as a person does: F6 leaves the terminal (inside it Command K clears the screen on a Mac and Control K is the shell's), the palette's
 * chord (the page's own platform's: Command K on a Mac, Control K elsewhere) opens the palette, the words find the command and Enter runs it. The keyboard goes back to the terminal.
 */
async function switchScreenReader(page, mac) {
  await page.keyboard.press('F6');
  await page.keyboard.press(mac ? 'Meta+k' : 'Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.waitFor();
  await page.keyboard.type('screen reader');
  await palette.getByRole('option', { name: /^Command: Terminal: Toggle Screen Reader Mode/ }).waitFor();
  await page.keyboard.press('Enter');
  await palette.waitFor({ state: 'detached' });
  await page.locator('.xterm-helper-textarea').focus();
}

/** The size of the screen the emulator drew, as the page has it: its rows (by the 18 px row of the mock) and its width. */
function screenSizeOf(page) {
  return page.evaluate(() => {
    const box = document.querySelector('.xterm-screen')?.getBoundingClientRect();
    return box === undefined ? null : { rows: Math.round(box.height / 18), width: box.width, height: box.height };
  });
}

/** The rows and columns `stty size` printed last in a transcript (the line of two numbers after the command). */
function sttyOf(transcript) {
  const found = [...transcript.matchAll(/\r?\n(\d+) (\d+)\r?\n/g)].at(-1);
  return found === undefined ? null : { rows: Number(found[1]), cols: Number(found[2]) };
}

/**
 * The calls of the exec lane that the Terminal tool makes of the host, by the id each call of the page carries: `CreateTerminal` starts the shell and answers which one it is, `AckTerminal` tells the host how much of the output the screen has parsed (the
 * credit the host paces the shell by), `IsBusy` asks what runs in the terminal, `WriteTerminal` and `ResizeTerminal` are the input and the size with a sequence number for each call (the host applies them in the order they were sent, whatever order the
 * transport delivers them in), `WriteSession` and `ResizeSession` are the legacy calls, which the page does not make, and `ListTerminals`, `AttachTerminal`, `DetachTerminal` and `CloseSession` are how a page finds its terminals again, takes one over, lets
 * one go and ends one (T2b).
 */
const EXEC_CALLS = new Map(['CreateTerminal', 'AckTerminal', 'IsBusy', 'WriteTerminal', 'ResizeTerminal', 'WriteSession', 'ResizeSession', 'ListTerminals', 'AttachTerminal', 'DetachTerminal', 'CloseSession'].map((method) => [methodIdOf(EXEC_SERVICE, method), method]));

/** The page keys the pages of this run gave the host (in `CreateTerminal` and `ListTerminals`), so that the terminals they opened can be ended afterwards whatever page asks. A key is a capability: it is never printed. */
const PAGE_KEYS = new Set();

/**
 * Records what a page asks of the host in those calls, in the order it asks, and what the host answers: the arguments, when it asked and when the answer came (two marks of one counter, so that "after the answer" can be said, and the wall clock
 * of each, so that "after the reload" can), the status, whether the answer has come and the answer itself (`null` for a call that answers nothing). The checks about the host's facts (the shell's name, what runs in it, the credit that paces it, the
 * order of the input, the terminals a reloaded page finds) read the wire, so that each says what the page was told and what it did with it. A call the check makes itself through the page (`callAsPage`) carries a call id that starts with `seam-` and
 * is not recorded: the wire is what the product asked.
 */
function watchExecCalls(page) {
  const calls = [];
  const asked = new Map();
  let tick = 0;
  page.on('request', (request) => {
    const method = EXEC_CALLS.get(calledMethod(request));
    if (method === undefined) return;
    const body = JSON.parse(request.postData() ?? '{}');
    if (String(body.args?.['call-id'] ?? '').startsWith('seam-')) return;
    tick += 1;
    const call = { method, args: body.args?.args ?? [], askedAt: tick, askedMs: Date.now(), answeredAt: 0, answeredMs: 0, status: 0, answered: false, answer: null };
    const key = method === 'CreateTerminal' ? call.args[1]?.page_key : method === 'ListTerminals' ? call.args[0] : undefined;
    if (typeof key === 'string' && key !== '') PAGE_KEYS.add(key);
    asked.set(request, call);
    calls.push(call);
  });
  page.on('response', async (response) => {
    const call = asked.get(response.request());
    if (call === undefined) return;
    tick += 1;
    call.answeredAt = tick;
    call.answeredMs = Date.now();
    call.status = response.status();
    try {
      call.answer = JSON.parse(await response.text());
    } catch {
      call.answer = null;
    }

    call.answered = true;
  });
  return { calls, of: (method) => calls.filter((call) => call.method === method) };
}

/** What the host says to "what runs in this terminal?": the `IsBusy` the page asks when a terminal is closed, asked here by the check. */
const busyOf = async (base, id) => callBound(base, EXEC_SERVICE, 'IsBusy', id);

/**
 * Waits until the host says that a program of this name holds the terminal, and returns the host's answer. Between the fork of a command and its exec the foreground group is the shell's own child and the host names it for what it is then (`bash` for a `sleep`
 * that has not executed yet: the first CI run of this scenario read that name and failed), so the name is waited for and never read once.
 */
async function busyWith(base, id, name, engine) {
  let said;
  await waitUntil(`the host to say that ${name} holds the terminal`, async () => {
    said = await busyOf(base, id);
    return said.state === 'busy' && said.name === name;
  }, 60_000).catch((error) => {
    throw new Error(`${engine}: the host names the program that holds the terminal: ${String(error.message)} (the host's last answer was ${JSON.stringify(said)})`);
  });
  return said;
}

/** Whether a process exists: signal 0 reaches it and does nothing. A process of another user exists too (EPERM). */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * What the shell says it is called, asked of the shell and read from the host's replay: the name of its process from `ps` (the directory and a login shell's dash taken off) and the name it was started under (`$0`, the same way). A bash and a
 * zsh say it alike; `ps` is the better witness where a name is a link to another program (a `sh` that is dash), `$0` where there is no `ps`.
 */
async function askShellName(page, base, id) {
  await typeLine(page, 'printf \'SEAM_SHELL|%s|%s\\n\' "$(ps -p $$ -o comm= | sed \'s,.*/,,; s/^-//\')" "$(n=${0##*/}; echo ${n#-})"');
  let said = null;
  await waitUntil('the shell to say its name', async () => {
    said = /\nSEAM_SHELL\|([^|\n%]*)\|([^|\n%]*)\n/.exec(await plainTranscriptOf(base, id));
    return said !== null;
  }, 20_000);
  return { ps: said[1].trim(), zero: said[2].trim() };
}

/**
 * The grid the emulator has, asked of the emulator itself through the terminal protocol (as scenario r2 asks it where the cursor is after wide characters): the cursor is sent as far right and as far down as it goes (CSI 999 C and CSI 999 B stop at the edges)
 * and asked where it is (CSI 6 n), and the answer is the row and the column of the last cell, which are the rows and the columns of the screen. The shell reads the answer and prints it with the control characters made into underscores. This is the emulator's
 * own count, not a measure of its pixels: a width in pixels says only about how many cells a font may draw.
 */
async function emulatorGridOf(page, base, id) {
  await typeLine(page, 'stty -icanon -echo; printf \'\\033[999C\\033[999B\\033[6n\'; read -r -d R pos; stty sane; echo; echo "EMU_GRID=$(printf %s "$pos" | tr -c \'0-9;\' \'_\')"');
  let found = null;
  await waitUntil('the emulator to say how many rows and columns it has', async () => {
    found = [...(await plainTranscriptOf(base, id)).matchAll(/\nEMU_GRID=_*(\d+);(\d+)\n/g)].at(-1) ?? null;
    return found !== null;
  }, 20_000);
  return { rows: Number(found[1]), cols: Number(found[2]) };
}

/** The bytes of the lines `seq 1 n` writes on a pty: each number and its line end, which the line discipline makes two bytes (CR LF). */
function seqBytes(n) {
  let bytes = 0;
  for (let digits = 1, from = 1; from <= n; digits += 1, from *= 10) bytes += (Math.min(n, from * 10 - 1) - from + 1) * (digits + 2);
  return bytes;
}

/** The lines of a text that are a whole number each, as numbers and in the order they come: what `seq` wrote. */
const numbersOf = (text) =>
  text
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => /^\d+$/.test(row))
    .map(Number);

/** Where a list of numbers stops counting up by one (a number lost, repeated or out of order), or `undefined` when it never does. */
function firstBreak(numbers) {
  const at = numbers.findIndex((number, index) => index > 0 && number !== numbers[index - 1] + 1);
  return at < 0 ? undefined : { at, before: numbers[at - 1], after: numbers[at] };
}

/** The last line of a text that is not blank: what a person sees last. */
const lastLineOf = (text) =>
  text
    .split('\n')
    .map((row) => row.trimEnd())
    .filter((row) => row !== '')
    .at(-1);

/** Reads the emulator's buffer until it holds a line, every half second: a read selects everything and copies it, which a screen that is busy answers a frame later. Returns the buffer that holds it. */
async function untilLine(page, mac, line, what, ms) {
  const deadline = Date.now() + ms;
  let buffer = await bufferOf(page, mac);
  while (!lineIn(buffer, line)) {
    if (Date.now() > deadline) throw new Error(`timed out after ${String(ms)} ms waiting for ${what}; the buffer ends ${JSON.stringify(buffer.trimEnd().slice(-120))}`);
    await page.waitForTimeout(500);
    buffer = await bufferOf(page, mac);
  }

  return buffer;
}

/** Counts, from now on, the questions the window asks (the close prompt is a modal dialog the page mounts): one that is asked and taken back within a frame is counted all the same, which a look at the page could miss. */
async function watchQuestions(page) {
  await page.evaluate(() => {
    window.__questions = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches('[data-shell-part="closePrompt"], [role="alertdialog"]') || node.querySelector('[data-shell-part="closePrompt"], [role="alertdialog"]') !== null)) window.__questions += 1;
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  return async () => page.evaluate(() => window.__questions);
}

/**
 * Starts a terminal with the button that starts one (the empty state's, or the `+` of the strip) and returns its id once its shell is at the prompt: the host lists it, the emulator has the keyboard, and the host says that nothing
 * but the shell holds the terminal.
 */
async function startTerminal(page, base, button) {
  const known = await terminalIds(base);
  await button.click();
  await waitUntil('the host to list the new shell', async () => (await terminalIds(base)).length === known.length + 1, 30_000);
  const id = (await terminalIds(base)).find((one) => !known.includes(one));
  await waitUntil('the emulator to have the keyboard', async () => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false), 30_000);
  await waitUntil('the shell to say its prompt', async () => (await transcriptOf(base, id)).trim() !== '', 20_000);
  await waitUntil('the host to say the shell is at its prompt', async () => (await busyOf(base, id)).state === 'idle', 15_000);
  return id;
}

/**
 * Puts the keyboard in the emulator with a click at its top left corner, where the click takes a selection away and meets no program's mouse mode, and waits until the emulator has it and a frame after, so that what is typed next goes to the
 * emulator and not to the control the focus was on. With several terminals the screen that is shown is the one clicked (the others stay mounted, hidden).
 */
async function takeKeyboard(page) {
  await page.locator('.xterm-screen:visible').click({ position: { x: 3, y: 3 } });
  await waitUntil('the emulator to have the keyboard', async () => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false), 10_000);
  await afterFrames(page);
}

/** Drags the panel's splitter by `dy` pixels with the real pointer: down on the handle, twelve moves, up (the panel probe drags it the same way). A positive `dy` moves the pointer down and makes the panel shorter. */
async function dragHandle(page, dy) {
  const box = await page.locator('[data-shell-part="panelHandle"]').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 12 });
  await page.mouse.up();
}

/**
 * Where the focus is, as the checks of the close question read it: on the tab of that session in the panel's strip of sessions (found by its id), on the close button of a tab (the pointer's own aid: out of the tab order and hidden from the accessibility tree),
 * or inside anything that is hidden from the accessibility tree; and what it is, for the message.
 */
async function focusOf(page, tab) {
  return page.evaluate((id) => {
    const element = document.activeElement;
    const part = (node) => `${node.tagName.toLowerCase()}${node.getAttribute('role') === null ? '' : `[role=${node.getAttribute('role')}]`}${node.getAttribute('data-shell-part') === null ? '' : `[data-shell-part=${node.getAttribute('data-shell-part')}]`}`;
    return {
      onTab: element !== null && element.matches(`[data-shell-region="panel"] [data-shell-part="sessionTabs"] [role="tab"][data-tab-id="${id}"]`),
      onClose: element !== null && element.matches('[data-shell-part="sessionClose"]'),
      hidden: element !== null && element.closest('[aria-hidden="true"]') !== null,
      what: element === null ? 'nothing' : part(element),
    };
  }, tab);
}

/**
 * After a question was answered no, the focus is on the tab of the terminal it was about, a control a keyboard and a screen reader reach. It is not on the close button of the tab, which a mouse press reaches and nothing else does (the page gave the focus back to the
 * button the pointer had pressed), and not inside anything hidden from the accessibility tree. The focus is waited for: it lands a moment after the dialog is gone.
 */
async function assertFocusOnSessionTab(page, tab, engine, after) {
  let focus;
  await waitUntil('the focus to settle on the session\'s tab', async () => {
    focus = await focusOf(page, tab);
    return focus.onTab;
  }, 5_000).catch(() => undefined);
  assert.ok(focus.onTab, `${engine}: after ${after} the focus is on the tab of the terminal that was asked about, in the panel's strip of sessions (it is on ${focus.what})`);
  assert.equal(focus.onClose, false, `${engine}: after ${after} the focus is not on the close button of a tab, which only the pointer reaches`);
  assert.equal(focus.hidden, false, `${engine}: after ${after} the focus is not inside anything hidden from the accessibility tree`);
}

/** The page's ordered calls for each terminal it started, in the order it made them: `WriteTerminal(id, seq, data)` and `ResizeTerminal(id, seq, rows, cols)`, which count with one counter. */
function orderedCallsOf(wire) {
  const sessions = new Map();
  for (const call of wire.calls) {
    if (call.method !== 'WriteTerminal' && call.method !== 'ResizeTerminal') continue;
    sessions.set(call.args[0], [...(sessions.get(call.args[0]) ?? []), call]);
  }

  return sessions;
}

/**
 * What the page says to the host about a terminal's input and size is ORDERED (T2a, docs/ui-next/status/T1-go.md 2.4): it makes `WriteTerminal` and `ResizeTerminal` calls and never the legacy `WriteSession` and `ResizeSession`, and for each terminal the
 * sequence numbers of both kinds together count up from 1, one for each call, in the order the page made them, the first after the call that started the terminal had answered. The host applies them in that order whatever order the transport delivers them in.
 */
function assertOrderedCalls(wire, engine) {
  const legacy = wire.calls.filter((call) => call.method === 'WriteSession' || call.method === 'ResizeSession');
  assert.deepEqual(legacy.map((call) => call.method), [], `${engine}: the page makes no call of the legacy WriteSession or ResizeSession: its input and its size go in WriteTerminal and ResizeTerminal`);
  const sessions = orderedCallsOf(wire);
  assert.ok(sessions.size >= 1, `${engine}: the page made ordered calls (WriteTerminal, ResizeTerminal) for the terminals it started`);
  for (const [session, calls] of sessions) {
    const seqs = calls.map((call) => call.args[1]);
    assert.deepEqual(seqs, seqs.map((_, index) => index + 1), `${engine}: for terminal ${String(session)} the sequence numbers of WriteTerminal and ResizeTerminal count up from 1, one counter for writes and resizes, in the order the page made the calls (${String(seqs.length)} calls, the first ${JSON.stringify(seqs.slice(0, 30))})`);
    const started = wire.of('CreateTerminal').find((call) => call.args[0]?.id === session);
    assert.ok(started !== undefined && started.answeredAt > 0 && calls[0].askedAt > started.answeredAt, `${engine}: the first ordered call for terminal ${String(session)} was made after the call that started it had answered`);
  }
}

/**
 * Flow control on the real host, in a terminal that is on screen (T2a). A flood of about 8 MB (`seq 1 999999`: 7,888,887 bytes on the pty, where each line ends in CR LF) must complete in the emulator: the page turned the host's flow
 * control on with its first acknowledgement and acknowledges every byte it parses, so the host never stops reading for good. The end of it is looked for in the emulator's buffer and never in the host's replay: reading the replay (an
 * attach) makes the host forget what it is owed, and would let a page that acknowledges nothing through.
 */
async function terminalFlowVisible({ page, base, engine, mac, wire, note }, id) {
  const lines = 999_999;
  const bytes = seqBytes(lines);
  const calls = () => wire.of('AckTerminal');
  const from = calls().length;
  const acked = () => calls().slice(from).reduce((sum, call) => sum + (Number(call.args[1]) || 0), 0);
  await takeKeyboard(page);
  const started = Date.now();
  await typeLine(page, `seq 1 ${String(lines)}; echo FLOW_END_$((6*7))`);
  let buffer;
  try {
    buffer = await untilLine(page, mac, 'FLOW_END_42', 'the end of the flood in the emulator', 120_000);
  } catch (error) {
    throw new Error(`${engine}: a flood of ${String(bytes)} bytes completes in the terminal that is on screen (the page acknowledges what it parses, so the host never stops reading for good): ${String(error.message)}; ${String(acked())} bytes were acknowledged in ${String(calls().length - from)} calls`);
  }

  const took = Date.now() - started;
  await waitUntil('the last acknowledgement of the flood', async () => acked() >= bytes, 15_000).catch(() => undefined);
  assert.ok(acked() >= bytes && acked() <= bytes + 65_536, `${engine}: the page acknowledged the bytes of the flood once each: ${String(acked())} bytes in ${String(calls().length - from)} calls for a flood of ${String(bytes)}`);
  const tail = numbersOf(buffer);
  const broken = firstBreak(tail);
  assert.ok(tail.length >= 4_000 && tail.at(-1) === lines && broken === undefined, `${engine}: the lines the emulator holds at the end of the flood are in order and the last one is ${String(lines)} (${String(tail.length)} lines, the last ${String(tail.at(-1))}, ${broken === undefined ? 'in order' : `out of order at ${JSON.stringify(broken)}`})`);
  await takeKeyboard(page);
  await typeLine(page, 'echo AFTER_FLOW_$((6*7))');
  await waitUntil('the shell to answer a new command after the flood (flow control does not leave it paused)', async () => /\nAFTER_FLOW_42\n/.test(await plainTranscriptOf(base, id)), 20_000);
  note('flood on screen', `${String(bytes)} bytes completed in the emulator in ${(took / 1000).toFixed(1)} s; the page acknowledged ${String(acked())} bytes in ${String(calls().length - from)} calls; the last ${String(tail.length)} lines were in order`);
}

/**
 * Flow control on the real host, with the panel hidden (T2a). A hidden screen goes on reading, parsing and acknowledging what the host sends and draws nothing, so a hidden terminal does not stall its shell: a flood of 50 MB, about fifty times the mark at which
 * the host stops reading a pty that nobody acknowledges (1 MiB), completes with the panel hidden. The shell is made to wait for a line before it floods, so that the panel is hidden BEFORE the flood starts, and the check writes the line itself, through the host,
 * once the panel is hidden. The end of the flood is looked for in the host's replay (what the host read from the pty) only after the shell is back at its prompt, which `IsBusy` says and which has no effect on the credit: reading the replay (an attach) makes the
 * host forget what it is owed, so a read while the flood ran could let a page that acknowledges nothing through. That the PAGE credited the host is read from the wire: its acknowledgements while the panel was hidden are the bytes of the flood, all but what
 * the host may still be owed at its mark. Shown again, the end of the flood is in the emulator and the shell answers a new command.
 */
async function terminalFlowHidden({ page, base, engine, mac, wire, note }, id) {
  const flood = 50_000_000;
  // What the host may still be owed when the shell is done: its mark (1 MiB), the read it was in (at most 20,480 bytes) and the kernel's buffer of the pty, which the host has not read yet.
  const owed = 1_048_576 + 20_480 + 65_536;
  const acked = () => wire.of('AckTerminal').filter((call) => call.args[0] === id).reduce((sum, call) => sum + (Number(call.args[1]) || 0), 0);
  const hidden = async (want) => page.evaluate((state) => document.querySelector('[data-shell-part="panel"]')?.hidden === state, want);
  const toggle = page.locator('[data-shell-part="panelToggle"]');
  await takeKeyboard(page);
  await typeLine(page, `echo GATE_READY_$((6*7)); read -r go; head -c ${String(flood)} /dev/zero | tr '\\0' y; echo; echo HIDDEN_END_$((6*7))`);
  await waitUntil('the shell to wait for its line', async () => /\nGATE_READY_42\n/.test(await plainTranscriptOf(base, id)), 30_000);
  await toggle.click();
  await waitUntil('the panel to be hidden', async () => hidden(true), 5_000);
  await afterFrames(page);
  const from = acked();
  const started = Date.now();
  await callBound(base, EXEC_SERVICE, 'WriteSession', id, Buffer.from('\n').toString('base64'));
  await waitUntil('the flood to hold the terminal', async () => (await busyOf(base, id)).state === 'busy', 30_000);
  // The shell is back at its prompt when the host says idle again. A flood whose acknowledgements do not grow for a minute is a stalled flood and says so; one that goes on has five minutes.
  let last = { at: Date.now(), acked: acked() };
  try {
    await waitUntil('the flood to complete with the panel hidden', async () => {
      const now = acked();
      if (now !== last.acked) last = { at: Date.now(), acked: now };
      if (Date.now() - last.at > 60_000) throw new Error(`the flood made no progress for a minute: the page acknowledged ${String(now - from)} bytes and the host still says the flood holds the terminal`);
      return (await busyOf(base, id)).state === 'idle';
    }, 300_000);
  } catch (error) {
    throw new Error(`${engine}: with the panel hidden a flood of ${String(flood)} bytes completes (the hidden screen goes on reading, parsing and acknowledging, so the host never stops reading the shell): ${String(error.message)}`);
  }

  const took = Date.now() - started;
  const whileHidden = acked() - from;
  assert.equal(await hidden(true), true, `${engine}: the panel was hidden the whole time the flood ran`);
  assert.ok(whileHidden >= flood - owed, `${engine}: the page acknowledged what it parsed while the panel was hidden: ${String(whileHidden)} of the ${String(flood)} bytes of the flood (the host may be owed the last ${String(owed)})`);
  // The flood is over: the host's replay can be read now. The shell writes its marker a moment after it takes the terminal back, so the replay is read until it holds it.
  let replay = '';
  await waitUntil('the end of the flood in the host\'s own read of the pty', async () => {
    replay = await plainTranscriptOf(base, id);
    return replay.includes('\nHIDDEN_END_42\n');
  }, 60_000).catch(() => undefined);
  assert.ok(/y{1000}\nHIDDEN_END_42\n/.test(replay), `${engine}: the end of the flood is in what the host read from the pty with the panel hidden: its replay ends in the flood and the marker (it ends ${JSON.stringify(replay.slice(-80))})`);
  await toggle.click();
  await waitUntil('the panel to be shown', async () => hidden(false), 5_000);
  await takeKeyboard(page);
  const shownAt = Date.now();
  let buffer;
  try {
    buffer = await untilLine(page, mac, 'HIDDEN_END_42', 'the end of the flood in the emulator', 180_000);
  } catch (error) {
    throw new Error(`${engine}: shown again, the end of the flood is in the emulator (nothing was lost and the shell went on): ${String(error.message)}`);
  }

  const arrived = Date.now() - shownAt;
  await waitUntil('the last acknowledgement of the flood', async () => acked() - from >= flood, 30_000).catch(() => undefined);
  const total = acked() - from;
  assert.ok(total >= flood && total <= flood + 65_536, `${engine}: the page acknowledged the bytes of the flood once each, hidden and shown: ${String(total)} bytes for a flood of ${String(flood)}`);
  assert.ok(lineIn(buffer, 'HIDDEN_END_42'), `${engine}: shown again, the emulator holds the end of the flood`);
  await takeKeyboard(page);
  await typeLine(page, 'echo AFTER_HIDDEN_$((6*7))');
  await waitUntil('the shell to answer a new command after the flood (it is not left blocked)', async () => /\nAFTER_HIDDEN_42\n/.test(await plainTranscriptOf(base, id)), 30_000);
  note('flood with the panel hidden', `${String(flood)} bytes completed with the panel hidden in ${(took / 1000).toFixed(1)} s, the host said busy until then and idle after; the page acknowledged ${String(whileHidden)} bytes while it was hidden and ${String(total)} in all; the host's replay held the end; shown again the end was in the emulator after ${(arrived / 1000).toFixed(1)} s and the shell answered`);
}

/**
 * Closing a terminal with a program running (T2a): the host says what holds the terminal (`IsBusy`) and the question names it, as the host spells it. The check first waits for the host to say `sleep` (between the fork of a command and its exec the host names the
 * foreground group for the shell: the first CI run of this scenario read `bash` and failed). Cancel and Escape, whether the close was pressed with the pointer on the tab's close button or with Delete on the tab, keep the session and the process, and the focus goes
 * to the tab of that terminal: not to the close button, which only the pointer reaches. Terminate session ends both: the host lists no session, the process is gone (by its process group, which the host names) and the focus is on the tool's own tab, the last
 * terminal being closed.
 */
async function terminalCloseBusy({ page, base, engine, note }, id, shell) {
  const dialog = page.getByRole('alertdialog', { name: 'Terminate session?' });
  const tab = page.locator('[data-shell-part="sessionTabs"] [role="tab"][aria-selected="true"]');
  const tabId = await tab.getAttribute('data-tab-id');
  const close = page.locator('[data-shell-part="sessionClose"]').first();
  const question = async () =>
    page.evaluate(() => {
      const element = document.querySelector('[data-shell-part="closePrompt"]');
      return element === null ? null : { body: document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent ?? '', session: element.querySelector('p')?.textContent ?? '', focus: document.activeElement?.textContent ?? '' };
    });
  await takeKeyboard(page);
  await typeLine(page, 'sleep 60');
  const busy = await busyWith(base, id, 'sleep', engine);
  assert.ok(Number.isInteger(busy.pgid) && busy.pgid > 1, `${engine}: the host names the process group that holds the terminal (IsBusy says ${JSON.stringify(busy)})`);
  const stays = async (what) => {
    for (let turn = 0; turn < 5; turn += 1) await afterFrames(page);
    assert.deepEqual(await terminalIds(base), [id], `${engine}: the session is still there after ${what}`);
    assert.ok(alive(busy.pgid) && (await busyOf(base, id)).state === 'busy', `${engine}: sleep is still running after ${what}`);
  };

  // The pointer: the close button of the tab, then Cancel; again, then Escape.
  await close.click();
  await dialog.waitFor();
  const asked = await question();
  assert.equal(asked?.body, `${String(busy.name)} is running in this terminal. This ends the terminal session and stops it.`, `${engine}: the question names the program the host says holds the terminal, as the host spells it`);
  assert.equal(asked?.session, shell, `${engine}: the question says which session it is about`);
  assert.equal(asked?.focus, 'Cancel', `${engine}: Cancel has the focus in the question`);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await stays('Cancel');
  await assertFocusOnSessionTab(page, tabId, engine, 'Cancel, the close button of the tab having been pressed with the pointer');
  await close.click();
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await stays('Escape');
  await assertFocusOnSessionTab(page, tabId, engine, 'Escape, the close button of the tab having been pressed with the pointer');
  // The keyboard: Delete on the tab asks, and Enter on Cancel (which has the keyboard) says no; the focus is back on the tab it was on.
  await tab.focus();
  await page.keyboard.press('Delete');
  await dialog.waitFor();
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  await stays('Enter on Cancel, Delete having been pressed on the tab');
  await assertFocusOnSessionTab(page, tabId, engine, 'Enter on Cancel, Delete having been pressed on the tab');
  await close.click();
  await dialog.waitFor();
  await page.getByRole('button', { name: 'Terminate session', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await waitUntil('the host to list no shell', async () => (await terminalIds(base)).length === 0, 10_000);
  await waitUntil('sleep to be gone', async () => !alive(busy.pgid), 15_000).catch(() => undefined);
  assert.equal(alive(busy.pgid), false, `${engine}: Terminate session ended the program as well as the session: process group ${String(busy.pgid)} is gone`);
  await page.getByText('No terminals', { exact: true }).waitFor();
  const onToolTab = async () => page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement.closest('[data-shell-part="panelTools"]') !== null && (document.activeElement.textContent ?? '').includes('Terminal'));
  await waitUntil('the focus to reach the tool\'s tab', onToolTab, 5_000).catch(() => undefined);
  assert.ok(await onToolTab(), `${engine}: the focus is on the tool's tab after the last terminal closed`);
  note('close with a program running', `IsBusy said ${JSON.stringify(busy)}; the question named it; Cancel, Escape and Enter on Cancel (the close pressed with the pointer, then Delete on the tab) kept the session and the process and the focus went to the tab each time; Terminate session ended both`);
}

/**
 * Closing a terminal that is at its prompt (T2a): the host says that nothing but the shell holds it (`IsBusy`: idle), and the page asks nothing of the person. The close is made by the pointer, on the tab's close button, as the question's
 * own is. The window is watched for a question for a second after the press, longer than the host needs to answer, and a question that is asked and taken back within a frame is counted all the same. The page asks the host once.
 */
async function terminalCloseIdle({ page, base, engine, wire, questions, note }) {
  const id = await startTerminal(page, base, page.locator('[data-shell-part="panelEmpty"]').getByRole('button', { name: 'New terminal', exact: true }));
  let idle;
  await waitUntil('the host to say that nothing but the shell holds the terminal', async () => {
    idle = await busyOf(base, id);
    return idle.state === 'idle';
  }, 15_000).catch(() => undefined);
  assert.equal(idle.state, 'idle', `${engine}: the host says that nothing but the shell holds a terminal at its prompt (IsBusy says ${JSON.stringify(idle)})`);
  const before = { asked: wire.of('IsBusy').length, questions: await questions() };
  await page.locator('[data-shell-part="sessionClose"]').first().click();
  await page.waitForTimeout(1_000);
  assert.equal(await questions(), before.questions, `${engine}: closing a terminal with nothing running asks nothing: no dialog was mounted in the second after the press`);
  assert.equal(await page.getByRole('alertdialog').count(), 0, `${engine}: closing a terminal with nothing running asks nothing: no dialog is on screen`);
  await page.getByText('No terminals', { exact: true }).waitFor();
  assert.equal(await questions(), before.questions, `${engine}: closing a terminal with nothing running asks nothing: no dialog was mounted until the tab went`);
  await waitUntil('the host to list no shell', async () => (await terminalIds(base)).length === 0, 10_000);
  const asked = wire.of('IsBusy').slice(before.asked);
  await waitUntil('the answer of the host to the page', async () => asked[0]?.answered === true, 5_000).catch(() => undefined);
  assert.equal(asked.length, 1, `${engine}: closing asks the host what runs in the terminal once, and does not poll`);
  assert.equal(asked[0].answer?.state, 'idle', `${engine}: what the host answered the page for the terminal at its prompt is idle (${JSON.stringify(asked[0].answer)})`);
  note('close at the prompt', `IsBusy said ${JSON.stringify(idle)}; the page asked the host once and the host answered ${JSON.stringify(asked[0].answer)}; no dialog, the tab went and the host listed no shell`);
}

/**
 * Closing with the keyboard (T2a): Delete on the focused tab of a terminal at its prompt asks nothing and closes it, and the focus goes where a close puts it: with another terminal open, to the tab that is left (not the one that closed), and when it was the last, to
 * the tool's own tab. It never falls to the page's body, which a close that waits for the host's answer could do if it forgot where the focus was.
 */
async function terminalCloseKeys({ page, base, engine, questions, note }) {
  await startTerminal(page, base, page.locator('[data-shell-part="panelEmpty"]').getByRole('button', { name: 'New terminal', exact: true }));
  await startTerminal(page, base, page.locator('[data-shell-part="sessionAdd"]').getByRole('button', { name: 'New terminal', exact: true }));
  const selected = page.locator('[data-shell-part="sessionTabs"] [role="tab"][aria-selected="true"]');
  const focused = async () =>
    page.evaluate(() => {
      const element = document.activeElement;
      return { role: element?.getAttribute('role') ?? null, selected: element?.getAttribute('aria-selected') ?? null, tab: element?.getAttribute('data-tab-id') ?? null, name: element?.getAttribute('aria-label') ?? element?.textContent ?? '', inSessions: Boolean(element?.closest('[data-shell-part="sessionTabs"]')), inTools: Boolean(element?.closest('[data-shell-part="panelTools"]')) };
    });
  const before = await questions();
  const closing = await selected.getAttribute('data-tab-id');
  await selected.focus();
  await page.keyboard.press('Delete');
  await waitUntil('the host to list one shell', async () => (await terminalIds(base)).length === 1, 10_000);
  await waitUntil('the focus to reach the tab that is left', async () => {
    const now = await focused();
    return now.role === 'tab' && now.inSessions && now.tab !== closing;
  }, 10_000).catch(() => undefined);
  const neighbour = await focused();
  assert.ok(neighbour.role === 'tab' && neighbour.inSessions && neighbour.selected === 'true' && neighbour.tab !== closing, `${engine}: after Delete closed a terminal with nothing running the focus is on the tab that is left, and not on the page's body (it is on ${JSON.stringify(neighbour)})`);
  assert.equal(await page.locator('[data-shell-part="sessionTabs"] [role="tab"]').count(), 1, `${engine}: the tab of the closed terminal is gone and the other stays`);
  await page.keyboard.press('Delete');
  await waitUntil('the host to list no shell', async () => (await terminalIds(base)).length === 0, 10_000);
  await page.getByText('No terminals', { exact: true }).waitFor();
  await waitUntil('the focus to reach the tool\'s tab', async () => {
    const now = await focused();
    return now.role === 'tab' && now.inTools;
  }, 10_000).catch(() => undefined);
  const tool = await focused();
  assert.ok(tool.role === 'tab' && tool.inTools && tool.name.includes('Terminal'), `${engine}: after Delete closed the last terminal the focus is on the tool's own tab, and not on the page's body (it is on ${JSON.stringify(tool)})`);
  assert.equal(await questions(), before, `${engine}: closing two terminals at their prompts with Delete asked nothing`);
  note('close with Delete', 'a terminal at its prompt closed with no dialog; the focus went to the tab that was left, then to the tool\'s tab');
}

/**
 * r. The Terminal tool (T1, T2a), on the real host: the panel opens on it with no session and no emulator code; New terminal starts ONE shell the host lists and the emulator takes the keyboard; the session's tab is called by the shell (what the host answered to the
 * call that starts it, checked against what the shell says it is) and not Terminal; the terminal starts at the size the person sees (the call that starts it carries it, the pty has it and no resize follows); the OUTPUT of a command reaches the transcript (read from
 * the host's replay of the session: the GPU draws on a canvas); the page's input and size are ordered calls (WriteTerminal and ResizeTerminal with one counter from 1, never the legacy calls); the pty has the new rows after the panel is raised with the keyboard and
 * dragged shorter with the pointer; Escape stays in the shell, F6 leaves, Command J hides the panel. The screen reader mode is turned on and off through the palette command by the keyboard: a line the shell printed is in the accessibility snapshot of the screen while it
 * is on and not while it is off, the input's description says which, and the window announces each change. Flow control (the host paces the shell by what the page acknowledges, shown or hidden): a flood of about 8 MB completes in the terminal that is on screen, and a flood
 * of 50 MB completes with the panel hidden. Closing: a terminal at its prompt closes with no question, by the pointer and by Delete, the focus staying in the panel; with `sleep 60` running the question names it, Cancel and Escape keep both and the focus goes to the tab, and
 * Terminate session ends them. A shell that runs `exit 3` is an ended session that says `Exited with code 3`. `r2` below is the emulator against the programs of the machine.
 */
async function checkTerminal(page, base, engine) {
  const errors = [];
  const chunks = [];
  const observed = [];
  const note = (name, text) => observed.push(`${name}: ${text}`);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('request', (request) => {
    if (/xtermEngine/.test(request.url())) chunks.push(request.url());
  });
  const wire = watchExecCalls(page);
  await spoofPlatform(page);
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await keepCopies(page);

  // The panel opens on the Terminal tool, which has no session: its words, and not one byte of the emulator.
  await page.locator('[data-shell-part="panelToggle"]').click();
  await page.getByRole('tab', { name: 'Terminal', selected: true }).waitFor({ timeout: 10_000 });
  await page.getByText('No terminals', { exact: true }).waitFor();
  assert.deepEqual(await terminalIds(base), [], `${engine}: no shell exists before New terminal`);
  assert.deepEqual(chunks, [], `${engine}: the emulator's code was not requested before the first terminal`);

  // One press: one shell, the code is fetched, and the emulator has the keyboard.
  await page.locator('[data-shell-part="panelEmpty"]').getByRole('button', { name: 'New terminal', exact: true }).click();
  await page.locator('.xterm-helper-textarea').waitFor({ timeout: 30_000 });
  await waitUntil('the host to list the shell', async () => (await terminalIds(base)).length === 1, 30_000);
  const [id] = await terminalIds(base);
  assert.ok(chunks.length >= 1, `${engine}: the emulator's code was requested when the terminal was shown`);
  await waitUntil('the emulator to have the keyboard', () => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false), 10_000);
  await waitUntil('the shell to say its prompt', async () => (await transcriptOf(base, id)).trim() !== '', 20_000);

  // The terminal started at the size the person sees (T2a): the first size the view tells the feed starts the shell, and it is told only once the GPU renderer is in place, so the call that starts the terminal carries the final size and the page sends no resize after it.
  // The wait is a count of frames (90: 1.5 s at 60 Hz, longer on a slower machine), past the settling of a size (100 ms) and the answer of the host. Then the shell says its size: the pty has what the call carried, and that is the grid the emulator itself counts
  // (asked of the emulator with a cursor position report, `emulatorGridOf`): the rows exactly, the columns within one.
  const created = wire.of('CreateTerminal');
  await waitUntil('the answer of the host to the call that started the terminal', async () => created[0]?.answered === true, 10_000);
  // Only the size of the call is kept: the call carries the page key too (a secret: no message of a check may print it).
  const launch = { cols: created[0].args[1]?.cols, rows: created[0].args[1]?.rows };
  assert.ok(Number.isInteger(launch?.cols) && Number.isInteger(launch?.rows) && launch.cols > 0 && launch.rows > 0, `${engine}: the call that starts the terminal carries the size of the screen (it carried ${JSON.stringify(launch)})`);
  for (let turn = 0; turn < 45; turn += 1) await afterFrames(page);
  assert.deepEqual(wire.calls.filter((call) => call.method === 'ResizeTerminal' || call.method === 'ResizeSession').map((call) => [call.method, ...call.args]), [], `${engine}: the page sends no resize after the terminal started: the call that started it carried the size the person sees (${JSON.stringify(launch)}) and no ResizeTerminal (nor the legacy ResizeSession) followed it in the 90 frames after the shell's first prompt`);
  await typeLine(page, 'stty size');
  await waitUntil('stty size to answer', async () => sttyOf(await plainTranscriptOf(base, id)) !== null, 15_000);
  const born = sttyOf(await plainTranscriptOf(base, id));
  const seen = await screenSizeOf(page);
  const grid = await emulatorGridOf(page, base, id);
  assert.ok(born.rows === launch.rows && born.cols === launch.cols, `${engine}: the pty has the size the call that started the terminal carried: ${JSON.stringify(launch)}, it said ${JSON.stringify(born)}`);
  assert.equal(born.rows, seen.rows, `${engine}: right after the first prompt the pty has the rows the emulator drew (${String(seen.rows)}), it said ${String(born.rows)}`);
  assert.equal(born.rows, grid.rows, `${engine}: right after the first prompt the pty has the rows the emulator counts (the emulator says ${String(grid.rows)}), it said ${String(born.rows)}`);
  assert.ok(Math.abs(born.cols - grid.cols) <= 1, `${engine}: right after the first prompt the pty has the columns the emulator counts, to within one (the emulator says ${String(grid.cols)}), it said ${String(born.cols)}`);

  // The session's tab is called by the shell (T2a): the host's answer to the call that started the terminal names the shell it started (`zsh`, `bash`), the tab says that and not Terminal, the emulator's input is named for it, and the tool's
  // own tab in the strip of tools stays Terminal. The shell is asked what it is called, so that the name is proved against the shell and not only against the host's own word for it; what the host answered is read from the wire.
  const said = await askShellName(page, base, id);
  const named = created[0].answer?.shell?.name;
  const tabNames = async () => page.locator('[data-shell-part="sessionTabs"] [role="tab"]').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label')));
  await waitUntil('the session tab to be called by the shell', async () => !/^Terminal\b/.test((await tabNames())[0] ?? 'Terminal'), 10_000).catch(() => undefined);
  const shell = (await tabNames())[0];
  assert.notEqual(shell, 'Terminal', `${engine}: the session's tab is not called Terminal, it is called by the shell the host started (the host answered ${JSON.stringify(created[0].answer?.shell)})`);
  assert.ok([said.ps, said.zero].includes(shell), `${engine}: the session's tab is called by the name the shell says it has (the tab: ${JSON.stringify(shell)}; the shell: ps ${JSON.stringify(said.ps)}, $0 ${JSON.stringify(said.zero)})`);
  assert.equal(shell, named, `${engine}: the session's tab says what the host answered to the call that started the terminal (the host answered ${JSON.stringify(created[0].answer?.shell)})`);
  assert.equal(await page.locator('[data-shell-part="panelTools"]').getByRole('tab', { name: 'Terminal', exact: true }).count(), 1, `${engine}: the tool's own tab in the strip of tools is still called Terminal`);
  const inputName = () => page.locator('.xterm-helper-textarea').getAttribute('aria-label');
  await waitUntil('the emulator\'s input to be named for the shell', async () => (await inputName()) === `Terminal input, ${String(shell)}`, 10_000).catch(() => undefined);
  assert.equal(await inputName(), `Terminal input, ${String(shell)}`, `${engine}: the input is named for a person who cannot see the screen, with the shell's name`);
  assert.equal(wire.of('AckTerminal')[0]?.args[0], id, `${engine}: the page turned the host's flow control on when the terminal started: its first call of AckTerminal names the session`);
  note('shell name', `ps said ${JSON.stringify(said.ps)}, $0 said ${JSON.stringify(said.zero)}; the host answered ${JSON.stringify(created[0].answer?.shell)}; the tab is ${JSON.stringify(shell)}, the input is "Terminal input, ${String(shell)}", the tool's tab is Terminal; the first AckTerminal was for ${String(wire.of('AckTerminal')[0]?.args[1])} bytes`);

  // A command with a known output: the output line, not only the echo of what was typed.
  await typeLine(page, 'echo SEAM_$((6*7))');
  await waitUntil('the output of the command', async () => /\r?\nSEAM_42\r?\n/.test(await plainTranscriptOf(base, id)), 15_000);

  // Screen reader mode. The emulator's printed output is not in the accessibility tree until the person turns the mode on: the words the input is described by say so and name the command, and the command (in the palette, by the
  // keyboard) turns it on and off. A line the shell printed with the mode on is in the screen's accessibility snapshot; with it off, before and after, it is not.
  const screenRegion = page.locator('[data-shell-part="terminalScreen"]');
  const described = () => page.evaluate(() => document.getElementById(document.querySelector('.xterm-helper-textarea')?.getAttribute('aria-describedby') ?? '')?.textContent ?? '');
  const told = () => page.locator('[data-notices-part="live"]').textContent();
  const holds = async (text) => (await screenRegion.ariaSnapshot()).includes(text);
  const NOT_READ = /The output is not read aloud until screen reader mode is on\..*Terminal: Toggle Screen Reader Mode/;
  const READ = /Screen reader mode is on: the output is read aloud\. To turn it off.*Terminal: Toggle Screen Reader Mode/;
  /** The description of the emulator's input once it says what is wanted (it follows the mode a moment after the window announces it): what it says then, or what it says after 10 s. */
  const describedAs = async (pattern) => {
    await waitUntil('the description of the input to follow the mode', async () => pattern.test(await described()), 10_000).catch(() => undefined);
    return described();
  };
  assert.match(await described(), /The output is not read aloud until screen reader mode is on\..*Terminal: Toggle Screen Reader Mode/, `${engine}: the input is described as not read aloud until the mode is on, and the description names the command`);
  assert.equal(await holds('SEAM_42'), false, `${engine}: with the mode off a line the shell printed is not in the accessibility tree of the screen`);
  await switchScreenReader(page, mac);
  await waitUntil('the window to announce that the mode is on', async () => (await told()) === 'Terminal screen reader mode on.', 10_000);
  assert.match(await describedAs(READ), READ, `${engine}: with the mode on the input is described as read aloud, with the way to turn it off`);
  await typeLine(page, 'echo SR_$((6*7))');
  await waitUntil('SR_42 in the accessibility tree of the screen', async () => (await screenRegion.getByRole('listitem').filter({ hasText: /^SR_42$/ }).count()) === 1, 20_000);
  assert.ok(await holds('SR_42'), `${engine}: with the mode on the line the shell printed is in the accessibility snapshot of the screen`);
  await switchScreenReader(page, mac);
  await waitUntil('the window to announce that the mode is off', async () => (await told()) === 'Terminal screen reader mode off.', 10_000);
  await waitUntil('the list items of the screen to go', async () => (await screenRegion.getByRole('listitem').count()) === 0, 10_000).catch(() => undefined);
  assert.equal(await screenRegion.getByRole('listitem').count(), 0, `${engine}: with the mode off again the screen has no list items for a screen reader to read`);
  assert.equal(await holds('SR_42'), false, `${engine}: with the mode off again the line is no longer in the accessibility tree of the screen`);
  assert.match(await describedAs(NOT_READ), NOT_READ, `${engine}: with the mode off again the input is described as not read aloud, and names the command`);
  await typeLine(page, 'echo SR_BACK_$((6*7))');
  await waitUntil('the output of the command', async () => /\r?\nSR_BACK_42\r?\n/.test(await plainTranscriptOf(base, id)), 15_000);

  // The resize reaches the process: the screen is raised with the End key on its handle, the page tells the host with ResizeTerminal, and the pty has the rows the page draws then (the size the terminal started at is `seen`, above).
  const before = seen;

  await page.locator('[data-shell-part="panelHandle"]').focus();
  await page.keyboard.press('End');
  await waitUntil('the screen to grow', async () => ((await screenSizeOf(page))?.height ?? 0) > before.height + 40, 10_000);
  await page.waitForTimeout(600);
  // The emulator had the keyboard and the handle took it: the person goes back to the terminal with the pointer.
  await page.locator('.xterm-screen').click();
  const after = await screenSizeOf(page);
  // A resize reaches the pty in steps (one call in flight, then the newest size), so `stty size` is asked again until the pty has the rows the page draws, and the assertion below is about that size and no intermediate one.
  const ptyRows = async () => {
    const from = (await plainTranscriptOf(base, id)).length;
    await typeLine(page, 'stty size');
    await waitUntil('stty size to answer', async () => sttyOf((await plainTranscriptOf(base, id)).slice(from)) !== null, 15_000);
    return sttyOf((await plainTranscriptOf(base, id)).slice(from));
  };
  let second = await ptyRows();
  for (let tries = 0; tries < 10 && second.rows !== after.rows; tries += 1) {
    await page.waitForTimeout(500);
    second = await ptyRows();
  }

  assert.ok(after.rows > before.rows, `${engine}: the panel is taller, so the screen has more rows`);
  assert.equal(second.rows, after.rows, `${engine}: after the panel was raised the pty has the new rows (${String(after.rows)}), it said ${String(second.rows)}`);
  // The page told the host the new size in a ResizeTerminal call (ROWS, then COLUMNS), and the last one it sent is the rows it drew: this is also the check's proof that it can see a resize.
  const sent = () => wire.of('ResizeTerminal').filter((call) => call.args[0] === id);
  assert.ok(sent().length >= 1, `${engine}: when the panel was raised the page sent the new size in a ResizeTerminal call`);
  assert.equal(sent().at(-1)?.args[2], after.rows, `${engine}: the last ResizeTerminal says the rows the page drew (${String(after.rows)}): it was ${JSON.stringify(sent().at(-1)?.args)}`);
  // The pointer: dragging the splitter shorter is a resize too, sent with a later number, and the pty follows.
  const raised = sent().length;
  await dragHandle(page, 120);
  await waitUntil('the screen to shrink', async () => ((await screenSizeOf(page))?.height ?? 0) < after.height - 40, 10_000);
  await page.waitForTimeout(600);
  await takeKeyboard(page);
  const shrunk = await screenSizeOf(page);
  let third = await ptyRows();
  for (let tries = 0; tries < 10 && third.rows !== shrunk.rows; tries += 1) {
    await page.waitForTimeout(500);
    third = await ptyRows();
  }

  assert.ok(shrunk.rows < after.rows, `${engine}: the panel dragged shorter has a screen with fewer rows`);
  assert.equal(third.rows, shrunk.rows, `${engine}: after the panel was dragged shorter the pty has the new rows (${String(shrunk.rows)}), it said ${String(third.rows)}`);
  assert.ok(sent().length > raised && sent().at(-1).args[2] === shrunk.rows, `${engine}: the drag was sent in ResizeTerminal calls: ${String(sent().length - raised)} more, the last for ${String(sent().at(-1)?.args[2])} rows, the screen drew ${String(shrunk.rows)}`);
  assert.ok(sent().every((call, index) => index === 0 || call.args[1] > sent()[index - 1].args[1]), `${engine}: the ResizeTerminal calls carry increasing sequence numbers (${JSON.stringify(sent().map((call) => call.args[1]))})`);
  note('size', `the call that started the terminal carried ${JSON.stringify(launch)} and the pty said ${JSON.stringify(born)}; the emulator counted ${String(grid.rows)} rows and ${String(grid.cols)} columns (its screen: ${String(seen.rows)} rows, ${String(Math.round(seen.width))} px); no ResizeTerminal in the 90 frames after the first prompt; the End key sent ${String(raised)} (the last for ${String(after.rows)} rows) and the drag ${String(sent().length - raised)} more (the last for ${String(shrunk.rows)} rows), numbers ${JSON.stringify(sent().map((call) => call.args[1]))}`);

  // A keyboard user can always leave (A14): Escape stays in the shell, F6 leaves, and on a Mac Command J hides the panel.
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false), `${engine}: Escape does not leave the terminal`);
  await page.keyboard.press('F6');
  assert.ok(await page.evaluate(() => {
    const element = document.activeElement;
    return element !== null && element !== document.body && element !== document.documentElement && element.closest('.xterm') === null;
  }), `${engine}: F6 moves the focus out of the terminal and onto another control (not onto the page's body)`);
  await page.locator('.xterm-screen').click();
  if (mac) {
    await page.keyboard.press('Meta+j');
    await waitUntil('the panel to hide', () => page.evaluate(() => document.querySelector('[data-shell-part="panel"]') === null || getComputedStyle(document.querySelector('[data-shell-part="panel"]')).display === 'none' || document.querySelector('[data-shell-part="panel"]').getBoundingClientRect().height === 0), 5_000);
    assert.ok(await page.evaluate(() => !(document.activeElement?.closest('.xterm') ?? null)), `${engine}: Command J gives the focus back to the page`);
    await page.keyboard.press('Meta+j');
    await page.locator('.xterm-screen').waitFor({ state: 'visible' });
  }

  // The Escape pressed above went to the shell, and a shell keeps an Escape as the first half of a key sequence: bash and zsh read the next key as Meta-<key>, however long after it comes (the first character of the flood was swallowed and the
  // shell ran `eq`). Control C ends that line, and the check goes on when the shell has shown a fresh prompt.
  await takeKeyboard(page);
  const afterEscape = (await transcriptOf(base, id)).length;
  await page.keyboard.press('Control+c');
  await waitUntil('the shell to show a fresh prompt after Control C', async () => (await transcriptOf(base, id)).length > afterEscape, 10_000);
  await typeLine(page, 'echo SYNC_$((6*7))');
  await waitUntil('the shell to answer after Control C', async () => /\nSYNC_42\n/.test(await plainTranscriptOf(base, id)), 20_000);

  // Flow control on the real host (T2a): a flood in the terminal that is on screen completes, and so does a flood of 50 MB with the panel hidden (the hidden screen goes on reading, parsing and acknowledging), and the shell answers after each.
  const questions = await watchQuestions(page);
  const c = { page, base, engine, mac, wire, note, questions };
  await terminalFlowVisible(c, id);
  await terminalFlowHidden(c, id);

  // Closing (T2a). With a program running the host says so and the question names it; a terminal at its prompt asks nothing, whichever way it is closed. The terminal of the checks above is the one that is closed with a program running.
  await terminalCloseBusy(c, id, shell);
  await terminalCloseIdle(c);
  await terminalCloseKeys(c);

  // A shell that exits is an ended session, with how it ended in the host's own words (the typed end of the session is an object): kept, its output readable, its tab announced as ended, and closing it asks nothing.
  await page.locator('[data-shell-part="panelEmpty"]').getByRole('button', { name: 'New terminal', exact: true }).click();
  await page.locator('.xterm-helper-textarea').waitFor({ timeout: 30_000 });
  await waitUntil('the host to list the second shell', async () => (await terminalIds(base)).length === 1, 30_000);
  const [second_id] = await terminalIds(base);
  await waitUntil('the second shell to say its prompt', async () => (await transcriptOf(base, second_id)).trim() !== '', 20_000);
  // The output must outlive the shell: a marker is in the emulator before the exit and still there once the session says it ended.
  await typeLine(page, 'echo SURVIVES_$((6*7))');
  await waitUntil('the emulator to hold the marker before the shell exits', async () => lineIn(await bufferOf(page, mac), 'SURVIVES_42'), 20_000);
  await takeKeyboard(page);
  await typeLine(page, 'exit 3');
  await page.getByText('Input is off. Its output stays readable here.', { exact: true }).waitFor({ timeout: 15_000 });
  const laneText = async () => ((await page.locator('[data-shell-part="terminalLane"]').textContent()) ?? '').replace(/\s+/g, ' ').trim();
  await waitUntil('the lane to say how the shell ended', async () => (await laneText()) === 'Exited with code 3 Input is off. Its output stays readable here.', 10_000).catch(() => undefined);
  const lane = await laneText();
  assert.equal(lane, 'Exited with code 3 Input is off. Its output stays readable here.', `${engine}: the lane under the screen says how the shell ended, in the host's words: the code it exited with, and that the input is off`);
  let ended = '';
  await waitUntil('the emulator to hold the end of the process', async () => {
    ended = await bufferOf(page, mac);
    return lastLineOf(ended) === '[Process exited with code 3]';
  }, 15_000).catch(() => undefined);
  assert.equal(lastLineOf(ended), '[Process exited with code 3]', `${engine}: the last line the emulator holds says how the process ended`);
  assert.ok(lineIn(ended, 'SURVIVES_42'), `${engine}: the output is still in the emulator once the shell has exited`);
  await waitUntil('the tab to be announced as ended', async () => (await tabNames()).join('|') === `${String(shell)}, ended`, 10_000).catch(() => undefined);
  assert.deepEqual(await tabNames(), [`${String(shell)}, ended`], `${engine}: the ended session's tab stays and is announced as ended`);
  await waitUntil('the host to have no session left', async () => (await terminalIds(base)).length === 0, 10_000);
  const asked = wire.of('IsBusy').length;
  await page.locator('[data-shell-part="sessionClose"]').first().click();
  assert.equal(await page.getByRole('alertdialog').count(), 0, `${engine}: closing an ended terminal asks nothing`);
  await page.getByText('No terminals', { exact: true }).waitFor();
  assert.equal(wire.of('IsBusy').length, asked, `${engine}: closing an ended terminal does not ask the host what runs in it`);
  note('exit 3', `the lane said ${JSON.stringify(lane)}; the last line of the emulator was ${JSON.stringify(lastLineOf(ended))}; the tab was announced as ${JSON.stringify(`${String(shell)}, ended`)}`);

  // The page's input and size were ordered calls the whole time, for every terminal it started (T2a): the legacy calls were never made and the sequence numbers count up from 1 for each terminal.
  assertOrderedCalls(wire, engine);
  note('ordered calls', [...orderedCallsOf(wire).values()].map((calls) => `${String(calls.filter((call) => call.method === 'WriteTerminal').length)} WriteTerminal and ${String(calls.filter((call) => call.method === 'ResizeTerminal').length)} ResizeTerminal (numbers 1 to ${String(calls.length)})`).join('; ') + '; no WriteSession or ResizeSession');

  assert.deepEqual(errors, [], `${engine}: the page raised no error`);
  console.log(`terminal ${engine}:\n${observed.map((line) => `  ${line}`).join('\n')}`);
}

/**
 * r2. The emulator against the programs of this machine, in the real shell the host starts (T1: the owner's bar for the terminal is "an exceptional functional terminal that does what you would expect in an IDE"). Each block is a
 * named check that says what it saw. What the PROGRAM saw is read from the host's replay of the pty (the bytes the shell was sent, so what the emulator answered, and the bytes it wrote); what only the EMULATOR knows (its screen
 * and its scrollback) is read as a person would copy it: select all, copy, into a clipboard that keeps what it is given. A program this machine does not have is named as not run, never skipped without a word. The terminal's
 * own gaps that belong to the host's backend are printed as GAP and are not asserted here (they are listed for the Go side, docs/ui-next/status/T1.md).
 */
async function checkTerminalPrograms(page, base, engine) {
  const errors = [];
  const observed = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await spoofPlatform(page);
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  // The host's own system, for the checks that read the machine and its rendering and not the page's chords (SEAM_PLATFORM makes the page say Linux on a Mac: the chords follow the page, the machine does not change).
  const hostMac = process.platform === 'darwin';
  await keepCopies(page);
  await page.locator('[data-shell-part="panelToggle"]').click();
  await page.locator('[data-shell-part="panelEmpty"]').getByRole('button', { name: 'New terminal', exact: true }).click();
  await page.locator('.xterm-helper-textarea').waitFor({ timeout: 30_000 });
  await waitUntil('the host to list the shell', async () => (await terminalIds(base)).length === 1, 30_000);
  const [id] = await terminalIds(base);
  await waitUntil('the emulator to have the keyboard', () => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false), 10_000);
  await waitUntil('the shell to say its prompt', async () => (await transcriptOf(base, id)).trim() !== '', 20_000);

  const note = (name, text) => observed.push(`${name}: ${text}`);
  const mark = async () => (await transcriptOf(base, id)).length;
  const since = async (from) => (await transcriptOf(base, id)).slice(from);
  /** Types a line, waits for a pattern in what the shell printed after it, and returns that output. */
  const ask = async (line, pattern, what, ms = 30_000) => {
    const from = await mark();
    await typeLine(page, line);
    // The pattern is tried on the text as a person reads it first (a line of output starts after a line feed in bash and in zsh) and then on the raw bytes, for what is about the control sequences themselves.
    let output = '';
    await waitUntil(what, async () => {
      const raw = await since(from);
      const read = plain(raw);
      output = pattern.test(read) ? read : raw;
      return pattern.test(read) || pattern.test(raw);
    }, ms);
    return output;
  };
  /** What the whole buffer of the emulator holds, scrollback and screen: select all, copy. */
  const everything = () => bufferOf(page, mac);
  const hasLine = lineIn;
  /** A click on the screen at a prompt: it takes the selection away and keeps the keyboard. */
  const unselect = () => page.locator('.xterm-screen').click({ position: { x: 3, y: 3 } });
  /** The pty's size, and the cell of the screen it is drawn in. */
  const cells = async () => {
    const size = sttyOf(await ask('stty size', /\r?\n\d+ \d+\r?\n/, 'stty size'));
    const box = await page.locator('.xterm-screen').boundingBox();
    return { ...size, box, cellWidth: box.width / size.cols, cellHeight: box.height / size.rows };
  };
  const has = async (program) => /\nHAS_YES\r?\n/.test(await ask(`command -v ${program} >/dev/null && echo HAS_YES || echo HAS_NO`, /\nHAS_(YES|NO)\r?\n/, `the answer for ${program}`));
  const quitAltScreen = (from) => waitUntil('the program to give the alternate screen back', async () => (await since(from)).includes('\u001b[?1049l'), 15_000);
  /** Control C, and the wait for the shell to say something (its next prompt) before another line is typed: a line typed while the interrupted program is still dying is read by it, and the shell never sees it. */
  const interrupt = async () => {
    const before = await mark();
    await page.keyboard.press('Control+c');
    await waitUntil('the shell to answer the interrupt', async () => (await mark()) > before, 15_000);
    await page.waitForTimeout(300);
  };
  const reading = (from) => waitUntil('cat to be reading', async () => /READY_2\r?\n/.test(await since(from)), 30_000).catch(async (error) => {
    throw new Error(`${error.message}; focus is on ${await page.evaluate(() => document.activeElement?.className ?? 'nothing')}; the shell showed ${JSON.stringify((await since(from)).slice(-400))}`);
  });
  const pasteText = (text) => page.evaluate((value) => {
    const area = document.querySelector('.xterm-helper-textarea');
    const data = new DataTransfer();
    data.setData('text/plain', value);
    area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);

  // The environment the shell has, and where it starts: TERM, COLORTERM, the shell, the directory.
  const first = await cells();
  const env = await ask('printf \'ENV|%s|%s|%s|%s|%s\\n\' "$TERM" "${COLORTERM-unset}" "$(pwd -P)" "$(cd ~ && pwd -P)" "${ZSH_VERSION:+zsh}${BASH_VERSION:+bash}"', /\nENV\|[^|\r\n%]*\|[^|\r\n%]*\|[^|\r\n%]*\|[^|\r\n%]*\|[^|\r\n%]*\r?\n/, 'the environment line');
  const [, term, colorterm, cwd, home, shell] = /\nENV\|([^|\r\n%]*)\|([^|\r\n%]*)\|([^|\r\n%]*)\|([^|\r\n%]*)\|([^|\r\n%]*)\r?\n/.exec(env);
  assert.equal(term, 'xterm-256color', `${engine}: the host sets TERM to xterm-256color`);
  assert.equal(cwd, home, `${engine}: with no project open a terminal starts in the home directory, not in the host's working directory`);
  note('env', `TERM=${term} COLORTERM=${colorterm} shell=${shell} cwd=${cwd} (home)`);
  if (colorterm !== 'truecolor') note('GAP env', `COLORTERM is ${colorterm}: the host does not set COLORTERM=truecolor, so a program that decides on it falls back to 256 colours (backend/pkg/terminal/manager.go:142)`);
  const login = await ask('if [ -n "$ZSH_VERSION" ]; then [[ -o login ]] && echo LOGIN=yes || echo LOGIN=no; else shopt -q login_shell && echo LOGIN=yes || echo LOGIN=no; fi', /\nLOGIN=(yes|no)\r?\n/, 'the login answer');
  assert.match(login, /\nLOGIN=yes\r?\n/, `${engine}: the shell is a login shell, so the user's profile files run`);
  note('login shell', 'yes: the profile files run (the Dock-launched PATH defect needs the packaged app and is not covered here)');
  if (hostMac) {
    const paths = await ask('if [ -r /etc/paths ]; then { cat /etc/paths; find /etc/paths.d -type f -exec cat {} + 2>/dev/null; } | while read -r p; do case ":$PATH:" in *":$p:"*) ;; *) echo "PATH_MISSING=$p";; esac; done; echo PATH_CHECKED; else echo PATH_UNREADABLE; fi', /\nPATH_(CHECKED|UNREADABLE)\r?\n/, 'the PATH check');
    assert.match(paths, /\nPATH_CHECKED\r?\n/, `${engine}: /etc/paths could be read, so the check is about something`);
    assert.doesNotMatch(paths, /\nPATH_MISSING=\//, `${engine}: every directory of /etc/paths and /etc/paths.d is on the shell's PATH, as in a login shell of Terminal.app`);
    note('PATH', 'every directory of /etc/paths and /etc/paths.d is on the PATH of the terminal');
  }

  // The size follows the panel while a program holds the alternate screen: the program is told (SIGWINCH) and sees the rows and columns the page drew.
  const winch = 'sh -c \'printf "\\033[?1049h"; trap "echo WINCH_SIZE=\\$(stty size)" WINCH; trap "printf \\"\\033[?1049l\\"; exit 0" INT; echo START_SIZE=$(stty size); while :; do sleep 0.2; done\'';
  const winchFrom = await mark();
  await typeLine(page, winch);
  await waitUntil('the program to say its first size', async () => /START_SIZE=\d+ \d+\r?\n/.test(await since(winchFrom)), 15_000);
  const started = /START_SIZE=(\d+) (\d+)/.exec(await since(winchFrom));
  assert.equal(Number(started[1]), first.rows, `${engine}: the program started with the rows the page drew`);
  await page.locator('[data-shell-part="panelHandle"]').focus();
  await page.keyboard.press('End');
  await waitUntil('the screen to grow', async () => ((await screenSizeOf(page))?.height ?? 0) > first.box.height + 40, 20_000);
  await waitUntil('the program to be told of the new size', async () => /WINCH_SIZE=\d+ \d+\r?\n/.test(await since(winchFrom)), 20_000);
  await page.waitForTimeout(700);
  const drawn = await screenSizeOf(page);
  const told = [...(await since(winchFrom)).matchAll(/WINCH_SIZE=(\d+) (\d+)/g)].at(-1);
  assert.equal(Number(told[1]), drawn.rows, `${engine}: in the alternate screen the program was told the rows the page drew (${String(drawn.rows)}), it saw ${told[1]}`);
  assert.ok(Number(told[1]) > Number(started[1]) && Number(told[2]) === Number(started[2]), `${engine}: the program saw more rows and the same columns after the panel grew (${started[1]}x${started[2]} to ${told[1]}x${told[2]})`);
  await page.locator('.xterm-screen').click();
  await page.keyboard.press('Control+c');
  await quitAltScreen(winchFrom);
  note('resize in the alternate screen', `the program saw ${started[1]}x${started[2]} then ${told[1]}x${told[2]} (rows x columns), the page drew ${String(drawn.rows)} rows`);

  // Control C interrupts a running program, and the shell takes the next command at once.
  await typeLine(page, 'sleep 60');
  await page.waitForTimeout(700);
  await interrupt();
  await ask('echo AFTER_INT_$((4+5))', /\nAFTER_INT_9\r?\n/, 'the shell to answer long before sleep 60 would have ended', 20_000);
  note('Control C', 'interrupted sleep 60 and the shell answered the next command');

  // Keys a person expects to reach the shell: read as the bytes `cat -v` shows, a dot after each key.
  const keys = mac
    ? [['Control+a', '^A'], ['Control+e', '^E'], ['Control+l', '^L'], ['ArrowLeft', '^[[D'], ['ArrowRight', '^[[C'], ['ArrowUp', '^[[A'], ['ArrowDown', '^[[B'], ['Home', '^[[H'], ['End', '^[[F'], ['Delete', '^[[3~'], ['Alt+ArrowLeft', '^[b'], ['Alt+ArrowRight', '^[f'], ['Meta+ArrowLeft', '^A'], ['Meta+ArrowRight', '^E'], ['Alt+Backspace', '^W'], ['Meta+Backspace', '^U'], ['Control+ArrowLeft', '^[[1;5D']]
    : [['Control+a', '^A'], ['Control+e', '^E'], ['Control+l', '^L'], ['ArrowLeft', '^[[D'], ['ArrowRight', '^[[C'], ['ArrowUp', '^[[A'], ['ArrowDown', '^[[B'], ['Home', '^[[H'], ['End', '^[[F'], ['Delete', '^[[3~'], ['Control+ArrowLeft', '^[[1;5D'], ['Control+ArrowRight', '^[[1;5C'], ['Alt+ArrowLeft', '^[[1;3D']];
  const keysFrom = await mark();
  await typeLine(page, 'stty -icanon -echo; echo READY_$((1+1)); cat -v');
  await reading(keysFrom);
  for (const [key] of keys) {
    await page.keyboard.press(key);
    await page.keyboard.type('.');
  }

  const wanted = keys.map(([, shown]) => `${shown}.`).join('');
  await waitUntil('every key to arrive', async () => (await since(keysFrom)).includes(wanted), 30_000).catch(async (error) => {
    throw new Error(`${error.message}; wanted ${JSON.stringify(wanted)}, got ${JSON.stringify((await since(keysFrom)).split('READY_2').at(-1))}`);
  });
  await interrupt();
  await ask('stty sane; echo KEYS_DONE_$((1+1))', /KEYS_DONE_2\r?\n/, 'the terminal modes to be restored');
  note('keys', `${keys.map(([key, shown]) => `${key} -> ${shown}`).join(', ')} (${mac ? 'macOS: Option as Meta is off, so Option types characters; the IDE sequences are VS Code\'s' : 'Windows and Linux'})`);

  // Bracketed paste: a program that asks for it gets the text wrapped, in one piece; the shell does not run a pasted line before Enter.
  const pasteFrom = await mark();
  await typeLine(page, 'printf \'\\033[?2004h\'; stty -icanon -echo; echo READY_$((1+1)); cat -v');
  await reading(pasteFrom);
  // The emulator draws and parses a frame after the host has the bytes, so on a slow runner it may not have taken the program's request for bracketed paste yet: the paste is repeated until it arrives wrapped.
  let pastedAt = 0;
  await waitUntil('the wrapped paste', async () => {
    if (Date.now() - pastedAt > 3_000) {
      pastedAt = Date.now();
      await pasteText('one\ntwo');
    }

    return /\^\[\[200~one\r?\ntwo\^\[\[201~/.test(await since(pasteFrom));
  }, 30_000);
  await interrupt();
  await ask('stty sane; echo PASTE_DONE_$((1+1))', /PASTE_DONE_2\r?\n/, 'the terminal modes to be restored');
  const shellPaste = await mark();
  await pasteText('echo PASTE_ONE\necho PASTE_TWO');
  await page.waitForTimeout(900);
  assert.doesNotMatch(plain(await since(shellPaste)), /\nPASTE_(ONE|TWO)\r?\n/, `${engine}: a multi-line paste at the prompt is not run line by line`);
  // Nothing ran before Enter; with it both pasted lines run, in order: a paste the terminal dropped or cut fails here, where "nothing ran" alone would pass.
  await page.keyboard.press('Enter');
  await waitUntil('both pasted lines to run, in order', async () => /\nPASTE_ONE\n(?:[\s\S]*\n)?PASTE_TWO\n/.test(plain(await since(shellPaste))), 30_000).catch(async (error) => {
    throw new Error(`${String(error.message)}; the shell's output since the paste ends with ${JSON.stringify(plain(await since(shellPaste)).slice(-600))}`);
  });
  note('bracketed paste', 'a program that asked for it got ESC[200~ one LF two ESC[201~ in one piece; the shell prompt took the two pasted lines without running them, and both ran in order at Enter');

  // Mouse reporting: on while a program asks for it (a click is reported at its cell), off otherwise, so that a selection works.
  const mouse = await cells();
  const mouseFrom = await mark();
  await typeLine(page, 'printf \'\\033[?1000h\\033[?1006h\'; stty -icanon -echo; echo READY_$((1+1)); cat -v');
  await reading(mouseFrom);
  // The same for the mouse mode: a click before the emulator has it is a selection, so the click is repeated until it is reported.
  let clickedAt = 0;
  await waitUntil('the click to be reported', async () => {
    if (Date.now() - clickedAt > 3_000) {
      clickedAt = Date.now();
      await page.mouse.click(mouse.box.x + mouse.cellWidth * 9.5, mouse.box.y + mouse.cellHeight * 2.5);
    }

    return /\^\[\[<0;\d+;\d+M\^\[\[<0;\d+;\d+m/.test(await since(mouseFrom));
  }, 30_000);
  const reported = /\^\[\[<0;(\d+);(\d+)M/.exec(await since(mouseFrom));
  assert.ok(Math.abs(Number(reported[1]) - 10) <= 1 && Math.abs(Number(reported[2]) - 3) <= 1, `${engine}: a click on column 10, row 3 was reported at ${reported[1]},${reported[2]}`);
  await interrupt();
  await ask('printf \'\\033[?1000l\\033[?1006l\'; stty sane; echo MOUSE_DONE_$((1+1))', /MOUSE_DONE_2\r?\n/, 'the mouse mode to be restored');
  note('mouse reporting', `on while asked: a click on column 10, row 3 was reported at ${reported[1]},${reported[2]} (SGR); off once the program stops asking (selection is checked below)`);

  // 24-bit colour is DRAWN as itself where the engine's screenshot carries the GPU canvas (a Mac's WebKit and Chromium). The runner's Linux WebKit read 0 px of the colour in the first CI run of this check (software GL): off a Mac the
  // pixels are recorded and not asserted. (An attempt to ask the emulator for its attributes with DECRQSS answered `0m` only and was dropped.) And the bell is shown and not heard.
  await ask('printf \'\\033[48;2;255;100;0m                \\033[0m\\n\'', /\u001b\[48;2;255;100;0m/, 'the 24-bit colour');
  await page.waitForTimeout(400);
  const orange = await page.evaluate(async ({ data }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const { data: pixels } = context.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let at = 0; at < pixels.length; at += 4) if (Math.abs(pixels[at] - 255) <= 4 && Math.abs(pixels[at + 1] - 100) <= 4 && Math.abs(pixels[at + 2]) <= 4) count += 1;
    return count;
  }, { data: (await page.locator('.xterm-screen').screenshot()).toString('base64') });
  if (hostMac) assert.ok(orange >= 16 * 6 * 16, `${engine}: 24-bit colour 255,100,0 is drawn as itself: ${String(orange)} px of it on the screen (a 16 cell run is about ${String(16 * 7 * 18)})`);
  note('24-bit colour', hostMac ? `rgb(255,100,0) drawn exactly: ${String(orange)} px` : `${String(orange)} px of rgb(255,100,0) in this engine's screenshot, recorded and not asserted off a Mac (the runner's Linux WebKit read 0 in its first run)`);
  await typeLine(page, 'printf \'\\a\'');
  await page.locator('[data-shell-part="terminalScreen"][data-bell]').waitFor({ timeout: 5_000 });
  note('bell', 'BEL marks the screen (a short fade, no sound: the emulator plays none)');

  // Wide, emoji and combining characters: the column the emulator reports (CSI 6n, which the shell asks for and reads) is the column the shell counts.
  // UTF-8 as bytes, so that it does not depend on the shell's locale (a bash in the C locale prints `\u4f60` as it is): 4 CJK characters, an emoji, and a family of three emoji joined by ZWJ.
  const wide = '\\xe4\\xbd\\xa0\\xe5\\xa5\\xbd\\xe4\\xb8\\x96\\xe7\\x95\\x8c\\xf0\\x9f\\x98\\x80\\xf0\\x9f\\x91\\xa8\\xe2\\x80\\x8d\\xf0\\x9f\\x91\\xa9\\xe2\\x80\\x8d\\xf0\\x9f\\x91\\xa7';
  const widthOut = await ask(`stty -icanon -echo; printf '\\r${wide}\\033[6n'; read -r -d R pos; stty sane; echo; echo "CPR_COL=\${pos#*;}"; s=$(printf '${wide}'); [ -n "$ZSH_VERSION" ] && eval 'echo SHELL_WIDTH=\${(m)#s}'; echo WIDE_DONE_$((1+1))`, /\nWIDE_DONE_2\r?\n/, 'the column of the cursor after wide characters');
  const column = Number(/\nCPR_COL=(\d+)\r?\n/.exec(widthOut)?.[1]);
  const believed = /\nSHELL_WIDTH=(\d+)\r?\n/.exec(widthOut)?.[1];
  // 4 CJK (8 cells), one emoji (2) and a family of three emoji joined by ZWJ (2 + 0 + 2 + 0 + 2): 16 cells, so the cursor is in column 17.
  assert.equal(column, believed === undefined ? 17 : Number(believed) + 1, `${engine}: after 4 CJK, an emoji and a ZWJ family the cursor is in column ${String(column)}; the shell counts ${believed === undefined ? '16 (the wcwidth tables; this shell has no width function)' : believed} cells`);
  const combining = await ask('stty -icanon -echo; printf \'\\re\\xcc\\x81x\\033[6n\'; read -r -d R pos; stty sane; echo; echo "CPR_COMB=${pos#*;}"', /\nCPR_COMB=\d+\r?\n/, 'the column after a combining mark');
  assert.match(combining, /\nCPR_COMB=3\r?\n/, `${engine}: a combining accent takes no cell of its own`);
  note('wide characters', `after 4 CJK + 1 emoji + a ZWJ family the cursor is in column ${String(column)}, the shell counts ${believed ?? '16 by wcwidth'} cells; a combining accent adds none (column 3 after e + accent + x)`);

  // Full-screen programs: the alternate screen, the prior output and the scrollback come back, the program sees keys and mouse.
  const unseen = [];
  await ask('printf \'MARK_%s\\n\' $(seq 1 80); echo ALT_BEFORE', /\nALT_BEFORE\r?\n/, 'the lines before the programs');
  const after = async (name, text) => {
    await ask(`echo BACK_${name}_$((3+4))`, new RegExp(`\\nBACK_${name}_7\\r?\\n`), `the prompt back after ${name}`);
    // The emulator draws a frame after the host has the bytes: the buffer is read until it has caught up.
    const wanted = ['ALT_BEFORE', 'MARK_80', 'MARK_1', `BACK_${name}_7`];
    let buffer = '';
    let missing = wanted;
    await waitUntil(`the buffer after ${name}`, async () => {
      buffer = await everything();
      missing = wanted.filter((line) => !hasLine(buffer, line));
      return missing.length === 0;
    }, 15_000).catch((error) => {
      throw new Error(`${engine}: after ${name} the prior output, the prompt and the scrollback (MARK_1 of 80 lines) are not all back (${error.message}): missing ${JSON.stringify(missing)}; the buffer began ${JSON.stringify(buffer.slice(0, 200))} and ended ${JSON.stringify(buffer.slice(-400))}`);
    });
    await unselect();
    assert.ok(!text.test(buffer), `${engine}: nothing of ${name}'s screen is left in the buffer`);
  };

  if (await has('less')) {
    const lessFrom = await mark();
    await typeLine(page, 'seq 1 500 | less');
    await waitUntil('less to take the alternate screen', async () => (await since(lessFrom)).includes('\u001b[?1049h'), 15_000);
    await page.waitForTimeout(600);
    const top = await everything();
    assert.ok(hasLine(top, '1') && !hasLine(top, 'MARK_80'), `${engine}: less shows its own screen, not the shell's`);
    await page.keyboard.press('Space');
    let next = top;
    await waitUntil('less to draw the next page', async () => {
      next = await everything();
      return !hasLine(next, '1') && next !== top;
    }, 20_000);
    assert.ok(!hasLine(next, '1') && next !== top, `${engine}: Space moved less by a page`);
    await page.keyboard.press('q');
    await quitAltScreen(lessFrom);
    await after('less', /(^|\n)\d+(\n|$)/);
    note('less', 'alternate screen taken, Space paged, q quit; the prior output, the prompt and the scrollback came back');
  } else {
    unseen.push('less');
  }

  if (await has('vim')) {
    const vimFrom = await mark();
    const view = await cells();
    await typeLine(page, 'printf \'L%02d\\n\' $(seq 1 30) > "$HOME/seam-vim.txt"; vim -u NONE -N -n -c \'set mouse=a ruler\' "$HOME/seam-vim.txt"');
    await waitUntil('vim to take the alternate screen and ask for the mouse', async () => /\u001b\[\?1049h/.test(await since(vimFrom)) && /\u001b\[\?(1000|1002|1003)h/.test(await since(vimFrom)), 30_000);
    await page.waitForTimeout(700);
    const screen = await everything();
    assert.ok(hasLine(screen, 'L01'), `${engine}: vim drew the file`);
    let clickedVim = 0;
    let clicked = '';
    await waitUntil('vim to put its cursor on the clicked line', async () => {
      if (Date.now() - clickedVim > 3_000) {
        clickedVim = Date.now();
        await page.mouse.click(view.box.x + view.cellWidth * 2.5, view.box.y + view.cellHeight * 5.5);
      }

      await page.waitForTimeout(500);
      clicked = await everything();
      return /\b6,\d+\s/.test(clicked);
    }, 30_000).catch((error) => {
      throw new Error(`${engine}: a click on row 6 did not move the cursor of vim to line 6 (mouse reporting is on while vim asks): ${error.message}`);
    });
    await page.keyboard.type(':q');
    await page.keyboard.press('Enter');
    await quitAltScreen(vimFrom);
    assert.match(await since(vimFrom), /\u001b\[\?(1000|1002|1003)l/, `${engine}: vim turned the mouse mode off when it left`);
    await after('vim', /(^|\n)L\d\d(\n|$)/);
    note('vim', 'alternate screen taken, mouse mode on (a click moved its cursor to the clicked line), :q left, mouse mode off, the prior output and the scrollback came back');
  } else {
    unseen.push('vim');
  }

  if (await has('top')) {
    const topFrom = await mark();
    await typeLine(page, 'top');
    // macOS' top takes the alternate screen and procps' (the CI image's, read there: it sends no `ESC [ ? 1049 h`) draws on the main one: both are redraw programs, and what comes back differs.
    await waitUntil('top to draw its screen', async () => /Processes:|Tasks:/.test(plain(await since(topFrom))), 20_000);
    const alternate = (await since(topFrom)).includes('\u001b[?1049h');
    // procps' top redraws every 3 s and macOS' every second: the redraw is waited for after the first draw.
    await page.waitForTimeout(1_000);
    const drawnAt = (await since(topFrom)).length;
    await waitUntil('top to redraw its screen', async () => (await since(topFrom)).length > drawnAt, 15_000);
    const redrawn = (await since(topFrom)).length - drawnAt;
    const running = await everything();
    assert.match(running, /Processes:|Tasks:|PID/, `${engine}: top drew its screen`);
    await page.keyboard.press('q');
    if (alternate) {
      await quitAltScreen(topFrom);
      await after('top', /Processes:|Tasks:/);
    } else {
      // A program that draws on the main screen leaves what it drew there, as in any terminal: only the prompt coming back is asked.
      await ask('echo BACK_top_$((3+4))', /\nBACK_top_7\r?\n/, 'the prompt back after top');
      await unselect();
    }

    note('top (a full-screen redraw program)', `${alternate ? 'took the alternate screen' : 'drew on the main screen (procps)'}, drew its screen and kept redrawing it (${String(redrawn)} bytes after the first draw), q quit${alternate ? ', the prior output and the scrollback came back' : ' and the prompt came back'}`);
  } else {
    unseen.push('top');
  }

  note('htop', (await has('htop')) ? 'present but not driven: top is the redraw program here' : 'not installed on this machine, not run');
  if (unseen.length > 0) note('programs not run', unseen.join(', '));

  // Clear and select: the toolbar button always, Command K on a Mac while the terminal has the focus (it is also the palette's chord: it must not open it); a double click selects a word and copies it.
  await ask('echo CLEAR_ME_$((1+2))', /\nCLEAR_ME_3\r?\n/, 'the line to clear');
  // The host has the line before the emulator has drawn it (a frame later): it is read back before the clear, or the clear could run first and the line be drawn after it.
  await waitUntil('the emulator to hold the marker and the line before they are cleared', async () => {
    const before = await everything();
    return hasLine(before, 'CLEAR_ME_3') && hasLine(before, 'MARK_1');
  }, 15_000);
  await unselect();
  if (mac) {
    await page.keyboard.press('Meta+k');
  } else {
    await page.locator('[data-terminal-tool="clear"]').click();
    await page.locator('.xterm-screen').click();
  }

  await page.waitForTimeout(300);
  assert.equal(await page.locator('dialog[data-palette-part="scrim"][open]').count(), 0, `${engine}: ${mac ? 'Command K in the terminal did not open the palette' : 'Clear did not open the palette'}`);
  await waitUntil('the screen and the scrollback to be cleared', async () => {
    const buffer = await everything();
    return !hasLine(buffer, 'CLEAR_ME_3') && !hasLine(buffer, 'MARK_1');
  }, 15_000);
  await unselect();
  await ask('echo ZZ_ONE ZZ_TWO', /\nZZ_ONE ZZ_TWO\r?\n/, 'the word line');
  await waitUntil('the emulator to have drawn the word line', async () => hasLine(await everything(), 'ZZ_ONE ZZ_TWO'), 15_000);
  await unselect();
  const place = await cells();
  await page.mouse.dblclick(place.box.x + place.cellWidth * 2.5, place.box.y + place.cellHeight * 1.5);
  await page.evaluate(() => { window.__copied.length = 0; });
  await page.keyboard.press(mac ? 'Meta+c' : 'Control+Shift+C');
  await waitUntil('the copy of the word', () => page.evaluate(() => window.__copied.length > 0), 15_000);
  assert.equal(await page.evaluate(() => window.__copied.at(-1)), 'ZZ_ONE', `${engine}: a double click selected the word and the copy chord copied it`);
  note('selection and copy', 'a double click selected a word (mouse reporting is off at the prompt) and the copy chord put it on the clipboard');
  if (mac) {
    // The palette is still the chord of everything that is not a terminal.
    await page.locator('[data-shell-part="panelHandle"]').focus();
    await page.keyboard.press('Meta+k');
    await page.locator('dialog[data-palette-part="scrim"][open]').waitFor({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await page.locator('dialog[data-palette-part="scrim"][open]').waitFor({ state: 'detached', timeout: 5_000 });
    await page.locator('.xterm-screen').click();
    note('Command K', 'clears the focused terminal (VS Code and JetBrains agree) and does not open the palette; with the focus anywhere else it opens the palette');
  }

  // Control D at an empty prompt ends the shell: the session says so and the host has none.
  await unselect();
  await page.keyboard.press('Control+d');
  await page.getByText('Input is off. Its output stays readable here.', { exact: true }).waitFor({ timeout: 15_000 });
  await waitUntil('the host to list no shell', async () => (await terminalIds(base)).length === 0, 20_000);
  note('Control D', 'ended the shell: the session says so and the host lists none');

  assert.deepEqual(errors, [], `${engine}: the page raised no error`);
  console.log(`terminal-programs ${engine}:\n${observed.map((line) => `  ${line}`).join('\n')}`);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// r3 and r4: a terminal outlives its page (T2b, docs/ui-next/status/T2-go.md). What a reloaded page finds, takes over and shows is read from the real host: the calls the page makes, the events it receives, what the emulator holds, what the shell says.

/** A pause, in milliseconds. */
const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The tabs of the terminals in the panel's strip of sessions. */
const sessionTabsOf = (page) => page.locator('[data-shell-part="sessionTabs"] [role="tab"]');

/** The name of each tab as a screen reader says it: a session that is not steady says its state (`zsh, starting`, `zsh, ended`). */
const tabLabelsOf = async (page) => sessionTabsOf(page).evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label') ?? ''));

/** The clipboard stub of `keepCopies`, made at every load of the page: a reload makes a new document, and the stub of the old one goes with it. */
async function keepCopiesOnEveryLoad(page) {
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied.push(text); } } });
  });
}

/** The number of bytes a base64 text decodes to, without decoding it. */
const base64Length = (text) => Math.floor((text.length * 3) / 4) - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0);

/**
 * The events of the exec lane that the page's events socket carries, as the page receives them, each with the time it arrived: `core/exec/stream/output/<id>` (`{offset, data}`: the bytes of a terminal that has a page key, and the offset of the first of
 * them in the terminal's output), `core/exec/signal/CLOSE/<id>` and `core/exec/signal/DETACHED/<id>` (`{by, attachment}`: a page lost a terminal). A reload makes a new socket; the frames of every socket the page has had are kept.
 */
function watchTerminalEvents(page) {
  const frames = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      let message;
      try {
        message = JSON.parse(String(payload));
      } catch {
        return;
      }

      if (typeof message?.name === 'string' && message.name.startsWith('core/exec/')) frames.push({ at: Date.now(), name: message.name, data: message.data });
    });
  });
  const of = (kind, id) => frames.filter((frame) => frame.name === `core/exec/${kind}/${id}`);
  return {
    frames,
    /** The output events of a terminal: when each came, where it starts in the terminal's output and how many bytes it carries. */
    outputs: (id) => of('stream/output', id).map((frame) => ({ at: frame.at, offset: frame.data?.offset, length: base64Length(String(frame.data?.data ?? '')) })),
    detached: (id) => of('signal/DETACHED', id),
    closes: (id) => of('signal/CLOSE', id),
  };
}

/**
 * What a page says or asks for where a secret must never be: its console (a line of any kind), its errors, the address of the page and every address it asked for or opened a socket to. The page key is a capability: the body of a call carries it (the
 * host's calls are POSTs with their arguments in the body), and nothing else may.
 */
function watchLeaks(page) {
  const lines = [];
  const urls = [];
  page.on('console', (message) => lines.push(message.text()));
  page.on('pageerror', (error) => lines.push(error.message));
  page.on('request', (request) => urls.push(request.url()));
  page.on('websocket', (socket) => urls.push(socket.url()));
  return { lines, urls };
}

/** Fails, without printing the key, when the secret is in the address of the page, in an address it asked for, or in a line of its console. */
function assertSecretIsNowhere(secret, page, leaks, engine, when) {
  assert.ok(typeof secret === 'string' && secret.length >= 16, `${engine}: ${when}: there is a page key to look for (16 characters or more)`);
  assert.equal(page.url().includes(secret), false, `${engine}: ${when}: the page key is not in the address of the page`);
  assert.equal(leaks.urls.filter((url) => url.includes(secret)).length, 0, `${engine}: ${when}: no address the page asked for or opened a socket to carries the page key`);
  assert.equal(leaks.lines.filter((line) => line.includes(secret)).length, 0, `${engine}: ${when}: no line of the console and no error of the page carries the page key`);
}

let seamCalls = 0;
/**
 * A call of the exec lane made by the page's own code, with the client id its runtime holds, as the page's bindings make it: what the host takes for a call of that window (`ListTerminals` and `AttachTerminal` need one). Its call id starts with
 * `seam-`, which `watchExecCalls` leaves out of the wire. The answer: the status, the text and the JSON.
 */
async function callAsPage(page, method, ...args) {
  seamCalls += 1;
  const out = await page.evaluate(
    async ({ id, list, tag }) => {
      const response = await fetch('/wails/runtime', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-wails-client-id': window._wails.clientId },
        body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': tag, methodID: id, args: list } }),
      });
      return { status: response.status, text: await response.text() };
    },
    { id: methodIdOf(EXEC_SERVICE, method), list: args, tag: `seam-${method}-${String(seamCalls)}` },
  );
  let json;
  try {
    json = JSON.parse(out.text);
  } catch {
    json = undefined;
  }

  return { status: out.status, text: out.text, json };
}

/**
 * The page key a page gave the host when it started its first terminal (T2-go 2.1: 16 to 128 visible characters, the page makes it and keeps it where its build keeps it), read from the wire, so that no check depends on where that is. Undefined while the page
 * started no terminal with a key.
 */
const keyOnTheWire = (wire) => wire.of('CreateTerminal').find((call) => typeof call.args[1]?.page_key === 'string')?.args[1].page_key;

/**
 * What a browser does when it duplicates a tab: the new tab starts with a copy of the old tab's `sessionStorage` (a key kept there is then the same key; a key kept anywhere else is shared by the pages of one browser context or of one window of the host
 * anyway). Written before the new page's own scripts run, and never over a value the new page made.
 */
async function duplicateStorage(from, to) {
  const entries = await from.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
  await to.addInitScript((copy) => {
    for (const [name, value] of Object.entries(copy)) if (sessionStorage.getItem(name) === null) sessionStorage.setItem(name, value);
  }, entries);
}

/** Waits until the host holds the saved window with these tabs in it: the session is saved a quiet moment after it changes, and a page that is reloaded or replaced before that finds the window as it was. */
async function savedTabs(base, ...ids) {
  await waitUntil(`the host to hold the saved window with ${String(ids.length)} terminal tab${ids.length === 1 ? '' : 's'}`, async () => {
    const session = String((await callHost(base, 'GetState', 'main')).session ?? '');
    return ids.every((id) => session.includes(id));
  }, 30_000);
}

/**
 * Ends every terminal the host holds for the keys the pages of this run used and every session it lists, as a person closes each tab: a terminal with a page key outlives its page (its lease), and a later page would find it. Never throws: what was
 * running has said what failed.
 */
async function endTerminals(base, page) {
  try {
    if (page !== undefined && !page.isClosed()) {
      for (const key of PAGE_KEYS) {
        const listed = await callAsPage(page, 'ListTerminals', key);
        for (const one of Array.isArray(listed.json) ? listed.json : []) await tryBound(base, EXEC_SERVICE, 'CloseSession', one.id);
      }
    }

    for (const id of await terminalIds(base)) await tryBound(base, EXEC_SERVICE, 'CloseSession', id);
    await waitUntil('the host to list no terminal', async () => (await terminalIds(base)).length === 0, 20_000);
  } catch {
    // best effort
  }
}

/** Runs a terminal scenario on a fresh page and ends every terminal the host still holds afterwards, so that the next scenario starts from a host with none. */
async function onTerminalPage(browser, base, run) {
  const page = await freshPage(browser, base);
  try {
    await run(page);
  } finally {
    await endTerminals(base, page);
  }
}

/**
 * What a person sees of the terminals in the panel: the name of each tab as a screen reader says it, what the lanes of the terminals on screen say, and whether the words of a terminal that is gone are anywhere on the page.
 */
async function seePanel(page) {
  return page.evaluate(() => ({
    tabs: [...document.querySelectorAll('[data-shell-part="sessionTabs"] [role="tab"]')].map((tab) => tab.getAttribute('aria-label') ?? ''),
    lane: [...document.querySelectorAll('[data-shell-part="terminalLane"]')].filter((lane) => lane.getClientRects().length > 0).map((lane) => (lane.textContent ?? '').replace(/\s+/g, ' ').trim()),
    gone: document.body.innerText.includes('The earlier output is gone'),
  }));
}

/** The panel as terminals that are back and running leave it: these tabs, none of them starting or ended, no lane with words, and nothing said of a terminal that is gone. */
const runningAs = (names) => (state) => state.tabs.length === names.length && state.tabs.every((tab, index) => tab === names[index]) && state.lane.every((words) => words === '') && !state.gone;

/**
 * Looks at the panel every 50 ms until `done(state)` holds or `ms` have passed, and keeps each state that was different from the one before, with the time it was first seen, counted from `from`: what a person saw, in order, and when.
 */
async function watchPanelUntil(page, done, ms, from = Date.now()) {
  const seen = [];
  const deadline = Date.now() + ms;
  for (;;) {
    // A document that is being replaced cannot be looked at for a moment.
    const state = await seePanel(page).catch(() => undefined);
    if (state !== undefined) {
      const text = JSON.stringify(state);
      if (seen.at(-1)?.text !== text) seen.push({ text, state, at: Date.now() - from });
      if (done(state)) return { ok: true, seen, took: Date.now() - from };
    }

    if (Date.now() > deadline) return { ok: false, seen, took: Date.now() - from };
    await waitMs(50);
  }
}

/** What `watchPanelUntil` saw, as one line: each state with the time it came. */
const timelineOf = (seen) => seen.map(({ state, at }) => `${String(at)} ms ${JSON.stringify(state.tabs)} ${JSON.stringify(state.lane)}${state.gone ? ' with the words of a terminal that is gone' : ''}`).join(' | ');

/**
 * What a person does when a window comes back with its terminals and the panel is closed (a restored session does not cover the page): opens the panel. The window is waited for (the empty window's list of plugins is on screen), then a short moment in case
 * the panel opens by itself, and then the toggle is pressed. Returns which of the two it was.
 */
async function openPanelAgain(page) {
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  const toggle = page.locator('[data-shell-part="panelToggle"]');
  for (let turn = 0; turn < 4; turn += 1) {
    if ((await toggle.getAttribute('aria-pressed')) === 'true') return 'by itself';
    await waitMs(150);
  }

  await toggle.click();
  return 'by a press';
}

/** Reloads the page, opens the panel and watches it until `done` holds: when the reload began (a wall clock time), how the panel opened and when (milliseconds after the reload began), whether the panel got there, what was seen and how long it took in milliseconds. */
async function reloadUntil(page, done, ms = 60_000) {
  const startedAt = Date.now();
  await page.reload({ waitUntil: 'load' });
  const opened = await openPanelAgain(page);
  const openedAfter = Date.now() - startedAt;
  return { startedAt, opened, openedAfter, ...(await watchPanelUntil(page, done, ms, startedAt)) };
}

/** The calls of one kind the page made from `since` (a wall clock time) on, for the terminal `id` when one is named (its first argument). */
const sinceOf = (wire, method, id, since) => wire.of(method).filter((call) => call.askedMs >= since && (id === undefined || call.args[0] === id));

/** The bytes of the output events that lie at or beyond `end`: what a page that took a terminal over at `end` has to apply, and so to acknowledge. Whole events (an event never straddles the end of a replay), and a straddling one would count only what lies beyond. */
const bytesBeyond = (outputs, end) => outputs.reduce((sum, event) => sum + Math.max(0, event.offset + event.length - Math.max(event.offset, end)), 0);

/** What the page acknowledged of a terminal from `since` on: the bytes of its AckTerminal calls. */
const ackedOf = (wire, id, since) => sinceOf(wire, 'AckTerminal', id, since).reduce((sum, call) => sum + (Number(call.args[1]) || 0), 0);

/**
 * Reads the emulator's whole buffer again and again until it holds `line`, and keeps what each reading shows of a numbered stream that counts up to `last`: its numbers (the first is left out: a replay may begin in the middle of a line; numbers above `last`
 * are an earlier stream's, which the scrollback may still hold), where they begin and end, and where they stop counting up by one. A reading takes a moment, so what the readings catch is a stream that is not too fast for them.
 */
async function readingsUntil(page, mac, line, what, ms, last) {
  const readings = [];
  const deadline = Date.now() + ms;
  for (;;) {
    const buffer = await bufferOf(page, mac);
    const numbers = numbersOf(buffer).filter((number) => number <= last).slice(1);
    const reading = { at: Date.now(), first: numbers[0], last: numbers.at(-1), count: numbers.length, broken: firstBreak(numbers), done: lineIn(buffer, line) };
    readings.push(reading);
    if (reading.done) return readings;
    if (Date.now() > deadline) throw new Error(`timed out after ${String(ms)} ms waiting for ${what}; the last of ${String(readings.length)} readings held ${String(reading.count)} numbered lines from ${String(reading.first)} to ${String(reading.last)}`);
    await waitMs(100);
  }
}

/** Waits until what the shell has written to the terminal (the host's replay, without the control sequences) holds `pattern`, and returns the match. */
async function shellSays(base, id, pattern, what) {
  let found = null;
  await waitUntil(what, async () => {
    found = pattern.exec(await plainTranscriptOf(base, id));
    return found !== null;
  }, 30_000);
  return found;
}

/** Polls (every 200 ms) until `fn` holds or `ms` have passed, and says which: a bound that is an assertion of its own, with its own words, where `waitUntil` throws a timeout. */
async function holdsWithin(fn, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await waitMs(200);
  }
}

/**
 * What the page numbered after it took a terminal over (T2-go 2.4: the host answers `next_input_seq` in the attach answer, the number its queue expects next, and the page goes on counting from it; a number the host has already applied or given up is
 * refused SEQUENCE_STALE, with nothing applied). The page sent input; the host answered every WriteTerminal and ResizeTerminal with success (the refusal is told first: a page that goes on from the wrong number types into a terminal that applies nothing);
 * no call is unnumbered (number 0 is the fallback of a page that did not know where the count stood); the first carries exactly the number the attach answered, and the writes and resizes after it count up by one.
 */
async function assertNumbersAfterAttach(wire, id, attach, engine, when) {
  const numbered = () => [...sinceOf(wire, 'WriteTerminal', id, attach.askedMs), ...sinceOf(wire, 'ResizeTerminal', id, attach.askedMs)].sort((a, b) => a.askedAt - b.askedAt);
  await holdsWithin(async () => numbered().length > 0 && numbered().every((call) => call.answered), 20_000);
  const calls = numbered();
  const next = attach.answer?.next_input_seq;
  const numbers = calls.map((call) => call.args[1]);
  assert.ok(calls.length > 0, `${engine}: ${when}: the page sent input to the terminal it took back (no WriteTerminal after the attach)`);
  const refused = calls.filter((call) => call.status !== 200).map((call) => `${call.method} number ${String(call.args[1])} -> ${String(call.status)} ${String(call.answer?.cause?.code ?? '')}`);
  assert.deepEqual(refused.slice(0, 3), [], `${engine}: ${when}: the host answered every WriteTerminal and ResizeTerminal of the page with success (it refuses a number it has applied or given up with SEQUENCE_STALE and applies nothing: the page must go on from the next_input_seq of the attach answer, ${String(next)}, not from 1); ${String(refused.length)} of ${String(calls.length)} were refused`);
  assert.deepEqual(calls.filter((call) => call.args[1] === 0).map((call) => call.method), [], `${engine}: ${when}: no call of the page is unnumbered (number 0 is the fallback of a page that was not told where the count stands)`);
  assert.equal(numbers[0], next, `${engine}: ${when}: the first numbered call after the attach carries exactly the next_input_seq the attach answered (${String(next)}); it carried ${String(numbers[0])}`);
  assert.equal(firstBreak(numbers), undefined, `${engine}: ${when}: the numbers of the writes and resizes after the attach count up by one from the number the attach answered (${String(next)}): ${JSON.stringify(numbers.slice(0, 12))}`);
}

/** Whether the shell has a program, asked of the shell and read from the host's replay. */
async function hasProgram(page, base, id, program) {
  await typeLine(page, `command -v ${program} >/dev/null && echo HAS_YES_${program} || echo HAS_NO_${program}`);
  return (await shellSays(base, id, new RegExp(`\\nHAS_(YES|NO)_${program}\\n`), `the shell to say whether it has ${program}`))[1] === 'YES';
}

/** A reload cuts the calls that are in flight, which an engine reports as a page error: they are the page's going away, not the terminal's. Anything else is. */
const CUT_BY_A_RELOAD = /access control checks|Load failed|Failed to fetch|NetworkError|network connection was lost|cancelled|aborted/i;

/**
 * r3. A terminal outlives a reload of its page (T2b, docs/ui-next/status/T2-go.md 2.4), on the real host. The page has a key (the page makes it and keeps it where its build keeps it: the check reads it from the wire) and opens its terminals with it; a page
 * that loads finds the terminals of its key (`ListTerminals`), its saved tabs take theirs back (`AttachTerminal`: the replay, its replies muted, then the live events, dropped by offset) and nothing else starts. (1) A reload in the middle of a session: the
 * markers and the shell's pid before it are there after it (the same shell, the earlier output in the scrollback), typing works with the count of its input going on from the host's `next_input_seq` (the first numbered call after the attach carries it, the next ones are consecutive, none is 0, the host refuses none), the page made one ListTerminals and one AttachTerminal with its key and no offset and no CreateTerminal, and the key is not in the
 * address of the page, in an address it asked for, or on its console; the old window being retired by the host while the new page's attach is on its way tells the page nothing (a DETACHED with another page's number is not its business); a terminal that
 * was let go (a request to detach it) is `Detached` with its input off, still the host's shell, and a reload within its lease takes it back; two terminals come back in their order, each with its own shell, and closing one ends its shell. (2) A reload in the
 * middle of a flood: the end arrives, the lines the emulator holds at the end count up by one, and what the page acknowledges after the attach is live bytes only; and a slow stream across a reload is read in the emulator at its join: every reading counts up
 * by one; a runaway producer (`yes`, which never ends) is read on after a reload and stopped by Control C typed in the terminal the page took back, with live bytes only acknowledged. (3) A full-screen program: the alternate screen is back with its text, `:q!` or the program's end gives the shell back with its earlier output; a program whose start has left the replay (the host's ring is 1.25 MiB) is on the alternate screen all
 * the same, by the modes the host states. How long each took is told, and the words a person saw while it came back.
 */
async function checkTerminalReattach(page, base, engine) {
  const errors = [];
  const observed = [];
  const note = (name, text) => observed.push(`${name}: ${text}`);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  const wire = watchExecCalls(page);
  const events = watchTerminalEvents(page);
  const leaks = watchLeaks(page);
  await spoofPlatform(page);
  await keepCopiesOnEveryLoad(page);
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await page.locator('[data-shell-part="panelToggle"]').click();
  const emptyButton = () => page.locator('[data-shell-part="panelEmpty"]').getByRole('button', { name: 'New terminal', exact: true });
  const plusButton = () => page.locator('[data-shell-part="sessionAdd"]').getByRole('button', { name: 'New terminal', exact: true });

  // The terminals the checks below reload, by the names of their tabs.
  let names = [];
  /**
   * A reload of the page, until the terminals are back and running as `names` says: what a person saw meanwhile, the one attach of each terminal (with the page's key and no offset), no create, and the emulator has the keyboard. Returns when the reload
   * began, how long it took and the attach of the first terminal.
   */
  const reloadToTerminals = async (ids, what) => {
    const back = await reloadUntil(page, runningAs(names));
    assert.ok(back.ok, `${engine}: after ${what} the tabs of the terminals are back, running and with no word of a terminal that is gone, within 60 s: ${timelineOf(back.seen)}`);
    assert.deepEqual(back.seen.filter((seen) => /taken over|detached/i.test(seen.state.lane.join(' '))), [], `${engine}: after ${what} the page said nothing of a terminal it did not lose (its own takeover comes back to it as DETACHED taken-over with the number of the window that held the terminal before): ${timelineOf(back.seen)}`);
    await takeKeyboard(page);
    for (const id of ids) {
      const attached = sinceOf(wire, 'AttachTerminal', id, back.startedAt);
      assert.equal(attached.length, 1, `${engine}: after ${what} the page took terminal ${id} back with one AttachTerminal (it made ${String(attached.length)})`);
      await waitUntil('the answer of the host to the attach', async () => attached[0].answered === true, 15_000);
      assert.equal(attached[0].status, 200, `${engine}: after ${what} the host answered the attach of terminal ${id} with success`);
    }

    assert.equal(sinceOf(wire, 'CreateTerminal', undefined, back.startedAt).length, 0, `${engine}: after ${what} the page started no terminal: the saved tabs took their own back`);
    return { ...back, attach: sinceOf(wire, 'AttachTerminal', ids[0], back.startedAt)[0] };
  };

  // (1a) A reload in the middle of a session.
  const first = await startTerminal(page, base, emptyButton());
  assert.equal(await sessionTabsOf(page).first().getAttribute('data-tab-id'), first, `${engine}: the tab of a terminal has the terminal's id (a saved tab finds its terminal by it)`);
  await takeKeyboard(page);
  await typeLine(page, 'echo MARK_ONE_$((6*7)); echo PID_$$; echo MARK_TWO_$((6*8))');
  const pid = Number((await shellSays(base, first, /\nMARK_ONE_42\nPID_(\d+)\nMARK_TWO_48\n/, 'the markers and the pid of the shell'))[1]);
  names = await tabLabelsOf(page);
  assert.ok(names.length === 1 && !/, (starting|ended|failed)$/.test(names[0]), `${engine}: one terminal, one tab, and the tab is of a running terminal (it says ${names.join(' | ')})`);
  await savedTabs(base, first);
  const key = keyOnTheWire(wire);
  assert.ok(typeof key === 'string' && key.length >= 16 && key.length <= 128, `${engine}: the page gave the host a page key when it started the terminal (16 to 128 characters)`);
  // The numbers the first page gave its input and its size before the reload (writes and resizes count together): the host's next number is one past the last of them, and the page that takes the terminal back must go on from there.
  const numbersBefore = [...wire.of('WriteTerminal'), ...wire.of('ResizeTerminal')].filter((call) => call.args[0] === first).map((call) => call.args[1]);
  const one = await reloadToTerminals([first], 'a reload in the middle of a session');
  const buffer = await untilLine(page, mac, 'MARK_TWO_48', 'the earlier output in the emulator of the page that came back', 60_000);
  const scrolledAt = Date.now() - one.startedAt;
  assert.ok(lineIn(buffer, 'MARK_ONE_42') && lineIn(buffer, `PID_${String(pid)}`), `${engine}: the scrollback of the page that came back holds the markers and the pid the shell wrote before the reload`);
  await typeLine(page, 'echo PID_AGAIN_$$');
  await assertNumbersAfterAttach(wire, first, one.attach, engine, 'after a reload in the middle of a session');
  const again = Number((await shellSays(base, first, /\nPID_AGAIN_(\d+)\n/, 'the shell to say its pid again'))[1]);
  assert.equal(again, pid, `${engine}: after the reload the terminal is the same shell: its pid is ${String(pid)} again`);
  await typeLine(page, 'echo AFTER_$((6*7))');
  await untilLine(page, mac, 'AFTER_42', 'what was typed after the reload in the emulator', 30_000);
  assert.ok(/\nAFTER_42\n/.test(await plainTranscriptOf(base, first)), `${engine}: what was typed after the reload reached the shell`);
  await assertNumbersAfterAttach(wire, first, one.attach, engine, 'after the two lines typed after the reload');
  const listed = sinceOf(wire, 'ListTerminals', undefined, one.startedAt);
  assert.ok(listed.length >= 1 && listed.every((call) => call.status === 200 && call.args[0] === key), `${engine}: after the reload the page asked the host for the terminals of its key (${String(listed.length)} ListTerminals)`);
  const request = one.attach.args[1];
  assert.ok(request?.page_key === key && !('from_offset' in request), `${engine}: the page took the terminal over with its page key and no offset (a page that has rendered nothing has nothing to continue)`);
  const answer = one.attach.answer;
  assert.ok(answer?.attachment >= 1 && !answer.ended && answer.replay?.end > 0, `${engine}: the host answered the attach with the replay and the number of the attachment (the first page held 0), and no end`);
  const replayBytes = base64Length(String(answer.replay.data ?? ''));
  const lastNumberBefore = numbersBefore.reduce((high, number) => Math.max(high, number), 0);
  assert.ok(Number.isInteger(answer.next_input_seq) && answer.next_input_seq > 1, `${engine}: the attach answered a next input number past 1 (the first page typed before the reload): ${JSON.stringify(answer.next_input_seq)}`);
  assert.equal(answer.next_input_seq, lastNumberBefore + 1, `${engine}: the attach answered the number one past the last number the first page sent (${String(lastNumberBefore)}, in ${String(numbersBefore.length)} calls)`);
  const listedNext = listed.at(-1)?.answer?.find?.((listedEntry) => listedEntry.id === first)?.next_input_seq;
  assert.equal(listedNext, answer.next_input_seq, `${engine}: the list said the same next input number as the attach (the list said ${JSON.stringify(listedNext)})`);
  assert.deepEqual(await terminalIds(base), [first], `${engine}: the host holds the one terminal, and the reload made no other`);
  assertSecretIsNowhere(key, page, leaks, engine, 'after a reload');
  note('reload in the middle of a session', `the page asked to attach ${String(one.attach.askedMs - one.startedAt)} ms after the reload began and the host answered ${String(one.attach.answeredMs - one.attach.askedMs)} ms later (the replay was in hand ${String(one.attach.answeredMs - one.startedAt)} ms after the reload began); the panel ${one.opened === 'by itself' ? 'opened by itself' : 'stayed closed (a restored session does not cover the page) and was opened by a press'} ${String(one.openedAfter)} ms after the reload began; the tab was running ${String(one.took - one.openedAfter)} ms after that and the earlier output was in the emulator ${String(scrolledAt - one.openedAfter)} ms after the panel opened (what a person saw: ${timelineOf(one.seen)}); the replay was ${String(replayBytes)} bytes ([${String(answer.replay.start)}, ${String(answer.replay.end)}), attachment ${String(answer.attachment)}); the same shell (pid ${String(pid)}) typed in`);

  // (1c) The host retires the old window while the new page's attach is on its way. The old page's DetachTerminal (what a page that is going away says, so that the host holds the shell at once) is dropped here, so the host learns of the loss only when it
  // retires the window, about 3 s after its socket went; the attach of the new page is held until the host says that nobody holds the terminal and every window has been told (`DETACHED`, `window-retired`, the number of the attachment that ended: the one the old page
  // held, which the reload before it made 1). That number is not the new page's (the next one), so the page says nothing and takes the terminal back all the same. (An engine may deliver the call of a page that is going away whatever a route says: the host then holds the terminal at once, the new page has no socket yet to be told
  // on, and the race cannot be staged: that is told, and the page is checked all the same.)
  const gate = Promise.withResolvers();
  let attachHeld = false;
  let dropped = 0;
  const detachMethod = methodIdOf(EXEC_SERVICE, 'DetachTerminal');
  const attachMethod = methodIdOf(EXEC_SERVICE, 'AttachTerminal');
  const hold = async (route) => {
    const method = calledMethod(route.request());
    if (method === detachMethod) {
      dropped += 1;
      await route.abort();
      return;
    }

    if (method === attachMethod && !attachHeld) {
      attachHeld = true;
      await gate.promise;
    }

    await route.continue();
  };
  await page.route('**/wails/runtime', hold);
  const raceAt = Date.now();
  await page.reload({ waitUntil: 'load' });
  await openPanelAgain(page);
  const racing = watchPanelUntil(page, runningAs(names), 90_000, raceAt);
  await waitUntil('the attach of the new page to be on its way', async () => attachHeld, 30_000);
  const entryOf = async () => {
    const answered = await callAsPage(page, 'ListTerminals', key);
    return Array.isArray(answered.json) ? answered.json.find((one) => one.id === first) : undefined;
  };
  let entry = await entryOf();
  const staged = entry?.attached === true;
  let told;
  if (staged) {
    await waitUntil('the host to count the old window as gone', async () => {
      entry = await entryOf();
      return entry?.attached === false;
    }, 30_000);
    assert.ok(entry.lease_expires_unix_ms > Date.now(), `${engine}: the terminal that nobody holds has a lease running (it expires at ${String(entry.lease_expires_unix_ms)})`);
    await waitUntil('the page to be told that the old window let the terminal go', async () => events.detached(first).some((frame) => frame.at >= raceAt), 15_000);
    told = events.detached(first).find((frame) => frame.at >= raceAt);
    assert.deepEqual({ by: told.data?.by, attachment: told.data?.attachment }, { by: 'window-retired', attachment: answer.attachment }, `${engine}: the host told every window that the old window's hold was over, with the number of the attachment that ended (the one the old page held)`);
  }

  gate.resolve();
  const raced = await racing;
  await page.unroute('**/wails/runtime', hold);
  assert.ok(raced.ok, `${engine}: the page takes the terminal back although the host told it that the old window let it go (another page's number is not its business) within 90 s: ${timelineOf(raced.seen)}`);
  assert.deepEqual(raced.seen.filter((entry) => /taken over|detached|moved|waiting/i.test(entry.state.lane.join(' '))), [], `${engine}: the page said nothing of a terminal it did not lose: ${timelineOf(raced.seen)}`);
  const raceAttach = sinceOf(wire, 'AttachTerminal', first, raceAt);
  assert.equal(raceAttach.length, 1, `${engine}: the page made one attach in the race (it made ${String(raceAttach.length)})`);
  await waitUntil('the answer of the host to the attach', async () => raceAttach[0].answered === true, 15_000);
  assert.ok(raceAttach[0].status === 200 && raceAttach[0].answer?.attachment >= 1, `${engine}: the attach that waited for the retirement succeeded, with the next number of attachment`);
  await takeKeyboard(page);
  await typeLine(page, 'echo AFTER_RACE_$((6*7))');
  await untilLine(page, mac, 'AFTER_RACE_42', 'what was typed after the race in the emulator', 30_000);
  assert.ok(/\nAFTER_RACE_42\n/.test(await plainTranscriptOf(base, first)), `${engine}: what was typed after the race reached the shell`);
  note('the old window retired while the attach was on its way', staged
    ? `the host said the terminal was nobody's and told the page ${JSON.stringify(told.data)} ${((told.at - raceAt) / 1000).toFixed(1)} s after the reload began (the check dropped ${String(dropped)} DetachTerminal call of the old page); the page took it back after the wait (attachment ${String(raceAttach[0].answer.attachment)}) and said nothing: ${timelineOf(raced.seen)}`
    : `NOT STAGED: the host already counted the terminal as nobody's when the attach was held (the engine delivered the old page's DetachTerminal although the check dropped ${String(dropped)}); the page took the terminal back (attachment ${String(raceAttach[0].answer.attachment)}) and said nothing: ${timelineOf(raced.seen)}`);

  // (1d) A terminal that was let go. A request to detach it, made through the page as another client of the window may make it, leaves it running until its lease ends. The page that held it says `Detached` and that its input is off, types nothing into it, the
  // shell is still there for the host, and a reload within the lease takes it back.
  const letGoAt = Date.now();
  const toldBefore = events.detached(first).length;
  const letGo = await callAsPage(page, 'DetachTerminal', first, { page_key: key, lease_ms: 120_000 });
  assert.equal(letGo.status, 200, `${engine}: the host detached the terminal at the request of the window that holds it (${letGo.text.slice(0, 200)})`);
  const lane = await watchPanelUntil(page, (state) => state.lane.some((words) => /Detached/.test(words)), 30_000, letGoAt);
  assert.ok(lane.ok, `${engine}: the page says that the terminal was detached within 30 s: ${timelineOf(lane.seen)}`);
  assert.match((await seePanel(page)).lane.join(' '), /Input is off\. The shell keeps running until its lease ends\./, `${engine}: the lane says that the input is off and that the shell keeps running until its lease ends`);
  const letGoTold = events.detached(first).slice(toldBefore).map((frame) => ({ by: frame.data?.by, attachment: frame.data?.attachment }));
  assert.deepEqual(letGoTold, [{ by: 'requested', attachment: raceAttach[0].answer.attachment }], `${engine}: the host told the window that it let the terminal go, with the number of the attachment that held it`);
  const kept = await entryOf();
  assert.ok(kept?.attached === false && Math.abs(kept.lease_expires_unix_ms - Date.now() - 120_000) < 10_000, `${engine}: the host lists the terminal as nobody's with the lease that was asked for, 120 s (${JSON.stringify({ attached: kept?.attached, leaseLeftMs: (kept?.lease_expires_unix_ms ?? 0) - Date.now() })})`);
  const wrote = wire.of('WriteTerminal').length;
  await page.locator('.xterm-screen').click({ position: { x: 3, y: 3 } });
  await typeLine(page, 'echo WHILE_DETACHED_$((6*7))');
  for (let turn = 0; turn < 45; turn += 1) await afterFrames(page);
  assert.equal(wire.of('WriteTerminal').length, wrote, `${engine}: the page sends nothing to a terminal it let go: what was typed made no WriteTerminal`);
  assert.equal(/WHILE_DETACHED_42/.test(await plainTranscriptOf(base, first)), false, `${engine}: what was typed while the terminal was detached never reached the shell`);
  assert.equal((await busyOf(base, first)).state, 'idle', `${engine}: the shell is still at its prompt for the host`);
  const taken = await reloadToTerminals([first], 'a reload while the terminal was detached');
  const retaken = await untilLine(page, mac, 'AFTER_RACE_42', 'the earlier output in the emulator that took the detached terminal back', 60_000);
  assert.ok(lineIn(retaken, 'MARK_ONE_42') && lineIn(retaken, `PID_${String(pid)}`), `${engine}: the scrollback of the page that took the detached terminal back holds what the shell wrote before it was let go`);
  await typeLine(page, 'echo PID_LETGO_$$');
  assert.equal(Number((await shellSays(base, first, /\nPID_LETGO_(\d+)\n/, 'the shell to say its pid after it was let go'))[1]), pid, `${engine}: a terminal that was let go and taken back within its lease is the same shell: pid ${String(pid)}`);
  note('a terminal that was let go', `the page said "${lane.seen.at(-1).state.lane.join(' ')}" ${String(lane.took)} ms after the request, the host kept the shell (pid ${String(pid)}) with a lease of 120 s, and a reload took it back after ${(taken.took / 1000).toFixed(2)} s with attachment ${String(taken.attach.answer.attachment)}`);

  // (1b) Two terminals come back in the order they were in, each with its own shell, and closing one ends its shell.
  const second = await startTerminal(page, base, plusButton());
  await takeKeyboard(page);
  await typeLine(page, 'echo MARK_B_$((6*9)); echo PID_B_$$');
  const pidB = Number((await shellSays(base, second, /\nMARK_B_54\nPID_B_(\d+)\n/, 'the marker and the pid of the second shell'))[1]);
  assert.notEqual(pidB, pid, `${engine}: the second terminal is another shell`);
  names = await tabLabelsOf(page);
  assert.equal(names.length, 2, `${engine}: two terminals, two tabs (${names.join(' | ')})`);
  await savedTabs(base, first, second);
  const two = await reloadToTerminals([first, second], 'a reload with two terminals');
  for (const [index, id, marker, label, expected] of [[0, first, 'MARK_TWO_48', 'PID_', pid], [1, second, 'MARK_B_54', 'PID_B_', pidB]]) {
    await sessionTabsOf(page).nth(index).click();
    await takeKeyboard(page);
    const shown = await untilLine(page, mac, marker, `the earlier output of terminal ${String(index + 1)} in its emulator`, 60_000);
    assert.ok(lineIn(shown, `${label}${String(expected)}`), `${engine}: terminal ${String(index + 1)} came back with the output its shell wrote, in the tab it was in`);
    await typeLine(page, `echo NOW_${String(index)}_$$`);
    const now = Number((await shellSays(base, id, new RegExp(`\\nNOW_${String(index)}_(\\d+)\\n`), `the shell of terminal ${String(index + 1)} to say its pid`))[1]);
    assert.equal(now, expected, `${engine}: terminal ${String(index + 1)} is the shell it was: pid ${String(expected)}`);
  }

  assert.deepEqual(await tabLabelsOf(page), names, `${engine}: the two tabs are in the order they were in, with the names they had`);
  assert.deepEqual((await terminalIds(base)).sort(), [first, second].sort(), `${engine}: the host holds the two terminals and the reload made no other`);
  await page.locator('[data-shell-part="sessionTab"]').nth(1).locator('[data-shell-part="sessionClose"]').click();
  await waitUntil('the host to end the terminal whose tab was closed', async () => (await terminalIds(base)).length === 1, 15_000);
  assert.deepEqual(await terminalIds(base), [first], `${engine}: closing the tab of a terminal that came back ended that shell and no other`);
  assert.ok(sinceOf(wire, 'CloseSession', second, two.startedAt).length >= 1, `${engine}: the page asked the host to end it with CloseSession`);
  names = await tabLabelsOf(page);
  assert.equal(names.length, 1, `${engine}: one tab is left`);
  note('two terminals', `both came back ${(two.took / 1000).toFixed(2)} s after the reload began, in their order, each with its own shell (pids ${String(pid)} and ${String(pidB)}); closing the second ended it`);

  // (2a) A reload in the middle of a flood (3,000,000 lines, about 26 MB through the pty: longer than the reload takes whatever the machine's speed): the host holds the shell at its mark while nobody acknowledges, the new page's attach gives it the replay (which it
  // never acknowledges) and the live bytes after it, and the flood goes on to its end. The numbers are written to a file first and sent by `cat`, so that the events are the size of a read (a line-buffered producer makes one event of a few bytes for each line, and
  // some `seq` prints 1e+06 from a million on). The scrollback keeps 5,000 lines, so what is read at the end is the end of the flood: the lines count up by one to the last, and what the page acknowledged after the attach is the live bytes.
  await sessionTabsOf(page).first().click();
  await takeKeyboard(page);
  const flood = 3_000_000;
  await typeLine(page, `f=$(mktemp); awk 'BEGIN{for(i=1;i<=${String(flood)};i++)print i}' > $f; cat $f; rm -f $f; echo FLOOD_END_$((6*7))`);
  await waitUntil('the flood to hold the terminal', async () => (await busyOf(base, first)).state === 'busy', 30_000);
  const mid = await reloadToTerminals([first], 'a reload in the middle of a flood');
  const flooded = await untilLine(page, mac, 'FLOOD_END_42', 'the end of the flood in the emulator of the page that came back', 180_000);
  const tail = numbersOf(flooded).slice(1);
  assert.ok(tail.length >= 4_000 && tail.at(-1) === flood && firstBreak(tail) === undefined, `${engine}: the numbered lines the emulator holds at the end of the flood count up by one to ${String(flood)} (${String(tail.length)} lines from ${String(tail[0])} to ${String(tail.at(-1))}, ${JSON.stringify(firstBreak(tail) ?? 'in order')})`);
  const midAnswer = mid.attach.answer;
  const live = bytesBeyond(events.outputs(first), midAnswer.replay.end);
  assert.ok(live >= 262_144, `${engine}: the flood was still running when the page took the terminal back: ${String(live)} bytes of it came after the replay (the host's low mark is 262,144)`);
  await waitUntil('the last acknowledgement of the live output', async () => ackedOf(wire, first, mid.attach.askedMs) >= live - 65_536, 30_000).catch(() => undefined);
  const acked = ackedOf(wire, first, mid.attach.askedMs);
  assert.ok(acked <= live, `${engine}: the page acknowledged live bytes only: ${String(acked)} bytes acknowledged after the attach, ${String(live)} bytes of live events lie beyond the replay (it ended at ${String(midAnswer.replay.end)} and held ${String(base64Length(String(midAnswer.replay.data ?? '')))} bytes): the replay is never acknowledged`);
  assert.ok(acked >= live - 65_536, `${engine}: the page acknowledged what it applied of the live output: ${String(acked)} of ${String(live)} bytes`);
  note('reload in the middle of a flood', `the end of ${String(flood)} lines arrived; the replay was ${String(base64Length(String(midAnswer.replay.data ?? '')))} bytes ([${String(midAnswer.replay.start)}, ${String(midAnswer.replay.end)})), ${String(live)} live bytes followed and ${String(acked)} were acknowledged; the last ${String(tail.length)} lines count up by one`);

  // (2b) A stream slow enough for its join to be read in the emulator (the flood above is over in less time than a reading takes): the page reads it again and again after the reload, and every reading counts up by one, the join (the last line of the replay)
  // among them.
  const paced = 18_000;
  await typeLine(page, `i=1; while [ $i -le ${String(paced)} ]; do echo $i; [ $((i % 50)) -eq 0 ] && sleep 0.05; i=$((i+1)); done; echo PACED_END_$((6*7))`);
  await waitUntil('the stream to have written 3,000 lines', async () => (numbersOf(await bufferOf(page, mac)).filter((number) => number <= paced).at(-1) ?? 0) >= 3_000, 60_000);
  const slow = await reloadToTerminals([first], 'a reload in the middle of a stream');
  const readings = await readingsUntil(page, mac, 'PACED_END_42', 'the end of the stream in the emulator of the page that came back', 120_000, paced);
  const replayNumbers = numbersOf(plain(Buffer.from(String(slow.attach.answer.replay.data ?? ''), 'base64').toString('utf8'))).filter((number) => number <= paced);
  // The last line of a replay may be cut where it ends; the one before it is whole.
  const join = replayNumbers.at(-2);
  assert.ok(Number.isInteger(join) && join >= 3_000, `${engine}: the replay holds the stream as far as the reload (its last whole line is ${String(join)})`);
  assert.deepEqual(readings.filter((reading) => reading.broken !== undefined).map((reading) => reading.broken), [], `${engine}: every reading of the emulator counts up by one, from the replay into the live lines (${String(readings.length)} readings)`);
  assert.ok(readings.some((reading) => reading.first <= join - 50 && reading.last >= join + 50), `${engine}: a reading held the join at line ${String(join)} with 50 lines on each side (the ${String(readings.length)} readings held ${readings.map((reading) => `${String(reading.first)}-${String(reading.last)}`).join(', ')})`);
  note('a slow stream across a reload', `${String(readings.length)} readings of the emulator counted up by one, the join at line ${String(join)} (the replay held ${String(replayNumbers.length)} numbered lines) among them`);

  // (2c) A runaway producer across a reload (`yes`, which never ends). The host holds the shell at its mark while nobody acknowledges; the page that takes the terminal back must go on reading, parsing and acknowledging its live bytes (a page that stalls
  // leaves the host holding the shell for good), and the keyboard of the terminal it took back is the shell's: Control C typed in the middle of the flood stops the producer and the shell answers. What the page acknowledged after the attach is live bytes
  // only. Nothing reads the host's replay of the terminal while the producer runs (that call makes the host forget what is owed to it), and the buffer is not read before Control C (a selection would make the key a copy on some platforms).
  const yesFrom = Date.now();
  await takeKeyboard(page);
  await typeLine(page, 'yes');
  const yesRan = await holdsWithin(async () => (await busyOf(base, first)).state === 'busy' && ackedOf(wire, first, yesFrom) >= 4_194_304, 120_000);
  assert.ok(yesRan, `${engine}: the runaway producer was running before the reload: the host said busy and the page had acknowledged at least 4 MiB of its output within 120 s (it had acknowledged ${String(ackedOf(wire, first, yesFrom))} bytes)`);
  const yesAckedBefore = ackedOf(wire, first, yesFrom);
  const runaway = await reloadToTerminals([first], 'a reload in the middle of a runaway producer');
  const runawayAnswer = runaway.attach.answer;
  assert.equal(runawayAnswer.busy?.state, 'busy', `${engine}: the host said that a program runs in the terminal as the page took it back (the attach said ${JSON.stringify(runawayAnswer.busy)})`);
  const yesGrowthFrom = Date.now();
  const yesAcksAtBack = ackedOf(wire, first, runaway.attach.askedMs);
  const yesGrownBy = () => ackedOf(wire, first, runaway.attach.askedMs) - yesAcksAtBack;
  const yesReadOn = await holdsWithin(async () => yesGrownBy() >= 2_097_152, 120_000);
  assert.ok(yesReadOn, `${engine}: the page that took the runaway producer back went on reading it: it acknowledged ${String(yesGrownBy())} more bytes in ${String(Date.now() - yesGrowthFrom)} ms, at least 2 MiB were due (a page that stops reading leaves the host holding the shell at its mark)`);
  const yesGrewIn = Date.now() - yesGrowthFrom;
  await takeKeyboard(page);
  const yesControlCAt = Date.now();
  await page.keyboard.press('Control+c');
  const yesIdle = await holdsWithin(async () => (await busyOf(base, first)).state === 'idle', 90_000);
  assert.ok(yesIdle, `${engine}: Control C typed in the terminal the page took back stopped the runaway producer: the host said that nothing but the shell holds the terminal within 90 s (it said ${(await busyOf(base, first)).state})`);
  const yesStoppedIn = Date.now() - yesControlCAt;
  await typeLine(page, 'echo AFTER_YES_$((6*7))');
  const yesAnswered = await holdsWithin(async () => /\nAFTER_YES_42\n/.test(await plainTranscriptOf(base, first)), 60_000);
  assert.ok(yesAnswered, `${engine}: the shell answers after the runaway producer was stopped: AFTER_YES_42 is in the host's replay within 60 s of the command`);
  await untilLine(page, mac, 'AFTER_YES_42', 'the answer of the shell in the emulator of the page that came back', 60_000);
  assert.ok(runningAs(names)(await seePanel(page)), `${engine}: the terminal is running as it was, with its tab and no word in its lane: ${JSON.stringify(await seePanel(page))}`);
  // Whatever the shell wrote last has been delivered by now, to the page and to what watches the page.
  await waitMs(1_500);
  const yesLive = bytesBeyond(events.outputs(first), runawayAnswer.replay.end);
  const yesAcked = ackedOf(wire, first, runaway.attach.askedMs);
  assert.ok(yesAcked <= yesLive, `${engine}: after the runaway producer the page acknowledged live bytes only: ${String(yesAcked)} bytes acknowledged after the attach, ${String(yesLive)} bytes of live events lie beyond the replay (it ended at ${String(runawayAnswer.replay.end)}): the replay is never acknowledged`);
  assert.ok(yesAcked >= yesLive - 65_536, `${engine}: the page acknowledged what it applied of the live output of the runaway producer: ${String(yesAcked)} of ${String(yesLive)} bytes`);
  note('a runaway producer across a reload', `the page had acknowledged ${String(yesAckedBefore)} bytes of it when it was reloaded; the replay was ${String(base64Length(String(runawayAnswer.replay.data ?? '')))} bytes ([${String(runawayAnswer.replay.start)}, ${String(runawayAnswer.replay.end)})) and the host said ${JSON.stringify(runawayAnswer.busy)}; the page then acknowledged 2 MiB more in ${String(yesGrewIn)} ms; Control C stopped it in ${String(yesStoppedIn)} ms (the host said idle) and the shell answered; ${String(yesLive)} live bytes in all, ${String(yesAcked)} acknowledged`);

  // (3) A full-screen program. The alternate screen is back with its text and not the shell's, and when the program ends the shell is back with its earlier output.

  // (3a) A short program of the shell's own, which every shell has: the alternate screen, two lines, a wait for a line, the way back.
  await takeKeyboard(page);
  await typeLine(page, 'echo MARK_BEFORE_ALT_$((6*7)); printf \'\\033[?1049h\\033[2J\\033[H\'; echo ALT_ONE_$((6*7)); echo ALT_TWO_$((6*8)); read -r line; printf \'\\033[?1049l\'; echo ALT_LEFT_$((6*9))');
  await shellSays(base, first, /\nALT_TWO_48\n/, 'the program to be on the alternate screen');
  const alt = await reloadToTerminals([first], 'a reload with a program on the alternate screen');
  const altShown = await untilLine(page, mac, 'ALT_TWO_48', 'the alternate screen in the emulator that came back', 60_000);
  assert.ok(lineIn(altShown, 'ALT_ONE_42') && !lineIn(altShown, 'MARK_BEFORE_ALT_42'), `${engine}: the emulator is on the alternate screen: its two lines are shown and the shell's earlier output is not`);
  await page.keyboard.press('Enter');
  const altLeft = await untilLine(page, mac, 'ALT_LEFT_54', 'the shell in the emulator once the program ended', 60_000);
  assert.ok(lineIn(altLeft, 'MARK_BEFORE_ALT_42') && !lineIn(altLeft, 'ALT_ONE_42'), `${engine}: when the program ended the shell's screen is back with its earlier output, and the program's lines are not on it`);
  note('the alternate screen', `a program on it came back after ${(alt.took / 1000).toFixed(2)} s with its text; its end gave back the shell with the earlier output`);

  // (3b) The same with the start of the program out of the host's ring (1.25 MiB): a flood after it entered the alternate screen (written to a file first and sent by `cat`, as above). The page is not sent the switch itself, the host states it (`start_modes`), and the page
  // switches before it writes.
  await takeKeyboard(page);
  await typeLine(page, 'echo MARK_BEFORE_BIG_$((6*7)); f=$(mktemp); awk \'BEGIN{for(i=1;i<=300000;i++)print i}\' > $f; printf \'\\033[?1049h\\033[2J\\033[H\'; cat $f; printf \'\\033[2J\\033[H\'; echo BIG_ALT_ONE_$((6*7)); read -r line; printf \'\\033[?1049l\'; rm -f $f; echo BIG_LEFT_$((6*9))');
  await untilLine(page, mac, 'BIG_ALT_ONE_42', 'the program to have written its screen after the flood', 120_000);
  const big = await reloadToTerminals([first], 'a reload with a program whose start left the replay');
  const bigAnswer = big.attach.answer;
  assert.ok(bigAnswer.replay.start > 0 && bigAnswer.replay.start_modes?.alt_screen === true, `${engine}: the host's ring no longer holds the start of the program and states that the bytes at its start were written on the alternate screen (start ${String(bigAnswer.replay.start)}, start_modes ${JSON.stringify(bigAnswer.replay.start_modes)})`);
  const bigShown = await untilLine(page, mac, 'BIG_ALT_ONE_42', 'the alternate screen in the emulator that came back', 60_000);
  assert.equal(numbersOf(bigShown).length, 0, `${engine}: the emulator is on the alternate screen, which keeps no scrollback, though the replay does not hold the switch: none of the ${String(numbersOf(bigShown).length)} numbered lines the program wrote before it cleared its screen is in the buffer (a page that wrote the replay on the shell's screen would hold thousands)`);
  await page.keyboard.press('Enter');
  const bigLeft = await untilLine(page, mac, 'BIG_LEFT_54', 'the shell in the emulator once the program ended', 60_000);
  assert.equal(lineIn(bigLeft, 'BIG_ALT_ONE_42'), false, `${engine}: the program's screen was on the alternate screen and left with it: its lines are not on the shell's screen (a page that did not switch would keep them)`);
  note('the alternate screen without its start', `the host's ring began ${String(bigAnswer.replay.start)} bytes into the output and stated the alternate screen; the page switched, and the end of the program left the shell's screen free of it`);

  // (3c) The program of this machine, when it has one: vim, with text typed in insert mode, comes back with its text, and `:q!` gives the shell back.
  await takeKeyboard(page);
  if (await hasProgram(page, base, first, 'vim')) {
    await typeLine(page, 'echo MARK_BEFORE_VIM_$((6*7)); vim -u NONE -N -n "$HOME/seam-reattach.txt"');
    await waitUntil('vim to be on the alternate screen', async () => {
      const raw = await transcriptOf(base, first);
      return raw.lastIndexOf('\u001b[?1049h') > raw.lastIndexOf('\u001b[?1049l');
    }, 30_000);
    await page.keyboard.type('iVIM_TEXT_42');
    await waitUntil('vim to draw what was typed', async () => (await plainTranscriptOf(base, first)).includes('VIM_TEXT_42'), 30_000);
    const vim = await reloadToTerminals([first], 'a reload with vim on the screen');
    const vimShown = await untilLine(page, mac, 'VIM_TEXT_42', 'what was typed in vim, in the emulator that came back', 60_000);
    assert.equal(lineIn(vimShown, 'MARK_BEFORE_VIM_42'), false, `${engine}: vim is on the screen: the shell's earlier output is not`);
    await page.keyboard.press('Escape');
    await page.keyboard.type(':q!');
    await page.keyboard.press('Enter');
    await waitUntil('vim to give the alternate screen back', async () => {
      const raw = await transcriptOf(base, first);
      return raw.lastIndexOf('\u001b[?1049l') > raw.lastIndexOf('\u001b[?1049h');
    }, 30_000);
    await typeLine(page, 'echo AFTER_VIM_$((6*7))');
    const vimLeft = await untilLine(page, mac, 'AFTER_VIM_42', 'the shell in the emulator after vim', 60_000);
    assert.ok(lineIn(vimLeft, 'MARK_BEFORE_VIM_42') && !lineIn(vimLeft, 'VIM_TEXT_42'), `${engine}: after :q! the shell's screen is back with its earlier output and vim's text is not on it`);
    assert.ok(/\nAFTER_VIM_42\n/.test(await plainTranscriptOf(base, first)), `${engine}: the shell answers after vim`);
    note('vim', `came back ${(vim.took / 1000).toFixed(2)} s after the reload began with its text, and :q! gave the shell back`);
  } else {
    note('vim', 'not installed on this machine, not run (the alternate screen is checked with the shell\'s own programs above)');
  }

  assert.deepEqual(errors.filter((message) => !CUT_BY_A_RELOAD.test(message)), [], `${engine}: the page raised no error but the calls a reload cut`);
  assertSecretIsNowhere(key, page, leaks, engine, 'at the end');
  console.log(`terminal-reattach ${engine}:\n${observed.map((line) => `  ${line}`).join('\n')}`);
}

/**
 * r4. A terminal is held by one page at a time, and it does not outlive the host or its lease (T2b, docs/ui-next/status/T2-go.md 2.4, 2.5 and 2.7), on the real host. (1) A duplicated tab: a second page of the same browser (a copy of the first page's session storage,
 * as a browser's duplicate makes) takes the terminal over as it loads; the first page is told (`DETACHED`, `taken-over`, its own number: 0), its lane says "Taken over by another tab" and that its input is off (what is typed in it reaches nobody: no WriteTerminal,
 * nothing in the shell), and when it goes it sends neither DetachTerminal nor CloseSession (the host refuses the detach of a page that was displaced, and a close would end the other page's shell); the second page's terminal goes on running after the first page
 * is closed and the host has retired its window, and it takes input (its first numbered call carries the `next_input_seq` of its attach). How long the first page took to be told, and to say so, is told. (2) A restart of the host: a window saved with a terminal tab comes back to a host that holds no such terminal: the tab is ended,
 * says that the earlier output is gone, and no attach succeeded and nothing was started. (3) A lease that runs out: a terminal detached with a lease of 3 s and taken back by nobody is ended by the host, which says why (`CLOSE`, `detach-timeout`), the page says
 * `Closed: no tab took it back in time`, and a page that loads later finds the tab ended with the earlier output gone.
 */
async function checkTerminalTakeover(browser, getHost, restart, engine, work) {
  const errors = [];
  const observed = [];
  const note = (name, text) => observed.push(`${name}: ${text}`);
  const base = () => getHost().base;
  const emptyButton = (page) => page.locator('[data-shell-part="panelEmpty"]').getByRole('button', { name: 'New terminal', exact: true });
  /** What a check of this scenario watches of a page: its calls, the events of the exec lane, what it says where a secret must not be, its errors; the platform and the clipboard. */
  const watched = async (page) => {
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    const made = { wire: watchExecCalls(page), events: watchTerminalEvents(page), leaks: watchLeaks(page) };
    await spoofPlatform(page);
    await keepCopiesOnEveryLoad(page);
    return made;
  };
  /** A page, opened, with one terminal that has said its pid and with the host holding the saved window with its tab. */
  const withTerminal = async (page) => {
    await open(page, base());
    await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
    const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
    await page.locator('[data-shell-part="panelToggle"]').click();
    const id = await startTerminal(page, base(), emptyButton(page));
    await takeKeyboard(page);
    await typeLine(page, 'echo MARK_A_$((6*7)); echo PID_$$');
    const pid = Number((await shellSays(base(), id, /\nMARK_A_42\nPID_(\d+)\n/, 'the marker and the pid of the shell'))[1]);
    await savedTabs(base(), id);
    return { id, pid, mac, names: await tabLabelsOf(page) };
  };

  // (1) A duplicated tab: two pages of one browser context (a page made by `browser.newPage` owns its context, so the pair is made here).
  await forgetSession(base());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await context.newPage();
  watchRequests(a);
  const first = await watched(a);
  const { id, pid, mac, names } = await withTerminal(a);
  const key = keyOnTheWire(first.wire);
  assert.ok(typeof key === 'string' && key.length >= 16, `${engine}: the first tab gave the host a page key when it started the terminal`);
  const b = await context.newPage();
  watchRequests(b);
  const second = await watched(b);
  await duplicateStorage(a, b);
  const takeoverAt = Date.now();
  const losing = watchPanelUntil(a, (state) => state.lane.some((words) => /Taken over by another tab/.test(words)), 60_000, takeoverAt);
  await open(b, base());
  await openPanelAgain(b);
  const there = await watchPanelUntil(b, runningAs(names), 60_000, takeoverAt);
  assert.ok(there.ok, `${engine}: the second tab shows the terminal back and running within 60 s: ${timelineOf(there.seen)}`);
  const attached = sinceOf(second.wire, 'AttachTerminal', id, takeoverAt);
  assert.equal(attached.length, 1, `${engine}: the second tab took the terminal with one AttachTerminal (it made ${String(attached.length)})`);
  await waitUntil('the answer of the host to the attach of the second tab', async () => attached[0].answered === true, 15_000);
  assert.ok(attached[0].status === 200 && attached[0].answer?.attachment >= 1, `${engine}: the host let the second tab take the terminal, with the next number of attachment (the first tab held 0)`);
  assert.equal(sinceOf(second.wire, 'CreateTerminal', undefined, takeoverAt).length, 0, `${engine}: the second tab started no terminal`);
  const lost = await losing;
  assert.ok(lost.ok, `${engine}: the first tab says that another tab took the terminal over within 60 s: ${timelineOf(lost.seen)}`);
  const told = first.events.detached(id).find((frame) => frame.at >= takeoverAt);
  assert.ok(told !== undefined, `${engine}: the host told the first tab that it lost the terminal`);
  assert.deepEqual({ by: told.data?.by, attachment: told.data?.attachment }, { by: 'taken-over', attachment: 0 }, `${engine}: the host told the first tab that another tab took the terminal, with the number of the first tab's attachment`);
  const lane = (await seePanel(a)).lane.join(' ');
  assert.match(lane, /Taken over by another tab/, `${engine}: the lane of the first tab says that another tab took the terminal over`);
  assert.match(lane, /Input is off\./, `${engine}: and that its input is off`);

  // What is typed in the first tab reaches nobody.
  await a.bringToFront();
  await a.locator('.xterm-screen').first().click({ position: { x: 3, y: 3 } });
  const wrote = first.wire.of('WriteTerminal').length;
  await typeLine(a, 'echo FROM_A_$((6*7))');
  for (let turn = 0; turn < 45; turn += 1) await afterFrames(a);
  assert.equal(first.wire.of('WriteTerminal').length, wrote, `${engine}: the first tab sends nothing to the terminal it lost: what was typed in it made no WriteTerminal`);
  assert.equal(/\nFROM_A_42\n/.test(await plainTranscriptOf(base(), id)), false, `${engine}: what was typed in the first tab never reached the shell`);

  // The second tab has the terminal: the output the shell wrote before it came, and a shell that answers.
  await b.bringToFront();
  await takeKeyboard(b);
  await typeLine(b, 'echo FROM_B_$((6*7))');
  const numbersOfFirstTab = [...first.wire.of('WriteTerminal'), ...first.wire.of('ResizeTerminal')].filter((call) => call.args[0] === id).map((call) => call.args[1]);
  assert.equal(attached[0].answer.next_input_seq, numbersOfFirstTab.reduce((high, number) => Math.max(high, number), 0) + 1, `${engine}: the attach of the second tab answered the number one past the last number the first tab sent (${String(numbersOfFirstTab.length)} calls)`);
  await assertNumbersAfterAttach(second.wire, id, attached[0], engine, 'in the second tab');
  await shellSays(base(), id, /\nFROM_B_42\n/, 'what was typed in the second tab to reach the shell');
  const shown = await untilLine(b, mac, 'FROM_B_42', 'what the shell answered, in the second tab', 30_000);
  assert.ok(lineIn(shown, 'MARK_A_42'), `${engine}: the second tab holds the output the shell wrote before it took the terminal over`);

  // The first tab goes: it says nothing to the host (the host would refuse a detach of a page that was displaced, and a close would end the shell the second tab holds).
  const before = first.wire.calls.length;
  await a.goto('about:blank');
  await waitMs(2_000);
  assert.deepEqual(first.wire.calls.slice(before).map((call) => call.method), [], `${engine}: the first tab sent nothing to the host as it went`);
  assert.deepEqual(first.wire.calls.filter((call) => call.method === 'DetachTerminal' || call.method === 'CloseSession').map((call) => call.method), [], `${engine}: the first tab sent neither DetachTerminal nor CloseSession, not when it lost the terminal and not when it went`);
  await a.close();

  // The host retires the window of a page that is gone about 3.4 s after its socket went, and ends a terminal nobody holds when its lease runs out: neither touches the terminal the second tab holds. Looked at for 12 s.
  for (let round = 0; round < 30; round += 1) {
    await waitMs(400);
    const state = await seePanel(b);
    assert.ok(runningAs(names)(state), `${engine}: after the first tab was closed the second tab's terminal is still running (${JSON.stringify(state)})`);
  }

  const listed = await callAsPage(b, 'ListTerminals', key);
  const entry = (listed.json ?? []).find((one) => one.id === id);
  assert.ok(entry?.attached === true, `${engine}: the host lists the terminal as held by a page, 12 s after the first tab was closed (${JSON.stringify(entry)})`);
  assert.equal((await busyOf(base(), id)).state, 'idle', `${engine}: the shell is at its prompt`);
  await typeLine(b, 'echo STILL_B_$((6*7)); echo PID_NOW_$$');
  const pidNow = Number((await shellSays(base(), id, /\nSTILL_B_42\nPID_NOW_(\d+)\n/, 'the shell to answer in the second tab after the first was closed'))[1]);
  assert.equal(pidNow, pid, `${engine}: it is the shell it was: pid ${String(pid)}`);
  assert.deepEqual(second.wire.calls.filter((call) => call.method === 'DetachTerminal' || call.method === 'CloseSession').map((call) => call.method), [], `${engine}: the second tab sent neither DetachTerminal nor CloseSession`);
  assert.equal(second.events.detached(id).some((frame) => frame.data?.attachment === attached[0].answer.attachment), false, `${engine}: the second tab was not told that it lost the terminal`);
  assertSecretIsNowhere(key, a, first.leaks, engine, 'in the first tab');
  assertSecretIsNowhere(key, b, second.leaks, engine, 'in the second tab');
  note('a duplicated tab', `the first tab was told ${JSON.stringify(told.data)} ${String(told.at - attached[0].askedMs)} ms after the second tab asked to attach (the answer came after ${String(attached[0].answeredMs - attached[0].askedMs)} ms) and said "Taken over by another tab" ${String(lost.took)} ms after the second tab began to load; the second tab had the terminal running ${String(there.took)} ms after it began (attachment ${String(attached[0].answer.attachment)}); the first tab sent no write, no detach and no close; 12 s after it was closed the terminal was still held by the second tab, which typed in the same shell (pid ${String(pid)})`);
  await endTerminals(base(), b);
  await b.close();
  await context.close();

  // (2) A restart of the host.
  const c = await freshPage(browser, base());
  const third = await watched(c);
  const kept = await withTerminal(c);
  const keyBefore = keyOnTheWire(third.wire);
  const onDisk = async () => JSON.parse(await readFile(path.join(stateRoot(work), 'windows.json'), 'utf8')).states?.main?.session;
  await waitUntil('the saved window with the terminal tab to be on disk', async () => String(await onDisk().catch(() => '')).includes(kept.id), 30_000);
  await c.close();
  await restart();
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const fourth = await watched(d);
  const restartedAt = Date.now();
  await open(d, base());
  await openPanelAgain(d);
  const ended = await watchPanelUntil(d, (state) => state.tabs.length === 1 && state.tabs[0] === `${kept.names[0]}, ended` && state.gone, 60_000, restartedAt);
  assert.ok(ended.ok, `${engine}: after the host restarted the tab of the terminal is ended and says that the earlier output is gone within 60 s: ${timelineOf(ended.seen)}`);
  assert.deepEqual(await terminalIds(base()), [], `${engine}: the restarted host holds no terminal, and the page started none`);
  assert.deepEqual(fourth.wire.of('AttachTerminal').filter((call) => call.status === 200).map((call) => call.args[0]), [], `${engine}: no AttachTerminal succeeded (the terminal ended with the host)`);
  assert.equal(fourth.wire.of('CreateTerminal').length, 0, `${engine}: the page started no terminal in the place of the one that ended`);
  const lists = fourth.wire.of('ListTerminals');
  assert.ok(lists.length >= 1 && lists.every((call) => call.status === 200 && (call.answer ?? []).length === 0), `${engine}: the page asked the host for the terminals of its key and was told there are none (${String(lists.length)} ListTerminals)`);
  const said = await d.locator('body').innerText();
  assert.match(said, /The earlier output is gone/, `${engine}: the page says that the earlier output is gone`);
  assert.match(said, /This terminal is not running any more: Omniview restarted, or this window was away for longer than a terminal is kept\. Start a new terminal to continue\./, `${engine}: and says why, and what to do`);
  assertSecretIsNowhere(lists[0].args[0], d, fourth.leaks, engine, 'after the restart (the key of the page that looked)');
  assertSecretIsNowhere(keyBefore, d, fourth.leaks, engine, 'after the restart (the key of the page before it)');
  assertSecretIsNowhere(keyBefore, c, third.leaks, engine, 'before the restart');
  note('a restart of the host', `the tab of the terminal came back ended with the earlier output gone ${String(ended.took)} ms after the page began to load; ${String(lists.length)} ListTerminals answered none, no attach, no create`);

  await d.close();
  // (3) A terminal whose lease ran out while no page held it. A request to detach it with a short lease (made through the page, as another client of the window may make it) leaves the shell running for 3 s; nobody takes it back; the host ends it and says
  // why (`CLOSE`, `closed`, `detach-timeout`), and the page that held it says so. A page that loads after that finds the tab ended, with the words that the earlier output is gone, and no attach.
  const e = await freshPage(browser, base());
  const fifth = await watched(e);
  const lone = await withTerminal(e);
  const keyE = keyOnTheWire(fifth.wire);
  const letGoAt = Date.now();
  const detached = await callAsPage(e, 'DetachTerminal', lone.id, { page_key: keyE, lease_ms: 3_000 });
  assert.equal(detached.status, 200, `${engine}: the host detached the terminal with a lease of 3 s (${detached.text.slice(0, 200)})`);
  const expired = await watchPanelUntil(e, (state) => state.lane.some((words) => /Closed: no tab took it back in time/.test(words)), 30_000, letGoAt);
  assert.ok(expired.ok, `${engine}: the page says that the terminal was closed because no tab took it back in time, within 30 s of a lease of 3 s: ${timelineOf(expired.seen)}`);
  const closed = fifth.events.closes(lone.id).find((frame) => frame.at >= letGoAt);
  assert.deepEqual({ reason: closed?.data?.reason, closed_by: closed?.data?.closed_by }, { reason: 'closed', closed_by: 'detach-timeout' }, `${engine}: the host said why it ended the terminal`);
  assert.deepEqual(await terminalIds(base()), [], `${engine}: the host holds no terminal once the lease ran out`);
  const lateAt = Date.now();
  await e.reload({ waitUntil: 'load' });
  await openPanelAgain(e);
  const late = await watchPanelUntil(e, (state) => state.tabs.length === 1 && state.tabs[0] === `${lone.names[0]}, ended` && state.gone, 60_000, lateAt);
  assert.ok(late.ok, `${engine}: a page that loads after the lease ran out finds the tab ended, with the words that the earlier output is gone, within 60 s: ${timelineOf(late.seen)}`);
  assert.deepEqual(sinceOf(fifth.wire, 'AttachTerminal', undefined, lateAt).filter((call) => call.status === 200).map((call) => call.args[0]), [], `${engine}: no attach of the terminal that ran out succeeded`);
  assert.equal(sinceOf(fifth.wire, 'CreateTerminal', undefined, lateAt).length, 0, `${engine}: the page started no terminal in its place`);
  assertSecretIsNowhere(keyE, e, fifth.leaks, engine, 'after the lease ran out');
  note('a lease that ran out', `the page said "${expired.seen.at(-1).state.lane.join(' ')}" ${String(expired.took)} ms after the request to detach with a lease of 3 s (the host's CLOSE came ${String(closed.at - letGoAt)} ms after it); a page that loaded later found the tab ended with the earlier output gone after ${String(late.took)} ms`);

  assert.deepEqual(errors.filter((message) => !CUT_BY_A_RELOAD.test(message)), [], `${engine}: the pages raised no error but the calls a reload cut`);
  console.log(`terminal-takeover ${engine}:\n${observed.map((line) => `  ${line}`).join('\n')}`);
}

let host;
try {
  const port = await freePort();
  host = await startHost(work, port);
  // Both builds link only to the shared list; the control bundles the kit and its ReactDOM dependency instead of sharing them.
  const dependencies = Object.fromEntries(host.built.map(({ id, dependencies: names }) => [id, names]));
  for (const id of [OK, DUP]) {
    for (const name of dependencies[id]) assert.ok(SHARED_SPECIFIERS_V1.includes(name), `${id} imports ${name}, which is not on the shared list`);
  }
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
  /** The connections fixture's process (scenario u), built once for every host scenario u starts. */
  let connectionsBinary;
  const connectionsFixture = async () => (connectionsBinary ??= await buildConnectionsProcess(path.join(work, 'connections-binary')));

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

      if (ONLY === CONNECTIONS_GROUP || CONTROL === CONNECTIONS_GROUP || CONNECTIONS_CONTROLS[CONTROL] !== undefined) {
        // Scenario u alone: clean under SEAM_ONLY, and under SEAM_CONTROL with the perturbations of the controls asked for, saying for each whether its own assertion saw it (`checkConnectionsAndHome`). It runs as a phase, so the requests that fail are held to the allow-list as in a full run.
        try {
          await phase(CONNECTIONS_GROUP, name, async () => checkConnectionsAndHome(browser, name, await connectionsFixture(), work));
        } catch (error) {
          console.error(String(error?.message ?? error));
          process.exitCode = 1;
        }

        continue;
      }

      // SEAM_TERMINAL_REPEAT=<n> runs scenarios r, r2, r3 and r4 alone, n times in a row, for a developer who works on the Terminal tool (each run starts several shells of this machine and ends them). SEAM_TERMINAL_ONLY=r3,r4 narrows it to the scenarios it names.
      if (process.env.SEAM_TERMINAL_REPEAT !== undefined) {
        const terminalOnly = (process.env.SEAM_TERMINAL_ONLY ?? 'r,r2,r3,r4').split(',');
        const unknown = terminalOnly.filter((id) => !['r', 'r2', 'r3', 'r4'].includes(id));
        if (unknown.length > 0) throw new Error(`SEAM_TERMINAL_ONLY names scenarios that are not terminal scenarios: ${unknown.join(', ')}`);
        const repeats = Number(process.env.SEAM_TERMINAL_REPEAT);
        if (!Number.isSafeInteger(repeats) || repeats < 1) {
          throw new Error(`SEAM_TERMINAL_REPEAT must be a positive whole number, it is ${JSON.stringify(process.env.SEAM_TERMINAL_REPEAT)}`);
        }

        for (let run = 0; run < repeats; run += 1) {
          if (terminalOnly.includes('r')) await phase('terminal', name, async () => onTerminalPage(browser, host.base, (page) => checkTerminal(page, host.base, name)));
          if (terminalOnly.includes('r2')) await phase('terminal-programs', name, async () => onTerminalPage(browser, host.base, (page) => checkTerminalPrograms(page, host.base, name)));
          if (terminalOnly.includes('r3')) await phase('terminal-reattach', name, async () => onTerminalPage(browser, host.base, (page) => checkTerminalReattach(page, host.base, name)));
          if (terminalOnly.includes('r4')) await phase('terminal-takeover', name, async () => checkTerminalTakeover(browser, () => host, restart, name, work));
          console.log(`terminal ${name} run ${String(run)} ok`);
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
      await phase('terminal', name, async () => onTerminalPage(browser, host.base, (page) => checkTerminal(page, host.base, name)));
      await phase('terminal-programs', name, async () => onTerminalPage(browser, host.base, (page) => checkTerminalPrograms(page, host.base, name)));
      await phase('terminal-reattach', name, async () => onTerminalPage(browser, host.base, (page) => checkTerminalReattach(page, host.base, name)));
      await phase('terminal-takeover', name, async () => checkTerminalTakeover(browser, () => host, restart, name, work));
      await phase('session', name, () => checkSession(browser, () => host, restart, name));
      await phase('process', name, async () => checkProcess(browser, name, await processFixture(), work));
      await phase('failed-load', name, async () => checkFailedLoad(browser, name, await processFixture(), work));
      await phase('plugins-page', name, async () => checkPluginsPage(browser, name, await processFixture(), work));
      await phase(CONNECTIONS_GROUP, name, async () => checkConnectionsAndHome(browser, name, await connectionsFixture(), work));
      console.log(`PASS ${name}: contribute (sidebar entry, page, no route), one React and one kit, the control fails, containment, refusal, named states, the rail, the empty window, the bottom panel, the command palette, a failed page command's toast, the notification centre (the history read at the bell, one presenter, restored after a reload), the session (reload, restart, a plugin that is gone, a session kept aside), a plugin whose process is killed (the window drops it, keeps its Logs session and loads it again when the host says it runs), a plugin whose load fails (the window says so, Retry asks the host and ends in what it says, bounded by the loader's timeout), the Plugins page (the list is the host's inventory; a reload, a disable and an enable, an enable that leaves a plugin on and not started, a process killed by its pid and an uninstall are each read from the host's events, in two windows, with no raw text of the host or of a plugin on screen), the connections (the chip's picker, Home and the palette start a connection and say how it went, a start the host refuses is said where it was chosen, a Logs session of the host's panel stays when the tab's connection changes)`);
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
