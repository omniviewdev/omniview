package metric

import (
	"context"
	"sort"

	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

type finiteSourceLane struct {
	source            sdk.MetricSourceRef
	context           sdk.MetricQueryContext
	metrics           []string
	defaultSource     bool
	metricSources     map[string]sdk.MetricSourceRef
	catalogSource     sdk.MetricSourceRef
	configurationKeys []finiteConfigurationKey
}

func (lane finiteSourceLane) acceptsMetric(id string) bool {
	if selected, ok := lane.metricSources[id]; ok {
		return selected == lane.source
	}
	return lane.defaultSource
}

// configurationSnapshot permits native-only controllers before profile wiring.
// Once storage is attached, every storage failure is returned to the caller.
func (c *controller) configurationSnapshot(request ResourceMetricsCatalogRequest, defaults []sdk.MetricDefinition, preview *sdk.MetricDefinition) (persistedMetrics, error) {
	c.mux.RLock()
	s := c.metricState
	c.mux.RUnlock()
	if s == nil {
		return persistedMetrics{}, nil
	}
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return persistedMetrics{}, err
	}
	scoped := persistedMetrics{Defaults: s.data.Defaults}
	applicable := map[string]bool{}
	for _, definition := range defaults {
		for _, key := range definition.ResourceKeys {
			if key == request.ResourceKey {
				applicable[definition.ID] = true
				break
			}
		}
	}
	for _, definition := range s.data.Definitions {
		matches := false
		for _, key := range definition.ResourceKeys {
			if key == request.ResourceKey {
				matches = true
				break
			}
		}
		if applicable[definition.ID] || matches {
			scoped.Definitions = append(scoped.Definitions, definition)
			applicable[definition.ID] = matches
		}
	}
	if preview != nil {
		matches := false
		for _, key := range preview.ResourceKeys {
			if key == request.ResourceKey {
				matches = true
				break
			}
		}
		applicable[preview.ID] = matches
	}
	for _, binding := range s.data.Bindings {
		if binding.ResourcePluginID != request.OwnerPluginID || binding.ResourceConnectionID != request.OwnerConnectionID || (request.BindingID != "" && request.BindingID != binding.ID) {
			continue
		}
		selected := binding
		selected.Overrides = nil
		for _, override := range binding.Overrides {
			if applicable[override.MetricID] {
				selected.Overrides = append(selected.Overrides, override)
			}
		}
		scoped.Bindings = append(scoped.Bindings, selected)
		break
	}
	if request.Source == nil {
		for _, selection := range s.data.ViewSources {
			if selection.OwnerPluginID == request.OwnerPluginID && selection.OwnerConnectionID == request.OwnerConnectionID && selection.ResourceKey == request.ResourceKey {
				scoped.ViewSources = append(scoped.ViewSources, selection)
				break
			}
		}
	}
	return copyJSON(scoped), nil
}
func applyMetricOverride(d sdk.MetricDefinition, o sdk.MetricDefinitionOverride) sdk.MetricDefinition {
	if o.Query != nil {
		d.Query = *o.Query
	}
	if o.FieldBindings != nil {
		d.FieldBindings = append([]sdk.MetricFieldBinding(nil), (*o.FieldBindings)...)
	}
	if o.IdentityLabels != nil {
		d.IdentityLabels = append([]string(nil), (*o.IdentityLabels)...)
	}
	if o.Reducer != nil {
		d.Reducer = *o.Reducer
	}
	if o.BatchStrategy != nil {
		d.BatchStrategy = *o.BatchStrategy
	}
	return d
}
func (c *controller) resolveFiniteSources(ctx context.Context, request ResourceMetricsCatalogRequest, ids []string, preview *sdk.MetricDefinition) ([]finiteSourceLane, error) {
	if request.OwnerPluginID == "" || request.OwnerConnectionID == "" || request.ResourceKey == "" {
		return nil, finiteError("INVALID_REQUEST", "Owner connection and resource key are required.")
	}
	catalog, err := c.rawMetricOwnerCatalog(ctx, request.OwnerPluginID, request.OwnerConnectionID)
	if err != nil {
		return nil, err
	}
	definitions := catalog.Definitions
	data, err := c.configurationSnapshot(request, definitions, preview)
	if err != nil {
		return nil, err
	}
	var binding *sdk.MetricBinding
	for i := range data.Bindings {
		b := &data.Bindings[i]
		if b.ResourcePluginID == request.OwnerPluginID && b.ResourceConnectionID == request.OwnerConnectionID && (request.BindingID == "" || request.BindingID == b.ID) {
			binding = b
			break
		}
	}
	if binding != nil && (binding.Signal != "metrics" || (binding.Policy != "" && binding.Policy != "replace")) {
		return nil, finiteError("UNSUPPORTED", "Selected binding does not use finite replacement semantics.")
	}
	if request.BindingID != "" && binding == nil {
		return nil, finiteError("NOT_FOUND", "Selected metric binding does not belong to this owner.")
	}
	source := sdk.MetricSourceRef{PluginID: request.OwnerPluginID, ConnectionID: request.OwnerConnectionID, Native: true}
	if data.Defaults.Source != nil {
		if data.Defaults.Source.Native {
			return nil, finiteError("INVALID_REQUEST", "Native profile defaults must use an empty source.")
		}
		source = *data.Defaults.Source
	}
	if binding != nil && binding.Source != (sdk.MetricSourceRef{}) {
		source = binding.Source
	}
	explicitSelection := request.Source != nil
	viewMode := "inherit"
	if request.Source == nil {
		for _, selection := range data.ViewSources {
			if selection.OwnerPluginID != request.OwnerPluginID || selection.OwnerConnectionID != request.OwnerConnectionID || selection.ResourceKey != request.ResourceKey {
				continue
			}
			viewMode = selection.Mode
			switch selection.Mode {
			case "inherit":
			case "native":
				source = sdk.MetricSourceRef{PluginID: request.OwnerPluginID, ConnectionID: request.OwnerConnectionID, Native: true}
				explicitSelection = true
			case "external":
				if selection.Source == nil {
					return nil, finiteError("INVALID_REQUEST", "Saved external view source is incomplete.")
				}
				source = *selection.Source
				explicitSelection = true
			default:
				return nil, finiteError("INVALID_REQUEST", "Saved view source mode is invalid.")
			}
			break
		}
	}
	if request.Source != nil {
		source = *request.Source
	}
	byID := map[string]sdk.MetricDefinition{}
	for _, d := range definitions {
		byID[d.ID] = d
	}
	for _, d := range data.Definitions {
		if owner, exists := byID[d.ID]; exists && (owner.Unit != d.Unit || metricDigest(owner.ResourceKeys) != metricDigest(d.ResourceKeys) || owner.Native != d.Native) {
			return nil, finiteError("INVALID_REQUEST", "Saved definition changes owner metric semantics.")
		}
		byID[d.ID] = d
	}
	if preview != nil {
		if owner, exists := byID[preview.ID]; exists && (owner.Unit != preview.Unit || metricDigest(owner.ResourceKeys) != metricDigest(preview.ResourceKeys) || owner.Native != preview.Native) {
			return nil, finiteError("INVALID_REQUEST", "Preview changes owner metric semantics.")
		}
		byID[preview.ID] = *preview
	}
	overrides := map[string]sdk.MetricDefinitionOverride{}
	scope := map[string]string{}
	if binding != nil {
		if err := validateOwnerScope(binding.PublicScope, catalog); err != nil {
			return nil, err
		}
		for k, v := range binding.PublicScope {
			scope[k] = v
		}
		for _, o := range binding.Overrides {
			overrides[o.MetricID] = o
		}
	}
	applicable := []sdk.MetricDefinition{}
	for _, d := range byID {
		matches := false
		for _, key := range d.ResourceKeys {
			if key == request.ResourceKey {
				matches = true
				break
			}
		}
		if !matches {
			continue
		}
		if o, ok := overrides[d.ID]; ok && (preview == nil || preview.ID != d.ID) {
			d = applyMetricOverride(d, o)
		}
		if err := validateOwnerDefinitionScope(d, catalog); err != nil {
			return nil, err
		}
		if err = validateConfiguredMetricDefinition(d); err != nil {
			return nil, err
		}
		applicable = append(applicable, d)
	}
	sort.Slice(applicable, func(i, j int) bool { return applicable[i].ID < applicable[j].ID })
	// Include all definitions assigned to a lane, not only the visible metric subset.
	// This keeps exact-subset sharing stable while still partitioning mapping edits.
	laneDefinitions := func(selected sdk.MetricSourceRef) []sdk.MetricDefinition {
		if selected.Native {
			return nil
		}
		out := []sdk.MetricDefinition{}
		for _, d := range applicable {
			assigned := source
			if !explicitSelection {
				if o, ok := overrides[d.ID]; ok && o.Source != nil {
					assigned = *o.Source
				}
			}
			if assigned == selected {
				out = append(out, d)
			}
		}
		return out
	}
	sources := []sdk.MetricSourceRef{source}
	metricSources := map[string]sdk.MetricSourceRef{}
	if !explicitSelection {
		for id, o := range overrides {
			if o.Source != nil {
				metricSources[id] = *o.Source
				exists := false
				for _, old := range sources {
					exists = exists || old == *o.Source
				}
				if !exists {
					sources = append(sources, *o.Source)
				}
			}
		}
	}
	sort.Slice(sources[1:], func(i, j int) bool { return metricDigest(sources[i+1]) < metricDigest(sources[j+1]) })
	lanes := []finiteSourceLane{}
	for _, selected := range sources {
		metricIDs := []string{}
		for _, id := range ids {
			assigned := source
			if !explicitSelection {
				if o, ok := overrides[id]; ok && o.Source != nil {
					assigned = *o.Source
				}
			}
			if assigned == selected {
				metricIDs = append(metricIDs, id)
			}
		}
		if len(ids) > 0 && len(metricIDs) == 0 {
			continue
		}
		if err := c.validateOwnerMetricSource(ctx, selected, request.OwnerPluginID, request.OwnerConnectionID); err != nil {
			return nil, err
		}
		mappings := laneDefinitions(selected)
		laneScope := scope
		if selected.Native {
			laneScope = nil
		}
		revision := metricDigest([]any{request.ResourceKey, selected, laneScope, mappings})
		keys := []finiteConfigurationKey{{kind: "source", plugin: selected.PluginID, connection: selected.ConnectionID}}
		if request.Source == nil {
			keys = append(keys, finiteConfigurationKey{kind: "view", plugin: request.OwnerPluginID, connection: request.OwnerConnectionID, resource: request.ResourceKey})
		}
		if !selected.Native || !explicitSelection {
			keys = append(keys, finiteConfigurationKey{kind: "binding", plugin: request.OwnerPluginID, connection: request.OwnerConnectionID})
		}
		if !explicitSelection && viewMode == "inherit" && (binding == nil || binding.Source == (sdk.MetricSourceRef{})) && selected == source {
			keys = append(keys, finiteConfigurationKey{kind: "defaults"})
		}
		if !selected.Native {
			for _, definition := range mappings {
				keys = append(keys, finiteConfigurationKey{kind: "definition", resource: definition.ID})
			}
			if selected == source {
				keys = append(keys, finiteConfigurationKey{kind: "definitions", resource: request.ResourceKey})
			}
		}
		lanes = append(lanes, finiteSourceLane{source: selected, context: sdk.MetricQueryContext{Definitions: mappings, PublicScope: laneScope, MappingRevision: revision}, metrics: metricIDs, defaultSource: selected == source, metricSources: metricSources, catalogSource: source, configurationKeys: keys})
	}
	return lanes, nil
}
func (c *controller) finiteSourceContext(ctx context.Context, source sdk.MetricSourceRef) (*sdktypes.PluginContext, error) {
	if source.Native {
		return c.getConnectedCtx(ctx, source.PluginID, source.ConnectionID)
	}
	c.mux.RLock()
	client := c.clients[source.PluginID]
	c.mux.RUnlock()
	if _, private := client.(sdk.ProviderConfiguration); private {
		return &sdktypes.PluginContext{Context: ctx, Connection: &sdktypes.Connection{ID: source.ConnectionID}}, nil
	}
	return c.getConnectedCtx(ctx, source.PluginID, source.ConnectionID)
}
func (c *controller) PreviewMetricDefinition(ctx context.Context, spec MetricsObservationSpec, definition sdk.MetricDefinition) (*sdk.ResourceMetricsResponse, error) {
	if err := validateConfiguredMetricDefinition(definition); err != nil {
		return nil, err
	}
	spec.MetricIDs = []string{definition.ID}
	ctx, cancel := context.WithTimeout(ctx, resourceMetricsTimeout)
	defer cancel()
	return c.readFiniteResolved(ctx, spec, true, nil, nil, &definition)
}

func (f *finiteCoordinator) fenceFiniteSources(ctx context.Context, request ResourceMetricsCatalogRequest, lanes []finiteSourceLane, generation, serial uint64, preview *sdk.MetricDefinition) (func() error, error) {
	f.mu.Lock()
	keys := map[metricStreamKey]uint64{{request.OwnerPluginID, request.OwnerConnectionID}: 0}
	dependencies := finiteLaneConfigurationKeys(lanes)
	for _, lane := range lanes {
		keys[metricStreamKey{lane.source.PluginID, lane.source.ConnectionID}] = 0
	}
	if f.stopped || f.configurationChanges > 0 || f.configuration != generation || !f.configurationCurrentLocked(dependencies, serial) {
		f.mu.Unlock()
		return nil, profileChangingError()
	}
	for key := range keys {
		if f.blocked[key] > 0 {
			f.mu.Unlock()
			return nil, profileChangingError()
		}
		if _, exists := f.epochs[key]; !exists && len(f.epochs) >= 4096 {
			f.mu.Unlock()
			return nil, finiteError("RESOURCE_LIMIT", "Metric connection generation limit exceeded.")
		}
		keys[key] = f.epochs[key]
		f.epochs[key] = keys[key]
	}
	f.mu.Unlock()
	ids := []string{}
	expected := make(map[sdk.MetricSourceRef]string, len(lanes))
	for _, lane := range lanes {
		ids = append(ids, lane.metrics...)
		expected[lane.source] = lane.context.MappingRevision
	}
	return func() error {
		f.mu.Lock()
		current := !f.stopped && f.configurationChanges == 0 && f.configuration == generation && f.configurationCurrentLocked(dependencies, serial)
		for key, epoch := range keys {
			current = current && f.blocked[key] == 0 && f.epochs[key] == epoch
		}
		f.mu.Unlock()
		if !current {
			return profileChangingError()
		}
		resolved, err := f.c.resolveFiniteSources(ctx, request, ids, preview)
		if err != nil {
			return err
		}
		if len(resolved) != len(expected) {
			return profileChangingError()
		}
		for _, lane := range resolved {
			if expected[lane.source] != lane.context.MappingRevision {
				return profileChangingError()
			}
		}
		f.mu.Lock()
		current = !f.stopped && f.configurationChanges == 0 && f.configuration == generation && f.configurationCurrentLocked(dependencies, serial)
		for key, epoch := range keys {
			current = current && f.blocked[key] == 0 && f.epochs[key] == epoch
		}
		f.mu.Unlock()
		if !current {
			return profileChangingError()
		}
		return nil
	}, nil
}

// Mapping changes retire all dependent samples, catalogs, and observation state.
// Credentials remain in provider-owned stores and never enter this cache.
func (c *controller) invalidateMetricConfiguration() {
	f := c.finite.Load()
	if f == nil {
		return
	}
	f.mu.Lock()
	f.configuration++
	for id, read := range f.catalogs {
		f.cancelCatalogLocked(id, read)
	}
	clear(f.catalogs)
	for job := range f.jobs {
		job.retireLocked()
		for w := range job.waiters {
			delete(f.pending, w)
			f.finishWaiter(w, profileChangingError())
		}
		clear(job.waiters)
	}
	for w := range f.pending {
		f.finishWaiter(w, profileChangingError())
	}
	clear(f.pending)
	clear(f.cache)
	f.cache = nil
	var publish []*finiteObservation
	for key, o := range f.observations {
		f.forgetObservationLocked(key, o)
		o.snapshot.Data = nil
		o.snapshot.Catalog = nil
		if o.spec.DurationMs > 0 {
			o.snapshot.DomainStart = nil
			o.snapshot.DomainEnd = nil
		}
		o.snapshot.Fetching = false
		o.snapshot.Invalidated = true
		o.snapshot.Error = "Metric source configuration changed."
		o.snapshot.Sequence++
		publish = append(publish, o)
	}
	f.mu.Unlock()
	for _, o := range publish {
		o.publish()
	}
	f.signal()
}

func (c *controller) beginMetricConfigurationChange(keys ...finiteConfigurationKey) func() {
	if len(keys) > 0 {
		return c.beginScopedMetricConfigurationChange(keys)
	}
	f := c.finiteCoordinator()
	f.mu.Lock()
	f.configurationChanges++
	f.mu.Unlock()
	c.invalidateMetricConfiguration()
	return func() {
		c.invalidateMetricConfiguration()
		f.mu.Lock()
		f.configurationChanges--
		f.mu.Unlock()
		f.signal()
	}
}
