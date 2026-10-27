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

Linux native CI jobs run on fresh GitHub-hosted Ubuntu 24.04 runners inside
`ghcr.io/omniviewdev/omniview-ci:ubuntu24-v1`. The image contains GTK4, WebKit6,
Wayland development headers, build tools, and the pinned Playwright Chromium OS
dependencies. Jobs pull installed filesystem layers rather than downloading,
validating and unpacking APT archives on each run.

`e2e/scripts/browser-dependencies.mjs` verifies the preinstalled native libraries
and the actual pinned Playwright dependency simulation. CI fails if the image
is incomplete; it does not silently install packages or retry. Local Linux runs
retain authenticated APT installation. Chromium binaries remain a separate,
exact-version payload cache, not part of the system image.

The inclusive 1800000ms (30-minute) preparation clock covers Node/Go setup, restored
payloads and canonical preparation. Image pulling happens during job startup
before this clock; compare total job duration, not only preparation duration.
The default subprocess bound remains 180000ms.

Initialize a fresh explicit native-tool cache with `--init-tool-cache` before
restoring payloads. The v2 container adds private `playwright-browsers` alongside
Go and pnpm payloads; old containers are refused, never adopted or repaired.
Only payload children are cached, not `.owner.json`, profiles or managed
receipts. `PLAYWRIGHT_BROWSERS_PATH` is derived from the validated owner, not an
ambient override; runs without an explicit cache use their private preparation
HOME. Chromium keys bind OS/architecture, Ubuntu24 and the committed package pin
and lockfile, with no fallback browser key. Existing default-main scope trust
remains unchanged. CI creates a fresh private parent beneath the container's
canonical `$RUNNER_TEMP`, then initializes v2 ownership before payload restore.
The mount itself keeps its runner ownership. This container-path cutover changes
Actions' path-derived cache version and requires one cold population; ownership
metadata is never restored.

Trusted-main `--cache-only` now prepares browser binaries too, but starts no
application profiles/tests and never reports application acceptance. It skips
preparation only when exact pnpm, Go **and Chromium** main-scope lookups all hit.
Acceptance still requires the one genuine application invocation and its
fail-closed final gate. Keep Linux image readiness, cache reuse and application
case/drain/canonical-cleanup evidence separate.

## Application E2E feedback in GitHub Actions

`PR Validation` calls `.github/workflows/e2e-runner.yml` for the canonical
application suite. The stable `e2e-tests` check accepts only the reusable job's
success, including an explicitly proven prose-only skip. Browser results alone
do not prove canonical preparation, acceptance and cleanup succeeded.

Playwright uses its GitHub reporter in Actions for failure annotations on the
check and source locations, alongside terminal output, HTML and case timings.
Annotations require Playwright to run; checkout, source validation or preparation
errors remain in their own step logs. No PR comments or write permissions are
needed. The always-run **Summarize canonical application feedback** step separates
proven skips, preparation/not-reached failures, canonical failures without a
report, completed operations and cancellation. A report can exist even when the
canonical operation fails afterward. A missing report is not evidence that tests
passed or that application assertions ran.

Actual application runs attempt both uploads on success, failure and cancellation:

| Artifact | Uploaded directory | Contents |
| --- | --- | --- |
| `playwright-report` | `e2e/playwright-report/` | HTML report with `index.html` at the ZIP root and its attachment data |
| `playwright-test-results` | `e2e/test-results/` | Raw retained test evidence, including failure screenshots, videos and redacted browser errors when produced |

Both artifacts retain the existing seven-day lifetime. The job summary links
directly to each uploaded artifact; absent files produce no artifact. HTML uploads
require `index.html`; selection or invocation metadata alone does not publish an
HTML artifact. Cache-only main runs produce neither application feedback summaries
nor these uploads.
Only these browser-output directories are uploaded, never private profiles,
ownership receipts or general temporary logs. **Traces remain disabled**:
authenticated Vite HMR URLs can contain tokens. Screenshots, videos and reports
can still contain visible application data; keep tests on their isolated fixtures
and treat downloaded evidence as sensitive.

GitHub artifacts are ZIP downloads, not hosted HTML. Download `playwright-report`
from the summary or run's Artifacts section and extract the entire ZIP, including
`data/`, into `./playwright-report` at the checkout root. With the pinned E2E
dependencies already installed, serve it from the checkout root:

```sh
pnpm --dir e2e exec playwright show-report ../playwright-report
```

Open a failed test in the report to inspect its attachments. Download the raw
evidence artifact separately when individual files are needed. Do not open only
`index.html` through `file://`, move attachment data away, or expect the artifact
link to serve an interactive website.

For a locally generated report, use `pnpm --dir e2e report`. To run the canonical
suite locally, explicitly select the companion sources and independently reviewed
SDK commit, then invoke the runner rather than bypassing preparation:

```sh
SDK_SOURCE=/absolute/path/to/plugin-sdk \
UI_SOURCE=/absolute/path/to/ui \
KUBERNETES_SOURCE=/absolute/path/to/omniview-plugin-kubernetes \
REVIEWED_SDK_REVISION='<independently-reviewed-full-sdk-commit>' \
node e2e/scripts/run.mjs --full
```

Local prerequisites and source ownership rules still apply. To run conservative
selection instead, use `--changed --base <base-commit>` in place of `--full`.
No HTML report is expected for a proven skip or failure before Playwright.
Cancellation, an inclusive runner deadline, reporter failure or hard watchdog
termination can leave partial evidence or no finalized report. A hard runner
termination can also prevent the always-run uploads and summary entirely; inspect
the check status and logs when feedback is unavailable. Expired/deleted artifacts
cannot be recovered through their former links.

This feedback applies only to the canonical application runner. `PR Checks`
separately runs Go checks, bindings checks and UI build/lint/type checks and its
C02 transport check. `PR Validation` also builds platform artifacts.
`render-bench.yml` runs render benchmarks and `app-profile.yml` runs whole-app
profiling with their own result uploads; they are not this application test
report. Those runners and their reporting conventions are unchanged.

See Playwright's official [reporter documentation](https://playwright.dev/docs/test-reporters)
for multiple reporters and GitHub annotations, and its [CI guide](https://playwright.dev/docs/ci-intro)
for downloading and serving reports and handling sensitive evidence.

## CI image maintenance and runner choice

`.github/ci/Dockerfile` owns the system package recipe. `ci-image.yml` rebuilds
it weekly, on recipe changes to main, and on manual dispatch. Only trusted
publication jobs can write GHCR; pull requests only build and smoke the image.
Consumer jobs authenticate with their read-only `GITHUB_TOKEN`; no stored
registry secret is required. The package must inherit Actions access from this
repository, including read access for PR jobs. The initial image must be
published before consumer jobs can start. Public visibility is optional and
allows anonymous local pulls; GHCR packages are private on first publication.

Container jobs use shell `$GITHUB_WORKSPACE` and `$RUNNER_TEMP`, not the host
paths from expression contexts. Before root-level checkouts, native jobs align
the fresh checkout mount's owner with the container user. This retains Git's
ownership checks and normal VCS stamping without wildcard `safe.directory`
exceptions or recursive ownership changes.
Docker's `--init` reaps orphaned compiler/browser children. Without it, the
runner's keepalive process becomes PID 1 and zombie processes can keep owned
process groups present after teardown. Do not weaken group-exit assertions.

The versioned `ubuntu24-v1` tag accepts weekly security refreshes. Job setup logs
record the resolved digest; retain that digest when comparing timings or
diagnosing image regressions. Change the major image tag for incompatible
toolchain changes. Update the image's Playwright pin with `e2e/package.json`;
the publisher checks the versions agree. A failed rebuild leaves the previous
published image available. Do not cache APT databases or installed system paths.
The image includes `zstd` so Actions caches use their normal fast compressor
instead of a gzip fallback. Changing compression also changes the cache version,
so the first image-backed run may need a cold population.

Standard hosted containers preserve a clean VM boundary without owning runner
patching, registration, autoscaling, cleanup or idle capacity. Image pulls and
Go/pnpm linking still cost time; no speedup number is assumed without job data.
If container pulls become the bottleneck, GitHub's
[larger-runner custom images](https://docs.github.com/en/actions/how-tos/manage-runners/larger-runners/use-custom-images)
can preinstall the same recipe in a VM. They require organization setup and
paid runner/storage capacity.

Self-hosting is an alternative only with disposable, one-job runners created
from a patched immutable image. Never run public PRs on a persistent runner
with secrets or access to internal services. GitHub documents the
[self-hosted runner security risks](https://docs.github.com/en/actions/reference/security/secure-use).
Use separate trusted image builders and untrusted PR runner pools, deny access
to cloud metadata and internal networks, and destroy each VM after its job.
That operational cost is not justified by the supplied package-install failure
alone.


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

