---
name: omniview-performance-profiling
description: Use when setting up an Omniview performance workspace, seeding a Kubernetes load cluster, capturing host or plugin pprof profiles, investigating slow cluster entry or timeouts, or separating backend waits from browser/native UI costs.
---

# Performance profiling

Use **omniview-workspaces** for lifecycle and **omniview-instance-verification** for identity. Follow [workflow](references/workflow.md) for executable setup and capture commands. Do not treat an old endpoint, successful build, or listening Vite port as runtime proof.

1. Preserve dirty checkouts. Update clean main with a fast-forward only when requested. Update the targeted Homebrew Omniview cask; its app bundle supplies `omniview-dev`. Do not upgrade every formula.
2. Resolve the collection, workspace UUID and selected repositories. For application profiling, resolve the SDK commit from host `go.mod`, UI packages from the host lockfile and Kubernetes from the host gitlink. Select `plugin-sdk` explicitly and use successful pinned pnpm probe evidence. Fetch missing committed refs without resetting worktrees.
3. Inspect existing kind clusters before creation. Recover a missing worktree-local kubeconfig explicitly; never recreate or delete a same-name cluster automatically. Configure the plugin to use only the dedicated lab's absolute kubeconfig. Workspace profiles do not isolate HOME or cloud credentials.
4. Seed baseline only in the dedicated lab. Wait for settled inventory, not merely Deployment Available. Record labeled and total Pods/Events, readiness, deleting Pods, and activity. Reseeding can roll workloads and creates controller Events; presets do not prune, and Events expire.
5. Enable host and plugin profiling through this workspace's settings API, disable continuous profiling, and restart with saved launch options. Read new endpoints and verified PID/start identities from the actual pprof surface. `workspace restart` does not accept `up`'s mode/watch flags.
6. Capture before the actual click. Keep connection startup, first visible data, fully synced, quiet idle, and bounded churn separate. Save host and plugin CPU, heap, goroutines and traces privately, with source/instance/workload metadata. Decode every claimed capture. CPU sampling does not explain network waiting; take in-flight goroutines or a Go execution trace.
7. Exercise the rendered dashboard and Pods table. Browser/server-mode evidence is not native WKWebView, WebContent/GPU attribution, or a matched Lens benchmark. Native UI work uses Safari Timelines; public process inventory does not map WebKit worker PIDs.
8. Record reproducible failures with elapsed time, safe request ID, stage and source. Do not infer auth/network failure from public 408. Use controlled latency only as a labeled experiment; it does not establish the affected cluster's cause.
9. Stop owned churn/proxies and remove temporary fixtures. Restore the lab-only setting, restart if needed, rediscover endpoints, and leave a verified usable workspace unless asked to stop it. Never publish credentials or raw captures.

Current evidence and tracked defects: [2026-11-02 profiling investigation](../../../docs/performance-profiling-2026-11-02.md). Recheck current source rather than copying historical commits or ports as launch authority.
