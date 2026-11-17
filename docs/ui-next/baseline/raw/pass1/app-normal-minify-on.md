### Whole-app profile (bench/app)

Commit 146c0b03, kubernetes plugin 8989a05, bundle sha256 129d49bdf177, Chromium 156.0.8078.4, Darwin arm64, Apple M5 Max, 128 GB.
Median of 5 runs, CPU throttle 1×, ms unless noted; first column also min–max. Startup times are from navigation start.
Workload whole-app/v1: Pod scroll takes up to 30 viewport steps through a complete source-view collection of 5,000 records, then resets. Actual steps include the reset; per-step timings use that count. Compare only matching workload ids and CPU throttles.
Frontend: react-dom/client (bench/app/vite.config.ts). Minifier: "esbuild" (forced on).
Graphics: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver-5.0.0); compositing disabled_software, rasterization disabled_software; headless.
**Diagnostic frame timings only: hardware compositing and rasterization are not verified.**
Label base-normal-on; app root /Users/joshuapare/Repos/omniviewdev/worktrees/ui-next-baseline.
Shared UI as resolved by the app root:
- @omniviewdev/base-ui 0.17.3 (declared ~0.17.3; package-store, dist sha256 db8098cb863f)
- @omniviewdev/ai-ui 6.1.14 (declared ~6.1.14; package-store, dist sha256 03e43c466642)
- @omniviewdev/editors 6.2.5 (declared ~6.2.5; package-store, dist sha256 0cc5015b4b79)
- @omniviewdev/providers 0.7.4 (declared workspace:*; host-workspace, dist sha256 22f818ec71cd)
- @omniviewdev/runtime 0.7.4 (declared workspace:*; host-workspace, dist sha256 0cc0f920b8c4)
Harness bytes: tree sha256 59cc12d72b1e (38 files); harness checkout 146c0b03.

**cold-start**

| step | interactive | main thread busy | script | layout + style | TBT | long tasks | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|
| cold-start | 705 (695–723) | 320 | 297 | 10.6 | 215 | 1 | 26.3 |

**cold-start-k8s**

| step | interactive | plugin home shown | main thread busy | script | layout + style | TBT | long tasks | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| cold-start-k8s | 704 (698–752) | 788 | 357 | 304 | 12.5 | 213 | 1 | 25.6 |

**pods**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 179 (178–182) |  |  |  |  | 179 | 99.8 | 18.3 | 15 | 1 | 73.2 |
| scroll | 1089 (1041–1160) | 31 | 30 | 35.1 | 22.6 | 702 | 213 | 259 | 0 | 0 | 126 |

**logs**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 54.9 (50.6–55.1) |  |  |  |  | 29.9 | 14.9 | 3.2 | 0 | 0 | 41.7 |
| stream | 609 (577–642) |  |  |  |  | 280 | 90.5 | 41.0 | 0 | 0 | 58.4 |
| scroll | 1033 (1032–1034) | 31 | 30 | 33.3 | 6.3 | 194 | 62.7 | 21.3 | 0 | 0 | 61.7 |
| drawer | 330 (329–345) | 10 |  | 33.0 | 12.8 | 128 | 48.3 | 30.8 | 0 | 0 | 59.3 |

- cold-start: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
- cold-start-k8s: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
