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

// sourceMemberSize estimates value, envelope, and address-index storage before
// validation or canonical-key construction allocates. Go does not expose map
// bucket capacity or the backing storage of aliased strings.
func sourceMemberSize(o resourcev2.SourceObservation, limit int) (int, error) {
	size := 1024
	add := func(n, multiplier int) bool {
		if n < 0 || n > (limit-size)/multiplier {
			return false
		}
		size += n * multiplier
		return true
	}
	text := func(s string) bool { return add(len(s), 8) }
	optional := func(s *string) bool { return s == nil || text(*s) }
	var value func(resourcev2.Value, int) bool
	value = func(v resourcev2.Value, depth int) bool {
		if depth > resourcev2.MaxValueDepth || !add(1, 256) || !add(cap(v.List)-len(v.List), 256) ||
			!text(v.Kind) || !text(v.String) || !text(v.Int) || !text(v.Uint) || !text(v.Timestamp) {
			return false
		}
		for _, child := range v.List {
			if !value(child, depth+1) {
				return false
			}
		}
		for key, child := range v.Map {
			if !text(key) || !value(child, depth+1) {
				return false
			}
		}
		return true
	}
	r := o.Record
	a := r.Reference.Address
	ok := size <= limit && text(a.Provider) && text(a.Authority) && text(a.Type) && text(a.ID) &&
		add(cap(a.Scope), 256) && optional(r.Reference.Incarnation) &&
		text(r.Representation.ID) && text(r.Representation.Revision) && optional(r.Representation.SchemaRevision) &&
		text(r.Coverage.Kind) && text(r.Coverage.Reason) && add(cap(r.Coverage.Paths), 256) &&
		optional(r.SourceRevision) && optional(o.DisplayName) && value(r.Body, 1) &&
		add(cap(o.DocumentCoverage.KnownAbsent), 256)
	for _, scope := range a.Scope {
		ok = ok && text(scope.Dimension) && text(scope.Value)
	}
	for _, path := range r.Coverage.Paths {
		ok = ok && text(path)
	}
	if o.Metadata != nil {
		ok = ok && add(len(o.Metadata.Labels), 256)
		for key, val := range o.Metadata.Labels {
			ok = ok && text(key) && text(val)
		}
	}
	for _, path := range o.DocumentCoverage.KnownAbsent {
		ok = ok && add(cap(path.Segments), 256)
		for _, segment := range path.Segments {
			ok = ok && optional(segment.Member)
		}
	}
	if !ok {
		return 0, resourcev2.NewError("RESOURCE_LIMIT", "Source observation exceeds host limits.")
	}
	return size, nil
}

func makeSourceMember(o resourcev2.SourceObservation, limit int) (sourceMember, string, error) {
	size, err := sourceMemberSize(o, limit)
	if err != nil {
		return sourceMember{}, "", err
	}
	if _, err := resourcev2.SourceObservationWireSize(o); err != nil {
		return sourceMember{}, "", err
	}
	key, err := registry.CanonicalAddressKey(o.Record.Reference.Address)
	if err != nil {
		return sourceMember{}, "", err
	}
	return sourceMember{observation: o, size: size}, key, nil
}

// sourceFramePreflight accounts for the whole frame before tracker admission.
func sourceFramePreflight(frame resourcev2.SourceFrame) error {
	const limit = maxSourceSessionBytes
	size := 1024
	add := func(n, multiplier int) bool {
		if n < 0 || n > (limit-size)/multiplier {
			return false
		}
		size += n * multiplier
		return true
	}
	text := func(s string) bool { return add(len(s), 8) }
	optional := func(s *string) bool { return s == nil || text(*s) }
	coverage := func(c resourcev2.SourceCoverage) bool {
		if !text(c.Enumeration) || !text(c.Consistency) || !add(cap(c.Limitations), 256) {
			return false
		}
		for _, item := range c.Limitations {
			if !text(item) {
				return false
			}
		}
		return true
	}
	member := func(o resourcev2.SourceObservation, memberLimit int) bool {
		n, err := sourceMemberSize(o, memberLimit)
		return err == nil && add(n, 1)
	}
	ok := text(frame.SessionID) && text(frame.Generation)
	if frame.Begin != nil {
		ok = ok && text(frame.Begin.Mode)
	}
	if frame.Snapshot != nil {
		ok = ok && add(cap(frame.Snapshot.Observations), 256)
		for _, observation := range frame.Snapshot.Observations {
			ok = ok && member(observation, defaultSourceStagingBytes)
		}
	}
	if frame.SnapshotEnd != nil {
		ok = ok && coverage(frame.SnapshotEnd.Coverage) && text(frame.SnapshotEnd.Continuity)
	}
	if frame.Changes != nil {
		ok = ok && add(cap(frame.Changes.Changes), 256)
		for _, change := range frame.Changes.Changes {
			ok = ok && text(change.Kind) && optional(change.SourceRevision)
			if change.Observation != nil {
				ok = ok && member(*change.Observation, limit)
			}
			if change.Reference != nil {
				ok = ok && member(resourcev2.SourceObservation{Record: resourcev2.SourceRecord{Reference: *change.Reference}}, limit)
			}
		}
		if frame.Changes.Coverage != nil {
			ok = ok && coverage(*frame.Changes.Coverage)
		}
	}
	if frame.Reset != nil {
		ok = ok && text(frame.Reset.Reason) && text(frame.Reset.Message)
	}
	if frame.Failed != nil {
		ok = ok && text(frame.Failed.Code) && text(frame.Failed.Message)
	}
	if !ok {
		return resourcev2.NewError("RESOURCE_LIMIT", "Source frame exceeds host limits.")
	}
	return nil
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
