# P15 passive observer slice

Status: candidate for independent review; not P15 acceptance. Issue: https://github.com/omniviewdev/omniview/issues/89. Ticket: omn-cnbz.

The initial branch push and draft PR creation preceded independent review and may have triggered automatic CI. This deviated from the review-before-expensive-CI order; that gate has not passed. No manual CI rerun was requested.

C08 frozen semantic head: `5befe51c8f45611581af957a19d38d7971d34310`. P13 QuerySpec semantic head: `e84d5be395cb932c96f9b2ef6a3add83d7e170b0`. P15 owns the sole TypeScript QuerySpec projection and the hand-maintained C08 result frame union. Existing P45 domain types supply values and resource identity. C08 uses Wails JSON, not protobuf, for result frames.

The observer consumes a lease ID, its attached generation, and individual C08 frames. It returns a recovery action for invalid data or sequence gaps and a reopen action on a lost drain response. Close and binding changes erase the retained window. Host-issued ordering, row keys and projections remain authoritative. No Wails methods or consumer migrations are introduced here. The integrator must subscribe before attaching, serialize drains, send recovery controls, close reservations on failures, and reopen after a lost response.

Executed in the isolated `ri-p15` workspace, using an existing dependency tree:

- `../../node_modules/.bin/tsc -p tsconfig.app.json --noEmit`: passed.
- `../../node_modules/.bin/vitest run src/resource/v2/query-observer.test.ts --configLoader runner`: 9 tests passed.
- From the workspace repository root, `./node_modules/.bin/esbuild /tmp/ri-p15-observer-smoke.mts --bundle --platform=node --format=esm --outfile=/tmp/ri-p15-observer-smoke.mjs && node /tmp/ri-p15-observer-smoke.mjs && rm /tmp/ri-p15-observer-smoke.mts /tmp/ri-p15-observer-smoke.mjs`: output `observer smoke passed`. The temporary script exercised open, exact count, gap recovery, replacement, completion and reopen. Both temporary files were removed. Direct Node type stripping could not run the TypeScript parameter property; esbuild performed the TypeScript transform.

The tests cover frozen inputs, ordered changes and previous snapshot immutability, signed and unsigned integer boundaries, gaps, atomic failure, repeated and overlapping resets, stale frames, source and binding barriers, malformed wire variants, complete and terminal error, reconnect and bounded frame/window rejection. They do not prove integration with actual P14 methods or cross-language golden fixtures.

Remaining gates: independent review, required CI on the reviewed final head, real P14 transport and cross-language fixtures, consumer migration, native UI and live source integration, access isolation, performance/scaling and cleanup evidence. Only the user merges. No P15 completion is claimed.
