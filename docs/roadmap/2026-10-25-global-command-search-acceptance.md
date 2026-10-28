# P42 / C11 command-search acceptance

Status: **accepted** in [host PR139](https://github.com/omniviewdev/omniview/pull/139), merged as `c43662896b75af4409124ef29ebafe0bcd76c288`. [P42 issue #113](https://github.com/omniviewdev/omniview/issues/113) is closed; delivery-project Status/Readiness are Done, with Integration evidence.

This accepts the feature-local [command/provider contract](../superpowers/specs/2026-10-25-global-command-search-contract.md), not every C11 graph/search/index contract. [P43](https://github.com/omniviewdev/omniview/issues/114) still requires [P35](https://github.com/omniviewdev/omniview/issues/106)'s authoritative multi-provider query service.

## Verified sources

| Source | Immutable identity |
| --- | --- |
| Reviewed host feature | `3596363f32d42ac67ac8b0d7455ad3e3ea5b9166` |
| Host base | `6e0ea09f3c1f6aaeb6a608cb33ce685795488a9b` |
| Actual CI tested merge | `721da345d5b7cd85479d52a8d07e6c88dcfad19b` |
| SDK | `8e78f72556c5221037889659c8ac28ad1246d35d` |
| UI | `c437aca20d853aa6f65f0fa437ada3e0bcfc82f9` |
| CI Kubernetes adapter | `a7c00be5b15e50164f12f0d6ee0915d1b0112692` |
| CI workspace-probe fixture | `7def77d97bc84241441589e77fdede452f6da738` |
| Separate private browser fixture | `3576f6d0e5983add09fc171b454c71cff9762a95` |

The private fixture is retained in the coordinator's owned bundle, not published as a package or confused with the CI fixture. Its stateful search-provider method exercises receiver preservation through the actual application registry and plugin loader.

## Consumer-visible acceptance

- The actual header shortcut opens a focused, keyboard-operable palette; close restores the opener. Dialog double-click does not invoke header window maximization.
- Settings results navigate and focus the actual editor, including an already-mounted destination and an identical URL. Plugin navigation uses current registered routes and readiness.
- An allowed connection-discovery command runs through the existing native `ResourceClient.LoadConnections` boundary. Actual cache invalidation/refetch is observed; discovery-only results do not overwrite a merged connection list.
- Safe denial feedback is observed from the actual native boundary without exposing private provider error text. Discovery and frontend ownership do not grant permission.
- Query edits cannot redirect native completion feedback into a different execution. Navigation and settings remain usable while command rows prevent duplicate native execution; retired completion feedback cannot enter a later palette session.
- Current registration identity fences activation; owner/target readiness and observed lifecycle transitions fence native completion. Unrelated registration mutations do not retire accepted native feedback. Reload/unload removes contributions and rejects stale callbacks; bounded cancellable provider searches cannot overwrite a newer query or closed state.
- External result order and raw query are preserved instead of imposing local fuzzy filtering. A stateful provider method retains its original receiver and callable identity.

## Executed verification

Settled feature sources passed 460 focused tests across 20 files, application and test TypeScript checks, ESLint and private-fixture compilation. Regression coverage includes provider receivers, native execution ownership, settings/navigation during a pending command, route/focus lifecycle and stale results.

Actual isolated browser verification used the managed workspace's inspected browser endpoint, UUID and replacement generation. It exercised rendered plugin contributions, settings/history/focus, native success and denial, query edits during native execution and navigation while a command was pending. The native fixture flag was restored; the browser was closed; canonical down/unlink completed. Private HOME/environment isolation followed the [baseline procedure](2026-10-17-resource-intelligence-baseline.md#isolation-and-tooling).

All ten runnable PR checks succeeded. The sole [application job](https://github.com/omniviewdev/omniview/actions/runs/40227847601/job/121272973813) passed 86/86 with zero retries. Its inclusive invocation took 525,092ms against a 600,000ms budget, including preparation, builds, assertions and teardown. Launch drain completed 5/5 with no owned children; canonical retirement took 36,869ms and private preparation teardown 772ms.

Artifact `12611742549` was independently downloaded and SHA256-verified as `392d9ad498c68b055ca14da502e8814d194d63bb92160a125046c95f277c0f29`. The coordinator retains the ZIP and invocation/case/source-cohort records; the hosted Actions artifact has its normal retention limit.

## Review and organization

An independent reviewer applied Vercel React best practices and reviewed code layout, lifecycle and the settled final delta. Presentation remains in `GlobalCommandSearch`; `useGlobalCommandSearch` owns React lifecycle/catalogue integration; the controller owns bounded search/execution state. Settings context types live outside page components. No Critical/Important findings remained.

Full CodeRabbit reviews covered the initial implementation and `d450de4`; the independent review covered final `3596363`. All eight threads were resolved, and CodeRabbit acknowledged both final corrections. A fresh full final-head bot review was quota-limited; its successful status is not presented as a fresh full review. [Integration acceptance](https://github.com/omniviewdev/omniview/pull/139#issuecomment-6402526459) records this distinction and the authorized admin merge without waiting for human approval.

## Remaining boundaries

P18 native IME/VoiceOver/AX, production numeric admission, authoritative schema/query leases, P43 resource search and other graph/index contracts remain separate gates. This work adds no frontend resource-query engine, permission-policy product, SDK export, package release or production deployment.

## Post-PR139 local correction preview — October 26, 2026

Status: **human UX approved; publication in progress**. The revised behavior is recorded in [contract section 10](../superpowers/specs/2026-10-25-global-command-search-contract.md#10-post-pr139-local-ux-revision--approved-for-publication). Original merge evidence above does not certify this follow-up.

- Focused command-search, header and settings regressions: 117 passed across seven files. This includes exact shortcut toggling, modifier/focus ownership, fuzzy matching, hyphenated labels, provider display fairness, debounce and cancellation.
- Production and test TypeScript projects and scoped ESLint passed.
- The actual managed browser instance reproduced the original open-only shortcut and Shift capture. The corrected instance toggled closed, ignored Shift, rendered nonoverlapping multiline rows, matched `thme`, and opened Appearance/Theme with its actual editor focused.
- Live inspection covered 900px and 1600px viewports, grouped rows, icons, keyboard navigation and Escape. A temporary contribution through the real extension registry demonstrated a provider alias among 100 visible rows despite 100 matching static entries. Rapid edits produced only the initial and final provider queries (`""`, `"smoke"`). Temporary contributions were removed.
- A temporary failing source exposed no private error text; source details expanded and a disabled row retained its visible recovery reason. Temporary entries were removed.
- Independent source review found no actionable regressions. Browser verification does not certify native VoiceOver/IME, production resource queries, or arbitrary plugin-command execution.

The running workspace remains available for user inspection. No commit, PR, merge, tag or release is authorized before that inspection is approved. After approval, manage the complete publication lifecycle, including required checks/reviews, dependency release ordering where applicable, merge and release verification.

### Shared-component correction after local feedback

The active review workspace is now `palette-review`, with host/UI/SDK worktrees on `feature/palette-review-8c17f334`. The previous `palette-ux` workspace retains all source edits and was stopped; it is not the current preview. Direct incremental compiler checks had changed an owned cache, preventing fresh CSS publication. Authored files were migrated without generated artifacts or cache-ledger changes. Later checks disabled incremental/composite output.

- Header styling now comes from shared `SearchTrigger` and the exact Input CSS shell, not a host button override. Both rendered controls have a 6px radius.
- Shared command rows place breadcrumbs beside titles, descriptions on one line below, and disabled reasons in a wrapping slot. The measured icon/title center difference was 0px; representative description rows measured about 40px rather than the previous three-line 67px.
- Actual held/repeated Down and Up events with a stationary pointer left exactly one painted row. The hovered inactive row stayed transparent. Subsequent real pointer movement transferred the single active selection correctly.
- Shared Input/SearchInput/SearchTrigger/CommandList checks passed 51 tests; host command-search/header/settings checks passed 117 tests. Shared base-ui, editors and host application TypeScript checks passed.
- Independent shared-component review found no actionable regressions. Shared scoped lint remains blocked by two pre-existing virtualization inline-style errors in `CommandList.tsx`; existing story console warnings also remain. These are not reported as a clean library lint run.
- The clean managed browser instance reached ready and was inspected at 1365px and 900px widths. Shared styles and highlight behavior were verified in that instance, not inferred from successful source tests or stale output.

Human UX approval was received after the corrections below. The base-ui changeset records an additive release; it does not itself publish a package. Release the shared UI before adopting its published version in the host.

The subsequent boundary-centering correction is library-only: compound rows use one shared grid with centered track alignment, rather than a top-aligned content wrapper. Actual browser measurements found equal top/bottom whitespace for navigation, metadata-only and description rows; icon/title centers matched exactly. Compact, default and comfortable list densities each had a maximum measured centering error of 0px across those row types. All 38 CommandList regressions passed after this CSS change. No host spacing/radius/typography override was added.

### Header shortcut refinement

The header search layout now reserves up to 560px instead of 360px; only this width belongs to host CSS. Shared SearchTrigger fits its Hotkey badge with equal themed top/bottom/end insets. Hotkey accepts an optional `keys` chord, renders Meta with a same-em command icon and inserts a smaller plus icon between keys by default. Plain children remain unchanged.

Actual browser measurement at the default theme found a 552px trigger, 24px control height, 18px badge height and equal 2px interior top/bottom/right gaps. Both key token boxes measured 10.5px high. All five control sizes retained equal 2px gaps. The actual trigger still opened the focused palette and Meta+K toggled it closed; the 900px header was visually inspected.

Focused typography/search/command-list tests passed 51 cases and header tests passed 23 cases. Shared base-ui, editors and host application TypeScript checks passed. Scoped shortcut lint had no errors and one leaf-component memoization advisory.

### Publication preparation

Human UX approval and authorization to file PRs, merge and release were received on October 26, 2026. The final dialog title, combobox name and header trigger name are **Search Omniview**, verified in the actual running instance. The corresponding application test selector was updated.

Shared UI publication uses [UI PR73](https://github.com/omniviewdev/ui/pull/73), applied cleanly to current UI main rather than releasing the older reviewed baseline. Its standalone frozen-lockfile suite passed 1,543 tests across 138 files and built base-ui, ai-ui and editors. No snapshot update was needed; the earlier aggregate-run snapshot failure was not treated as release proof.

### Review corrections and consumer verification

All three CodeRabbit threads on UI PR73 were corrected and resolved before waiting for benchmark completion:

- Metadata and shortcut slots now occupy separate first-row grid tracks. Actual Storybook inspection at 520px and 280px verified nonoverlap with and without icons, with descriptions below.
- The first pointer event establishes a coordinate baseline instead of overriding keyboard selection. A subsequent coordinate change transfers selection; the new keyboard-first regression covers stationary-pointer delivery.
- Hotkey exposes normalized chord text through a screen-reader-only child instead of applying an unsupported name to a generic `kbd` or `span`. Both polymorphic forms have regression coverage.

The corrected standalone UI checkout passed 1,546 base-ui tests, 223 ai-ui tests and 239 editor tests. All three package builds and the base-ui TypeScript check passed. A built-export smoke rendered SearchTrigger and Hotkey under JSDOM. The standalone host also passed `GOWORK=off go test ./... -count=1` across 41 tested packages; 12 additional packages had no tests.

Benchmark infrastructure verification remains separate from these functional results. The unsupported macro runner was replaced with CPU simulation on standard Ubuntu 24.04 runners. A serial instrumented run completed measurements but reached its deadline before upload. Four native Vitest shards now retain the complete suite, with separate execution-log artifacts; complementary local shards proved disjoint file execution. Actual sharded CI measurement upload must succeed before this infrastructure is reported as verified.

The user subsequently authorized bypassing performance benchmarks for this release. [UI PR73](https://github.com/omniviewdev/ui/pull/73) merged as `a3c205f386c0593dcc27ce62d9f67e5224c35afc` with functional checks passing and actionable review threads resolved. The sharded benchmark run had a failing shard and was canceled; it is not release proof. [UI issue 74](https://github.com/omniviewdev/ui/issues/74) tracks diagnosis, time-efficient execution, representative coverage, runtime budgets and verified comparison reporting. The benchmark exception does not waive functional verification.

UI version PR75 merged as `a33879bcdcfc4971c3bcd98f23d657c6f5572307`. Release workflow `40436600552` published `@omniviewdev/base-ui@0.7.0`, `@omniviewdev/ai-ui@6.0.0` and `@omniviewdev/editors@6.0.0`. Public registry version metadata independently exposed all three tarballs, integrity hashes and trusted-publisher provenance; ai-ui and editors require base-ui `0.7.0`. The host's immutable E2E UI cohort now selects that release commit.

Standalone host adoption of the published cohort retained strict peers and release-age policy. Providers, runtime, Vite-plugin shim generation/export verification and the production application build passed in dependency order. The complete host UI suite passed 1,058 tests across 67 files against registry packages, not source-linked UI.

### Pending-query row stability

Query edits retain previous result rows and selection through debounce and provider completion, but retained actions cannot execute or deepen scope. Replacement rows publish together after current sources settle; the existing five-second source timeout and failure/retry feedback remain intact. Final typed results select the best new match. Controller regressions cover retention, stale activation, final activation, slow-source rejection/timeout and ignored late completion. Verification of these changes is pending.
