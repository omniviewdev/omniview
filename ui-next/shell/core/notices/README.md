# Notices and operations model (O1a)

Design: chapter 16 section E (S74 to S89a), chapter 05 (OF1 to OF4, RC1), and the mock's `shell-notify.js` and `shell-feedback.js`. This folder is **logic and tests only**: no React, no DOM, no timers of its own, nothing imports it yet, and the `next` bundle is byte-identical. The views (toasts, bell, centre, status area, page header slot) come in later steps and are thin: every decision below is made here, once, and a view only draws the snapshot and calls the operations.

```ts
import { createNoticesStore, restoreNotices, createNoticesSaver } from './notices';

const store = createNoticesStore({ initial, open, run, availability, commandAvailability, current, inline, announce, pluginName, openCenter });
const plugin = store.forSource('cloud');      // what a plugin is handed: its source is baked in
const op = plugin.begin({ title: 'Scaling orders-api', initiator: 'user', progress: { current: 0, total: 3 }, onCancel });
op.progress({ current: 1 });
op.succeed({ message: 'Scaled to 3 replicas' });   // the operation IS its result notice: one record, no copy
```

## The snapshot

`store.getSnapshot()` is always current and immutable. A part of it that did not change is the **same object**, so `useSyncExternalStore` selectors and `React.memo` need no comparison of their own.

| Slice | What it is |
|---|---|
| `active` | running, paused and queued operations, running first |
| `recent` | finished records and messages, newest first (the centre's list) |
| `counts` | unread, by severity; active; total |
| `bell` | the unread count and the worst unread severity (QA-SF-13) |
| `activity` | the status area's summary: how many operations, one bar (determinate only if all are), the one Cancel when exactly one operation can be cancelled |
| `toasts` | `{ items, paused, suspended }`: at most three items, the two newest and a summary above them when more are waiting |
| `muted` | the sources that are muted, and until when |
| `undo` | what a Clear removed, for ten seconds |

Listeners are told at most once a frame (16 ms): the first change after a quiet moment at once, the rest together at the end of the frame. `stats()` counts snapshots, views, folded and rate-limited notices; the performance tests use it.

## Two kinds of record, one store

A **message** is a notice: severity, a title, one detail sentence, a source, actions. An **operation** is work: seven states (`queued`, `running`, `paused`, `succeeded`, `failed`, `cancelled`, `unknown`), determinate progress (`{current,total}`), steps (`{step,steps}`) or indeterminate, an optional cancel. When an operation ends it **becomes** its result notice in place (same id, same row, its severity derived from its state: succeeded `success`, failed `error`, cancelled and unknown `warning`); there is no second record. A finished operation can `restart()` (Retry): it goes back to `running`, attempt + 1, and says so once ("Retrying: Title").

## The contract a plugin gets

A plugin never creates a store. The host hands it a `Producer` (the proposal for the plugin contract is an optional `ContextV1.notices?: Producer`, a **minor** addition: a plugin that does not know it loses nothing; this step does not touch `ui-next/plugins/contract`).

```ts
type Producer = {
  readonly source: string;                                   // stamped by the host; a plugin cannot claim another
  notify(spec: NoticeInput): NoticeHandle;                   // title (<= 80), detail (<= 120), severity, details (<= 8 KiB), key, group, target, actions (<= 4), fields (<= 4), origin
  begin(spec: OperationInput): OperationHandle;              // title, initiator 'user'|'system'|'plugin', progress, onCancel, onRetry, doneTitle, message
  fromError(error: unknown, context?: HostErrorContext): NoticeHandle | undefined;  // the host's `apperror` envelope as a notice; a cancellation is undefined
};
```

- **Actions are data**: `{ id, kind: 'custom'|'retry'|'cancel', label, route? , command?, run? , primary?, danger?, disabled? }`. A `route` is `{plugin, contribution, params}` opened through the host's `open`, a `command` through the host's `run`; `run` is the producer's code, called only on a click, never on a restart, and contained if it throws. The model decides the variant (primary or not), the order (cancel while active; retry first after a failure; then the producer's own, then the open) and the reason an action is disabled, once.
- **Never fails the caller**: bad input is refused with a sentence in `handle.refused` and one `onError` call; nothing throws into a plugin. A handle that outlives its record answers `false`.
- **Dedupe**: `key` is a quiet repeat (one record, counted from the first, no new toast, not news again, for ten minutes); `group` folds within a sliding 60 s window and is news again (it re-raises a toast the user dismissed); an identical message within 60 s folds as a repeat ("Title 3 times"). Operations do not fold.
- **Rate limit**: per source, 5 a second and 20 a minute. What is over goes to **one row for the source** ("Cloud is posting many notifications", a `Mute for 1 hour` action, the folded titles as a log of at most 20 lines). 10,000 notices in one tick leave five records and one row, two snapshots. An operation that finishes over the budget keeps its row but raises no toast. Active operations are capped at 200 per source and 1,000 in all; a refused `begin` is counted in the same row and returns an inert handle.
- **Unload** (`removePlugin(id)`, S88 and PO1): the plugin's active operations end as `unknown` ("Cloud isn't running."), unread, with no toast and no announcement; its actions stay visible but are **marked unavailable** with that reason (a warning toast whose decision is gone becomes timed; an error stays: a failure must not vanish); its old producers are refused ("The plugin \"cloud\" is not running."); its rate bucket is forgotten. `forSource(id)` after a reload gives a live producer again; the old records say "Not available after restart".
- **Contained code**: an action or `onCancel` that throws or rejects is caught: `onError(error, 'action "id" of source')`, the click answers `{status:'refused', reason:'failed'}` and a failure notice for the plugin is posted (diagnostics are the error's text, never chrome). A cancel that throws, rejects or answers `false` puts the Cancel button back with "Couldn't cancel. The work is still running."
- **What the host's own failures look like** (`noticeFromHostError`, the one mapping, P5/RC1): only the parsed envelope (`type`, `title`, `status` 100 to 599, `detail` <= 4096) is read; anything else becomes the generic "Operation failed" with none of its text. Title = the class title, detail = the sentence; `UNAUTHORIZED`, `FORBIDDEN`, `INTERNAL` and `PROVIDER_ERROR` keep the host's own text (a caller's `title` and `detail` are ignored for them); `PARTIAL_RESULT` is a warning; a cancellation (`omniview:cancelled`, `CANCELLED`) is `undefined`. Code, request id and suggestions go to diagnostics. `recovery`, `actions` and `instance` are not read.

## Time: toasts, holds, mute

- A toast is **sticky** when it needs a decision or must not vanish (S77, S78; the lead's ruling of 2026-11-20 follows the written rule, not the mock's code): active work the user started, and every failure, unknown outcome and error, whether or not it has an action, and a warning that carries **any** action the user can use (a Retry, a command, a route to open, the producer's code: S77's "a warning with an action"; the mock counted only a Retry or code). An action that cannot be used is no action, so a warning whose only action became unavailable closes by itself. Everything else is timed: **8 s** (S78; the mock's code says 7).
- **Holds** are model inputs: `hold('pointer'|'focus', on)` pauses every clock as one; `hold('modal'|'center', on)` also **suspends** the stack (`items` is empty) and pauses; `hold('yield', on)` is the view saying the stack has no room anywhere and is not drawn: it pauses the clocks and leaves the stack in the list (the view still measures it). Resuming gives each timed toast at least two seconds. **Never lose a message unseen** (the lead's ruling of 2026-11-21): with no notification centre yet, a timed toast that expired while hidden could never be read, so no clock runs while the stack is not drawn (the mock's clocks keep running while its stack yields: a recorded deviation).
- Reading a record, acting on it, or muting its source drops its toast. `mute(source, until?)` is an hour by default, `'forever'` or a time; it persists.
- More than three toasts: the two newest, and a summary (the worst severity of the rest, QA-SF-13). `showSummary()` calls the host's `openCenter`.

## Persistence

`serialise()` is a versioned document (`NOTICES_VERSION = 1`, `MIGRATIONS`); `restoreNotices(raw, { now })` migrates, validates and bounds it, and never throws (a bad document is `{ ok: false }` and the history starts empty). **History survives a restart** (at most 500 records and 7 days: the lead's ruling of 2026-11-20 for the owner's decision B7, the mock says 200; configurable through `options.history`). Active operations come back as `unknown` (a warning, unread, no progress, no Cancel); mutes persist; restored records raise **no toast and no announcement**; actions that were code come back disabled ("Not available after restart"); a Retry the producer had is recorded and also comes back disabled. Active records are saved minimally (no detail, fields or progress), so a tick of progress makes **no write**. `createNoticesSaver({ store, write })` is the shell's `createSaver` (400 ms after the last change) over `serialise()`.

## Live-region rules (S86, S86a, S89a)

The model says **what**; the host's live region only speaks it. There are two channels and a record is never in both.

1. **A record with a toast** is announced by the toast. A `ToastItem` carries `urgent`: `true` only for an error the user caused (assertive, `role="alert"`); everything else is polite (`role="status"`). The toast's text is the record's title and detail, once; the clock pausing, the stack reflowing and the summary updating say nothing.
2. **A record without a toast** (muted, shown inline in its page, over the rate budget, or restored) goes through `announce(text, { urgent })`: the start of work **once** (its title), its finish **once** (the same words its toast would have had, with the state in a word: "Failed: Scaling orders-api"), and "Retrying: Title" once when it starts over. `urgent` is the same rule as above. Nothing for a tick, a phase, a repeat of a key or a restored record, and nothing for work that is quiet (system-started and successful).
3. **A bar** is told through `aria-valuenow` and `aria-valuetext` of the record (`RecordView.a11y`), which change **at most once a second** whatever the ticks (the first value, a change of state and the change between measurable and not are immediate). The activity bar's text is built from the sampled `current` and `total` (QA-SF-27), never from a number the view computed.
4. **The bell** is a count, never announced. **The summary toast** is one polite announcement when it appears, and not on its updates.
5. **Focus** is never moved by the model. A toast's action is a button the view makes focusable; `hold('focus', true)` is the view's way to say focus is inside.

## Not built here (and why)

Conditions (S74), `Shell.reads`, legacy toasts, toast placement and hit-testing, the window focus gate (S87), windows (`origin.window`), the success-copy lint, tab busy and attention from `origin.tab` (S21 and S22), operation folding at the finish (needs a handle redirect), a global do-not-disturb (the mock has only the per-source mute: 1 h, 8 h, 24 h, forever), and an operation's own `key` or `group`. Each is a view or a later step; none changes this contract.

## Files

`store.ts` (the store; the only file with the platform's timers, as a default), `record.ts` (the record and its view), `actions.ts`, `policy.ts` (toast and announcement rules), `toasts.ts` (the stack), `summary.ts` (counts, bell, activity), `progress.ts`, `rate.ts`, `copy.ts` and `text.ts` (the words), `error.ts`, `normalise.ts`, `persist.ts`, `saver.ts`, `inline.ts` (the page header slot's feed), `testing.ts` (a store over a manual clock with the host seam recorded; tests only), and the tests: one file per concern, `oracle.test.ts` for the cases ported from the harness and the audit, `perf.test.ts`, `purity.test.ts`.
