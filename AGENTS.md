Repository guidelines are in `CLAUDE.md`. New UI work (`ui-next/`, `packages/kit`): read `docs/ui-next/AGENTS.md` first.

# Rules (one line each; each comes from a real failure)

## Scope
- Do the stated task only. A side finding is one line in your report, not a change.
- One root cause, one place, smallest diff. More than about 5 files, or a new helper, wrapper, config file or abstraction: stop and ask first.
- Find WHY before changing anything. State the cause with evidence, then fix it. Never patch the symptom.
- Standard, documented routes first. Custom tooling only when the documented options are measured and not enough.
- Never reformat, re-wrap or reorder to change a line count or a diff size.

## CI
- A pull request runs `PR Checks` only (build, lint, type-check, unit tests). Adding a job, check or workflow to a PR needs the owner's yes; a new test joins an existing job.
- Probes, the seam, the Pods cluster check, e2e and platform builds run nightly. Run the ones your change touches locally and state the result in the PR: `task local:probes -- --changed`, `task local:seam -- <unit>`.
- Measure and prove locally (a `--cpus 2` container approximates the runner). Never push to learn what a local run can tell you.
- Make CI cheaper by deleting, not by adding machinery that decides what to run. A CI change that adds more than it removes needs a stated reason.
- A red check: read the log first. One rerun, with the cause stated. The same test red twice: diagnose it, do not rerun.

## Tests
- Fix the cause of a warning; never mute it. No `console` mock without an assertion on the exact message, no output filters, no `silent`.
- Do not wrap a `user-event` call in `act`: user-event manages `act` itself, and the wrapper causes "not configured to support act".
- A test that changes a store directly does it inside `act`, or awaits the UI that results. No shared helper for this.
- A test that expects a warning asserts its exact text.
- No performance or size tests in the unit suite (megabyte inputs, wall-clock budgets, huge loops). Assert the behaviour at the smallest input that crosses the boundary; speed belongs to the nightly probes.
- No outcome decided by the wall clock: wait for the event or condition. A fake clock must not follow real time near a limit.
- Slow Go test (3 s or more): first line `if testing.Short() { t.Skip("slow: <why>") }`. A slow test of shipped behaviour is not skipped; make it fast.
- Vitest prints less when it detects an agent. To see what CI prints: `pnpm test --reporter=default`.
- Component tests run in the VM pool. A file that cannot is listed in `forksOnly` in `vite.config.ts` with its reason.
- No debug `console` logging in product code.

## APIs and the SDK (alpha: no outside consumers yet)
- Making an API or the SDK better is wanted, and a breaking change is allowed when the improvement is the point of the work: say what breaks and why the new shape is better, then move every caller (host, runtime, Kubernetes plugin) in the same effort. Leave no shim.
- A break is never a side effect. Work with another goal leaves existing signatures as they are; a better shape you notice on the way is a proposal in your report, not a change.
- Know the callers before you change one: for `packages/omniviewdev-runtime`, type-check the Kubernetes plugin's UI against the built runtime before pushing.

## Machine
- Work in a worktree under `../worktrees/`. The owner's checkout is read-only.
- No CPU burners on the host; load goes inside a `--cpus 2` container. Stop processes by recorded pid, never by pattern.
- Go commands: `GOWORK=off GOTOOLCHAIN=local`. Bindings: `task bindings` only.
