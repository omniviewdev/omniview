# Table bench corpus

The table bench measures the kit's `DataTable` on real Pod rows. This directory makes them and checks them.

| File | What |
|---|---|
| `corpus.sh` | Builds a kind cluster, applies the fixture, scales it, exports the Pods three times (25, 1,025, 5,025). |
| `podRows.mjs` | `podRowsFromList(list)`: a `kubectl get pods -A -o json` PodList to rows `{ key, name, namespace, nameTail, ready, status: {word, role}, restarts, createdAt, node, ip }`. |
| `podRows.test.mjs` | The oracle test: the rows must equal what `kubectl get pods -A --no-headers` prints. |
| `updates.mjs` | `createUpdates(spec).apply(rows)`: the seeded sparse live-update workload of `bench/render/fixtures/updates.ts`, on rows, pure. |
| `updates.test.mjs` | Determinism, identity of unchanged rows, the ledger after 100 events. |
| `pods-table.golden.json` | A copy of `ui-next/k8s/fixtures/pods-table.json` of row 1a.2 (sha-256 `6c341fe2…de9dc1`): two responses of a real kube-apiserver v1.35.0 with each Pod object and the cells the server printed for it. Delete it and point the test at the original once 1a.2 is on this branch. |

## What the corpus is

`kubectl get pods -A -o json` of one kind cluster (kindest/node v1.35.0, one node), at three sizes. Each size has two files in the output directory (`${TMPDIR:-/tmp}/ui1a3-table` by default):

| Size | Files | How the count comes about |
|---|---|---|
| 25 | `pods-fixture.json`, `pods-fixture.kubectl.txt` | The fixture (`docs/ui-next/slices/1a-pods-list/fixture.yaml`): `checkout` 10, `batch` 4, `monitoring` 2 = 16 Pods, plus the cluster's own `kube-system` 8 and `local-path-storage` 1. |
| 1,025 | `pods-1025.json`, `pods-1025.kubectl.txt` | The 25, plus 1,000 replicas of Deployment `scale-probe` in namespace `scale`. |
| 5,025 | `pods-5025.json`, `pods-5025.kubectl.txt` | The 25, plus 5,000 replicas of the same Deployment (`kubectl scale`). |

Plan `docs/ui-next/slices/1a-pods-list.md`, appendix A.7, has the first measurement: 1,025 Pods after 49 s, 5,025 after 4 min 51 s. The `scale-probe` Pods carry `nodeSelector: {does-not-exist: "true"}`, so every one stays Pending: real objects, no kubelet cost.

The 5,025 run of 2026-11-16 holds 5,002 Pending, 19 Running, 3 Completed, and one each of Error, CrashLoopBackOff and ImagePullBackOff (the fixture's failing Pods). It is a file of 28.8 MB; `pods-1025.json` is 6.0 MB.

## Regenerate

```sh
bench/table/corpus/corpus.sh                                   # cluster ui1a3-table, files in ${TMPDIR:-/tmp}/ui1a3-table
bench/table/corpus/corpus.sh --cluster mine --out /tmp/corpus  # other names
kind delete cluster --name ui1a3-table                         # the script leaves the cluster running
```

Needs `kind`, `kubectl` and a container runtime. About 7 minutes, most of it the scale-up to 5,000. The script never touches the default kubeconfig: it unsets `KUBECONFIG`, writes kind's kubeconfig under the output directory (or `--kubeconfig`), and every `kubectl` call names the file. It checks the three counts, and prints the line count and sha-256 of each file at the end.

A regenerated corpus differs in every uid and timestamp, so the hashes differ from run to run. They record which run a measurement used. Do not commit the files: they are 35 MB together.

Point the tests and the bench at another directory with `TABLE_CORPUS_DIR`.

## Check

```sh
node --test bench/table/corpus/
```

- `podRows.test.mjs` always compares the rows of the two golden responses with the cells the server printed. When the corpus files exist (`TABLE_CORPUS_DIR`, else `${TMPDIR}/ui1a3-table`, else `/tmp/ui1a3-table`) it does the same for every Pod of each size; without them those three tests are skipped, with the missing path as the reason.
- What is compared, per Pod: Ready, Status, Restarts, and Age. Age is compared by kubectl's own label rule (`HumanDuration`): the rows hold the instant `createdAt`, kubectl prints a label of it (`6m12s`), so the test searches for one second at which the label of every Pod's `createdAt` equals what kubectl printed. The golden test also holds that second within 2 s of the server's `Date` header.
- Where the data layer and kubectl differ on purpose, the test says so (`DOCUMENTED`, copied from the data layer's golden test): a native sidecar is not counted in Ready, an init container's restarts are not counted in Restarts, and a Pod with no container status yet has `restarts: undefined` where kubectl prints 0.
- The JSON and the text of one size are two `kubectl` calls a moment apart. A Pod that restarts between them (a crash loop) fails the comparison once; regenerate, or rerun against the next export.

## The workload (`updates.mjs`)

One `apply(rows)` is one event of `recordsPerEvent` Pods drawn uniformly from the current rows. Touches count from 1 across events: every `recreateEvery`-th is a recreation (same name and namespace, new key, `createdAt` + 1 h, 0 restarts, Running, appended at the end), the other even touches restart (+1), the other odd touches flip the phase (Running and Pending, with Ready and the role). With the defaults (2 Pods, every 10th) 100 events are 200 touches: 20 recreations, 80 restarts, 100 phase flips. Rows that are not touched keep their object identity. The caller owns the clock; `eventsPerSecond` is validated and not used otherwise.

## What a copy of a real shape is not

The rows are derived from real objects and the oracle checks them, but a measurement on them is **diagnostic, not identity** (`bench/app/real-resource.mjs`):

- The 5,000 `scale-probe` Pods are copies of one shape. They share every name stem, one image, one namespace, one Pending state, and they have no node, no IP and no container status, so `node`, `ip` and `restarts` are undefined in 5,000 of 5,025 rows. A real cluster of that size has more variety in all of them (distinct node and address columns, restarts, mixed states), and the table's width and fit measurements depend on that variety.
- Names carry random suffixes of the cluster that made them; ages are minutes, not days.
- A kind cluster is one node. The `Node` column has one value.
- Live updates are the seeded workload, not a cluster's own event stream: the timing of events, bursts and the real distribution of which Pods change are not modelled.

A number from this corpus compares two builds of the table on the same machine and the same day. It does not stand for a user's cluster.
