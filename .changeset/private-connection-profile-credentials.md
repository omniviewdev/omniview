---
"@omniviewdev/runtime": minor
---

Add optional, write-only username/token input to `ResourceClient.SaveConnectionProfile` and `useConnection().saveConnectionProfile`. Keep public configuration on the lossless request-JSON transport and private input in a separate Wails argument. Omitted fields preserve credentials only for the same profile incarnation and unchanged client configuration; empty strings clear fields. The host persists immutable permission-protected secret files behind atomic public profile references and never returns credential values.

Align runtime peers with `@omniviewdev/base-ui ~0.10.0`. Deploy the SDK private-overlay transport fix in host and rebuilt plugins before using private profile saves, then publish this runtime before updating plugin registry pins. Published runtime 0.16.0 does not contain this API addition.
