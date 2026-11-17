# `ui-next/k8s/`: temporary scaffolding for the Kubernetes plugin

Omniview is a general-purpose IDE. **Kubernetes is a separate plugin and is never worked into the core.**

This directory is **temporary slice scaffolding**. It stands in for the Kubernetes plugin until the plugin's own `ui-next` stream exists (decision A13, tracker row N19). It is plugin code, written to move:

- It **moves into `omniview-plugin-kubernetes`** (its `ui-next` stream). It is moved, not rewritten: the row model, the Pod definition and the hooks in here are plugin code and keep their shape.
- It is **deleted from the host before the calibration gate closes slice 1.** After that the host tree holds no Kubernetes code, and the Pods list renders from the plugin.

## The rules while it lives here

1. **The host and the kit never import it.** Nothing in `packages/kit/**`, and nothing in the shell part of `ui-next/`, may import from `ui-next/k8s/**` (or from the Pods page, `ui-next/pods/**`, which is scaffolding too). The one exception is the single mount point of `?screen=pods` in `ui-next/main.tsx`, marked `SCAFFOLDING(N19)`.
2. **It imports the host only through what a plugin gets:** the runtime hooks (`@omniviewdev/runtime`, main entry) and the kit (`@omniviewdev/kit`, `@omniviewdev/kit/styles.css`). No shell internals, no `ui/`, no raw RPC (`@omniviewdev/runtime/api` holds `ResourceClient`, `/runtime` holds `Call`), no Wails binding. It reads only through the fenced hooks (`useResourceTypes`, `useResolvedResourceTarget`, `useResources`, `useConnectionReadiness`).
3. **No Kubernetes word leaves it.** The kit and the shell stay free of pod, namespace, kubectl, kubernetes and k8s (the vocabulary guard).

Rules 1 to 3 are enforced by `kit/scaffold-boundary` and the vocabulary guard in `packages/kit/eslint`, each proven by failing probes; `docs/ui-next/AGENTS.md` rule 15 states the principle.

## What is in here

| File | What |
|---|---|
| `pod.ts` | The part of a Pod the list reads, and the decoder from a record body (`Value`) to it. |
| `status.ts` | kubectl's STATUS word (a port of the API server's `printPod`, v1.35) and the seven-role table of the mock. |
| `fields.ts` | Ready, Restarts, Age, Node, IP and the generated-name tail, each derived from the object. |
| `row.ts` | `PodRow`: one row per `HostRecord` object, computed once (a `WeakMap`), keyed by the host key. |
| `sort.ts` | The column comparisons of the mock; a missing value is always last. |
| `definition.ts` | The Pod definition: columns, list rules, quick filters, facets, and one display function per field that answers a `Cell`. |
| `fixtures/pods-table.json` | Real Pod objects and the cells kubectl's server printed for them, from one kind v1.35 cluster: the oracle of `golden.test.ts`. |

The data hook, the connection states and the acquisition rule of the bounded first set are described in `docs/ui-next/status/1a.2.md`.

## Moving it

1. Copy this directory into the plugin's `ui-next` stream. Its imports already name only `@omniviewdev/runtime` and `@omniviewdev/kit`, so no import changes.
2. Delete `ui-next/k8s/` and `ui-next/pods/` from the host, and the `SCAFFOLDING(N19)` lines in `ui-next/main.tsx`.
3. Remove both directories from `PLUGIN_CODE` and `SCAFFOLDING` in `packages/kit/eslint/scaffolding.mjs`. The vocabulary guard then covers the whole host tree.
