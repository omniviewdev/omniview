---
"@omniviewdev/runtime": patch
---

Share one catalog query between `useResourceTypes` and `useResourceType`, scoped to the connection's readiness generation. When the generation changes because the connection was restarted, reconfigured or lost, the previous target's catalog is never served under the same connection ID, and a catalog response still in flight across the change is rejected.

`useResolvedResourceTarget` is scoped to the same generation, so it never serves an admission from before such a change. When a native source behind the same connection ID was replaced, the host rejects the first resolution with `RESET_REQUIRED` and admits the next one, so the hook invalidates that route's catalog and asks exactly once more instead of surfacing the first rejection. Any other error, and a second `RESET_REQUIRED`, still surfaces as the query error.

The catalog stays fresh for 30 seconds. `useResourceTypes` is for screens: a stale or failed catalog refreshes when one mounts or the window regains focus, even though the app's QueryClient disables focus refetching, and an invalidation that happened while no screen was open is honored when one reopens. `useResourceType` is for cells that mount per virtualized row: it loads a missing catalog once and never refreshes a stale catalog or retries a failed one because it mounted or the window regained focus, so scrolling cannot turn a slow or failing catalog into a request storm. Explicit invalidation and refetch still update every mounted consumer. Consumers that render per row, such as resource link chips, should use `useResourceType` rather than `useResourceTypes`.

Whole-app profiles record their CPU throttle, workload identity, build configuration, served host and plugin bundle hashes, and verified checkout identity. Relative plugin metadata paths resolve from the host root. Reused frontend builds and legacy workloads remain unidentified rather than inheriting the current profiling configuration or 5,000-record workload. Historical receipts disclose missing source/build inputs and preserve original measurement values.
