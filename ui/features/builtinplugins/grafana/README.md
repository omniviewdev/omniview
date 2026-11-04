# Grafana metrics UI

Grafana's built-in entry exports normal routes, a plugin-settings body contribution, and a connection-settings contribution. The host selects settings bodies by the registration owner's plugin ID. Resource owners select connection-settings placement and supply public owner identity, supported resource types, and metadata. Neither generic renderer selects behavior by a provider or resource name.

The trusted static built-in composition marks this module `activation: 'startup'` because its settings contributions must exist in each main/settings document. Inventory cannot opt a module into startup: the common provider requires an own entry in the trusted module map and an enabled inventory descriptor. It uses the ordinary `PluginService.load` lifecycle for these explicit opt-ins, including backend activation before dynamic import; `loadAll` remains the external batch path and other built-ins remain on-demand. The same policy applies when an enabled startup module appears in a later inventory snapshot.

## Rendered surfaces

- Settings → Plugins → Grafana: Connections, Data sources, Global mappings.
- Grafana plugin root route `/`: the same global settings surface.
- Kubernetes → cluster edit → Configuration → Metrics: external provider connection, compatible datasource, source policy, public cluster scope, and sparse mapping overrides. Existing native configuration stays in the same section.
- Kubernetes Pods table: finite canonical resource observations drive CPU and memory cells.
- Pod and Node sidebars: explicit source and additional metric selection, live values/history, provenance, and unavailable/stale states.

Cluster edit status and native metric controls use canonical `useConnectionReadiness` state, not credential refresh timestamps. Live connected, disconnected, checking, connecting, denied, and error states remain distinct; changing readiness updates both the header and native metric gating.

Global connections accept a write-only read token. The token stays in an uncontrolled password input until save, is cleared before every editor identity switch and backend write, and is never copied into browser storage or a public connection DTO. Controls cannot switch connections during a pending save or connection test. Generation fences discard late save, test, and discovery completions after editor changes or unmount. Credentials remain backend-owned. Plain HTTP requires explicit opt-in and shows its security consequence.

The read-token step links to the official [Grafana service-account token instructions](https://grafana.com/docs/grafana/latest/administration/service-accounts/#add-a-token-to-a-service-account-in-grafana), which document **Administration → Users and access → Service accounts → Add service account token**. Cloud users instead get the official access-policy guidance. These links open documentation in the system browser; the app does not automatically create accounts or tokens.

Global definitions resolve by stable ID. A connection override contains only fields that differ. Reset removes that override; it does not copy a current global query into permanent local state. Each rendered connection contribution has an identity-scoped React lifetime. Save and discard affect only that connection. Global draft navigation uses the host's settings form registration.

The cluster Metrics page uses a two-column provider/source card and searchable, single-line mapping previews. Inherited and cluster-override chips reflect actual saved binding state. Mapping expansion edits in place using the same highlighted PromQL editor as Global mappings. Variables, schema browsing, and label discovery live under **Variables & identity**; the real sample picker lives under **Query test resource**. Manual datasource entry remains available under **Enter datasource UID**, and opens automatically for undiscovered saved UIDs or discovery failures. Native provider status, service overrides, connection tests, and auto-detection reference remain under **Native metrics configuration**. The quiet sticky action bar saves or discards only the current connection draft.

Cluster mapping lists and override counts include only definitions applicable to the resource types supplied by the owner. **Manage Grafana connections** opens the existing Grafana settings window; destructive removal remains under **Binding actions**.

Mapping validation has separate meanings:

1. **Validate definition** checks template interpolation and typed binding fields for the chosen datasource. It does not parse the full PromQL grammar or claim that a query returned data.
2. **Test query** requires a real owner-acquired canonical sample resource. The picker acquires a finite source-view snapshot with updates disabled; it does not require a live watch. Acquisition failures render the actual structured target/source/query error, not the source-failed boolean. Preview calls the host's admitted path and displays resource/metric identity, status, unit, freshness, revision, provenance, warnings, and returned value. Global settings without a sample context disable this action honestly.
3. **Discover labels** queries the selected provider connection and datasource with a bounded result limit. Manual typed input remains available when discovery is denied or unsupported.
4. **Test connection** checks reachability only. A successful health response does not prove datasource query permissions or that a token is read-only.

Successful field/template validation shows **Definition valid**; its tooltip explains that only **Test query** executes PromQL. Query previews show a compact table using the admitted sample's namespace/name, metric, real value/unit, and status. Zero remains zero; unavailable values stay a dash. Time-series summaries explicitly label the latest returned point and aggregate summaries label the average. Raw response, timestamps, revisions, and provenance remain available under **Response details & provenance**.

Datasource catalog access is optional. Both connection binding and global validation accept a manually entered Prometheus datasource UID while retaining any discovery error. Manual selection sets the datasource kind to Prometheus; backend admission validates the exact provider/connection/UID. Changing provider connection always clears the UID. A denied catalog never selects a direct-endpoint fallback.

Use **Add metric** to create additional reusable definitions with their own stable ID, name, applicability, canonical unit, gauge/rate semantics, declared result dimensions, typed bindings, and PromQL. A new definition follows the same validation and real sample-query workflow as presets. It persists through `SaveMetricDefinition`, rather than a browser-local selector option.

Comma-separated identity labels, applicable resource types, and result dimensions retain the exact text being typed, including trailing separators. Validation and persistence receive trimmed arrays separately, so typing another value never loses the comma or merges adjacent tokens.

The global mapping editor offers a temporary resource-owner/connection/type context for schema browsing and sample execution. This context is not persisted and never creates a cluster binding. The scalar field picker reads the actual connection's authoritative schema tier by tier. Object/map nodes navigate; only typed scalar leaves can be selected. Exact object-map keys preserve dots and encode `/` and `~` using RFC6901. The resulting `resource_path` stays separate from the template field symbol and label. The host reads the admitted canonical resource and forwards only selected scalar values, never the caller's full object.

Field bindings show a compact selected-path summary. **Browse** opens the bounded schema navigator on demand; selecting a scalar closes it. Type and required/optional markers remain in each field row, while longer descriptions are available on hover rather than repeated inline.

Pod sidebars initially follow the connection's saved source policy, matching tables. Native remains an explicit selection. Supplement bindings retain admitted native results alongside selected external metrics; replacement bindings do not display native results from another source selection.

## Source and release dependencies

The Go consumers pin published SDK `v0.14.7-0.20261104035605-e391d4f586e2`. The Kubernetes frontend requires the paired host/runtime source cohort for the new metrics hooks. Managed source verification does not establish compatibility with the currently declared registry runtime version.

Release the compatible host/npm cohort before updating Kubernetes runtime/Vite registry pins, lockfile, and marketplace minimum host version. Do not publish the Kubernetes feature against the old runtime or invent an unreleased package version. Source PRs and runtime evidence are separate from authorization to publish desktop, npm, or marketplace releases.

## Integration smoke steps

Run after the parent rebuilds runtime, then the Vite plugin, regenerates bindings with `task bindings`, and runs the ordered verification plan.

1. Open Settings, select Grafana, and use only keyboard navigation to open Connect Grafana. Confirm the three-step indicator spans its card at desktop and tablet widths.
2. Enter a real direct Prometheus/Mimir endpoint or Grafana gateway and the matching read credential. Save and test. Inspect public responses and browser storage: neither may contain the token.
3. Discover datasources. Create two reusable provider connections whose datasource UID strings overlap. Confirm their catalogs remain separate.
4. Open one Kubernetes cluster's Metrics section. Select a provider and datasource, set the real cluster scope, and save. Select another provider: datasource selection must clear, even when both providers reuse a UID.
5. Select a real pod sample. Expand a mapping, validate its definition, discover labels, then Test query. Verify returned statuses and identity, not merely a parser success message.
6. Edit one mapping's query or typed binding. Save connection metrics. Open another cluster; verify no draft or override leaked. Discard one cluster's edits and verify the other persisted state remains intact.
7. Edit a global mapping and revisit an inherited cluster. Verify inheritance follows the new revision, while another cluster's explicit override stays unchanged. Reset that override, save, and verify it uses the current global definition.
8. Open the Pods table with 24 pods, then a matching sidebar. Inspect actual provider query counts and confirm shared current observations do not trigger duplicate expressions. Add another sidebar metric explicitly.
9. Exercise missing, denied, partial, and expired results. Confirm missing is not zero, source provenance remains visible, and failures do not silently switch providers. Select Native explicitly and verify native metrics still work.
10. Move between clusters while a discovery, validation, or preview call is pending. Confirm late data never replaces the new connection's state.

Tests added here cover current-global inheritance, reset deletion, provider/datasource invalidation, template-versus-execution messaging, invalid query preservation, late validation generations, and quoted interpolation highlighting. Startup contribution regressions cover each document, backend-before-import ordering, disabled modules, and default on-demand modules. Kubernetes regression tests cover finite resource identity, missing-versus-zero presentation, persisted column visibility, and sidebar result presentation. No checks were run by the UI implementation agents; the integration owner supplies actual evidence.

## Exercised integration checks

The source cohort passed host and runtime typechecks, focused UI regressions, SDK tests, and host resource/metrics/Grafana race tests.

An actual Wails run queried 24 admitted Pods through Grafana: CPU and memory returned 48 values using two Prometheus queries. A matching current-value subset added no upstream query. Direct Prometheus over trusted tailnet HTTPS and rejection of an invalid Grafana credential were also exercised. A cold restart retained both provider connections. Actual connection-settings Reset to global followed by Save removed only the local override; global definitions and datasource selection remained unchanged.

Final source-cohort acceptance also exercised numeric Pod table and Metrics-tab rendering, selected network current/history values, global inheritance, isolated drafts, scoped overrides/reset, datasource isolation, and typed object-field transforms. A sidebar opened beyond detached-cache retention added no CPU/memory queries; adding network metrics issued only its instant and range queries. Altered, cross-Pod, and omitted known incarnations returned `RESET_REQUIRED` with zero provider queries; a matching identity succeeded.

Host and Kubernetes Go builds passed after managed overlays were removed, using the published SDK pin. Runtime typecheck and eight scheduling/hook tests passed; Kubernetes typecheck and 59 focused behavior tests passed. Source PRs and screenshots are linked from [epic #388](https://github.com/omniviewdev/omniview/issues/388). This is source-cohort evidence, not a desktop/npm/marketplace release.

During verification, a native Kubernetes catalog acquisition timed out. Existing catalog policy retained that error for 30 seconds; source views recovered through their existing explicit retry after the acquisition window. No SDK lifetime, timeout, or failure-cache policy was changed. The initial acquisition stall was not identified.
