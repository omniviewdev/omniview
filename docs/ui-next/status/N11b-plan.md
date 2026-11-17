# Status: N11b-plan (slice 1a build plan and seam skeleton)

- Agent: SlicePlan
- Goal: write `docs/ui-next/slices/1a-pods-list.md` (the build plan for the Kubernetes Pods list on real data in `ui-next`) and land the thinnest skeleton that removes the biggest unknown it finds (the `ui-next` entry reading a live Pod list from a connected cluster through the existing runtime). Plan merged-ready; skeleton verified or its blocker documented; CI green; stable build output unchanged.
- Worktree: `~/Repos/omniviewdev/worktrees/ui-next-slice-1a-plan` (read-only plugin checkout at origin/main 524d123: `~/Repos/omniviewdev/worktrees/ui-next-slice-1a-plan-k8s`; base for the stable-output compare: `~/Repos/omniviewdev/worktrees/ui-next-slice-1a-plan-base`)
- Branch: `ui-next/slice-1a-plan`
- PR: see the tracker row N11b

## Log

- 2026-11-16: worktree created from `origin/main` 146c0b03; steering files, background notes, runtime data hooks read; scouts ran on the Kubernetes plugin, the host loader and the mock contract (the plugin scout had no shell and was re-run against a read-only checkout).
- 2026-11-16: skeleton built test-first (red commits, then green): `ui-next/main.tsx` opens `?screen=pods`, which lists the live Pod names of a connection through `useResourceTypes`, `useResolvedResourceTarget` and `useResources` with the old table's arguments. Ran against a real kind v1.35 cluster, the real Go host (`-tags production,server`, `OMNIVIEW_UI=next`) and the Kubernetes plugin built from 524d123: the page's 25 names equal `kubectl get pods -A`; a Pod added and deleted shows and disappears in about 90 ms; 1,025 and 5,025 real Pods delivered (first row 0.7 s and 2.7 s). Seven probes against the first version of the seam test each failed it; the second red commit shows the page-size and live rule failing before its fix.
- 2026-11-16: stable output compared (`vite build`, 137 files each, `diff -r` empty) between origin/main and the branch; `scripts/react-compiler.test.mjs` and `scripts/ui-flavour.test.mjs` pass (16 tests); `pnpm lint` 0 errors (8 warnings already on main); `pnpm test` 1,754 pass.
- 2026-11-16: owner decision added at the lead's request: tracker row N16 and decision A9 (licensing follows Grafana's model). Text only; no licence work in this PR.
- 2026-11-16: rebased onto origin/main 8e89e851 (#508) with no conflict; the N8 baseline's Pods numbers are cited in the plan (3.3, E10).

## NOT verified

The native app and WKWebView; Windows and Linux; a channel build; `OMNIVIEW_UI=next task dev`; metrics; any plugin UI in the new tree; mutating calls from a browser tab (empty principal). Full list: plan appendix D.
