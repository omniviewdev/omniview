# Kubernetes debugging discovery

Approved scope: live-Pod ephemeral debugging, distroless Exec recovery, optional templates/plugin/cluster defaults, and session lifecycle. Copied-Pod, standalone diagnostic and node workflows are later improvements, not current acceptance criteria. Capability gating also remains separate. Keep broader research as reference only.

## Deliverables

- [Workflow research and feature plan](kubernetes-debug-workflows.md)
- [Current plugin integration and API gaps](kubernetes-debug-integration.md)
- [Interactive UI mock](../mockups/kubernetes-debug/index.html)
- [Mock scope and browser verification](../mockups/kubernetes-debug/README.md)
- Visuals: [launch](../mockups/kubernetes-debug/launch-preview.png), [session](../mockups/kubernetes-debug/session-preview.png), [defaults](../mockups/kubernetes-debug/defaults-preview.png)

## Product decision

Place **Debug** beside Exec and Logs. Match Exec's targeting: one running container opens its inspector shell directly; multiple running containers open a names-only container picker. Picking a name starts the default template and opens the existing bottom terminal. No “All Containers,” task question or routine launch modal. A container-scoped action bypasses the picker. The shortcut follows the same targeting rules.

Keep template choice secondary in the adjacent chevron. Selecting another template uses the same container targeting and does not change defaults. **Customize…** preserves the selected target, exposes template/image first, and retains the compact **Customize** disclosure for command, access, mounts, environment and request details. Changing a template must not reset the target. Elevated templates always require confirmation, even when saved as default.

Copied-pod and standalone diagnostics remain separate contextual troubleshooting actions, not competing tabs in the ordinary shell launcher. Keep their research and safety requirements without making operators choose an execution model first.

**Node debugging belongs under Nodes**, with its own action, defaults and host-access review. Do not include it in Pod Debug.

Ephemeral means temporary execution, not reversible Pod mutation. Never offer deletion or restart of an ephemeral container. Keep completed records visible. Never turn attachment failure into another create request.

The supplied etcd screenshot is particularly important: if this is a static mirror Pod, ephemeral containers are unsupported. Keep exec/logs available. Node investigation belongs on the associated Node, never a silent fallback in Pod Debug.

## Customization decision

Select the default template by cluster override → plugin choice → built-in Shell fallback. The menu lists template names and images; selecting one launches it without changing the default. A template stores image, argv, security configuration and optional supported container fields. Resolve explicit fields in this order: built-in defaults → plugin defaults → cluster overrides → selected template fields → launch overrides. Show provenance inside customization. Missing fields inherit; arrays replace. Validate the final resolved request.

Use plugin settings for global defaults and the existing cluster-preference storage for per-connection overrides. Pass the resolved configuration to backend actions explicitly; frontend cluster preferences do not automatically become backend settings. Keep node-shell preferences separate.

Defaults are convenience, not security policy. Kubernetes RBAC and admission stay authoritative. An image default cannot authorize credentials, capabilities, privileged mode or node access. Require fresh review for elevated launches.

### Template settings surface

Keep **Debug defaults** separate from **Edit template**. The defaults view has a scope selector, default toolbox choice, a resolved name/image/source, and a compact shared-template list. Save default changes only that scope's selection. It never saves an unfinished template or starts a session.

Built-in Shell and Network toolbox definitions are immutable starting points. Offer **Duplicate** for built-ins and **Edit** for custom templates. New/duplicate/edit opens a small editor with name and image; retain **Customize** for argv, access, image-pull policy and non-secret environment values. Validate unique names and resolved configuration. Cancel discards the draft.

Templates have stable IDs and are shared across cluster connections. Cluster preferences reference an ID or inherit the plugin choice; they do not copy the parent's current image. Show the effective image and inherited source before saving. A cluster override survives later plugin-default changes; switching back to inheritance follows future plugin changes. Template edits affect future launches only.

Target container, Pod identity and concrete volume bindings remain invocation-specific. Do not bake a production container name or credential mount into a shared toolbox. Saving an elevated template displays a warning but never authorizes access; each launch still requires confirmation and Kubernetes policy checks. The prototype persists only in page memory.

### Fast-action and keyboard contract

- Invoke the same action from the header, container menu and host command search; do not build separate launch flows.
- An explicit container action already has a target. Otherwise one running container launches directly; multiple running containers require the same names-only picker as Exec. Do not silently choose the first container or sidecar, even if a default annotation exists. No live targets means logs/events guidance, not a misleading inspector shell. No “All Containers” bulk injection.
- Prototype binding: **Ctrl+Alt+D** (macOS Control+Option+D). This is proposed, not an established host binding. Production must register a configurable context-scoped command and check platform conflicts.
- Ignore key repeat, composing input, text fields, editors, terminals, dialogs and inactive resource contexts. Never steal keystrokes from an active exec session.
- Starting is a mutation, not navigation. Disable while pending, bind the operation to Pod UID, reconcile uncertain creation, and reconnect to an existing created container on attachment failure.
- Save template edits separately from default selection. Cluster choices reference a template ID; inheritance follows future all-cluster changes. Production must resolve templates and defaults before executing the action, not use frontend preferences as security authority.

### Session lifecycle and recovery surface

Keep the normal shell fast path unchanged. Add compact session records beneath the regular containers, retaining earlier debugger names and states instead of replacing the previous record. Optional Details contains the original Pod UID, creation confirmation, image and raw waiting/termination events. No dashboard or routine modal is added.

- **Starting:** addition confirmed, image still pulling. Show progress in the terminal region, no prompt yet. Hide closes the view only. Disable further debug submissions while a start is pending.
- **Checking creation:** response was lost; admission is unknown. Show a local request record, not a confirmed container. Block resubmission until the original operation and original Pod UID are reconciled. A missing name in one GET is not definitive proof that an in-flight request was rejected.
- **ImagePullBackOff:** retain the immutable entry, show registry/backoff events and offer New session… for an explicit corrected-image launch. Do not edit or remove the old entry. Image-pull retries belong to the same container, not new debug additions.
- **Running / detached:** Reconnect attaches to that recorded container. Detach hides the terminal without ending its process. A deliberate new launch produces a distinct record and preserves previous history.
- **Disconnected:** connection loss does not prove exit. Display last-known-running/current-state-unknown, hide Exit, and offer Reconnect. Observing Running again is not itself proof that the stream reattached.
- **Terminated:** preserve the exit result and record. No Restart, Delete or Reconnect. New session… opens explicit configuration for another container. Production must observe actual termination rather than infer it from sending an exit command.
- **Target gone:** a changed/replaced Pod UID invalidates every old session. Disable stale create/exec/reconnect actions. Require selecting the current Pod, even when its name matches.

RBAC/admission rejection creates no container record. Keep the server reason with scoped guidance; policy denial can open Customize without automatically changing privilege. A definitively rejected original operation can become a local Not created attempt; only then is a new submission safe.

The mock exposes manual lifecycle events under Mock controls. It simulates reconnection checks and server observations; it does not implement a watch, operation reconciliation, background cleanup or live Kubernetes calls. Production must use the existing resource/session transport and preserve the same identity and lifecycle invariants.

### Live inspector contract

The fast path means “bring a shell and tools alongside this running container,” not “create an unrelated diagnostic Pod.” Append an ephemeral container to the existing Pod, set `targetContainerName` to the selected container, and attach to the debug container's configured shell.

- Pod networking is already shared; no separate host networking or namespace switches are needed.
- Request the target process namespace through the runtime. Do not claim success from creation alone: process targeting may be unsupported or ineffective. Explain the limitation without an automatic privileged retry.
- The debugger keeps its own image, root filesystem, environment and security context. It does not inherit the application's root, working directory, credentials or UID automatically.
- `/proc/<pid>/root` can expose a visible live process's filesystem when permissions permit. Existing shared volumes require explicit mounts. Neither is an automatic writable application filesystem.
- Do not automatically run `nsenter`, `chroot`, `strace`, signal application processes, or mutate Pod-wide `shareProcessNamespace`.
- Keep selected target and debugger in the terminal label. A collapsed Session details row exposes network, process-target status and app-file access. Only offer Copy path after discovering a visible live process and checking filesystem access. The mock offers clearly simulated visible, denied, unavailable and unverified outcomes; production must not infer success from the requested target alone.
- Reconnect to the already created debug container after attachment failure. A later user invocation is a new deliberate launch, not a hidden retry.

### Distroless entry and recovery

The official [ephemeral-container use cases](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/#uses-for-ephemeral-containers) explicitly include minimal/distroless images with no shell or debugging utilities. The [running-Pod example](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/#example-debugging-using-ephemeral-containers) demonstrates failed `exec -- sh`, then `kubectl debug -it --image=busybox --target=...`, with automatic attachment and a runtime-support caveat.

The mock follows that interaction instead of asking for a troubleshooting goal:

- Container Debug: one click to the default toolbox prompt.
- Pod Debug: one click for one running container; two clicks for multiple containers.
- Exec reports a missing shell: offer **Debug this container** inline, preserving the exact target. One more click starts the toolbox, without repeating the picker or image setup.
- Keep the shell prompt clean. Put namespace/filesystem explanations under Session details. Show a brief warning only when process targeting is unavailable.
- Never silently turn Exec into a mutation. Show the error and require the explicit recovery click. Only missing executable errors should offer this specific recovery; RBAC, stopped containers and transport failures need their own errors.
- A distroless badge in the mock is fixture data, not a proposed image-name heuristic. Production must not claim shell absence solely from an image name.

The official documentation also covers crashed containers and copied-Pod debugging. An exited process cannot supply a live process namespace or `/proc` root; keep previous logs/copy investigation separate rather than pretending the live inspector recovers terminated memory or writable layers.

## Delivery sequence

1. Define validated debug request/result contracts, immutable Pod UID binding, subresource mutation and observable operation state.
2. Add true Kubernetes attach transport, readiness tracking for the selected ephemeral container, reconnection, logs and terminal resize.
3. Enable toolbar/container actions, context-scoped command and shortcut, direct terminal launch, template menu and reusable plugin/cluster defaults.
4. Verify the approved live-Pod path end to end, including failure handling and template/default resolution. Do not add copy, standalone or node workflows in this scope.

The research matrix records future possibilities, not requirements for this scope. Complete the approved live-Pod behavior and its truthful API/runtime/policy errors without adding extra workflows.

## Workspace evidence

Created using installed `omniview-dev` CLI with fetched `origin/main` for both repositories:

- Workspace: `kubernetes-debug-discovery`
- Workspace UUID: `bbcc9266-b45f-45f1-83f6-110d952ad4ae`
- Directory: `/Users/joshuapare/Repos/omniviewdev/workspaces/workspaces/kubernetes-debug-discovery`
- Host base: `c5367016e8b4e7392a2` (prefix; full SHA recorded in `workspace.json`)
- Kubernetes base: `32968cc8a5d8fe691a08fae7072d2bf43eef3bad`

`workspace inspect --json` confirmed the manifest and selected bases. The host was not built or launched; the standalone mock was served locally and exercised in Chromium. No Kubernetes resources were created. No live-cluster debug transport or permission behavior was verified. Production plugin behavior remains unchanged.
