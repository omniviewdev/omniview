# How we work

The method behind every terminal pull request on `main`, written so that a fresh agent can follow it without the history. It adds to `docs/ui-next/AGENTS.md` (read that first; "AGENTS 28" below is its rule 28) and does not replace it. Where a rule has a story, the story is one line: the rules here were each paid for.

## 1. The loop

1. Take one step of one issue. A step is small: one behaviour, one pull request.
2. Open a worktree from `origin/main` (section 4). Never work in the owner's checkout.
3. Write the failing tests first and see them fail for the reason you state (section 5).
4. For anything a person sees, run the real thing in a real browser first and look at the screenshot (section 6).
5. Write the code. Run only the targeted checks while you work.
6. Prove it on the real host: the seam scenario in both engines, a probe where the page is involved (sections 7 and 8).
7. Attack your own work: adversarial timing, an operation against itself, the end state, a peer that misbehaves (section 9). Add negative controls.
8. Commit once, push once, open the pull request ready for review (not draft). Wait for CI and for CodeRabbit (section 12).
9. If the issue says "Review required: yes", a fresh agent reviews it before it merges (section 13).
10. Merge only when the gate holds (section 15). Report in at most eight terse lines (section 17).

## 2. Who is who

- **The owner** decides what the product is. Their rulings are in `README.md`, section 4, word for word.
- **The lead** merges green pull requests, cuts SDK tags, updates `docs/ui-next/TRACKER.md` from the status files and writes the backend catalog. If you are the engineer who took the epic, you are the lead for your own pull requests: the merge gate (section 15) is yours to run.
- **You** (an agent or an engineer with agents) build one step at a time. You may use subagents for independent slices (section 3); you stay responsible for the whole result.
- **A reviewer** is a fresh agent that has not seen your work: independent, read-only, with its own worktrees (section 13).
- **CodeRabbit** is the automated reviewer on every pull request. Its comments are read, fixed or answered (section 12).

## 3. One step, one pull request, one push

- One step is one pull request is one commit is one push (AGENTS 13, 23). Finished work is not left on a `wip/` branch (AGENTS 38).
- Save unfinished work on a `wip/<branch>` branch with no open pull request. Every push to a pull request branch starts about sixteen CI jobs on a plan that runs twenty at once: push once per CI answer (AGENTS 23).
- Never cancel the run of the commit you ask to merge (AGENTS 24).
- Subagents: split only along files and contracts that do not overlap (AGENTS 7: one owner for each file). Give each a brief with the goal, the files it owns, the acceptance, three to six items at most, and end it with the reply-style line of section 17. A subagent does not run the whole suite or merge; you run the checks once after they land.
- Work that changes the contract between two parts (Go and page, host and SDK) lands the producer first, with its tests, and the consumer in the next pull request.

## 4. Worktrees and the machine

- Work in a `git worktree` from `origin/main`: `git worktree add -b <branch> <path> origin/main`, by default under `~/Repos/omniviewdev/worktrees/<branch>`. Leave it in place and record its path in your status file (AGENTS 6). Set no upstream that points at `main`; push with `git push origin <branch>:<branch>`.
- Write `docs/ui-next/status/<step>.md` before you start (goal, worktree, branch) and append a dated line after each meaningful step; on finish: the pull request URL, the exit test, what was not verified, a "Dev tools" heading for every script, probe or fixture you used or wrote, and a "Backend catalog" heading for what belongs in the SDK, a plugin or the host (AGENTS 12, 18, 22).
- Once per worktree: `pnpm install --frozen-lockfile`, then `task packages` (builds the providers, the runtime, the vite plugin and the kit; the new UI imports the BUILT kit), then `git checkout -- packages/omniviewdev-vite-plugin/shims/_omniviewdev__runtime__models.mjs` (the build dirties that tracked shim; never commit it). Every frontend build deletes tracked `dist/.gitkeep`: `git checkout -- dist/.gitkeep`.
- Go: `GOWORK=off GOTOOLCHAIN=local`. Wails bindings only through `task bindings`. Lint blocks on the lines you changed, so reproduce it before you push (AGENTS 31): commit, then `git diff --no-ext-diff --no-color origin/main...HEAD > /tmp/changes.patch && GOWORK=off golangci-lint run --new=false --new-from-patch=/tmp/changes.patch --path-prefix=` with golangci-lint v2.15.0 (`docs/ui-next/status/N24-L2.md`).
- Before you replace or rewrite a terminal, a log viewer, a table or a startup path, read `docs/ui-next/optimisations.md` (section 4 for the terminal) and keep every item of its "must not regress" list (AGENTS 14).

## 5. Tests first, seen red

- Write the test, run it, and read why it fails. It must fail by its own assertion, with words that say what is missing, not because it does not compile or because a name is misspelled. Commit the red test, then the fix (AGENTS 5). A test you never saw red proves nothing.
- Every guard has a **negative control**: a deliberate fault that the guard must catch. The control must trip the assertion it is named for and no other, and the same fault must pass undetected when that assertion is removed (AGENTS 28: the controls of N24-D1 were removed one by one, 71 of 71 went red). Go: a fault in a scratch copy of one file, run with `go test -overlay`, the worktree untouched (see `docs/ui-next/status/T1-go/mutations*.sh.txt` and `T2-go/mutations.sh.txt`). Probes and seam: the table of controls (`controls: [...]` in a probe unit, `SEAM_CONTROL=<name>` in the seam) and `ASSERTION_OFF`.
- Tests that cannot go red on the fault they claim to catch are the commonest defect of proof tools: CodeRabbit found four faults in the proof tools of one pull request and five in another after the code had merged (AGENTS 29). Settle the review of the proof tools before the code they prove merges.

## 6. The real surface first

- Component tests and screenshots do not prove a screen (AGENTS 8). Before you design a UI change, run the real host and open it in a real browser: `OMNIVIEW_UI=next task build:server`, then `HOME="$(mktemp -d)" OMNIVIEW_CHANNEL=feature-ui-next bin/Omniview-server` (http://localhost:34115/), or the probes' fixture (`node ui-next/shell/probes/terminal-look.mjs` builds the fixture, opens it in WebKit and Chromium and photographs it). Use Playwright's WebKit and Chromium. A native WKWebView window is a different claim: say which you ran and which you did not.
- Take a screenshot and **look at it** (open the image; do not infer from the DOM). Compare it with the mock where the mock has the part. The mock is a guide for placement, tokens and words; for the terminal it does not limit what the terminal can do (README, section 4, the owner's ruling of 2026-11-22).
- Check `uptime` before a timing-sensitive probe or bench and write the load in the status file (AGENTS 27). Start probes and the seam from a clean environment: no `ENGINES`, `VIEWPORTS`, `NEGATIVE_CONTROL`, `REPORT` or `DIST` left over from an earlier run, the kit built with `OMNIVIEW_UI=next` (AGENTS 35). `FONT_DELAY_MS=40` in front of any probe holds the fonts back, as a runner does.

## 7. The seam: the real host, both engines

`ui-next/plugins/e2e/seam.check.mjs` drives the REAL Go host (server mode, built with `OMNIVIEW_UI=next`) with a browser. It is the only check that does, and CI runs it (`.github/workflows/ui-next-seam.yml`, every phase and every control in both engines, in the jobs `scripts/ci/seam-units.mjs` packs to). The terminal scenarios are `r` (the tool), `r2` (the emulator against the programs of the machine: less, vim, top, resize, paste, mouse, wide characters), `r3` (a reload), `r4` (a second tab, a host restart, a lease) and `r5` (take it back, events-socket blips and outages, a shell killed while the page is away).

```sh
task packages
OMNIVIEW_UI=next GOWORK=off GOFLAGS= GOTOOLCHAIN=local task build:server
env -i HOME="$HOME" PATH="$PATH" ENGINES=webkit node ui-next/plugins/e2e/seam.check.mjs     # then ENGINES=chromium
env -i HOME="$HOME" PATH="$PATH" ENGINES=webkit SEAM_TERMINAL_ONLY=r3,r5 SEAM_TERMINAL_REPEAT=5 node ui-next/plugins/e2e/seam.check.mjs
env -i HOME="$HOME" PATH="$PATH" ENGINES=webkit SEAM_CONTROL=<control name> node ui-next/plugins/e2e/seam.check.mjs
```

- A terminal change adds or extends a scenario here, not only a probe. Run it in both engines before you push. `SEAM_SHELL=<path>` runs it against another shell (CI's image has bash, a Mac has zsh); `SEAM_PLATFORM=linux` runs the Linux and Windows branch of the chords on a Mac.
- The seam fails on any runtime 4xx or 5xx that is not on its allow-list with a reason written beside it (AGENTS 37). Never widen the allow-list to make a run pass: name the host defect instead (the entry for the events-socket blips of `r5` is the model, with B-114).
- Wait for what you assert; never for time. A seam flake that was a label lasting 15 ms was found by reading the scenario, not by a longer timeout (B-80).

## 8. Probes

- A probe drives the page (the real kit, a fixture host) in WebKit and Chromium at 1440 x 900 and 1280 x 800 (AGENTS 21). The terminal's are `ui-next/shell/probes/terminal-probe.mjs` (`PART=view`, `data`, `reattach-a` to `reattach-f`) and its siblings; `terminal-fixture.tsx` invents only the far end (a host that speaks T1-go and T2-go), and `terminal-host.mjs` is that host as plain Node.
- A new probe or control goes into the unit directory `scripts/ci/probe-units/` (one file per probe: `terminal.mjs` for the terminal) **and** into `scripts/ci/probe-units.manifest.json`, never into a workflow step (AGENTS 25). `node scripts/ci/probe-shards.mjs check` fails for a probe no unit runs. A unit that takes more than its seconds plus the larger of a quarter of them and 60 s fails with the number to write down.
- **Counts, not milliseconds.** Assert what the page did: commits, requests, bytes, frames, events, acknowledgements, goroutines, processes, descriptors. A bound that is a time keeps at least three times the laptop's figure as room and says so (the terminal's key latency bound: 50 ms idle, 100 ms under a flood, against 1 to 6 ms measured).
- **Seconds come from the runner.** After a new unit's first runs on CI, set its `seconds` with `node scripts/ci/probe-seconds.mjs --write` (the 95th percentile of the runner's recent runs, rounded up to 5 s; it reads the drift tables of the last thirty runs and leaves a unit with too few samples as listed; `--keep <id>` leaves a unit alone). Do not force such a unit with `--few-samples`, and do not estimate from your laptop: a value from a laptop or from one runner sample fails other pull requests' drift check (AGENTS 25).
- Run the kit's `verify` before you push anything under `ui-next/` or `packages/kit/` (`pnpm --filter @omniviewdev/kit run verify`; it holds the plugin-vocabulary guard, AGENTS 26). Run the same commands CI runs (AGENTS 17): the full `pnpm test`, `pnpm lint`, the three `tsc` projects, and the probes with `FONT_DELAY_MS=40`.

## 9. Tests that cannot lie

Every one of these found a real defect in this codebase.

- **No test is decided by a sleep.** Wait for the event, with a bounded wait that fails only when the event never comes. Use gates, frozen goroutines and controlled promises to force an order; use a fake clock for leases and timers (`backend/pkg/terminal/clock.go`). A wait for something NOT to happen can only get weaker on a busy machine and is fine; an upper bound on a process's duration and a tolerance window around `time.Now()` are not (the sweep and its kinds a to g are in `docs/ui-next/status/T2-go.md` section 7.1: a write that ends the shell can be answered either way, and a test that asserted one answer failed in CI).
- **Force the order.** For every pair of operations that can overlap, put a gate at the point between them so that the test, not the scheduler, decides who goes first; red on `main`, green on the fix. Run both orders.
- **An operation against itself is a pair.** Two overlapping `UpdateSessionOptions` left a source enabled in the options and stopped; the first review had enumerated pairs of different operations and missed it (SDK #84). Put "same operation against itself" in every pair table.
- **Assert the end state, not "it did not crash".** After the hammer (30 s plain, 30 s `-race`, many goroutines, random timing), count: sessions 0, processes 0 (by the pids you recorded at creation, with their start times), timers 0, goroutines and descriptors back to the baseline, exactly one CLOSE per session, the stream equal to the generator byte for byte. `backend/pkg/terminal/reattach_flood_test.go` and the `AfterEverythingSettles` test are the model.
- **Misbehaving peers.** A reader that stops reading; a reader that reads and never acknowledges; a page whose socket reconnects every second with the same client id; two tabs with the same page key; forged window headers; a shell that ignores SIGHUP; a background job that holds the pty open and writes; `yes` as the flood; a closing window while its terminal is starting; hostile output (`cat` a file that prints forged marks).
- **Adversarial timing in a starved machine.** Reproduce a timing defect where it lives: a Linux container with two CPUs and busy loops inside it (`docker run --rm --cpus 2 ...`). Three failures in 300 runs of a "flaky" resize test were found this way; 0 in 300 after the fix.
- **Real processes, not fakes, where the claim is about processes.** `vim`, `less`, `top`, `tmux`, a SIGHUP-ignoring shell, bash 3.2 and 5, zsh, dash. A program the machine lacks is named as not run, never silently skipped.

## 10. The machine is shared

- No host CPU burners: never run busy loops, `stress` or spin tests on the shared host. Other agents' timings, probes and hosts share it (AGENTS 27: load average 5 to 12 recorded, 100 to 140 once). A starvation test runs in a container with `--cpus 2`, with the burners inside.
- **Never kill or delete by pattern.** No `pkill -f`, `killall`, `kill $(pgrep ...)` by name and no `rm` or `git branch -D` by glob: other agents' hosts, browsers and worktrees match your pattern. Start a process, keep its pid (`$!`), kill exactly that pid. In tests, record the pids of what you start and check them at the end together with their start time (a pid can be reused). Delete a worktree or branch by its exact name, and only your own.
- Use `omniview-dev` (the workspace tools; `.agents/skills/omniview-instance-verification/SKILL.md`) to find the instance you mean before you mutate anything; a port, a pid or an old lease proves nothing about which instance you are looking at.
- Never put a backtick inside a double-quoted shell string: the shell runs the text between the backticks. Put a pull request body, a commit message or a comment in a single-quoted string or a quoted heredoc (AGENTS 34).

## 11. The producer states the fact; the consumer never guesses

The owner's rule (2026-11-21, README section 4): when the host or the page would have to GUESS something the producer knows (is a command running, where it ended, which directory, whether the shell integration is on, how a stream ended), stop and add the signal at the producer, typed, with `unknown` as a state of its own. Then delete the consumer-side inference in the same pull request: no double pathway.

In this code: `IsBusy` says idle, busy or unknown and the close question asks on unknown; `Attached.next_input_seq` replaced a page that guessed the next input number; the typed `End` replaced the word "Exited"; replay markers in the log lane deleted the timestamp inference of the log rate. Producer-side changes may break the SDK's wire (the owner allows it): once, with a version bump and a plain refusal for a mismatched plugin, never silently.

## 12. CodeRabbit

Before you report a pull request ready (AGENTS 16):

```sh
gh api repos/omniviewdev/omniview/pulls/<n>/comments --paginate        # inline review comments; top-level ones have in_reply_to_id null
gh api repos/omniviewdev/omniview/pulls/<n>/reviews --paginate         # the review summaries
gh api repos/omniviewdev/omniview/issues/<n>/comments --paginate       # the walkthrough and the notes
```

- Read every comment. Fix each real defect, and every Major, **before** you report; answer each thread in the thread (`gh api -X POST repos/omniviewdev/omniview/pulls/<n>/comments/<id>/replies -f body='...'`) with the commit that fixed it or the reason you did not. Report how many there were and what you did. A comment that is right about a test that can fail for the wrong reason is right.
- If it was rate-limited or skipped, say so and move on. A review that lands after your report is read too.
- The merge gate counts a top-level CodeRabbit comment without a reply as unanswered (section 15).
- It has found real faults: the proof tools of two pull requests (AGENTS 29), a cleanup of a failed create that ended a terminal another window had taken over (#674), a gap timer that could fire for numbers a newer timer still waited for (#658), and probes that counted a rejected resize as finished. Treat it as a reviewer, not a linter.

## 13. Independent review

**When it is required.** Before anything merges that touches processes, signals, credentials, the plugin channel, file handling, locking, uninstall or update, or a public SDK contract (AGENTS 36). The review of #613 found that its first version failed plugin updates 25 of 25 times under a concurrent lookup, which CI had not shown. Every issue says "Review required: yes" or "no" and what the reviewer must attack.

**How.** A fresh agent that has not seen your work, in its own worktrees, **read-only**: no push, no pull request comment, no change to your tree. Its brief says to trust nothing in the description: run it. It reports a verdict (`MERGE AS IS`, `MERGE`, `FIX FIRST`) and findings as BLOCKER, SHOULD or NOTE, each with the run that shows it, and lists what held under attack so nobody runs it again. You fix tests-first, and the reviewer reviews the fix ("follow-up on head X").

**The prompts that found real bugs.** Paste the ones that fit into the reviewer's brief.

1. **Forced order.** "For every pair of operations that can overlap, including each operation against itself, force the order with a gate or a frozen goroutine, not a sleep. Red on main, green on the fix. Then run a hammer for 30 s plain and 30 s with the race detector that asserts an end-state invariant: no sessions, no processes, goroutines and descriptors back to the baseline." Found: two overlapping option updates leaving a source enabled and stopped (SDK #84); a start that loses to `Close` (SDK #86); a claim after an admission that a retirement had fallen between (#677); stale output events after an attach's answer, 7 in 2,051 reattaches on Linux (#674).
2. **Built adversary.** "Build the client that misbehaves and aim it at the REAL host build (`go build -tags production,server`), not at the fixture: a reader that stops reading, one that never acknowledges, a socket that reconnects with the same client id, forged headers, a second tab with the same key, a shell that ignores SIGHUP, a background job holding the pty, `yes`. Record every pid it creates and check at the end that none is left." Found: closing a flow-paused session hung for 5 s on macOS (14 of 40 closes), a graceful host shutdown left the shells' background jobs running (67 of 67), a Linux session that never ended while a job kept the pty open (#658); a stalled client plus `yes` took the host from 67 MiB to 7.9 GiB; an events-socket reconnect locked a page out of its own shell (#677).
3. **Canary secret.** "Plant a unique secret string at the entry (typed in the real UI, in the environment of the host, in a plugin's error text, in an argument) and afterwards search every sink for it: logs, requests, frames, the DOM, storage, spans, audit lines, files, and the bytes of the database on disk." Found: `WAILS_MCP_TOKEN` (the host's bearer) reached the user's shell (#658, B-104); an erased setting value stayed readable in the settings database's freed pages (B-65, found in the review of #613, closed by #625); the Settings sheet's typed secret in no request or frame (#662, a negative result worth having).
4. **The real thing.** "Run the claim against what it is about: a real cluster's kubelet and containerd (kind), the real client-go, a real WKWebView, a real pty. Restart the kubelet, containerd and the API server in the middle of a session; kill the container's PID 1; rotate the log. Write down what the wire says." Found: "lose and repeat nothing" was false on a real kubelet and the first two-request design lost 4,100 lines (SDK #82); after a kubelet or containerd restart the API server sends an explicit Success for a command that did not exit 0, so "PROCESS for a Success" would print a false exit 0 (`exec-lane-k8s-proof.md`).
5. **Mutants.** "Remove each guard in a scratch copy of the file and name the test that turns red. A guard whose removal nothing notices is a defect in the tests." Found surviving mutants in #613 (three) and in the Windows work (two).

## 14. CI and reruns

- A red check: read its log first. If the cause is not your change (a runner that was cancelled before its jobs started, a cache miss), rerun **once** and write the cause in your report. A second failure of the same check is a diagnosis task: find and fix the cause or the flake at its root (a test decided by time is a test bug), never a third rerun. Do not raise a timeout to pass.
- A cancelled check is not a pass: its run is restarted once; if it stays cancelled, stop and say so. A run cancelled before its jobs are created leaves no check at all, so two pull requests once merged with no `PR Validation` result (AGENTS 24): read the workflow runs of the head, not only the check list.
- CI classifies a pull request by path (`scripts/ci/changes.mjs`): keep a docs-only pull request docs-only (Markdown under `docs/`), and a new-UI-only one new-UI-only; a path outside the class runs the whole suite (AGENTS 32).
- Reproduce a Go failure the way CI runs it: the image `ghcr.io/omniviewdev/omniview-ci` (digest in `.github/ci/image.lock`) for Linux; Windows has its own job (`windows-connection-profiles` in `.github/workflows/pr-checks.yml`).

## 15. Merging

You merge only when all of this is true; the lead's script checks it the same way.

1. The head you merge is the head you reviewed (`gh pr merge --squash --match-head-commit <full sha>`), the pull request is mergeable and its base is `main`.
2. Every check that is not CodeRabbit is a real success: none failed, none pending, none skipped except by design (the jobs a docs or new-UI path class skips are named in `scripts/ci/changes.mjs`), a cancelled run restarted once. Every pull-request workflow run of the head concluded success.
3. No top-level CodeRabbit comment is left without a reply.
4. The files changed are the files in scope; nothing under `dist/` or `build/`.
5. **The merge was tried locally first.** Merge the pull request into current `origin/main` in a scratch worktree, then build what a merge breaks, with the kit and the runtime built first: `task packages`; `pnpm exec tsc -p tsconfig.app.json --noEmit && pnpm exec tsc -p tsconfig.test.json --noEmit && pnpm --filter @omniviewdev/kit run typecheck`; `GOWORK=off GOTOOLCHAIN=local go build ./... && GOWORK=off GOTOOLCHAIN=local go vet ./<each package you touched>/...` (`go vet` run bare from the root checks only the root package); for a bound-method change `task check:bindings-check`. A pull request that is green on its own base can be red on a base that moved.
6. For a pull request that needs an independent review: the review's blockers are fixed, the fixes were reviewed, and the review is named in the pull request.

## 16. The SDK

- Nothing is tagged without review. SDK tags are cut by the lead from a green `main` head, after the merge gate and, for anything in the plugin channel or trust area, an independent review: a minor for a changed default, new API or wire detail, a patch for fixes only. A tag never covers the host or a plugin (README, section 4: "the lead may tag the SDK").
- **Exec v2 lives on `feature/exec-v2`, not on `main`, until its tag gate clears** (`exec-tag-gate.md`, the record of the review of the contract). A stable tag cut from `main` after the contract merges there would ship `exec.v2` for good, and the breaking-change guard baselines against the latest stable tag, so it guards nothing until one carries the file. A pre-release tag (`-rc.N`) is invisible to `@latest` and freezes nothing. SDK `main` stays releasable for small fixes.
- The host consumes only a released SDK tag whose checksums are in its reviewed-release list. A pin is its own pull request that moves the floor and `go.sum` and deletes the host's workarounds for what the SDK now says (`docs/ui-next/status/SDK1.md`, and the pin pull requests #654, #663 and #673 are the models). The plugin repositories pin on `feature/ui-next`; never push to a plugin's `main`.
- Producer-side signals belong in the SDK and breaking changes are allowed (README, section 4): a breaking change is made once, with a protocol or version bump and a plain refusal for a mismatched plugin.

## 17. Reporting and style

- Terse. Answer first. Fragments are fine. No recap, no narration, no lessons learned. Say what merged or failed, the blocker, the decision you need. Keep shas, numbers and error strings verbatim (the owner's rule of 2026-11-22, README section 4).
- After each pull request, at most eight lines: the pull request number, the **full** head sha, the checks (named, with any rerun and its cause), CodeRabbit (how many comments, how many fixed, how many answered), the independent review if there was one (verdict and what it found), the issue numbers it closes or advances, and what you did **not** verify.
- Say what you did not run. "Not verified: Windows, native WKWebView, Linux image" is a finding; a silent gap is a defect. Mark inference as inference.
- Every brief you give a subagent is short (goal, files owned, acceptance, three to six items) and ends with: "Reply caveman-terse: fragments, facts only, <=8 lines, no explanation unless a decision is needed."
- Code, commits, pull request texts and docs are written in normal prose; the terse style is for chat.
- No `Co-Authored-By` and no AI attribution in commits or pull requests (`CLAUDE.md`). Conventional commit titles: `feat(terminal): ...`, `fix(exec): ...`, `docs(ui-next): ...`, `test(seam): ...`.

## 18. Traps found the hard way

- `task packages` dirties a tracked shim; every frontend build deletes `dist/.gitkeep`. Do not commit either (AGENTS, Traps).
- `CI=true` in an agent's shell makes pnpm freeze the lockfile: use `CI= pnpm install` when you change a dependency. The kit pins vitest 5.0.5.
- A search of `docs/**` for the symptom first (AGENTS 33): "the host stops answering" was the 64-window limit of server mode, already written down.
- A native window reload keeps its window identity and a server-mode reload does not; a server-mode socket reconnect is a new window and is not a reload (B-79, B-87, B-114). Anything keyed on a window identity fails on a reconnect.
- A macOS process cannot finish exiting while its tty holds output nobody reads: a close must give the paused session credit or close the master. Linux does not wait. Test both.
- xterm.js 6.0.0 has paste, IME and WebGL gaps that are fixed only on its master branch (`prior-art.md`, section 5, pitfall 3). Read it before you touch `xtermEngine.ts`.

## 15. What CI runs on a pull request, and what you run before you push

A pull request runs `PR Checks` only (AGENTS 39): Go build, vet, tests, bindings freshness and lint; the UI build, type-check, lint, kit contracts and component tests; the C02 corpus; the CI script tests. The seam, the kit probes, the Pods cluster check, the application suite, the builds on all platforms, the Windows tests, the release packaging contracts and the benchmarks run at night and on request, and `ci-main-red` opens one issue when a night is red. So the proof of a change that touches them is yours, before the push: `task local:probes -- <unit>,<unit>` (or `-- --changed`) for the probe units your change touches and their controls in WebKit and Chromium; `task local:seam -- <unit>,<unit>` for the seam scenarios you touched in both engines; `gh workflow run ui-next-pods.yml --ref <branch>` when the plugin pin or `scripts/ui-next-pods/` changes; and the type-check of the shipped Kubernetes plugin UI against the built runtime when `packages/omniviewdev-runtime` changes. State each command and its result in the pull request body. The merger reruns the same on the merged tree. A terminal change still adds or extends a seam scenario (section 7): you run it locally now, and the nightly run is the second reader.
