# P07 / C05: merged correction and source-cohort receipt

Status: merged correction checks passed. The canonical Kubernetes pin awaits this PR's user merge. This receipt does not declare full P07, C04, P12, P14, or P15 acceptance.

Issue: [omniview #85](https://github.com/omniviewdev/omniview/issues/85).

## Targeted schema ownership cutover (2026-11-10)

The coordinated architecture cutover supersedes schema-bearing support catalogs
and bulk editor enumeration, not the P07/C04 safety guarantees. Operational
representations identify only body format ID and revision. Optional
`ResolveSchema` demand names one explicit representation or exact auxiliary
resource/key/source revision. The existing host normalizer/store owns that target,
coalesces its work, retains bounded exact-reference/dialect success associations,
and revalidates demand after 30 seconds. Unrelated support observations preserve
unchanged schema entries; schemas never rotate native/source/authority identity.

The public editor boundary is one `ResolveEditorSchema(pluginID, SchemaRequest)`
bundle. Public/broker raw-document reads require an independently admitted target
whose current binding names the exact reference, plus final generation and access
revalidation. A document digest is content identity, never a grant. Frontend model
URIs exist before enrichment and remain independent of schema content/revisions.
Field navigation and typed authoring reuse the same target observation; current
schema-dependent privacy and typed claims still fail closed.

Historical measurements and cohort proofs below remain historical. This cutover
does not inherit their passing status or claim fresh checks, live-cluster results,
UI continuity, memory improvement, or complete P07/C04 acceptance. The integration
owner runs the targeted tests and coordinated source-cohort gates.

### Packed source accounting

Retained source ownership charges the encoded body and owned headers, metadata,
canonical keys and member lifetime, not a decoded tree that is no longer stored.
Decoded frames, protobuf construction and output scratch retain independent
transient limits. No memory ceiling is raised to admit larger collections.

Snapshot and change preflight computes each member's retained/transient costs
once, before constructing keys or packed members. Bounded frame-local cost
storage is consumed by packing, not retained as a cache. Whole-observation SDK
validation, selected binding/authority/generation admission, atomic batch
preflight and final encoded-body/header reservation checks remain mandatory.

### Demand ownership and release readiness

Source views and mounted graph observations own their admitted work. Optional
relationships do not delay connection readiness or start browse-only population
sources. Explicit provider `AcquireOnConnect` advertisements retain native
connection-lifetime ownership; closing a browser owner releases only that owner's
interests. Replaced source members keep old packed bodies and headers charged
until the last snapshot, queued delivery or demanded graph projection releases
them.

The release integration uses resource wire 3 and host callback broker 2. Utilities
remain independently wire 2 and the process protocol remains 1. The host requires
published SDK `v0.20.0` and keeps the scoped grpc-go consumer replacement. The
published-SDK policy still requires the real released module and go.mod checksum
row; source-cohort builds do not establish that published-mode trust.

Native acceptance remains separate from browser-server readiness. The prior
browser capture had healthy native connection/source counts and completed Open
and initial Sync RPCs, but no accepted initial frontend snapshot. The pinned Wails
default server bridge provides no verified dispatcher/broadcaster readiness
acknowledgement for the exact browser client. Native runtime readiness, HTTP
readiness and logical window lookup do not prove that event-delivery boundary.
This integration neither claims that stall is fixed nor substitutes retries,
timers, longer limits or fallback native ownership. The earlier native test build
predates current-main integration and is not release acceptance.

## Exact sources

| Component | Actual merged revision |
| --- | --- |
| Approved C05 contract, host #342 | `9b5a75cb5259cb3659d15fee4466217ac040a3c0` |
| Host correction, #362 | `e1ac997988b96fe8f102eb8f571d990f2bcba6b9` |
| SDK #44 | `458597dc74be0a203d7b1e602c1c35f02e5d3f54` |
| Kubernetes #88 | `3f89634305b6b7c57a00d68057c155f56be3f103` |

The Kubernetes merge has the same source tree as reviewed PR head `337d3f8a7bac3c508c0a5fa87d5224fddb615e45`.

This PR replaces that PR-head pin in both `e2e/source-cohort.json` and the `plugins/kubernetes` gitlink. SDK `458597dc` and UI `cef053786d7817e70f26e8558bdb984bfac09c91` stay unchanged. No production code, source guard, isolation checkpoint, approval variable, or secret changes.

## Host admission proof

An independent review cleared the late admission and workflow changes between reviewed host `7562b1ed` and final PR head `dd467e67`. The review covered collection comparisons, error precedence, shared work limits, cancellation, test coverage, and CI source guards.

The merged host passed:

```sh
GOWORK=off GOFLAGS= go test -race -count=1 ./backend/pkg/resourcecatalog/...
```

`resourcecatalog` passed in 32.899 seconds. `resourcecatalog/celtypes` passed in 5.403 seconds.

A separate executable exercised the public catalog, observation, entry resolution, and admission APIs. It produced these results:

| Scenario | Actual result |
| --- | --- |
| Definite `oneOf` overlap | `INVALID_REQUEST`: value matches more than one branch |
| Exact collection enum with localized coverage | Accepted; no unavailable paths |
| Uncertain missing key | Accepted with unavailable root path `""` |
| Limited list index | Accepted with unavailable path `/x` |

These results preserve definite present-data errors without treating missing data as definite.

## Public Kubernetes proof

A temporary harness exercised `resource.Register`, the real SDK transport implementation, connection load/start, catalog acquisition, and `GetSchemaDocument`. A controlled HTTP server supplied discovery and schema data. No cluster or native runtime was used.

The corrected harness passed under the race detector:

```sh
GOWORK=off GOTMPDIR=/dev/shm/ri-c05-go-tmp \
  GOCACHE=/dev/shm/ri-c05-go-cache GOFLAGS=-p=2 \
  go test -race -count=1 -v \
  -run '^TestMergedPublicProviderProof$' ./pkg/plugin/resource
```

The public provider served 451 bytes. The digest matched both the catalog binding revision and the document revision:

```text
7c9b68dbd77714b1ba1488da01809df39bbd13e0cf5e279ce8dc54cbd191bd97
```

The proof checked nullable Time and MicroTime, exact-case schema aliases, unrelated bytes, and large-integer lexemes.

The earlier resource race attempt showed no failures in existing tests, but its overall result failed on a temporary settings fixture. An initial link attempt also failed because the disk was full. Only the harness changed before the successful public proof. This receipt does not label the failed overall attempt as a passing suite.

The temporary sources, kubeconfig, and owned scratch were removed.

## Source selection and remaining gates

All seven source-selection guard tests passed:

```sh
ASDF_NODEJS_VERSION=26.13.0 node --test e2e/scripts/candidate-source.test.mjs
```

The integration coordinator owns the final cohort pin, review, and CI. The user alone merges this PR. The full P07 acceptance matrix remains in the approved C05 contract; this bounded receipt does not replace its other requirements.

Historical live evidence remains separate: 189/189 corrected-schema admissions and 189/189 raw-schema rejections belong to their original source cohort. The earlier failed 185-Pod sample remains failed. The new 451-byte controlled fixture is not a fresh live-Pod, native UI, or P13 result.

C04 still requires the user's merge of [grpc-go #1](https://github.com/omniviewdev/grpc-go/pull/1), followed by the actual merged-fork pin and fresh SDK proof. No development fork pin is released by this PR.

## Live cohort verification (2026-11-03)

This proof used the disposable workspace `c04-final-proof` with native MCP on
port 9112. Its host was `2f17b9ac364e8d4c0d4b06e360c804a3ecc142f5`, SDK was
`d576a1516b29049466b56bf67aa65eb4766a358d`, Kubernetes was
`fcd3d88cd5491007888a1210df48db222dee8d61`, UI was
`5af0ec923a605aba5e6e3571d639f6238095804c`, Flux was `b9e4fd14`,
and Proxmox was `07a37c5`. The SDK, UI and Flux revisions were merged; the host,
Kubernetes and Proxmox revisions were candidates. The host changed after this proof.

The earlier gate statements describe the original PR's state. The canonical pin
merged as `23fb11eb`, and grpc-go #1 merged as `4c6f1d1c`. They no longer await
merge.

The Pod YAML editor displayed schema documentation for `apiVersion`. Completion
at `spec.serviceAcc` included the registered Pod schema property
`automountServiceAccountToken`; the UI did not identify the suggestion provider.
An unsaved `status.startTime: 42` produced the Monaco diagnostic
`Incorrect type. Expected one of null, string.` Changing the value to `null`
cleared that marker. The registered Pod schema permits unknown properties, so an
unknown field did not produce a diagnostic.

The editor observations used the native MCP DOM and JavaScript tools; the edits
were not saved.

The Event table showed new scratch Deployment events without a reload. The scratch
namespace was deleted, and a subsequent Kubernetes get returned `NotFound`.
These observations do not replace the historical measurements above or establish
the final merged-source smoke proof.

On 2026-11-04, candidate host `bf47c022f957eb9ace7770e75e39ebfd9b2fab1a`
used the same SDK, Kubernetes, UI, Flux and Proxmox revisions. Pod,
`events.k8s.io` Event and ReplicaSet sources were following with 192, 873 and
141 records respectively;
the corresponding `kubectl` counts matched. The catalog initially remained
pending and idle. An explicit query refetch and route navigation recovered it.
The Pod YAML preview opened, but hover did not appear. Editable-editor hover and
worker inspection were not checked on this host. This was not a fresh
schema-admission measurement or a merged-source proof.

The repinned candidate used host `300fa9a99af58edb257e2d65947d52e62492a808`,
SDK `57f8b8bf4f761b44ebb33dea478a9e68c1d02049`, Kubernetes
`67f0513e5094ea788bb96cf1d01b48a067b1951b`, Proxmox
`eed8a71cae990dfe6b6be1e35337eca21e3ab74f`, Flux
`c0409e1072260584519474133e5331414a6cbc4b`, and UI
`5af0ec923a605aba5e6e3571d639f6238095804c`. The catalog opened without a
refetch. Pod, core Event and ReplicaSet sources were following with 190, 170
and 141 records; contemporaneous `kubectl` counts matched. An editable
standalone scratch Pod YAML showed the `apiVersion` schema description on
hover. No edit was saved. The scratch namespace was deleted, and a subsequent
get returned `NotFound`. This is candidate evidence, not merged-source proof.

The later candidate used host `496156d4cf1c15d11d3d08324eaf3fcbc9df0c81`,
SDK `427ef1da1f1db4f5787d384af3ae183ff31b0cd3`, Kubernetes
`a92b947d9568ccf5bf2f5fb810a7ade74ea45492`, Proxmox
`6feac2c9dab94e91517674d9dac8ecfc39f47864`, Flux
`b2c4588e90d1c233d5340e43cdba406aa461bd41`, and the same UI revision.
Pod, core Event and ReplicaSet sources were following with 190, 187 and 141
records; contemporaneous `kubectl` counts matched. The catalog initially waited
for more than 90 seconds; Home-to-Open navigation recovered it without an
explicit refetch. Editable scratch Pod YAML showed the `apiVersion` schema
description on hover. No edit was saved. The scratch namespace was deleted,
and a subsequent get returned `NotFound`. This is not merged-source proof.

The activity-integrated candidate used host `98a08390629bdb871743d9cb6f46eb81b4813492`,
SDK `427ef1da1f1db4f5787d384af3ae183ff31b0cd3`, Kubernetes
`aa9999cce2d4cb77033d7fc46eab8ddeb7f3201d`, Proxmox
`0c8b8a5985c3d39822522297bfb6db714ef54a2d`, Flux
`cc0df91e3da116748e1f0aa4b4371dad7e5ea8a7`, and UI
`20cc1a7e881fc3986a37a7cf0de207059c28b71c`. Pod, core Event and ReplicaSet
sources were following with 190, 262 and 141 records; contemporaneous
`kubectl` counts matched. The catalog waited over 95 seconds before navigation
recovered it. Editable scratch Pod YAML showed `apiVersion` schema documentation
on hover. No edit was saved. The scratch namespace was deleted and a subsequent
get returned `NotFound`. Flux was not at its later merged SDK pin, so this is
not a final merged-cohort proof.

### Acceptance status

| Evidence or gate | Status |
| --- | --- |
| Canonical Kubernetes pin | Merged; source-selection guards passed on the merge. |
| Earlier candidate Pod editor and Event checks | Observed on `2f17b9ac`; completion provider not identified. |
| `bf47c022` Pod preview hover | Not observed; editable-editor hover and worker inspection remain open. |
| `300fa9a9` editable Pod hover | Observed with the repinned candidate cohort; no edit saved. |
| `496156d4` editable Pod hover | Observed with its candidate cohort; no edit saved. |
| `98a08390` editable Pod hover | Observed with the activity candidate; no edit saved. |
| `bf47c022` catalog startup | Pending/idle until explicit refetch and navigation; investigation remains open. |
| `496156d4` catalog startup | Waited over 90 seconds; navigation recovered it without refetch. Investigation remains open. |
| `98a08390` catalog startup | Waited over 95 seconds; navigation recovered it. Investigation remains open. |
| Unknown-field diagnostic | Not observed; the registered schema allows unknown properties. |
| Historical Pod admissions and resource measurements | Historical only; see the earlier receipt and original acceptance records. |
| Historical native worker and authority-URI checks | Historical only; not repeated for this cohort. |
| Fresh live Pod admission and merged-source smoke | Open. |
| Changed catalog and schema-wrapper coverage gaps | Not assessed by this proof. |
