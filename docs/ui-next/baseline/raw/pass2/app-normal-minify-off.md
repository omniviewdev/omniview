### Whole-app profile (bench/app)

Commit 146c0b03, kubernetes plugin 8989a05, bundle sha256 129d49bdf177, Chromium 156.0.8078.4, Darwin arm64, Apple M5 Max, 128 GB.
Median of 5 runs, CPU throttle 1×, ms unless noted; first column also min–max. Startup times are from navigation start.
Workload whole-app/v1: Pod scroll takes up to 30 viewport steps through a complete source-view collection of 5,000 records, then resets. Actual steps include the reset; per-step timings use that count. Compare only matching workload ids and CPU throttles.
Frontend: react-dom/client (bench/app/vite.config.ts). Minifier: off (the app's own configuration).
Graphics: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver-5.0.0); compositing disabled_software, rasterization disabled_software; headless.
**Diagnostic frame timings only: hardware compositing and rasterization are not verified.**
Label base-normal-app; app root /Users/joshuapare/Repos/omniviewdev/worktrees/ui-next-baseline.
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
| cold-start | 875 (867–913) | 358 | 334 | 11.0 | 249 | 1 | 28.6 |

**cold-start-k8s**

| step | interactive | plugin home shown | main thread busy | script | layout + style | TBT | long tasks | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| cold-start-k8s | 891 (871–895) | 973 | 398 | 343 | 12.9 | 249 | 1 | 27.6 |

**pods**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 184 (181–190) |  |  |  |  | 184 | 103 | 18.9 | 15 | 2 | 73.3 |
| scroll | 1075 (1042–1111) | 31 | 30 | 34.7 | 22.6 | 702 | 218 | 263 | 0 | 0 | 128 |

**logs**

| step | wall | actual steps | forward viewport steps | wall / step | busy / step | main thread busy | script | layout + style | TBT | long tasks | heap MB |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| open | 55 (53.8–64.3) |  |  |  |  | 33.6 | 16.3 | 3.3 | 0 | 0 | 44.9 |
| stream | 586 (573–606) |  |  |  |  | 275 | 89.8 | 39.6 | 0 | 0 | 64.3 |
| scroll | 1033 (1033–1035) | 31 | 30 | 33.3 | 6.7 | 209 | 68.6 | 21.9 | 0 | 0 | 65.3 |
| drawer | 333 (328–347) | 10 |  | 33.3 | 12.7 | 127 | 47.7 | 30.0 | 0 | 0 | 62.1 |

- cold-start: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
- cold-start-k8s: backend calls without a fixture: backend/extensiondiagnostics/host/service.Register, backend/pkg/plugin/logs/servicewrapper.ListSessions, backend/pkg/settings/binding.GetSnapshot, internal/mcprelay/servicewrapper.ListPendingConfirmations, internal/telemetry/telemetrybinding.IngestFrontendSignals, main.UpdateService.Status
