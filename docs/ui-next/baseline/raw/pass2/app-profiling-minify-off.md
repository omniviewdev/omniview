### Whole-app profile (bench/app)

Commit 146c0b03, kubernetes plugin 8989a05, bundle sha256 129d49bdf177, Chromium 156.0.8078.4, Darwin arm64, Apple M5 Max, 128 GB.
Median of 5 runs, CPU throttle 1×, ms unless noted; first column also min–max. Startup times are from navigation start.
Workload whole-app/v1: Pod scroll takes up to 30 viewport steps through a complete source-view collection of 5,000 records, then resets. Actual steps include the reset; per-step timings use that count. Compare only matching workload ids and CPU throttles.
Frontend: react-dom/profiling (bench/app/vite.config.ts). React render, commit and slowest-commit columns include profiling overhead that a normal production build does not have. Minifier: off (the app's own configuration).
Graphics: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver-5.0.0); compositing disabled_software, rasterization disabled_software; headless.
**Diagnostic frame timings only: hardware compositing and rasterization are not verified.**
Label base-profiling-app; app root /Users/joshuapare/Repos/omniviewdev/worktrees/ui-next-baseline.
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
| cold-start | 899 (892–905) | 360 | 336 | 11.0 | 247 | 1 | 20.2 | 9 | 15.8 | 29.1 |

**cold-start-k8s**

| step | interactive | plugin home shown | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| cold-start-k8s | 880 (875–886) | 964 | 399 | 346 | 12.2 | 245 | 1 | 24.5 | 17 | 15.5 | 28.1 |

**pods**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 206 (200–214) |  |  |  |  | 195 | 117 | 18.4 | 25 | 1 | 87.7 | 22 | 58.1 | 74.6 |
| scroll | 1583 (1581–1600) | 31 | 30 | 51.1 | 26.5 | 823 | 375 | 250 | 0 | 0 | 143 | 31 | 8.5 | 128 |

**logs**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 60.1 (56.5–63.8) |  |  |  |  | 34.3 | 19.4 | 3.1 | 0 | 0 | 8.7 | 15 | 4.7 | 48.3 |
| stream | 638 (616–650) |  |  |  |  | 294 | 117 | 41.2 | 0 | 0 | 59.7 | 80 | 1.4 | 64.2 |
| scroll | 1032 (1032–1033) | 31 | 30 | 33.3 | 6.6 | 205 | 84.9 | 18.0 | 0 | 0 | 39.5 | 59 | 1.5 | 66.2 |
| drawer | 331 (330–331) | 10 |  | 33.0 | 14.4 | 144 | 71.9 | 26.7 | 0 | 0 | 27.3 | 31 | 5.5 | 69.4 |

- cold-start: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
- cold-start-k8s: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
