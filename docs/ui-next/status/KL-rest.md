# KL-rest · Where can a plugin extend the UI?

**Gates 1–3 implemented on the production branch; not released.** Building an extension is not permission to use it. The host admits verified installed artifacts, then checks explicit profile consent per binding.

**Verification:** 172 runtime tests and nine packager conformance tests passed. A separate offline consumer built an owner and a route-less contributor using packed SDK, Vite plugin and owner contract packages. The unchanged Kubernetes UI type-checked against the packed runtime.

**Gate 2 verification:** A real packed route-less plugin went through signed registry installation. The native manager returned the exact compiled scalar and view bytes for its active generation. Focused host tests passed (145), both TypeScript projects checked, and the ordinary `pages` seam passed in WebKit and Chromium. Profile-policy tests passed on macOS and under the Linux race detector. The Windows policy tests cross-compiled; they did not run on Windows.

**Gate 3 verification: owner-hosted sidebar views.** Two independently packed, signed plugins exercised the production Wails server in WebKit and Chromium. A sidebar press drew the contributor inside the owner frame without adding a tab. Back and Forward traversed the same tab, middle-click added a background tab, and replacing the profile policy removed both the leaf and the mounted Body. This was a Linux server-mode check, not a macOS desktop-window test.

The real-host check exposed a startup race: the first plugin list could start before the event socket connected. The host now cancels that pending query before requesting a subscribed inventory. No demo plugin, profile grant or CI job ships with this gate.

**Next gate:** contextual placements and their data boundaries. The remaining native interaction results below describe the experiment, not production coverage.

## The four clicks to review

| As a user, I… | What should happen | Where the previous design stopped |
|---|---|---|
| Right-click a Pod terminal | Its ordinary menu stays. Eligible peer items join it using approved facts about **this session's** resource. No match means no item. | Only an Overview information menu existed. A terminal menu is a different invocation site; terminal access is a different permission. |
| Select a contributed Deployment tab | The same Deployment, sidebar and shell tab stay selected. The peer fills only the detail panel. | Conditional tab discovery worked natively. The experiment could return text, not a rich panel. |
| Click **Kong Admin** under Kubernetes → Extensions | Keep Kubernetes selected and its tree visible. Select Kong Admin in that tree. Replace only the main content and push one entry onto **this tab's** history. | The experiment opened the peer's standalone page. That was the wrong navigation contract, not a successful embedded-page test. |
| Select **Topology** on a Service | Inside that Service, show incoming references and outgoing targets. Distinguish known-empty, unavailable and partial data. | A text tab could neither render the interactive view nor authorize its reads. The tab itself grants no access to related resources. |

### The navigation invariant

```text
Same Kubernetes shell tab      Rail / tree                 Main area
─────────────────────────      ───────────                 ─────────
Before                         Kubernetes / Deployments    gateway-sample · Overview
Click Kong Admin               Kubernetes / Kong Admin     Kong Admin · contributed view
Back                           Kubernetes / Deployments    gateway-sample · prior view
Forward                        Kubernetes / Kong Admin     Kong Admin · contributed view
```

**Location belongs to the owner; content belongs to the contributor; authority belongs to neither by implication.** The host keeps connection scope for routing. It does not hand the contributor the connection object or Kubernetes credentials. Opening another plugin as a destination is a different user intent, not a fallback when embedding fails.

## When does this require a release?

| Change | Who releases? |
|---|---|
| Add another item, tab or view to an already published compatible point, using approved facts and reads | Contributor only. Operator may still need to approve the binding and its grants. |
| Expose a new owner-controlled location, public attribute or domain read | The owner publishes that contract once. Subsequent peers reuse it. The host does not learn Kubernetes or Kong vocabulary. |
| Add a new native interaction primitive or privileged operation | The host or capability owner must design and enforce it first. A terminal menu item is not authority to inject input, run a process, or mutate a workload. |

Prefer a reusable family of owner-declared detail outlets over a contributor-specific slot per resource kind. Prefer a named, bounded relationship read over handing out a resource store. Built-in and peer Topology views can use the same owner contract; neither should infer live traffic merely from a Service selector.

## Implementer reading order

1. [Four worked scenarios](../slices/extension-view-scenarios.md) — trace placement, data source, denial, and expected user behavior.
2. [Author API and wire reference](../slices/extension-api-v1.md) — point declarations, typed bindings, artifact layout, and independent author workflow.
3. [Runtime contract and negative cases](../slices/extension-runtime-v1.md) — route identity, grants, cancellation, ordering, and release conformance.

The API and runtime references are normative for this proposal. The brief describes user-visible acceptance. If they disagree, fix the documents before coding. Existing v1 plugins without extensions must keep working. Do not port the legacy registry or experimental packages.

## Proof we have — and proof still owed

Five warm foreground runs used real Pod and Deployment records. Matching resources showed the information tab/action; unlabelled and differently labelled controls did not. Action results matched API-server UIDs. Independent offers shared a menu; individual grants could be narrowed or revoked. Discovery did not execute providers to obtain their labels.

| Prior native interaction | Samples | Click → DOM | Click → first animation callback |
|---|---:|---:|---:|
| Text detail tab | 10 | 1–2 ms | 1–17 ms |
| Open information menu | 10 | 1–2 ms | 4–16 ms |
| Select information action | 10 | 1–2 ms | 7–9 ms |
| **Superseded** cross-plugin sidebar navigation | 5 | 2 ms | 7–8 ms |

These are not cold-start or physical paint measurements. Hidden WebKit parked frame callbacks; a hidden selection took 118 ms once.

The subsequent native experiment proved owner-hosted sidebar navigation with Back/Forward in one tab, independent rich Deployment panels, and a conditional item on a real Pod shell. A Service Topology panel matched independent API-server records; withdrawing the read grant removed its rows without removing the panel. Those proofs establish feasibility, not production acceptance. Repeat them on the production loader and authority path before release.

### Gate 4 production checks

Gate 4 passed on foreground macOS WebKit. Host `91b0a3a66627`; signed Kubernetes owner `sha256:0d48207da13c9f51fd4368c9a17ebd59087b30542b1b663087d51bb875332659`. The corrected provider requests `PartialObjectMetadataList` for Pod lists; the original metadata negotiation returned HTTP 406 on Kubernetes 1.35.

Native captures: [Deployment tabs](KL-rest-evidence/04-deployment-kong.png) · [authorized Service topology](KL-rest-evidence/12-topology-authorized.png) · [clicked terminal on a different page](KL-rest-evidence/22-terminal-managed-body-other-page.png). The API audit also confirmed reads stopped after teardown. These are functional checks, not Gate 5 latency measurements.

| Question | Evidence |
|---|---|
| Can a menu open a different contributor without leaving the owner workspace? | `PluginHost.sidebarMount.test.tsx` exercises owner-hosted navigation, destination authorization, replacement and history. |
| Can several contributors share a detail surface? | `PluginHost.detailOutlets.test.tsx` covers ordering, quota, focus and withdrawal; both host placement suites passed (28 tests). |
| Does denial leak a neighbor's existence? | The native read and Kubernetes provider tests compare hidden and absent neighbors. Coverage cannot depend on discovering a denied object. |
| Can stale authority survive a window reconnect? | `TestWindowRealmRefusesChangedBrowserClientWithoutEvictingLivePage` rejects the second client without revoking the first. |
| Does a terminal menu grant provide shell access? | No. Native code binds the clicked attachment and current resource; the feature receives approved scalars, not terminal I/O. |
| Can independent contributors build without host source? | [Packed consumer evidence](KL-rest-evidence/external-consumers.json): `gateway-tools` and `workload-summary` type-checked with networking disabled. Their compiled feature modules have no imports; view modules import only the kit and React JSX runtime. |

These are production-path test results, not measurements of foreground responsiveness. Release the Go SDK before building a distributable Kubernetes plugin against it. Do not ship a local module replacement, test contributors or proof grants.

## Delivery gates after approval

1. **Freeze and publish contracts.** One public SDK entry, one canonical metadata decoder, packed owner contracts with package/version/named export. A clean-room consumer must compile without host imports. No shared legacy barrel.
2. **Admit and authorize.** Validate static metadata before binding. Deny by default. Match only declared, requested and granted facts. Fence every response to the active owner object, contributor generation and policy. No page code just to populate a menu.
3. **Prove navigation first.** Replay the four navigation steps above. Check existing sibling tabs, explicit new-tab gestures, restore, revocation and unload. Never silently redirect to the contributor's rail or lose Back/Forward.
4. **Prove views and reads.** Add conformance for simultaneous offers, conditional rich tabs, right-clicking a different session, directed relationships, incomplete permissions and same-name object replacement. Keep keyboard focus and owner content stable. Verify teardown stops work.
5. **Run native, then release.** Compare absent, installed-but-inactive, first-use and warm paths on equivalent objects. Record owner readiness separately from peer readiness, feature evaluations, and foreground frame cadence. No new PR job or wall-clock unit assertion. Use existing seam/nightly checks and type-check a real independently built consumer against the packed runtime.

Keep the test fixture small and test-only. Do not ship the sample integrations, profile grants, or a global service bus. Production rollout needs disable/revoke and recovery without rebuilding a plugin. Other KL-rest work remains held. See [the original seam](../slices/n19-plugin-seam.md) and [owner decisions](../decisions.md).
