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
//      one of everything again with no reload (SEAM_SHOTS=<dir> writes WebKit's pictures of the four states). SEAM_CONTROL=failed-load runs p alone with every perturbation of its controls (FAILED_CONTROLS) made in turn just before the assertion each must trip; SEAM_CONTROL=<one of them>
//      makes that one only, and SEAM_REMOVE=<one of them> leaves that control's assertion out, which must let its perturbation pass undetected (the proof that each control trips its own assertion and no other)
//
//   q  the notification centre (O1b-2): the history a failed page command leaves, read from the bell, over the real host. A failure whose toast the person DISMISSES is read (the model: S81): the bell has no dot (its name is
//      exactly `Notifications`), the centre opened from the bell lists the record, read, the focus is on its row's title, and Escape closes it and gives the focus back to the bell. A failure whose toast is NOT dismissed is an
//      unread record (`Notifications, 1 unread, 1 error`); opening the centre takes the toast out of the layer (one presenter: the stack waits while the centre is open) and a failure that arrives while it is open is in the
//      list with no toast; closing it with Escape after more than 1 s reads what it listed (the bell is `Notifications` again, no toast comes back, the focus is on the bell). After a RELOAD, once the window service holds the
//      history (the first time the history is read from it), the window restores it: the bell has no dot, the restored records raised no toast and no announcement, and a restored record's Retry is not offered: its row says
//      `Retry is unavailable. Not available after restart.`
//
//   r  the Terminal tool on the host's own shell (T1), over the real host. Before the first terminal the emulator's code is not requested (no request for its chunk while the panel is open and says `No terminals`); `New terminal` starts a
//      shell of this machine (the host lists exactly one session), the code is fetched then, the emulator takes the keyboard (the person who pressed the button types) and a command with a known output is run: what the shell printed,
//      read from the host's own replay of the session (`AttachSession`: the GPU draws on a canvas, there is no text in the page), holds the output line of `echo SEAM_$((6*7))` and not only its echo. `stty size` says the rows and
//      columns the page measured (the rows exactly, the columns within a cell), and again, with other numbers, after the panel is raised with the End key on its handle: the resize reached the process. A keyboard user can always leave:
//      Escape stays in the shell, F6 moves the focus out of it, and on a Mac Command J hides the panel and gives the focus back to the page. Closing the running terminal asks (`Terminate session?`, Cancel has the focus, Escape says no
//      and the host still lists the session), and Terminate session ends it: the host lists nothing, the tool says `No terminals` and the focus is on the tool's tab. A second terminal that runs `exit` is an ENDED session: its lane says
//      `Input is off. Its output stays readable here.`, the tab stays, closing it asks nothing, and the host has no session left. No request failed and no page error was raised.
//
//   The failed requests (INV1): every request any page of the run makes that answers 4xx or 5xx is recorded with the phase it happened in, and the phase fails unless each is in RUNTIME_ALLOW (an explicit list: the entry, its reason, the phases it
//   is expected in). SEAM_CONTROL=runtime-4xx plants one 422 in a clean page and passes when the phase's assertion saw it; SEAM_REMOVE=runtime-4xx leaves that assertion out, and the planted 422 must then pass undetected
//
//   Every scenario starts from a window with nothing saved: the host keeps ONE session for its main window, and a page that a scenario left behind would be restored by the next.
//
//   node ui-next/plugins/e2e/seam.check.mjs        needs bin/Omniview-server (OMNIVIEW_UI=next task build:server) and Playwright's browsers; ENGINES=webkit or ENGINES=chromium runs one engine
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { SHARED_SPECIFIERS_V1 } from '../loader/specifiers.ts';
import { buildProcess, writeAll, writePlugin } from '../fixture/build.mjs';

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
};
const RUNTIME_CONTROL = 'runtime-4xx';
/** The controls that belong to scenario m; every other one runs scenario k. */
const IDENTITY_CONTROLS = ['second-stream', 'scope-lone', 'scope-kept', 'same-name'];
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
};
const FAILED_GROUP = 'failed-load';
const CONTROL = process.env.SEAM_CONTROL ?? '';
const REMOVE = process.env.SEAM_REMOVE ?? '';
if (CONTROL !== '' && CONTROL !== 'process' && CONTROL !== FAILED_GROUP && CONTROLS[CONTROL] === undefined && PROCESS_CONTROLS[CONTROL] === undefined && FAILED_CONTROLS[CONTROL] === undefined) {
  throw new Error(`SEAM_CONTROL must be one of ${[...Object.keys(CONTROLS), 'process', ...Object.keys(PROCESS_CONTROLS), FAILED_GROUP, ...Object.keys(FAILED_CONTROLS)].join(', ')}`);
}
if (REMOVE !== '' && FAILED_CONTROLS[REMOVE] === undefined && PROCESS_CONTROLS[REMOVE] === undefined && REMOVE !== RUNTIME_CONTROL) {
  throw new Error(`SEAM_REMOVE must be one of ${[...Object.keys(PROCESS_CONTROLS), ...Object.keys(FAILED_CONTROLS), RUNTIME_CONTROL].join(', ')}`);
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
    [`Command: Close tab, Tabs, ${mac ? '⌃⌥W' : 'Ctrl+Alt+W'}`, `Command: Toggle panel, Panel, ${mac ? '⌃⌥J' : 'Ctrl+Alt+J'}`, 'Command: Next tab, Tabs', 'Command: Previous tab, Tabs'],
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
 * everything again, with no reload. Every negative control of this scenario is made here, in turn, when SEAM_CONTROL asks (`withControls`; FAILED_CONTROLS).
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

/** Types a line into the terminal the page has the keyboard in, and presses Enter. */
async function typeLine(page, text) {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
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

async function checkTerminal(page, base, engine) {
  const errors = [];
  const chunks = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('request', (request) => {
    if (/xtermEngine/.test(request.url())) chunks.push(request.url());
  });
  await open(page, base);
  await page.getByRole('region', { name: 'Plugins you can open' }).waitFor({ timeout: 30_000 });
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));

  // The panel opens on the Terminal tool, which has no session: its words, and not one byte of the emulator.
  await page.locator('[data-shell-part="panelToggle"]').click();
  await page.getByRole('tab', { name: 'Terminal', selected: true }).waitFor({ timeout: 10_000 });
  await page.getByText('No terminals', { exact: true }).waitFor();
  assert.deepEqual(await terminalIds(base), [], `${engine}: no shell exists before New terminal`);
  assert.deepEqual(chunks, [], `${engine}: the emulator's code was not requested before the first terminal`);

  // One press: one shell, the code is fetched, and the emulator has the keyboard.
  await page.locator('[data-shell-part="panelEmpty"]').getByRole('button', { name: 'New terminal', exact: true }).click();
  await page.locator('.xterm-helper-textarea').waitFor({ timeout: 30_000 });
  await waitUntil('the host to list the shell', async () => (await terminalIds(base)).length === 1, 15_000);
  const [id] = await terminalIds(base);
  assert.ok(chunks.length >= 1, `${engine}: the emulator's code was requested when the terminal was shown`);
  await waitUntil('the emulator to have the keyboard', () => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false), 10_000);
  assert.equal(await page.locator('.xterm-helper-textarea').getAttribute('aria-label'), 'Terminal input, Terminal', `${engine}: the input is named for a person who cannot see the screen`);
  await waitUntil('the shell to say its prompt', async () => (await transcriptOf(base, id)).trim() !== '', 20_000);

  // A command with a known output: the output line, not only the echo of what was typed.
  await typeLine(page, 'echo SEAM_$((6*7))');
  await waitUntil('the output of the command', async () => /\r?\nSEAM_42\r?\n/.test(await transcriptOf(base, id)), 15_000);

  // The resize reached the process: the rows the page drew are the rows the pty has, and the columns are the width in cells.
  await typeLine(page, 'stty size');
  await waitUntil('stty size to answer', async () => sttyOf(await transcriptOf(base, id)) !== null, 15_000);
  const before = await screenSizeOf(page);
  const first = sttyOf(await transcriptOf(base, id));
  assert.equal(first.rows, before.rows, `${engine}: the pty has the rows the page drew (${String(before.rows)}), it said ${String(first.rows)}`);
  assert.ok(first.cols >= Math.floor(before.width / 7.3) && first.cols <= Math.ceil(before.width / 6.9), `${engine}: the pty has the width of the screen in cells (${String(Math.round(before.width))} px), it said ${String(first.cols)}`);

  await page.locator('[data-shell-part="panelHandle"]').focus();
  await page.keyboard.press('End');
  await waitUntil('the screen to grow', async () => ((await screenSizeOf(page))?.height ?? 0) > before.height + 40, 10_000);
  await page.waitForTimeout(600);
  // The emulator had the keyboard and the handle took it: the person goes back to the terminal with the pointer.
  await page.locator('.xterm-screen').click();
  await typeLine(page, 'stty size');
  await waitUntil('stty size to answer again', async () => {
    const size = sttyOf(await transcriptOf(base, id));
    return size !== null && size.rows !== first.rows;
  }, 15_000);
  const after = await screenSizeOf(page);
  const second = sttyOf(await transcriptOf(base, id));
  assert.ok(after.rows > before.rows, `${engine}: the panel is taller, so the screen has more rows`);
  assert.equal(second.rows, after.rows, `${engine}: after the panel was raised the pty has the new rows (${String(after.rows)}), it said ${String(second.rows)}`);

  // A keyboard user can always leave (A14): Escape stays in the shell, F6 leaves, and on a Mac Command J hides the panel.
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false), `${engine}: Escape does not leave the terminal`);
  await page.keyboard.press('F6');
  assert.ok(await page.evaluate(() => !(document.activeElement?.closest('.xterm') ?? null)), `${engine}: F6 moves the focus out of the terminal`);
  await page.locator('.xterm-screen').click();
  if (mac) {
    await page.keyboard.press('Meta+j');
    await waitUntil('the panel to hide', () => page.evaluate(() => document.querySelector('[data-shell-part="panel"]') === null || getComputedStyle(document.querySelector('[data-shell-part="panel"]')).display === 'none' || document.querySelector('[data-shell-part="panel"]').getBoundingClientRect().height === 0), 5_000);
    assert.ok(await page.evaluate(() => !(document.activeElement?.closest('.xterm') ?? null)), `${engine}: Command J gives the focus back to the page`);
    await page.keyboard.press('Meta+j');
    await page.locator('.xterm-screen').waitFor({ state: 'visible' });
  }

  // Closing a running terminal asks. Cancel has the focus; Escape says no and the host still lists the shell.
  await page.locator('[data-shell-part="sessionClose"]').first().click();
  const dialog = page.getByRole('alertdialog', { name: 'Terminate session?' });
  await dialog.waitFor();
  assert.ok(await page.evaluate(() => document.activeElement?.textContent === 'Cancel'), `${engine}: Cancel has the focus in the question`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(await terminalIds(base), [id], `${engine}: the shell is still there after a no`);
  // Terminate session ends it: the host lists nothing, the tool says so, and the focus is on the tool's own tab.
  await page.locator('[data-shell-part="sessionClose"]').first().click();
  await dialog.waitFor();
  await page.getByRole('button', { name: 'Terminate session', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await waitUntil('the host to list no shell', async () => (await terminalIds(base)).length === 0, 10_000);
  await page.getByText('No terminals', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement.textContent?.includes('Terminal')), `${engine}: the focus is on the tool's tab after the last terminal closed`);

  // A shell that exits is an ended session: kept, with its words, and closing it asks nothing.
  await page.locator('[data-shell-part="panelEmpty"]').getByRole('button', { name: 'New terminal', exact: true }).click();
  await page.locator('.xterm-helper-textarea').waitFor({ timeout: 30_000 });
  await waitUntil('the host to list the second shell', async () => (await terminalIds(base)).length === 1, 15_000);
  const [second_id] = await terminalIds(base);
  await waitUntil('the second shell to say its prompt', async () => (await transcriptOf(base, second_id)).trim() !== '', 20_000);
  await typeLine(page, 'exit');
  await page.getByText('Input is off. Its output stays readable here.', { exact: true }).waitFor({ timeout: 15_000 });
  assert.equal(await page.locator('[role="tab"][aria-selected="true"][aria-label^="Terminal"]').count(), 1, `${engine}: the ended session's tab stays`);
  await waitUntil('the host to have no session left', async () => (await terminalIds(base)).length === 0, 10_000);
  await page.locator('[data-shell-part="sessionClose"]').first().click();
  assert.equal(await page.getByRole('alertdialog').count(), 0, `${engine}: closing an ended terminal asks nothing`);
  await page.getByText('No terminals', { exact: true }).waitFor();

  assert.deepEqual(errors, [], `${engine}: the page raised no error`);
}

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

      // SEAM_TERMINAL_REPEAT=<n> runs scenario r alone, n times in a row, for a developer who works on the Terminal tool (each run starts two shells of this machine and ends them).
      if (process.env.SEAM_TERMINAL_REPEAT !== undefined) {
        for (let run = 0; run < Number(process.env.SEAM_TERMINAL_REPEAT); run += 1) {
          await phase('terminal', name, async () => checkTerminal(await freshPage(browser, host.base), host.base, name));
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
      await phase('terminal', name, async () => checkTerminal(await freshPage(browser, host.base), host.base, name));
      await phase('session', name, () => checkSession(browser, () => host, restart, name));
      await phase('process', name, async () => checkProcess(browser, name, await processFixture(), work));
      await phase('failed-load', name, async () => checkFailedLoad(browser, name, await processFixture(), work));
      console.log(`PASS ${name}: contribute (sidebar entry, page, no route), one React and one kit, the control fails, containment, refusal, named states, the rail, the empty window, the bottom panel, the command palette, a failed page command's toast, the notification centre (the history read at the bell, one presenter, restored after a reload), the session (reload, restart, a plugin that is gone, a session kept aside), a plugin whose process is killed (the window drops it, keeps its Logs session and loads it again when the host says it runs), a plugin whose load fails (the window says so, Retry asks the host and ends in what it says, bounded by the loader's timeout)`);
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
