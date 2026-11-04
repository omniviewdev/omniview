# Grafana metrics UI

Grafana's built-in entry exports normal routes, a plugin-settings body contribution, and a connection-settings contribution. The host selects settings bodies by the registration owner's plugin ID. Resource owners select connection-settings placement and supply public owner identity, supported resource types, and metadata. Neither generic renderer selects behavior by a provider or resource name.

## Rendered surfaces

- Settings → Plugins → Grafana: Connections, Data sources, Global mappings.
- Grafana plugin root route `/`: the same global settings surface.
- Kubernetes → cluster edit → Configuration → Metrics: external provider connection, compatible datasource, source policy, public cluster scope, and sparse mapping overrides. Existing native configuration stays in the same section.
- Kubernetes Pods table: finite canonical resource observations drive CPU and memory cells.
- Pod and Node sidebars: explicit source and additional metric selection, live values/history, provenance, and unavailable/stale states.

Global connections accept a write-only read token. The token stays in an uncontrolled password input until save, is cleared before the backend request, and is never copied into browser storage or a public connection DTO. Credentials remain backend-owned. Plain HTTP requires explicit opt-in and shows its security consequence.

Global definitions resolve by stable ID. A connection override contains only fields that differ. Reset removes that override; it does not copy a current global query into permanent local state. Each rendered connection contribution has an identity-scoped React lifetime. Save and discard affect only that connection. Global draft navigation uses the host's settings form registration.

Mapping validation has separate meanings:

1. **Validate definition** checks syntax and typed binding schema for the chosen datasource. It does not claim that a query returned data.
2. **Test query** requires a real owner-acquired canonical sample resource. It calls the host's admitted preview path and displays resource/metric identity, status, unit, freshness, revision, provenance, warnings, and returned value. Global settings without a sample context disable this action honestly.
3. **Discover labels** queries the selected provider connection and datasource with a bounded result limit. Manual typed input remains available when discovery is denied or unsupported.
4. **Test connection** checks reachability only. A successful health response does not prove datasource query permissions or that a token is read-only.

Datasource catalog access is optional. Both connection binding and global validation accept a manually entered Prometheus datasource UID while retaining any discovery error. Manual selection sets the datasource kind to Prometheus; backend admission validates the exact provider/connection/UID. Changing provider connection always clears the UID. A denied catalog never selects a direct-endpoint fallback.

Use **Add metric** to create additional reusable definitions with their own stable ID, name, applicability, canonical unit, gauge/rate semantics, declared result dimensions, typed bindings, and PromQL. A new definition follows the same validation and real sample-query workflow as presets. It persists through `SaveMetricDefinition`, rather than a browser-local selector option.

The global mapping editor offers a temporary resource-owner/connection/type context for schema browsing and sample execution. This context is not persisted and never creates a cluster binding. The scalar field picker reads the actual connection's authoritative schema tier by tier. Object/map nodes navigate; only typed scalar leaves can be selected. Exact object-map keys preserve dots and encode `/` and `~` using RFC6901. The resulting `resource_path` stays separate from the template field symbol and label. The host reads the admitted canonical resource and forwards only selected scalar values, never the caller's full object.

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

Tests added here cover current-global inheritance, reset deletion, provider/datasource invalidation, syntax-versus-execution messaging, invalid query preservation, and late validation generations. Kubernetes regression tests cover finite resource identity, missing-versus-zero presentation, persisted column visibility, and sidebar result presentation. No checks were run by the UI implementation agents; the integration owner supplies actual evidence.
