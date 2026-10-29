# Live Pod Debug: validation evidence

This records the actual implementation, not the [design prototype](../mockups/kubernetes-debug/README.md). The [implementation contract](kubernetes-debug-implementation-contract.md) preceded feature code. [Workflow research](kubernetes-debug-workflows.md) distinguishes live inspection from deferred copied-Pod, standalone diagnostic and Node workflows.

## Workspace and source

The `omniview-dev` workspace is `kubernetes-debug-discovery`, ID `bbcc9266-b45f-45f1-83f6-110d952ad4ae`.

- Browser application: `http://127.0.0.1:22157/`, not the standalone Vite server.
- Host generation: `a00d2ce4-712b-4a9f-9fc4-359ddb081fc2`.
- Managed Kubernetes generation: `3e3d4f09-1c07-4cea-a2f1-609e29f94c96`.
- Kubernetes baseline: fetched `origin/main`, `32968cc8a5d8fe691a08fae7072d2bf43eef3bad`.
- Host baseline: fetched `origin/main`, `c5367016e8b4e7392a2b7e9d24f0accff96f2e84`.
- SDK selection: published v0.7.0 revision `5b3ef764d1cf738835a723a749a0cb6c45f85e44`; no SDK edits.
- Shared UI library: `origin/main`, `e7915a071bbb890512d9a721f9ce6b51d8eb48d4`; no UI-library edits.

`omniview-dev workspace inspect --workspace <workspace> --json` reported an alive, authenticated host, current dependencies and served source, connected HMR, ready host build nodes, and ready Kubernetes build/Vite/RPC/controller states. The browser document identified the same workspace and host generation. Source-reload probe status was unverified; no separate synthetic reload-probe claim is made.

## Owned fixtures

Only local context `kind-kind`, namespace `omniview-debug-bbcc9266`, was mutated. The namespace is labeled with the workspace identity. Application containers use `registry.k8s.io/pause:3.10`, run as UID 1000, have no shell, do not share the Pod process namespace, and do not automatically mount a service-account token.

| Fixture | Original Pod UID | Application containers |
| --- | --- | --- |
| `distroless-single` | `26ce7ca7-bee2-47dd-b65a-c1c1b7d6133b` | `main` |
| `distroless-multi` | `c1c0c24d-27cc-4503-9d59-ef3a3db2e88f` | `main`, `secon` |
| `distroless-header` | `14d81fac-25f2-4448-9251-8b3a6702d754` | `main` |

Original application UIDs were preserved and application restart counts stayed zero. No existing user workload or other kubeconfig context was changed.

## Exercised workflows

1. **Single-container fast path.** One header Debug click created `debugger-omniview-d6601052-59c` against `distroless-header/main`, with no setup dialog. Actual shell output included `OMNIVIEW_HEADER_OK`, UID 1000, and `/pause` as PID 1.
2. **Multi-container header.** Debug showed only `main` and `secon`, with no All Containers option. The final header launch created `debugger-omniview-f31c9d5c-dea` targeting `main`. Keyboard input through the actual terminal produced `OMNIVIEW_FINAL_HEADER_OK`, `DEFAULT=workspace-default`, UID 1000, and the target `/pause` process.
3. **Drawer-independent command palette.** With the Pod drawer closed, Cmd+K → scope to Pods → scope to `distroless-multi` → `Debug: secon` → Enter opened a working toolbox. No header Debug button was mounted. The final launch created `debugger-omniview-6050bf6d-f1d`, targeting `secon`, and produced `OMNIVIEW_FINAL_PALETTE_OK` plus the persisted default marker.
4. **Live namespace inspection.** The palette-created shell saw Pod interface `eth0` at `10.244.0.6/24`, the target `/pause` process, and `/proc/1/root/` containing the application image's `pause` executable. This proves the local fixture's runtime and permissions, not universal filesystem access across clusters or users.
5. **Restricted network toolbox.** The real base-ui template dropdown selected Network toolbox (`nicolaka/netshoot:v0.14`). Without elevated consent or privileges, its shell ran as UID 1000, resolved `kubernetes.default.svc.cluster.local` to `10.96.0.1`, displayed `distroless-header`'s Pod interface `10.244.0.8/24`, and ran `curl --version` successfully. Output included `OMNIVIEW_NETWORK_OK`. Container: `debugger-omniview-6c2358a1-6a8`.
6. **Distroless Exec recovery.** Genuine missing-shell Exec exposed Debug this container. An explicit click preserved target `main`, created `debugger-omniview-a63dcc04-011`, and produced `OMNIVIEW_RECOVERY_OK`, UID 1000 and the live target process. No debugger was injected merely because Exec failed.
7. **Completed lifecycle.** Sending `exit` ended that debugger with reason Completed and exit code 0. The UI retained its record without Restart, Delete or Reconnect; other running debuggers remained reconnectable.
8. **Persistent templates and scope precedence.** Saved Workspace inspector through the real settings UI with image `busybox:1.37.0` and explicit non-secret environment `OMNIVIEW_DEBUG_MARKER=workspace-default`. A fresh independent frontend retained it. The cluster selected this template while the all-cluster default remained Shell; the actual header and palette shells printed its marker. Saving a template did not implicitly select a default.
9. **Advanced UI and elevation.** Real base-ui controls handled image/template changes and optional customization. Network-admin stayed blocked until its explicit consent checkbox was checked; switching to sysadmin cleared consent and blocked launch again. Returned to Restricted before any launch. No privileged debugger was launched.
10. **Real image failure.** A single explicit launch of nonexistent image `registry.k8s.io/pause:omniview-debug-image-does-not-exist-bbcc9266` created `debugger-omniview-80a323d8-d44`. Kubernetes reported ErrImagePull, then ImagePullBackOff. Inspect status showed the actual reason without creating another entry. Waiting entries offer inspection, not Reconnect. A corrected image requires an explicit new launch; the failed entry remains immutable.
11. **Stale identity rejection.** Called the actual runtime ResourceClient.ExecuteAction service against `distroless-single`, supplying a nonmatching original UID and reserved name `debugger-omniview-stale-proof`. The real backend rejected it with code INVALID_REQUEST, title Cannot start debug container, detail Pod UID changed. This negative service test did not replace or delete a fixture Pod.
12. **Terminal resize.** A disposable Linux/arm64 ioctl probe ran in the original header toolbox. Kernel FD 0 initially exposed 0×0 before the fix. After fixing handler resize registration and initial attach-size synchronization, actual viewport changes produced `TTY_ROWS=36 TTY_COLS=175 ERRNO=0` and `TTY_ROWS=36 TTY_COLS=213 ERRNO=0`. The container name, original Pod UID and application restart count remained unchanged. The probe was removed afterward.

Terminal evidence came from actual browser keyboard input and the matching container's Kubernetes logs, not a mocked exec response. API status confirmed the exact target names. A later explicit header Debug invocation is a new launch; Reconnect is the separate operation that reuses an existing container.

The final explicit Reconnect on the network toolbox opened a second host terminal for the same `debugger-omniview-6c2358a1-6a8` container. Commands before and after returned `BEFORE_RECONNECT_PID=79` and `AFTER_RECONNECT_PID=79`. Kubernetes still listed exactly the same two debug entries on `distroless-header`, with the original application UID and zero restarts. This distinguishes true attach from starting another shell with exec.

Reopening Debug options after that per-launch Network toolbox choice still selected the saved Workspace inspector default and `busybox:1.37.0`; choosing a different launch image did not change persisted defaults.

## Regression verification

The final Kubernetes UI run passed 43 files and 468 tests, followed by `tsc --noEmit`. The host terminal/recovery suite passed 3 files and 30 tests; host application, host test and runtime package TypeScript checks also passed. Final backend `GOWORK=off go test ./... -count=1` passed 10 packages, with 6 packages containing no tests. Race-enabled resource/exec package tests passed after the resize-handler fix.

A separate compatibility smoke copied the module constraints into disposable files, removed only the managed local SDK replacement, and ran the full backend suite against the declared published SDK `v0.7.1`. `go list -m` confirmed `github.com/omniviewdev/plugin-sdk v0.7.1`, and the suite again passed 10 packages with 6 containing no tests. Workspace links stayed intact. The disposable module files were removed; local `go.mod` replacements are not part of either PR.

Representative commands:

```sh
# kubernetes/ui
node node_modules/vitest/vitest.mjs run --no-cache --pool=forks --poolOptions.forks.singleFork
node node_modules/typescript/bin/tsc --noEmit

# kubernetes
GOWORK=off go test ./... -count=1
GOWORK=off go test -race ./pkg/plugin/resource/resourcers ./pkg/plugin/exec -count=1

# omniview
node node_modules/vitest/vitest.mjs run --no-cache --configLoader runner ui/providers/BottomDrawer/containers/__tests__
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json
node node_modules/typescript/bin/tsc --noEmit -p packages/omniviewdev-runtime/tsconfig.json
```

Failing-before regressions caught live-found protobuf result serialization, concurrent terminal-input ordering and initial resize delivery defects. Additional failing-before cases covered image-failure guidance, metadata-read failure after an opened terminal, and waiting-to-running status without stale drawer snapshots undoing a fresh observation. All passed in the final suite.

The modal's select portals now stay within its actual base-ui dialog surface, including first open. Real selection and elevation controls were exercised; screenshots are indexed under [production visuals](../mockups/kubernetes-debug/README.md#production-visuals).

## Scope and release coordination

The browser surface exercised the actual CLI-managed host and real Kubernetes backend. A native desktop window, every admission/RBAC policy and forced transport fallback were not exercised live. Automated regressions cover validation, identities, concurrency, uncertain creation, cancellation and lifecycle transitions. Cluster capability/version gates remain deferred, as requested.

The Kubernetes frontend depends on the paired host/runtime changes: `createSession` returns the created Session or null, and terminal recovery retains optional UI-only action metadata. The validated workspace links that runtime source. Merge and publish the host runtime before releasing the Kubernetes plugin, and pin the plugin's minimum dependency to the published version containing this contract; the existing `~0.7.4` range alone does not guarantee it. Do not release the plugin against an older runtime or add a compatibility shim.

## Review environment and cleanup

The namespace is intentionally retained while the user reviews the live workspace. It contains owned fixtures only, including the intentional failed-image record. Ephemeral entries cannot be removed individually. After review, remove these fixtures explicitly:

```sh
kubectl --context kind-kind delete namespace omniview-debug-bbcc9266
```

Do not delete an application Pod or unrelated namespace as a debug-session cleanup mechanism. Temporary resize instrumentation was removed; the shared workspace and review workloads remain available.
