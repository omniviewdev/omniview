# Kubernetes debug integration map

## Revised product contract

Pod Debug is a live inspector action beside Exec and Logs. Match Exec's targeting: one running container launches directly; multiple running containers show a names-only picker, never “All Containers.” A container-scoped action bypasses the picker; shortcut behavior matches the header. Use the selected name as `targetContainerName` when creating the ephemeral container, then attach to the debugger shell. Keep target identity through template/image changes and in terminal labels. Shared network does not imply shared root filesystem or guaranteed target process visibility. Templates and optional Customize stay secondary. Elevated templates always require confirmation. Node debugging belongs exclusively under Nodes; copy and standalone workflows remain contextual actions. Native shortcut registration and live runtime verification remain future work.

For distroless recovery, use structured missing-executable errors from the existing exec classifier to offer **Debug this container**. Preserve connection, namespace, Pod UID and target container; require the click before creating an ephemeral container. Do not retry Exec errors as debug mutations automatically. The terminal's collapsed Session details should distinguish requested versus observed process targeting, and expose `/proc/<pid>/root` only after permitted live inspection. The current prototype simulates these observations; no backend discovery is implemented.

## Summary

Existing host APIs cover resource mutations, terminal tabs, exec streams, and ephemeral-container logs.

Missing plugin pieces: ephemeral-container creation, Kubernetes attach transport, debug settings, and enabled debug UI.

**Host `AttachSession` does not mean Kubernetes `pods/attach`.** It attaches UI to an existing Omniview terminal session.

Paths below use workspace-relative `kubernetes/` and `omniview/` prefixes. Findings describe inspected code, not exercised behavior.

## Current integration map

| Area | Exact source and symbols | Current contract |
|---|---|---|
| Plugin registration | `kubernetes/pkg/main.go:50-135`, `main` | Registers resource, exec, networker, logs, and metric capabilities. Defines plugin-wide settings. |
| Resource registration | `kubernetes/pkg/plugin/resource/register_v1.go:19-81`, `Register`, `buildRegistrations` | Registers specialized `PodResourcer` for `core::v1::Pod`. Injects `plugin.SettingsProvider` into resource capability. |
| Pod resource | `kubernetes/pkg/plugin/resource/resourcers/pod_resourcer.go:16-42`, `PodResourcer`, `NewPodResourcer` | Embeds generic CRUD base. Adds health, events, relationships. No Pod `GetActions` or `ExecuteAction` implementation found. |
| Existing action convention | `kubernetes/pkg/plugin/resource/resourcers/deployment_resourcer.go:125-203`, `GetActions`, `ExecuteAction`, `StreamAction` | Descriptors support instance scope, danger flag, parameter schema, and streaming. Execution receives connection client and `ActionInput`. |
| Runtime action API | `omniview/packages/omniviewdev-runtime/src/hooks/resource/useResourceActions.ts:37-142`, `useResourceActions`, `useExecuteAction` | Discovery scopes by plugin, connection, resource key. Execution accepts `actionID`, `id`, `namespace`, and arbitrary `params`. |
| Pod exec registration | `kubernetes/pkg/plugin/exec/register.go:22-48`, `Register` | Registers `PodHandler`, default `/bin/bash`. Generic target builder includes **regular containers only**. |
| Pod exec handling | Same file, `:50-104`, `PodHandler`, `podHandlerWithProvider` | Reads Pod name/namespace from `opts.ResourceData.metadata`. Reads container from `opts.Params["container"]`. |
| Kubernetes exec transport | Same file, `:106-181`, `sizeQueue`, `ExecCmd` | Uses `pods/exec`, `PodExecOptions`, WebSocket-first transport, SPDY fallback on upgrade failure. |
| Exec errors | Same file, `:183-223`, `classifyExecError` | Produces structured errors and shell retry suggestions for missing binaries and runtime failures. |
| Exec client resolution | `kubernetes/pkg/plugin/exec/client_provider.go:9-14`, `ClientProvider`, `defaultClientProvider` | Uses shared Kubernetes client resolver. |
| Connection identity | `kubernetes/pkg/utils/client.go:11-32`, `KubeClientsFromContext` | Requires connection data `kubeconfig`; loads clients using kubeconfig path and connection ID. |
| Frontend action bridge | `kubernetes/ui/src/components/shared/drawer/DrawerActionsBridge.tsx:28-51` | Supplies resource actions, logs, exec, stream actions, and per-connection node-shell configuration. |
| Pod actions | `kubernetes/ui/src/components/kubernetes/table/corev1/Pod/actions.tsx:45-183`, `drawerActions` | Exec lists regular and ephemeral containers. Logs lists regular, init, ephemeral, and aggregate selection. |
| Debug entry point | Same file, `:185-190` | “Add Debug Container” exists but remains disabled with an empty implementation. |
| Container display | `kubernetes/ui/src/components/kubernetes/sidebar/Pod/PodContainersSection.tsx:28-80,103-163`, `parseContainers` | Reads all three container classes and their matching status arrays. Renders distinct ephemeral group. |
| Container detail surface | `kubernetes/ui/src/components/kubernetes/sidebar/Pod/ContainerSlice/index.tsx:21-130`, `ContainerSlice` | Displays status, image, command, resources, environment, ports, and mounts. No exec/log/debug buttons here. |
| Log registration | `kubernetes/pkg/plugin/logs/register.go:9-38`, `Register` | Pod target builder includes regular, init, and ephemeral containers. Workload source resolvers also registered. |
| Log execution | `kubernetes/pkg/plugin/logs/handler.go:17-69`, `PodLogHandler` | Opens `Pods(namespace).GetLogs(...).Stream(...)`. Supports follow, previous, timestamps, tail, time filters, byte limits. |
| Log source building | `kubernetes/pkg/plugin/logs/sources.go:35-49,68-83`, `allContainers`, `PodSourceBuilder` | Includes ephemeral containers when building source lists. |
| Dynamic workload logs | `kubernetes/pkg/plugin/logs/resolvers.go:375-445`, `processPodWatchEvents` | Diffs modified Pods and emits newly added sources, including ephemeral containers. |

### Terminal contract

**Current caller shape:**

```ts
createExecSession({
  connectionID,
  label: `${podName}/${containerName}`,
  icon: 'LuContainer',
  opts: {
    resource_plugin: 'kubernetes',
    resource_key: 'core::v1::Pod',
    resource_data: pod,
    params: { container: containerName },
  },
});
```

Source: `kubernetes/ui/src/components/kubernetes/table/corev1/Pod/actions.tsx:51-85`.

- `useExec` creates a pending terminal tab before calling backend.
- It defaults `command` to `['/bin/bash']` and `tty` to `true`.
- Caller options override those defaults.
- It stores options in tab properties for retry.
- Creation failures update tab state and show an error.
- **It catches failures without rethrowing and returns no session object.** Callers cannot treat resolved mutation as confirmed creation.

Source: `omniview/packages/omniviewdev-runtime/src/hooks/exec/useExecSession.ts:30-94`.

`SessionOptions` exposes:

```ts
params: Record<string, string>;
labels: Record<string, string>;
id: string;
resource_plugin: string;
resource_key: string;
resource_data: Record<string, any>;
command: string[];
tty: boolean;
```

Source: `omniview/packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/exec/models.ts:156-164`.

Host routing:

- `controller.CreateSession` resolves plugin provider and connected context.
- Provider receives connection-backed context plus `SessionOptions`.
- Host indexes returned session by plugin and connection.
- `AttachSession`, `WriteSession`, `ResizeSession`, `DetachSession`, and `CloseSession` manage that session.

Sources:

- `omniview/backend/pkg/plugin/exec/controller.go:34-43,400-420,514-542`
- Same file, `:624-648`, `AttachSession`

Terminal UI:

- Uses xterm inside bottom drawer.
- Subscribes to stdout, stderr, and structured error/close events.
- Calls `ExecClient.AttachSession` and restores returned buffer.
- Sends keyboard input through `WriteSession`.
- Sends dimensions through `ResizeSession`.
- Retry creates another session with overridden command.

Sources:

- `omniview/ui/providers/BottomDrawer/containers/Terminal.tsx:91-113,250-355`
- `omniview/backend/pkg/plugin/exec/controller.go:155-185`, `dispatchOutput`

**Resize gap:** `ExecCmd` accepts `resize`, but never supplies `TerminalSizeQueue` to `StreamWithContext`. Existing `sizeQueue` remains unused.

Source: `kubernetes/pkg/plugin/exec/register.go:106-175`.

## Settings: current versus missing

### Plugin-wide settings

`kubernetes/pkg/main.go:55-122` declares:

- `kubeconfigs`
- Kubernetes client log level through `klogconfig.Setting()`
- `shell`, default `/bin/zsh`
- `layout`
- Prometheus service name, namespace, and port

**No ephemeral-debug image, profile, command, or security defaults exist in this list.**

Do not confuse `shell` with container-shell defaults. Its description concerns commands/authentication; Pod exec independently defaults `/bin/bash`.

Host settings API:

```go
ListSettings(plugin string)
GetSetting(plugin, id string)
SetSetting(plugin, id string, value any)
SetSettings(plugin string, settingsMap map[string]any)
ValidateSetting(plugin, id string, value any)
```

Source: `omniview/backend/pkg/plugin/settings/service_wrapper.go:44-65`.

These signatures scope settings by plugin, **not connection**.

### Connection-level preferences

Current connection customization uses plugin data storage, not a connection-scoped settings service.

- `useClusterPreferences` stores `cluster_overrides`.
- Overrides form `Record<connectionID, ConnectionOverride>`.
- `updateOverride` replaces one connection’s override record.
- `ConnectionOverride` includes metrics and node-shell configuration.
- No ephemeral-debug configuration exists.

Sources:

- `kubernetes/ui/src/hooks/useClusterPreferences.ts:26-49,151-157`
- `kubernetes/ui/src/types/clusters.ts:78-98`

Existing node-shell model:

```ts
interface NodeShellConfig {
  image?: string;
  command?: string;
}
```

`NodeShellTabContent` edits these fields and persists on blur.

Sources:

- `kubernetes/ui/src/components/settings/NodeShellTabContent.tsx:30-65`
- `kubernetes/ui/src/pages/ClusterEditPage/index.tsx:272-279`

Frontend explicitly passes node overrides into exec params:

```ts
params: {
  node_shell_image: image,
  node_shell_command: command,
}
```

Source: `kubernetes/ui/src/components/kubernetes/table/corev1/Node/actions.tsx:99-122`.

**Important boundary:** frontend-stored connection preferences do not automatically become backend settings. Existing node-shell flow explicitly bridges them.

### Existing node debugging is separate

`NodeHandler` creates a privileged Pod, not an ephemeral container.

- Namespace: `kube-system`
- Image: `busybox:latest`, overridable
- Host PID/network enabled
- Runs configurable `nsenter` command
- Waits for Pod Running
- Calls `ExecCmd`
- Deletes debug Pod after completion or cancellation

Source: `kubernetes/pkg/plugin/exec/node_handler.go:19-181`.

Do not reuse its deletion lifecycle for ephemeral containers.

## Proposed integration contract

Everything below is **proposal**, not current implementation.

### 1. Create through Pod resource action

Add an instance-scoped action to `PodResourcer`, following existing `GetActions`/`ExecuteAction` conventions.

Suggested action ID: `debug-create`.

Existing runtime call can carry the request:

```ts
executeAction({
  actionID: 'debug-create',
  id: podName,
  namespace,
  params: {
    image,
    name,
    targetContainerName,
    command,
    args,
    stdin,
    tty,
    securityContext,
  },
});
```

Use structured arrays for command and arguments. Resource action params already accept arbitrary values.

Backend should use the dedicated `ephemeralcontainers` subresource, preserving existing entries.

Do **not** route this through editor `update`. Kubernetes requires the dedicated handler, not ordinary Pod edits.

Primary source: [Ephemeral Containers — Understanding ephemeral containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/#understanding-ephemeral-containers).

Define result payload containing actual container name and updated Pod identity/data. Current create-and-terminal sequencing lacks that contract.

### 2. Separate create, attach, exec, and logs

| Operation | Proposed integration | Existing reuse | Missing work |
|---|---|---|---|
| Create | Pod resource action | `useExecuteAction`, resource registration, connection client | Dedicated subresource mutation and result contract |
| Initial interactive attach | Session using explicit attach mode | Host terminal/session transport | Plugin `pods/attach` handler and mode dispatch |
| Later exec | Existing Pod exec with selected ephemeral name | `PodHandler`, `ExecCmd`, terminal tab | State-aware UI; generic target-builder parity |
| Logs | Existing Pod logs with `target: containerName` | Full ephemeral source/log support | Debug-flow handoff and refreshed resource data |

Suggested session extension, without changing current `SessionOptions` fields:

```ts
opts: {
  resource_plugin: 'kubernetes',
  resource_key: 'core::v1::Pod',
  resource_data: updatedPod,
  params: {
    container: debugContainerName,
    mode: 'attach',
  },
  tty: true,
}
```

`mode` is proposed. Current handler ignores it and always executes commands.

Initial attach must connect to debug container’s configured process. Exec starts another process instead.

Kubernetes documents automatic attach for interactive ephemeral debugging:

[Debug Running Pods — Example debugging using ephemeral containers](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/#example-debugging-using-ephemeral-containers).

### 3. Define settings precedence explicitly

Proposed precedence:

**Built-in defaults → plugin defaults → connection overrides → explicitly selected preset fields → invocation choices** (later values win).

Follow existing storage conventions:

- Declare plugin defaults in `pkg/main.go`.
- Add dedicated ephemeral-debug config to `ConnectionOverride`.
- Persist connection overrides through `useClusterPreferences`.
- Expose cluster configuration beside current Node Shell settings.
- Resolve invocation choices explicitly before action/session calls.
- Do not reuse `nodeShellConfig`; its command means host `nsenter`, not Pod debug command.

Backend must enforce Kubernetes constraints independently of UI preferences. Local preferences are defaults, not cluster security policy.

### 4. Preserve existing compact UI language

Reuse:

- `@omniviewdev/base-ui` controls
- Small typography and compact form fields
- `--ov-color-*` tokens
- Existing section cards and container status components
- Bottom-drawer terminal, rather than a second terminal surface

Visual evidence:

- `kubernetes/ui/src/components/settings/NodeShellTabContent.tsx:16-26,70-113`
- `kubernetes/ui/src/components/kubernetes/sidebar/Pod/PodContainersSection.tsx:10-16`
- `kubernetes/ui/src/components/kubernetes/sidebar/Pod/ContainerSlice/index.tsx:37-66`

## Gaps requiring explicit design

1. **No ephemeral-create backend action.** Pod resourcer and exec searches found no mutation implementation.
2. **No Kubernetes attach transport.** Existing implementation targets `pods/exec` only.
3. **No create-to-ready orchestration.** Pod Running does not establish that newly added ephemeral container runs.
4. **No debug settings model or precedence.** Current settings cover unrelated plugin and node-shell concerns.
5. **Exec target lists disagree.** Custom Pod menu includes ephemeral containers; backend generic target builder excludes them.
6. **Exec menu lacks container-state gating.** Existing regular/ephemeral entries remain enabled regardless of status.
7. **Container details lack direct troubleshooting actions.** Existing actions live in Pod menus/header.
8. **Terminal resize stops before Kubernetes stream.** Host and UI resize APIs exist; plugin does not connect queue.
9. **Terminal creation success is not observable through `useExec`.** Hook catches failures and resolves without returning session.
10. **Pod health ignores ephemeral status arrays.** `AssessHealth` inspects init and regular statuses only.
11. **Direct Pod log source discovery differs from workload discovery.** Pod source builder reads supplied resource data; workload resolver watches additions.
12. **Lifecycle warning required.** Ephemeral containers cannot be changed or removed after addition and never restart automatically.

Constraint evidence: [Ephemeral Containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/). Static Pods are unsupported; several normal container fields are disallowed.

Capability metadata and version gating remain separate sprint scope.

Read-only investigation. No builds, tests, formatters, or file changes.