package resource

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/indexer"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// HostWatchRecordEvent retains the acquisition membership of each live consumer.
type HostWatchRecordEvent struct {
	Route     resource.AccessRoute      `json:"route"`
	Record    HostRecord                `json:"record"`
	Metadata  resource.ResourceMetadata `json:"metadata"`
	Guarantee string                    `json:"guarantee"`
}

type HostWatchDeleteEvent struct {
	Route      resource.AccessRoute       `json:"route"`
	Reference  resource.ResourceReference `json:"reference"`
	Key        string                     `json:"key"`
	AddressKey string                     `json:"addressKey"`
	TargetID   string                     `json:"targetId"`
	LastKnown  *HostRecord                `json:"lastKnown,omitempty"`
	Guarantee  string                     `json:"guarantee"`
}

// HostWatchStateEvent adds host provenance only to the global state channel.
type HostWatchStateEvent struct {
	resource.WatchStateEvent
	PluginID string `json:"pluginID"`
}

// engineWatchSink retains advisory updates independently of frontend subscriptions.
// Best-effort updates do not establish snapshot, replay, or gap-free continuity.
type engineWatchSink struct {
	ctx          context.Context
	generationID string
	pluginID     string
	ctrl         *controller
	store        registry.Store
	dispatcher   *indexer.Dispatcher
}

var _ resource.WatchEventSink = (*engineWatchSink)(nil)

// activeLocked requires pluginsMu.RLock. Holding the lock through mutation keeps
// a retired generation from writing after its replacement becomes visible.
func (s *engineWatchSink) activeLocked() bool {
	state := s.ctrl.plugins[s.pluginID]
	return s.ctx != nil && s.ctx.Err() == nil && state != nil && state.ctx != nil && s.generationID != "" && state.generationID == s.generationID && state.ctx.Err() == nil
}

func (s *engineWatchSink) observe(route resource.AccessRoute, record resource.Record, metadata *resource.ResourceMetadata) error {
	if s.ctx == nil {
		return resource.NewError("INVALID_REQUEST", "observation context is required")
	}
	if err := s.ctx.Err(); err != nil {
		return err
	}
	if err := s.ctrl.validateReference(s.ctx, s.pluginID, route, record.Reference); err != nil {
		return err
	}
	if err := resource.ValidateRecord(record); err != nil {
		return err
	}
	native, err := resource.NativeFromValue(record.Body)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(native)
	if err != nil {
		return err
	}
	s.ctrl.pluginsMu.RLock()
	defer s.ctrl.pluginsMu.RUnlock()
	if !s.activeLocked() || !s.ctrl.referenceCurrentLocked(s.pluginID, route, record.Reference) {
		return resource.NewError("CANCELLED", "observation generation or route authority retired")
	}
	entry := registry.ResourceEntry{PluginID: s.pluginID, Reference: record.Reference, Route: route}
	entry.Reference.Address.Scope = append([]resource.ScopeEntry{}, record.Reference.Address.Scope...)
	if record.Reference.Incarnation != nil {
		token := *record.Reference.Incarnation
		entry.Reference.Incarnation = &token
	}
	if metadata != nil {
		entry.Labels = maps.Clone(metadata.Labels)
		if metadata.CreatedAt != nil {
			entry.CreatedAt = *metadata.CreatedAt
		}
	} else if previous, ok := s.store.Get(s.pluginID, record.Reference, route); ok {
		entry.Labels = previous.Labels
		entry.CreatedAt = previous.CreatedAt
	}
	old, existed := s.store.Put(entry)
	event := indexer.Event{Type: indexer.EventAdd, Entry: entry, Old: old, Raw: raw}
	if existed {
		event.Type = indexer.EventUpdate
	}
	s.dispatcher.Enqueue(event)
	return nil
}

// observeRecord indexes a finite observation without fabricating live readiness.
func (c *controller) observeRecord(ctx context.Context, pluginID string, route resource.AccessRoute, record resource.Record) error {
	c.pluginsMu.RLock()
	state := c.plugins[pluginID]
	generationID := ""
	if state != nil {
		generationID = state.generationID
	}
	c.pluginsMu.RUnlock()
	sink := engineWatchSink{ctx: ctx, generationID: generationID, pluginID: pluginID, ctrl: c, store: c.registryStore, dispatcher: c.dispatcher}
	return sink.observe(route, record, nil)
}

// targetContainsReference only handles already-validated exact identities.
// An unrestricted query-only dimension need not appear in the address. A
// constrained dimension absent from identity is unknown, not membership proof;
// these best-effort events carry no native query-target provenance.
func targetContainsReference(target resource.ReadTarget, route resource.AccessRoute, reference resource.ResourceReference) bool {
	address := reference.Address
	if target.Route != route || target.Provider != address.Provider || target.Authority != address.Authority || target.Type != address.Type {
		return false
	}
	for _, constraint := range target.Scope {
		found := constraint.Match == resource.ScopeAny
		for _, entry := range address.Scope {
			if entry.Dimension != constraint.Dimension {
				continue
			}
			if constraint.Match == resource.ScopeAny {
				found = true
				break
			}
			if constraint.Match == resource.ScopeOneOf && constraint.Values != nil {
				for _, value := range *constraint.Values {
					if value == entry.Value {
						found = true
						break
					}
				}
			}
			break
		}
		if !found {
			return false
		}
	}
	return true
}

func (s *engineWatchSink) deliver(sub subscription, route resource.AccessRoute, reference resource.ResourceReference, emit func(context.Context) error) {
	if sub.Context == nil || !targetContainsReference(sub.Target, route, reference) {
		return
	}
	ctx, err := s.ctrl.admit(sub.Context, "resource.WatchDelivery", referenceTarget(s.pluginID, route, reference))
	if err != nil {
		s.reject(err)
		return
	}
	defer finishResource(ctx, &err)
	if err = s.ctrl.validateReadTarget(ctx, s.pluginID, sub.Target); err != nil {
		s.reject(err)
		return
	}
	s.ctrl.pluginsMu.RLock()
	defer s.ctrl.pluginsMu.RUnlock()
	if !s.activeLocked() || !s.ctrl.referenceCurrentLocked(s.pluginID, route, reference) {
		return
	}
	err = emit(ctx)
	if err != nil {
		s.reject(err)
	}
}

func (s *engineWatchSink) emitRecord(kind string, route resource.AccessRoute, record resource.Record, metadata resource.ResourceMetadata) {
	for _, sub := range s.ctrl.subs.Matching(s.pluginID, route.Connection, record.Reference.Address.Type) {
		if sub.Target.Representation != record.Representation.ID {
			continue
		}
		s.deliver(sub, route, record.Reference, func(context.Context) error {
			envelope, err := envelopeRecord(s.generationID, sub.Owner.Owner(), sub.TargetID, sub.Target, record)
			if err != nil {
				return err
			}
			s.ctrl.emitter.Emit(fmt.Sprintf("%s/%s/%s/%s", s.pluginID, route.Connection, record.Reference.Address.Type, kind), HostWatchRecordEvent{Route: route, Record: envelope, Metadata: metadata, Guarantee: resource.BestEffortGuarantee})
			return nil
		})
	}
}

func (s *engineWatchSink) OnAdd(p resource.WatchAddPayload) {
	if err := s.observe(p.Route, p.Record, &p.Metadata); err != nil {
		s.reject(err)
		return
	}
	s.emitRecord("ADD", p.Route, p.Record, p.Metadata)
}

func (s *engineWatchSink) OnUpdate(p resource.WatchUpdatePayload) {
	if err := s.observe(p.Route, p.Record, &p.Metadata); err != nil {
		s.reject(err)
		return
	}
	s.emitRecord("UPDATE", p.Route, p.Record, p.Metadata)
}

func (s *engineWatchSink) OnDelete(p resource.WatchDeletePayload) {
	if s.ctx == nil || s.ctx.Err() != nil {
		return
	}
	if err := s.ctrl.validateReference(s.ctx, s.pluginID, p.Route, p.Reference); err != nil {
		s.reject(err)
		return
	}
	if p.LastKnown != nil {
		if err := resource.ValidateRecord(*p.LastKnown); err != nil {
			s.reject(err)
			return
		}
		expected, err := registry.CanonicalAddressKey(p.Reference.Address)
		if err != nil {
			s.reject(err)
			return
		}
		actual, err := registry.CanonicalAddressKey(p.LastKnown.Reference.Address)
		if err != nil {
			s.reject(err)
			return
		}
		if expected != actual || (p.Reference.Incarnation != nil && (p.LastKnown.Reference.Incarnation == nil || *p.Reference.Incarnation != *p.LastKnown.Reference.Incarnation)) {
			s.reject(resource.NewError("INVALID_REQUEST", "last-known record does not match deletion reference"))
			return
		}
	}
	s.ctrl.pluginsMu.RLock()
	if !s.activeLocked() || !s.ctrl.referenceCurrentLocked(s.pluginID, p.Route, p.Reference) {
		s.ctrl.pluginsMu.RUnlock()
		return
	}
	old, existed := s.store.Delete(s.pluginID, p.Reference, p.Route)
	if existed && old != nil {
		s.dispatcher.Enqueue(indexer.Event{Type: indexer.EventDelete, Entry: *old})
	}
	s.ctrl.pluginsMu.RUnlock()
	for _, sub := range s.ctrl.subs.Matching(s.pluginID, p.Route.Connection, p.Reference.Address.Type) {
		s.deliver(sub, p.Route, p.Reference, func(context.Context) error {
			// Deletion has no body. Use only its canonical reference to derive membership.
			key, addressKey, err := rowIdentity(s.generationID, sub.Owner.Owner(), sub.TargetID, sub.Target, p.Reference)
			if err != nil {
				return err
			}
			event := HostWatchDeleteEvent{Route: p.Route, Reference: p.Reference, Key: key, AddressKey: addressKey, TargetID: sub.TargetID, Guarantee: resource.BestEffortGuarantee}
			if p.LastKnown != nil && p.LastKnown.Representation.ID == sub.Target.Representation {
				known, err := envelopeRecord(s.generationID, sub.Owner.Owner(), sub.TargetID, sub.Target, *p.LastKnown)
				if err != nil {
					return err
				}
				event.LastKnown = &known
			}
			s.ctrl.emitter.Emit(fmt.Sprintf("%s/%s/%s/DELETE", s.pluginID, p.Route.Connection, p.Reference.Address.Type), event)
			return nil
		})
	}
}

func (s *engineWatchSink) OnStateChange(e resource.WatchStateEvent) {
	s.ctrl.pluginsMu.RLock()
	defer s.ctrl.pluginsMu.RUnlock()
	if !s.activeLocked() {
		return
	}
	e.Guarantee = resource.BestEffortGuarantee
	s.ctrl.emitter.Emit(fmt.Sprintf("%s/%s/watch/STATE", s.pluginID, e.Route.Connection), e)
	s.ctrl.emitter.Emit("watch/STATE", HostWatchStateEvent{WatchStateEvent: e, PluginID: s.pluginID})
}

func (s *engineWatchSink) reject(err error) {
	s.ctrl.logger.Errorw(s.ctx, "resource observation rejected", "pluginID", s.pluginID, "error", err)
}
