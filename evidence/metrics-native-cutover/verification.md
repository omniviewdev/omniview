# Native metrics cutover verification

Status: implementation checks passed; integrated IDE acceptance is blocked. No PR or merge.

## Actual source execution

An isolated Go overlay smoke executed the new native provider against the existing local `kind-omniview-load-lab` cluster with metrics-server v0.8.0. It used the fixture's private kubeconfig and actual Pod UIDs, not synthetic metric responses. The probe's HTTP transport counted metrics API requests and captured the fully consumed namespace response.

| Observed quantity | Count |
| --- | ---: |
| Requested actual Pods | 24 |
| Requested metrics per Pod | 2 |
| Complete successful measurements | 48 |
| Native provider executions | 1 |
| Metrics API namespace LIST calls | 1 |
| Scanned namespace metric objects | 30 |

Every delivered measurement retained a non-null source timestamp and positive source window. The SDK response validator accepted the result. This is direct provider proof, **not** an installed-plugin host/RPC or UI claim. Idle measured CPU zero remains valid.

The fixture's read-only verification separately measured all 30 Ready Pods. Installation and verification commands are documented in the Kubernetes repository's `hack/kind-lab/README.md`; credentials remain private and ignored.

## Contract and regression checks

- SDK: full Go suite passed; independent review approved exact commit `7e3f2c5caca1fce25b34ad91a29382398db1d104`.
- Host: full Go suite passed (60 tested packages); finite coordinator and preference race regressions passed.
- Kubernetes backend: full Go suite passed (11 tested packages); native race regressions and three manifest-parser cases passed.
- Runtime: 442 tests passed, using the actual generated Go transport error corpus.
- Host TypeScript projects passed.
- Local base-ui metrics, runtime, Vite plugin/shim checks, and Kubernetes production UI builds passed. Managed workspace builds also completed both plugin producers and all shared-package producers.
- Controlled host subset/token/cache regression delivered table and sidebar subsets through one provider invocation. This controlled count is not an observed production RPC count.
- Kubernetes UI: 1,714 tests passed; three existing tests skipped. Scoped changed-component lint, production TypeScript, and production build passed.

## Remaining acceptance

Actual installed-plugin screenshots, host/provider-RPC counters, table/sidebar source agreement, and preference restoration across an actual IDE restart remain unverified. Unit/component persistence checks do not replace that proof.

The CLI-created, explicitly SDK-opted-in workspace passes preflight. Managed browser launch fails at the host frontend producer:

```text
host-frontend: preexisting producer output is not a clean tracked baseline: .
```

The existing host `dist` contains only its tracked empty `.gitkeep`. Moving the placeholder aside instead produced an uncommitted `.gitkeep` error; the original directory was restored. Documented `workspace refresh` hit the original failure. Static browser mode also failed with `host-frontend: owned cache changed while stopped`. No admission guard was bypassed and no CLI source was changed. CLI issue reports were recorded locally.

Issue #411 remains open until actual IDE proof is complete.
