# P15 passive observer slice

Status: candidate for independent review; not P15 acceptance. Issue: https://github.com/omniviewdev/omniview/issues/89. Ticket: omn-cnbz.

C08 frozen semantic head: `5befe51c8f45611581af957a19d38d7971d34310`. P13 QuerySpec semantic head: `e84d5be395cb932c96f9b2ef6a3add83d7e170b0`. P15 owns the sole TypeScript QuerySpec projection and the hand-maintained C08 result frame union. Existing P45 domain types supply values and resource identity. C08 uses Wails JSON, not protobuf, for result frames.

The observer consumes a lease ID, its attached generation, and individual C08 frames. It returns a recovery action for invalid data or sequence gaps and a reopen action on a lost drain response. Close and binding changes erase the retained window. Host-issued ordering, row keys and projections remain authoritative. No Wails methods or consumer migrations are introduced here. The integrator must subscribe before attaching, serialize drains, send recovery controls, close reservations on failures, and reopen after a lost response.

Executed in the isolated `ri-p15` workspace, using an existing dependency tree:

- `../../node_modules/.bin/tsc -p tsconfig.app.json --noEmit`: passed.
- `../../node_modules/.bin/vitest run src/resource/v2/query-observer.test.ts --configLoader runner`: 4 tests passed.
- Bundled and ran a temporary executable using esbuild and Node against the actual observer: passed open, exact count, gap, recovery reset, replacement and close. The temporary files were removed. Direct Node type stripping could not run the TypeScript parameter property; esbuild performed the TypeScript transform.

The tests cover frozen inputs, ordered changes and previous snapshot immutability, exact integer strings, gaps, atomic failure, repeated and overlapping resets, stale frames, access barrier, close, reconnect and bounded frame/window rejection. They do not prove integration with actual P14 methods or cross-language golden fixtures.

Remaining gates: independent review, required CI on the reviewed final head, real P14 transport and cross-language fixtures, consumer migration, native UI and live source integration, access isolation, performance/scaling and cleanup evidence. Only the user merges. No P15 completion is claimed.
