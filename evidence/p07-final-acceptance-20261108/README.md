# P07 final acceptance evidence (2026-11-08/09)

Raw outputs behind [`docs/roadmap/2026-11-08-ri-p07-final-acceptance.md`](../../docs/roadmap/2026-11-08-ri-p07-final-acceptance.md) for [omniview #85](https://github.com/omniviewdev/omniview/issues/85). Host base: `origin/main` `38867c35b819f2283900ce54109c86d5bb028c59`. Home-directory paths were replaced with `~`. Files that combine several outputs add `$ command` or `#` header lines between them, and `e2e-harness-run.txt` cuts each output line at 400 characters (the complete facts are in `e2e-schema-catalog-facts.json`). Nothing else was edited.

| File | Command or source | Receipt section |
| --- | --- | --- |
| `host-main-catalog-race.txt` | `GOWORK=off GOFLAGS= go test -race -count=1 -v ./backend/pkg/resourcecatalog/...` on a clean tree at `38867c35` | E1 |
| `host-main-resource-schema-catalog-native-child-race.txt` | `GOWORK=off GOFLAGS= go test -race -count=1 -v -run 'Schema\|Editor\|Catalog\|ActualSDKChild' ./backend/pkg/plugin/resource` on a clean tree at `38867c35` | E2 |
| `sdk-v0.18.0-schema-contract-tests.txt` | SDK schema-contract tests run through the host module | E3 |
| `ui-vitest-schema-consumers.txt` | `pnpm vitest run` for the Monaco registry and `useEditorSchemas` tests | E4 |
| `host-pr-new-acceptance-race.txt` | `go test -race -count=1 -v -run 'TestAcceptance\|TestCatalogImportBoundary' ./backend/pkg/resourcecatalog/` | E5 |
| `host-pr-catalog-race.txt` | the full catalog suite again, with this change's tests | E5 |
| `host-pr-resource-schema-catalog-native-child-race.txt` | the E2 command again, now including `TestEditorAssociationIdentityIsScopedAndRevisionStable` | E5 |
| `mutation-sensitivity.txt` | `go test -overlay` runs with six deliberate production faults | E6 |
| `host-benchmarks.txt` | `go test -run '^$' -bench . -benchmem -count=3 ./backend/pkg/resourcecatalog/` | E7 |
| `live-kubernetes-report-run5.txt` | complete report of the live run: catalog, overlay, admission per type, control, served-document comparison, sweep, coverage probes, two-connection isolation | E8 |
| `live-kubernetes-admission-table-run5.txt` | per-type admission table, corrected, control and model representation | E8 |
| `live-kubernetes-determinism-run4-vs-run5.txt` | diff of two runs in separate processes | E8 |
| `live-kubernetes-provenance.txt` | versions, plugin source quotes, build and cluster commands, cleanup | E8 |
| `live-kubernetes-harness.go.txt` | source of the temporary harness test (`.txt` so it is not compiled; it needs a plugin binary and a cluster) | E8 |
| `e2e-harness-run.txt` | toolchain, clone, Playwright result lines, repeat run, the earlier failed attempts | E9 |
| `e2e-harness-invocation.json` | the harness's own invocation report (phases, budget, launch drain) | E9 |
| `e2e-schema-catalog-facts.json` | the facts the spec logged from the real application | E9 |

The live harness and the e2e run executed outside this tree, in isolated clones that were deleted afterwards, so they cannot be re-run from this change alone. They need a built Kubernetes plugin binary at the host gitlink pin and a kind cluster (E8), or node v26.13.0, pnpm 12.14.0, go1.27.0 and the harness's full setup (E9).
