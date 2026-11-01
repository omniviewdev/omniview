# Development CLI build-speed audit — 2026-10-31

## Scope and evidence

This audit covers the managed `dev-cli-build-speed-20261031` workspace only, based on host `e1fd7d7d44bbb312867b3d394341a34916fdf5c2` and independently reviewed SDK `5d0cc3dac81138ea87da1f94322873dde07aa9f2`. Its UUID is `0d1a3c74-caa9-4f98-bd80-98f613fb675f`. It selects host packages and SDK source, but no UI source or plugin. The canonical checkout is outside this change.

The filed observations in `/Users/joshuapare/Notes/omniview/omniview-dev-plugin.md` include a 157-second successful recovery, a 160.72-second source restart, and a 99.99-second host-only launch. Those are different source cohorts and workloads, not before/after samples for this patch. They justify investigating preparation and repeated launch cost, not a claim about which stage dominated.

Source inspection found a concrete repeated cost: every successful strict SDK verification started five separate `git show REVISION:PATH` processes, one for each protected baseline file. Verification occurs in build input fingerprinting and before/after actual Go producers; skipped plugin outputs also require fresh verification before artifact evidence is restored. These calls must remain independent observations. The selected SDK has 414 tracked Git entries (`git ls-files -z | tr -cd '\0' | wc -c`); the actual fingerprint includes eligible tracked and nonignored untracked files, not a fixed 414-file allowlist.

The SDK and build-input digest loops also used `io.Copy` separately for each regular file. That path can allocate generic copy scratch for every file. Merely supplying `io.CopyBuffer` with an `*os.File` would not fix this reliably: `os.File.WriteTo` can bypass the supplied buffer. Existing `internal/devoutputs/snapshot.go` already solves this using observation-local scratch and a reader-only wrapper. This change reuses that convention rather than introducing another cache or worker pool.

No whole-launch speedup is established. Integration subsequently built both implementations, ran actual SDK verification probes, exercised the managed launch loop, and ran the benchmarks below. Measured results and limits are recorded in the final verification section. The immutable baseline CLI was retained rather than rebuilt from patched source.

Integration subsequently reported this workspace's baseline first launch at 120.03 seconds and repeat launch at 72.46 seconds, with successful shutdown between them. Both reached authenticated readiness, current dependencies and served source, and connected HMR. Concurrent builds and implementation edits overlap these samples; they are execution evidence, not a clean speed comparison. Node phase `ready` does not prove a producer ran: `execute` emits the same phases for reused nodes. Inspect `build reuse:` diagnostics in the owned `supervisor.log` to distinguish a skip from compilation.

## Existing capabilities retained

| Area | Existing behavior and authority |
| --- | --- |
| CLI bootstrap | `task dev:cli:build` runs SDK-aware standard-library bootstrap, validates source selection, and builds through `scripts/devcli`. The external v2 cache validates private ownership, input identities, host module templates, and immutable executable content. Every invocation still executes Go's real source/action-cache check; a metadata hit alone cannot reuse stale source. |
| Build graph | `internal/devworkspace/buildgraph.go` schedules ready dependencies with at most four producers, further bounded by CPU count. Runtime precedes Vite-plugin shim generation. Failure stops new work while already-running siblings settle. This patch does not add competing parallelism. |
| Warm node reuse | `build_reuse.go` fingerprints node source, dependency output digests, composition, toolchains, and builder executable. Reuse requires both matching inputs and revalidated owned outputs. Rebuild intent removes the old record before invoking a producer. |
| Go compiler cache | `build_cache.go` creates only the selected UUID profile's private `runtime/go-build` under the profile guard. It is not an SDK trust receipt or permission to adopt generated output. |
| Generated output | `devoutputs` already uses bounded readers and per-observation copy scratch. Tree ownership, current content, and publication receipts remain checked. |
| Watch loop | `watch.go` debounces source events, selects affected dependency closures, fences feedback, and waits for actual consumers before releasing reload feedback. Watch rebuilds intentionally do not consult bootstrap reuse records. Embedded frontend changes still trigger host rebuilds. |
| Source updates | The existing refresh/update/follow paths reconcile selected source under lifecycle/build ownership. This patch does not alter source refs, non-fast-forward safeguards, source receipts, or recovery semantics. |
| Measurement tools | `e2e/cohort/build.go` records actual application-build stages, explicitly not ownership evidence. `task perf:coldstart` measures native application startup; `task perf:app` profiles frontend scenarios with a fake backend. Neither substitutes for managed CLI preparation timing. `internal/devworkspace/testdata/buildgraph-live-smoke.mjs` requires an already running disposable graph, two real plugins, and an actual observer; it is not directly runnable against this host-only workspace. |

## Conservative fix

1. Read all five pinned protected baseline blobs with one `git cat-file --batch` invocation per strict verification. Requests use the same full reviewed commit and paths. Parse exact byte lengths, not source newlines. Reject missing/non-blob entries, malformed or overflowing lengths, truncated bodies, missing delimiters, and extra output.
2. Keep all ancestry, canonical directory, protected live regular-file/content, dirty/untracked source, and mutation-during-read checks. Do not memoize source identity or baseline results across verifications. Explicit isolation-development opt-in retains its existing meaning; it is not enabled by this patch.
3. Reuse one lazily allocated 32 KiB copy buffer per SDK digest and per node source fingerprint. Hide `os.File.WriteTo` behind the existing reader-only-wrapper pattern. Discard scratch after that observation. Do not retain file bytes, metadata-derived digests, or a repository listing for another build.
4. Preserve digest framing and build-reuse schema. A changed CLI executable still invalidates existing node fingerprints, so the first patched launch may rebuild even with warm compiler/package payloads.

The static process-count reduction is four child starts per successful strict SDK verification. Scratch reuse removes repeated copy-buffer allocation, not the required disk reads or SHA-256 work. Actual verifier timing is reported separately below; it is not an end-to-end launch percentage.

## Regression and measurement commands

Run from this workspace's `omniview` directory after the managed baseline link/install has completed. Keep the managed SDK selection; do not edit module caches or replace reviewed evidence to make a command pass.

```bash
GOWORK=off go test -tags=server ./internal/devsource ./internal/devworkspace -count=1
GOWORK=off go test -tags=server ./internal/devsource ./internal/devworkspace -run '^$' -bench 'Benchmark(SDKVerification|SourceInputFingerprint)$' -benchmem -count=5
```

`BenchmarkSDKVerification` uses real temporary Git repositories and real Git subprocesses. It separates five individual baseline blob reads, one batched baseline read, a 256-file source digest, and full SDK verification. Compare the two baseline-read modes on the same machine. `BenchmarkSourceInputFingerprint` hashes 256 actual files in both modes with identical mutation checks; its control gives each file separate scratch and its treatment reuses scratch within one fingerprint. Compare `B/op`, `allocs/op`, and time without pinning an incidental allocation count in a unit test. This benchmark is not an application launch measurement.

Regressions cover binary/newline/NUL baseline framing, missing and tree baseline objects from real Git, malformed/oversized batch responses, protected source mutation after a successful verification, exact multi-file SDK/source fingerprint framing, empty and larger-than-buffer files, symlink targets, same-size/restored-mtime edits, and mutation during source reads. Existing ancestry, alias, ignored-cache, changed-toolchain, changed-output, and changed-source closure tests remain part of the package barrier.

### Actual CLI repeat-path smoke

Use the immutable baseline executable already retained by integration. Do not rebuild the baseline from the patched source and call it a before sample.

```bash
COLLECTION=/Users/joshuapare/Repos/omniviewdev/workspaces
NAME=dev-cli-build-speed-20261031
REVIEWED=5d0cc3dac81138ea87da1f94322873dde07aa9f2
EVIDENCE="$COLLECTION/workspaces/connection-metadata/.local/link-protocol.json"
BASELINE_CLI=/Users/joshuapare/Library/Caches/omniview-dev-cli-v2/a5eb0dd87fa709ceae818a0381257812d0d96b388faec8cba0cc4c129eb5b82a/binaries/3b5e983b1a9f76826ae929234473950966d5292dc79b5fb01aaa51105d560592/omniview-dev

"$BASELINE_CLI" workspace down "$NAME" --root "$COLLECTION" --json
/usr/bin/time -p "$BASELINE_CLI" workspace up "$NAME" --root "$COLLECTION" --mode browser --reviewed-sdk-revision "$REVIEWED" --link-evidence "$EVIDENCE" --json
"$BASELINE_CLI" workspace down "$NAME" --root "$COLLECTION" --json
/usr/bin/time -p "$BASELINE_CLI" workspace up "$NAME" --root "$COLLECTION" --mode browser --reviewed-sdk-revision "$REVIEWED" --link-evidence "$EVIDENCE" --json
"$BASELINE_CLI" workspace down "$NAME" --root "$COLLECTION" --json

# Capture actual emitted path, not a guessed bin/ path.
PATCHED_CLI="$(task --silent dev:cli:build)"
/usr/bin/time -p "$PATCHED_CLI" workspace preflight "$NAME" --root "$COLLECTION" --mode browser --reviewed-sdk-revision "$REVIEWED" --link-evidence "$EVIDENCE" --json
/usr/bin/time -p "$PATCHED_CLI" workspace up "$NAME" --root "$COLLECTION" --mode browser --reviewed-sdk-revision "$REVIEWED" --link-evidence "$EVIDENCE" --json
"$PATCHED_CLI" workspace down "$NAME" --root "$COLLECTION" --json
/usr/bin/time -p "$PATCHED_CLI" workspace up "$NAME" --root "$COLLECTION" --mode browser --reviewed-sdk-revision "$REVIEWED" --link-evidence "$EVIDENCE" --json
"$PATCHED_CLI" workspace inspect "$NAME" --root "$COLLECTION" --json
"$PATCHED_CLI" workspace down "$NAME" --root "$COLLECTION" --json
```

Integration completed the baseline sequence after starting it before implementation changes. Do not rerun it just to reproduce a reported failure. Retain stdout/stderr, CLI content identities, source selections, launch mode, machine/toolchain identity, and actual health/served-source reports with the timings. Browser mode must reach authenticated readiness with current served source and dependencies and connected HMR; compiler completion alone is not acceptance.

First launch is a first-path sample, not a guaranteed cold machine: module stores, OS page cache, and tool payloads may already be warm. The repeat launch is the useful unchanged-source path. Run the first patched launch before collecting patched repeats because builder identity invalidates reuse. For comparison quality, collect at least five repeats per binary without concurrent builds, report median and range, and separate CLI helper bootstrap from launch time. The already-running parent samples include concurrent work, so they demonstrate real execution and readiness, not a clean total-build A/B result. Never delete managed caches or receipts to manufacture a cold run. A genuinely cold comparison needs separately created disposable UUID profiles and equivalent source/toolchain selections.

For one-shot helper timing independently, retain both the printed path and `/usr/bin/time -p task --silent dev:cli:build` stderr. Do not compare that number with `workspace up` or fake-backend frontend profiling.

## Ranked further work and unfixed risks

1. **Attribute managed preparation before widening optimization.** Compare actual build-stage reports and repeat-path CPU/allocation profiles. Determine the relative cost of dependency-tree ownership scans, peer checks, SDK Git commands, source hashing, and native linking. Current source inspection proves repeated work, not a measured dominant stage.
2. **Investigate duplicate CLI host-module preparation.** The standard-library bootstrap prepares a temporary effective module before compiling `scripts/devcli`; `prepareHost` validates/prepares the immutable host template again. Any consolidation must retain validation before compiling SDK-dependent packages and preserve external-cache ownership, framework-replacement rejection, and dirty-source action-cache checks. No fast path is added here.
3. **Reduce repeated repository enumeration only with exact set-equivalence evidence.** Multiple node fingerprints list repository files separately. A scoped Git pathspec could reduce enumeration, but must preserve ancestor config/lockfiles, script-referenced parent paths, tracked deletions, untracked files, and literal metacharacter paths. A cached listing that hides files added during a build is not acceptable.
4. **Separate runtime source freshness from documentation-only edits only through declared input semantics.** The filed stale-badge observation was not independently isolated. A suffix exclusion would be unsafe because builds may read arbitrary assets or embed files. Keep existing conservative freshness until producer inputs and actual browser evidence justify narrowing it.
5. **Measure native link/bindings work and graph width before changing scheduling.** Parallel graph execution and runtime-before-shims ordering already exist. More workers can increase memory pressure and oversubscribe Go/toolchain children. Preserve `task bindings` as the sole binding-generation entrypoint.

The new batch parser is a protocol boundary: it fails closed on unknown framing rather than returning partial approval. It buffers the small fixed set of baseline blobs, as existing commands already buffered individual blobs; it does not accept an advertised length exceeding the actual returned buffer. No persistent approval, ownership, source-update, profile-lock, generated-output, or protocol-evidence boundary is relaxed. Platform and actual plugin/native acceptance remain unverified by this host-only worker task.

## Integration verification results

`GOWORK=off go test -tags=server ./internal/devsource ./internal/devworkspace -count=1` passed both complete packages: 4.442 seconds and 369.975 seconds respectively. The actual launch, source-verification and benchmark checks below also passed. Temporary binaries, probe directories and fault-injection source were removed after verification.

### Actual reviewed SDK and component measurements

Two binaries compiled from identical temporary probe source called `devsource.VerifyWithOptions` against the same selected, unmodified SDK. Each process performed one unmeasured warmup and ten fresh strict verifications. Run order was baseline, optimized, optimized, baseline: twenty measured samples per implementation, with no identity cache. Every returned SDK identity matched, including source digest `824dfbc830385a8738ec70c50381a7eb55b12f7e584933399dd4e38bb5f29b5a`.

Machine: Apple M5 Max, Darwin arm64, Go `go1.26.1`. Other integration checks overlapped these measurements; they are local component evidence, not isolated end-to-end attribution. [Raw samples and executable SHA-256 identities](dev-cli-sdk-verify-evidence-20261031.json) are retained. Temporary probe source was removed from both modules after compilation.

| Measurement | Unit | Baseline/control | Optimized |
| --- | --- | ---: | ---: |
| Actual selected SDK verification, median of 20 samples | ms | 75.146 | 46.210 |
| Five reviewed blob reads, median of five benchmark runs | ms/op | 33.778 | 7.817 |
| 256-file input fingerprint, median of five benchmark runs | ms/op | 7.708 | 6.542 |
| 256-file input fingerprint allocation, median of five benchmark runs | B/op | 8,626,274 | 260,476 |

The actual SDK probe measured 38.5% lower median verification latency. The blob benchmark compares real individual Git reads with the new batch reader. The fingerprint benchmark compares per-file scratch with observation-local scratch over identical real files. These are different measured components, not additive whole-build savings.

`GOWORK=off go test -tags=server ./internal/devsource ./internal/devworkspace -run '^$' -bench 'Benchmark(SDKVerification|SourceInputFingerprint)$' -benchmem -count=5` passed both benchmark packages. A separate read-only review found no issues in the batching, framing, trust checks or fingerprint changes.

### Actual managed CLI launch loop

Every launch below reached authenticated readiness, current dependencies and served source, and connected HMR. All used browser mode, no selected plugins, the actual retained protocol receipt, the same explicitly reviewed SDK and `--watch=false`. Each repeat followed native `workspace down`.

| Execution sample | Wall seconds | Attribution limit |
| --- | ---: | --- |
| Baseline first launch | 120.03 | First path; not a guaranteed cold machine |
| Baseline repeat | 72.46 | Concurrent source edits invalidated bindings, host frontend and host backend |
| First optimized launch | 66.79 | Changed builder identity invalidated all six nodes |
| Optimized unchanged-source repeat | 10.86 | All six nodes reused their unchanged verified outputs |

The owned supervisor log confirms the baseline repeat reused providers, runtime and Vite-plugin outputs but rebuilt changed bindings/frontend/backend inputs. It confirms that the optimized repeat skipped providers, bindings, runtime, Vite-plugin, host frontend and host backend. The launch timings therefore do **not** establish a whole-build percentage improvement attributable to this patch. They prove a working unchanged-source loop and retained source invalidation.

Final native `workspace down` returned stopped for the owned velocity workspace. No other workspace, default profile, source ref or global cache was reset. Native-window, plugin, auxiliary-preview and actual browser-module execution acceptance remain outside this host-only CLI smoke.
