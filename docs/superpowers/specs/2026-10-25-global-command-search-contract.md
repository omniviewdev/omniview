# C11 global command/settings/navigation search — P42

Date: 2026-10-25. Status: **FROZEN after independent focused review; implementation and full acceptance remain separate gates.** Packet [host113](https://github.com/omniviewdev/omniview/issues/113). Selected host `e1e09f2668dc553ee0b4b1960aa92da475bc0254`, SDK `8e78f72556c5221037889659c8ac28ad1246d35d`, UI `c437aca20d853aa6f65f0fa437ada3e0bcfc82f9`, private verification plugin `87e50684b7667d31fdeff89a40fe88d4431cb4c4`.

## 1. Boundary and existing ownership

Implement the actual global header palette: Ctrl/Meta+K, settings and resource-route navigation, one closed existing-host-command adapter, typed contributions and cancellable external search. This is not P43 resource search, a permission product, an inventory cache/evaluator, a new SDK ABI or a second registry.

The actual singleton is host `ui/features/extensions/store.ts:12` **EXTENSION_REGISTRY**, constructed using runtime `ExtensionPointRegistry`. There is no `runtimeExtensionPointRegistry` export in the selected source. Reuse that same singleton and generic `ExtensionPointStore` for one new core-owned multiple point **`omniview/global-search`**, defined feature-locally. Register through existing `ensureBuiltinExtensionPointsRegistered` before plugin contributions. The existing store supplies version, listAll, register/unregister and subscriptions; PluginService supplies normalization and removeContributions on unload/reload. Do not add another command registry, persistent search catalogue or action bus.

Use existing `extensionRegistrations` for plugin entries. The loader stamps the actual loading plugin and normalized contribution ID; value-supplied plugin labels never grant authority. Core catalogue adapters own only their explicit `core/global-search/...` contribution IDs and must unregister only those IDs, never remove all core contributions.

## 2. Exact feature-local v1 values

These TypeScript contracts live in host `ui/features/command-search/types.ts`; generic runtime registry types/exports remain unchanged. Same-realm plugins can supply this structural value through their existing extension registration. There is no new package/export or compatibility alias.

```ts
type AvailabilityV1 =
  | { state: 'enabled' }
  | { state: 'disabled'; reason: string };

type SettingTargetV1 =
  | { section: 'core'; categoryId: string; settingId?: string }
  | { section: 'plugins'; pluginId: string; settingId?: string }
  | { section: 'extensions' };

type NavigationTargetV1 =
  | { kind: 'core'; path: '/' | '/plugins' }
  | { kind: 'plugin'; pluginId: string; path: string };

type HostCommandV1 = {
  kind: 'reload-connections';
  pluginId: string;
};

type SearchEntryV1 = {
  schemaVersion: 1;
  description?: string;
  keywords?: readonly string[];
  availability?: AvailabilityV1;
} & (
  | { kind: 'command'; command: HostCommandV1 }
  | { kind: 'setting'; target: SettingTargetV1 }
  | { kind: 'navigation'; target: NavigationTargetV1 }
);

type SearchProviderItemV1 = {
  id: string; // nonempty and unique within this provider response
  label: string;
  value: SearchEntryV1;
};

type SearchProviderV1 = {
  schemaVersion: 1;
  kind: 'provider';
  search(request: {
    query: string;
    signal: AbortSignal;
    limit: number;
  }): Promise<{
    items: readonly SearchProviderItemV1[];
    completion: 'complete' | 'truncated';
  }>;
};

type GlobalSearchContributionV1 = SearchEntryV1 | SearchProviderV1;
```

The existing outer `ExtensionContributionRegistration` supplies static label, ID and plugin owner. Provider item IDs are scoped by their owning registration, not globally authoritative. Display row keys use an unambiguous owner/contribution/item tuple. Neither display keys nor contribution IDs are host invocation principals. Static and provider results retain command/setting/navigation kinds rather than pretending every result is a resource.

Feature admission rejects unknown schema versions/kinds, malformed or empty IDs/labels, invalid target/command shapes and nonfunction providers. Before normalization, matching, copying or other expensive field work, check cheap UTF-16 `.length` ceilings: IDs 256, labels 256, descriptions 1024, at most 16 keywords with each keyword 128. Apply the description ceiling to public disabled-reason text too. Reject oversized contributions/source items as unavailable using existing fixed safe feedback; do not normalize or scan oversized fields. Unknown fields cannot introduce executable operations. Strings render as text, never HTML; values contain no source snippets or arbitrary execution callbacks. Description/keyword/disabled-reason text is public presentation supplied by trusted contributors, never permission evidence or a channel for raw protected diagnostics.

Plugin-relative navigation paths have a separate 2048 UTF-16-unit ceiling, checked before parsing, decoding, normalization or traversal validation. Oversized paths are unavailable; they are never truncated into another destination.

## 3. Catalogue and navigation adapters

- **Settings:** use the existing `SettingsProvider.ListSettings` category catalogue (`useSettingsProvider`/query key `['settings']`) and register typed core setting-navigation entries from category/setting IDs, labels and descriptions. Index no setting values, defaults, passwords or credential data; do not make per-setting reads to rank results. Existing setting editors, validators and persistence remain unchanged. Plugin settings can contribute typed navigation through the same point; no new settings writer is added.
- **Settings route:** retain `/settings?category=appearance`; make selection follow current query changes, not only initial mount. Add `section=core|plugins|extensions`, `plugin=<id>` for plugin selection and optional `setting=<full setting id>` as an exact focus target. Existing settings rows get stable encoded IDs and a focusable row anchor. After category data renders, scroll/focus that exact setting; malformed/removed targets yield safe unavailable feedback, not an automatic setting write. Navigating while already on Settings must work.
- **Resource route:** a ready plugin contributes a concrete plugin-relative route to its current registered UI, e.g. the private native tasks `/capabilities` page. Compose with existing `/_plugin/{pluginId}` router ownership; reject schemes, external URLs, network-path references and path traversal. Do not infer identity/namespace from route segments, enumerate resource bodies, or invent a P43 query. Recheck target plugin readiness/current route registration before navigation. Core navigation uses the closed existing Home/Plugins targets above.
- **Core command catalogue:** one `Reload <plugin> connections` item per ready UI plugin, joined with existing fallible `ResourceClient.ListPlugins()` resource-capability discovery. Refresh that discovery on palette open/plugin lifecycle changes, not each keystroke. Missing/unready resource capability is disabled with the fixed safe reason `Connection discovery is unavailable for this plugin.` Failed capability discovery is explicit unavailable state, not an empty successful list. Readiness is a UI affordance, not permission.

## 4. Consumer-safe existing host command and C02 limits

The only v1 command adapter is `reload-connections`: call existing **`ResourceClient.LoadConnections(pluginId)`** from `@omniviewdev/runtime/api`. It reaches existing resource ServiceWrapper/TrustedUI realm, `resource.LoadConnections` admission, the actual registered native provider and host connection-cache update. No new Go method, binding, allowlist service or permission policy. The palette must not switch to raw native Host context or construct principal/owner fields from plugin IDs.

At activation, resolve the current accepted row and its registration again; validate the closed command intent and current plugin/capability state, then invoke the existing service. The service remains authoritative and can deny even an enabled discovered command. Do not treat contribution ownership, cached readiness or provider discovery as authorization. C02 currently trusts same-realm plugins; this does not authenticate distinct plugins/users, provide revocation, or sandbox a malicious plugin that already has runtime access.

Use `parseAppError` only on actual existing-service errors; show its safe code/detail/request ID without raw causes, arbitrary error.message or provider actions. A FORBIDDEN outcome remains denial, never empty success. Public disabled reasons stay visible beside disabled rows; they are not silently filtered out. Unknown provider failures get fixed `Search source unavailable.` feedback. Cancellation is expected and is not an internal-error alert.

One native command execution may be pending at a time; repeat Enter/click cannot dispatch another native command. Valid settings and navigation rows retain their ordinary readiness/availability checks and remain usable while it is pending. A successful finite reload reports completion, not inventory/query completeness. Closing the palette invalidates search/presentation callbacks; it does not claim to roll back an already accepted native command. Late completion cannot reopen or overwrite a newer palette session. Navigation closes the palette after validation and must not have its destination focus stolen by opener restoration.

Native execution feedback uses the palette session and observed contributing-owner/command-target lifecycle, independently of search epochs. Query edits and unrelated catalogue mutations preserve pending status and completion. Once either owner leaves readiness, that execution's presentation remains retired even if it becomes ready before settlement. The pending lock lasts until the actual native call settles.

## 5. Controlled async composition and stale-action rules

One header-owned controller owns open/query/execution state, with one shortcut listener independent of optional header-area visibility. The existing HeaderSearchArea becomes an accessible opening control; it does not own a second search session. Ignore Ctrl/Meta+K during IME composition/keyCode229; prevent browser default only when handling the shortcut. Escape/backdrop/close share a single idempotent close operation.

Each open, query change, registry mutation, plugin readiness/registration change or close advances a private request epoch and aborts prior provider controllers. Remove old provider results immediately. Snapshot the actual store object/version and contribution object identity; reload under the same contribution ID is a new executable registration. Search only ready-owner plugin contributions (or host core). Unload/reload invalidates rows immediately, before any old provider promise completes. These are client lifecycle fences, not C02 security generations.

Static catalogue matching is bounded local case-insensitive substring matching across admitted label/description/keywords. Process at most 1000 static candidates per epoch in deterministic existing registry/settings-catalog order; malformed, disabled and nonmatching candidates consume that processing budget too. Stop at the bound rather than normalize/map/sort the remainder, and show an explicit narrow-search/overflow status instead of claiming authoritative complete coverage.

External providers receive the raw controlled query and an AbortSignal. They own their search semantics/order; **do not fuzzy-filter or rerank their returned labels against the query**. Admit at most 8 provider attempts per epoch in deterministic existing registry order, with at most 4 concurrent attempts and no retries. Later admitted attempts start only when a slot becomes free; epoch cancellation drops the queue. Additional providers get visible source-limit status, not silent complete coverage. Retain each provider's item order and distinct source identity; static entries precede provider groups. There is no shared-score fiction, pagination, live resource lease or completeness claim across sources.

Invoke the original provider function with its contributed object as the method receiver. Preserve that function's identity for current-registration activation checks; do not create a new bound wrapper during each admission.

For each provider response, inspect ONLY its first 20 array items. Check `items.length` in O(1) to mark a larger response truncated; do not scan, normalize, map or copy the rest. Validate duplicate IDs only within that bounded accepted prefix. An oversized/malformed prefix item makes that source unavailable with fixed safe feedback; it cannot introduce a hidden executable partial result. Other current sources remain independent.

V1 remaining client ceilings: query 256 Unicode code points, first guarded by cheap UTF-16 length 512 before bounded code-point counting; reject longer input with an explicit narrow-query message and no provider invocation, never silent truncation. Each provider receives limit 20; display at most 100 rows total; each invoked attempt has a 5-second deadline starting when it begins. Display/source caps have visible truncation status. These are finite UI safeguards, not measured production inventory budgets. Current static/results from completed sources remain usable while other admitted sources are queued/pending. Pending/error/truncated/source-limit status is source-specific; failure of one source cannot erase another current source's results.

Accept an external provider resolution/rejection only while open and its epoch, store/version, current registration identity and owner readiness still match. Aborted providers may ignore their signal; late results/errors are still discarded. Closing clears private result/action references and cancels deadlines/listeners. React effect replay/unmount uses the same disposal path.

Selection dispatch accepts only a key present in the current accepted result snapshot. It resolves the current registration identity plus current provider item, rejects disabled/removed/replaced items, and validates the typed action again immediately before invoking. No persisted function closure from a removed plugin is an executable action; providers return data intents, not `run` functions. Unrelated registry mutations may conservatively requery rather than retain a stale action.

## 6. Presentation and accessibility reuse

Use selected base-ui **Dialog + controlled CommandList** directly. CommandListRootProps already supports query/onQueryChange, optional filterFn, disabledKeys and onAction; omit filterFn for composed provider rows and set sortByScore=false. The selected editors CommandPalette wrapper has uncontrolled local query, mandatory local fuzzy matching and hides disabled commands: using it for async composition would violate this contract. No UI58 redo or UI API change is needed.

Keep exactly one named dialog and one focused combobox, linked to its current list/active option through existing CommandList hooks. Preserve visible disabled rows and safe reasons, source loading/failure/truncation status, current selection after result replacement, active scrolling and an accessible live execution/denial message. Arrow keys move only through current enabled choices; Enter acts on current selection; Tab stays within the open dialog. Respect IME, Clear search button ownership, pointer-to-keyboard continuity and single Escape dismissal. Restore the connected opener on close/unmount unless navigation deliberately focused a destination. Use existing theme tokens/CSS modules; no per-keystroke global effects or duplicated registry snapshots.

## 7. Exact implementation/read-only map

Existing implementation anchors and exported-reference locations are recorded in the companion local handoff, not a new central ledger. Expected owned source groups after freeze:

- `ui/features/command-search/`: feature-local types/admission, extension-point definition, core catalogue/closed intent adapters, request-epoch composition controller/hook, dialog and focused tests. No parallel registry/framework.
- `ui/features/extensions/registerBuiltinExtensionPoints.ts` and existing builtin tests: add only the core-owned point using the current convention.
- `ui/layouts/core/main/Header/index.tsx`, `areas/HeaderSearchArea.tsx`, Header CSS/tests: one controller/listener and actual accessible trigger/dialog.
- `ui/pages/settings/index.tsx`, `SettingsEntries.tsx` and focused tests: current-query selection and exact setting focus. Shared section/focus definitions live in `settingsContext.ts`; settings leaves import it directly, not the page module. Existing editors/storage unchanged.
- Selected private `workspace-probe/ui/src/entry.ts` plus a narrow palette contribution/proof page/test if needed: real resource route, public disabled contribution, cancellable delayed provider and unload/reload replacement. Use existing export normalization/lifecycle. For actual native denial verification only, private `pkg/main.go` may register non-sensitive Boolean `probe_deny_connections` default false; private `pkg/tasks.go` may read the existing injected plugin setting in `LoadConnections` and return typed `FORBIDDEN` with private provider canaries. Propagate configuration errors. Toggle/read/restore through existing SettingsClient; verify real RPC/host/palette error handling and no canary disclosure. This is provider fault injection, not proof of a new authorizer or permission policy; no host/SDK/API change is authorized.

Read-only: generic runtime registry/store/exports, selected UI CommandList/Dialog/CommandPalette and UI58 receipt, existing ResourceClient/SettingsProvider bindings, SDK. Existing PluginService ownership and APIs remain unchanged; `reload` may publish loading after reserving its inflight operation, and `unload` may publish unloading before awaiting cache clearance, so lifecycle subscribers synchronously retire stale search work and feedback. Do not change generic transition/notify semantics. No central four roadmap docs, Taskfile/workflows, generated bindings/shims/shared maps/release/API edits.

## 8. Complete acceptance and review barriers

All host113 criteria remain required; this draft does not narrow the packet:

1. Tests first, then explicit parent RED grant: actual Header Ctrl/Meta+K; named/focused combobox/list/dialog; setting navigation including same-page query changes; resource route; actual command-service effect; disabled/denial feedback and keyboard/focus/close/IME behavior.
2. Real existing-registry tests: contributions removed/replaced while selected, unload/reload under the same ID, stale retained activation refused, no old callable closure; provider cancellation, older query/closed-session late resolve AND reject, source-specific failures/truncation, and a valid external alias result whose label does not locally match the query.
3. Parent settled source barrier: scoped tests/typecheck/format via canonical managed tooling, no mid-flight checks. No Go/SDK/UI API work unless a precise missing existing API is reported and separately approved.
4. Actual canonical host/browser proof after parent launch grant: keyboard opens real header; find Appearance/Theme and focus the real editor; navigate native tasks resource route. For the exact allowed-command effect, establish private `workspace-probe/local`, invoke existing `ResourceClient.RemoveConnection(plugin, 'local')` to remove ONLY its owned host-cache entry, verify a fresh `ListConnections` omits it, execute palette `ResourceClient.LoadConnections(plugin)`, then verify fresh `ListConnections` restores the native ID/name. Existing RemoveConnection controller 1008–1027 touches only host cache; LoadConnections 776–812 invokes the registered native provider and merges that cache; the selected private provider really supplies local. No fixture backend change, file-behavior invention, production state or toast-only success claim.
5. Actual delayed external provider, safe disabled/denied outcome, close/focus, unload/reload and stale-action checks in the real host. Browser observations supplement, not replace, semantic regressions. No claim of production resource search, new permission isolation or full inventory correctness.
6. Independent contract freeze BEFORE production edits, independent settled-source review, then parent-owned publication/PR/admin merge and central evidence update. The selected UI58 proof is reused with its original component-only scope.

## 9. Local integration receipt — merge acceptance pending

The selected private host/plugin/UI workspace exercised the actual application endpoint, not the asset-only Vite server. The frozen instance identity, state root and generation were checked after restart and frontend replacement.

| Verification | Observed result |
| --- | --- |
| Focused palette/settings/header/extensions and all PluginService core tests | 460 passed across 20 files in 4.22 s |
| Production/test TypeScript and scoped ESLint | Passed |
| Private fixture native Go and UI typecheck | Passed; native Go execution 0.793 s |
| Keyboard and presentation | Real Ctrl/Meta+K, one focused combobox, active-option ownership, both Tab boundaries, Clear/Enter, Escape and opener restoration |
| Settings and resource navigation | Actual Theme editor focus; same-mounted category changes and identical-URL refocus; actual plugin capability route |
| Allowed native command | Remove only owned cached `local`; palette reload invokes native discovery; fresh host list restores `local` / `Private native tasks`. Pending status and actual completion survive a same-task query edit. |
| Provider denial | Same enabled command returns safe `FORBIDDEN` with correlation after a same-task query edit; private provider canaries absent; existing native setting restored false→true→false |
| External providers and lifecycle | Stateful original-method receiver returns an actionable nonmatching alias; source errors sanitized; older/closed results fenced; actual unload/load and same-task reload reject retired actions while new actions work |
| Pending native navigation | Actual Home row stays enabled while the native reload is busy, navigates and closes the palette; retired completion cannot enter the next session |

An independent `vercel-react-best-practices` and code-organization review approved the settled source with no Critical/Important findings. The lifecycle hook, dialog presentation and shared settings definitions have separate module boundaries; catalogue registration compares ordered semantic inputs without render-time ref reads, serialization keys or lint suppression.

The browser-specific focus regression remains in the sole application suite at `e2e/tests/layout/app-shell.spec.ts`; IME and lifecycle semantics remain in focused unit tests. Native provider-denial injection does not certify a new authorization policy. These results do not accept P43, production CEL/numeric/schema/query contracts or the remaining native-editor gates. PR checks, application-suite execution and merge acceptance remain separate publication gates.

## 10. Post-PR139 local UX revision — approved for publication

This follow-up supersedes the substring-only, static-first display allocation and open-only shortcut rules above. The original PR139 receipt remains historical evidence, not acceptance of these changes.

Human approval followed inspection of the running development instance on October 26, 2026. The final dialog title and accessible search labels are **Search Omniview**; the header placeholder remains **Search anything…**.

- Static entries use weighted label, keyword and description matching, including token abbreviations, subsequences and conservative one-edit word corrections. Exact labels rank above weaker matches. Matching still examines at most 1,000 admitted candidates; setting values remain excluded.
- The 100-row display budget is allocated round-robin across the static list and admitted provider lists, redistributing unused slots. Static entries retain local relevance order; each provider retains its own order. The presentation groups rows by kind, preserving order within each kind. Provider labels are never locally filtered or scored.
- Local results update immediately on query edits. External searches wait for a 150 ms pause; stale work is aborted immediately. Open and lifecycle refreshes search without this typing delay. Cancellation clears debounce timers and retains all existing registration, epoch and execution fences.
- Exact Ctrl+K or Meta+K toggles the palette. Shift, Alt, combined Ctrl+Meta, key repeats, IME and already-consumed events are ignored. Foreign dialogs and menus retain shortcut ownership.
- The header uses base-ui `SearchTrigger` with the exact Input shell styles, short search copy and a platform-specific Hotkey hint. Host CSS controls layout only, not appearance. `CommandList.ItemContent`, `ItemMeta` and `ItemDisabledReason` own the compact row layout: icon/title centers align, breadcrumb trails the title, description occupies one ellipsized second line, and disabled reasons wrap visibly. Independent hover highlighting is removed; actual pointer movement transfers the single active selection from keyboard navigation.

Local human inspection is required before commits or PR creation. After approval, publication includes focused checks, independent review, required CI, dependency-ordered releases, merge verification and actual release verification. Release the additive base-ui API first, then update the host's declared UI dependency to that published version before its standalone checks and merge. No SDK release is required by these presentation changes.

### Next platform slices

The command extension must resolve data-only action references through the existing extension registry and registered host adapters. Resource actions already have `GetActions`/`ExecuteAction` and execution-time admission in `backend/pkg/plugin/resource/controller.go`; do not add a privileged callback bus. Freeze argument validation, confirmation, lifecycle and authority rules before widening the palette's closed command union.

Resource search remains P43 over P35's authoritative multi-provider query service. Shared result controls and legacy client-side multi-List search are not that service. Scope chips, resource metadata, contextual actions and multistep selection must consume the real action/query contracts rather than inventing a partial client resource engine. Recents, caching and personalization remain separate follow-ups.
