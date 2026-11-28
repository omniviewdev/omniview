// Probes the Terminal tool in WebKit and Chromium (docs/ui-next/status/T1.md, and T2a for what the host's own shell states): the real host's window with NO plugin and a SYNTHETIC shell behind the real exec feed (terminal-fixture.tsx, which
// invents only the far end: the host's exec bindings, with its credit flow control, its typed end, its busy fact and its typed refusals), in a production build of the fixture (the measurements) and a development build (React's Profiler counts commits there). The emulator is the product's own, in its lazy chunk.
//
//   node ui-next/shell/probes/terminal-probe.mjs      builds the fixture twice (OMNIVIEW_UI=next, once for the processes of a shard that share BUILD_CACHE), serves it, probes it in WebKit and Chromium at 1440 x 900 and 1280 x 800
//
//   FIXTURE_DIST=<dir> FIXTURE_DIST_DEV=<dir>   probe existing builds      ENGINES=webkit,chromium      VIEWPORTS=1440x900,1280x800      SECTIONS=geometry,keys      REPORT=<file>   the report as JSON
//   PART=view|data|reattach-a|reattach-b|reattach-c|reattach-d|reattach-e|reattach-f   run the sections of one part (the unit of CI that runs this script is PART=view, and terminal-data-probe.mjs and the six terminal-reattach*-probe.mjs, the others, are PART=data and the six of the reattach sections): every section is in one part and only one, and the probe refuses to start when it is not
//   NEGATIVE_CONTROL=<name>   perturb the page so ONE assertion must fail, in the section it belongs to; "detected" and exit 0 when only that assertion failed, "NOT DETECTED" or "failed another assertion" and exit 1 when not
//   ASSERTION_OFF=<regex>     drops the failures whose name matches, as if the assertion were not there: the control of it must then print NOT DETECTED (the proof that it trips that assertion and no other)
//   SCREEN_READER=on          turn the Terminal's screen reader mode on right after each terminal starts, through its palette command and by the keyboard as a person does, so that a section measures a terminal with the mode on:
//                             `SECTIONS=flood,hidden,idle,commits SCREEN_READER=on` is what the mode costs (docs/ui-next/status/T1.md section 16). Every other section is written for the mode off.
//   CPU_SLOWDOWN=<n>          Chromium, section `hidden` only, for a PROOF and never for CI (no unit sets it): the page's main thread runs n times slower (`Emulation.setCPUThrottlingRate`), so that a laptop reads what a shared runner reads and a
//                             bound can be shown to have room: `CPU_SLOWDOWN=3.5 NEGATIVE_CONTROL=draw-hidden` (docs/ui-next/status/PT2/red-terminal.txt). The section's notes say when it is on.
//
// T3a (terminal-find.mjs, which has its own header): PART=find-a|find-b|find-c|find-d run the sections of find in the scrollback (find-open, find-count, find-keys, find-lazy, find-replay, find-idle, find-cap, find-axe), the context
// menu (menu-open, menu-mouse, menu-axe) and the links in the output (links-tooltip, links-activate, links-axe); find-idle needs the development build, and every section waits for a state and never for a time.
// Sections and their assertions (the name starts each line of a failure). PART=view: geometry, words, title, ended, start, keys, close, resize, size, bundle, paint, axe, screenreader, screenreader-cost. PART=data: hidden, idle, commits, flood, latency, memory, order. PART=reattach-a to f (the terminal channel's capability and stream, terminal-reattach.mjs and terminal-reattach-followups.mjs, which have their own headers: a terminal survives a reload of the page, against the probe's own host, terminal-host.mjs): reattach-slot, reattach-restore, reattach-exact; reattach-muted, reattach-modes, reattach-size; reattach-detached, reattach-lease, reattach-restart, reattach-tombstone, reattach-leave, reattach-axe; restore-open; reattach-takeback, reattach-takeback-guard, reattach-takeback-offline; reattach-reconnect, reattach-reconnect-gap, reattach-gone, reattach-reconnect-keys, reattach-reconnect-acks.
//   geometry   (both viewports, both engines)  geometry.body / tools / button / screen / lane / rows / colors: the rectangles, sizes and colours of the mock's terminal body (mock-terminal.json: the mock measured in each engine at each
//              viewport)
//   words      the empty state and its layout at normal and minimum panel height, the toolbar and its names, the input's name and hint, the lane for a running, ended and failed session, the exit line written into the transcript
//   title      the session's tab is called by the shell the host says it started, zsh and bash, and not Terminal; the tool's tab and the emulator's input (title.shell)
//   ended      how a process ended, from the host's typed CLOSE: the lane's words and note, the last muted line of the transcript and the tab's state, for an exit with its code and a program that kept the terminal open (ended.code), a signal and a core dump
//              (ended.signal), the host closing it (ended.closed)
//   start      a start the host refuses: no shell could be started, from the error's code, the lane and the two transcript lines, every path the host tried on the screen (start.unavailable); any other refusal (start.failed)
//   keys       A14, never trap: Escape and Tab stay in the shell (keys.escape, keys.tab), F6 leaves (keys.f6), Ctrl+C is the interrupt (keys.interrupt), copy and paste chords (keys.copy, keys.paste)
//   close      the question a close of a running terminal asks, when the host says something runs and not otherwise: a program named in a modal whose Cancel has the focus (close.modal, close.cancel, close.words, close.busy), Escape and Cancel say no (close.no),
//              Terminate session ends the process and the focus goes to the tool's tab (close.yes); a shell at its prompt asks nothing and the tab goes at once (close.idle); a host that cannot say (close.unknown) or never answers (close.hang) gets the general question;
//              after a no (Escape, Cancel, a press on the scrim) the focus is on the session's own tab, never on the pointer-only close button, whether the close was pressed with the mouse or asked for with Delete on the tab, and axe finds nothing there;
//              each of the six paths must be asked and answered: a question that does not come, or does not go, fails it (close.focus)
//   resize     the first size at once (resize.first), a drag of the splitter is one message after it settles (resize.messages) and it is the size the screen has (resize.last)
//   size       the process starts at the size the person sees and nothing is resized after it started, in both viewports and both engines, until the panel is resized: the log holds no resize after the create call, not at the start and not after the panel
//              was hidden and shown (resize.none); the size the shell reports is the emulator's cells and the size the GPU renderer's measure gives (resize.cells)
//   order      the input goes to the host as frames of one stream (docs/ui-next/terminal-channel-protocol.md section 4): one stream carries the terminal, with keys and a size (order.stream), what is typed comes out in the order it was typed
//              with a size between the keys and each frame taking another time to arrive: by the host's own records every frame was applied, in the order it was sent, and the shell's size is the emulator's (order.echo), and a frame is
//              sent at once, while the one before it has not been applied (order.nowait)
//   bundle     the emulator costs nothing until the first terminal: not in the entry chunk or the entry stylesheet (bundle.entry), not requested before (bundle.lazy), requested after (bundle.fetched)
//   hidden     a hidden terminal goes on reading, parsing and acknowledging, so that its shell is never stalled by the view, and draws nothing of the page's (docs/ui-next/status/T1-go.md 2.8.6, docs/ui-next/status/T2a.md): the first acknowledgement is
//              made with the process (flow.on); the shell writes 2 MB and then 20 MB while the panel is hidden, and every byte is delivered, parsed and acknowledged (flow.hidden), the emulator is given every byte in order (hidden.drain), no
//              byte is acknowledged before it was parsed (flow.paced), in a number of frames that follows from the bytes (hidden.frames) and in callbacks of bounded number, total time and length, and in no task that is long (hidden.work; the browser counts long tasks in Chromium alone); the page's own document is not
//              touched and xterm's own changes are bounded (hidden.draws); once everything was taken in it is at rest: no frame, no timer, no change of the document (hidden.rest)
//   idle       an idle terminal runs no timer and asks for no frame (idle.timers), and renders nothing (idle.commits, development build)
//   commits    no React commit for an output chunk (commits.chunk, development build)
//   flood      16 MB in 16,000 events: every byte parsed (flood.complete), the credit exact: every byte acknowledged once and the host never over its mark (flow.exact), frames at 60 Hz or near, in a sample of the frames from the command on (none thrown away, and no fewer than the bytes need: flood.frames), no long task (flood.longtask, Chromium)
//   latency    a key reaches the process in a frame, idle (latency.idle) and under a flood (latency.flood; latency.premise: the flood was still running)
//   memory     1,000,000 lines of 80 columns, taken in whole before anything is measured (memory.drained: the host's flood is over and nothing waits in its pty, and delivered, given to the emulator, parsed and acknowledged are the same number): the oldest line the emulator keeps is the one the 5,000-line cap leaves (memory.cap), and the Chromium JS heap grows no more than 60 MB (memory.heap)
//   paint      what is PAINTED, read from the pixels of a screenshot: no frame around the screen while the emulator has the keyboard, its caret is the focus indicator (paint.ring, paint.caret); no scrollbar at rest or over a screen that
//              does not scroll (scrollbar.rest), a thin one while scrolling (scrollbar.thin) that goes away again once the wheel stops and the pointer leaves (scrollbar.hides)
//   axe        axe-core: no violation for the running terminal, the empty tool, the ended terminal, the question and the terminal whose shell could not be started (axe.unavailable)
//   screenreader       the Terminal's screen reader mode (docs/ui-next/status/T1.md section 16), in the DOM renderer, where the printed lines are in the page and are hidden from the accessibility tree until the mode is on: turned on and off
//              through the palette command by the keyboard alone, the screen's accessibility snapshot holds a known line, and a later one, while it is on (screenreader.tree) and holds neither before it was turned on and after it was
//              turned off (screenreader.tree-off); the input's name starts with Terminal and the words it is described by say what the mode is and how to change it, in both states (screenreader.words); the result is announced once
//              for each change through the window's polite live region, when no modal dialog owns the window (screenreader.announce); axe finds nothing in the running terminal with the mode on and with it off (screenreader.axe)
//   screenreader-cost  the mode on costs nothing at rest: an idle terminal runs no timer and asks for no frame (screenreader.idle), and a hidden panel with the mode on takes in what the shell writes, has no accessibility layer while it is hidden,
//              touches nothing of the page's and is at rest once it has (screenreader.hidden)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedBuild } from '../../../packages/kit/probes/build-cache.mjs';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { serve } from '../../../packages/kit/probes/serve.mjs';
import { AXE } from './harness.mjs';
import { createFindSections, FIND_CONTROLS, FIND_PARTS } from './terminal-find.mjs';
import { createGutterSections, GUTTER_CONTROLS, GUTTER_PARTS } from './terminal-gutter.mjs';
import { createReattachSections, REATTACH_CONTROLS, REATTACH_PARTS } from './terminal-reattach.mjs';
import { APPLY_CONTROLS, APPLY_PARTS, createApplySections } from './terminal-apply.mjs';
import { createSettingsSections, SETTINGS_CONTROLS, SETTINGS_PARTS } from './terminal-settings.mjs';
import { createPanesSections, PANES_CONTROLS, PANES_PARTS } from './terminal-panes.mjs';
import { createWhereSections, WHERE_CONTROLS, WHERE_PARTS } from './terminal-where.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const REF = JSON.parse(readFileSync(path.join(here, 'mock-terminal.json'), 'utf8'));
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const VIEWPORTS = Object.fromEntries((process.env.VIEWPORTS ?? '1440x900,1280x800').split(',').map((vp) => [vp, { width: Number(vp.split('x')[0]), height: Number(vp.split('x')[1]) }]));
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
const OFF = process.env.ASSERTION_OFF === undefined ? undefined : new RegExp(process.env.ASSERTION_OFF);
/** The part of the probe to run: the sections of `view` or of `data` (the two units of CI), or all of them. */
const PART = process.env.PART ?? '';
/** The screen reader mode on after each terminal starts, for the sections that measure what it costs (`SCREEN_READER=on`), and the words the notes say it with. */
const READER = process.env.SCREEN_READER ?? '';
if (READER !== '' && READER !== 'on') throw new Error(`SCREEN_READER must be on or not set, it is ${JSON.stringify(READER)}`);
const MODE = READER === 'on' ? ' [screen reader mode on]' : '';
/** The main thread slowed this many times in the section `hidden` of Chromium (`CPU_SLOWDOWN=<n>`): a proof that a bound has room on a slower machine, set by no unit of CI. 1 is no slowdown. */
const SLOWDOWN = process.env.CPU_SLOWDOWN === undefined || process.env.CPU_SLOWDOWN === '' ? 1 : Number(process.env.CPU_SLOWDOWN);
if (!Number.isFinite(SLOWDOWN) || SLOWDOWN < 1) throw new Error(`CPU_SLOWDOWN must be a number of 1 or more, or not set, it is ${JSON.stringify(process.env.CPU_SLOWDOWN)}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The negative controls: the assertion each must trip (and no other), the section it belongs to, and how the page is perturbed. `query` perturbs the fixture; `init` runs before the page's own scripts; `after` after the terminal is up.
 * A control of the screen reader sections says where its `after` runs in the section (`stage`): `start` (the terminal is up and the mode is still off), `idle` (an idle terminal with the mode on, after its first second) or
 * `hidden` (the panel is hidden with the mode on). What those perturb is the page's, not the engine's, so they run in Chromium alone. The `close` section (`hang`: the page whose host never answers) and the `axe` section (`unavailable`: the page whose shell
 * could not be started) have several pages, and a control of theirs names the one it perturbs in the same way.
 */
const CONTROLS = {
  'lane-border': { assertion: 'geometry.lane', section: 'geometry', after: (page) => page.addStyleTag({ content: '[data-shell-part="terminalLane"]{border-block-start-color:rgb(255, 0, 0) !important}' }) },
  'button-size': { assertion: 'geometry.button', section: 'geometry', after: (page) => page.addStyleTag({ content: '[data-terminal-tool]{inline-size:32px !important;block-size:32px !important}' }) },
  'ring-back': { assertion: 'paint.ring', section: 'paint', after: (page) => page.addStyleTag({ content: '[data-shell-part="terminalScreen"]:focus-within{outline:2px solid rgb(56, 113, 225) !important;outline-offset:-2px !important}' }) },
  'scrollbar-block': { assertion: 'scrollbar.rest', section: 'paint', after: (page) => page.addStyleTag({ content: '[data-shell-part="terminalScreen"]:not([data-scrollable]) .xterm-scrollable-element > .scrollbar.vertical{display:block !important;opacity:1 !important}' }) },
  // A scrollbar that stays once there is scrollback: it is forced only after the screen has something to scroll to, so the screen that does not scroll still passes `scrollbar.rest` and the thumb still passes `scrollbar.thin`.
  'scrollbar-stuck': { assertion: 'scrollbar.hides', section: 'paint', after: (page) => page.addStyleTag({ content: '[data-shell-part="terminalScreen"][data-scrollable] .xterm-scrollable-element > .scrollbar.vertical{opacity:1 !important;transition:none !important}' }) },
  'f6-trap': { assertion: 'keys.f6', section: 'keys', init: () => document.addEventListener('keydown', (event) => { if (event.key === 'F6') { event.stopImmediatePropagation(); } }, true) },
  'escape-leaves': { assertion: 'keys.escape', section: 'keys', init: () => document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { document.activeElement?.blur(); } }, true) },
  // A dialog that is open and not modal (what `show()` makes): Escape still says no (the browser's own cancel is told by hand), so only the modal assertion can see it.
  'modal-off': { assertion: 'close.modal', section: 'close', init: () => { HTMLDialogElement.prototype.showModal = function showModal() { this.show(); this.addEventListener('keydown', (event) => { if (event.key === 'Escape') this.dispatchEvent(new Event('cancel', { cancelable: true })); }); }; } },
  'resize-chatty': { assertion: 'resize.messages', section: 'resize', init: () => { const original = window.setTimeout.bind(window); window.setTimeout = (fn, ms, ...rest) => original(fn, ms === 100 ? 0 : ms, ...rest); } },
  // A hidden panel that asks for frames it has no use for: six loops of animation frames, for as long as the shell's output is being taken in (`stage: flood`, which is the 2 MB and then the 20 MB written while the panel is hidden).
  'hidden-frames': { assertion: 'hidden.frames', section: 'hidden', engines: ['chromium'], stage: 'flood', after: (page) => page.evaluate(() => { for (let n = 0; n < 6; n += 1) { const tick = () => { if (window.__phase === 'flood') requestAnimationFrame(tick); }; tick(); } }) },
  // One callback of the page that holds the main thread for 150 ms while the shell's output is being taken in: the longest callback (90 ms at most), which the count of callbacks and the frames never see. It is under the bound of a long task (250 ms): `hidden-long-task` is the one that is over it.
  'hidden-burn': { assertion: 'hidden.work', section: 'hidden', engines: ['chromium'], stage: 'flood', after: (page) => page.evaluate(() => { if (window.__burnInstalled) return; window.__burnInstalled = true; const original = window.setTimeout; window.setTimeout = (fn, ms, ...rest) => original(typeof fn === 'function' ? (...inner) => { if (!window.__burned && window.__phase === 'flood') { window.__burned = true; const until = performance.now() + 150; while (performance.now() < until); } return fn(...inner); } : fn, ms, ...rest); }) },
  // One task of the page that holds the main thread for 400 ms while the shell's output is being taken in, and that no callback shows: it runs as a microtask after the first timer callback of the flood has returned, so the time the callbacks add up
  // to and the longest of them do not see it, and only the browser's own count of long tasks (Chromium) does: 400 ms against the bound of 250.
  'hidden-long-task': { assertion: 'hidden.longtask', section: 'hidden', engines: ['chromium'], stage: 'flood', after: (page) => page.evaluate(() => { if (window.__stallInstalled) return; window.__stallInstalled = true; const original = window.setTimeout; window.setTimeout = (fn, ms, ...rest) => original(typeof fn === 'function' ? (...inner) => { const result = fn(...inner); if (!window.__stalled && window.__phase === 'flood') { window.__stalled = true; queueMicrotask(() => { const until = performance.now() + 400; while (performance.now() < until); }); } return result; } : fn, ms, ...rest); }) },
  // A hidden panel that is not at rest once everything was taken in: a frame loop and an interval that go on (`stage: rest`: the shell's output has all been taken in).
  'hidden-rest': { assertion: 'hidden.rest', section: 'hidden', engines: ['chromium'], stage: 'rest', after: (page) => page.evaluate(() => { const tick = () => { if (window.__phase === 'rest') requestAnimationFrame(tick); }; tick(); setInterval(() => undefined, 500); }) },
  // A page that draws what a hidden terminal is given: every event delivered changes an attribute of the document, outside the emulator's own element.
  'draw-hidden': { assertion: 'hidden.draws', section: 'hidden', engines: ['chromium'], query: 'control=draw-hidden' },
  'idle-timer': { assertion: 'idle.timers', section: 'idle', after: (page) => page.evaluate(() => { setInterval(() => undefined, 500); }) },
  'chunk-commit': { assertion: 'commits.chunk', section: 'commits', query: 'control=chunk-commit' },
  // Every frame is asked for 45 ms late (a page whose frames come at about a quarter of the rate, with nothing blocked): p95 of the frame times is about 55 ms, over the 34 ms bound with room; no task is a long one and the drain (a share of 512 KiB a frame) keeps up with the shell, so only the frame assertion can see it.
  // `engines`: where the control runs. Frames that come late make the next frame's batch bigger, so in Chromium, which reports long tasks, it also trips the long task assertion: it runs in WebKit, which does not.
  'flood-janky': { assertion: 'flood.frames', section: 'flood', engines: ['webkit'], init: () => { const original = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (callback) => { window.setTimeout(() => { original(callback); }, 45); return 0; }; } },
  // The sample of frames the flood assertion reads stops before the flood starts: a sample with no frames proves nothing, and does not pass.
  'flood-no-sample': { assertion: 'flood.frames', section: 'flood', engines: ['chromium'], stage: 'sample', after: (page) => page.evaluate(() => { window.__framesOn = false; }) },
  'echo-slow': { assertion: 'latency.idle', section: 'latency', query: 'control=echo-slow' },
  'lazy-load': { assertion: 'bundle.lazy', section: 'bundle', after: (page, origin) => page.evaluate(async (url) => { const chunk = [...document.querySelectorAll('script')].length; await import(url).catch(() => undefined); return chunk; }, origin) },
  'big-scrollback': { assertion: 'memory.cap', section: 'memory', query: 'control=big-scrollback' },
  'leaky-heap': { assertion: 'memory.heap', section: 'memory', engines: ['chromium'], query: 'control=leaky-heap' },
  // The memory is measured of a terminal that did not take the flood in: the page acknowledges every byte twice, so what it acknowledged is not what it was given (the cap and the heap are right).
  'memory-undrained': { assertion: 'memory.drained', section: 'memory', engines: ['chromium'], query: 'control=ack-double' },
  // The screen reader switch (docs/ui-next/status/T1.md section 16). An emulator that is never put in the mode the window says it is in (the lines are not in the accessibility tree while the store, the description and the announcement all
  // say they are), and one that is put in it and never taken out.
  'reader-claims': { assertion: 'screenreader.tree', section: 'screenreader', engines: ['chromium'], query: 'control=reader-claims' },
  'reader-stuck': { assertion: 'screenreader.tree-off', section: 'screenreader', engines: ['chromium'], query: 'control=reader-stuck' },
  // The words that were true while the mode was off, kept: the input is described by a copy of them taken before the mode was turned on, so it never says that the mode is on.
  'reader-words-stale': { assertion: 'screenreader.words', section: 'screenreader', engines: ['chromium'], stage: 'start', after: (page) => page.evaluate(() => { const input = document.querySelector('.xterm-helper-textarea'); const real = document.getElementById(input.getAttribute('aria-describedby')); const frozen = real.cloneNode(true); frozen.id = 'frozen-description'; real.after(frozen); input.setAttribute('aria-describedby', 'frozen-description'); }) },
  // Every announcement made twice: a node with the same words is added to the live region right after each one.
  'reader-announce-twice': { assertion: 'screenreader.announce', section: 'screenreader', engines: ['chromium'], stage: 'start', after: (page) => page.evaluate(() => { const live = document.querySelector('[data-notices-part="live"]'); new MutationObserver((list) => { for (const record of list) for (const node of record.addedNodes) if (node.dataset?.again === undefined && (node.textContent ?? '') !== '') { const again = document.createElement('span'); again.dataset.again = ''; again.textContent = node.textContent; live.append(again); } }).observe(live, { childList: true }); }) },
  // A violation that exists only while the mode is on: an image with no text alternative, added to the emulator's accessibility layer the moment the layer is made (it is removed with the mode).
  'reader-axe': { assertion: 'screenreader.axe', section: 'screenreader', engines: ['chromium'], stage: 'start', after: (page) => page.evaluate(() => { new MutationObserver((list) => { for (const record of list) for (const node of record.addedNodes) if (node.classList?.contains('xterm-accessibility')) { const image = document.createElement('img'); image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; node.append(image); } }).observe(document.querySelector('.xterm'), { childList: true }); }) },
  // The work a hidden panel and an idle terminal must not do, with the mode on: a frame loop that runs while the panel is hidden, and an interval started once the terminal is idle.
  'reader-hidden-frames': { assertion: 'screenreader.hidden', section: 'screenreader-cost', engines: ['chromium'], stage: 'rest', after: (page) => page.evaluate(() => { const tick = () => { if (window.__phase === 'rest') requestAnimationFrame(tick); }; tick(); }) },
  'reader-idle-timer': { assertion: 'screenreader.idle', section: 'screenreader-cost', engines: ['chromium'], stage: 'idle', after: (page) => page.evaluate(() => { window.__idleTimer = setInterval(() => undefined, 500); }) },
  // What the host says (docs/ui-next/status/T1-go.md): its credit flow control (2.8.6), the shell it started (2.1), how a process ended (2.2), what runs in it (2.3) and why a start was refused (2.5). Each perturbs the far end of the fixture in ONE way
  // (`?control=`, terminal-fixture.tsx), or the page once, and runs in Chromium alone: what it proves does not depend on the engine.
  // The create call answers after the shell's first output was delivered, so the page's first acknowledgement comes late, with something owed.
  'flow-late': { assertion: 'flow.on', section: 'hidden', engines: ['chromium'], query: 'control=flow-late' },
  // The page's acknowledgements are replaced by one for each event, made when it is delivered and not when it is parsed: a page that credits what it merely holds, so that the host never slows a shell the page cannot keep up with.
  'ack-on-receipt': { assertion: 'flow.paced', section: 'hidden', engines: ['chromium'], query: 'control=ack-on-receipt' },
  // The credit that comes while the host is paused is lost: a host that paused never reads again, and a hidden flood never gets to its end.
  'ack-lost': { assertion: 'flow.hidden', section: 'hidden', engines: ['chromium'], query: 'control=ack-lost' },
  // Two of the slices the page gives the emulator never reach it, and are acknowledged all the same: held output that is dropped. The fifth slice is given after the sixth: held output that is out of order.
  'drop-held': { assertion: 'hidden.drain', section: 'hidden', engines: ['chromium'], query: 'control=drop-held' },
  'swap-held': { assertion: 'hidden.drain', section: 'hidden', engines: ['chromium'], query: 'control=swap-held' },
  // Every parsed write is acknowledged twice.
  'ack-double': { assertion: 'flow.exact', section: 'flood', engines: ['chromium'], query: 'control=ack-double' },
  // The process starts at the size the person sees (docs/ui-next/status/T2a.md): the renderer is said to be in place before it is and something measures the host again once it is, so that the log holds a resize after the create call; and a host that opens
  // the pty one column wider than it was asked to, so that the shell's size is not the emulator's.
  'early-size': { assertion: 'resize.none', section: 'size', engines: ['chromium'], query: 'control=early-size' },
  'size-off': { assertion: 'resize.cells', section: 'size', engines: ['chromium'], query: 'control=size-off' },
  // The input as frames of one stream (docs/ui-next/terminal-channel-protocol.md): a host that takes a size frame and keeps its size (a frame that was not applied is not a finished one: the shell's size is not the emulator's), and a page that sends what is typed one frame at a time, each after the one before was applied.
  'resize-dropped': { assertion: 'order.echo', section: 'order', engines: ['chromium'], query: 'control=resize-dropped' },
  // The GPU addon is made once for a terminal (#698 item 15): every WebGL context the page makes is lost 100 ms after it was made, so that the addon goes with it and the next showing makes another, as an engine that made one at every showing would.
  'webgl-every-show': {
    assertion: 'gpu.once',
    section: 'size',
    engines: ['chromium'],
    init: () => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        const context = getContext.call(this, kind, ...rest);
        if (context !== null && (kind === 'webgl' || kind === 'webgl2')) setTimeout(() => context.getExtension('WEBGL_lose_context')?.loseContext(), 100);
        return context;
      };
    },
  },
  'input-serial': { assertion: 'order.nowait', section: 'order', engines: ['chromium'], query: 'control=input-serial' },
  // After a no on the close question the focus goes where a keyboard is: something puts it on the pointer-only close button of the tab once the question is gone.
  'focus-close-button': { assertion: 'close.focus', section: 'close', engines: ['chromium'], stage: 'start', after: (page) => page.evaluate(() => { let asked = false; new MutationObserver(() => { const open = document.querySelector('dialog[role="alertdialog"]') !== null; if (open) asked = true; else if (asked) { asked = false; setTimeout(() => document.querySelector('[data-shell-part="sessionClose"]')?.focus(), 0); } }).observe(document.body, { childList: true, subtree: true }); }) },
  // The first Delete on the tab never reaches the tab, so that the question of that path is never asked: a path that is not asked is not let go on, and its keyboard is not looked at as if it had been.
  'focus-delete-swallowed': { assertion: 'close.focus', section: 'close', engines: ['chromium'], stage: 'start', after: (page) => page.evaluate(() => { let once = true; window.addEventListener('keydown', (event) => { if (once && event.key === 'Delete') { once = false; event.stopImmediatePropagation(); event.preventDefault(); } }, true); }) },
  // The create call does not name the shell it started: the tab stays Terminal.
  'no-shell-name': { assertion: 'title.shell', section: 'title', engines: ['chromium'], query: 'control=no-shell-name' },
  // The typed end of `exit` has no code, that of `kill` and `segv` no signal, that of `quit` no one who closed it.
  'exit-code-lost': { assertion: 'ended.code', section: 'ended', engines: ['chromium'], query: 'control=exit-code-lost' },
  'signal-lost': { assertion: 'ended.signal', section: 'ended', engines: ['chromium'], query: 'control=signal-lost' },
  'closed-lost': { assertion: 'ended.closed', section: 'ended', engines: ['chromium'], query: 'control=closed-lost' },
  // `IsBusy` says a program named sleep runs while the shell is at its prompt; it says one runs and does not name it; with `?busy=unknown` it says idle; and the page's wait of 1.5 s for an answer never ends (the timer is made a million milliseconds).
  'busy-always': { assertion: 'close.idle', section: 'close', engines: ['chromium'], query: 'control=busy-always' },
  'busy-nameless': { assertion: 'close.busy', section: 'close', engines: ['chromium'], query: 'control=busy-nameless' },
  'unknown-idle': { assertion: 'close.unknown', section: 'close', engines: ['chromium'], query: 'control=unknown-idle' },
  'ask-never': { assertion: 'close.hang', section: 'close', engines: ['chromium'], stage: 'hang', after: (page) => page.evaluate(() => { const original = window.setTimeout.bind(window); window.setTimeout = (fn, ms, ...rest) => original(fn, ms === 1500 ? 1_000_000 : ms, ...rest); }) },
  // The host's refusal to find a shell has its words and no code; its plain start failure carries the code of a missing shell.
  'code-less': { assertion: 'start.unavailable', section: 'start', engines: ['chromium'], query: 'control=code-less' },
  'start-typed': { assertion: 'start.failed', section: 'start', engines: ['chromium'], query: 'control=start-typed' },
  // A violation that exists only in the lane of a terminal that could not start: an image with no text alternative.
  'axe-failed': { assertion: 'axe.unavailable', section: 'axe', engines: ['chromium'], stage: 'unavailable', after: (page) => page.evaluate(() => { const image = document.createElement('img'); image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; document.querySelector('[data-shell-part="terminalLane"]').append(image); }) },
  // The reattach assertions (docs/ui-next/status/T2-go.md, T2b): a terminal survives a reload of the page. Their far end, their sections and their controls are in terminal-reattach.mjs.
  ...REATTACH_CONTROLS,
  // The T3a assertions: find in the scrollback, the context menu, the links in the output. Their sections, their parts and their controls are in terminal-find.mjs.
  ...FIND_CONTROLS,
  ...GUTTER_CONTROLS,
  ...WHERE_CONTROLS,
  ...SETTINGS_CONTROLS,
  ...PANES_CONTROLS,
  ...APPLY_CONTROLS,
};
if (CONTROL !== '' && CONTROL !== 'all' && CONTROLS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be all or one of ${Object.keys(CONTROLS).join(', ')}`);

// NEGATIVE_CONTROL=all runs every control twice, in a run of its own: with its assertion (it must be detected by that assertion and no other) and with the assertion removed (ASSERTION_OFF: it must pass undetected, the proof that
// the control trips that assertion and nothing else). The fixtures are built once.
if (CONTROL === 'all') {
  const production = build('production');
  const development = build('development');
  const me = fileURLToPath(import.meta.url);
  let wrong = 0;
  for (const [name, control] of Object.entries(CONTROLS)) {
    const run = (extra) => spawnSync(process.execPath, [me], { env: { ...process.env, FIXTURE_DIST: production, FIXTURE_DIST_DEV: development, NEGATIVE_CONTROL: name, ...extra }, encoding: 'utf8' });
    const withIt = run({});
    const without = run({ ASSERTION_OFF: `^${control.assertion.replaceAll('.', '\\.')}$` });
    const detected = withIt.status === 0 && /detected by/.test(withIt.stdout);
    const undetected = without.status === 1 && /NOT DETECTED/.test(without.stderr);
    if (!detected || !undetected) wrong += 1;
    console.log(`${name}: ${detected ? `detected by ${control.assertion}` : `NOT AS EXPECTED: ${(withIt.stdout + withIt.stderr).split('\n').filter((line) => /NEGATIVE/.test(line))[0] ?? 'no verdict'}`}; assertion removed: ${undetected ? 'passes undetected, as it must' : `NOT AS EXPECTED: ${(without.stdout + without.stderr).split('\n').filter((line) => /NEGATIVE/.test(line))[0] ?? 'no verdict'}`}`);
  }

  process.exit(wrong === 0 ? 0 : 1);
}

const failures = [];
const report = { notes: [], numbers: {} };
let checked = 0;
function check(name, ok, detail) {
  checked += 1;
  if (OFF !== undefined && OFF.test(name)) return;
  if (!ok) failures.push(`${name}: ${detail}`);
}
const note = (text) => {
  report.notes.push(text);
  console.log(text);
};
const near = (a, b, tolerance = 1) => typeof a === 'number' && Math.abs(a - b) <= tolerance;
const rectNear = (a, b, tolerance = 1) => Array.isArray(a) && a.every((value, index) => near(value, b[index], tolerance));
const percentile = (values, p) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
const round = (n) => Math.round(n * 100) / 100;

/** The host's own numbers for its flow control (docs/ui-next/terminal-channel-protocol.md section 7, `limits` of the answer to the create call): it holds at most `inflight` bytes sent and not acknowledged once the page's first acknowledgement has turned the window on, and cuts a frame to the credit that is left. `frame` and `hiddenFrame` are the shares of bytes a frame of the page takes at most while its screen is shown and while it is hidden (`FLOW.frame` and `FLOW.hiddenFrame` of screen.ts). */
const FLOW = Object.freeze({ inflight: 1_048_576, frame: 524_288, hiddenFrame: 262_144 });
/** The bytes of one event of a burst of the fixture (twelve lines of 80 columns and one of 40, the first line numbered): what the shell writes while the panel is hidden, 2,000 of them and then 20,000. */
const EVENT_BYTES = 1000;
const FLOODS = Object.freeze([
  { name: '2 MB', events: 2000 },
  { name: '20 MB', events: 20_000 },
]);

/**
 * Where the credit stands in the page and at the host: what the host delivered and what still waits in the pty, whether it is paused, what the page acknowledged and in how many calls, the most the host ever had delivered and not
 * acknowledged, how many floods ended (a flood ends when everything it wrote was delivered), and what the emulator was given and parsed. The page reads it itself (`window.__credit`, `COUNTERS`), so that it can be read in the same task as
 * something else.
 */
const credit = (page) => page.evaluate(() => window.__credit());

/**
 * Waits for the page to settle after something that moves a lot of bytes (a panel shown again, a flood): until `done` says so of what `credit` reads, or until nothing it reads has moved for `stall` ms (the page is stuck, or the host is: what it
 * reads then is the answer, and the assertion that reads it fails with its numbers), or until `limit` ms are over. The wait ends by what moves and not by a clock, so a slow machine is waited for and a fault is not waited for long.
 */
async function quiet(page, done, { stall = 2500, limit = 60_000 } = {}) {
  const started = Date.now();
  let last = await credit(page);
  let movedAt = Date.now();
  while (!done(last)) {
    await sleep(100);
    const now = await credit(page);
    if (JSON.stringify(now) !== JSON.stringify(last)) movedAt = Date.now();
    last = now;
    if (Date.now() - movedAt >= stall || Date.now() - started >= limit) break;
  }

  return last;
}

/**
 * Waits for what came before a flood to settle: until nothing `credit` reads has moved for `stall` ms. It has its own limit and says so when it ends by the limit: a page that is still moving then has nothing to count a burst from,
 * and what the assertions after it say would be about that and not about the burst.
 */
async function calm(page, { stall = 400, limit = 15_000 } = {}) {
  const started = Date.now();
  let last = await credit(page);
  let movedAt = Date.now();
  for (;;) {
    await sleep(100);
    const now = await credit(page);
    if (JSON.stringify(now) !== JSON.stringify(last)) movedAt = Date.now();
    last = now;
    if (Date.now() - movedAt >= stall) return { calm: true, waited: Date.now() - started, last };
    if (Date.now() - started >= limit) return { calm: false, waited: Date.now() - started, last };
  }
}

/**
 * Counts what a page asks of the main thread: timers and frames created and fired, only while `window.__count.on`, and the repeating intervals alive at any moment (`active`: an interval started before the count
 * began is still a timer that fires). Installed before the page's own scripts.
 */
const COUNTERS = () => {
  // The WebGL contexts the page asked for (the GPU addon's dispose() does not release its context in 0.19.0, and WebKit allows 16 live ones in a page): `gl.made` is every one made, `gl.live` is those not lost by the page.
  const gl = (window.__gl = { made: 0 });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const context = getContext.call(this, kind, ...rest);
    if (context !== null && (kind === 'webgl' || kind === 'webgl2')) gl.made += 1;
    return context;
  };
  const counts = (window.__count = { on: false, timeout: 0, interval: 0, raf: 0, fired: 0, frames: 0, busy: 0, longest: 0, active: 0, what: [] });
  const alive = new Set();
  const wrap = (name, key, repeats) => {
    const original = window[name].bind(window);
    window[name] = (callback, ...args) => {
      if (counts.on) counts[key] += 1;
      // While counting, the time each callback takes is kept (`busy` is their sum and `longest` the longest of them): the work a page does in the timers and frames it asked for.
      const run =
        typeof callback === 'function'
          ? (...inner) => {
              if (!counts.on) return callback(...inner);
              const started = performance.now();
              try {
                return callback(...inner);
              } finally {
                const took = performance.now() - started;
                counts.fired += 1;
                if (counts.what.length < 8) counts.what.push(`${key}: ${String(callback).replace(/\s+/g, ' ').slice(0, 140)}`);
                if (key === 'raf') counts.frames += 1;
                counts.busy += took;
                counts.longest = Math.max(counts.longest, took);
              }
            }
          : callback;
      const id = original(run, ...args);
      if (repeats) {
        alive.add(id);
        counts.active = alive.size;
      }

      return id;
    };
  };
  wrap('setTimeout', 'timeout', false);
  wrap('setInterval', 'interval', true);
  wrap('requestAnimationFrame', 'raf', false);
  const clear = window.clearInterval.bind(window);
  window.clearInterval = (id) => {
    alive.delete(id);
    counts.active = alive.size;
    return clear(id);
  };
  // Every key the page is given, with the instant the browser made it: the start of an input's latency.
  window.__keydowns = [];
  window.addEventListener('keydown', (event) => window.__keydowns.push(event.timeStamp), true);
  // Where the credit stands, read inside the page so that it can be read in the same task as something else: the baseline of a flood is read in the task that starts it.
  window.__credit = () => ({
    floods: window.__pty.log.floods.length,
    delivered: window.__pty.log.delivered,
    waiting: window.__pty.log.waiting(),
    paused: window.__pty.log.paused(),
    acked: window.__pty.log.acked,
    frames: window.__pty.log.receivedFrames,
    acks: window.__pty.log.acks.length,
    maxUnacked: window.__pty.log.maxUnacked,
    accepted: window.__engine.accepted,
    parsed: window.__engine.parsed,
  });
  window.__longtasks = [];
  try {
    window.__po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longtasks.push(entry.duration);
    });
    window.__po.observe({ type: 'longtask', buffered: true });
  } catch {
    window.__longtasks = null;
  }
};

function build(mode) {
  const existing = mode === 'development' ? process.env.FIXTURE_DIST_DEV : process.env.FIXTURE_DIST;
  if (existing !== undefined && existing !== '') return existing;
  // React's development build is chosen by NODE_ENV, which `vite build` sets to production unless it is set. BUILD_CACHE (the shard runner sets it) shares the build with every process of a shard, the controls' included: the build is
  // given an environment without the control the process runs, so that no control can reach it, and every control plants its fault in the loaded page or in what the fixture reads of its address.
  return sharedBuild({ kind: 'terminal-fixture', mode, build: (out, env) => execFileSync('node', [path.join(here, 'terminal-build.mjs'), out, mode], { cwd: repo, env: { ...env, OMNIVIEW_UI: 'next', NODE_ENV: mode }, stdio: 'pipe' }) });
}

async function open(browser, origin, viewport, { query = '', control } = {}) {
  const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  page.errors = [];
  page.requests = [];
  page.on('pageerror', (error) => page.errors.push(error.message.slice(0, 300)));
  page.on('request', (request) => page.requests.push({ url: request.url(), at: Date.now() }));
  await page.addInitScript(COUNTERS);
  if (control?.init !== undefined) await page.addInitScript(control.init);
  const params = [query, control?.query].filter((part) => part !== undefined && part !== '').join('&');
  await page.goto(`${origin}/shell/probes/terminal-fixture.html${params === '' ? '' : `?${params}`}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-shell-part="window"]');
  return page;
}

/**
 * The panel opens on the Terminal tool, New terminal starts the synthetic shell, and the emulator has the keyboard. With `SCREEN_READER=on` the screen reader mode is turned on once the terminal is up, as a person does it (`plain`
 * leaves it off: the screen reader sections turn it on and off themselves).
 */
async function start(page, { plain = false } = {}) {
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine.writes > 0 && window.__pty.log.resizes.length >= 1, null, { timeout: 15_000 });
  await sleep(500);
  if (READER === 'on' && !plain) await switchReader(page);
}

const typeLine = async (page, text) => {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await sleep(150);
};

/**
 * A start the host refuses (`?fail=`): the panel opens on the Terminal tool, New terminal asks the host, and the lane says that the start failed, after which the host's words are in the transcript (they are written in the frame after the status changes).
 */
async function startRefused(page) {
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await page.waitForFunction(() => /Failed to start/.test(document.querySelector('[data-shell-part="terminalLane"]')?.textContent ?? ''), null, { timeout: 15_000 });
  await page.waitForFunction(() => (document.querySelector('.xterm-rows')?.textContent ?? '').includes('['), null, { timeout: 5_000 }).catch(() => undefined);
  await sleep(300);
}

/** What a person reads of a terminal in the DOM renderer: the names of the session tabs and of the tool's tabs, the lane's words and the lane, and the rows of the transcript that are not empty (their text, without the blanks a row ends with). */
const readTerminal = (page) =>
  page.evaluate(() => {
    const lane = document.querySelector('[data-shell-part="terminalLane"]');
    // The lane's words, without the button of its actions (Restart): the button is read on its own (`restart`).
    const words = lane === null ? null : lane.cloneNode(true);
    const restart = lane?.querySelector('[data-shell-part="terminalRestart"]') ?? null;
    words?.querySelectorAll('[data-shell-part="terminalRestart"]').forEach((button) => button.parentElement?.remove());
    return {
      restart: restart !== null,
      session: [...document.querySelectorAll('[data-shell-part="sessionTabs"] [role="tab"]')].map((tab) => tab.getAttribute('aria-label') ?? ''),
      tools: [...document.querySelectorAll('[data-shell-part="panelTools"] [role="tab"]')].map((tab) => tab.textContent ?? ''),
      words: lane?.querySelector('span')?.textContent ?? '',
      lane: words?.textContent ?? '',
      rows: [...document.querySelectorAll('.xterm-rows > div')].map((row) => (row.textContent ?? '').trimEnd()).filter((text) => text !== ''),
      input: document.querySelector('.xterm-helper-textarea')?.getAttribute('aria-label') ?? '',
    };
  });

const rectOf = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el === null) return null; const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 100) / 100); })()`;
const readRects = (page, selectors) => page.evaluate(`({ ${Object.entries(selectors).map(([key, selector]) => `${JSON.stringify(key)}: ${rectOf(selector)}`).join(', ')} })`);
const activeIsTerminal = (page) => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false);

/** The line the synthetic shell prints for `hello`, and the palette command that turns the screen reader mode on and off (the product's own words: `shell/panel/terminal/screenReader.ts`). */
const LINE = 'hello from the synthetic shell';
const COMMAND = 'Terminal: Toggle Screen Reader Mode';

/**
 * Records what the window's polite live region is told (`window.__told`), once for each page: one entry for each node that arrives in it with words (the region replaces its node for each announcement, so a sentence told twice
 * is two), and whether a modal dialog owned the window at that instant (a live region that is outside the accessibility tree while a modal is open is not heard).
 */
const watchLive = (page) =>
  page.evaluate(() => {
    if (window.__told !== undefined) return;
    window.__told = [];
    new MutationObserver((list) => {
      for (const record of list) for (const node of record.addedNodes) if ((node.textContent ?? '') !== '') window.__told.push({ text: node.textContent, modal: document.querySelector('dialog:modal') !== null });
    }).observe(document.querySelector('[data-notices-part="live"]'), { subtree: true, childList: true, characterData: true });
  });

/**
 * Turns the Terminal's screen reader mode on or off as a person with a keyboard does, through its palette command: F6 leaves the terminal, the palette's chord (the page's own platform's) opens the palette, the words find the
 * command and Enter runs it. Waits for the announcement of the result and a moment more for a second one, puts the keyboard back in the terminal, and answers what the live region was told meanwhile.
 */
async function switchReader(page) {
  await watchLive(page);
  const heard = await page.evaluate(() => window.__told.length);
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await page.keyboard.press('F6');
  await page.keyboard.press(mac ? 'Meta+k' : 'Control+k');
  await page.waitForSelector('dialog[open]', { timeout: 5000 });
  await page.keyboard.type('screen reader');
  await page.getByRole('option', { name: new RegExp(`^Command: ${COMMAND}`) }).waitFor({ timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction((count) => window.__told.length > count, heard, { timeout: 5000 });
  await sleep(300);
  await page.locator('.xterm-helper-textarea').focus();
  return page.evaluate((count) => window.__told.slice(count), heard);
}

/**
 * What a screen reader finds of the terminal now: the accessibility snapshot of the screen's region and the listitems in it that hold the known line (Playwright's own computation of roles and names, which leaves out what is
 * `aria-hidden`), whether the page holds the line at all (the DOM renderer's row: in the page, and hidden from the tree), the input's name and the words it is described by, and how many nodes the screen has.
 */
async function reading(page) {
  const region = page.locator('[data-shell-part="terminalScreen"]');
  const dom = await page.evaluate((line) => {
    const input = document.querySelector('.xterm-helper-textarea');
    return {
      inDom: (document.querySelector('.xterm-rows')?.textContent ?? '').includes(line),
      label: input.getAttribute('aria-label') ?? '',
      description: document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
      nodes: document.querySelector('[data-shell-part="terminalScreen"]').querySelectorAll('*').length,
    };
  }, LINE);
  return { snapshot: await region.ariaSnapshot(), lines: await region.getByRole('listitem').filter({ hasText: LINE }).count(), named: await region.getByRole('textbox', { name: /^Terminal/ }).count(), ...dom };
}

/** Runs the perturbation of the negative control that belongs at `stage` of a screen reader section, if the control has one there. */
const perturb = (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

/** What axe-core finds in the part of the page `selector` names, one line for each rule. The page around the tool is the shell's, whose own findings its probes keep (the panel's handle outside a landmark). */
const runAxe = (page, selector) =>
  page.evaluate(async (context) => {
    const result = await window.axe.run(document.querySelector(context), { resultTypes: ['violations'] });
    return result.violations.map((violation) => `${violation.id} (${String(violation.nodes.length)}): ${violation.nodes[0].target.join(' ')}`);
  }, selector);

// ---------------------------------------------------------------------------------------------------- geometry
async function geometry(ctx) {
  const { browser, origin, viewport, vp, engine } = ctx;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await start(page);
  await typeLine(page, 'hello');
  await ctx.control?.after?.(page, origin);
  const r = await readRects(page, {
    panel: '[data-shell-part="panel"]',
    body: '[data-shell-part="terminalBody"]',
    tools: '[data-shell-part="terminalTools"]',
    button: '[data-terminal-tool="find"]',
    button2: '[data-terminal-tool="clear"]',
    button3: '[data-terminal-tool="copy"]',
    screen: '[data-shell-part="terminalScreen"]',
    lane: '[data-shell-part="terminalLane"]',
    row: '.xterm-rows > div:nth-child(1)',
    row2: '.xterm-rows > div:nth-child(2)',
  });
  const style = await page.evaluate(() => {
    const css = (selector, props) => {
      const el = document.querySelector(selector);
      if (el === null) return null;
      const computed = getComputedStyle(el);
      const values = Object.fromEntries(props.map((prop) => [prop, computed.getPropertyValue(prop)]));
      // The status lane borrows the panel's fill; compare the plane actually visible behind it.
      for (let parent = el.parentElement; values['background-color'] === 'rgba(0, 0, 0, 0)' && parent !== null; parent = parent.parentElement) {
        values['background-color'] = getComputedStyle(parent).backgroundColor;
      }
      return values;
    };
    return {
      screen: css('[data-shell-part="terminalScreen"]', ['background-color', 'outline-width', 'outline-style', 'outline-color', 'outline-offset']),
      lane: css('[data-shell-part="terminalLane"]', ['border-top-color', 'border-top-width', 'background-color', 'height']),
      row: css('.xterm-rows > div:nth-child(1)', ['font-size', 'height', 'line-height']),
      foreground: css('[data-swatch="foreground"]', ['color']),
      font: css('[data-swatch="font"]', ['font-size', 'line-height', 'font-family']),
    };
  });
  const tag = `${engine} ${vp}`;
  // The mock's rectangles, measured in this engine at this viewport (mock-terminal.json): the body, the toolbar column, its first button, the screen, the lane and the first row of the transcript.
  const ref = REF.viewports[engine]?.[vp] ?? REF.viewports.webkit[vp];
  check('geometry.body', rectNear(r.panel, ref.panel) && rectNear(r.body, ref.body), `${tag}: panel ${JSON.stringify(r.panel)} body ${JSON.stringify(r.body)}, the mock's ${JSON.stringify(ref.panel)} ${JSON.stringify(ref.body)}`);
  check('geometry.tools', rectNear(r.tools, ref.tools), `${tag}: the toolbar column is ${JSON.stringify(r.tools)}, the mock's ${JSON.stringify(ref.tools)}`);
  check('geometry.button', rectNear(r.button, ref.firstButton), `${tag}: the first button (Find) is ${JSON.stringify(r.button)}, the mock's ${JSON.stringify(ref.firstButton)}`);
  check('geometry.screen', rectNear(r.screen, ref.screen), `${tag}: the screen is ${JSON.stringify(r.screen)}, the mock's ${JSON.stringify(ref.screen)}`);
  check('geometry.lane', rectNear(r.lane, ref.lane), `${tag}: the lane is ${JSON.stringify(r.lane)}, the mock's ${JSON.stringify(ref.lane)}`);
  check('geometry.rows', rectNear(r.row, ref.firstRow, 1) || (near(r.row?.[1], ref.firstRow[1]) && near(r.row?.[3], ref.firstRow[3]) && near(r.row?.[0], ref.firstRow[0] + REF.rules.inset)), `${tag}: the first row is ${JSON.stringify(r.row)}, the mock's ${JSON.stringify(ref.firstRow)} (its text starts ${String(REF.rules.inset)} px in)`);

  // Clear and Copy selection take the mock's next two slots, one pitch apart (the mock's column goes on with Paste and the rest, which the host's toolbar does not have yet).
  const slot = (index) => [ref.firstButton[0], ref.firstButton[1] + index * REF.rules.buttonPitch, ref.firstButton[2], ref.firstButton[3]];
  check(
    'geometry.button',
    near(r.button2?.[1] - r.button?.[1], REF.rules.buttonPitch) && near(r.button3?.[1] - r.button2?.[1], REF.rules.buttonPitch) && rectNear(r.button2, slot(1)) && rectNear(r.button3, slot(2)),
    `${tag}: Find, Clear and Copy selection are ${String(r.button2?.[1] - r.button?.[1])} and ${String(r.button3?.[1] - r.button2?.[1])} px apart, the mock's ${String(REF.rules.buttonPitch)}; Clear is ${JSON.stringify(r.button2)}, the mock's second slot ${JSON.stringify(slot(1))}; Copy selection is ${JSON.stringify(r.button3)}, its third ${JSON.stringify(slot(2))}`,
  );
  check('geometry.lane', near(r.lane?.[3], REF.rules.laneHeight) && style.lane?.['border-top-color'] === REF.rules.laneBorderTop && style.lane?.['background-color'] === REF.rules.laneBackground, `${tag}: the lane is ${style.lane?.height} with a ${style.lane?.['border-top-color']} border on ${style.lane?.['background-color']}, the mock's ${REF.rules.laneHeight} px, ${REF.rules.laneBorderTop} on ${REF.rules.laneBackground}`);
  check('geometry.rows', near(r.row2?.[1] - r.row?.[1], REF.rules.rowPitch) && style.row?.['font-size'] === `${REF.rules.fontSize}px`, `${tag}: the rows are ${String(r.row2?.[1] - r.row?.[1])} px apart at ${style.row?.['font-size']}, the mock's ${REF.rules.rowPitch} px at ${REF.rules.fontSize}px (swatch ${JSON.stringify(style.font)})`);
  check('geometry.colors', style.screen?.['background-color'] === REF.rules.screenBackground && style.foreground?.color === REF.rules.rowText, `${tag}: the screen is ${style.screen?.['background-color']} with text ${style.foreground?.color}, the mock's ${REF.rules.screenBackground} and ${REF.rules.rowText}`);
  // The mock draws its 2 px ring on the output REGION when that region is the focused element; a terminal whose keyboard is in its input draws none around the screen (`paint.ring`).
  check('geometry.errors', page.errors.length === 0, `${tag}: the page raised ${JSON.stringify(page.errors)}`);
  report.numbers[`geometry ${tag}`] = { rects: r, style };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- words
async function words(ctx) {
  const { browser, origin, viewport, engine, vp } = ctx;
  const tag = `${engine} ${vp}`;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom' });
  await page.click('[data-shell-part="panelToggle"]');
  const state = page.locator('[data-shell-part="panelEmpty"] > [data-ov-part="empty-state"]');
  await state.waitFor();
  const empty = await state.evaluate((element) => ({
    title: element.querySelector(':scope > [data-ov-part="title"]')?.textContent,
    hint: element.querySelector(':scope > [data-ov-part="hint"]')?.textContent,
    buttons: [...element.parentElement.querySelectorAll('button')].map((button) => button.textContent),
    role: element.parentElement.getAttribute('role'),
  }));
  check('words.empty', empty.title === 'No terminals' && empty.hint === 'Start a shell in this window. A session stays available when you switch tabs.' && empty.buttons.length === 1 && empty.buttons[0] === 'New terminal' && empty.role === 'status', `${tag}: the empty tool says ${JSON.stringify(empty)}`);

  const placement = () => state.evaluate((element) => {
    const region = element.parentElement;
    const outer = region.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const { flexDirection, flexWrap } = getComputedStyle(element);
    return {
      flexDirection,
      flexWrap,
      inlineOffset: (box.left + box.right - outer.left - outer.right) / 2,
      blockOffset: (box.top + box.bottom - outer.top - outer.bottom) / 2,
      fits: region.scrollWidth <= region.clientWidth && region.scrollHeight <= region.clientHeight,
    };
  });
  const centered = (read) => read.fits && near(read.inlineOffset, 0) && near(read.blockOffset, 0);
  const normal = await placement();
  check('words.empty-stack', normal.flexDirection === 'column' && centered(normal), `${tag}: at normal height the empty stack is ${JSON.stringify(normal)}`);
  const splitter = page.getByRole('separator', { name: 'Resize panel' });
  await splitter.press('Home');
  const short = await placement();
  check('words.empty-row', (await splitter.getAttribute('aria-valuenow')) === '120' && short.flexDirection === 'row' && short.flexWrap === 'wrap' && centered(short), `${tag}: at minimum height the empty row is ${JSON.stringify(short)}`);
  report.numbers[`words empty ${tag}`] = { normal, short };
  if (vp !== '1440x900') {
    await page.context().close();
    return;
  }

  await splitter.press('Enter');
  await state.getByRole('button', { name: 'New terminal', exact: true }).click();
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine.writes > 0);
  await sleep(500);
  const toolbar = await page.evaluate(() => {
    const bar = document.querySelector('[role="toolbar"]');
    const copy = document.querySelector('[data-terminal-tool="copy"]');
    return {
      label: bar?.getAttribute('aria-label'),
      orientation: bar?.getAttribute('aria-orientation'),
      names: [...(bar?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label')),
      copyDisabled: copy?.getAttribute('aria-disabled'),
      copyReason: document.getElementById(copy?.getAttribute('aria-describedby') ?? '')?.textContent,
      input: document.querySelector('.xterm-helper-textarea')?.getAttribute('aria-label'),
      hint: document.getElementById(document.querySelector('.xterm-helper-textarea')?.getAttribute('aria-describedby') ?? '')?.textContent,
      lane: document.querySelector('[data-shell-part="terminalLane"]')?.textContent,
      laneRole: document.querySelector('[data-shell-part="terminalLane"]')?.getAttribute('role'),
    };
  });
  check('words.toolbar', toolbar.label === 'Terminal tools' && toolbar.orientation === 'vertical' && JSON.stringify(toolbar.names) === JSON.stringify(['Find', 'Clear', 'Copy selection', 'Rename session', 'Split terminal']) && toolbar.copyDisabled === 'true' && toolbar.copyReason === 'Select text in the terminal first', `${engine}: the toolbar is ${JSON.stringify(toolbar)}`);
  check('words.input', toolbar.input === 'Terminal input, zsh' && /^Escape and Tab go to the shell\. Press F6 to move to the next part of the window/.test(toolbar.hint ?? ''), `${engine}: the input is ${JSON.stringify([toolbar.input, toolbar.hint])}`);
  check('words.running', toolbar.lane === '' && toolbar.laneRole === 'status', `${engine}: the lane of a running session says ${JSON.stringify(toolbar.lane)} (role ${toolbar.laneRole})`);
  // Ended: the process exits with code 0 (the host's typed end); the lane says so, input is off, the transcript keeps its lines and ends with the exit line (`ended.*` has the other ways a process ends).
  await typeLine(page, 'hello');
  await typeLine(page, 'exit');
  await page.waitForFunction(() => /Input is off/.test(document.querySelector('[data-shell-part="terminalLane"]')?.textContent ?? ''), null, { timeout: 10_000 });
  await page.waitForFunction(() => /\[Process exited with code 0\]/.test(document.querySelector('.xterm-rows')?.textContent ?? ''), null, { timeout: 5_000 }).catch(() => undefined);
  const ended = await page.evaluate(() => ({ lane: document.querySelector('[data-shell-part="terminalLane"]')?.textContent, text: document.querySelector('.xterm-rows')?.textContent, input: document.querySelector('.xterm-helper-textarea')?.hasAttribute('disabled') }));
  check('words.ended', /Exited with code 0/.test(ended.lane ?? '') && /Input is off\. Its output stays readable here\./.test(ended.lane ?? ''), `${engine}: the lane of an ended session says ${JSON.stringify(ended.lane)}`);
  check('words.transcript', /hello from the synthetic shell/.test(ended.text ?? '') && /\[Process exited with code 0\]/.test(ended.text ?? ''), `${engine}: the transcript of an ended session is ${JSON.stringify((ended.text ?? '').slice(-200))}`);
  const writes = await page.evaluate(() => window.__pty.log.writes.length);
  await page.keyboard.type('more');
  await sleep(200);
  check('words.input-off', (await page.evaluate(() => window.__pty.log.writes.length)) === writes, `${engine}: what is typed after the end reached the process`);
  // Failed: the producer's own words.
  await page.click('[data-shell-part="sessionClose"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea');
  await sleep(600);
  await typeLine(page, 'fail');
  await page.waitForFunction(() => /Failed/.test(document.querySelector('[data-shell-part="terminalLane"]')?.textContent ?? ''), null, { timeout: 10_000 });
  const failed = await page.evaluate(() => document.querySelector('[data-shell-part="terminalLane"]')?.textContent);
  check('words.failed', /Failed/.test(failed ?? '') && /The shell stopped answering/.test(failed ?? ''), `${engine}: the lane of a failed session says ${JSON.stringify(failed)}`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- keys
async function keys(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await start(page);
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  check('keys.focus', await activeIsTerminal(page), `${engine}: the new terminal has the keyboard`);
  const before = await page.evaluate(() => window.__pty.log.writes.join(''));
  await page.keyboard.press('Escape');
  check('keys.escape', (await activeIsTerminal(page)) && (await page.evaluate(() => window.__pty.log.writes.join(''))).endsWith('\u001b'), `${engine}: Escape stays in the shell and is sent to it (active: ${await page.evaluate(() => document.activeElement?.tagName)})`);
  // Whatever Escape did, the next key is pressed in the terminal: an assertion that fails says its own failure and no other.
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Tab');
  check('keys.tab', (await activeIsTerminal(page)) && (await page.evaluate(() => window.__pty.log.writes.join(''))).endsWith('\u001b\t'), `${engine}: Tab stays in the shell and is sent to it`);
  await page.keyboard.press('Control+c');
  check('keys.interrupt', (await page.evaluate(() => window.__pty.log.writes.join(''))).endsWith('\u0003') && (await activeIsTerminal(page)), `${engine}: Ctrl+C with no selection is the interrupt`);
  await page.keyboard.press('F6');
  check('keys.f6', !(await page.evaluate(() => document.activeElement?.closest('.xterm') !== null && document.activeElement?.closest('.xterm') !== undefined)), `${engine}: F6 moves the focus out of the terminal (active: ${await page.evaluate(() => document.activeElement?.tagName + '.' + String(document.activeElement?.className).slice(0, 40))})`);
  check('keys.f6-not-sent', !(await page.evaluate(() => window.__pty.log.writes.join(''))).includes('\u001b[17~'), `${engine}: F6 is not sent to the shell`);
  void before;
  // Copy and paste: the platform's chords.
  await page.evaluate(() => {
    window.__clip = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__clip.push(text); } } });
  });
  await page.click('.xterm-screen');
  await typeLine(page, 'hello');
  await page.evaluate(() => {
    const screen = document.querySelector('.xterm-screen').getBoundingClientRect();
    return screen.width;
  });
  // Select the word `hello` in the output by a double click on it (the output line is the second row from the bottom of what is printed).
  const spot = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.xterm-rows > div')];
    const index = rows.findIndex((row) => /^hello from the synthetic shell/.test(row.textContent ?? ''));
    const box = rows[index]?.getBoundingClientRect();
    return box === undefined ? null : { x: box.x + 7.2 * 3, y: box.y + box.height / 2 };
  });
  check('keys.copy', spot !== null, `${engine}: the output line of hello was not found`);
  if (spot !== null) {
    await page.mouse.dblclick(spot.x, spot.y);
    await sleep(150);
    await page.keyboard.press(mac ? 'Meta+c' : 'Control+Shift+c');
    await sleep(200);
    const clip = await page.evaluate(() => window.__clip);
    check('keys.copy', clip.length === 1 && clip[0] === 'hello', `${engine}: the copy chord put ${JSON.stringify(clip)} on the clipboard, expected ["hello"]`);
    check('keys.copy-no-interrupt', !(await page.evaluate(() => window.__pty.log.writes.join(''))).endsWith('hello\r\u0003'), `${engine}: the copy chord was sent to the shell`);
  }

  const written = await page.evaluate(() => window.__pty.log.writes.length);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'pasted text');
    document.querySelector('.xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await sleep(250);
  const pasted = await page.evaluate((from) => window.__pty.log.writes.slice(from).join(''), written);
  check('keys.paste', pasted.includes('pasted text'), `${engine}: a paste reached the shell as ${JSON.stringify(pasted)}`);
  if (mac) {
    // Command J hides the panel from inside the terminal, and the focus goes back to the page: never trapped.
    await page.click('.xterm-screen');
    await page.keyboard.press('Meta+j');
    await sleep(400);
    check('keys.toggle', await page.evaluate(() => (document.querySelector('[data-shell-part="panel"]')?.getBoundingClientRect().height ?? 0) === 0 && !document.activeElement?.closest('.xterm')), `${engine}: Command J hides the panel and the focus leaves the terminal`);
  }

  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- title
/**
 * The session's tab is called by the shell the host says it started (the answer to the call that started it, `terminal.Session.shell.name`: `zsh`, `bash`) and not `Terminal`; the tool's own tab keeps its name, and the emulator's input
 * is named by the session's tab, which is what a screen reader says for it.
 */
async function title(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  for (const shell of ['zsh', 'bash']) {
    const page = await open(browser, origin, viewport, { query: shell === 'zsh' ? 'renderer=dom' : `renderer=dom&shell=${shell}`, control: ctx.control });
    await start(page);
    const read = await readTerminal(page);
    const named = read.session[0] ?? '';
    check('title.shell', read.session.length === 1 && named.startsWith(shell) && !named.startsWith('Terminal') && read.tools.includes('Terminal') && read.input === `Terminal input, ${shell}`, `${engine}: the host said it started ${shell}: the session's tab is ${JSON.stringify(read.session)} (it starts with ${shell}), the tool's tabs ${JSON.stringify(read.tools)} (one is Terminal), and the emulator's input is ${JSON.stringify(read.input)} (Terminal input, ${shell})`);
    await page.context().close();
  }
}

// ---------------------------------------------------------------------------------------------------- ended
/**
 * How a process ended, as the host's typed CLOSE event says it (docs/ui-next/status/T1-go.md 2.2): the lane says it in words and says that input is off, the last line written into the transcript (muted) says it again, and the tab's name has
 * the state. Read in the DOM renderer, where the transcript is text. `exit 3` is `exited` with its code (`orphan` too, and the host says a program kept the terminal open: one more line), `kill` and `segv` are `signaled` (a core dump is said),
 * `quit` is `closed` by the host quitting.
 */
async function ended(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const NOTE = 'Input is off. Its output stays readable here.';
  const cases = [
    { assertion: 'ended.code', command: 'exit 3', words: 'Exited with code 3', tail: ['[Process exited with code 3]'] },
    { assertion: 'ended.code', command: 'orphan', words: 'Exited with code 0', tail: ['[Process exited with code 0]', '[A program kept the terminal open after the shell exited, so the host stopped reading it and dropped 4 KB of its output]'] },
    { assertion: 'ended.signal', command: 'kill', words: 'Ended by SIGKILL', tail: ['[Process ended by SIGKILL]'] },
    { assertion: 'ended.signal', command: 'segv', words: 'Ended by SIGSEGV (core dumped)', tail: ['[Process ended by SIGSEGV (core dumped)]'] },
    { assertion: 'ended.closed', command: 'quit', words: 'Closed when Omniview quit', tail: ['[Process closed when Omniview quit]'] },
  ];
  for (const one of cases) {
    const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
    await start(page);
    await typeLine(page, one.command);
    await page.waitForFunction(() => /Input is off/.test(document.querySelector('[data-shell-part="terminalLane"]')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => undefined);
    // The transcript's lines are written in the frame after the lane says it: waited for, bounded, until every line it must end with is there (a line the host's words do not change, by its first character).
    await page.waitForFunction((count) => [...document.querySelectorAll('.xterm-rows > div')].filter((row) => (row.textContent ?? '').trimStart().startsWith('[')).length >= count, one.tail.length, { timeout: 5_000 }).catch(() => undefined);
    const read = await readTerminal(page);
    const tail = read.rows.slice(-one.tail.length);
    const said = `${one.words} ${NOTE}`;
    check(one.assertion, read.words === one.words && read.lane === said && read.restart === true && JSON.stringify(tail) === JSON.stringify(one.tail) && read.session[0] === 'zsh, ended', `${engine}: after "${one.command}" the lane says ${JSON.stringify(read.lane)} (${JSON.stringify(said)}) and offers Restart: ${String(read.restart)}, the last lines of the transcript are ${JSON.stringify(tail)} (${JSON.stringify(one.tail)}) and the session's tab is ${JSON.stringify(read.session)} (zsh, ended)`);
    await page.context().close();
  }
}

// ---------------------------------------------------------------------------------------------------- start
/**
 * A start the host refuses (docs/ui-next/status/T1-go.md 2.5 and 2.8.8). `SHELL_UNAVAILABLE`, read from the error's code and never from its words, is `No shell could be started`, and the host's detail names every path it tried: the lane says both, and so
 * does the transcript, one muted line each where the shell's prompt would have been, so that what the host tried can be read and copied. Any other refusal is `Couldn't start the terminal`. The host starts nothing then, and flow control is never turned on.
 */
async function refusals(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const flat = (text) => text.replace(/\s+/g, '');
  const TRIED = ['/bin/zsh', '/opt/none/zsh', '/bin/bash', '/bin/sh'];
  const MISSING = 'shell executable unavailable: tried the shell asked for "/bin/zsh": not found; $SHELL "/opt/none/zsh": not found; /bin/bash: not found; /bin/sh: not found';
  const page = await open(browser, origin, viewport, { query: 'renderer=dom&fail=shell-unavailable', control: ctx.control });
  await startRefused(page);
  const missing = await readTerminal(page);
  const host = await page.evaluate(() => ({ refused: window.__pty.log.refused.length, created: window.__pty.log.created.length, acks: window.__pty.log.acks.length }));
  const screen = flat(missing.rows.join(''));
  check('start.unavailable', missing.words === 'Failed to start' && missing.lane === `Failed to start No shell could be started. ${MISSING}.` && screen === flat(`[No shell could be started][${MISSING}]`) && TRIED.every((tried) => screen.includes(tried)) && missing.session[0] === 'Terminal, failed' && host.refused === 1 && host.created === 0 && host.acks === 0, `${engine}: no shell could be started: the lane says ${JSON.stringify(missing.lane)}, the transcript ${JSON.stringify(missing.rows)} (the two lines [No shell could be started] and [${MISSING}], with the ${String(TRIED.length)} paths ${TRIED.join(' ')} on the screen: ${String(TRIED.filter((tried) => screen.includes(tried)).length)} are), the session's tab ${JSON.stringify(missing.session)} (Terminal, failed), the host refused ${String(host.refused)} and made ${String(host.created)} sessions, ${String(host.acks)} acknowledgements`);
  await page.context().close();
  const PLAIN = 'failed to start the terminal: the pty could not be opened';
  const plain = await open(browser, origin, viewport, { query: 'renderer=dom&fail=start', control: ctx.control });
  await startRefused(plain);
  const other = await readTerminal(plain);
  check('start.failed', other.words === 'Failed to start' && other.lane === `Failed to start Couldn't start the terminal. ${PLAIN}.` && flat(other.rows.join('')) === flat(`[The terminal could not start][${PLAIN}]`) && other.session[0] === 'Terminal, failed', `${engine}: a start that failed for no shell's sake: the lane says ${JSON.stringify(other.lane)} (Failed to start Couldn't start the terminal. ${PLAIN}.), the transcript ${JSON.stringify(other.rows)} ([The terminal could not start] and [${PLAIN}]), the session's tab ${JSON.stringify(other.session)}`);
  await plain.context().close();
}

// ---------------------------------------------------------------------------------------------------- close
/**
 * Records, in the page, what a close does, with the page's own clock (`performance.now()`), so that no round trip of the probe is in the instants: the instant of each press on a session's close button, the instant of every question (a
 * dialog of the close guard) added to the document, and the instant the panel's empty state appeared (the last session went).
 */
const watchClose = (page) =>
  page.evaluate(() => {
    const seen = (window.__closing = { pressed: [], questions: [], emptyAt: null });
    document.addEventListener('click', (event) => { if (event.target instanceof Element && event.target.closest('[data-shell-part="sessionClose"]') !== null) seen.pressed.push(performance.now()); }, true);
    new MutationObserver((list) => {
      const now = performance.now();
      for (const record of list) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('dialog[role="alertdialog"]') || node.querySelector('dialog[role="alertdialog"]') !== null) seen.questions.push(now);
          if (seen.emptyAt === null && (node.matches('[data-shell-part="panelEmpty"]') || node.querySelector('[data-shell-part="panelEmpty"]') !== null)) seen.emptyAt = now;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

/** The question on screen: whether it is modal, who has the keyboard, its title and its sentence, its buttons. Nothing when there is none. */
const askedOf = (page) =>
  page.evaluate(() => {
    const dialog = document.querySelector('dialog[role="alertdialog"]');
    if (dialog === null) return null;
    return {
      modal: dialog.matches(':modal'),
      active: document.activeElement?.textContent ?? '',
      title: document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent ?? '',
      body: document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
      buttons: [...dialog.querySelectorAll('button')].map((button) => button.textContent),
    };
  });

/**
 * Where the keyboard is, for the session `id`: whether it is on the session's own tab in the panel's strip, whether it is on the pointer-only close button of a tab, whether anything above it is `aria-hidden`, and what it is.
 */
const focusOf = (page, id) =>
  page.evaluate((session) => {
    const active = document.activeElement;
    return {
      onTab: active?.matches(`[data-shell-region="panel"] [data-shell-part="sessionTabs"] [role="tab"][data-tab-id="${session}"]`) ?? false,
      onClose: active?.matches('[data-shell-part="sessionClose"]') ?? false,
      hiddenAbove: active === null ? false : active.closest('[aria-hidden="true"]') !== null,
      is: active === null ? 'nothing' : `${active.tagName.toLowerCase()}${active.getAttribute('data-shell-part') === null ? '' : `[${active.getAttribute('data-shell-part')}]`}`,
    };
  }, id);

/**
 * The question a close of a running terminal asks, and when it asks nothing (docs/ui-next/status/T1-go.md 2.3): the person closes it, the page asks the host `IsBusy` (once, never polled), and the host says what holds the terminal. At its prompt
 * (`idle`) nothing runs and nothing is asked: the tab goes, the process is closed once and the keyboard goes where a close puts it. A program (`busy`, named `sleep`) is named in the question, a modal whose Cancel has the keyboard; Escape and
 * Cancel keep the session and Terminate session ends it; and after a no (Escape, Cancel, a press on the scrim), asked with the mouse on the close button or with Delete on the tab, the keyboard is on the session's own tab and never on the
 * pointer-only close button, which is `aria-hidden`. A host that cannot say (`unknown`), and one that does not answer (`hang`: after the wait of 1.5 s, not before it), get the general question.
 */
async function close(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const BUSY = 'sleep is running in this terminal. This ends the terminal session and stops it.';
  const GENERAL = 'This ends the terminal session. Programs it left running in the background may keep running.';
  const TITLE = 'Terminate session?';
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await page.addScriptTag({ path: AXE });
  await start(page);
  await perturb(ctx, page, 'start');
  await typeLine(page, 'sleep 30');
  await watchClose(page);
  const tab = '[data-shell-part="sessionTabs"] [role="tab"]';
  const tabId = await page.evaluate((selector) => document.querySelector(selector)?.getAttribute('data-tab-id') ?? '', tab);
  const dialog = page.getByRole('alertdialog', { name: TITLE });
  // The presses of the close the host was asked about, and where the keyboard was after each no.
  let presses = 0;
  const verdicts = [];
  // Every path asks the question and answers it no, and the question must come, and be gone again, before the keyboard is looked at. A wait that ran out is kept and fails `close.focus`: no path goes on by a timeout that was caught.
  // A press is one the host was asked about when its question came.
  const waits = [];
  const asks = async (how) => {
    const ok = await dialog.waitFor({ timeout: 5000 }).then(() => true, () => false);
    waits.push({ how, step: 'the question came', ok });
    if (ok) presses += 1;
    return ok;
  };
  const goes = async (how) => {
    const ok = await dialog.waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false);
    waits.push({ how, step: 'the question went', ok });
  };
  const noted = async (how) => {
    await sleep(150);
    verdicts.push({ how, ...(await focusOf(page, tabId)) });
  };
  await page.click('[data-shell-part="sessionClose"]');
  await asks('the close button, Escape');
  const shown = await askedOf(page);
  check('close.modal', shown?.modal === true, `${engine}: the question is a modal dialog (:modal ${String(shown?.modal)})`);
  check('close.cancel', shown?.active === 'Cancel', `${engine}: Cancel has the keyboard in the question (active: ${String(shown?.active)})`);
  check('close.words', shown?.title === TITLE && / is running in this terminal\. This ends the terminal session and stops it\.$/.test(shown.body) && JSON.stringify(shown.buttons) === JSON.stringify(['Cancel', 'Terminate session']), `${engine}: the question says ${JSON.stringify(shown)}`);
  await page.keyboard.press('Escape');
  await goes('the close button, Escape');
  check('close.no', (await page.evaluate(() => window.__pty.ids().length)) === 1 && (await page.getByRole('alertdialog').count()) === 0, `${engine}: Escape says no: the shell is still there and the question is gone`);
  await noted('the close button, Escape');
  // Cancel says no as well: the session stays, and the host closed nothing.
  await page.click('[data-shell-part="sessionClose"]');
  const cancelling = await asks('the close button, Cancel');
  const again = await askedOf(page);
  if (cancelling) await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await goes('the close button, Cancel');
  const kept = await page.evaluate(() => ({ ids: window.__pty.ids().length, closed: window.__pty.log.closed.length, dialogs: document.querySelectorAll('dialog[role="alertdialog"]').length }));
  await noted('the close button, Cancel');
  // A press on the scrim, outside the frame, says no too.
  await page.click('[data-shell-part="sessionClose"]');
  await asks('the close button, a press on the scrim');
  await page.mouse.click(4, 4);
  await goes('the close button, a press on the scrim');
  await noted('the close button, a press on the scrim');
  // The keyboard asks with Delete on the tab and answers with Escape, with Enter on Cancel (which has the keyboard) and with a press on the scrim.
  for (const how of ['Escape', 'Enter on Cancel', 'a press on the scrim']) {
    const path = `Delete on the tab, ${how}`;
    await page.locator(tab).focus();
    await page.keyboard.press('Delete');
    await asks(path);
    if (how === 'Escape') await page.keyboard.press('Escape');
    else if (how === 'Enter on Cancel') await page.keyboard.press('Enter');
    else await page.mouse.click(4, 4);
    await goes(path);
    await noted(path);
  }

  const axeFocus = await runAxe(page, '[data-shell-part="panelHeader"]');
  const astray = verdicts.filter((verdict) => !verdict.onTab || verdict.onClose || verdict.hiddenAbove);
  const unmet = waits.filter((step) => !step.ok);
  check('close.focus', waits.length === 12 && unmet.length === 0 && verdicts.length === 6 && astray.length === 0 && axeFocus.length === 0, `${engine}: after a no the keyboard is on the session's own tab, never on the pointer-only close button or under an aria-hidden ancestor: ${JSON.stringify(verdicts)} (${String(astray.length)} are not)${unmet.length === 0 ? '' : `; the question did not come, or did not go, in ${JSON.stringify(unmet)}`}, and axe finds ${JSON.stringify(axeFocus)} in the strip with the keyboard there`);
  presses += 1;
  await page.click('[data-shell-part="sessionClose"]');
  await dialog.waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Terminate session', exact: true }).click();
  await sleep(500);
  const done = await page.evaluate(() => ({ closed: window.__pty.log.closed.length, asked: window.__pty.log.busy.length, ids: window.__pty.ids().length, empty: document.querySelector('[data-shell-part="panelEmpty"]') !== null, role: document.activeElement?.getAttribute('role'), text: document.activeElement?.textContent }));
  check('close.yes', done.closed === 1 && done.empty && done.role === 'tab' && /Terminal/.test(done.text ?? ''), `${engine}: Terminate session closed the process (${String(done.closed)}), the tool says it is empty (${String(done.empty)}) and the focus is on the tool's tab (${String(done.role)} ${String(done.text)})`);
  check('close.busy', shown?.body === BUSY && again?.body === BUSY && kept.ids === 1 && kept.closed === 0 && kept.dialogs === 0 && done.closed === 1 && done.ids === 0 && done.asked === presses, `${engine}: a program runs: the question says ${JSON.stringify(shown?.body)} and ${JSON.stringify(again?.body)} (${JSON.stringify(BUSY)}); after Cancel ${String(kept.ids)} session(s) stay, ${String(kept.closed)} closed, ${String(kept.dialogs)} questions; after Terminate session ${String(done.closed)} closed and ${String(done.ids)} stay; the host was asked ${String(done.asked)} times for ${String(presses)} presses`);
  // At its prompt, nothing runs: no question at any moment, the tab goes at once, the process is closed once, and the keyboard goes to the tool's tab (the last session has no neighbour).
  const idlePage = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await start(idlePage);
  await watchClose(idlePage);
  await idlePage.click('[data-shell-part="sessionClose"]');
  await idlePage.waitForSelector('[data-shell-part="panelEmpty"]', { timeout: 4000 }).catch(() => undefined);
  await sleep(200);
  const quick = await idlePage.evaluate(() => ({ ...window.__closing, closed: window.__pty.log.closed.length, asked: window.__pty.log.busy.length, ids: window.__pty.ids().length, role: document.activeElement?.getAttribute('role'), text: document.activeElement?.textContent }));
  const gone = quick.emptyAt === null || quick.pressed.length === 0 ? Infinity : quick.emptyAt - quick.pressed[0];
  check('close.idle', quick.questions.length === 0 && gone <= 1_000 && quick.closed === 1 && quick.asked === 1 && quick.ids === 0 && quick.role === 'tab' && quick.text === 'Terminal', `${engine}: at its prompt: ${String(quick.questions.length)} questions (none is right), the tab was gone ${String(round(gone))} ms after the press (1,000 ms at most), the process was closed ${String(quick.closed)} time(s) (once) after the host was asked ${String(quick.asked)} time(s) (once), ${String(quick.ids)} sessions stay, and the focus is on ${String(quick.role)} ${JSON.stringify(quick.text)} (the tool's tab)`);
  await idlePage.context().close();
  // A host that cannot say gets the general question at once; one that never answers gets it when the wait of 1.5 s is over.
  const unknown = await open(browser, origin, viewport, { query: 'renderer=dom&busy=unknown', control: ctx.control });
  await start(unknown);
  await watchClose(unknown);
  await unknown.click('[data-shell-part="sessionClose"]');
  await unknown.getByRole('alertdialog').waitFor({ timeout: 5000 }).catch(() => undefined);
  const cannot = await askedOf(unknown);
  const cannotAfter = await unknown.evaluate(() => (window.__closing.questions[0] ?? Infinity) - (window.__closing.pressed[0] ?? 0));
  check('close.unknown', cannot?.title === TITLE && cannot.body === GENERAL && cannotAfter <= 1_000, `${engine}: the host said it cannot tell: the question says ${JSON.stringify(cannot)} (${JSON.stringify(GENERAL)}) ${String(round(cannotAfter))} ms after the press (at once: 1,000 ms at most, the wait is 1,500)`);
  await unknown.context().close();
  const hang = await open(browser, origin, viewport, { query: 'renderer=dom&busy=hang', control: ctx.control });
  await start(hang);
  await perturb(ctx, hang, 'hang');
  await watchClose(hang);
  await hang.click('[data-shell-part="sessionClose"]');
  await hang.getByRole('alertdialog').waitFor({ timeout: 6000 }).catch(() => undefined);
  const silent = await askedOf(hang);
  const silentAfter = await hang.evaluate(() => (window.__closing.questions[0] ?? Infinity) - (window.__closing.pressed[0] ?? 0));
  check('close.hang', silent?.title === TITLE && silent.body === GENERAL && silentAfter >= 1_400 && silentAfter <= 4_000, `${engine}: the host never answered: the question says ${JSON.stringify(silent)} (${JSON.stringify(GENERAL)}) ${String(round(silentAfter))} ms after the press (after the wait of 1,500 ms: not before 1,400 and within 4,000)`);
  await hang.context().close();
}

// ---------------------------------------------------------------------------------------------------- resize
async function resize(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  const first = await page.evaluate(() => window.__pty.log.resizes.map((resizeEntry) => [resizeEntry.rows, resizeEntry.cols]));
  check('resize.first', first.length >= 1 && first[0][0] > 0 && first[0][1] > 0, `${engine}: the first size reached the process: ${JSON.stringify(first)}`);
  const base = first.length;
  // A drag of the splitter: ten changes of height, a frame apart (the handle's own keys: Home is the least, End the most), inside 200 ms. One message once the size stood still, not one for each.
  await page.locator('[data-shell-part="panelHandle"]').focus();
  await page.evaluate(async () => {
    const handle = document.querySelector('[data-shell-part="panelHandle"]');
    for (let step = 0; step < 10; step += 1) {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: step % 2 === 0 ? 'Home' : 'End', bubbles: true, cancelable: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
  await sleep(900);
  const sent = await page.evaluate(() => window.__pty.log.resizes.map((resizeEntry) => [resizeEntry.rows, resizeEntry.cols]));
  const after = sent.length - base;
  check('resize.messages', after >= 1 && after <= 2, `${engine}: ${String(after)} resize messages for a drag that ended at one size (expected 1 or 2): ${JSON.stringify(sent.slice(base))}`);
  const screen = await page.evaluate(() => {
    const box = document.querySelector('.xterm-screen')?.getBoundingClientRect();
    return box === undefined ? null : { rows: Math.round(box.height / 18), width: box.width };
  });
  const grid = await page.evaluate(() => window.__engine.grid());
  const last = sent.at(-1);
  check('resize.last', screen !== null && last[0] === screen.rows && last[0] === grid.rows && last[1] === grid.cols, `${engine}: the last size sent is ${JSON.stringify(last)} (rows, columns), the screen has ${String(screen?.rows)} rows and the emulator's grid is ${String(grid.rows)} rows by ${String(grid.cols)} columns`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- size
/**
 * The process starts at the size the person sees (docs/ui-next/status/T2a.md): the screen tells the feed a size only once the GPU renderer is in place, whose cells are not the DOM's, so that the create call carries the final size and
 * nothing is resized after the process started. Read with the renderer the product has (the GPU's), in both viewports and both engines: the log holds the create call's size and no resize after it, not at the start and not after the panel was
 * hidden and shown (the renderer goes to the DOM's and back, and the cells are the same), until the panel is resized (`resize.none`); and the size the shell reports when it is asked is the emulator's cells, which are what the renderer in
 * place gives (`resize.cells`).
 */
async function size(ctx) {
  const { browser, origin, viewport, engine, vp } = ctx;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  // A resize that follows the create call comes once the renderer is in place and the size has stood still for 100 ms.
  await sleep(500);
  const sizes = () => page.evaluate(() => window.__pty.log.resizes.map((entry) => [entry.rows, entry.cols]));
  const started = await sizes();
  await typeLine(page, 'size');
  const read = await page.evaluate(() => ({ reported: window.__pty.log.sizeReports.at(-1) ?? null, grid: window.__engine.grid(), fit: window.__engine.measure(), renderers: window.__engine.renderers }));
  let cycled = [];
  if (vp === '1440x900') {
    // The panel hidden and shown: the DOM's renderer and then the GPU's again, the same cells.
    await page.click('[data-shell-part="panelToggle"]');
    await sleep(400);
    await page.click('[data-shell-part="panelToggle"]');
    await sleep(600);
    cycled = await sizes();
  }

  if (vp === '1440x900') {
    // The panel hidden and shown 40 times: one terminal, one GPU context (#698 item 15: the addon is made once for a terminal, not at every showing).
    const before = await page.evaluate(() => window.__gl.made);
    for (let cycle = 0; cycle < 40; cycle += 1) {
      await page.click('[data-shell-part="panelToggle"]');
      await sleep(60);
      await page.click('[data-shell-part="panelToggle"]');
      await sleep(120);
    }

    await sleep(300);
    const after = await page.evaluate(() => window.__gl.made);
    check('gpu.once', after - before === 0 && after <= 1, `${engine} ${vp}: ${String(before)} WebGL contexts were made before 40 hidings and showings of the panel and ${String(after)} after them (one terminal: at most 1, and none made by a showing)`);
    note(`gpu ${engine} ${vp}: ${String(after)} WebGL contexts after 40 hidings and showings of one terminal`);
  }

  check('resize.none', started.length === 1 && (vp !== '1440x900' || cycled.length === 1), `${engine} ${vp}: the log of sizes holds ${String(started.length)} after the start and ${vp === '1440x900' ? String(cycled.length) : 'no look'} after the panel was hidden and shown (the create call's, and nothing after it, is right): ${JSON.stringify(cycled.length > 0 ? cycled : started)}`);
  const same = (a, b) => a !== null && a !== undefined && a.rows === b.rows && a.cols === b.cols;
  check('resize.cells', same(read.reported, read.grid) && same(read.fit, read.grid) && started.length >= 1 && started[0][0] === read.grid.rows, `${engine} ${vp}: the shell reports ${JSON.stringify(read.reported)} (rows, columns), the emulator's grid is ${JSON.stringify(read.grid)} and the renderer in place measures ${JSON.stringify(read.fit)}, the create call's size ${JSON.stringify(started[0])}; renderers asked for: ${JSON.stringify(read.renderers)}`);
  note(`size ${engine} ${vp}: the create call carried ${JSON.stringify(started[0])} (rows, columns), the shell reports ${JSON.stringify(read.reported)}, the emulator's grid is ${JSON.stringify(read.grid)}; ${String(started.length - 1)} resizes after the create call${vp === '1440x900' ? `, ${String(cycled.length - 1)} after the panel was hidden and shown` : ''}`);
  report.numbers[`size ${engine} ${vp}`] = { started, cycled, ...read };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- order
/**
 * The input goes to the host as frames of ONE stream (docs/ui-next/terminal-channel-protocol.md section 4), and the order is the stream's: the keys and the sizes are applied in the order the page sent them, whatever time each takes to
 * arrive (`order.stream`: one stream was opened for the terminal, and what was sent was keys and a size). What is typed comes out of the shell in the order it was typed (`order.echo`) when the frames take up to 40 ms to arrive, each a different
 * time, with a size between the keys: by the host's own record every frame was applied (a frame the host took and did not apply is not a finished one), in the order they were sent, and the size the shell reports is the emulator's. A frame is sent
 * at once, whatever became of the one before it (`order.nowait`): with the host slow to apply a frame (1.5 s), the keys that follow are sent while it has not been applied.
 */
async function order(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await start(page);
  const LINE_TYPED = 'the quick brown fox jumps over the lazy dog 0123456789';
  // Frames that take up to 40 ms to arrive, each a different time, but in order: the transport is one ordered connection.
  await page.evaluate(() => {
    window.__pty.net.latency = 40;
  });
  const before = await page.evaluate(() => window.__pty.log.calls.length);
  await page.keyboard.type(LINE_TYPED.slice(0, 20));
  // A size between the keys: the panel's own splitter changes the height of the screen, and the feed sends the host the new size.
  await page.locator('[data-shell-part="panelHandle"]').focus();
  await page.evaluate(() => document.querySelector('[data-shell-part="panelHandle"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })));
  // The keys are typed as soon as the size frame is sent, and not at a time that was guessed.
  const sized = await page.waitForFunction((from) => window.__pty.log.calls.slice(from).some((call) => call.kind === 'resize'), before, { timeout: 10_000 }).then(() => true, () => false);
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type(LINE_TYPED.slice(20));
  // Every frame the host took is applied: a frame it took and did not apply is not a finished one, and the wait ends at one.
  const finished = await page
    .waitForFunction(
      ({ text, from }) => {
        const { calls, writes } = window.__pty.log;
        const mine = calls.slice(from);
        return mine.some((call) => call.outcome !== 'sent' && call.outcome !== 'applied') || (writes.join('').length >= text.length && mine.every((call) => call.outcome === 'applied'));
      },
      { text: LINE_TYPED, from: before },
      { timeout: 10_000 },
    )
    .then(() => true, () => false);
  // The line typed was never sent: the interrupt clears it, so that the command that follows is the command.
  await page.keyboard.press('Control+c');
  await typeLine(page, 'size');
  await page.waitForFunction(() => window.__pty.log.sizeReports.length > 0, null, { timeout: 5000 }).catch(() => undefined);
  const made = await page.evaluate((from) => ({
    calls: window.__pty.log.calls.slice(from).map((call) => ({ kind: call.kind, outcome: call.outcome, application: call.application })),
    applied: window.__pty.log.writes.join('').slice(0, 54),
    streams: window.__pty.log.streams,
    reported: window.__pty.log.sizeReports.at(-1) ?? null,
    grid: window.__engine.grid(),
    rows: [...document.querySelectorAll('.xterm-rows > div')].map((row) => (row.textContent ?? '').trimEnd()).filter((text) => text !== ''),
  }), before);
  const byApplication = made.calls.filter((call) => call.application !== null).map((call) => call.application);
  const sorted = byApplication.every((application, index) => index === 0 || application > byApplication[index - 1]);
  const unapplied = made.calls.filter((call) => call.application === null || call.outcome !== 'applied');
  check('order.stream', made.streams === 1 && made.calls.some((call) => call.kind === 'resize') && made.calls.some((call) => call.kind === 'write'), `${engine}: ${String(made.streams)} streams were opened for one terminal (one is right), and the frames sent were ${JSON.stringify(made.calls.map((call) => call.kind[0]))} (keys and a size)`);
  check(
    'order.echo',
    finished && sized && unapplied.length === 0 && made.calls.length > 0 && sorted && made.applied === LINE_TYPED && made.reported !== null && made.reported.rows === made.grid.rows && made.reported.cols === made.grid.cols,
    `${engine}: with frames that take another time each to arrive, the host applied ${String(byApplication.length)} of ${String(made.calls.length)} frames${unapplied.length === 0 ? '' : ` (not applied: ${JSON.stringify(unapplied.slice(0, 4).map((call) => `${call.kind[0]} ${call.outcome}`))})`} ${sorted ? 'in the order they were sent' : 'NOT in the order they were sent'}, the shell was given ${JSON.stringify(made.applied)} (${JSON.stringify(LINE_TYPED)} was typed), the shell reports a size of ${JSON.stringify(made.reported)} and the emulator's grid is ${JSON.stringify(made.grid)}${finished ? '' : '; the frames were not all applied in 10 s'}${sized ? '' : '; no size frame was sent'}`,
  );
  // The host is slow to apply the next frame (1.5 s) and the frames no longer take their time to arrive: a key typed meanwhile is sent at once.
  await page.evaluate(() => { window.__pty.net.latency = 0; window.__pty.net.hold = { calls: 1, ms: 1500 }; });
  const mark = await page.evaluate(() => window.__pty.log.calls.length);
  await page.keyboard.press('Control+c');
  await page.keyboard.type('xy');
  const slow = await page
    .waitForFunction((from) => (window.__pty.log.calls.length - from >= 3 ? window.__pty.log.calls.slice(from).map((call) => ({ kind: call.kind, appliedWhenSent: call.appliedWhenSent })) : null), mark, { timeout: 5000 })
    .then((handle) => handle.jsonValue(), () => []);
  // Read from what the page recorded at each send, and not from a look at the log: the third frame was sent while none of the three had been applied, however late the probe looks.
  check('order.nowait', slow.length >= 3 && slow[2].appliedWhenSent === slow[0].appliedWhenSent, `${engine}: with the host slow to apply a frame, ${String(slow.length)} frames were sent (3 or more is right: the one it is slow with and the keys behind it) while ${String((slow[2]?.appliedWhenSent ?? 0) - (slow[0]?.appliedWhenSent ?? 0))} of them had been applied when the third was sent (none is right)`);
  note(`order ${engine}: ${String(made.calls.length)} frames on ${String(made.streams)} stream, applied in the order they were sent, the shell was given the line typed in the order it was typed; with the first of three frames slow, ${String(slow.length)} were sent`);
  report.numbers[`order ${engine}`] = { calls: made.calls, slow };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- hidden
/**
 * What a page did in a window of time, from the counters of `COUNTERS` (frames and timers it asked for, callbacks that ran, the time they took, the longest of them, the long tasks of Chromium) and from the document's mutations
 * told apart: the page's own, and those inside the emulator's element (xterm's character measure element, its scrollbar and its input). `beginWindow` starts it and `endWindow` answers it.
 */
const beginWindow = (page) =>
  page.evaluate(() => {
    window.__mutations = { page: 0, xterm: 0, first: null };
    window.__observer = new MutationObserver((list) => {
      for (const record of list) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest('.xterm') != null) window.__mutations.xterm += 1;
        else {
          window.__mutations.page += 1;
          window.__mutations.first ??= `${record.type} ${target?.tagName ?? '?'}${record.attributeName === null ? '' : ` ${record.attributeName}`}`;
        }
      }
    });
    window.__observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    Object.assign(window.__count, { timeout: 0, interval: 0, raf: 0, fired: 0, frames: 0, busy: 0, longest: 0, on: true });
    if (window.__longtasks !== null) window.__longtasks.length = 0;
  });
const endWindow = (page) =>
  page.evaluate(() => {
    window.__count.on = false;
    window.__observer.disconnect();
    for (const entry of window.__po?.takeRecords() ?? []) window.__longtasks.push(entry.duration);
    const { timeout, interval, raf, fired, frames, busy, longest } = window.__count;
    return { timeout, interval, raf, fired, frames, busy, longest, mutations: window.__mutations, longtasks: window.__longtasks === null ? null : [...window.__longtasks] };
  });

/** The main thread's own account of its work, from the browser (Chromium only): the milliseconds of every task, of the scripts in them, of layout and of style recalculation, since the page began. */
async function metricsOf(cdp) {
  if (cdp === null) return null;
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (name) => (metrics.find((metric) => metric.name === name)?.value ?? 0) * 1000;
  return { task: get('TaskDuration'), script: get('ScriptDuration'), layout: get('LayoutDuration'), style: get('RecalcStyleDuration') };
}

/**
 * The shell writes `events` numbered events of 1,000 B while the panel is hidden, in one task (a build that prints a great deal in a session that is not shown): the host delivers what is under its mark in that task and the rest
 * waits, and the page, which goes on reading, parsing and acknowledging while it is hidden (`FLOW.hiddenFrame` bytes a frame), gives the host the credit to deliver it. What came before settles first (`calm`, which has its own
 * limit and its own words), and the baseline of the credit is read in the task that starts the burst, so that nothing that was still on its way is counted in it. Answers what the host delivered and the page took in, waited for by
 * what still moves (the account of every byte and the page's own at rest), what the page did meanwhile (`during`) and the browser's own count of the task time (`browser`). `perturb('flood')` runs before anything is counted.
 */
async function flooded(page, { events }, { cdp, perturb }) {
  const bytes = events * EVENT_BYTES;
  const calmed = await calm(page);
  await page.evaluate(() => { window.__phase = 'flood'; });
  await perturb?.('flood');
  const m0 = await metricsOf(cdp);
  await beginWindow(page);
  const { before, burst } = await page.evaluate((count) => ({ before: window.__credit(), burst: window.__pty.burst(window.__pty.ids()[0], count) }), events);
  const settled = await quiet(page, (state) => state.waiting === 0 && state.delivered - before.delivered === bytes && state.acked === state.delivered && state.accepted - before.accepted === bytes && state.parsed === state.accepted, { limit: 60_000 });
  const during = await endWindow(page);
  const m1 = await metricsOf(cdp);
  await page.evaluate(() => { window.__phase = 'settle'; });
  const checked = await page.evaluate(() => window.__engine.order);
  return { bytes, events, calm: calmed, before, burst, settled, during, checked, browser: m0 === null || m1 === null ? null : { task: m1.task - m0.task, script: m1.script - m0.script, layout: m1.layout - m0.layout, style: m1.style - m0.style } };
}

/**
 * The hidden terminal at rest, once everything the shell wrote has been taken in: xterm hides its scrollbar 800 ms after the last line scrolled and refreshes once more, so the page is left alone for 1.5 s, and then a window of 1.2 s
 * is counted. `perturb('rest')` runs before it.
 */
async function resting(page, perturb) {
  await sleep(1500);
  await page.evaluate(() => { window.__phase = 'rest'; });
  await perturb?.('rest');
  await beginWindow(page);
  await sleep(1200);
  const during = await endWindow(page);
  await page.evaluate(() => { window.__phase = 'done'; });
  return during;
}

/** What the page's acknowledgements were, one by one, against what it had parsed at the instant of each: the ones made before the bytes they acknowledge were parsed. */
const earlyAcks = (page) => page.evaluate(() => window.__pty.log.ackState.filter((state) => state.after > state.parsed).map((state) => `${String(state.after)} acknowledged with ${String(state.parsed)} parsed`));

/**
 * A hidden terminal goes on taking in what its shell writes (docs/ui-next/status/T1-go.md 2.8.6, docs/ui-next/status/T2a.md): it reads, parses and acknowledges in frames of a smaller share, and draws nothing, so the host never pauses a shell that
 * is not shown for good, and the shell of a build in a session that is not shown goes on. The panel is hidden and the shell writes 2 MB and then 20 MB in one task each, and, for each: every byte is delivered, parsed and
 * acknowledged, and the host has no pause left (`flow.hidden`); the emulator was given every byte in the order the shell wrote them (`hidden.drain`: the numbered events are where they belong); in a number of frames that follows from the bytes
 * (`hidden.frames`: a frame takes `FLOW.hiddenFrame` bytes, and what xterm asks for besides is counted too); in callbacks that are bounded in number, in their time added up and in the longest of them (`hidden.work`); and the page's own
 * document is not touched while xterm's own is bounded (`hidden.draws`: xterm measures and updates its scrollbar in a hidden element, which costs mutations that grow with what it is given). No byte is acknowledged before it was
 * parsed (`flow.paced`). Once everything is in, the page is at rest: no frame, no timer, no change (`hidden.rest`). The bounds are counts, and times that keep at least 3 times the laptop's figure and 1.5 times the worst the runner showed (the comment above `hidden.work`).
 */
async function hidden(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  // The host's window is turned on with the stream: the first acknowledgement, of nothing yet, is made as soon as the host's ready is read, before any byte of the shell's was given to the emulator or parsed.
  const first = await page.evaluate(() => window.__pty.log.ackState[0] ?? null);
  check('flow.on', first !== null && first.count === 0 && first.exists && first.accepted === 0 && first.parsed === 0, `${engine}: the first acknowledgement was ${JSON.stringify(first)}: it must be made with the stream (count 0, the host's ready read) before any byte was given to the emulator or parsed`);
  await typeLine(page, 'hello');
  const cdp = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
  await cdp?.send('Performance.enable');
  if (cdp !== null && SLOWDOWN > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
    note(`hidden ${engine}: the main thread is slowed ${String(SLOWDOWN)} times (CPU_SLOWDOWN: a proof, no unit of CI sets it)`);
  }
  await page.click('[data-shell-part="panelToggle"]');
  await sleep(400);
  const hooks = { cdp, perturb: (stage) => perturb(ctx, page, stage) };
  const runs = [];
  for (const flood of FLOODS) {
    const run = await flooded(page, flood, hooks);
    runs.push({ ...flood, ...run });
    const { bytes, events, calm: calmed, before, burst, settled, during, checked } = run;
    const MB = bytes / 1_000_000;
    const units = bytes / FLOW.hiddenFrame;
    const gained = { delivered: settled.delivered - before.delivered, accepted: settled.accepted - before.accepted, acked: settled.acked - before.acked };
    const tag = `${engine}, ${flood.name} written while the panel was hidden`;
    check('flow.hidden', calmed.calm && gained.delivered === bytes && settled.waiting === 0 && settled.paused === false && gained.acked === bytes, `${tag}: ${calmed.calm ? '' : `what came before the burst was still moving after ${String(calmed.waited)} ms (${JSON.stringify(calmed.last)}), so there was no baseline to count it from; `}the burst took the host ${burst.paused ? 'past its mark, to a pause' : 'to no pause'} (${String(burst.waiting)} B waiting in the pty), and then ${String(gained.delivered)} of ${String(bytes)} B were delivered, ${String(gained.acked)} acknowledged, ${String(settled.waiting)} B still wait in the pty and the host is ${settled.paused ? 'paused' : 'not paused'}`);
    check('hidden.drain', gained.accepted === gained.delivered && settled.parsed === settled.accepted && checked.bad === 0 && checked.checked >= Math.floor((gained.delivered / EVENT_BYTES) * 0.9), `${tag}: the emulator was given ${String(gained.accepted)} of the ${String(gained.delivered)} B delivered and parsed ${String(settled.parsed)} of ${String(settled.accepted)}, ${String(checked.bad)} of ${String(checked.checked)} numbered events looked at were not where they belong${checked.first === null ? '' : ` (first: ${JSON.stringify(checked.first)})`}`);
    // What the page takes in follows from the bytes AND from how many frames the host delivered them in: the stream hands the page one frame in a task of its own (at most 64 KiB, and at most the credit the page's acknowledgements left), and the page asks for about one frame of its own for each one it is handed.
    const deliveries = settled.frames - before.frames;
    const frames = Math.ceil(1.5 * units) + 80 + deliveries;
    check('hidden.frames', during.raf <= frames, `${tag}: the page asked for ${String(during.raf)} frames to take it in (${String(frames)} at most: 1.5 times the ${String(Math.round(units * 10) / 10)} frames of ${String(FLOW.hiddenFrame)} B the bytes need, 80, and 1 for each of the ${String(deliveries)} output frames the host delivered)`);
    const timers = Math.ceil(5 * units) + 40;
    const ran = during.fired - during.frames;
    const busy = 80 * MB + 250;
    // The bounds that are times come from the runner, not the laptop (docs/ui-next/status/PT2/terminal-samples.txt: 228 processes of this section in the logs of 21 runs of the kit probes workflow on 2026-11-24, in Chromium, and WebKit in the 21 of the probe
    // itself); each keeps at least 1.5 times the worst the runner showed, and 3 times the laptop's. A CALLBACK (a timer or a frame, the page's or xterm's), 2 MB burst: 13.2 to 45.7 ms, median 18.3, in Chromium and 17 to 33 ms in WebKit; 90 ms is 2.0 and
    // 2.7 times the worst and 4.9 times the median (it was 60: 1.3 times). The TIME ADDED UP, 2 MB burst: 54 to 156 ms in Chromium and 126 to 249 in WebKit; 410 is 2.6 and 1.65 times the worst (it was 310: 1.2 times in WebKit); 20 MB burst: 270 to 571 ms
    // and 587 to 1,065; 1,850 is 3.2 and 1.7 times the worst. A LONG TASK (the browser's own count, 50 ms and over): none in the 205 runs of the 20 MB burst without `draw-hidden`, none in the 205 of the 2 MB burst without `hidden-burn`. The 20 MB burst is
    // one task of the fixture's own, the shell writing the bytes: 74.5 to 157.8 ms on the runner in 228 runs (the laptop: 34 ms), and the browser reported it in none of the 205 without `draw-hidden` and in 23 of its 23, where the 20,000 changes it makes to the
    // page's document run the probe's own observer in that same task. That burst took 76.3 to 129.3 ms, median 99.4, and the old bound of 120 ms failed it 5 times in 23 (long tasks of 124, 126, 127, 128 and 130 ms; one job read 129.3 ms and, rerun, 82.8, another
    // 126.3 and 81.7). 250 ms is 1.9 times the worst of those, 2.5 times their median and 1.6 times the longest burst of any control; a task of 250 ms takes in 8.7 MB at the runner's worst cost of 28.6 ms a MB, more than 8 times the 1 MiB the host lets stay
    // unacknowledged. Each of the two has an assertion and a control that only it sees (`hidden.work`, `hidden.longtask`): `hidden-burn` holds a callback for 150 ms (over 90, under 250) and `hidden-long-task` holds the thread for 400 ms where no callback shows it (over 250).
    const longestCallback = 90;
    const longestTask = 250;
    const longtask = during.longtasks === null ? 0 : Math.max(0, ...during.longtasks);
    check('hidden.work', ran <= timers && during.busy <= busy && during.longest <= longestCallback, `${tag}: ${String(ran)} timer callbacks ran (${String(timers)} at most: xterm's own write timers), the callbacks of the page and of xterm took ${String(round(during.busy))} ms in all (${String(busy)} at most), the longest ${String(round(during.longest))} ms (${String(longestCallback)} at most)`);
    // The browser's own count of a task that held the main thread, which no callback shows (Chromium): its own assertion, so that a control for it trips it and not the sum of the callbacks.
    if (during.longtasks !== null) check('hidden.longtask', longtask <= longestTask, `${tag}: the longest long task was ${String(round(longtask))} ms (${String(longestTask)} at most)`);
    // xterm measures and updates its scrollbar for each write it is given, so its changes grow with the bytes and with the frames they came in: 6000 a MB and 20 for each output frame.
    const draws = Math.ceil(6000 * MB) + 5000 + 20 * deliveries;
    note(`hidden ${engine}, ${flood.name}: ${String(deliveries)} output frames reached the page for ${String(bytes)} B`);
    check('hidden.draws', during.mutations.page <= 2 && during.mutations.xterm <= draws, `${tag}: the page's own document changed ${String(during.mutations.page)} times (2 at most${during.mutations.first === null ? '' : `: ${during.mutations.first}`}), xterm's own ${String(during.mutations.xterm)} times (${String(draws)} at most: 6000 a MB, 5000, and 20 for each of the ${String(deliveries)} output frames)`);
    note(`hidden ${engine}${MODE}, ${flood.name} written while the panel was hidden: the host paused at its mark after ${String(burst.delivered)} B with ${String(burst.waiting)} B waiting, and everything was delivered, parsed and acknowledged (${String(settled.acks - before.acks)} acknowledgements, never more than ${String(settled.maxUnacked)} B unacknowledged); the page asked for ${String(during.raf)} frames and ${String(during.timeout)} timers, ${String(during.fired)} callbacks ran in ${String(round(during.busy))} ms (the longest ${String(round(during.longest))} ms${during.longtasks === null ? '' : `, ${String(during.longtasks.length)} long tasks`})${run.browser === null ? '' : `, the browser counts ${String(round(run.browser.task))} ms of tasks (${String(round(run.browser.script))} ms of script, ${String(round(run.browser.layout + run.browser.style))} ms of layout and style)`}; ${String(during.mutations.page)} changes of the page's document and ${String(during.mutations.xterm)} of xterm's own; the burst took ${String(round(burst.ms))} ms of the page's task`);
  }

  const early = await earlyAcks(page);
  check('flow.paced', early.length === 0, `${engine}: ${String(early.length)} acknowledgements were made before the bytes they acknowledge were parsed (none is right): ${JSON.stringify(early.slice(0, 3))}`);
  const rest = await resting(page, hooks.perturb);
  check('hidden.rest', rest.raf === 0 && rest.timeout === 0 && rest.interval === 0 && rest.fired === 0 && rest.mutations.page === 0 && rest.mutations.xterm === 0, `${engine}: once everything was taken in the hidden page asked for ${String(rest.raf)} frames and ${String(rest.timeout)} timeouts and ${String(rest.interval)} intervals in 1.2 s, ${String(rest.fired)} callbacks ran, and the document changed ${String(rest.mutations.page)} times (xterm's own ${String(rest.mutations.xterm)}): none is right`);
  note(`hidden ${engine}${MODE}: at rest, 1.2 s: ${String(rest.raf)} frames, ${String(rest.timeout)} timeouts, ${String(rest.interval)} intervals, ${String(rest.fired)} callbacks, ${String(rest.mutations.page + rest.mutations.xterm)} changes of the document`);
  report.numbers[`hidden ${engine}`] = { runs: runs.map(({ name, burst, settled, during, browser: counted }) => ({ name, burst, acks: settled.acks, maxUnacked: settled.maxUnacked, during, browser: counted })), rest };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- bundle
async function bundle(ctx) {
  const { browser, origin, viewport, engine, dist } = ctx;
  if (ctx.vp !== '1440x900') return;
  const assets = path.join(dist, 'assets');
  const files = readdirSync(assets);
  const entry = files.find((name) => /^terminal-fixture-.*\.js$/.test(name));
  const lazy = files.find((name) => /^xtermEngine-.*\.js$/.test(name));
  const css = files.filter((name) => name.endsWith('.css'));
  const entrySource = readFileSync(path.join(assets, entry), 'utf8');
  const lazySource = readFileSync(path.join(assets, lazy), 'utf8');
  const MARK = 'xterm-helper-textarea';
  // The host's own rules for the screen name `.xterm` and `.xterm-viewport` (its overrides); the emulator's own rules (the helper textarea, the measure element) arrive with its chunk.
  const styled = css.some((name) => /\.xterm-(?:helper-textarea|char-measure-element|decoration|accessibility)/.test(readFileSync(path.join(assets, name), 'utf8')));
  check('bundle.entry', !entrySource.includes(MARK) && lazySource.includes(MARK) && !styled, `${engine}: the emulator is in the entry chunk or the entry stylesheet (entry ${String(entrySource.includes(MARK))}, lazy ${String(lazySource.includes(MARK))}, stylesheet ${String(styled)})`);
  if (engine === engineNames[0]) note(`bundle: entry ${String(entrySource.length)} B, xtermEngine ${String(lazySource.length)} B, addon-webgl ${String(files.filter((name) => /^addon-webgl/.test(name)).map((name) => readFileSync(path.join(assets, name)).length).join(','))} B`);
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await ctx.control?.after?.(page, `${origin}/assets/${lazy}`);
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await sleep(500);
  const early = page.requests.filter((request) => /xtermEngine|addon-webgl/.test(request.url));
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => /xtermEngine|addon-webgl/.test(entry.name)).length);
  check('bundle.lazy', early.length === 0 && resources === 0, `${engine}: the emulator was requested before the first terminal (${String(early.length)} requests, ${String(resources)} resource entries)`);
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await sleep(500);
  check('bundle.fetched', page.requests.some((request) => /xtermEngine/.test(request.url)), `${engine}: the emulator was not requested when the first terminal opened`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- idle
/**
 * An idle terminal on screen: a second of rest, then three seconds in which the page's timers, frames and callbacks are counted (and the commits of React's Profiler, which only a development build has). `perturb` runs after
 * the second of rest, before the count starts.
 */
async function sitIdle(page, perturb) {
  await sleep(1200);
  await perturb?.();
  await page.evaluate(() => {
    window.__count.timeout = 0;
    window.__count.interval = 0;
    window.__count.raf = 0;
    window.__count.fired = 0;
    window.__count.on = true;
  });
  await sleep(3000);
  return page.evaluate(() => {
    window.__count.on = false;
    return { ...window.__count, commits: window.__commits.length };
  });
}

async function idle(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  // The intervals the page runs with the panel open and no terminal: the shell's own. A terminal adds none.
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await sleep(500);
  const baseline = await page.evaluate(() => window.__count.active);
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine.writes > 0);
  if (READER === 'on') await switchReader(page);
  await typeLine(page, 'hello');
  const counts = await sitIdle(page, () => ctx.control?.after?.(page));
  if (counts.fired > 0) note(`idle ${engine}: the callbacks that fired: ${JSON.stringify(counts.what)}`);
  const nodes = await page.evaluate(() => document.querySelector('[data-shell-part="terminalScreen"]').querySelectorAll('*').length);
  check('idle.timers', counts.timeout === 0 && counts.interval === 0 && counts.raf === 0 && counts.fired === 0 && counts.active === baseline, `${engine}: an idle terminal started ${String(counts.timeout)} timeouts, ${String(counts.interval)} intervals and asked for ${String(counts.raf)} frames in 3 s, ${String(counts.fired)} callbacks fired, and ${String(counts.active - baseline)} intervals are alive that the panel without a terminal does not have`);
  note(`idle ${engine}${MODE}: 3 s on screen: ${String(counts.timeout)} timeouts, ${String(counts.interval)} intervals, ${String(counts.raf)} frames, ${String(counts.fired)} callbacks fired; ${String(counts.active - baseline)} intervals more than the panel without a terminal; the screen holds ${String(nodes)} nodes`);
  report.numbers[`idle ${engine}`] = { ...counts, baseline, nodes };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- commits (development build)
async function commits(ctx) {
  const { browser, devOrigin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, devOrigin, viewport, { control: ctx.control });
  await start(page);
  await typeLine(page, 'hello');
  await sleep(1200);
  const idleBefore = await page.evaluate(() => window.__commits.length);
  await sleep(3000);
  const idleAfter = await page.evaluate(() => window.__commits.length);
  check('idle.commits', idleAfter === idleBefore, `${engine}: an idle terminal rendered ${String(idleAfter - idleBefore)} commits in 3 s`);
  const before = await page.evaluate(() => window.__commits.length);
  // 500 chunks of the shell's output, a chunk every 4 ms, to a terminal that is on screen.
  await page.evaluate(async () => {
    const id = window.__pty.ids()[0];
    for (let n = 0; n < 500; n += 1) {
      window.__pty.out(id, `line ${n} ${'x'.repeat(70)}\r\n`);
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
  });
  await sleep(600);
  const after = await page.evaluate(() => window.__commits.length);
  check('commits.chunk', after - before <= 0, `${engine}: 500 chunks of output rendered ${String(after - before)} React commits`);
  note(`commits ${engine}${MODE}: 500 chunks on screen: ${String(after - before)} commits; idle 3 s: ${String(idleAfter - idleBefore)} commits`);
  report.numbers[`commits ${engine}`] = { chunk: after - before, idle: idleAfter - idleBefore };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- flood
async function flood(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  await page.evaluate(() => {
    window.__frames = [];
    window.__framesOn = true;
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__framesOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__longtasks = window.__longtasks === null ? null : [];
  });
  await perturb(ctx, page, 'sample');
  const base = await page.evaluate(() => ({ accepted: window.__engine.accepted, parsed: window.__engine.parsed, mark: window.__frames.length }));
  const t0 = Date.now();
  await typeLine(page, 'flood 200000 80');
  // The shell has written it all and the host has delivered it all (a flood ends when everything it wrote was delivered); the page still holds what it has not taken from the feed (a frame takes 512 KiB at most, a slow one less)
  // until it has parsed and acknowledged it. Waited for by what still moves, never by a clock: a slow drain is waited for, and bytes that were lost leave the numbers below apart (they are checked exactly).
  const settled = await quiet(page, (state) => state.floods === 1 && state.waiting === 0 && state.acked === state.delivered && state.parsed === state.accepted, { limit: 120_000 });
  const seconds = (Date.now() - t0) / 1000;
  const result = await page.evaluate((mark) => {
    window.__framesOn = false;
    return { frames: window.__frames.slice(mark), accepted: window.__engine.accepted, parsed: window.__engine.parsed, writes: window.__engine.writes, flood: window.__pty.log.floods[0], longtasks: window.__longtasks };
  }, base.mark);
  const p50 = percentile(result.frames, 50);
  const p95 = percentile(result.frames, 95);
  const max = result.frames.length === 0 ? 0 : Math.max(...result.frames);
  // A COUNT, not a percentile of milliseconds, so that a slower machine does not move the line: a frame that took more than two frames at 60 Hz (34 ms) is a late one, and a tenth of them at most may be (the laptop has none to one in 300).
  const late = result.frames.filter((frame) => frame > 34).length;
  // The emulator's counters are lifetime totals (the banner, the echo of the command, the prompts): the flood's own are what they gained from the command on, and they are the flood's bytes and at most 256 B of echo and prompt.
  const gained = result.accepted - base.accepted;
  const parsedGained = result.parsed - base.parsed;
  check('flood.complete', (result.flood?.bytes ?? 0) >= 16_000_000 && gained >= result.flood.bytes && gained - result.flood.bytes <= 256 && parsedGained === gained, `${engine}: the flood was ${String(result.flood?.bytes)} B; from the command on the emulator accepted ${String(gained)} B (the flood and at most 256 B of echo and prompt) and parsed ${String(parsedGained)}`);
  // The credit, exactly (docs/ui-next/terminal-channel-protocol.md section 7): every byte the host delivered was given to the emulator, parsed and acknowledged once (the counts of the acknowledgements add up to what was delivered, which is what was parsed: nothing is dropped and nothing is
  // acknowledged twice), and the host never had more than its window, `FLOW.inflight`, sent and not acknowledged.
  check('flow.exact', settled.acked === settled.delivered && settled.delivered === settled.parsed && settled.parsed === settled.accepted && settled.maxUnacked <= FLOW.inflight, `${engine}: the host delivered ${String(settled.delivered)} B, the emulator was given ${String(settled.accepted)} and parsed ${String(settled.parsed)}, the page acknowledged ${String(settled.acked)} B in ${String(settled.acks)} frames, and the host never had more than ${String(settled.maxUnacked)} B sent and not acknowledged (${String(FLOW.inflight)} at most)`);
  // The sample is the frames from the command on, none of them thrown away. A flood of N bytes cannot be taken in fewer than N / `FLOW.frame` frames (a frame takes that many bytes at most while the screen is shown), so a sample with fewer has
  // lost some, and one with no frames proves nothing: it does not pass.
  const needed = Math.max(1, Math.floor((result.flood?.bytes ?? 0) / FLOW.frame));
  check('flood.frames', result.frames.length >= needed && late <= Math.floor(result.frames.length / 10), `${engine}: ${String(late)} of ${String(result.frames.length)} frames took longer than 34 ms (two frames at 60 Hz) during a 16 MB flood (a tenth at most), and the sample holds ${String(result.frames.length)} frames (${String(needed)} at least: ${String(FLOW.frame)} B is the most a frame takes); p50 ${String(round(p50))} ms, p95 ${String(round(p95))} ms, max ${String(round(max))} ms`);
  if (result.longtasks !== null) check('flood.longtask', Math.max(0, ...result.longtasks) <= 120, `${engine}: the longest task was ${String(round(Math.max(0, ...result.longtasks)))} ms (120 ms at most): ${JSON.stringify(result.longtasks.slice(0, 8))}`);
  note(`flood ${engine}${MODE}: ${String(result.flood?.bytes)} B in ${String(round(seconds))} s, ${String(result.frames.length)} frames, ${String(late)} later than 34 ms: p50 ${String(round(p50))} ms, p95 ${String(round(p95))} ms, max ${String(round(max))} ms; ${String(result.writes)} writes, ${String(settled.acks)} acknowledgements, never more than ${String(settled.maxUnacked)} B delivered and not acknowledged${result.longtasks === null ? '' : `, ${String(result.longtasks.length)} long tasks, longest ${String(round(Math.max(0, ...result.longtasks)))} ms`}`);
  report.numbers[`flood ${engine}`] = { seconds, p50, p95, max, late, frames: result.frames.length, writes: result.writes, longtasks: result.longtasks, acks: settled.acks, maxUnacked: settled.maxUnacked };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- latency
async function latency(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  /** Types `count` keys 80 ms apart and answers the delay of each, from the instant the browser made the key event to the instant the shell was given what it meant. */
  const typeAndMeasure = async (count) => {
    await page.evaluate(() => {
      window.__keydowns.length = 0;
      window.__pty.log.writeAt.length = 0;
    });
    for (let n = 0; n < count; n += 1) {
      await page.keyboard.press(String.fromCharCode(97 + (n % 26)));
      await sleep(80);
    }

    await sleep(300);
    return page.evaluate(() => window.__keydowns.map((down, index) => (window.__pty.log.writeAt[index] ?? NaN) - down));
  };
  const idleDelays = await typeAndMeasure(30);
  const p95 = percentile(idleDelays, 95);
  check('latency.idle', idleDelays.length === 30 && idleDelays.every(Number.isFinite) && p95 <= 50, `${engine}: idle, a key took p50 ${String(round(percentile(idleDelays, 50)))} ms and p95 ${String(round(p95))} ms to reach the process (p95 must be 50 ms or less)`);
  // Under a flood: the shell is writing 82 MB (1,000,000 lines) while the person types, so it is still writing when the last key is pressed (asserted). The idle sample left its letters in the shell's line, so Control C clears it,
  // or the command would be "abcd...flood" and no flood would start. The flood's start is recorded by the shell, and so is its end: both are asserted.
  await page.keyboard.press('Control+c');
  await sleep(200);
  await page.keyboard.type('flood Infinity 80');
  await page.keyboard.press('Enter');
  await sleep(1500);
  const startedBefore = await page.evaluate(() => window.__pty.log.floodStarts.length);
  const floodDelays = await typeAndMeasure(20);
  const stillFlooding = await page.evaluate(() => window.__pty.log.floodStarts.length === 1 && window.__pty.log.floods.length === 0);
  check('latency.premise', startedBefore === 1 && stillFlooding, `${engine}: ${String(startedBefore)} flood(s) had started before the keys were pressed and the flood was ${stillFlooding ? '' : 'not '}still running after the last one: otherwise the numbers say nothing about a flood`);
  const floodP95 = percentile(floodDelays, 95);
  check('latency.flood', floodDelays.length === 20 && floodDelays.every(Number.isFinite) && floodP95 <= 100, `${engine}: under a flood, a key took p50 ${String(round(percentile(floodDelays, 50)))} ms and p95 ${String(round(floodP95))} ms to reach the process (p95 must be 100 ms or less)`);
  note(`latency ${engine}: idle p50 ${String(round(percentile(idleDelays, 50)))} ms p95 ${String(round(p95))} ms; under flood p50 ${String(round(percentile(floodDelays, 50)))} ms p95 ${String(round(floodP95))} ms`);
  report.numbers[`latency ${engine}`] = { idle: idleDelays, flood: floodDelays };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- axe
async function axe(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom' });
  await page.addScriptTag({ path: AXE });
  // axe is run on the tool's part of the DOM, as the palette probe runs it on its dialog.
  const run = (selector) => runAxe(page, selector);
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  const empty = await run('[data-shell-part="panelEmpty"]');
  check('axe.empty', empty.length === 0, `${engine}: the empty tool: ${JSON.stringify(empty)}`);
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea');
  await sleep(700);
  await typeLine(page, 'hello');
  await sleep(300);
  const running = await run('[data-shell-part="terminalBody"]');
  check('axe.running', running.length === 0, `${engine}: the running terminal, with its input and its output: ${JSON.stringify(running)}`);
  await typeLine(page, 'exit 3');
  await sleep(500);
  const ended = await run('[data-shell-part="terminalBody"]');
  check('axe.ended', ended.length === 0, `${engine}: the terminal, with its ended lane (the exit code) and the exit line in the transcript: ${JSON.stringify(ended)}`);
  // A second terminal, from the strip's plus, runs a program: closing it asks, and names the program.
  await page.locator('[data-shell-part="sessionAdd"]').click();
  await page.waitForFunction(() => window.__pty.log.created.length === 2);
  await sleep(700);
  await typeLine(page, 'sleep 30');
  await page.locator('[data-shell-part="sessionClose"]').last().click();
  await page.getByRole('alertdialog').waitFor();
  const question = await run('dialog[role="alertdialog"]');
  check('axe.question', question.length === 0, `${engine}: the question: ${JSON.stringify(question)}`);
  await page.context().close();
  // A start the host refused: the lane names it and the transcript says where the host looked.
  const refused = await open(browser, origin, viewport, { query: 'renderer=dom&fail=shell-unavailable' });
  await refused.addScriptTag({ path: AXE });
  await startRefused(refused);
  await perturb(ctx, refused, 'unavailable');
  const unavailable = await runAxe(refused, '[data-shell-part="terminalBody"]');
  check('axe.unavailable', unavailable.length === 0, `${engine}: the terminal whose shell could not be started, with its lane and the host's words in the transcript: ${JSON.stringify(unavailable)}`);
  await refused.context().close();
}

// ---------------------------------------------------------------------------------------------------- memory
/** The lines kept above the screen (`SCROLLBACK` of screen.ts): the cap the memory section proves. The mock keeps 2,000 rows of transcript (`TERM_CAP`, shell-panel.js 1071). */
const SCROLLBACK = 5000;

/**
 * A million lines of 80 columns (82 MB) through the shell, in the DOM renderer so the lines are text: every byte is parsed, and then the screen is scrolled to the top of what the emulator kept. The first line it still has is
 * the line the cap leaves (`memory.cap`: the last SCROLLBACK lines and the screen, no more and no fewer), which is what holds the memory of a terminal to a number (the Chromium heap is read where the engine says it, `memory.heap`).
 */
async function memory(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await start(page);
  // The JS heap, after a collection, from the devtools protocol (Chromium only: `performance.memory` is rounded and WebKit has no such number).
  const cdp = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
  const heap = async () => {
    if (cdp === null) return null;
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  const heapBefore = await heap();
  const t0 = Date.now();
  await typeLine(page, 'flood 1000000 80');
  // The shell has written it all, the host has delivered it all, and the page has been given every byte, parsed it and acknowledged it: waited for by what still moves, never by a clock, so a slow machine is waited for and a stuck page is not. First the
  // host's flood is over and nothing is left in its pty, and then the page has taken in what it was delivered (a few seconds at most, and a page that does not is not waited for long).
  await quiet(page, (state) => state.floods === 1 && state.waiting === 0, { stall: 10_000, limit: 240_000 });
  const settled = await quiet(page, (state) => state.acked === state.delivered && state.parsed === state.accepted, { stall: 2500, limit: 60_000 });
  // The memory is measured of a terminal that took the flood in: the host completed it, nothing is left in its pty, and every byte it delivered was given to the emulator, parsed and acknowledged once. Otherwise there is nothing to measure.
  check('memory.drained', settled.floods === 1 && settled.waiting === 0 && settled.delivered === settled.accepted && settled.accepted === settled.parsed && settled.parsed === settled.acked, `${engine}: before the memory was measured the host had completed ${String(settled.floods)} of 1 floods and ${String(settled.waiting)} B waited in its pty (none is right), it delivered ${String(settled.delivered)} B, the emulator was given ${String(settled.accepted)}, parsed ${String(settled.parsed)}, and the page acknowledged ${String(settled.acked)} (all four equal is right)`);
  const seconds = (Date.now() - t0) / 1000;
  await sleep(500);
  const rows = await page.evaluate(() => document.querySelectorAll('.xterm-rows > div').length);
  const heapAfter = await heap();
  const firstLine = () => page.evaluate(() => /^(\d{7})/.exec(document.querySelector('.xterm-rows > div')?.textContent ?? '')?.[1] ?? null);
  // Shift+PageUp is the emulator's own key for a page up in its scrollback: a page a press until the top, which stops moving (a wheel moves three lines a notch in Chromium and all of it in WebKit).
  let oldest = await firstLine();
  // The top is where three samples in a row, 50 presses apart, are the same line: one still sample is a frame that was drawn late or a press that was lost, and stopping on it measures a buffer that is not the whole one (seen once in a whole run: 624 lines short).
  let still = 0;
  for (let step = 0; step < 1400 && still < 3; step += 1) {
    await page.keyboard.press('Shift+PageUp');
    if (step % 50 === 49) {
      const now = await firstLine();
      still = now === oldest ? still + 1 : 0;
      oldest = now;
    }
  }

  oldest = await firstLine();
  // The buffer holds the banner, the command line, the million lines and the last prompt: it keeps the last SCROLLBACK + rows of them, so the oldest line of the flood it has is 1,000,000 + 1 - SCROLLBACK - rows.
  const expected = 1_000_000 + 1 - SCROLLBACK - rows;
  check('memory.cap', oldest !== null && Math.abs(Number(oldest) - expected) <= 3, `${engine}: after 1,000,000 lines the oldest line the emulator kept is ${String(oldest)}, the cap of ${String(SCROLLBACK)} lines and ${String(rows)} rows leaves ${String(expected)}`);
  if (heapBefore !== null && heapAfter !== null) check('memory.heap', heapAfter - heapBefore <= 60 * 1024 * 1024, `${engine}: the JS heap grew ${String(Math.round((heapAfter - heapBefore) / 1048576))} MB over a 1,000,000 line flood (60 MB at most)`);
  note(`memory ${engine}: 1,000,000 lines (82 MB) in ${String(round(seconds))} s, ${String(settled.acks)} acknowledgements, never more than ${String(settled.maxUnacked)} B delivered and not acknowledged; oldest line kept ${String(oldest)} (expected ${String(expected)}, cap ${String(SCROLLBACK)} lines + ${String(rows)} rows); JS heap ${heapBefore === null ? 'not readable in this engine' : `${String(Math.round(heapBefore / 1048576))} -> ${String(Math.round(heapAfter / 1048576))} MB`}`);
  report.numbers[`memory ${engine}`] = { seconds, oldest, expected, heapBefore, heapAfter, acks: settled.acks, maxUnacked: settled.maxUnacked };
  await page.context().close();
}
// ---------------------------------------------------------------------------------------------------- paint
/** How many pixels of each band of `rect` are not the plane's colour in a screenshot of it, and the first that is (the page decodes the PNG on a canvas: the probe has no image library). */
async function painted(page, rect, bands, plane) {
  const png = await page.screenshot({ clip: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] } });
  return page.evaluate(
    async ({ base64, wanted, colour }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const [red, green, blue] = colour.match(/\d+/g).map(Number);
      const result = {};
      for (const [name, [x, y, width, height]] of Object.entries(wanted)) {
        let count = 0;
        let first = null;
        for (let row = y; row < y + height; row += 1) {
          for (let col = x; col < x + width; col += 1) {
            const at = (row * image.width + col) * 4;
            if (data[at] !== red || data[at + 1] !== green || data[at + 2] !== blue) {
              count += 1;
              first ??= [col, row, data[at], data[at + 1], data[at + 2]];
            }
          }
        }

        result[name] = { count, first };
      }

      return result;
    },
    { base64: png.toString('base64'), wanted: bands, colour: plane },
  );
}

/**
 * The terminal's focus is its caret and nothing is drawn around its screen (the screen is a text-entry surface the size of the panel; the mock draws the 2 px ring on its output REGION when that region is the focused
 * element, and where its keyboard is, in the input row, the focus paint is the row's highlight and the caret); the shell's scrollbar is the platform's overlay one: nothing at rest, none over a screen that does not scroll,
 * thin while it is shown (written rule: scrollbar mode, appearance and size are the platform's, ch03; no lane is reserved, `scrollbar-gutter: auto`).
 */
async function paint(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const plane = REF.rules.screenBackground;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  await typeLine(page, 'hello');
  await ctx.control?.after?.(page);
  const [x, y, width, height] = await page.evaluate(() => {
    const box = document.querySelector('[data-shell-part="terminalScreen"]').getBoundingClientRect();
    return [box.x, box.y, box.width, box.height].map(Math.round);
  });
  const rect = [x, y, width, height];
  check('paint.focus', await activeIsTerminal(page), `${engine}: the emulator has the keyboard`);
  // The outermost 2 px on every side: where the 2 px ring (offset -2) of a framed screen is painted. The scrollbar's thumb ends 2 px short of the right edge.
  const ring = await painted(page, rect, { top: [0, 0, width, 2], bottom: [0, height - 2, width, 2], left: [0, 0, 2, height], right: [width - 2, 0, 2, height] }, plane);
  const framed = Object.entries(ring).filter(([, band]) => band.count > 0);
  check('paint.ring', framed.length === 0, `${engine}: the screen has a frame while the emulator has the keyboard: ${JSON.stringify(Object.fromEntries(framed))}`);
  // No scrollbar after output (nothing to scroll to yet), and none after a quiet second. The emulator's scrollbar is 14 px wide at the inner edge of the screen's 12 px inset: [width - 26, width - 12). The bands leave out the
  // outermost 2 px above and below, the ring's rows, so that a frame is the ring assertion's to see and a scrollbar the scrollbar's.
  const edge = { edge: [width - 26, 2, 14, height - 4] };
  const justNow = await painted(page, rect, edge, plane);
  await sleep(1500);
  const atRest = await painted(page, rect, edge, plane);
  check('scrollbar.rest', justNow.edge.count === 0 && atRest.edge.count === 0, `${engine}: the right edge of a screen that does not scroll has ${String(justNow.edge.count)} painted pixels after output and ${String(atRest.edge.count)} at rest (first ${JSON.stringify(atRest.edge.first ?? justNow.edge.first)})`);
  // With scrollback, scrolled: the thumb is shown, thin, in the 10 px of the track (width - 22 to width - 12), and nothing is painted in the 4 px to the left of it.
  await page.keyboard.type('flood 300 80');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__pty.log.floods.length >= 1 && window.__engine.parsed === window.__engine.accepted, null, { timeout: 20_000 });
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.wheel(0, -400);
  await sleep(250);
  const thumb = await page.evaluate(() => {
    const slider = document.querySelector('[data-shell-part="terminalScreen"] .xterm-scrollable-element > .scrollbar.vertical > .slider');
    const track = slider?.parentElement;
    return slider === null || slider === undefined ? null : { width: slider.getBoundingClientRect().width, opacity: getComputedStyle(track).opacity, scrollable: document.querySelector('[data-shell-part="terminalScreen"]').hasAttribute('data-scrollable') };
  });
  const bands = await painted(page, rect, { track: [width - 22, 2, 10, height - 4], gap: [width - 26, 2, 4, height - 4] }, plane);
  check('scrollbar.thin', thumb !== null && thumb.scrollable && thumb.width <= 8 && Number(thumb.opacity) > 0 && bands.track.count > 0 && bands.gap.count === 0, `${engine}: while scrolling the thumb is ${JSON.stringify(thumb)} and paints ${String(bands.track.count)} pixels in the rightmost 10 px and ${String(bands.gap.count)} to the left of them`);
  // And it goes away again: the pointer leaves the screen, the wheel has stopped, and after a quiet moment nothing of the thumb is painted (a thumb that stays whenever there is scrollback would pass every check above).
  await page.mouse.move(x + width / 2, 8);
  await sleep(3000);
  const gone = await painted(page, rect, { track: [width - 22, 2, 10, height - 4] }, plane);
  check('scrollbar.hides', gone.track.count === 0, `${engine}: after the wheel stopped and the pointer left, the thumb still paints ${String(gone.track.count)} pixels in the rightmost 10 px (first ${JSON.stringify(gone.track.first)})`);
  await page.context().close();
  // The caret, as a node (the DOM renderer): the theme's text colour as a solid block while the emulator has the keyboard, a hollow one while it has not.
  const dom = await open(browser, origin, viewport, { query: 'renderer=dom' });
  await start(dom);
  const caret = () => dom.evaluate(() => {
    const node = document.querySelector('.xterm-rows .xterm-cursor');
    return node === null ? null : { shape: [...node.classList].find((name) => /^xterm-cursor-(block|outline|bar|underline)$/.test(name)), colour: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).outlineColor };
  });
  const focused = await caret();
  await dom.evaluate(() => document.activeElement?.blur());
  await sleep(200);
  const blurred = await caret();
  check('paint.caret', focused?.shape === 'xterm-cursor-block' && focused.colour === REF.rules.caret && blurred?.shape === 'xterm-cursor-outline', `${engine}: the caret is ${JSON.stringify(focused)} while focused (a solid block in ${REF.rules.caret}) and ${JSON.stringify(blurred)} when not (a hollow one)`);
  await dom.context().close();
}

// ---------------------------------------------------------------------------------------------------- screenreader
/**
 * The Terminal's screen reader mode (docs/ui-next/status/T1.md, section 16). The emulator's rows are hidden from the accessibility tree (the DOM renderer marks them `aria-hidden`; the GPU's canvas is not text), and only its
 * screen reader mode puts the printed lines in it. The DOM renderer is used here so that the line IS in the page while the mode is off: what is read is the accessibility snapshot of the screen's region (Playwright's own
 * computation of roles and names, which leaves out what is `aria-hidden`), so a line that is in the page and not in the snapshot is one a screen reader cannot read. The mode is turned on and off through the palette command, by
 * the keyboard alone, as a person does it: nothing else sets it.
 */
async function screenreader(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await page.addScriptTag({ path: AXE });
  await start(page, { plain: true });
  await watchLive(page);
  await perturb(ctx, page, 'start');
  await typeLine(page, 'hello');
  const region = page.locator('[data-shell-part="terminalScreen"]');
  const shown = (text) => JSON.stringify(text.slice(0, 500));
  const OFF_WORDS = 'The output is not read aloud until screen reader mode is on.';
  // Off, as a window that never chose has it: the line is in the page, and not in the tree.
  const off = await reading(page);
  check('screenreader.tree-off', off.inDom && off.lines === 0 && !off.snapshot.includes(LINE), `${engine}: with the mode off the line is ${off.inDom ? '' : 'not '}in the page and the screen's accessibility tree holds it ${String(off.lines)} times: ${shown(off.snapshot)}`);
  check('screenreader.words', off.named === 1 && off.label.startsWith('Terminal') && off.description.includes(OFF_WORDS) && off.description.includes(COMMAND), `${engine}: with the mode off the input is ${JSON.stringify(off.label)} (${String(off.named)} named Terminal) and described by ${shown(off.description)}`);
  // On, through the palette by the keyboard.
  const turnedOn = await switchReader(page);
  const on = await reading(page);
  check('screenreader.tree', on.lines === 1 && on.snapshot.includes(LINE), `${engine}: with the mode on the screen's accessibility tree holds the line ${String(on.lines)} times (once is right): ${shown(on.snapshot)}`);
  check('screenreader.words', on.named === 1 && on.label.startsWith('Terminal') && on.description.includes('Screen reader mode is on: the output is read aloud.') && on.description.includes('To turn it off') && on.description.includes(COMMAND) && !on.description.includes('not read aloud'), `${engine}: with the mode on the input is ${JSON.stringify(on.label)} and described by ${shown(on.description)}`);
  check('screenreader.announce', turnedOn.length === 1 && turnedOn[0].text === 'Terminal screen reader mode on.' && turnedOn[0].modal === false, `${engine}: turning the mode on was announced ${JSON.stringify(turnedOn)}: once, through the window's polite live region, with no modal dialog open`);
  // A line printed while the mode is on is read too: the emulator brings its tree up to date at most once a second.
  await typeLine(page, 'hello');
  let later = 0;
  for (let wait = 0; wait < 40 && later < 2; wait += 1) {
    later = await region.getByRole('listitem').filter({ hasText: LINE }).count();
    if (later < 2) await sleep(100);
  }

  check('screenreader.tree', later === 2, `${engine}: a line printed after the mode was turned on is ${later === 2 ? '' : 'not '}in the tree (${String(later)} of 2 lines)`);
  const axeOn = await runAxe(page, '[data-shell-part="terminalBody"]');
  // Off again.
  const turnedOff = await switchReader(page);
  const back = await reading(page);
  check('screenreader.tree-off', back.inDom && back.lines === 0 && !back.snapshot.includes(LINE), `${engine}: after the mode was turned off the line is ${back.inDom ? '' : 'not '}in the page and the screen's accessibility tree holds it ${String(back.lines)} times: ${shown(back.snapshot)}`);
  check('screenreader.words', back.named === 1 && back.description.includes(OFF_WORDS) && back.description.includes(COMMAND) && !back.description.includes('Screen reader mode is on'), `${engine}: after the mode was turned off the input is described by ${shown(back.description)}`);
  check('screenreader.announce', turnedOff.length === 1 && turnedOff[0].text === 'Terminal screen reader mode off.' && turnedOff[0].modal === false, `${engine}: turning the mode off was announced ${JSON.stringify(turnedOff)}: once, through the window's polite live region, with no modal dialog open`);
  const axeOff = await runAxe(page, '[data-shell-part="terminalBody"]');
  check('screenreader.axe', axeOn.length === 0 && axeOff.length === 0, `${engine}: axe finds ${JSON.stringify(axeOn)} in the running terminal with the mode on and ${JSON.stringify(axeOff)} with it off`);
  // Two changes, two announcements, and nothing said after them.
  await sleep(300);
  const told = await page.evaluate(() => window.__told.length);
  check('screenreader.announce', told === 2, `${engine}: the window's live region was told ${String(told)} times for two changes`);
  note(`screenreader ${engine}: on and off through the palette by the keyboard; the screen's accessibility tree held the line ${String(off.lines)} times off and ${String(on.lines)} on; ${String(off.nodes)} nodes in the screen off, ${String(on.nodes)} on (DOM renderer); said ${JSON.stringify([turnedOn[0]?.text, turnedOff[0]?.text])}`);
  report.numbers[`screenreader ${engine}`] = { nodesOff: off.nodes, nodesOn: on.nodes, snapshotOn: on.snapshot, announced: [...turnedOn, ...turnedOff] };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- screenreader-cost
/**
 * The mode on costs nothing at rest. The terminal is made as the product makes it (the GPU's renderer while it is on screen), the mode is turned on through the palette by the keyboard, and the two measures of work that the mode off passes
 * are taken again with it on: an idle terminal (`idle`: the same zero counts) and a hidden panel that the shell writes 2 MB to (`hidden`): it takes in every byte, in order, with nothing of the page's document touched; it has no
 * accessibility layer while it is hidden (an accessibility layer refreshes itself a second after the lines it was given, which must not happen in a hidden panel) and has it again when it is shown; and once everything is in it is at rest,
 * with no frame, no timer and no change of the document. The accessibility layer must be there when the panel is shown, or the measure says nothing about the mode.
 */
async function screenreaderCost(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await sleep(500);
  const baseline = await page.evaluate(() => window.__count.active);
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine.writes > 0 && window.__pty.log.resizes.length >= 1, null, { timeout: 15_000 });
  await sleep(500);
  await switchReader(page);
  await typeLine(page, 'hello');
  const counts = await sitIdle(page, () => perturb(ctx, page, 'idle'));
  if (counts.fired > 0) note(`screenreader-cost ${engine}: the callbacks that fired: ${JSON.stringify(counts.what)}`);
  const layer = () => page.evaluate(() => document.querySelector('[data-shell-part="terminalScreen"] .xterm-accessibility-tree') !== null);
  const idleLayer = await layer();
  check('screenreader.idle', idleLayer && counts.timeout === 0 && counts.interval === 0 && counts.raf === 0 && counts.fired === 0 && counts.active === baseline, `${engine}: with the mode on (accessibility layer ${idleLayer ? 'there' : 'MISSING'}) an idle terminal started ${String(counts.timeout)} timeouts, ${String(counts.interval)} intervals and asked for ${String(counts.raf)} frames in 3 s, ${String(counts.fired)} callbacks fired, and ${String(counts.active - baseline)} intervals are alive that the panel without a terminal does not have`);
  // What the idle control left running stops here, so that it is not in what the hidden panel is measured for.
  await page.evaluate(() => { clearInterval(window.__idleTimer); });
  // The panel is hidden and the shell writes 2 MB: the product takes the emulator out of the mode while it is hidden, and puts it back when it is shown.
  await page.click('[data-shell-part="panelToggle"]');
  await sleep(400);
  const hooks = { cdp: null, perturb: (stage) => perturb(ctx, page, stage) };
  const run = await flooded(page, FLOODS[0], hooks);
  const layerHidden = await layer();
  const rest = await resting(page, hooks.perturb);
  const layerAtRest = await layer();
  await page.click('[data-shell-part="panelToggle"]');
  await sleep(500);
  const layerShown = await layer();
  const { before, settled, during, checked } = run;
  const taken = run.calm.calm && settled.delivered - before.delivered === run.bytes && settled.accepted - before.accepted === run.bytes && settled.acked - before.acked === run.bytes && settled.parsed === settled.accepted && settled.waiting === 0 && settled.paused === false && checked.bad === 0;
  const still = rest.raf === 0 && rest.timeout === 0 && rest.interval === 0 && rest.fired === 0 && rest.mutations.page === 0 && rest.mutations.xterm === 0;
  check('screenreader.hidden', !layerHidden && !layerAtRest && layerShown && taken && during.mutations.page <= 2 && still, `${engine}: with the mode on a hidden panel and ${String(run.bytes)} B written by the shell: ${run.calm.calm ? '' : `what came before the burst was still moving after ${String(run.calm.waited)} ms (no baseline to count it from), `}accessibility layer ${layerHidden || layerAtRest ? 'THERE' : 'gone'} while hidden (gone is right) and ${layerShown ? 'there' : 'MISSING'} when shown, delivered ${String(settled.delivered - before.delivered)}, given to the emulator ${String(settled.accepted - before.accepted)} and acknowledged ${String(settled.acked - before.acked)} B (parsed ${String(settled.parsed)} of ${String(settled.accepted)}, ${String(checked.bad)} events out of order), the page's own document changed ${String(during.mutations.page)} times (2 at most: the screen's mark that it has something to scroll to); at rest ${String(rest.raf)} frames, ${String(rest.timeout)} timeouts, ${String(rest.interval)} intervals, ${String(rest.fired)} callbacks, ${String(rest.mutations.page)} changes of the page's document and ${String(rest.mutations.xterm)} of xterm's own`);
  note(`screenreader-cost ${engine}: with the mode on, idle 3 s: ${String(counts.timeout)} timeouts, ${String(counts.interval)} intervals, ${String(counts.raf)} frames, ${String(counts.fired)} callbacks fired; hidden with ${String(run.bytes)} B written by the shell: ${String(during.raf)} frames, ${String(during.fired)} callbacks in ${String(round(during.busy))} ms, ${String(during.mutations.page)} changes of the page's document; at rest ${String(rest.raf)} frames, ${String(rest.timeout)} timeouts, ${String(rest.mutations.page + rest.mutations.xterm)} changes`);
  report.numbers[`screenreader-cost ${engine}`] = { idle: counts, hidden: { during, rest } };
  await page.context().close();
}

const SECTIONS = { geometry, words, title, ended, start: refusals, keys, close, resize, size, bundle, paint, axe, screenreader, 'screenreader-cost': screenreaderCost, hidden, idle, commits, flood, latency, memory, order, ...createReattachSections({ check, note, report, runAxe }), ...createFindSections({ check, note, report, runAxe }), ...createGutterSections({ check, note, report, runAxe }), ...createWhereSections({ check, note, report, runAxe }), ...createSettingsSections({ check, note, report }), ...createPanesSections({ check, note, report, runAxe }), ...createApplySections({ check, note, report }) };
/** The two parts the probe is run in, by the units of CI: the sections of the page (what a person sees and does) and those of the data path (what flows, and what it costs). Every section is in one and only one. */
const PARTS = {
  view: ['geometry', 'words', 'title', 'ended', 'start', 'keys', 'close', 'resize', 'size', 'bundle', 'paint', 'axe', 'screenreader', 'screenreader-cost'],
  data: ['hidden', 'idle', 'commits', 'flood', 'latency', 'memory', 'order'],
  ...REATTACH_PARTS,
  ...FIND_PARTS,
  ...GUTTER_PARTS,
  ...WHERE_PARTS,
  ...SETTINGS_PARTS,
  ...PANES_PARTS,
  ...APPLY_PARTS,
};
{
  const named = Object.values(PARTS).flat();
  const problems = [
    ...Object.keys(SECTIONS).filter((name) => !named.includes(name)).map((name) => `the section ${name} is in no part`),
    ...named.filter((name, index) => named.indexOf(name) !== index).map((name) => `the section ${name} is in two parts`),
    ...named.filter((name) => SECTIONS[name] === undefined).map((name) => `a part names the section ${name}, which does not exist`),
  ];
  if (problems.length > 0) throw new Error(`PARTS must hold every section once: ${problems.join('; ')}`);
  if (PART !== '' && PARTS[PART] === undefined) throw new Error(`PART must be one of ${Object.keys(PARTS).join(', ')} or not set, it is ${JSON.stringify(PART)}`);
}
const wanted = CONTROL === '' ? (process.env.SECTIONS ?? (PART === '' ? Object.keys(SECTIONS) : PARTS[PART]).join(',')).split(',') : [CONTROLS[CONTROL].section];
const t0 = Date.now();
const dist = build('production');
const needsDev = wanted.includes('commits') || wanted.includes('find-idle');
const devDist = needsDev ? build('development') : undefined;
const prod = await serve(dist);
const dev = devDist === undefined ? undefined : await serve(devDist);
const origin = prod.url.replace(/\/$/, '');
const devOrigin = dev?.url.replace(/\/$/, '');
const seconds = {};
try {
  for (const engine of engineNames) {
    if (CONTROL !== '' && CONTROLS[CONTROL].engines !== undefined && !CONTROLS[CONTROL].engines.includes(engine)) continue;
    const browser = await launch(engine);
    try {
      for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
        for (const name of wanted) {
          const started = Date.now();
          const before = failures.length;
          try {
            await SECTIONS[name]({ browser, origin, devOrigin, dist, viewport, vp, engine, control: CONTROL === '' ? undefined : CONTROLS[CONTROL] });
          } catch (error) {
            failures.push(`${name}.error: ${engine} ${vp}: ${String(error?.message ?? error).split('\n')[0]}`);
          }

          seconds[`${name} ${engine} ${vp}`] = (Date.now() - started) / 1000;
          void before;
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  prod.server.close();
  dev?.server.close();
}

report.seconds = seconds;
report.totalSeconds = (Date.now() - t0) / 1000;
if (process.env.REPORT !== undefined) writeFileSync(process.env.REPORT, JSON.stringify({ ...report, failures }, null, 1));
console.log(`probe took ${String(round(report.totalSeconds))} s (load ${os.loadavg()[0].toFixed(1)})`);
if (CONTROL === '') {
  if (checked === 0) {
    console.error(`FAIL: no assertion ran: SECTIONS=${wanted.join(',')} at ${Object.keys(VIEWPORTS).join(',')} selects nothing (a section keeps to the viewport it is made for)`);
    process.exitCode = 1;
  } else if (failures.length > 0) {
    console.error(`FAIL:\n${failures.map((line) => `  ${line}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS (${String(checked)} assertions)`);
  }
} else {
  const named = CONTROLS[CONTROL].assertion;
  const own = failures.filter((line) => line.startsWith(`${named}:`));
  const others = failures.filter((line) => !line.startsWith(`${named}:`));
  if (own.length > 0 && others.length === 0) {
    console.log(`NEGATIVE CONTROL "${CONTROL}": detected by ${named}: ${own[0].slice(0, 200)}`);
  } else if (own.length === 0 && others.length === 0) {
    console.error(`NEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${named} did not fail)`);
    process.exitCode = 1;
  } else {
    console.error(`NEGATIVE CONTROL "${CONTROL}": failed ${others.length > 0 ? `another assertion: ${others[0].slice(0, 300)}` : 'nothing it is named for'}`);
    process.exitCode = 1;
  }
}

void mkdirSync;
