# Coordinated Workspace Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Land all four workspace PRs with passing required checks and publish mutually compatible dependencies and application artifacts.

**Architecture:** Parent owns merge/tag/publication gates and host consumer pins. Disjoint agents handle SDK, UI, Kubernetes, host TypeScript checks, browser CI, and read-only organization discovery. Dependency releases precede host release; Kubernetes follows published host npm packages.

**Tech Stack:** Go 1.26, stock Wails beta.34/a90f7e7f50bf, pnpm 12.14.0, GitHub Actions, Changesets, npm OIDC, Go module tags.

**Spec:** User authorization to manage PRs/checks/versioning/merges/publication, plus repository organization cleanup; stock migration verification in 2026-10-22-stock-wails-migration.md.

## Global Constraints

- No Wails patches/fork or legacy-data transition. No force push, fake checks, hidden local SDK fallback, or unverified review-finding fixes. The maintainer explicitly authorized an admin merge only for host77's required-review gate under the documented CodeRabbit size-limit exception; all actual checks passed.
- Preserve unrelated staged/unstaged user plans, evaluation outputs, dist/.gitkeep deletion, unrelated processes and worktrees.
- All Go commands: GOWORK=off GOFLAGS=. Bindings only through task bindings. Build runtime before Vite-plugin shims.
- Agents skip builds/tests/lint/formatters mid-flight; parent verifies integrated edits. Only parent merges, tags or publishes.
- Review all GitHub checks. CodeRabbit host PR77 has 531 reviewable files versus 100 limit; do not hide files to manufacture approval. Investigate supported incremental/scoped options; document a justified skip if unavoidable.

## Task 1: Review and publication inventory

- [x] Publish and link Omniview77, SDK9, UI57 and Kubernetes27.
- [x] Request full CodeRabbit review on each and collect actual check failures.
- [x] Read release workflows and published versions: SDK0.5.0–0.5.2 already exist; new profilecontract requires SDK0.6.0. UI existing changeset selects base-ui0.4.4 and ai-ui/editors3.0.4. Host npm latest0.4.2; next feature minor0.5.0. Kubernetes latest0.2.2; next minor0.3.0.
- [x] Resolve verified findings; document host CodeRabbit file-limit disposition.

## Task 2: Host check fixes and organization

**Files:** tsconfig.test.json; runtime PluginContextProvider.test.tsx; Vite-plugin feedback.test.ts; .github/workflows/{app-profile,render-bench,pr}.yml. Root organization follows evidence from AuditRootGoLayout/AuditTrackedRepoDebris; no speculative deletion.

- [x] Remove unsupported testing-library exact option; include existing application Window declarations in test compilation; replace invalid Vite5/8 server cast with correctly typed real entrypoint fixtures, retaining HMR/security assertions.
- [x] Fix Playwright1.50.1 versus ubuntu26.04 runner mismatch using a supported pinned runner, without extending test deadlines or disabling jobs.
- [x] Configure explicit reviewed/published SDK and UI E2E inputs; retain fail-closed guards.
- [x] Audit execution debris and relocate 19 root implementation/test files behind cohesive internal boundaries. Preserve unrelated historical/user files and genuine package-main entrypoints.
- [x] Parent runs actual typecheck, relevant tests, lint, native/server Go checks and affected runtime smoke; push fixes and inspect new Actions results.

## Task 3: SDK and UI dependency releases

- [x] Verify SDK review fixes, full suite and filesystem consumer smoke; merge SDK9 through the repository's squash-only policy.
- [x] Publish immutable SDK v0.6.0 at 1e92fb518b117814acb504aaae1772ff39abcdef; verify public Go proxy origin, module checksums and profilecontract.
- [x] Merge UI57 after full CodeRabbit source review, repaired/resolved release-age finding, and all current checks including CodSpeed pass.
- [x] Review and merge generated Changesets release60. Concurrent accepted UI58/59 changes select base-ui0.5.0, ai-ui4.0.0 and editors4.0.0, superseding the initial patch-only plan. Exact versioned source passes builds, typechecks and1779 tests. Release39907858075 succeeds; all three versions are independently visible on npm with trusted-publisher provenance and exact base-ui0.5.0 peers.

## Task 4: Host consumer integration and release

- [x] Consume published SDK0.6.0 and the actual published UI0.5.0/4.0.0 cohort with native pnpm strict peers and 24-hour third-party protection. Host app/test compilation,933 host tests,157 runtime tests and runtime-before-Vite shim builds pass. No local replacements in released files.
- [x] Regenerate Task bindings and runtime/shims, run published-dependency builds/tests, inspect all required GitHub checks and resolve verified failures. At7648e432, all checks pass: actual macOS universal/Linux/Windows builds, Go/bindings/UI, rendering and application profiles, and seven optimized plus seven live browser scenarios without retries.
- [x] Merge host77 at97365d259cd4d1f639c0c3aa285779aef41ddd88 using the maintainer's explicit, PR-specific admin authorization for the required approval gate. Tag previously unusedv0.5.0 at that immutable merged commit. Actual release40000689615 succeeds, including macOS signing/notarization, Linux/Windows assets and Homebrew update. No unverified browser-driver changes are included.
- [x] Verify all three npm packages resolve at0.5.0 with exactgitHead97365d25, trusted-publisher identity, integrity and provenance metadata; actual strict/frozen Kubernetes and probe installs/builds consume registry runtime/Vite0.5.0. Download the published universal DMG and verify SHA25615d99219d27f5124eed9a178445871b75557d7d2863ad7e62fb971b503e62644, bothx86_64/arm64 slices, deep strict signature, Gatekeeper Notarized Developer ID acceptance and its stapled ticket.

## Task 5: Kubernetes published consumer release

- [x] Consume SDK0.6.0, public host runtime/vite-plugin0.5.0 and the actual UI0.5.0/4.0.0 cohort; set plugin0.3.0 consistently across authorities and refresh standalone locks only after real host npm publication. The plugin's324 UI tests pass on Node24.15 and26.12; the storage harness uses the existing host's real-JSDOM-origin convention after20 persistence cases failed on Node26's shadowing process-global Web Storage.
- [x] Fix supported reusable-workflow pnpm12 inputs and pin version validation to the same immutable github.sha that the publisher builds.
- [x] Verify published consumers without human kubeconfig/cluster access; merge Kubernetes27 normally at977e51e6bd51854fc7656b1eba96dce8c89d48c7 after strict registry installation/builds,324 UI tests on Node24/26, Go suites/vet, five cluster-config regressions and actual SDK0.6 binary provenance. Resolve all individually verified CodeRabbit threads. The final two-line README/checkout follow-up implements review suggestions exactly; its check is rate-limited, not a fresh source approval.
- [ ] **User-selected production gate:** hold the Kubernetes v0.3.0 tag/publication until the production API, validation worker and approval path are established. Production DNS is NXDOMAIN, production Terraform apply is explicitly disabled, and source deployment architecture is inconsistent; no infrastructure change or staging fallback is authorized.
- [ ] After that gate is cleared, verify approved marketplace artifacts and normal-host availability. Submission success alone is not approval/installability.

## Discovered verification fixes

- Linux watch recovery: generated bindings were registered with inotify; atomic publication invalidated a descriptor and stopped Watch. The failing Linux probe observed `invalid argument`; generated-tree pruning at registration passes the three targeted Linux regressions without swallowing errors or changing deadlines.
- Whole-app profiling: the old bundled Kubernetes source still used the removed MUI/Emotion/legacy UI cohort. Reuse canonical private source composition and the shared JS-only producer closure, not permissive install flags or a substitute workload.
- Real pnpm12.14.0 canonical source composition at host4064330e/UIb61e125/Kubernetes2915a0b passes every selected producer, strict peer audits and shim checks, then completes three runs each of cold-start, Kubernetes startup, pods and logs. The private workspace retires through real session-aware guards. No unhandled backend calls were recorded; logs did record eight `ResizeObserver loop completed with undelivered notifications` events across the runs. Preserve this browser diagnostic for investigation; do not filter it out or call the run error-free.
- Browser CI listed both A17 modes in each of its optimized/live invocations, repeating each expensive consumer scenario. Select only the corresponding A17 mode per invocation while retaining every general workspace scenario in both modes; real Playwright discovery verifies seven cases per invocation. Keep the HTML artifact and list reporter together so long-running tests produce progress instead of an HTML-only console.
- The superseded browser retry trace proves an additional source-input failure: CI selected only `workspace-probe`, while A17 requires both it and managed Kubernetes. Add the initialized, immutable Kubernetes gitlink to source refs and plugin selection. Do not retry a missing-source fixture or relax A17's two-plugin requirement.
- Corrected actual two-plugin A17 optimized execution passes locally in28.8minutes, covering cross-profile isolation, live shared edits and failed/repaired SDK builds. Run optimized/live modes on separate CI matrix runners, with the existing90-minute deadline and all seven corresponding cases per runner; retain separately named HTML artifacts.
- Source packages and Kubernetes/probe consumers declare0.5.0/^0.5.0. Before publication, devcompose local-edge rules consumed selected sources with old standalone lock seeds; after real npm publication, refresh both standalone consumer locks and verify strict frozen installs/builds against the public registry.
- Fresh CodeRabbit review identified the global immediate-release exception. Restore the managed 24-hour policy and scope registry exemptions to `@omniviewdev/*` consistently in the host, UI, Kubernetes and probe workspaces. Security regressions were observed failing before repair; composition tests, native pnpm12.14.0 strict frozen UI installation and a fresh actual protocol probe pass with protection enabled.
- The built providers CommonJS entry crashed on a Vite-only `import.meta.env.DEV` access used solely for a React context display name. Assigning the display name directly removes that environment dependency; the actual CommonJS import now succeeds after rebuilding.
- Full UI verification exposed a Calendar reciprocal-effect loop and deferred EditableList focus theft. One focused-date authority and immediate initial editor focus pass all 1,753 UI tests, typechecks, builds, and actual Chromium interaction/pixel checks.
- The first UI CodSpeed check flagged RowList minima despite unchanged runtime/dependency inputs, unchanged mean/CPU and p=0.8557586. Do not optimize unrelated code or weaken thresholds. The verified UI fixes require a genuine new-head CI run; any acknowledgement must use CodSpeed's supported admin review workflow.
- Historical hostv0.4.2 notarization failed Apple HTTP403 for a missing/expired legal agreement. The actualv0.5.0 release now signs, notarizes and staples successfully; downloaded-artifact Gatekeeper validation also passes. There is no remaining Apple agreement blocker in this release's observed results.
- The current-driver Mac comparison (Playwright1.64.1/Chromium156) exceeded the3600-second command deadline with a large console-error stream; it does not establish a driver-only fix. Restore the checked1.50.1 dependency cohort, retain issue115, and investigate telemetry/RPC feedback separately from Vite full-reload/navigation races. Retire only the timed-out fixture's three owned supervisors through the actual CLI. Never infer macOS stress equivalence from the passing Linux matrix.
- A bounded actual Chromium/Vite8.0.1 reproduction isolates the console rejection storm without Wails or app telemetry: one visible console error after socket disconnection produces hundreds of `send was called before connect` page errors with Vite forwarding enabled, and zero with its stock`forwardConsole:false` option. The actual host Vite configuration also produces zero while retaining the original browser error. Disable only the redundant Vite forwarding transport; keep structured diagnostics and Playwright error capture. This does not yet prove the earlier ChromiumSIGTRAP's cause.
- The durable restart failure separately exposes competing Vite automatic reload and same-URL Playwright navigation. Optimized hosts also import managed plugins' Vite clients into the parent document, so a null host Vite endpoint is not a reliable reload discriminator. The Chromium `restartApp` helper requests `Page.reload` without awaiting one particular navigation, then requires the authenticated replacement generation in the frozen document boot identity, completed load and visible shell. Existing A17 backend event-frame and persistence assertions remain unchanged.

