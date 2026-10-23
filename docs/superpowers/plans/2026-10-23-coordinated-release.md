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

- [ ] Remove unsupported testing-library exact option; include existing application Window declarations in test compilation; replace invalid Vite5/8 server cast with correctly typed real entrypoint fixtures, retaining HMR/security assertions.
- [ ] Fix Playwright1.50.1 versus ubuntu26.04 runner mismatch using a supported pinned runner or justified supported package update, without extending test deadlines or disabling jobs.
- [ ] Configure explicit reviewed/published SDK and UI E2E inputs only after dependency review/release identity is established; retain fail-closed guards.
- [ ] Remove current-feature execution debris and relocate implementation behind cohesive existing internal boundaries where build/cgo constraints allow. Update every caller, build tag, tool and doc; preserve root entrypoints that genuinely require package main.
- [ ] Parent runs actual typecheck, relevant tests, lint, native/server Go checks and affected runtime smoke; push fixes and inspect new Actions results.

## Task 3: SDK and UI dependency releases

- [ ] SDK agent validates review findings and existing Go-tag conventions; parent verifies changes and merges SDK9 only after gates pass.
- [ ] Parent tags merged SDK source v0.6.0; verify Go proxy exposes the exact tag commit and pkg/profilecontract. Never repoint an existing tag.
- [ ] UI agent validates findings/checks and existing changeset; parent merges UI57 after gates pass.
- [ ] Manage the generated Changesets release PR; verify base-ui0.4.4, ai-ui3.0.4 and editors3.0.4 through existing npm trusted publishing and exact registry provenance.

## Task 4: Host consumer integration and release

- [ ] Update host SDK requirement/checksums to published0.6.0; update necessary UI pins to published patch versions with native pnpm and strict peers. No local replacements in released files.
- [ ] Regenerate Task bindings and runtime/shims, run published-dependency builds/tests, inspect all required GitHub checks and resolve verified failures.
- [ ] Merge host77 only after review and checks permit; tag next unused v0.5.0 after confirming tag availability. Existing release.yaml stamps providers/runtime/vite-plugin and publishes desktop artifacts.
- [ ] Verify npm packages resolve at0.5.0, published export/shim compatibility, and desktop release jobs/artifacts. Inspect real failure logs rather than rerunning failures blindly.

## Task 5: Kubernetes published consumer release

- [ ] Update compatible SDK0.6.0, host runtime/vite-plugin0.5.0 and UI patch pins; set plugin0.3.0 consistently across authorities.
- [ ] Fix reusable release workflow pnpm12/Go workspace behavior using supported inputs. Establish production versus staging target from existing release/marketplace evidence before changing endpoint or credentials wiring.
- [ ] Run source and packaged-consumer verification without human kubeconfig/cluster access; inspect review/checks, merge Kubernetes27 and publish through its established pipeline.
- [ ] Verify the marketplace/plugin artifact uses real published packages and the expected version; perform a final coherent published-dependency smoke and report exact release URLs and residual external blockers.
