# Kubernetes debugging workflows: discovery and proposal

Date: 2026-10-28. Status: discovery only; no production feature implementation.

Approved delivery scope is narrower than this research: live-Pod ephemeral inspection, distroless Exec recovery, optional templates/plugin/cluster defaults, and session recovery. Copy, standalone diagnostic and node workflows are deferred; their scenarios and later-stage acceptance gates below are reference material, not requirements for the current feature.

## Scope and evidence

Omniview should offer guided troubleshooting rather than a single “open privileged shell” action. The proposed workflows cover an existing Pod, a modified copy, a standalone diagnostic Pod, and an explicit node investigation. Existing logs, events and exec remain the first choices when they answer the question without creating a workload.

The [interactive mock](../mockups/kubernetes-debug/index.html) shows compact, dark Omniview launch, session and defaults views. See the [integration discovery](kubernetes-debug-integration.md) for repository integration points. Mock controls and every Omniview behavior below are proposals, not shipped functionality. Kubernetes behavior labeled **Evidence** comes from the primary sources listed at the end. Commands are illustrative operator recipes, not exercised results. No live cluster was exercised. The standalone mock was served locally and exercised in Chromium; no production builds or test suites were run.

Capability metadata, server/client version gating, and their implementation belong to a separate sprint. This document records relevant constraints without prescribing a version-gating mechanism.

### Revised UX direction

The primary use is a live inspector shell in the existing Pod. Match Exec: **one running container → shell; multiple running containers → names-only picker → shell**. No “All Containers” injection. A container-scoped action starts directly, and the proposed shortcut follows the same rules. Set `targetContainerName` to the chosen container; Pod networking is shared, while target process visibility depends on runtime support and permissions. Keep templates secondary in the chevron. Preserve the selected target through optional image/template changes and retain the **Customize** disclosure. Elevated access always requires confirmation. See the [live inspector contract](kubernetes-debug.md#live-inspector-contract).

This research covers more than the primary launcher. Copied-pod and standalone diagnostics remain contextual actions; operators should not choose between execution-model tabs before getting a shell. Node debugging belongs exclusively in the **Nodes** category with separate defaults and host-access review. Node recipes below are reference material for that separate surface, not Pod Debug requirements.

## Decision model

1. Read the selected object's status, events, current logs and previous logs before starting a container.
2. Use existing exec when the correct running container already has the required tool.
3. Add an ephemeral container when the investigation needs the current Pod's network or live processes and the application image lacks tools.
4. Make a copied Pod when the application exits too quickly, its command/image needs changing, or reproduction should not run inside the live Pod.
5. Create a standalone diagnostic Pod for an independent probe. Do not present its results as proof of the original Pod's behavior.
6. Investigate a node from the Nodes category only when the hypothesis concerns the host, runtime or node network. Require a separate host-access review; never add this mode to Pod Debug.

**Static control-plane Pod decision:** a selected static etcd Pod is not an ephemeral-injection target. Kubernetes does not support ephemeral containers for static Pods [S1]. Offer existing logs or exec where authorized, or an explicit node investigation. A copied etcd Pod is not a safe default: copied identity, data mounts and startup commands can affect a real control plane. Do not offer “repair etcd,” datastore mutation or automatic clone startup as a routine diagnostic action.

## Four execution modes

| Mode | Evidence: what Kubernetes does | Proposed use | Important boundary |
| --- | --- | --- | --- |
| Ephemeral container | Adds a container through `pods/ephemeralcontainers`; does not restart existing application containers [S1, S2, S10]. | Inspect the live Pod network, minimal images and live processes. | Addition cannot be changed or removed. Container never automatically restarts. No resource requests/limits, ports or probes. Not supported for static Pods. |
| Copied Pod | Creates a new Pod with selected image/command changes; `--copy-to` is distinct from in-place injection [S2, S3, S10]. | Freeze a crashing command, test a debug image, reproduce initialization. | New execution, not a snapshot. New IP and writable layers; copied PVC references may still reach real data. |
| Standalone diagnostic Pod | A normal Pod supplies a separate test environment; official DNS diagnosis uses this approach [S6]. | DNS, Service, TLS and outbound connectivity probes. | Different labels, identity, placement, injection and network policy can produce different answers. |
| Node debug Pod | With a host-access profile, runs in host namespaces and mounts host root at `/host`; not automatically privileged under the general journey [S4, S11]. | Node logs, host routes and approved host diagnostics without SSH. | Host namespaces and host files are sensitive even without `privileged: true`. A down kubelet/node can make this path unusable. |

### Non-obvious process and filesystem limits

**Evidence:** `--target=app` asks the runtime to target another container's process namespace. Runtime support is required; the result can fail to start or show an isolated process namespace [S2]. It does not mean “mount app filesystem here.” Containers in a Pod do not automatically share root filesystems. A visible target process can expose its root through `/proc/<pid>/root`, subject to Unix permissions and security controls [S5].

A target process must still exist. An exited application does not leave a live `/proc/<pid>/root` to inspect. An ephemeral container can inspect Pod-level networking without recovering the crashed container's deleted writable layer. Mounted volumes require deliberate mount configuration against existing Pod volumes; injection cannot introduce arbitrary new Pod volumes. Do not promise that a shell starts in the application's working directory, has its environment, or sees its root at `/`.

Process visibility is not permission to trace. UID matching, Linux capabilities, seccomp, AppArmor/SELinux, runtime restrictions and host kernel policy can still block access. A failed `strace` must not trigger automatic privilege escalation. Shared process namespaces also expose process arguments, environment and filesystem secrets under normal filesystem permissions [S5]. Never automatically enumerate environment variables into session history.

**Evidence:** shared process namespaces change PID semantics: the application is not PID 1, and signaling PID 1 can signal the Pod sandbox [S5]. Copied-Pod sharing therefore changes reproduction conditions. Explicitly show this difference instead of treating a copied Pod as identical.

## Workflow matrix

These are proposed first-class recipes. Permission bundles appear below. Tool commands run inside the chosen diagnostic container unless prefixed by `kubectl`. Image contents must match the recipe; an arbitrary BusyBox image does not include every listed tool.

| # | Symptom and question | Recommended path and concrete command | Interpretation, safety and cleanup |
| --- | --- | --- | --- |
| 1 | Distroless app has no shell. Is localhost responding? | Ephemeral, restricted: `curl --connect-timeout 3 --max-time 10 http://127.0.0.1:8080/health`. Launch recipe E. | Same Pod network is useful; not the application's exact filesystem, UID or environment. E permission bundle. Exit debug command; retain immutable entry. |
| 2 | DNS lookup fails only in the app Pod. Which resolver/search path is used? | Ephemeral: `cat /etc/resolv.conf`; `nslookup api.backend.svc.cluster.local`. | Compare fully qualified and short names; record source namespace and resolver. Do not mutate CoreDNS automatically. E; bounded command. [S6] |
| 3 | Service connects by Pod IP but not Service IP. | Ephemeral: `curl --connect-timeout 3 --max-time 10 http://api.backend.svc.cluster.local:8080/health`; read EndpointSlices using recipe R. | Check selector/endpoints/ports before blaming DNS or proxy. Destination Pod readiness and policy matter. E plus read permissions. |
| 4 | Unexpected outbound timeout or TLS failure. | Ephemeral: `curl -Iv --connect-timeout 3 --max-time 10 https://example.com`; `openssl s_client -connect example.com:443 -servername example.com </dev/null`. | Shows this container's trust store, not necessarily the app's. Never default to `curl -k`; redact authorization headers. E; exit normally. |
| 5 | NetworkPolicy appears to block one workload but not another. | Probe from ephemeral container in affected Pod; compare standalone recipe D. Read `kubectl -n "$NS" get networkpolicy`. | Standalone labels/namespace differ. Policies select Pods and require an enforcing network plugin [S7]. Never copy production labels without selector review. E/D plus policy read. |
| 6 | Hung application needs process or open-file inspection. | Targeted ephemeral: `ps -ef`; inspect approved PID using `ls -l /proc/<pid>/fd`. | Requires live process and runtime target support. Missing processes do not prove no application exists. Avoid dumping secrets. E; no automatic tracing capability. |
| 7 | App reports missing config file or wrong file ownership. | Targeted ephemeral: `stat /proc/<pid>/root/etc/app/config.yaml`; inspect only approved non-secret path. | `/etc/app` in debugger is not app root. Permission denial is meaningful; no automatic root fallback. E; no filesystem writes. |
| 8 | CrashLoopBackOff prevents exec. | Previous logs first: `kubectl -n "$NS" logs "$POD" -c "$APP" --previous`; then copied command recipe C. | Copy cannot preserve crashed writable layer. Shell override requires image containing shell; otherwise use approved debug image. C; delete copy only. |
| 9 | Regression needs a debug build or alternate image. | Copy: `kubectl -n "$NS" debug "$POD" --copy-to="$COPY" --container="$APP" --set-image="$APP=$APP_DEBUG_IMAGE" --profile=restricted --attach=false`. | Explicit target avoids wildcard image replacement. Debug image startup can perform real business work. Review credentials, mounts, probes and other containers first. C. |
| 10 | Init container fails or mounted config differs at startup. | Read init logs: `kubectl -n "$NS" logs "$POD" -c "$INIT"`; reviewed copy with `--keep-init-containers=true`. | Init reruns may migrate data or mutate PVCs. Default copy excludes init execution unless investigation explicitly needs it. C; delete copy. |
| 11 | DNS/Service fails across namespace; need independent baseline. | Standalone recipe D; `nslookup kubernetes.default`; probe full Service DNS name. | Namespace search paths differ [S6]. Successful baseline does not clear original Pod's identity/policy/mesh. D; delete Pod. |
| 12 | One node differs from peers. | Reviewed copy `--same-node`, or standalone manifest with explicit placement; compare identical bounded probe elsewhere. | Same-node placement reduces one variable but does not reproduce Pod IP or connection state. Scheduling/resource/volume constraints still apply. C/D; delete diagnostic Pod. |
| 13 | Pod-level packet capture needed. | Ephemeral `--profile=netadmin` after review; `tcpdump -i any -nn -c 100 port 53`. | Elevated capability; admission may reject. Packet data can contain credentials and personal data. Bound count/time and retention. E elevated; stop capture and exit. |
| 14 | Kubelet/runtime failure while node remains reachable. | Node recipe N; `ls /host/var/log`; inspect known log file if present. | Distros may use journald instead of documented file paths. `/host` can reflect kubelet filesystem namespace [S4]. N; delete generated node Pod. |
| 15 | Node routing/conntrack issue affects many Pods. | Node `--profile=netadmin`; `ip route`; bounded `tcpdump -i any -nn -c 100 port 53`. | Host network view, not Pod view. No route/iptables/conntrack mutation defaults. netadmin may not mount `/host` [S11]. N elevated; delete Pod. |
| 16 | PVC access or permission problem. | Read Pod events/PVC status first; approved separate read-only diagnostic mount only when storage semantics permit. | Copying mount references is not copying data. RWO/RWOP constraints and attachment errors can block reproduction. Do not run `fsck`, `chmod -R`, or start app against production data by default. D/C reviewed; delete Pod, not PVC. |
| 17 | Pending Pod, image pull or admission failure. | Read `kubectl -n "$NS" describe pod "$POD"` and events; inspect actual launch error. | Injection does not solve scheduling/image pull/admission. Another image can fail independently. Do not create repeated orphan attempts. Read only, or tracked failed diagnostic cleanup. |
| 18 | Static etcd Pod or unreachable node selected. | Existing logs/authorized exec for static Pod; explicit node path only if node can run a debug Pod. | No ephemeral injection. No automatic copied control-plane process. An unreachable kubelet needs provider/host recovery access, not a promise that node debug works [S1, S4]. |

## Operator recipes and exact effects

Use explicit context and namespace in exported commands. Variables below are operator-selected values, not values discovered or executed here. `DEBUG_IMAGE` must name an approved, architecture-compatible image containing the needed tools, preferably pinned by digest. Commands deliberately select a profile because official task prose and generated CLI documentation disagree about implicit defaults.

```sh
CTX=your-context
NS=your-namespace
POD=your-pod
APP=your-container
DEBUG_IMAGE=your-registry/approved-debug-image@sha256:your-approved-digest
COPY=your-unique-debug-copy
```

### R. Read first

```sh
kubectl --context="$CTX" -n "$NS" get pod "$POD" -o wide
kubectl --context="$CTX" -n "$NS" describe pod "$POD"
kubectl --context="$CTX" -n "$NS" logs "$POD" -c "$APP" --tail=200
kubectl --context="$CTX" -n "$NS" logs "$POD" -c "$APP" --previous --tail=200
kubectl --context="$CTX" -n "$NS" get endpointslice -l kubernetes.io/service-name=api
```

`--previous` can legitimately have no prior instance. Logs can contain secrets; export and retention need explicit consent. Do not interpret missing read permission as missing resource.

### E. In-place ephemeral diagnostic

```sh
kubectl --context="$CTX" -n "$NS" debug "$POD" -it \
  --image="$DEBUG_IMAGE" --container=debug-session-unique \
  --target="$APP" --profile=restricted -- sh
```

Choose a unique name per addition. The image must support the chosen non-root policy and shell. `--target` is needed for target-process inspection, not to share the Pod's network. For a network-only task, omit target-process access when unnecessary. No `resources` field may be set for the ephemeral container [S1]. Show contention risk on production workloads.

For a reviewed approved custom profile:

```yaml
# restricted-debug-container.yaml: partial container spec, not a Pod manifest
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
  seccompProfile:
    type: RuntimeDefault
```

```sh
kubectl --context="$CTX" -n "$NS" debug "$POD" -it \
  --image="$DEBUG_IMAGE" --container=debug-session-unique \
  --target="$APP" --profile=restricted --custom=restricted-debug-container.yaml -- sh
```

The example UID is not universally correct; the chosen image and investigative goal must support it. A read-only root filesystem can break tools needing temporary files. Custom profile support modifies a partial **container** spec, not Pod spec; fields such as name, image, command, lifecycle and volumeDevices are excluded [S2]. Existing Pod restrictions and ephemeral-field restrictions still apply. Setting a Pod-wide field through custom YAML is not a supported workaround.

### C. Copied Pod for a crashing command

```sh
kubectl --context="$CTX" -n "$NS" debug "$POD" -it \
  --copy-to="$COPY" --container="$APP" --profile=restricted \
  --keep-init-containers=false --share-processes=false -- sh
```

This is an explanatory CLI example, **not a safe blind copy operation**. Review generated Pod spec before creating any copy. `--container` must select the existing app container to override its command; otherwise kubectl can add a new container instead [S2]. The selected image needs `sh`. A distroless image may require `--set-image="$APP=$APP_DEBUG_IMAGE"` with an approved compatible debug build.

**Evidence:** kubectl copies the Pod spec, clears ephemeral containers, and normally clears nodeName unless same-node placement is selected [S10]. Profiles affect labels, annotations, probes and process sharing [S11]. Owner metadata is not copied as a controller-owned replica in the inspected implementation. Other application containers and volume references remain important hazards.

**Proposed safe copy plan:** require a manifest diff and explicit review of every process that will start. Remove owner identity and traffic-selecting labels; do not blindly retain annotations. Default to no init execution, no service account token automount, no production write mounts, no automatic process sharing and no `--replace`. Show behavioral changes prominently. If app identity, mesh injection, labels or data mounts are needed for fidelity, restore only explicitly selected fields after a risk review. Do not silently claim a sanitized copy faithfully reproduces production.

Some of these sanitizations need Pod-spec construction beyond `kubectl debug` flags. The future implementation must not imply that the example flags remove copied credentials or PVCs. An explicit projected token or secret volume can remain even when token automount is disabled; review the full manifest.

### D. Standalone restricted diagnostic Pod

A manifest gives clear bounds and avoids implicit service account token mounting. Replace namespace and image before applying this proposal:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: omniview-debug-unique
  namespace: your-namespace
  labels:
    app.kubernetes.io/managed-by: omniview-debug
spec:
  automountServiceAccountToken: false
  restartPolicy: Never
  activeDeadlineSeconds: 1800
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: diagnostic
      image: your-registry/approved-debug-image@sha256:your-approved-digest
      command: [sleep, "1800"]
      resources:
        requests:
          cpu: 25m
          memory: 32Mi
        limits:
          cpu: 250m
          memory: 128Mi
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: [ALL]
```

```sh
kubectl --context="$CTX" -n "$NS" create -f diagnostic-pod.yaml
kubectl --context="$CTX" -n "$NS" exec -it omniview-debug-unique -c diagnostic -- sh
kubectl --context="$CTX" -n "$NS" delete pod omniview-debug-unique
```

Numbers are proposed starting defaults, not proven resource sizing. Larger tools need reviewed limits. Add a bounded temporary volume only when the selected tool needs it. Do not copy the target's service account, secret env, pull credentials or application labels automatically. Approved private images may need an administrator-configured pull secret. `activeDeadlineSeconds` bounds execution; it does not delete the Pod object. A bare Pod has no Job TTL-after-finished cleanup [S9].

### N. Explicit node investigation

```sh
NODE=your-node
kubectl --context="$CTX" -n "$NS" debug "node/$NODE" -it \
  --image="$DEBUG_IMAGE" --profile=general -- sh
```

For general node debugging, expect host PID/network/IPC access and `/host`, not a privileged container [S4, S11]. `chroot /host` may fail. Merely selecting `baseline` or `restricted` does not mean the standard node host-access journey survives: inspected profiles do not add host namespaces or the host-root mount for those choices [S11]. Label such a result as a restricted Pod placed on a node, not a host shell.

`netadmin` is a separate explicit option for network privileges; `sysadmin` sets privileged execution [S11]. Neither should be an automatic retry. Show effective manifest, destination namespace, host mounts, capabilities, identity and cleanup plan before creation. Node debug's arbitrary node assignment and host access require administrative policy approval [S4]. Record the exact generated Pod name and UID; delete that diagnostic Pod after use.

## Permissions, admission and identity

**Evidence:** RBAC resources and subresources are distinct (`pods`, `pods/log`, `pods/exec`, `pods/attach`, `pods/ephemeralcontainers`) [S8]. Permission to read a Pod does not grant debug mutation. The inspected kubectl implementation patches `pods/ephemeralcontainers`; it creates copied/node Pods, and deletes the original only with replacement requested [S10].

| Bundle | Intended API access | Proposed handling |
| --- | --- | --- |
| Read | `get` on selected Pod; `get` on `pods/log`; `list/watch` Pods/events when the UI actually needs them; scenario-specific Services, EndpointSlices, NetworkPolicies and PVC reads. | Ask only for scope used. Separate optional diagnostic reads from launch blockers. |
| E: ephemeral | Pod read plus `patch` on `pods/ephemeralcontainers` for a kubectl-style request. An implementation using update requires `update` instead. Attach/observe permissions separately. | Show exact denied resource and verb. Never grant broad Pod edit as a substitute. |
| C/D: copied or standalone | `create` Pods, read/watch for lifecycle, `delete` diagnostic Pods for cleanup. Attach or exec as needed. | Cleanup denial is distinct from creation denial. Preflight both. |
| N: node | Node read, namespaced Pod create/read/watch/delete and connection subresource permissions. Host access and node assignment must also pass admission. | Do not describe a generic `nodes/debug` RBAC permission; this workflow creates a Pod. |
| Interactive transport | Common POST streams need `create` on `pods/attach` or `pods/exec`; selected GET/WebSocket transports may need `get`. | Confirm against actual transport during implementation. Do not overgrant both blindly. |

Example authorization checks are advisory, not a complete launch guarantee:

```sh
kubectl --context="$CTX" -n "$NS" auth can-i patch pods/ephemeralcontainers
kubectl --context="$CTX" -n "$NS" auth can-i create pods
kubectl --context="$CTX" -n "$NS" auth can-i create pods/attach
kubectl --context="$CTX" -n "$NS" auth can-i create pods/exec
kubectl --context="$CTX" -n "$NS" auth can-i delete pods
```

RBAC success does not prove admission success, image pull success, scheduling, runtime support or security-policy compatibility. Future launch should preserve server rejection text and warnings. Use server-side dry run where the actual request and admission chain support it, but never call it a guarantee that later execution succeeds.

**Admission risks:** Baseline Pod Security Standards disallow privileged containers, host namespaces, hostPath and capabilities outside an allowlist. Restricted additionally requires non-root execution, restricted seccomp, dropping all capabilities and disabling privilege escalation for Linux containers [S12]. These controls explicitly include ephemeral containers. `general` is not a synonym for Baseline: the inspected general ephemeral profile adds `SYS_PTRACE`, which Baseline does not allow [S11, S12]. The name of a debug profile is not an admission exemption.

Mutating and validating policy can also inject sidecars, require image signatures or registries, enforce quotas and deny copied specs. Never change namespace Pod Security labels, exempt an identity, modify NetworkPolicy or weaken admission to make launch succeed. Show a recoverable denial and a reviewed alternate workflow instead.

**Identity risks:** existing-Pod debug can access sensitive data through live processes or approved mounts without separate API permission to read Secrets. A new Pod can carry credentials from its selected service account; token automount is enabled by default unless disabled [S13]. Copy creation can therefore cross a practical privilege boundary. Distinguish caller identity, selected cluster connection, Pod service account and effective container UID in the review. Use the caller's configured authorization; never silently switch to an administrator credential.

## Profiles and customization proposal

### Kubernetes profiles are technical execution inputs

| Static profile | Evidence from inspected upstream implementation | Product stance |
| --- | --- | --- |
| `restricted` | Non-root, drops capabilities, disables escalation, sets runtime-default seccomp; does not make every existing copied container compliant [S11]. | Default for compatible application probes. Show compatibility failures rather than escalating. |
| `baseline` | Removes debug-container security context additions and avoids general's process-tracing capability [S11]. | Explicit compatibility alternative, not automatic fallback. |
| `general` | Adds `SYS_PTRACE` for ephemeral/copy journeys; node journey adds host access [S11]. | Elevated review for application tracing; host-risk review for node use. |
| `netadmin` | Adds `NET_ADMIN` and `NET_RAW`; node journey uses host namespaces [S11]. | Explicit networking task only. Packet capture and mutation risks visible. |
| `sysadmin` | Sets privileged execution; node journey adds host namespaces/root mount [S11]. | Last-resort admin choice, disabled by default in ordinary launch. |
| `legacy` | Legacy compatibility behavior remains in task prose/source but not current generated CLI option list [S2, S3, S11]. | Do not offer as a new default or rely on implicit legacy behavior. |

**Source discrepancy:** the older task page says an omitted profile uses `legacy`; the current generated CLI reference says `general`, matching inspected source [S2, S3, S10]. Examples therefore always specify a profile. Moving `master` source links describe evidence inspected today, not a promise about every shipped kubectl. Recording release-specific capability metadata is separate work.

A workflow preset is not a Kubernetes static profile. A “DNS lookup” preset bundles intent, image/tool needs, suggested command and allowed mode. Its security requirements remain visible independently of its friendly name.

### Plugin and cluster defaults

**Proposal:** expose a plugin-level Debug defaults page and a cluster-specific override panel. Cluster overrides must use stable connection identity, not display name, and must clearly show whether they are local desktop settings or administrator-enforced cluster policy. Local preferences never override real cluster admission.

Resolve the default template by cluster choice, then plugin choice, then the built-in Shell fallback. A menu template choice affects only that launch. Field precedence remains **built-in → plugin → cluster → selected template fields → launch overrides**. A template contributes only its explicit fields; unspecified fields inherit. “Reset” removes an override. Show resolved values and sources inside optional customization. Standard launches need no review checkbox; elevated templates require confirmation even when configured as default.

Proposed configuration fields:

- Approved image catalog by purpose, registry, digest, architecture and tool inventory. Permit custom image selection only under the cluster's configured preference/policy model.
- Default Kubernetes profile and approved custom container-security overlays. Show the resolved security context, not only profile name.
- Mode preferences, default debug namespace for standalone Pods, duration and diagnostic resource bounds. Node defaults belong to the separate Node category.
- Per-workflow command/argument arrays, target-container selection rules and optional approved environment variables. Never concatenate user input into shell commands implicitly.
- Copy behavior: init execution, process sharing, placement, label/annotation allowlists, mount choices and token identity. Every retained sensitive field needs visible provenance.
- Packet-capture bounds, artifact export location and retention. No automatic upload or shared terminal transcript retention.
- Cluster safety preferences: allowed modes, privileged launch visibility and explicit approval requirements. Distinguish user-configurable preferences from actual enforced policy.

The primary toolbar action opens the bottom terminal directly using the default template. Remove the task selector. Use named image-backed templates, not troubleshooting questionnaires. Preserve the optional Customize dropdown. Keep copy and standalone workflows contextual, and node investigation exclusively under Nodes. Elevated access and new diagnostic identities still require appropriate review.

## Lifecycle, cleanup and reconnect

**Proposal:** model planning, submitting, waiting, running, disconnected, terminated, failed, cleanup-pending and cleaned states. Preserve the actual Kubernetes waiting/termination reason separately. Admission denied, image pull error, quota, scheduling failure and runtime target failure need different guidance.

- Create a stable local session identifier and record cluster identity, namespace, target UID, diagnostic Pod UID/name and container name after successful creation. A Pod name reused after replacement must not silently become the old target.
- On ambiguous network failure, reconcile the named container or diagnostic object before retrying. Blindly replaying ephemeral addition creates immutable duplicate entries. Do not create a retry subsystem that disguises API uncertainty.
- Terminal disconnect is not proof that the process ended. Show reconnect separately from terminate. Reattach to a running interactive command when supported; exec into a running diagnostic container only when its image and permissions support that path.
- Exiting an ephemeral container stops that process but leaves its spec/status entry. It cannot restart or be removed independently [S1]. Never make “Clean up” delete the production Pod to remove that record.
- Terminating a debug process is not the same as removing the ephemeral entry. Kubernetes exposes no delete-ephemeral-container operation. Do not promise reliable remote termination when the session is disconnected and there is no approved execution path.
- Copied and standalone Pods can keep running after the terminal closes. Offer deletion only for explicitly tracked diagnostic objects. Deleting a copy may affect shared mounts; it does not roll back writes already made.
- Node debug creates a separate Pod requiring deletion [S4]. Warn when cleanup permission is absent; keep exact manual command available.
- Execution deadlines are not deletion deadlines. Bare Pods do not gain `ttlSecondsAfterFinished`; that mechanism applies only to Jobs [S9]. A future offline cleanup guarantee needs a cluster-side owner/controller or an explicitly chosen Job workflow, not a desktop timer claim.
- Offer default 30-minute execution bounds for new diagnostic Pods as a proposal. Show “cleanup requires connected client/manual delete” unless a real cluster cleanup mechanism exists. Ephemeral containers cannot receive new Pod-wide deadlines safely as a convenience.
- On reconnect, show surviving diagnostic sessions. Do not auto-delete solely because a label resembles Omniview's label; require recorded UID and scope. No production-Pod deletion action should share the session's routine cleanup button.

Session details should contain target identity, mode, resolved plan, security delta, status/events, terminal and cleanup instructions. Artifact export is explicit and warns about logs, process environments and packet captures containing secrets.

## Safe defaults summary

1. Read-only observations before mutations; no automated repairs, package installation or application signals.
2. Explicit context, namespace, target Pod UID and container. Require a live target for process inspection.
3. Restricted-compatible image/profile for ordinary probes. Never auto-escalate to netadmin, root or privileged.
4. Prefer approved digest-pinned images with known tools. Surface image pull policy, architecture and registry constraints.
5. No secret/token env imports, production mounts, production labels or controller identity by default for new diagnostics.
6. No original-Pod replacement, deployment patching, admission changes or control-plane cloning.
7. Bound network probes, packet captures and standalone resource use. Explain the lack of ephemeral resource guarantees.
8. Keep effective request details available under customization. Require review for privilege changes and higher-risk copy operations, not every standard shell. Keep server errors intact.
9. Distinguish disconnect, process stop and object cleanup. Never represent ephemeral entries as removable.
10. Do not equate copied/standalone probes with exact production identity, data or network behavior.

## Proposed staged acceptance criteria

These are future delivery gates, not claims of completed implementation. Production code and capability/version metadata are outside this discovery.

### Stage 0 — discovery and UX agreement

- Review Pod scenarios with operators, including static etcd and restricted namespaces. Review host scenarios separately under Nodes.
- Validate the [action-first mock](../mockups/kubernetes-debug/index.html) for direct toolbar and shortcut launch, alternate template selection, optional Customize disclosure, saved templates, cluster default inheritance and elevated-template confirmation.
- Agree on terminology: ephemeral entry, diagnostic Pod, copied Pod, host investigation, profile and workflow preset.
- Approve settings precedence, source badges, explicit preset fields and safety review independent of precedence.
- Confirm that command examples are proposed recipes, not exercised cluster evidence.

### Stage 1 — low-privilege existing-Pod diagnostics

- Launch a restricted-compatible ephemeral command in a disposable non-static Pod without restarting the application.
- Inspect target process visibility separately from shared networking; explain unsupported target-runtime behavior without privilege escalation.
- Reject invalid ephemeral fields before submission where determinable; preserve authoritative server validation errors.
- Display exact authorization/admission denial and distinguish image pull, waiting and runtime failure.
- Reconcile ambiguous submission without duplicate injection; bind session to target UID and container name.
- Demonstrate terminal disconnect/reconnect and terminated-entry display. Routine cleanup never deletes the source Pod.
- Validate DNS, localhost, Service and bounded TLS scenarios. Verify secret material is not automatically captured or exported.

### Stage 2 — standalone diagnostics and safe copied Pods

- Create bounded standalone Pods with no API token automount and explicit resources; demonstrate exec and tracked deletion.
- Show that deadline expiry stops execution but does not imply object deletion.
- Preview copied spec differences, retained volumes/identities, every process and init behavior before creation.
- Demonstrate crash-command override and debug-image replacement without mutating or deleting the source Pod.
- Show policy/mesh/labels/namespace differences when comparing standalone or copied results with the original.
- Exercise cleanup denial, failed scheduling, name collision and connection loss; show surviving objects and manual cleanup.
- Prove deletion targets the recorded diagnostic UID, not a replacement object with the same name.

### Stage 3 — elevated process and packet investigation; separate Node work

- Keep root, process-tracing capabilities, netadmin and sysadmin behind explicit review and configured cluster preference.
- Explain Baseline/Restricted admission denials without offering an automatic policy bypass.
- Demonstrate bounded Pod and node packet captures with explicit artifact consent and retention.
- In the separate Node category, show actual host namespaces/mounts; do not label restricted node placement a host shell.
- Demonstrate that static Pods cannot use ephemeral injection. Unreachable kubelet handling belongs to the Node workflow, not a Pod launcher fallback.
- In the separate Node workflow, delete the exact created diagnostic Pod. Never modify routes, iptables, host files or datastore state by default.

### Stage 4 — reusable customization and operational readiness

- Resolve built-in/plugin/cluster/preset/launch fields with source attribution and explicit-field inheritance.
- Round-trip cluster overrides, reset behavior, approved images and custom container overlays without leaking settings across connections.
- Preserve argv boundaries and redact sensitive values in previews/exports. Flag custom profiles that exceed the selected mode's field support.
- Publish an honest cleanup contract, including desktop-disconnected limitations. Any cluster-side cleanup mechanism needs its own design and authorization review.
- Exercise multi-container Pods, init containers, immutable ephemeral records, PVC constraints and host-security controls in designated disposable environments.
- Main implementation owner chooses appropriate unit/integration/security tests. No such tests were run during discovery.

## Primary sources

All sources below are official Kubernetes documentation or Kubernetes-maintained kubectl source, read for this discovery on 2026-10-28. Documentation can change; source links on `master` are moving references. Section names and source symbols identify the exact evidence used.

- **[S1]** [Ephemeral Containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/#understanding-ephemeral-containers), “What is an ephemeral container?”: immutable additions, special handler, unsupported fields, no automatic restart, static Pod exclusion.
- **[S2]** [Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/#debugging-with-an-ephemeral-debug-container), “Debugging with an ephemeral debug container,” “Debugging using a copy of the Pod,” “Debugging a Pod or Node while applying a profile,” and “Applying Custom Profile”: commands, runtime target caveat, copy modes and partial-container custom profiles.
- **[S3]** [kubectl debug reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_debug/), “Options”: explicit flags, copy retention controls, replace behavior, same-node placement and current documented `general` default.
- **[S4]** [Debugging Kubernetes Nodes With Kubectl](https://kubernetes.io/docs/tasks/debug/debug-cluster/kubectl-node-debug/#debugging-a-node-using-kubectl-debug-node), “Before you begin,” node host access, filesystem namespace caveat, privilege limits, down-node limit and “Cleaning up.”
- **[S5]** [Share Process Namespace between Containers in a Pod](https://kubernetes.io/docs/tasks/configure-pod-container/share-process-namespace/#understanding-process-namespace-sharing): PID 1 differences, `/proc` exposure, filesystem access and secret risks.
- **[S6]** [Debugging DNS Resolution](https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/), “Create a simple Pod to use as a test environment,” resolver inspection and DNS Service/EndpointSlice checks.
- **[S7]** [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/#the-two-sorts-of-pod-isolation): Pod/namespace selectors, additive ingress/egress, both-end requirements and enforcing-plugin prerequisite.
- **[S8]** [Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/#referring-to-resources), “Referring to resources”: distinct subresource permissions and additive RBAC model.
- **[S9]** [Automatic Cleanup for Finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/#cleanup-for-finished-jobs): TTL-after-finished applies only to Jobs, not arbitrary diagnostic Pods.
- **[S10]** [kubectl debug implementation](https://github.com/kubernetes/kubectl/blob/master/pkg/cmd/debug/debug.go), `AddFlags`, `debugByEphemeralContainer`, `debugByCopy`, `generateNodeDebugPod`, `generatePodCopyWithDebugContainer`: explicit profile default, PATCH subresource, create/delete operations, copied spec and node Pod generation.
- **[S11]** [kubectl debug profiles implementation](https://github.com/kubernetes/kubectl/blob/master/pkg/cmd/debug/profiles.go), `generalProfile.Apply`, `baselineProfile.Apply`, `restrictedProfile.Apply`, `netadminProfile.Apply`, `sysadminProfile.Apply` and security helpers: mode-specific privilege, mount and process-sharing effects.
- **[S12]** [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/#profile-details), “Baseline” and “Restricted”: host namespace, hostPath, capability, privilege, non-root and seccomp requirements, including ephemeral-container fields.
- **[S13]** [Configure Service Accounts for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#opt-out-of-api-credential-automounting): default service account assignment, credential automount and Pod-level opt-out.
