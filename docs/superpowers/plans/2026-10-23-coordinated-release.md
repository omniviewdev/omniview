# Coordinated Workspace Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Land all four workspace PRs with passing required checks and publish mutually compatible dependencies and application artifacts.

**Architecture:** Parent owns merge/tag/publication gates and host consumer pins. Disjoint agents handle SDK, UI, Kubernetes, host TypeScript checks, browser CI, and read-only organization discovery. Dependency releases precede host release; Kubernetes follows published host npm packages.

**Tech Stack:** Go 1.26, stock Wails beta.34/a90f7e7f50bf, pnpm 12.14.0, GitHub Actions, Changesets, npm OIDC, Go module tags.

**Spec:** User authorization to manage PRs/checks/versioning/merges/publication, plus repository organization cleanup; stock migration verification in 2026-10-22-stock-wails-migration.md.

## Global Constraints

- No Wails patches/fork or legacy-data transition. No force push, gate bypass, fake checks, hidden local SDK fallback, or unverified review-finding fixes.
- Preserve unrelated staged/unstaged user plans, evaluation outputs, dist/.gitkeep deletion, unrelated processes and worktrees.
- All Go commands: GOWORK=off GOFLAGS=. Bindings only through task bindings. Build runtime before Vite-plugin shims.
- Agents skip builds/tests/lint/formatters mid-flight; parent verifies integrated edits. Only parent merges, tags or publishes.
- Review all GitHub checks. CodeRabbit host PR77 has 531 reviewable files versus 100 limit; do not hide files to manufacture approval. Investigate supported incremental/scoped options; document a justified skip if unavoidable.

## Task 1: Review and publication inventory

- [x] Publish and link Omniview77, SDK9, UI57 and Kubernetes27.
- [x] Request full CodeRabbit review on each and collect actual check failures.
- [x] Read release workflows and published versions: SDK0.5.0–0.5.2 already exist; new profilecontract requires SDK0.6.0. UI existing changeset selects base-ui0.4.4 and ai-ui/editors3.0.4. Host npm latest0.4.2; next feature minor0.5.0. Kubernetes latest0.2.2; next minor0.3.0.
- [ ] Resolve verified findings; document host CodeRabbit file-limit disposition.

## Task 2: Host check fixes and organization

**Files:** tsconfig.test.json; runtime PluginContextProvider.test.tsx; Vite-plugin feedback.test.ts; .github/workflows/{app-profile,render-bench,pr}.yml. Root organization follows evidence from AuditRootGoLayout/AuditTrackedRepoDebris; no speculative deletion.

- [x] Remove unsupported testing-library exact option; include existing application Window declarations in test compilation; replace invalid Vite5/8 server cast with correctly typed real entrypoint fixtures, retaining HMR/security assertions.
- [x] Fix Playwright1.50.1 versus ubuntu26.04 runner mismatch using a supported pinned runner, without extending test deadlines or disabling jobs.
- [x] Configure explicit reviewed/published SDK and UI E2E inputs; retain fail-closed guards.
- [x] Audit execution debris and relocate 19 root implementation/test files behind cohesive internal boundaries. Preserve unrelated historical/user files and genuine package-main entrypoints.
- [ ] Parent runs actual typecheck, relevant tests, lint, native/server Go checks and affected runtime smoke; push fixes and inspect new Actions results.

## Task 3: SDK and UI dependency releases

- [x] Verify SDK review fixes, full suite and filesystem consumer smoke; merge SDK9 through the repository's squash-only policy.
- [x] Publish immutable SDK v0.6.0 at 1e92fb518b117814acb504aaae1772ff39abcdef; verify public Go proxy origin, module checksums and profilecontract.
- [ ] UI agent validates findings/checks and existing changeset; parent merges UI57 after gates pass.
- [ ] Manage the generated Changesets release PR; verify base-ui0.4.4, ai-ui3.0.4 and editors3.0.4 through existing npm trusted publishing and exact registry provenance.

## Task 4: Host consumer integration and release

- [ ] Update host SDK requirement/checksums to published0.6.0; update necessary UI pins to published patch versions with native pnpm and strict peers. No local replacements in released files.
- [ ] Regenerate Task bindings and runtime/shims, run published-dependency builds/tests, inspect all required GitHub checks and resolve verified failures.
- [ ] Merge host77 only after review and checks permit; tag next unused v0.5.0 after confirming tag availability. Existing release.yaml stamps providers/runtime/vite-plugin and publishes desktop artifacts.
- [ ] Verify npm packages resolve at0.5.0, published export/shim compatibility, and desktop release jobs/artifacts. Inspect real failure logs rather than rerunning failures blindly.

## Task 5: Kubernetes published consumer release

- [ ] Update compatible SDK0.6.0, host runtime/vite-plugin0.5.0 and UI patch pins; set plugin0.3.0 consistently across authorities.
- [x] Fix supported reusable-workflow pnpm12 inputs and pin version validation to the same immutable github.sha that the publisher builds.
- [ ] Run published-consumer verification without human kubeconfig/cluster access; inspect review/checks and merge Kubernetes27 after its standalone lockfile resolves actual released npm packages.
- [ ] **User-selected production gate:** hold the Kubernetes v0.3.0 tag/publication until the production API, validation worker and approval path are established. Production DNS is NXDOMAIN, production Terraform apply is explicitly disabled, and source deployment architecture is inconsistent; no infrastructure change or staging fallback is authorized.
- [ ] After that gate is cleared, verify approved marketplace artifacts and normal-host availability. Submission success alone is not approval/installability.

## Discovered verification fixes

- Linux watch recovery: generated bindings were registered with inotify; atomic publication invalidated a descriptor and stopped Watch. The failing Linux probe observed `invalid argument`; generated-tree pruning at registration passes the three targeted Linux regressions without swallowing errors or changing deadlines.
- Whole-app profiling: the old bundled Kubernetes source still used the removed MUI/Emotion/legacy UI cohort. Reuse canonical private source composition and the shared JS-only producer closure, not permissive install flags or a substitute workload.
- Real pnpm12.14.0 canonical source composition at host4064330e/UIb61e125/Kubernetes2915a0b passes every selected producer, strict peer audits and shim checks, then completes three runs each of cold-start, Kubernetes startup, pods and logs. The private workspace retires through real session-aware guards. No unhandled backend calls were recorded; logs did record eight `ResizeObserver loop completed with undelivered notifications` events across the runs. Preserve this browser diagnostic for investigation; do not filter it out or call the run error-free.
- Browser CI listed both A17 modes in each of its optimized/live invocations, repeating each expensive consumer scenario. Select only the corresponding A17 mode per invocation while retaining every general workspace scenario in both modes; real Playwright discovery verifies seven cases per invocation. Keep the HTML artifact and list reporter together so long-running tests produce progress instead of an HTML-only console.
- Source packages declare the real upcoming 0.5.0 release, and Kubernetes/probe consumers declare ^0.5.0. Existing devcompose local-edge rules resolve those actual selected sources with old standalone lock seeds; this is not a claim that npm0.5.0 exists. Refresh standalone consumer locks after actual publication.
- Fresh CodeRabbit review identified the global immediate-release exception. Restore the managed 24-hour policy and scope registry exemptions to `@omniviewdev/*` consistently in the host, UI, Kubernetes and probe workspaces. Security regressions were observed failing before repair; composition tests, native pnpm12.14.0 strict frozen UI installation and a fresh actual protocol probe pass with protection enabled.
- The built providers CommonJS entry crashed on a Vite-only `import.meta.env.DEV` access used solely for a React context display name. Assigning the display name directly removes that environment dependency; the actual CommonJS import now succeeds after rebuilding.
- Full UI verification exposed a Calendar reciprocal-effect loop and deferred EditableList focus theft. One focused-date authority and immediate initial editor focus pass all 1,753 UI tests, typechecks, builds, and actual Chromium interaction/pixel checks.
- The first UI CodSpeed check flagged RowList minima despite unchanged runtime/dependency inputs, unchanged mean/CPU and p=0.8557586. Do not optimize unrelated code or weaken thresholds. The verified UI fixes require a genuine new-head CI run; any acknowledgement must use CodSpeed's supported admin review workflow.
- Historical host v0.4.2 notarization failed Apple HTTP403 for a missing/expired legal agreement. No code change substitutes for account-holder acceptance if that prerequisite remains unresolved.

