---
"@omniviewdev/runtime": minor
---

`@omniviewdev/runtime/ui/v1` exports `useConnectionMetadata` and the types its signature mentions (`ConnectionMetadataState`, `UseConnectionMetadataOptions`, `ConnectionMetadataSnapshot`, `ConnectionMetadataEntry`, `ConnectionMetadataError`, `ConnectionMetadataValue`). A new-UI plugin can now read the facts its backend publishes about a connection (the server's version and address, the API groups that did not answer) and say, per fact, whether it is current, stale or unavailable. It never connects or acquires an observation. An older host's entry lacks the name, so a plugin that needs it says which host version has it (the contract's rule for an addition).

The curated entry's call takes one options object, as `useConnectionReadiness`, `useResources` and `useResolvedResourceTarget` do: `useConnectionMetadata({ pluginID?, connectionID, enabled? })`. `connectionID` may be `undefined` and `enabled: false` is off: both read nothing and subscribe to nothing; `enabled` defaults to true. It is a thin wrapper over the main entry's `useConnectionMetadata(pluginID, connectionID)`, so both shapes share one cache and one event subscription. Additive to the curated entry only: nothing in the main entry changes, and the main entry's positional call that plugins already ship stays as it is.
