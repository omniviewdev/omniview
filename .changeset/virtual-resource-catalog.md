---
"@omniviewdev/runtime": patch
---

Reuse successful resource catalogs when virtualized cells mount. Resource-type and resource-types hooks share a 30-second freshness policy and do not refresh metadata merely because scrolling mounts another consumer. Explicit query invalidation and normal focus/reconnect refresh remain supported. This prevents row links from repeatedly refetching the cluster page's shared catalog and turning scroll activity into catalog timeout errors.

Whole-app profiles now accept `--cpu-throttle` and record the multiplier. Reports describe the actual 5,000-record source-view collection rather than the snapshot batch size.
