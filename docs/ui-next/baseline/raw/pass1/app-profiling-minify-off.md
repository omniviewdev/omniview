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
| cold-start | 853 (851–886) | 355 | 331 | 11.0 | 242 | 1 | 19.8 | 9 | 15.5 | 29.1 |

**cold-start-k8s**

| step | interactive | plugin home shown | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| cold-start-k8s | 868 (858–962) | 949 | 401 | 344 | 12.4 | 242 | 1 | 24.8 | 17 | 15.9 | 28.6 |

**pods**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 214 (208–224) |  |  |  |  | 203 | 121 | 19.2 | 27 | 2 | 91.2 | 22 | 59.3 | 74.4 |
| scroll | 1583 (1567–1584) | 31 | 30 | 51.1 | 27.6 | 856 | 388 | 253 | 0 | 0 | 145 | 31 | 7.1 | 128 |

**logs**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 59.2 (56.8–67.6) |  |  |  |  | 31.1 | 17.0 | 3.1 | 0 | 0 | 7.7 | 15 | 4.2 | 48.3 |
| stream | 656 (644–778) |  |  |  |  | 324 | 131 | 45.0 | 0 | 0 | 67.2 | 82 | 1.5 | 53.6 |
| scroll | 1033 (1031–1035) | 31 | 30 | 33.3 | 5.8 | 179 | 71.4 | 16.2 | 0 | 0 | 35.6 | 61 | 0.9 | 59.2 |
| drawer | 330 (317–331) | 10 |  | 33.0 | 13.7 | 137 | 66.7 | 27.0 | 0 | 0 | 24.9 | 31 | 3.7 | 61.7 |

- cold-start: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
- cold-start-k8s: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
