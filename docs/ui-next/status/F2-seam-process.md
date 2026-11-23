# Status: F2-seam-process (seam scenario `process`: "the window was told the phase too")

- Worktree: `~/Repos/omniviewdev/worktrees/f2-seam-process-race`. Branch `test/f2-seam-process-race`, base `origin/main` 8bb289bc. Files: `ui-next/plugins/e2e/seam.check.mjs` (scenario n, `checkProcess`, one added wait), this file.
- Symptom: `Seam webkit`, scenario `process` and its control, failed about 1 in 10 on CI (PRs #658, #659, #665, #669): the assertion `the window was told the phase too`, and in the control job `process NOT DETECTED`.
- Finding (reviewer, `reviews/host-659-incompatible-refusal.md`, follow-up section): not a product bug, a race in the check.

## Cause

- The host sends two frames on one event socket for a crash: `plugin/unloaded` (`manager.go`, `emitUnloaded`) and then, after the state machine's transition, `plugin/state_change` with `to: Recovering` (observer `registerStateObserver` -> `emitStateChange`). Both happen in `HandlePluginCrash`, before the recovery loop is entered. The product cannot skip or coalesce `Recovering`.
- The check waited for the page (`Seam Fixture, stopped` button: drawn from `plugin/unloaded`) and then read `frames`, which the check's own `framereceived` handler fills on its own schedule. Page and reader are two paths from one socket; the button may be drawn before the reader has recorded the second frame.

## Evidence (macOS arm64, machine shared with other agents, load 10 to 20, `uptime` at start of each batch)

- Before: `SEAM_CONTROL=process` (the scenario and all ten controls), `env -i`, 40 runs per engine idle and 40 per engine with 8 `while :; do :; done` loops (killed by PID): 160 of 160 passed; the race did not occur locally.
- Recorded frame order in all 160 runs (a traced copy of the check, not committed): `plugin/crash`, `plugin/unloaded crashed`, `plugin/state_change Recovering`, always in that order, `Recovering` 0 to 3 ms after `unloaded` in Chromium and 0 to 22 ms in WebKit; it was recorded before the button resolved in 160 of 160. The button resolved as soon as 2 ms (Chromium) and 15 ms (WebKit) after `unloaded`: inside the window of the second frame. The product never skipped `Recovering`.
- Fault injection (the reader records `Recovering` 1500 ms late, WebKit): the unchanged check fails with `webkit: the window was told the phase too`; the fixed check passes with all ten controls detected.

## The fix

After the button, wait on the record: `told().length > 0` and a `plugin/state_change` `Recovering` in `frames.slice(mark)`, with `waitUntil` (the helper the scenario already uses, polling, 15 s like the wait for the process to end; no sleep added). The assertions that follow are unchanged and read a complete record, whatever order the two frames were recorded in.

## After

- Same matrix on the fixed check: 80 of 80 passed per engine (40 idle, 40 with 8 busy loops).
- `SEAM_CONTROL=process SEAM_REMOVE=<control>` for each of the ten controls, both engines: 20 of 20 runs exit 0 and each printed `NOT DETECTED ... with its assertion removed, as it must be` for the removed control (the other nine are detected by their own words, as the check enforces).

## Not verified

- The failure itself was not reproduced on a natural run; the cause is the frame order plus the fault injection above. CI's 1 in 10 is the rate the PRs reported, not one I measured.
- Ubuntu CI image, WebKitGTK.
