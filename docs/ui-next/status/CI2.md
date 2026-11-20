# Status: CI2 (name failed vitest tests in the job summary)

- Agent: UiFailNames
- Branch: `ci/ui-failed-test-names` (base `origin/main` 4c81c90d)
- Change: `UI checks` runs its three vitest steps (Component tests, Age clock, Runtime contract) with the JSON reporter beside the default one, into `$RUNNER_TEMP` (untracked). A last `if: always()` step runs `scripts/vitest-failures.mjs`: on failure the files, test names and first assertion line (at most 30 tests, 300 chars each); on success one line of counts. Vitest's exit code is unchanged. `scripts/vitest-failures.test.mjs` (run in CI) is fed a passing and a failing report.
- Proof: see PR description.
