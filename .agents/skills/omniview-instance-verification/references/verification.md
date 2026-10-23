# Verification surfaces and evidence

Authority: host `cmd/omniview-dev/control_commands.go`, `internal/devworkspace/status.go`, `internal/devcontrol/`, `e2e/tests/fixtures/{workspace,app.fixture}.ts`; native helper `e2e/scripts/native-probe.mjs`. Read current harness operational docs for final prerequisites. Source availability does not establish a passing run.

## Identity before actions

Run selected `workspace inspect` and authenticated `instance inspect`; compare UUID, instance ID, state root, generation, complete owned process start/executable/source identity, endpoints and readiness. The CLI reads private discovery/token references and authenticates a control roundtrip; do not print/copy tokens, pass them in CLI flags, or infer ownership from `/health`, a port or PID. A generation change requires explicit reselection before mutation. The plugin generation from `plugin dev status` is separate from the host generation.

For passive page/native identity, read immutable `window.__OMNIVIEW_INSTANCE__` (`schemaVersion`, `instanceID`, `displayName`, `kind`, `generation`). Compare its UUID/instance ID and **generation** with the authenticated descriptor, not a storage-key prefix or an old bootstrap snapshot. Generation is freshness evidence; it does not rekey persistent browser storage. Do not import `/wails/runtime.js` merely to observe readiness/events: an extra runtime/custom.js connection can overwrite the global dispatcher and disturb the target. Use the existing passive forwarding wrapper and actual HTTP event emission in the A17 harness; report HTTP 101, wire delivery and dispatcher payload separately, only when exercised.

Wrong UUID, old generation, unauthenticated/unreachable control, stopped/failed build, missing endpoint or occupied strict port is a refusal—not a ready app. Do not reset settings or close terminals there. Repair/restart through owned lifecycle, then obtain fresh descriptors; never substitute a convenient healthy listener or overwrite discovery.

## Choose the claim and its proof

| Surface | Appropriate evidence | Does not prove |
| --- | --- | --- |
| Actual `instance.endpoints.browser` server | Fresh browser context, visible workspace identity, real binding/backend settings set/get roundtrip with persistence/restart where claimed, screenshots plus console/network artifacts | Native window/chrome/dialogs, OS storage integration, every plugin or remote service |
| `instance.endpoints.vite` bare frontend | Asset/component/HMR behavior and frontend rendering, clearly labeled mocks if present | Backend bindings, plugin execution, server/native integration |
| Authenticated native MCP, exact target window/generation | Real WebView `js_eval`, targeted DOM/input/bound-method/event checks **only if actually exercised** | Pixel appearance, OS chrome, native dialogs or native storage merely because DOM calls work |
| Native actual window pixel capture | Captured intended OS window with identity/time/platform and reviewed pixels | Storage persistence or backend integration by itself |
| Native persistence/isolation | Real A/B/restart cookies/localStorage/CacheStorage and profile filesystem checks; scoped cleanup observed separately | Cross-platform behavior from one OS or server/browser context |

The current native probe is read-only JS/identity evidence, not an automatic input/event/binding/storage test. `screenshot_dom` is DOM data, not rendered pixel capture. Pair native window/chrome claims with an actual OS pixel capture, or explicitly leave them unverified. Named native macOS isolation requires macOS 14+ and suitable SDK. Linux GTK variants and Windows require their own runners; do not extrapolate a Darwin build result. A native compile is not a successful launch or storage probe.

## Disposable first; observational attachment stays read-only

Use harness-owned temporary collection/profiles and source registry, real built CLI, reviewed full SDK revision, actual successful link-probe evidence and explicit committed source refs. Each selected plugin must be real and selected by metadata, not an invented second plugin. A fresh browser context must not inherit a human browser's cookies/preferences.

Managed feature refs must declare compatible native **pnpm12.14.0** pins and use one aggregate workspace at the feature root. Accept only real `workspace`/`12.14.0` protocol evidence. Confirm the completed schema2 composition receipt, unchanged source/configuration hashes and explicit recursive peer audit before interpreting host/plugin readiness; a warm install can exit0 without rechecking peers. Do not hand-edit aggregate files or launch a second per-plugin installer.

For owned disposable browser checks, the source-defined harness entry is:

```sh
OMNIVIEW_E2E_CLI=/absolute/built/omniview-dev \
OMNIVIEW_E2E_SOURCES=/absolute/disposable-sources.json \
pnpm --dir e2e test tests/workspaces
```

The sources file contains `sources` (ID → absolute source path), `refs` (each ID → committed ref), `repositories`, optional `plugins`, `reviewedSDKRevision` and absolute `linkEvidence`. Match the current fixture schema; neither this command nor the installer was executed by skill authoring. Never replace the actual CLI with a fake observer/server.

When the test process PATH still exposes another manager, set optional `OMNIVIEW_E2E_PNPM_EXECUTABLE` to the canonical native12.14.0 executable. The harness validates and forwards this explicit input to owned workspaces; it is not a Corepack/global downgrade or permission to inherit an unrelated feature's workspace-dir context.

Observation requires explicit `OMNIVIEW_E2E_MODE=observe`, CLI, `OMNIVIEW_E2E_ROOT`, `OMNIVIEW_E2E_WORKSPACE`, `OMNIVIEW_E2E_WORKSPACE_ID`, and `OMNIVIEW_E2E_GENERATION`. It is not permission for restoreSettings/closeTerminals/lifecycle mutation. Mutating settings isolation checks need a harness-owned disposable target; inspect a real schema/key, preserve typed JSON, use `settings set ... --wait`, verify `settings get`, check sibling B unchanged and restore only owned test state. Never reset a human feature just for visual convenience.

Source-defined read-only native probe:

```sh
node e2e/scripts/native-probe.mjs --cli /absolute/built/omniview-dev \
  --root "$COLLECTION" --workspace "$FEATURE" \
  --workspace-id "$UUID" --generation "$GENERATION" \
  --window main --output /absolute/native-evidence.json
```

Use an actually advertised MCP endpoint and its separate private MCP token reference, never the control token. No token/header/private discovery in shared traces, screenshots, HARs or reports. Review arbitrary plugin/build logs before sharing; `--unsafe-output` is deliberate secret-bearing output, not routine evidence collection.

Do not import kubeconfigs, credentials, production connections, or auto-connect real clusters. Remote side effects require a separately authorized disposable context/account. Clean up only owned generations and profile resources through supported lifecycle; preserve refused dirty state. Report artifacts only when they actually exist—no fabricated screenshots, pass counts, timings or benchmark outcomes.
