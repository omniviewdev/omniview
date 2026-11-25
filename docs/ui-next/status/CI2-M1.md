# Status: CI2-M1 (Go tests: a pull request runs `go test -short`, the nightly runs every test)

- Agent: TestOrgResearch. Branch `ci/m1-go-short-tier` from main `0454b9c6`. Worktree `~/Repos/omniviewdev/worktrees/ci-m1-go-short-tier`. Step M1 of the CI2 proposal (one check, tiers by annotation); M2 to M6 are not started.
- Rule: AGENTS 40. A Go test that takes 3 s or more on a 2-CPU runner (a flood through a pty, two hundred shells) or is the dev tooling's own starts with `if testing.Short() { t.Skip("slow: <why>") }`. `PR Checks` > `Go checks` runs `task check:go-test -- -short`; `Nightly validation` > `Go build cache primer` (already the nightly Go step, already on the `ci-main-red` list) runs `task check:go-test -- -count=1`: every test, none from the result cache. `scripts/go-test-failures.mjs` (the existing `-json` reporter) counts the skips by reason in the job summary.
- Deleted: nothing left to delete. `scripts/ci/ci-scope.mjs`, the one file M1 was to delete, went with #736.

## Measured (2-CPU arm64 Linux container, compile cache warm, `go test -count=1 -json ./...`, one run each, host load 6.0 before and 4.8 after: a run varies by about 8 percent)

| | wall | CPU | tests run | top-level skips |
|---|--:|--:|--:|--:|
| main `0454b9c6` | 217 s | 214 s | 7,608 | 27 |
| this branch, `-short` | 145 s | 119 s | 7,337 | 143 |
| this branch, every test (nightly form, measured with 107 of the 116 guards) | 235 s | 223 s | 7,608 | 27 |

Skipped by `-short`, by package (116 tests, every reason starts `slow:`): `internal/devworkspace` 80, `internal/devoutputs` 7, `backend/pkg/terminal` 6 (five floods and races; the two-hundred-shells test already had the guard, its reason now starts `slow:`), `internal/devsdk` 6 and `internal/devsdk/sdktest` 2, `backend/pkg/plugin/devserver` 5, `cmd/omniview-dev` 5, `internal/instance` 4, `internal/devsession` 1. The dev tooling is 110 of them: by the owner's order a pull request runs what the IDE needs, and the author runs the rest (rule 40). Most of those take under a second on the runner; what they cost is their number (`internal/devworkspace` 36 s to 17 s).

## Not skipped, for a fix (14 tests, 72 s of test time in the container)

A test that guards the shipped IDE and is slow only by a real clock keeps running; the fix is an injected short wait or a fake clock, then it is fast and stays:
- `backend/pkg/plugin/metric`: seven `TestFinite...` tests (27 s): a fixed 0.53 s wait in each subtest (the median and the maximum of the subtests are equal).
- `internal/settings` `TestGoExecutableValidation/timeout` 10.2 s; `internal/mcprelay` `TestBorrowedToolRemainsListedAfterNativeDiscoveryTimeout` 10.0 s; `backend/pkg/terminal` `TestASessionEndsAfterTheDrainCap...` 7.2 s and `TestTheKillAtTheGrace...` 3.0 s; `backend/pkg/plugin` `TestAnAcceptedPluginThatNeverAnswersShutdownBlocksStopAndKillUntilItsProcessEnds` 6.1 s (it pins a known wedge, S4-07); `backend/pkg/plugin/resource` `TestSourceCoordinatorCloseBoundedWhenRecvStalls` 5.0 s.
- `backend/pkg/terminal` `TestAMultibyteCharacterSplitAtAnyByteBoundary...` 3.1 s: shipped correctness, exhaustive and not a flood; left running.
- Ten tests (fsync, load) take 3 s or more on the macOS laptop and under 2 s on the runner: untouched.

## Checked here

`go vet ./...` and the lint in CI form (`--new-from-patch`, golangci-lint v2.15.0): clean. `go test -short ./...` and `go test ./...` natively on macOS: the only failures are `TestZshXtraceNeverPrintsTheNonce` (on main too) and, in the full run under a host load of 35 to 60, `TestTwoHundredDetachedTerminals...` (flaked on main under load too; it is now skipped by `-short`). `node --test scripts/go-test-failures.test.mjs scripts/ci/*.test.mjs e2e/scripts/*.test.mjs`: 368 pass. `actionlint`: clean.
Not verified: a CI run (the owner's rule: measure here); the nightly step (the first schedule proves it); the summary table on a real runner (it ran on the container's and the laptop's `-json` streams).

## Log

- 2026-11-25: built and measured; one push.
