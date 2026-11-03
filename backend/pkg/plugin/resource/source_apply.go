package resource

import (
	"context"
	"encoding/json"
	"maps"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/indexer"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type sourceMember struct {
	observation resourcev2.SourceObservation
	size        int
}

// sourceValueNodes counts retained value containers without allocating.
func sourceValueNodes(value resourcev2.Value) int {
	nodes := 1
	for _, child := range value.List {
		nodes += sourceValueNodes(child)
	}
	for _, child := range value.Map {
		nodes += sourceValueNodes(child)
	}
	return nodes
}

func makeSourceMember(o resourcev2.SourceObservation) (sourceMember, string, error) {
	size, err := resourcev2.SourceObservationWireSize(o)
	if err != nil {
		return sourceMember{}, "", err
	}
	// Account conservatively for Go value/map envelopes and the address index,
	// not just the protobuf payload. Compute this before allocating the key.
	size = size*4 + sourceValueNodes(o.Record.Body)*256 + 1024
	size += 256 * (len(o.Record.Reference.Address.Scope) + len(o.Record.Coverage.Paths))
	if o.Metadata != nil {
		size += 256 * len(o.Metadata.Labels)
	}
	for _, path := range o.DocumentCoverage.KnownAbsent {
		size += 256 * (1 + len(path.Segments))
	}
	key, err := registry.CanonicalAddressKey(o.Record.Reference.Address)
	if err != nil {
		return sourceMember{}, "", err
	}
	return sourceMember{observation: o, size: size}, key, nil
}

func (c *controller) observeSourceRecord(ctx context.Context, pluginID string, generation *pluginState, route resourcev2.AccessRoute, record resourcev2.Record, metadata *resourcev2.ResourceMetadata) error {
	if err := c.validateReference(ctx, pluginID, route, record.Reference); err != nil {
		return err
	}
	return c.observeValidatedSourceRecord(ctx, pluginID, generation, route, record, metadata)
}

func (c *controller) observeValidatedSourceRecord(ctx context.Context, pluginID string, generation *pluginState, route resourcev2.AccessRoute, record resourcev2.Record, metadata *resourcev2.ResourceMetadata) error {
	if err := resourcev2.ValidateRecord(record); err != nil {
		return err
	}
	native, err := resourcev2.NativeFromValue(record.Body)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(native)
	if err != nil {
		return err
	}
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	if err := c.currentGenerationLocked(ctx, pluginID, generation); err != nil {
		return err
	}
	if !c.referenceCurrentLocked(pluginID, route, record.Reference) {
		return resourcev2.NewError("CANCELLED", "observation route authority retired")
	}
	entry := registry.ResourceEntry{PluginID: pluginID, Reference: record.Reference, Route: route}
	entry.Reference.Address.Scope = append([]resourcev2.ScopeEntry{}, record.Reference.Address.Scope...)
	if record.Reference.Incarnation != nil {
		token := *record.Reference.Incarnation
		entry.Reference.Incarnation = &token
	}
	if metadata != nil {
		entry.Labels = maps.Clone(metadata.Labels)
		if metadata.CreatedAt != nil {
			entry.CreatedAt = *metadata.CreatedAt
		}
	} else if previous, ok := c.registryStore.Get(pluginID, record.Reference, route); ok {
		entry.Labels = previous.Labels
		entry.CreatedAt = previous.CreatedAt
	}
	old, existed := c.registryStore.Put(entry)
	event := indexer.Event{Type: indexer.EventAdd, Entry: entry, Old: old, Raw: raw}
	if existed {
		event.Type = indexer.EventUpdate
	}
	c.dispatcher.Enqueue(event)
	return nil
}

func (c *controller) observeRecord(ctx context.Context, pluginID string, route resourcev2.AccessRoute, record resourcev2.Record) error {
	c.pluginsMu.RLock()
	generation := c.plugins[pluginID]
	c.pluginsMu.RUnlock()
	return c.observeSourceRecord(ctx, pluginID, generation, route, record, nil)
}

func (s *sourceSession) deleteRecord(ref resourcev2.ResourceReference) {
	s.deleteRecordContext(s.ctx, ref)
}

func (s *sourceSession) deleteRecordContext(ctx context.Context, ref resourcev2.ResourceReference) {
	if ctx == nil {
		ctx = s.ctx
	}
	c := s.coordinator.ctrl
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	if c.currentGenerationLocked(ctx, s.pluginID, s.pluginGeneration) != nil || !c.referenceCurrentLocked(s.pluginID, s.target.Route, ref) {
		return
	}
	old, ok := c.registryStore.Delete(s.pluginID, ref, s.target.Route)
	if ok && old != nil {
		c.dispatcher.Enqueue(indexer.Event{Type: indexer.EventDelete, Entry: *old})
	}
}
