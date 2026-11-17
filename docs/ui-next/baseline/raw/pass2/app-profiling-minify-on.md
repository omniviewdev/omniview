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
| cold-start | 723 (715–737) | 325 | 303 | 10.9 | 217 | 1 | 18.4 | 9 | 14.2 | 26.9 |

**cold-start-k8s**

| step | interactive | plugin home shown | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| cold-start-k8s | 727 (713–738) | 810 | 369 | 317 | 12.3 | 220 | 1 | 23.2 | 17 | 14.4 | 25.9 |

**pods**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 206 (202–212) |  |  |  |  | 193 | 114 | 18.8 | 24 | 1 | 85.8 | 22 | 57.2 | 74.7 |
| scroll | 1585 (1569–1585) | 31 | 30 | 51.1 | 26.5 | 820 | 375 | 248 | 0 | 0 | 141 | 31 | 7.3 | 127 |

**logs**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | React render | commits | slowest commit | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 60.4 (58–62.3) |  |  |  |  | 34.5 | 19.0 | 3.2 | 0 | 0 | 8.6 | 15 | 5.1 | 44.5 |
| stream | 619 (616–652) |  |  |  |  | 288 | 114 | 40.0 | 0 | 0 | 58.6 | 78 | 1.5 | 61.2 |
| scroll | 1034 (1031–1035) | 31 | 30 | 33.3 | 6.4 | 199 | 82.0 | 17.3 | 0 | 0 | 39.6 | 61 | 1 | 67.3 |
| drawer | 330 (329–333) | 10 |  | 33.0 | 13.9 | 139 | 68.9 | 27.5 | 0 | 0 | 25.6 | 31 | 5.1 | 65.9 |

- cold-start: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
- cold-start-k8s: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
