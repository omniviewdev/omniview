# Pod Debug: action-first prototype

`app.js` is a simulated design prototype. Files prefixed `live-` are separate screenshots of the actual implementation running against Kubernetes in the CLI-managed workspace. See [live validation evidence](../../roadmap/kubernetes-debug-live-validation.md).

Open `index.html`, or serve this directory over HTTP. No build or dependencies required. Approved scope is live-Pod ephemeral inspection, optional templates/defaults, and session recovery. Copied-Pod, standalone diagnostics, node workflows and capability gating are deferred.

## Fast path

Click the bug action beside Exec/Logs. With one running container, the default template opens its inspector shell immediately. With multiple containers, show only their names, matching Exec. Pick one to start. No “All Containers,” template question or routine modal. The default mock offers `checkout` and `istio-proxy`; Mock controls can switch to one or zero live targets.

The adjacent chevron opens a small menu:

- **Shell** — `busybox:1.37.0`.
- **Network toolbox** — `nicolaka/netshoot:v0.14`.
- **Customize…** — select a template or change its image for this invocation. Preserve the collapsed **Customize** disclosure for target, argv, access, pull policy, existing volume, environment and optional request details.
- **Templates & defaults…** — edit or create named image/command/access templates; choose an all-cluster or per-cluster default.

Selecting a menu template uses the same target picker without changing defaults. A container-scoped action skips picking. Privileged or capability-adding templates always require explicit confirmation, including when saved as default. One-off edits never update templates automatically. Changing templates in customization preserves the selected target.

The mock shortcut is **Ctrl+Alt+D**, labeled proposed. It uses the same default-template action and ignores text fields, terminal descendants, dialogs, composition and key repeat. Production must register the command in the host's configurable context-aware shortcut system, check platform conflicts, and suppress it in editors/active terminals. The prototype does not integrate the native host command registry.

Production must pass the selected name as `targetContainerName`, create the ephemeral container in the existing Pod and attach to the debugger's shell. Network is shared; target process namespace support depends on the runtime. The debugger retains its own root filesystem and environment. `/proc/<pid>/root` requires a visible live process and sufficient permissions. Do not automatically chroot, nsenter or escalate privilege. Terminal labels identify both the target and debugger. No live namespace behavior is verified by this mock.

Node debugging belongs under **Nodes**. No node launch option appears here. Copied-pod and standalone diagnostics remain separate contextual actions described in the research.

## Distroless inspection

The fixture marks `checkout` as distroless. Its row's Debug action starts a toolbox in one click. Header Debug requires only a target click when multiple containers run. Exec is now an interactive missing-shell simulation: pick a container, see `exec: "sh": executable file not found in $PATH`, then click **Debug this container**. The recovery retains the target and uses the saved default template. It does not mutate anything before that explicit click.

The prompt stays clean. Session details starts collapsed and shows shared networking, process access and app-file access. Mock controls select simulated readable, denied, unavailable or unverified process access. Only the readable fixture offers a `/proc/<pid>/root` path and Copy path. Those PIDs are fixture values, never discovered live. No command runs when copying. Unavailable process targeting shows a short warning without automatic privilege changes.

This follows the official [ephemeral-container use cases](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/#uses-for-ephemeral-containers) and [failed-exec / targeted-debug example](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/#example-debugging-using-ephemeral-containers). Image-name heuristics do not prove shell absence; the distroless badge is mock data.

## Templates and settings

**Debug defaults** contains only scope, default toolbox, resolved image/source and a compact template list. The separate template editor shows name/image with Customize collapsed. Built-ins offer Duplicate; custom templates offer Edit. Cancel discards the draft. Saving a template never changes a default or starts a container.

Templates have stable IDs, unique names, images, argv, access, pull policy and non-secret environment values. Concrete target/volume bindings stay per launch. Definitions are shared across clusters; cluster settings choose an ID or inherit the plugin default. A cluster override survives later plugin-default changes. Resetting to inheritance follows the plugin choice. Saving an elevated template/default warns clearly; every elevated launch still requires confirmation. Changes affect future launches, never an existing container.

The mock stores changes in page memory only. Refresh resets them. The example images are concrete references, not verified pulls; production needs approved registry/digest, compatible architecture, required binaries and a tested non-root security context. An image selection does not grant capabilities or bypass admission.

## Lifecycle and recovery

Session cards now preserve history. Starting opens progress in the terminal region, without a shell prompt. Hide never cancels the container. Pending startup and ambiguous creation disable additional debug submissions. A lost response produces a local Checking creation request, not a confirmed container.

Mock controls include session selection and an explicit observed-event selector. Use Apply simulated event to move a request through startup, image failure, running, disconnection, exit or Pod replacement. Reconciliation can confirm the original container or definitively reject the original operation. A single missing-name lookup would not justify that rejection in production.

Image-pull failure retains the old entry and exposes its events. New session… opens customization for a distinct corrected launch. Detach/reconnect retains the container name and count. Connection loss hides Exit and reports uncertain process state; a Running observation alone does not reattach. Finished records have no restart/delete/reconnect action. Pod UID replacement invalidates old sessions and stale Exec/Debug actions.

Details shows target, image, original Pod UID, confirmation and simulated raw events. RBAC/admission failures create no card. The event controls are a design aid, not a live watch or reconciliation implementation. Every fixture UID and server event is simulated. Refresh resets the entire mock.

## Visuals

- `launch-preview.png` / `container-picker-preview.png`: names-only container picker matching Exec.
- `menu-preview.png`: secondary template/options menu.
- `configure-preview.png`: optional template/image panel with Customize collapsed.
- `customize-preview.png`: expanded customization.
- `session-preview.png`: clean prompt after one-click container Debug.
- `exec-recovery-preview.png`: missing-shell error with direct recovery action.
- `inspector-details-preview.png`: optional network/process/app-files details.
- `process-limited-preview.png`: honest runtime limitation without privilege escalation.
- `defaults-preview.png`: cluster inheritance and shared template list.
- `template-editor-preview.png`: separate name/image editor with Customize collapsed.
- `template-advanced-preview.png`: optional command/access/pull/environment fields.
- `cluster-override-preview.png`: explicit cluster toolbox override.
- `startup-preview.png`: image pulling without a premature prompt.
- `creation-unknown-preview.png`: unconfirmed request and duplicate-submission guard.
- `image-pull-preview.png` / `events-preview.png`: immutable failed entry and raw events.
- `disconnected-preview.png`: reconnect without claiming process termination.
- `completed-preview.png`: retained finished record and explicit new-session action.
- `policy-denied-preview.png`: actionable denial without a created container.
- `session-history-preview.png`: new session alongside a retained finished record.

Layout follows supplied screenshots. `theme.css` reuses the resource-history prototype's Void semantic token snapshot. Production should consume `@omniviewdev/base-ui` tokens directly. Exec simulates a known missing-shell outcome for either selected target; Logs remains visual context.

## Browser smoke evidence

Exercised in Chromium at 1568 × 988:

- Multi-container header action shows only container names and creates nothing before selection.
- Selecting `istio-proxy` carries that target into the request and terminal label; single-container action launches without a picker.
- Ctrl+Alt+D shows the same multi-container picker; arrow keys and Enter choose the target. Focused search input and terminal descendants remain excluded.
- Container-scoped Debug bypasses the picker.
- Optional template changes preserve the chosen target; no-running-target action shows logs/events guidance without creating a session.
- Menu supports arrow-key navigation and Escape dismissal.
- Optional Customize starts collapsed; elevated access blocks until explicitly confirmed.
- Creating a named template stores its image; choosing it as cluster default changes subsequent launches.
- Removing the cluster choice restores the all-cluster default.
- Saving an elevated default cannot bypass confirmation.
- Permission denial shows inline without a new session. Attachment failure offers reconnect without another create.
- Reconnect restores the terminal; no browser runtime errors observed during screenshot capture.
- Distroless container Debug opens a clean prompt without setup; Session details stays collapsed.
- Missing-shell Exec recovery retains the target and opens Debug in one click, without another picker.
- Readable process fixture offers Copy path; denied, unavailable and unverified states never offer an app-root path.
- Runtime limitation keeps the simulated network shell available and does not escalate access.
- Built-in duplication leaves the built-in unchanged; template saves preserve the pending default selection.
- Custom template pull policy and environment round-trip into launch customization without changing target.
- Cluster overrides survive plugin-default edits; resetting inheritance follows the plugin's current image.
- Cancel discards template edits; duplicate names and empty commands produce validation errors.
- Elevated template/default warnings never bypass per-launch confirmation.
- Starting shows no prompt, blocks duplicate creation, and attaches the same container when Running arrives.
- Detach/reconnect preserves identity and count; Running observations after disconnection do not imply reattachment.
- Checking creation blocks shortcut resubmission; reconciliation confirms the same entry or definitively marks Not created.
- Image correction creates a new entry and preserves the old failed entry and events.
- Completed history remains visible; Pod replacement invalidates all old reconnect/create/exec actions.
- RBAC/admission denial creates no record and policy customization preserves the selected target.

Screenshots were captured from the rendered surface. Mock controls select container count, process access, launch outcomes and manually observed lifecycle events.

## Limits

Design mock only: no cluster requests, terminal command execution, persistent preferences, native shortcut registration, live reconciliation or production plugin changes. Session history is in page memory. One terminal is visible at a time. Background resource table/tabs are context. Advanced controls model choices, not complete Kubernetes request serialization. No live-cluster image, admission, process visibility or transport behavior was verified.

See [product contract](../../roadmap/kubernetes-debug.md), [workflow research](../../roadmap/kubernetes-debug-workflows.md) and [integration map](../../roadmap/kubernetes-debug-integration.md).

## Production visuals

- `live-header-container-picker.png`: actual names-only header picker.
- `live-header-shell.png`: actual header-created toolbox, running as UID 1000.
- `live-palette-targets.png` / `live-palette-shell.png`: scoped Debug action and working shell without an open Pod drawer.
- `live-base-ui-compact.png` / `live-base-ui-expanded.png`: real base-ui launch controls, with optional customization.
- `live-base-ui-template.png`: actual base-ui template dropdown inside the modal.
- `live-network-shell.png`: restricted DNS/network toolbox and reconnect to the same shell PID.
- `live-distroless-exec-recovery.png`: genuine missing-shell error with explicit recovery.
- `live-completed-session.png`: retained completed container without reconnect.
- `live-elevated-review.png`: explicit elevated-profile consent; no privileged launch was performed.
- `live-image-failure.png`: actual image-pull failure; waiting entries offer inspection, not a misleading reconnect.

These captures are point-in-time evidence, not the simulated prototype. Production uses shared base-ui components and theme tokens. The prototype's dedicated Ctrl+Alt+D shortcut and extra inspector/event affordances are not claims about the shipped scope; keyboard access was verified through the actual command palette.
