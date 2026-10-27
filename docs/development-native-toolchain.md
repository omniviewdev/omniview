# Isolated native WebView toolchain

Omniview uses unmodified Go/native Wails `v3.0.0-beta.34.0.20261022002616-a90f7e7f50bf`. Native isolation uses application identity and stock platform options; cleanup and workspace policy belong to Omniview. The genuine npm `@wailsio/runtime` remains exactly `3.0.0-beta.34`, with the explicit checked-in dependency patch described below; no framework fork or patched Go-source build path is used.

Use Task entry points, or prepare an effective host module when selecting a local SDK:

```sh
GO_MODFILE="$(GOWORK=off GOFLAGS= go run ./scripts/hostmod/main.go \
  --root "$PWD" --sdk-source "$SDK_SOURCE")"
GOWORK=off GOFLAGS= go build -modfile="$GO_MODFILE" .
GOWORK=off GOFLAGS= go test -modfile="$GO_MODFILE" ./... -count=1
```

`SDK_SOURCE` must name the explicitly selected companion SDK checkout. Existing local SDK replacements are preserved; conflicting selections refuse. Pass `--host-modfile "$GO_MODFILE"` when an existing effective graph is the input. Never export host `GOFLAGS` to plugin builds: each plugin uses its own module and `GOWORK=off`.

Standalone effective mod/sum files live under ignored `.local/hostmod`; managed workspaces use their ledger-owned `toolsrc/hostmod` capability. Preparation does not copy framework sources. It refuses Wails replacements, unsafe output paths, and foreign output ownership. CLI caches separately hash immutable module templates and executables before reuse. `task host:prepare SDK_SOURCE="$SDK_SOURCE"` prints the effective modfile.

Bindings remain `task bindings SDK_SOURCE="$SDK_SOURCE"`. Tasks select the Wails CLI from the root Go pin rather than trusting an ambient `wails3`. Never run raw binding generation or build Vite-plugin shims before the runtime package.

## Canonical Linux E2E prerequisites and payloads

The Ubuntu24.04 reusable runner has one Linux provisioning owner:
`e2e/scripts/browser-dependencies.mjs`, called inside the canonical invocation.
It verifies restored `.deb` archives against freshly authenticated APT indexes,
combines the existing GTK4/WebKit6/Wayland/build recipe with the **actual pinned
Playwright** missing-package simulation, and installs that union in one APT
transaction. This preserves Chromium's libraries, X packages and fonts without
copying an upstream package/version list. A second simulation must prove all
browser dependencies installed; an unsupported-platform warning, unexpected
output/status or package-manager error fails closed. The subsequent Chromium
installation downloads/reuses browser binaries only, never another APT pass.
Root Linux invokes `apt-get` directly; other UIDs use `sudo` for both index
refresh and installation, so a root runner does not require `sudo`.

The workflow starts the inclusive preparation clock before Node/Go setup and
index refresh. Restore/setup time and canonical dependency/browser phases count
toward600000ms; the default subprocess bound remains180000ms. A cold archive miss
can still fail either bound: caching is not a promise that external downloads
complete in time, and failures are not retried.

Initialize a fresh explicit native-tool cache with `--init-tool-cache` before
restoring payloads. The v2 container adds private `playwright-browsers` alongside
Go and pnpm payloads; old containers are refused, never adopted or repaired.
Only payload children are cached, not `.owner.json`, profiles or managed
receipts. `PLAYWRIGHT_BROWSERS_PATH` is derived from the validated owner, not an
ambient override; runs without an explicit cache use their private preparation
HOME. Chromium keys bind OS/architecture, Ubuntu24 and the committed package pin
and lockfile, with no fallback browser key. Existing default-main scope trust
remains unchanged. CI preserves the established Go/pnpm payload paths while
creating fresh v2 ownership; ownership metadata is never restored.

Trusted-main `--cache-only` now prepares browser binaries too, but starts no
application profiles/tests and never reports application acceptance. It skips
preparation only when exact pnpm, Go **and Chromium** main-scope lookups all hit.
Acceptance still requires the one genuine application invocation and its
fail-closed final gate. Darwin boundary/smoke checks do not establish Linux APT
behavior: retain actual Ubuntu cold-populate, warm-skip and subsequent-PR restore
evidence separately from application case/drain/canonical-cleanup receipts.

## Native CI prerequisite archives

`PR Checks / Go checks`, `PR Checks / Bindings freshness` and the Linux
`PR Validation / build-artifacts` entry use Ubuntu24.04, matching the existing
E2E archive producer and `/tmp/omniview-e2e-apt/*.deb` physical payload path.
The PR Linux baseline is explicit; macOS/Windows and release workflows are unchanged.
A fresh authenticated index update
precedes lookup. The exact key includes OS/architecture, the producer's existing
recipe inputs and current signed-index digest; its sole fallback keeps the same
OS/architecture/recipe prefix across index-only rotations. Existing Actions cache
scope visibility is unchanged; these consumers publish no APT archives.

Each job's opt-in `verify-apt-archives.mjs DIRECTORY --prepare` runs before
creating APT's partial directory. It requires a canonical, current-UID-owned,
non-public-writable, archive-only candidate and examines the **entire** bundle.
Every indexed payload must still match authenticated package/version/architecture,
size and SHA256. Only an absent version of a known package/architecture can retain
the whole candidate in a private sibling and create a fresh empty active
directory; none of those candidate bytes or ownership metadata is accepted.
Unknown entries/packages/architectures, symlinks, malformed metadata and indexed
tampering remain fatal. Nothing is deleted or repaired. The strict default
verifier never performs this preparation.

APT then owns a freshly created partial directory and performs the unchanged real
native installation once. Existing E2E archive publication and trusted-main's
three-native-key-hit skip are unchanged: an actual package-version change can
require cold fetching until the next genuine producer, and not every index
rotation triggers main population. A lookup hit alone proves no runtime reuse.
Darwin filesystem/metadata fixtures and workflow lint are not Ubuntu proof;
retain actual matched cache identity/bytes, verification count, APT download and
installation timing, and successful native build/vet/test, bindings freshness or PR
artifact build/upload evidence separately.


## Declared npm Call settlement patch

`pnpm-workspace.yaml` declares `patches/@wailsio__runtime@3.0.0-beta.34.patch` for the exact published npm package. The patch makes its Call response callbacks settle only their own still-registered resolver record. Cancellation removes that ownership while still sending the existing native CancelCall request; a later response cannot reject an already-canceled promise or touch a newly reused call ID. Ordinary errors and successful void results remain unchanged. The generic CancellablePromise late-rejection policy is not weakened.

Native pnpm 12.14.0 generates and verifies the patch hash in `pnpm-lock.yaml`. Managed composition rebases and fingerprints the declared patch through its existing policy/source-hash path; never edit installed packages, caches or generated receipts. The post-install `node --test scripts/wails-call.test.mjs` regression imports the actual resolved package and uses strict isolated processes, not a Call clone or global rejection filter. Keep the patch until a genuinely corrected upstream release is selected and verified.

Managed source fingerprints bind the raw patch bytes; native scalar-lock hashes use CRLF-to-LF-normalized patch bytes. Raw-byte changes still invalidate source ownership even when their normalized native hash is unchanged.

This npm package owns application binding calls in development and production. The Go-embedded `/wails/runtime.js` used by separate MCP/dev surfaces is not modified by this patch and is not claimed fixed. Go/native Wails pinning, replacement refusal, native cancellation and cooperative cleanup remain stock. P04 still requires its integrated Wails cancellation/cleanup acceptance; this declared patch alone does not certify it.

Stock macOS startup uses the immutable `CFBundleIdentifier` and WebKit's default persistent store, not a UUID-store option. The removed UUID-selection requirement no longer imposes macOS14; older operating systems still need their own runtime verification. Windows retains stock `Windows.WebviewUserDataPath`.

Plain Go commands do not automatically select an unpublished companion SDK or consume generated alternate modfiles. Use the explicit module commands above or SDK-aware Tasks while developing against local SDK source. Ordinary published-dependency builds do not require framework preparation.

Implementation ownership: `main.go` composes startup and retains profile-lock ordering; `internal/hostruntime` owns Wails/platform configuration, native-store removal and server asset policy; `internal/devcontrol/host` owns control-service registration, lifecycle and observed endpoints. `internal/instance` remains native-independent so the workspace CLI can share profile policy. The frontend-bound `AppService` stays in `app.go`; control receives private snapshot callbacks rather than an exported mutation API.

macOS PR and release artifacts share `build/darwin/build-universal.sh`: it builds CGO-enabled arm64 and amd64 executables, combines them, and verifies both slices before publishing the output. Bundle metadata is stamped in the staged app before signing: the numeric SemVer core becomes `CFBundleShortVersionString`, and the workflow run number becomes Apple-valid `CFBundleVersion`. Source plists are not rewritten by CI.

## Stock native storage

This unreleased feature has no legacy transition or compatibility path. Every development instance uses the current stock storage model. Display-name edits preserve the workspace UUID and native application identity.

macOS `workspace remove --delete-state` uses the verified complete original same-ID application bundle and an Omniview-owned Apple bridge to clear that application's default store. Cleanup runs on the main queue after `ApplicationStarted`, retains inherited profile/state guard descriptors through completion, and records no success after timeout or refusal. Completion returns off the native main queue so shutdown cannot deadlock it. No guessed WebKit paths or Wails source patches are used.

Browser runtime preparation creates runtime/temp resources without creating native storage roots. Production channel singleton and development root/profile locks are unchanged.

Linux uses `dev.omniview.workspace.w<UUID-without-hyphens>` for both stock application and program identity. Only the native host's **pre-exec** environment selects `XDG_DATA_HOME=<UUID profile>/webview/data` and `XDG_CACHE_HOME=<UUID profile>/webview/cache`. Direct native execution must carry the complete managed startup environment, including valid original-root restore metadata; supplying isolated roots alone would lose plugin/tool credential contexts and is refused. Use `workspace up --mode native`; the app never sets XDG isolation after native initialization. HOME, XDG_CONFIG_HOME, XDG_RUNTIME_DIR and desktop/session variables remain unchanged. Original absent/empty/populated data/cache values are restored for plugin, Go/Node build-tool and terminal children; malformed metadata refuses those launches. Supervisor and source-tool environments remain unchanged.


## Managed plugin Unix transport

General plugin `TMPDIR`/`TMP`/`TEMP` remain UUID-profile-private. Managed go-plugin RPC uses a separate short `PLUGIN_UNIX_SOCKET_DIR`, because Unix socket pathname limits can be exceeded by a valid long HOME plus UUID runtime path. The supervisor selects canonical OS temporary storage when it fits, otherwise a short canonical `/tmp` namespace; it exclusively creates the `0700` directory rather than adopting a developer-supplied path.

A private generation record and matching marker bind the namespace to the workspace UUID, generation, captured supervisor identity, UID and directory identity. Cleanup waits for managed and host process groups to be disposed; unresolved, malformed or foreign ownership proof blocks destructive profile removal. Missing-root cleanup must finish external-parent synchronization before retiring the durable reference. Production/direct hosts do not gain a dependency on a managed-supervisor record.

The plugin launcher passes the complete sanitized child environment with go-plugin's `SkipHostEnv: true`. This is required: go-plugin otherwise appends the raw host environment after `cmd.Env`, allowing inherited socket-directory/group or process-bridge values to override validated selections. Ordinary environment entries and UUID-private general temporary-directory settings remain available; go-plugin still injects its handshake/protocol variables. Do not shorten HOME or substitute a shared general temporary directory to fix RPC socket length.

Darwin and non-root Linux component checks exercise real Unix socket nonce exchanges with long HOME paths, independent profiles, foreign-replacement refusal and durable cleanup retry. Linux also exercises the actual exclusive-rename kernel boundary; Windows cross-compilation is not runtime proof. Managed native plugin RPC readiness is a separate integration claim; the direct native boundary below does not establish it.

## Stock native host verification

On macOS27 arm64, two actual named Omniview workspaces ran concurrently against the pinned stock revision. Authenticated MCP reached both `wails://localhost/` shells and actual `AppService.GetInstanceInfo` bindings, matching workspace UUIDs, generations and display names.

Independent localStorage, IndexedDB and durable settings survived Alpha restart with the same UUID and a new generation. A duplicate native profile launch was refused. Stopped display-name rename preserved profile/storage identity. Public `down`/`remove --delete-state` removed Alpha while live Beta retained its state; both owned workspaces and state roots were retired.

This full-host check selected no plugins and used native MCP JavaScript/binding roundtrips, not native pixel capture or user-input automation. It did not rerun the production singleton channel or establish cookie persistence, older-macOS, Windows or full Linux host behavior. Linux engine-mechanism evidence and browser/plugin integration have separate verification boundaries.

### Linux engine-mechanism verification

Disposable Linux arm64/Xvfb runners exercised real GTK3 and GTK4 WebKit engines: concurrent profiles and two windows per profile, localStorage/IndexedDB restart, stopped Alpha purge with live Beta intact, reset persistence, actual data/cache placement, and unchanged HOME/config/runtime/desktop sentinel paths. The runner used Go 1.26.9 and WebKit 2.54.0.

GTK3 passed with WebKit sandboxing enabled. The container prohibited bubblewrap user namespaces for GTK4; an explicit test-container-only sandbox-disabled run passed both engines. That exception is not an application configuration or a production sandbox claim. These are mechanism checks, not full Linux Omniview, Wayland, GPU, native pixel or Windows runtime proof.

## Stock browser host verification

An actual server-mode Omniview host reached build, Vite, RPC and controller readiness for both Kubernetes and Workspace Probe against the stock pin. Chromium rendered the named development chip/title, host-confirmed instance details with UUID/generation/state/repositories/endpoints, and both plugin status indicators. The Workspace Probe page rendered and its increment button visibly changed the local count to `1`; browser screenshots captured the actual surface.

## Framework boundary

Application names, UUID derivation, bundle/desktop identity, ownership, profile locks, production single-instance behavior, request policy, and purge authorization stay in Omniview. Do not add framework APIs to encode workspace policy.

Stock Wails wraps the server mux with its Host guard and checks runtime/WebSocket origins. Omniview's existing asset middleware adds stricter document/RPC provenance and framing policy, followed by boot identity and plugin/default asset dispatch. Outer health, custom.js and event/stream WebSocket routes do not pass through asset middleware. MCP and control have independent listeners and authentication. Loopback browser provenance is not authentication of arbitrary local clients.

The old `ServerOptions.Middleware`, UUID-store selection, and Linux explicit-session additions are removed rather than maintained as compatibility paths. Linux cookie persistence remains the stock default; isolation does not enable it incidentally.

### Stock-Wails feasibility probe

Before cutover, disposable applications exercised both stock beta.29 and the current pinned revision on macOS27 arm64. Two signed bundles used the same executable basename, Wails application name, and `wails://localhost` origin. Separate localStorage/IndexedDB markers survived independent restarts. Application-owned public default-store cleanup worked both with and without a window; Alpha reset while live Beta retained its marker.

The pinned stock server passed 17 HTTP/WebSocket checks, including bound-method mutation/read, rejected foreign-Origin mutation with unchanged state, hostile-Host rejection, real upgrades, and binary stream echo. Chromium exercised the bound counter and captured its surface. The beta.29 comparison accepted the foreign mutation and hostile Host; removing browser policy while retaining beta.29 is unsafe.

These are mechanism probes, not proof of every full-host lifecycle or platform. Event upgrade alone is not event-delivery evidence. No native pixels, cookie persistence, older-macOS runtime, or Windows runtime claim follows from them. Full migration evidence belongs to the implementation plan's verification record.

### Future upstream work

No Wails-native extension is required for this workspace model. If a new native requirement genuinely exceeds stock capabilities, first demonstrate that gap independently of Omniview policy. Wails requires a [proposal-only WEP draft PR](https://github.com/wailsapp/wails/blob/a90f7e7f50bf3d7db5552fcaf9eeec6fd3d4e626/v3/wep/README.md), at least two weeks of feedback, and recorded acceptance before an implementation PR. Follow its [contribution guidance](https://github.com/wailsapp/wails/blob/a90f7e7f50bf3d7db5552fcaf9eeec6fd3d4e626/CONTRIBUTING.md); do not add native framework patches to implement workspace policy. The declared npm Call bug fix above does not add a native workspace-policy API.

### Native API references

- Apple: [default persistent store](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/default()) and [public website-data management](https://developer.apple.com/documentation/webkit/wkwebsitedatastore).
- GLib: startup-selected [data](https://docs.gtk.org/glib/func.get_user_data_dir.html) and [cache](https://docs.gtk.org/glib/func.get_user_cache_dir.html) roots.
- Wails: [server routing](https://github.com/wailsapp/wails/blob/a90f7e7f50bf3d7db5552fcaf9eeec6fd3d4e626/v3/pkg/application/application_server.go) and [stock options](https://github.com/wailsapp/wails/blob/a90f7e7f50bf3d7db5552fcaf9eeec6fd3d4e626/v3/pkg/application/application_options.go).

