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
