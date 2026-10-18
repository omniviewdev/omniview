# Isolated native WebView toolchain

Named development profiles need explicit native datastore support beyond published Wails beta.29. The host carries a narrow reviewed patch with pinned module/archive/go.mod and per-file checksums in `scripts/nativepatch/patches`. It never modifies the global module cache or assumes an unpublished release exists.

Use bootstrap-aware Task entry points. For direct host Go commands, prepare the effective module explicitly:

```sh
GO_MODFILE="$(GOWORK=off GOFLAGS= go run ./scripts/nativepatch/main.go --root "$PWD")"
GOWORK=off GOFLAGS= go build -modfile="$GO_MODFILE" .
GOWORK=off GOFLAGS= go test -modfile="$GO_MODFILE" ./... -count=1
```

If an effective host modfile already contains selected SDK replacements, pass `--host-modfile "$GO_MODFILE"` to bootstrap. Actual worktree-local replacements in `go.mod` are preserved by default. Do not export host `GOFLAGS` to plugin builds: each plugin uses its own module and `GOWORK=off`.

The generated modfile/source live under ignored `.local/toolsrc`. Repeated preparation verifies source integrity. Existing tampered/incomplete output is rejected, not silently adopted or overwritten. Source/archive checksums prove patch identity, not native runtime behavior. Regenerate patches only using the documented maintainer exporter after review.

Bindings remain `task bindings`; that task scopes the effective host module to Wails discovery and compilation. Never run raw binding generation or build Vite-plugin shims before the runtime package.

Named native development on macOS requires macOS14+ UUID datastores. Production support is unchanged; older systems may use isolated browser/server mode. Windows uses an explicit WebView2 data folder. Linux explicit GTK4/GTK3 data/cache/session support is patched, but platform compilation and persistence require their runner evidence. Browser screenshots do not establish native storage or chrome correctness.

Bare `GOWORK=off go build .` does not consume an automatically generated modfile and therefore is not the supported command for this patched native toolchain. Use the explicit module command above or the bootstrap-aware Task. This is a deliberate build prerequisite, not an implicit machine-local replacement.

## Managed plugin Unix transport

General plugin `TMPDIR`/`TMP`/`TEMP` remain UUID-profile-private. Managed go-plugin RPC uses a separate short `PLUGIN_UNIX_SOCKET_DIR`, because Unix socket pathname limits can be exceeded by a valid long HOME plus UUID runtime path. The supervisor selects canonical OS temporary storage when it fits, otherwise a short canonical `/tmp` namespace; it exclusively creates the `0700` directory rather than adopting a developer-supplied path.

A private generation record and matching marker bind the namespace to the workspace UUID, generation, captured supervisor identity, UID and directory identity. Cleanup waits for managed and host process groups to be disposed; unresolved, malformed or foreign ownership proof blocks destructive profile removal. Missing-root cleanup must finish external-parent synchronization before retiring the durable reference. Production/direct hosts do not gain a dependency on a managed-supervisor record.

The plugin launcher passes the complete sanitized child environment with go-plugin's `SkipHostEnv: true`. This is required: go-plugin otherwise appends the raw host environment after `cmd.Env`, allowing inherited socket-directory/group or process-bridge values to override validated selections. Ordinary environment entries and UUID-private general temporary-directory settings remain available; go-plugin still injects its handshake/protocol variables. Do not shorten HOME or substitute a shared general temporary directory to fix RPC socket length.

Darwin and non-root Linux component checks exercise real Unix socket nonce exchanges with long HOME paths, independent profiles, foreign-replacement refusal and durable cleanup retry. Linux also exercises the actual exclusive-rename kernel boundary; Windows cross-compilation is not runtime proof. Managed native plugin RPC readiness is a separate integration claim; the direct native boundary below does not establish it.

## Exercised native boundary

On macOS27 arm64, an actual stable build without `devcontrol` and two named development builds ran concurrently in separate signed app bundles and state roots. The duplicate stable channel exited0 before settings-database/plugin startup; a duplicate named root exited1 without changing its settings or plugin inventory. CoreGraphics observed three onscreen native windows; this is not pixel capture.

Authenticated native MCP reached both actual `wails://localhost/` shells and `AppService.GetInstanceInfo`, matching boot UUIDs/generations. A localStorage key stayed independent across profiles, persisted after restart with the original UUID, and reset after exact-UUID public native removal using the retained original complete bundle. Removing Alpha preserved live Beta's store. Every owned host and native store was cleaned up.

This proof directly exercised the native host/bundle lifecycle, not managed multi-plugin supervisor orchestration. Screen-capture permission was unavailable (`CGPreflightScreenCaptureAccess` false), so DOM observations are not native pixel evidence. No cookie-persistence claim is made for the custom scheme. Windows/Linux native behavior still requires its own runner evidence.

## Reviewed portable patch export

The beta.29 patch also exposes `ServerOptions.Middleware` (`json:"-"`) and wraps the complete server mux exactly once, after registering health, event WebSocket, stream WebSocket, runtime and asset routes. Its default is nil, preserving existing behavior; native `wails://localhost` requests do not use this server hook. Application development policy can reject hostile browser origins and DNS-rebinding hosts here, but this is not authentication: plain local nonbrowser clients can still make requests.

The current source patch SHA256 is `d59bbd19b0a2ab342fdb5edfbdb7f9a1a3a19af486769c44fa46ec34b87c910c`, replacing `05e777acee99f7e9aad4c571171dded9f472e875c916839d1cacf6abd29b46de`. The named datastore deletion/storage fixes remain in the same export. The manifest retains exact `v3.0.0-beta.29` module and go.mod sums, license provenance, and every preimage/postimage checksum.

Maintainers regenerate from the reviewed Wails worktree and a fresh extraction of the checksum-pinned beta.29 module archive, never from a prepared `.local/toolsrc` tree:

```sh
python3 scripts/nativepatch/export_patch.py \
  --reviewed-source /absolute/path/to/owned/wails/v3 \
  --beta29-source /absolute/path/to/pristine/github.com/wailsapp/wails/v3@v3.0.0-beta.29
```

The exporter includes ten existing source files and twelve new source/test files (22 total), including `application_server.go` and `application_server_middleware_test.go`. It rejects reviewed tracked hunks without unique beta.29 preimages; bootstrap independently checks manifest preimages and postimages when preparing a fresh hash-addressed source directory.
