---
"@omniviewdev/runtime": minor
---

Add read-only `ProcessInventory.GetSnapshot()` and `InventoryProcess` for verified host and launched-plugin PID/start-identity/executable observations, independently of pprof listener state. The compact profiling popover hides stale identities when reopened, visibility resumes, or lookup fails; technical details remain collapsed and mapping limits use help tooltips.

Verify available macOS native window IDs against the host using public AppKit/CoreGraphics APIs. Keep Wails window IDs distinct from native IDs and renderer processes. WebContent/GPU ownership remains explicitly unverified, without candidate PIDs, inferred sharing, private WebKit APIs or process-control authority. Known in-process plugins share only a verified host identity. Plugin RPC profiling PIDs no longer act as ownership evidence.
