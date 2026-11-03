# P07 / C05: merged correction and source-cohort receipt

Status: merged correction checks passed. The canonical Kubernetes pin awaits this PR's user merge. This receipt does not declare full P07, C04, P12, P14, or P15 acceptance.

Issue: [omniview #85](https://github.com/omniviewdev/omniview/issues/85).

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

This proof used a disposable candidate workspace, not merged sources. Its host was
`2f17b9ac364e8d4c0d4b06e360c804a3ecc142f5`, SDK was
`d576a1516b29049466b56bf67aa65eb4766a358d`, Kubernetes was
`fcd3d88cd5491007888a1210df48db222dee8d61`, UI was
`5af0ec923a605aba5e6e3571d639f6238095804c`, Flux was `b9e4fd14`,
and Proxmox was `07a37c5`. The host candidate changed after this proof.

The Pod YAML editor displayed schema documentation for `apiVersion`. Completion
at `spec.serviceAcc` included the registered Pod schema property
`automountServiceAccountToken`; the UI did not identify the suggestion provider.
An unsaved `status.startTime: 42` produced the Monaco diagnostic
`Incorrect type. Expected one of null, string.` Changing the value to `null`
cleared that marker. The registered Pod schema permits unknown properties, so an
unknown field did not produce a diagnostic.

The Event table showed new scratch Deployment events without a reload. The scratch
namespace was deleted, and a subsequent Kubernetes get returned `NotFound`.
These observations do not replace the historical measurements above or establish
the final merged-source smoke proof.
