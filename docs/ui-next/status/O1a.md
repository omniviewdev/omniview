# Status: O1a (the notices and operations model)

**State (2026-11-20): READY FOR REVIEW.** Logic and tests only. Nothing imports the model; the `next` bundle is byte-identical to the base (compared below).

- Agent: NoticeModel
- Goal: the framework-free model of NOTIFICATIONS AND OPERATIONS: notices (severity, title, detail sentence, source, actions as data, dedupe key, per-severity timeouts, pause on hover or focus as a model input, bounded history with read and unread, mute), operations (seven states, determinate, steps and indeterminate progress, optional cancel, the result as a notice, concurrency with a status-area summary), plugin unload, contained failures, rate limiting, the `apperror` host error as a notice, versioned persistence, performance tests, and the README for the contract plugins get and the live-region rules.
- Owns: `ui-next/shell/core/notices/**` (new) and this file. Nothing else was edited.
- Worktree: `~/Repos/omniviewdev/worktrees/ui-next-o1a-notice-model`
- Branch: `ui-next/o1a-notice-model` (base `origin/main` 1a7bd5f9)
- PR: https://github.com/omniviewdev/omniview/pull/564

## Log

- 2026-11-20: worktree from `origin/main` 1a7bd5f9, `pnpm install --frozen-lockfile`, `task packages`. Base bundle built to `/tmp/o1a-base-dist` for the final comparison. Read AGENTS, decisions, the mock's notification and feedback code, chapter 16 section E and chapter 05, the P5 proposal, the E0-1 status (the eight host envelopes) and the runtime's `parseAppError`.
- Tests first, seen red, for every file; the first push was the pure pieces (words, progress, copy, actions, policy, rate, toasts, summary), titled partial. Then the host error, persistence, the store, and the store-level tests (red against a stub that threw "not implemented", then green).
- One commit, force-pushed with lease; PR retitled when the last piece landed.

## Sources read

- `docs/ui-next/AGENTS.md` (rules, the 16 review comments, the 22-class backend catalog), `docs/ui-next/decisions.md`, `docs/ui-next/status/E0-1.md`, `docs/ui-next/status/C1a.md` (the bundle comparison).
- The mock: `shell-notify.js` (the records, folding, rate, policy, persistence), `shell-feedback.js`, `shell-core.js`, and the skill example `shell-req-status-notify.md`.
- Chapters: `research/int-ui/16-ide-shell.md` section E (S74 to S89a), `05-menus-feedback.md` (OF1 to OF4, RC1), and `proposals/P5-errors-and-feedback.md`.
- Code: `packages/omniviewdev-runtime/src/errors/{parseAppError,types}.ts` (the one parser stays there), `packages/kit/.../PageHeader/{operation.ts,PageOperation.tsx}` (the slot the model feeds), `ui-next/plugins/contract/v1.ts` (read only; see the proposal below), and `ui-next/shell/core/{tabs,palette,saver.ts}` for the conventions this folder mirrors.

## What is built

`ui-next/shell/core/notices/`: the store (`store.ts`), the record and its view (`record.ts`), actions (`actions.ts`), toast and announcement policy (`policy.ts`), the stack (`toasts.ts`), counts and bell and activity (`summary.ts`), progress and its aria values (`progress.ts`), the rate limit (`rate.ts`), words (`copy.ts`, `text.ts`), the host error (`error.ts`), input normalisation (`normalise.ts`), persistence (`persist.ts`, `saver.ts`), the page header slot's feed (`inline.ts`), `index.ts`, and `README.md` (the contract and the live-region rules). 21 test files, 469 tests.

## Decisions made here (the lead can overrule)

1. **One record store.** A message and an operation are one kind of record; a finished operation IS its result notice (the mock's design). No second record, no copy.
2. **History survives a restart** (the mock: versioned, at most 200 records, 7 days). Versioned document, `MIGRATIONS` table, never throws. Active operations come back as `unknown`; restored records raise no toast and no announcement; code actions come back disabled ("Not available after restart"); mutes persist; ticks make no write.
3. **History bound 200 records / 7 days**, configurable (`options.history`). Owner decision B7 (500 proposed) is pending: it is two numbers.
4. **Toast policy is the mock's code** (sticky only for active user-started work, or a failure with an enabled Retry or command). **Flag:** the mock times out an error that has no decision, while S77 and S78 say every failure is sticky; the mock says 7 s, the chapter 8 s. I followed the code and pinned it in `policy.test.ts`; the lead picks.
5. **Rate limit** per source: 5 a second and 20 a minute, then one row per source ("{Name} is posting many notifications", a built-in `Mute for 1 hour`, the folded titles as a log of at most 20 lines). Active operations are capped at 200 per source and 1,000 in all. The model names no plugin; the source is the host's `source`, stamped by `forSource`.
6. **Mute is per source** (1 h default, an until time, or forever), as in the mock. There is no global do-not-disturb (the mock has none).
7. **Screen-reader values change at most once a second**, on a 250 ms grid, with one store timer; a first value, a state change and the change between measurable and not are immediate (QA-SF-27).
8. **Host errors** (`noticeFromHostError`): only the parsed envelope is read (the runtime's `parseAppError` stays the one parser); anything else is a generic "Operation failed" with none of its text. FORBIDDEN, UNAUTHORIZED, INTERNAL and PROVIDER_ERROR keep the host's title and sentence; PARTIAL_RESULT warns; a cancellation is `undefined`; `recovery`, `actions` and `instance` are not read.
9. **Producer contract** is `Producer` (`notify`, `begin`, `fromError`). **Proposal, not made here:** an optional `ContextV1.notices?: Producer` in `ui-next/plugins/contract/v1.ts` (a minor addition; I do not own that file).
10. **Names:** the host's source `host` is shown as "Omniview"; any other falls back to a sentence-cased id when the `pluginName` seam has no name.

## Oracle: ported and not ported

Ported into `oracle.test.ts` (each test names its case): H1 to H3 (R2Store, `unit.cjs` lines 705, 1275, 1916), E1 to E7 from the lab's notification regression script (in its `evidence/` directory), QA-SF-03, 10, 13, 14, 27 and 29, and the sims connection-sync, rollout-restart, plugin-install, port-forward and burst-12. Not ported, with the reason for each, in the header of `oracle.test.ts`. `tests/shell-model-harness/` has no unit for notifications.

## Not built (and why)

Conditions (S74), `Shell.reads`, legacy toasts, toast placement and hit-testing, the window focus gate (S87), windows (`origin.window`), the success-copy lint, tab busy and attention from `origin.tab` (S21 and S22), operation folding at the finish (needs a handle redirect), a global do-not-disturb, and an operation's own `key` or `group`. Each belongs to a view or a later step and none changes the contract.

## Dev tools

`testing.ts` is a store over a manual clock with the host seam recorded (`said`, `opened`, `commands`, `errors`, `centre`, `inline`, `off`, `on`); only tests import it, and `purity.test.ts` checks that.

## Verification

From the worktree:

- `pnpm exec vitest run ui-next/shell/core/notices`: 21 files, 469 tests pass.
- `pnpm test ui-next` (root): 105 files, 1,778 tests pass.
- `pnpm exec tsc -p tsconfig.app.json --noEmit` and `pnpm exec tsc -p tsconfig.test.json --noEmit`: clean.
- `pnpm exec eslint ui-next/shell/core/notices --report-unused-disable-directives`: clean. Two `eslint-disable-next-line` comments, both in `run.test.ts`, each with its reason (the host rejects with a plain envelope object, which is what the test throws).
- `node scripts/check-tracked-outputs.mjs`: ok.
- **`next` bundle byte-identical** (the comparison of C1a): base built from `origin/main` and head built with `OMNIVIEW_UI=next OMNIVIEW_BUILD_OUTPUT_DIRECTORY=<dir> pnpm exec vite build`; `diff -r` of the two output directories exits 0 with no output (9 files).
- **Performance:** 10,000 notices in one tick from one plugin leave five records and one row, at most three snapshots (the first is the one `subscribe` reads) and a handful of views; from a hundred plugins the history and the timers stay at their bound; 100,000 notices from forty plugins leave the history, the toasts and the timers where they were; 1,000 operations ticking once a second for five seconds cost one view per tick and at most one more per second per record (the aria value), in at most `frames + 5` snapshots.
- **Mutation checks** (seven rules removed together, the folder run once, each rule's own tests failed, then restored; the restored files hash to the same tags as before): holds (`setPaused` never pauses): 5 `lifetime.test.ts` tests fail; history bound (x1000): 3 `messages.test.ts` tests and 2 `perf.test.ts` tests fail; key dedupe off: 6 `messages.test.ts` tests fail; rate limit off: 7 `messages.test.ts` tests and 4 `perf.test.ts` tests fail; containment off (the action error rethrown): 3 `run.test.ts` tests and one more fail; plugin unload (`dead` never set): 5 `unload.test.ts` tests fail; host text for FORBIDDEN and the three others off: `error.test.ts` (3) and `messages.test.ts` fail. 39 tests failed in all.
- **Negative controls:** `purity.test.ts` proves each of its checks on a text that breaks the rule (a framework import, a browser global, a platform timer, a plugin name) before it is trusted on the sources.

## Not verified

- The CI-equivalent full suite: the root `pnpm test` beyond `ui-next`, the repository-wide `pnpm lint`, the kit verify, the probes (`FONT_DELAY_MS=40`) and the seam check. Nothing outside `ui-next/shell/core/notices` and this file changed, so none of them is touched by this PR, but they were not run here.
- The model is not wired to a view, to the tab model's `open`, to the runtime's command registry or to Wails: the seam is exercised only through `testing.ts`. The `ContextV1.notices` proposal is not made in the contract.
- No measurement in a browser (the performance tests are model-level: counts of snapshots and views, not milliseconds on a screen).

## For the lead

1. Toast policy: an error with no decision times out (the mock's code) or stays (S77, S78)? And 7 s or 8 s?
2. B7: 200 records and 7 days, or 500? Two numbers in `LIMITS`; the tests read them.
3. The `ContextV1.notices?: Producer` addition to the plugin contract (minor, optional): wanted, and in which step?
4. A global do-not-disturb: add to the model, or leave per-source mute only (the mock)?
