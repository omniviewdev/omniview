### Whole-app profile (bench/app)

Commit 146c0b03, kubernetes plugin 8989a05, bundle sha256 129d49bdf177, Chromium 156.0.8078.4, Darwin arm64, Apple M5 Max, 128 GB.
Median of 5 runs, CPU throttle 1×, ms unless noted; first column also min–max. Startup times are from navigation start.
Workload whole-app/v1: Pod scroll takes up to 30 viewport steps through a complete source-view collection of 5,000 records, then resets. Actual steps include the reset; per-step timings use that count. Compare only matching workload ids and CPU throttles.
Frontend: react-dom/profiling (bench/app/vite.config.ts). React render, commit and slowest-commit columns include profiling overhead that a normal production build does not have. Minifier: "esbuild" (forced on).
Graphics: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver-5.0.0); compositing disabled_software, rasterization disabled_software; headless.
**Diagnostic frame timings only: hardware compositing and rasterization are not verified.**
Label base-profiling-on; app root /Users/joshuapare/Repos/omniviewdev/worktrees/ui-next-baseline.
Shared UI as resolved by the app root:
- @omniviewdev/base-ui 0.17.3 (declared ~0.17.3; package-store, dist sha256 db8098cb863f)
- @omniviewdev/ai-ui 6.1.14 (declared ~6.1.14; package-store, dist sha256 03e43c466642)
- @omniviewdev/editors 6.2.5 (declared ~6.2.5; package-store, dist sha256 0cc5015b4b79)
- @omniviewdev/providers 0.7.4 (declared workspace:*; host-workspace, dist sha256 22f818ec71cd)
- @omniviewdev/runtime 0.7.4 (declared workspace:*; host-workspace, dist sha256 0cc0f920b8c4)
Harness bytes: tree sha256 59cc12d72b1e (38 files); harness checkout 146c0b03.

**cold-start**

| step | interactive | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| cold-start | 728 (728–746) | 332 | 308 | 11.2 | 220 | 1 | 18.7 | 9 | 14.4 | 26.7 |

**cold-start-k8s**

| step | interactive | plugin home shown | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| cold-start-k8s | 734 (729–750) | 818 | 378 | 322 | 13.1 | 223 | 1 | 23.7 | 17 | 14.9 | 25.8 |

**pods**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 211 (205–215) |  |  |  |  | 201 | 120 | 18.9 | 27 | 2 | 89.3 | 22 | 58.2 | 72.9 |
| scroll | 1599 (1567–1601) | 31 | 30 | 51.6 | 29.1 | 903 | 388 | 253 | 0 | 0 | 146 | 31 | 8.2 | 126 |

**logs**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 57.7 (55.7–65.9) |  |  |  |  | 30.2 | 16.4 | 3.1 | 0 | 0 | 7.3 | 15 | 4.1 | 44.5 |
| stream | 640 (613–671) |  |  |  |  | 319 | 127 | 43.5 | 0 | 0 | 64.7 | 82 | 1.5 | 63.5 |
| scroll | 1034 (1032–1035) | 31 | 30 | 33.3 | 5.8 | 181 | 72.7 | 16.6 | 0 | 0 | 37.1 | 59 | 0.9 | 67.9 |
| drawer | 331 (329–333) | 10 |  | 33.1 | 14.0 | 140 | 67.5 | 27.6 | 0 | 0 | 25.5 | 31 | 3.8 | 67.1 |

- cold-start: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
- cold-start-k8s: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
