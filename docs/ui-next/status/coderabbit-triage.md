# CodeRabbit triage of the PRs merged since #497

Branch `ui-next/coderabbit-triage`, worktree `~/Repos/omniviewdev/worktrees/ui-next/coderabbit-triage`, based on `origin/main` 14f3d9f5 (#517). Read on 2026-11-16/17 through `gh api repos/omniviewdev/omniview/pulls/<n>/{comments,reviews}` and `issues/<n>/comments`, bot login `coderabbitai[bot]`. No other bot commented. The one human comment (#510) is a CI report.

Verdicts were taken against the code at `origin/main`, not from the bot's text.

## Coverage

| PR | Merged (UTC) | CodeRabbit | Inline comments |
|---|---|---|---|
| #497 graph: resolve-only declarations | 11-16 22:09 | reviewed | 1 |
| #498 graph: closed observation tokens | 22:09 | rate-limited | 0 |
| #500 graph: failed observation retry | 22:10 | rate-limited | 0 |
| #501 delete dead host files (N7) | 22:52 | skipped (the PR was a draft when the bot looked) | 0 |
| #502 bad activities.json (N6) | 22:52 | rate-limited | 0 |
| #503 empty ui-next frontend (N3) | 22:52 | rate-limited | 0 |
| #504 MCP relay consent and token | 23:24 | reviewed, "No actionable comments" | 0 |
| #505 resource test wait (N14) | 23:49 | rate-limited | 0 |
| #506 steering, channel guide, mirror (N4, N3b) | 23:55 | rate-limited | 0 |
| #507 kit: tokens, themes, guards (N11a) | 11-17 00:17 | rate-limited | 0 |
| #508 baseline of the current app (N8) | 00:54 | reviewed | 2 |
| #509 slice 1a plan and skeleton (N11b) | 01:49 | rate-limited | 0 |
| #510 kind cluster job (1a.1) | 02:35 | reviewed two pushes, rate-limited on the later ones | 7 |
| #513 optimisation inventory (N17) | 02:52 | rate-limited | 0 |
| #515 kit atoms Icon, Button, IconButton (1a.4a) | 03:03 | rate-limited | 0 |
| #514 data layer of the Pods list (1a.2) | 03:28 | reviewed one push, rate-limited on the later ones | 9 |
| #517 kit DataTable and TableFit (1a.3) | 04:08 | rate-limited | 0 |

#511 and #512 are closed negative-control demos (not merged). #516, #518 and #519 are open and out of scope.

Total: 19 inline comments on 4 PRs (#497: 1, #508: 2, #510: 7, #514: 9); 11 PRs rate-limited with no review; 1 skipped; 1 reviewed clean.

Why the bot is rate-limited (its own comment text): "You've used all free OSS reviews for now ... Next included review available in N minutes". It is the free-OSS quota of the organisation, one included review per window; every push of a PR spends it. The run configuration reads "No configuration file from this repository applied" (there is no `.coderabbit.yaml`). Per the owner, being rate-limited is accepted and no configuration is changed here.

## Verdicts

Verdicts: VALID (a real defect or risk), FIXED-HERE (valid, fixed in this PR), DEFERRED (valid, in a file an open PR is changing: lead to carry it), N/A (wrong or not applicable), STYLE (hardening or taste, no defect shown).

### #497 (1)

| # | File | Comment | Verdict |
|---|---|---|---|
| 1 | `backend/pkg/plugin/resource/graph_demand.go` | Major: an inverse declaration must have the opposite direction, or Node-outgoing returns an empty, non-truncated result | N/A. The same-type, same-relationship inverse is deliberate: the real edge of `runs_on` is the Pod's outgoing one, so a resolve-only Node row has nothing to add, and `extractedInverse`'s comment and `TestGraphDemandResolveOnlyInverseDeclarationsDoNotFailQueries` ("node outgoing", "pod incoming runs_on": empty and not truncated) pin it. The suggested fix would return `UNSUPPORTED` for those queries, the failure #497 removes. Residual question for the owner: a resolve-only row declared in the direction opposite to its real edge is accepted as covered by any extractor-backed row between the same two types with the same relationship type. |

### #508 (2)

| # | File | Comment | Verdict |
|---|---|---|---|
| 1 | `docs/ui-next/baseline/2026-11-16.md` | Minor: at `146c0b03` the scripts `run.sh`, `bytes.sh`, `collect.mjs` do not exist | FIXED-HERE. True (they came with #508). The doc now names the scripts revision (`8e89e851`) and how to copy them in without moving the app revision. |
| 2 | `docs/ui-next/baseline/run.sh` | Minor: the default `RAW` is flat, `collect.mjs report` reads only `raw/pass<digits>/` | FIXED-HERE. True (`/^pass\d+$/`). The argument is now required; a default `pass1` would overwrite the recorded pass. |

### #510 (7)

| # | File | Comment | Verdict |
|---|---|---|---|
| 1 | `.github/workflows/ui-next-pods.yml` | Minor: path filters omit the Go host sources (`*.go`, `go.mod`, `go.sum`, `backend/**`, `internal/**`) | DEFERRED, valid risk: the job builds the Go host, so a Go-only change never runs it. Cost: a kind job on every Go PR; the lead decides. File is changed by #519. |
| 2 | same | Minor: six actions use mutable tags, `pnpm/setup` is pinned | DEFERRED, hygiene. The repo convention is tags (34 `actions/checkout@v4`, 3 pinned); a policy change is the lead's. File is changed by #519. |
| 3 | same | Minor: `git checkout -- shim` after `task packages` discards a legitimate change to the shim | N/A. `git checkout --` restores the shim from the index, which is the PR's own committed content; only what `task packages` regenerated is discarded. |
| 4 | same | Major: install GTK 4 and WebKitGTK before `task build:server` | N/A. The step does not run `task build:server`: it runs the frontend build and `CGO_ENABLED=0 go build` (the workflow comment says why); the job was green on run 44000717808. |
| 5 | `ui-next/e2e/host.sh` | Minor: `stop` sends SIGTERM and does not wait | FIXED-HERE (test first: `ui-next/e2e/host.test.mjs`). `stop` waits up to 10 s, then SIGKILL, then removes the pid file. |
| 6 | `ui-next/e2e/pods-cluster.check.mjs` | Minor: `busybox` pull from Docker Hub in the live-probe test | STYLE. The bot itself says the Pod is listed when created, pulled or not; the test needs only the Pod object. |
| 7 | same | Minor: final assertion compares the page with its own earlier reading | STYLE. Speculative flake (a controller renaming a Pod during a 20 s test); no failure seen, and both readings track the same cluster. |

### #514 (9)

| # | File | Comment | Verdict |
|---|---|---|---|
| 1 | `docs/ui-next/status/1a.2/driver.mjs.txt` | Minor: `coldStart` does not wait for the old host to exit | VALID, noted in the file. An archived scratch driver "as it ran", with results already recorded; its code is unchanged and a known-defects header says so. Not re-run (needs the cluster). |
| 2 | same | Trivial: the `__int.dump()` comparison is not kept beside the driver | VALID, noted in the file's header: the recorded `compared` and `mismatches` came from an ad hoc cell that was not kept. The Integration probe's results stay in `raw/`. |
| 3 | `docs/ui-next/status/1a.2/Probe.tsx.txt` | Minor: the heartbeat ignores the last gap once `acq.done` is set, so R3's `blockedMs` can miss a completion stall | VALID, noted in the file. R3's "blocked time 0 against 0" is therefore a lower bound; the recorded numbers are unchanged. |
| 4 | same | Minor: `sameKey` compares key sets, R4 needs each object to keep its key | VALID, noted in the file. R4's evidence is set membership only. The hand-off uses `HostRecord.key` from the host (`ui-next/k8s/row.ts`), and no re-key was observed, but the probe did not prove it per object. |
| 5 | `packages/kit/eslint/plugin.mjs` | Minor: `import(\`./pods/Page\`)` (a template with no substitution) escapes `scaffold-boundary` | FIXED-HERE (test first). Static templates are read like strings, in `import()` and `require()`. |
| 6 | same | Minor: other host aliases (`@hooks/x`...) are not rejected in plugin code | FIXED-HERE (test first). `@components`, `@hooks`, `@layouts`, `@pages`, `@theme`, `@types`, `@utils` (the aliases of `vite.config.ts` and `tsconfig.app.json`, bare or with a path) are rejected. The bot excluded `@types`; it is an alias into `ui/types` here, and nothing imports a DefinitelyTyped package by that name. |
| 7 | `packages/kit/eslint/vocabulary.mjs` | Minor: `usePods2` (a numeric suffix) is not detected | DEFERRED, valid (confirmed: `scanText('const x = usePods2;')` returns no hit). File is changed by #516. |
| 8 | same | Minor: the begin/end markers count anywhere in a line, even inside a string assignment | DEFERRED, valid (confirmed: three string assignments make an exempt region). File is changed by #516. |
| 9 | `ui-next/k8s/state.ts` | Minor: a cancelled query error hides a failed source (`??` picks the cancellation before `podsFailure` drops it) | FIXED-HERE (test first). Each error goes through `podsFailure` before the coalescing. |

## For the lead (files an open PR changes)

- `.github/workflows/ui-next-pods.yml` (#519): #510 comments 1 (Go paths in the path filters) and 2 (pin actions). The new `ui-next/e2e/host.test.mjs` is not run by CI yet: add `node --test ui-next/e2e/host.test.mjs` next to the "Oracle contracts" step.
- `packages/kit/eslint/vocabulary.mjs` (#516): #514 comments 7 and 8, each with a negative control in `vocabulary.test.mjs`.
- Owner question from #497 comment 1 (see above).

## Log

- 2026-11-17: triage done, 19 comments read. Fixed: #508 (2), #510 (1), #514 (2 code, 1 ui-next). Rule 16 added to `docs/ui-next/AGENTS.md`.
