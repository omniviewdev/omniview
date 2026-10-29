# Live Pod Debug: implementation and acceptance contract

Status: implemented and live-verified in workspace `kubernetes-debug-discovery` (`bbcc9266-b45f-45f1-83f6-110d952ad4ae`). This contract preceded feature code. Host and Kubernetes worktrees started from fetched `origin/main`. See [live validation evidence](kubernetes-debug-live-validation.md); approved mocks remain design references, not production evidence.

## Scope and entry points

Implement live-Pod ephemeral inspection, distroless missing-shell recovery, optional customization, reusable templates, plugin/cluster defaults and session lifecycle. Do not implement copied Pods, standalone diagnostic Pods, node debugging, repair operations, capability/version discovery or cluster-policy bypasses.

The Pod header and Kubernetes command palette MUST derive Debug from the same shared `drawerActions`/`resolveKubernetesActions` path. Single running application container: start immediately. Multiple: choose the container by name, not index. No All Containers/bulk injection. Container-level actions already have the target. Palette actions must re-read the resource, validate namespace/name/UID, and revalidate target availability at execution. The standalone palette hook context must work without an open drawer/table. No mock-only palette or header path.

Keep Debug options secondary: optional template/image panel, collapsed Customize fields, and Templates & defaults. No task question or routine confirmation for the standard shell. Elevated access always requires fresh per-invocation confirmation, including elevated saved defaults. A shortcut must be context-scoped and ignore text inputs/editors/terminals/dialogs; do not claim a shortcut exists until live verified.

## Resource and transport wire contract

Register instance resource action `debug-create` on `core::v1::Pod`.

`ActionInput.id` and `namespace` identify the Pod. `params` contains:

- `podUID`: required immutable UID from the selected resource.
- `name`: required client-reserved unique ephemeral-container name, generated once per request (`debugger-omniview-` plus random suffix, valid DNS label). Reuse it for reconciliation; never regenerate on an uncertain outcome.
- `targetContainerName`: required name of a currently running regular container.
- `image`: required nonblank toolbox image.
- `command`: nonempty string argv array, default `["sh"]`; preserve argument boundaries.
- `profile`: `restricted` (default), `netadmin`, or `sysadmin`.
- `elevatedAcknowledged`: explicit true required for profiles other than restricted.
- `imagePullPolicy`: `IfNotPresent` or `Always`, default IfNotPresent.
- `env`: optional string-valued object; no automatic source env/credential copying.
- `volumeMounts`: optional explicit existing-volume mounts; only read-only mounts referencing Pod volumes, no added Pod volumes or automatic mounts.

Backend decodes and validates the final request itself; frontend validation is not a security boundary. Derive security context from the supported profile, never accept arbitrary privileged JSON. Standard profile uses non-root UID 1000, no privilege escalation, drop ALL capabilities and RuntimeDefault seccomp. Netadmin adds only required network capabilities; sysadmin is explicitly privileged. Unsupported profiles/fields must fail, not silently fall back.

`ActionResult.success=true`, `data={pod, podUID, containerName, created}` returns the current Pod as structured JSON, original UID, exact selected debug name, and whether this call added it. Success means addition accepted, not shell ready.

Mutation uses the dedicated ephemeralcontainers subresource and preserves every existing entry. Fetch fresh Pod; reject missing/replaced/deleting/terminal/static-mirror Pods, absent/stopped targets and container-name collisions. Use resourceVersion/UID concurrency checks. Standard conflict retries may refetch/revalidate and append the same reserved name; they may not add a second name. Exact same name/config replay under the same Pod UID is idempotent; changed config colliding with an existing name is an error. Do not edit/remove/restart existing ephemeral entries or alter app containers, Pod-wide namespaces, probes, resources, labels, secrets or controllers.

On ambiguous submission failure, reconcile the reserved name against the original UID. If the same complete entry is present, return it. If acceptance cannot be established, return a distinct `DEBUG_CREATION_UNKNOWN` error and keep the request guarded in the UI. Never infer definitive rejection from one absent-name GET while a request can still be in flight. Known 4xx validation/RBAC/admission rejection is not an unknown success.

Attach uses existing exec session transport with `SessionOptions.params={mode:"attach",container:containerName,pod_uid:podUID}` and the actual Pod resource data. Add true Kubernetes `pods/attach`; this is not host UI `AttachSession` and not a new `pods/exec` process. Recheck Pod UID and the exact ephemeral status before attachment, wait cancellably for that container (not just Pod Running), and surface image/runtime/termination reasons. Support WebSocket-first/SPDY fallback, resize, cancellation and stream error propagation without goroutine leaks or shared-variable races. Normal existing exec and Node exec behavior must remain intact.

## State and lifecycle

One shared pending guard spans header, container action and palette contexts for the same connection/namespace/Pod UID. Create and attach are separate transitions. Record the reserved name before submission. Once addition succeeds, attachment failure must expose reconnect using that same name rather than another create. Record current status, target, image, original UID and creation certainty. Existing Pod status is authoritative; a local last-known state is not a new server observation.

- Starting: no premature prompt; exact-container Waiting reason/message visible; hide/detach does not remove the record.
- Running: attach debugger's configured shell. Pod network is shared. Request selected target process namespace, but do not claim visibility solely from targetContainerName. Toolbox root/user/env/trust store remain distinct. No automatic chroot/nsenter/tracing/credential mounts.
- ImagePullBackOff/runtime failure: preserve name/entry and actual reason. No silent image/profile fallback. An explicit corrected launch creates a new name while retaining the old record.
- Disconnected/attachment lost: process state unknown or last-known running. Reconnect revalidates the original UID/name and opens a new host stream to the same debug container. Do not claim remote exit.
- Terminated: show reason/exit result, preserve immutable record; no Restart/Delete/Reconnect. New session is explicit.
- Pod UID changed/deleted: reject stale create/attach and invalidate old session actions even if name is reused.
- Unknown create: block duplicate submissions; permit status inspection/reconciliation, not blind retry.

State survives component/drawer transitions and palette use. Reconstruct observed ephemeral statuses from fresh Pod data; do not lose already created entries because a terminal closes. No hidden timer claims cleanup. Never delete the application Pod to clean debug entries.

For missing-executable exec errors only, surface Debug this container with original target identity retained. A click is required before mutation; permission, connection and stopped-container errors must not silently become debug launches. Host/runtime may expose an optional terminal recovery callback, but it must not hard-code Kubernetes business logic in generic terminal rendering.

## Templates and persistence

Built-in Shell (`busybox:1.37.0`) and Network toolbox are immutable starters. Duplicate built-ins; edit custom templates. Template fields: stable ID, unique name, image, argv, profile, pull policy and explicitly configured non-secret env. Targets, Pod identities and concrete volume bindings remain per-launch. Cancel discards a draft. Editing a template affects future launches only.

Persist plugin-wide templates/default selection using the plugin's existing persistence conventions. Persist a cluster default ID/explicit inheritance with existing connection preferences keyed by connection ID, not display name. Cluster override > plugin choice > built-in Shell fallback. Missing override inherits future parent changes, not a copied current value. Saving a template does not also select it as default. Missing/deleted/malformed template IDs must have a visible safe resolution/error, never privilege escalation. Save failures must not falsely show success or silently change effective settings.

## TDD matrix: tests must fail before feature implementation

1. Creation adds exactly one targeted ephemeral container; existing entries and app spec remain unchanged.
2. Stale Pod UID, mirror/static Pod, deleting/terminal Pod, no running target and stopped target cause no mutation.
3. Invalid image/argv/env/profile/mount/pull policy and unacknowledged elevation cause no mutation.
4. Standard security context is non-root; approved elevated profiles do not bypass acknowledgment.
5. Conflict/refetch preserves concurrent entries; same-name/config replay is idempotent; different config never adopts the existing name.
6. Rejected authorization/admission is preserved; uncertain creation never blindly creates again.
7. Attach selects `pods/attach`, original UID and exact debug name; waits for selected status, not Pod phase; reports waiting/terminated/replaced cases.
8. Resize/cancellation and stream completion preserve existing exec behavior.
9. Header and palette expose the same named running targets; no All Containers, stopped targets or stale scopes.
10. Concurrent header/palette starts cannot add duplicate containers. Attach failure reconnects without another create.
11. One/multiple/zero live targets yield direct launch/picker/unavailable guidance.
12. Config/template precedence, inheritance reset, cancel, unique-name validation and immutable built-ins behave correctly.
13. Elevated saved template still requires confirmation; standard default has no routine dialog.
14. Create rejection, pending, image failure, disconnected, terminated and target replacement expose correct next actions.
15. Missing-shell recovery is explicit and target-preserving; other exec errors do not offer misleading fallback.

Tests must assert consumer-visible behavior, identity, mutations, boundaries and transitions, not source strings or mock echoes. First test-writing wave creates failing tests only. Parent runs/records red before the implementation wave. All Go commands use GOWORK=off. Do not run unmanaged pnpm installs; managed workspace dependencies remain CLI-owned.

## Live acceptance and delivery gates

Use only local `kind-kind`, in a uniquely owned namespace such as `omniview-debug-bbcc9266`. Never mutate other kubeconfig contexts or existing workloads. Use disposable pause/distroless fixtures, one and two running containers. Explicitly name context/namespace on kubectl commands.

Before push/PR:

1. CLI workspace has Kubernetes selected, successful pinned linking evidence, healthy host/plugin/frontend and authenticated instance evidence.
2. Real header Debug opens shell for shell-less target; run commands and observe output. For two targets, choose by name and verify selected process targeting where supported. Prove source UID/restart count unchanged.
3. Real command palette scopes to the fixture Pod, discovers Debug through shared actions, and launches the same functional shell without relying on an open resource drawer. Repeat with the header closed.
4. Exercise actual missing-shell Exec recovery, default/template save + reload, elevated review, reconnect and terminated entry behavior.
5. Observe at least one real permission/admission/image error with no duplicate debug creation. Verify stale identity protection and no application Pod deletion.
6. Run focused and relevant regression checks after implementation, then real browser/native surface smoke. Unit tests alone are not live proof.
7. Record actual commands, URLs, namespace/UID identities, meaningful terminal output and screenshots; redact credentials. Remove throwaway probes after evidence is captured. Retain owned fixture workloads only while human review is active, with explicit namespace cleanup instructions. Update user docs/changelog.
8. Push/PR only after the above gates pass; otherwise finish reachable work and report an exact evidenced blocker, without claiming completion.
