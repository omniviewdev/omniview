# Development instance identity and browser persistence

## Boot contract

The host injects `window.__OMNIVIEW_INSTANCE__` before the first script in both embedded and proxied HTML. Its safe identity is `{ schemaVersion: 1, instanceID, displayName, generation, kind: 'development' | 'production' }`. Optimization/Vite mode does not select the instance kind. Generation is a required string and must be nonblank for development instances; production may use an empty generation.

The first classic script in `index.html` validates the payload, captures an immutable identity, and installs `window.__OMNIVIEW_BOOTSTRAP__ = { identity, storageKey }`. That resolver is the single namespace implementation used by first-paint theme reads and React persistence. Instance IDs must be nonempty ASCII letters/digits followed by letters/digits/dot/underscore/hyphen, at most 128 characters; labels must be nonblank. Missing/malformed identity is **unavailable**, not production.

`ui/features/instance/boot.ts` exports:

- `BootIdentity`: the readonly boot identity type.
- `getBootIdentity(): BootIdentity | null`.
- `profileStorageKey(key: string): string | null`.
- `readProfileStorage(key: string, storage?: Storage): string | null`.
- `writeProfileStorage(key: string, value: string, storage?: Storage): void`.
- `removeProfileStorage(key: string, storage?: Storage): void`.

All cache operations are best effort. An unavailable profile returns no key, reads nothing, and writes/removes nothing. A plain browser/Vite preview therefore paints the safe Void theme, labels itself unavailable, and does not make an invented backend identity request.

## Host confirmation and presentation

`InstanceProvider` and `useInstance()` in `ui/features/instance/InstanceContext.tsx` expose `{ identity, info, status, refreshInfo }`; the hook requires `InstanceProvider`. Status is `unavailable | boot | refreshing | confirmed | error | mismatch`. `refreshInfo(): Promise<void>` performs one authoritative `GetInstanceInfo()` call through the generated AppService binding. A valid boot identity is immediately usable. The provider fetches at mount and the details control refreshes whenever it opens, so endpoints published after initial startup are not permanently reported as stopped. There is no polling or automatic retry. Pending refresh clears the previous descriptor and shows refreshing rather than presenting a stale snapshot as confirmed. A failed refresh clears details and shows error; a mismatch clears details and shows mismatch. The descriptor must match boot schema version, instance ID, kind, and generation. Neither failure changes the storage namespace. Newer refreshes/unmount invalidate older completions. A matching descriptor provides the authoritative display name and safe details. No identity means no host request. No fake HTTP endpoint or build-mode identity fallback is used.

The main header's `DEV · displayName` control is outside all three hideable header regions. It is keyboard accessible, does not initiate native window dragging/maximizing, and opens the existing base-ui Dialog. Long labels truncate visually but retain their complete accessible label/title. Details show only allowlisted identity/state/repository/version/readiness fields and the six known actual endpoints; endpoint userinfo, query strings, and fragments are omitted. They never dump discovery JSON, arbitrary errors, token values, or token-file references. The generic permanent development footer badge is removed; plugin server status remains conditional.

The pre-React and React document titles are `Omniview — DEV · displayName`, `Omniview`, or `Omniview — Instance unavailable`. The host supplies the matching native title. Development branding remains present in optimized frontend builds; production has no instance chip.

## Storage policy

Development keys are `omniview:instance:v1:<encoded-instanceID>:<existing-key>`. Explicit production retains existing unscoped keys for compatibility. Development and unavailable instances never read or clean up production's legacy `ov-theme-variant`/`ov-theme-mode` hints, even when no profile-specific theme cache exists.

Covered application caches are the versioned first-paint theme, homepage card order/visibility/configuration, bottom-drawer mode/expanded height, and resource-table column visibility. Canonical settings remain backend-authoritative.

Key namespaces are defense in depth, **not** native datastore isolation. The runtime/native configuration separately assigns per-profile WebKit/datastore/userdata/cache locations, including the UUID WebsiteDataStoreIdentifier strategy for supported macOS native development profiles. Frontend changes alone do not prove cookie/IndexedDB/service-worker isolation or native support; those are runtime acceptance checks.

## Optional React DevTools

There is no unconditional listener at port 8097. A10's Vite transform replaces `<!-- omniview-react-devtools -->` with a synchronous standalone script only in a dev server and only for explicit `VITE_REACT_DEVTOOLS_URL`, validated as an unauthenticated loopback HTTP(S) URL. The script runs before the shared React Refresh hook. With the variable unset there is no network request or readiness dependency. Production builds remove the marker.

## Verification ownership

A09 does not run builds, tests, linters, formatters, or browser smoke checks mid-flight. The integration owner generates bindings with `task bindings`, then runs the frontend barrier and actual browser/native acceptance checks: visible identity with regions hidden, keyboard details, optimized-build title/badge, production/unavailable behavior, and A/B first-paint/restart isolation for theme/cards/drawer/tables. Existing persistence tests use an explicit production boot fixture and the real HTML bootstrap resolver rather than inferring production from absent identity.
