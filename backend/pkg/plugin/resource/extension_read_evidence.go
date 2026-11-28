package resource

import (
	"context"
	"slices"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/extensionread"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// No resource body leaves an evidence check. Prefer already admitted, live
// observations belonging to this window. Missing observations get at most eight
// exact Gets (256 KiB transport ceiling each), never one unbounded Get per edge.
const maxEvidenceLookups = 8
const maxEvidenceReplyBytes = 2 << 20 / maxEvidenceLookups
const relatedSourceProbePageSize = 64

type evidenceFamily struct {
	target      resourcev2.ReadTarget
	descriptor  resourcev2.ResourceType
	catalog     resourcev2.Catalog // exact descriptor from the already validated route catalog
	checkedGet  bool
	supportsGet bool
	observed    []*sourceSession
}

type evidenceKey struct{ address, incarnation string }
type evidenceObservation struct {
	source     *sourceSession
	generation string
	member     *sourceMemberRef
}

type checkedEvidence struct {
	ref     resourcev2.ResourceReference
	target  resourcev2.ReadTarget
	allowed bool
	seen    []evidenceObservation
}

type relatedEvidence struct {
	ctrl       *controller
	ctx        context.Context
	owner      string
	principal  string
	root       resourcev2.ResourceReference
	route      resourcev2.AccessRoute
	generation *pluginState
	catalog    resourcev2.Catalog
	getter     resourcev2.Getter
	families   map[string]*evidenceFamily
	checked    map[evidenceKey]*checkedEvidence
	lookups    int
	limited    bool
}

func newRelatedEvidence(ctx context.Context, ctrl *controller, owner string, root resourcev2.ResourceReference, route resourcev2.AccessRoute, gen *pluginState, catalog resourcev2.Catalog, provider ResourceProvider) *relatedEvidence {
	getter, _ := provider.(resourcev2.Getter)
	req, _ := invocation.FromContext(ctx)
	return &relatedEvidence{
		ctrl: ctrl, ctx: ctx, owner: owner, principal: req.Principal().Owner(), root: root, route: route,
		generation: gen, catalog: catalog, getter: getter, families: make(map[string]*evidenceFamily),
		checked: make(map[evidenceKey]*checkedEvidence), lookups: 0, limited: false,
	}
}

// Identity dimensions may not be widened, or dropped on the target. A purely
// selection-only dimension has no value on an object and remains explicitly
// any. The native boundary must permit the full resulting collection scope.
func relatedScope(root []resourcev2.ScopeEntry, d resourcev2.ResourceType) (resourcev2.QueryScope, bool) {
	if len(root) != len(d.IdentityDimensions) {
		return nil, false
	}
	for _, dim := range d.IdentityDimensions {
		if !slices.ContainsFunc(root, func(entry resourcev2.ScopeEntry) bool { return entry.Dimension == dim.Name }) {
			return nil, false
		}
	}
	scope := make(resourcev2.QueryScope, 0, len(d.QueryDimensions))
	matched := 0
	for _, dim := range d.QueryDimensions {
		i := slices.IndexFunc(root, func(entry resourcev2.ScopeEntry) bool { return entry.Dimension == dim.Name })
		if i >= 0 {
			values := []string{root[i].Value}
			scope = append(scope, resourcev2.ScopeConstraint{Dimension: dim.Name, Match: resourcev2.ScopeOneOf, Values: &values})
			matched++
		} else {
			scope = append(scope, resourcev2.ScopeConstraint{Dimension: dim.Name, Match: resourcev2.ScopeAny, Values: nil})
		}
	}
	return scope, matched == len(root)
}

func (e *relatedEvidence) source(typ, authority string) (resourcev2.ReadTarget, bool) {
	var none resourcev2.ReadTarget
	if authority == "" || e.ctx.Err() != nil {
		return none, false
	}
	i := slices.IndexFunc(e.catalog.Types, func(d resourcev2.ResourceType) bool { return d.Type == typ })
	if i < 0 {
		return none, false
	}
	d := e.catalog.Types[i]
	scope, ok := relatedScope(e.root.Address.Scope, d)
	if !ok || d.DefaultRepresentation == "" {
		return none, false
	}
	target := resourcev2.ReadTarget{Route: e.route, Provider: e.catalog.Provider, Authority: authority, Type: typ, Representation: d.DefaultRepresentation, Scope: scope}
	// The SDK validates the entire supplied catalog at each operation. Keep
	// its validated descriptor intact; never repeatedly scan every other
	// resource type in a large discovery for each private citation.
	catalog := e.catalog
	catalog.Types = catalog.Types[i : i+1 : i+1]
	var request any = resourcev2.EnumerateRequest{Target: target, PageSize: relatedSourceProbePageSize, Cursor: nil}
	if typ == e.root.Address.Type {
		request = resourcev2.GetRequest{Route: target.Route, Reference: e.root, Representation: target.Representation}
	}
	if _, err := resourcev2.AdmitCatalogOperation(catalog, request); err != nil {
		return none, false
	}
	if !e.admitSource(target) {
		return none, false
	}
	family := &evidenceFamily{target: target, descriptor: d, catalog: catalog, checkedGet: false, supportsGet: false, observed: nil}
	e.families[typ] = family
	if typ != e.root.Address.Type {
		// Use the existing per-route/type index. Do not open an observer, inspect
		// unrelated windows' records or scan a collection to find a citation.
		sc := e.ctrl.sources
		sc.stateMu.Lock()
		if group := sc.states[sourceStateKey{pluginID: e.owner, route: e.route, kind: typ}]; group != nil {
			for session := range group.sessions {
				if session.owner == e.principal && session.pluginGeneration == e.generation {
					family.observed = append(family.observed, session)
				}
			}
		}
		sc.stateMu.Unlock()
	}
	return target, true
}

func (e *relatedEvidence) admitSource(t resourcev2.ReadTarget) bool {
	if t.Type == e.root.Address.Type {
		if t.Authority != e.root.Address.Authority {
			return false
		}
		// An operation may use evidence on the selected root itself without
		// permission to enumerate the root's entire resource family.
		return e.objectPermission(e.root, t) != nil
	}
	_, err := e.ctrl.admit(e.ctx, "resource.Enumerate", readTarget(e.owner, t))
	return err == nil
}

func (e *relatedEvidence) objectPermission(ref resourcev2.ResourceReference, t resourcev2.ReadTarget) context.Context {
	ctx, err := e.ctrl.admit(e.ctx, "resource.Get", referenceTarget(e.owner, e.route, ref))
	if err != nil {
		return nil
	}
	ctx, err = e.ctrl.boundary.Reauthorize(ctx, referenceQueryTarget(e.owner, t, ref))
	if err != nil {
		return nil
	}
	return ctx
}

func inRelatedScope(ref resourcev2.ResourceReference, t resourcev2.ReadTarget) bool {
	for _, dim := range t.Scope {
		if dim.Match == resourcev2.ScopeAny {
			continue
		}
		if dim.Values == nil || len(*dim.Values) != 1 || !slices.Contains(ref.Address.Scope, resourcev2.ScopeEntry{Dimension: dim.Dimension, Value: (*dim.Values)[0]}) {
			return false
		}
	}
	return true
}

func (e *relatedEvidence) admit(ref resourcev2.ResourceReference) bool {
	f := e.families[ref.Address.Type]
	if f == nil || e.ctx.Err() != nil || ref.Incarnation == nil || *ref.Incarnation == "" || ref.Address.Provider != f.target.Provider ||
		ref.Address.Authority != f.target.Authority || !inRelatedScope(ref, f.target) || resourcev2.ValidateAddress(ref.Address, f.descriptor.IdentityDimensions) != nil {
		return false
	}
	key, err := registry.CanonicalAddressKey(ref.Address)
	if err != nil {
		return false
	}
	k := evidenceKey{key, *ref.Incarnation}
	if entry := e.checked[k]; entry != nil {
		return entry.allowed
	}
	entry := &checkedEvidence{ref: ref, target: f.target, allowed: false, seen: nil}
	e.checked[k] = entry
	get := resourcev2.GetRequest{Route: e.route, Reference: ref, Representation: f.target.Representation}
	if !f.permitsGet(get) {
		return false
	}
	ctx := e.objectPermission(ref, entry.target)
	if ctx == nil {
		return false
	}
	if ref.Address.Type == e.root.Address.Type {
		entry.allowed = exactRootReference(ref, e.root)
		return entry.allowed
	}
	for _, source := range f.observed {
		if !e.collectObservation(source, key, entry) {
			return false
		}
	}
	entry.allowed = len(entry.seen) != 0 || e.lookupCitation(ctx, get, f)
	return entry.allowed
}

func (f *evidenceFamily) permitsGet(get resourcev2.GetRequest) bool {
	if resourcev2.ValidateGetRequest(get) != nil {
		return false
	}
	// Every admitted address has the same explicit identity and query scope
	// in this family. Capability qualification depends on that scope, not ID.
	// Object-specific subject checks are still mandatory for each citation.
	if !f.checkedGet {
		_, err := resourcev2.AdmitCatalogOperation(f.catalog, get)
		f.checkedGet, f.supportsGet = true, err == nil
	}
	return f.supportsGet
}

// A live conflicting member refuses the citation. A missing observation may be
// supplied by another source or by an independently authorized, bounded Get.
func (e *relatedEvidence) collectObservation(source *sourceSession, key string, entry *checkedEvidence) bool {
	source.mu.Lock()
	defer source.mu.Unlock()
	if source.status.State != sourceStateFollowing || !observedSessionCurrent(source, e.owner, e.principal, e.route, e.generation, e.catalog) {
		return true
	}
	member, exists := source.members[key]
	if !exists {
		return true
	}
	if member.header == nil || member.ref == nil || !sameIncarnation(member.header.reference.Incarnation, entry.ref.Incarnation) {
		return false
	}
	entry.seen = append(entry.seen, evidenceObservation{source, source.generation, member.ref})
	return true
}

func (e *relatedEvidence) lookupCitation(ctx context.Context, get resourcev2.GetRequest, f *evidenceFamily) bool {
	if e.getter == nil || e.lookups >= maxEvidenceLookups {
		e.limited = true // Only reached after admitting the subject for this exact object.
		return false
	}
	e.lookups++
	session, _ := resourcev2.SessionFromContext(ctx)
	session.RequesterID = e.principal
	ctx = resourcev2.WithSession(ctx, session)
	record, err := e.getter.Get(extensionread.WithReplyLimit(ctx, maxEvidenceReplyBytes), get)
	if err != nil {
		switch resourcev2.ErrorCode(err) {
		case "PERMISSION_DENIED", "UNAUTHENTICATED", "NOT_FOUND":
			// An inaccessible object cannot change the disclosed coverage.
		default:
			e.limited = true // Timeout, transport failure or bounded response ceiling.
		}
		return false
	}
	if !sameIncarnation(record.Reference.Incarnation, get.Reference.Incarnation) {
		return false
	}
	size, err := resourcev2.RecordWireSize(record)
	valid := err == nil && size <= maxEvidenceReplyBytes && resourcev2.ValidateOperationResult(get, record, f.descriptor) == nil
	if !valid {
		e.limited = true
	}
	return valid
}

// All-object coverage requires affirmative, independent scope authorization.
// No amount of successful sample Gets proves the absence of an object filter.
func (e *relatedEvidence) scopeCovered() bool {
	for _, family := range e.families {
		t := family.target
		if t.Type == e.root.Address.Type {
			continue // This source is exclusively the actual native root Get.
		}
		if e.getter == nil || !getCoversScope(family.descriptor, t.Scope) || !e.ctrl.boundary.CoversResourceGets(e.ctx, readTarget(e.owner, t)) {
			return false
		}
	}
	return true
}

func getCoversScope(d resourcev2.ResourceType, scope resourcev2.QueryScope) bool {
	for _, capability := range d.Capabilities {
		if capability.Operation != resourcev2.OperationGet {
			continue
		}
		if capability.Scope == nil {
			return true
		}
		if len(capability.Scope) != len(scope) {
			continue
		}
		// relatedScope emits only a singleton identity or an explicit any.
		covered := true
		for _, want := range scope {
			i := slices.IndexFunc(capability.Scope, func(c resourcev2.ScopeConstraint) bool { return c.Dimension == want.Dimension })
			if i < 0 || (capability.Scope[i].Match != resourcev2.ScopeAny && (want.Match != resourcev2.ScopeOneOf || want.Values == nil ||
				len(*want.Values) != 1 || capability.Scope[i].Values == nil || !slices.Contains(*capability.Scope[i].Values, (*want.Values)[0]))) {
				covered = false
				break
			}
		}
		if covered {
			return true
		}
	}
	return false
}

func (seen *evidenceObservation) current(address string) bool {
	s := seen.source
	s.mu.Lock()
	defer s.mu.Unlock()
	member, exists := s.members[address]
	return exists && s.status.State == sourceStateFollowing && !s.closed && s.ctx.Err() == nil &&
		s.generation == seen.generation && member.ref == seen.member
}

// One last current-epoch and permission pass before disclosure. Checks can
// demote a result to unavailable, never promote an earlier refusal to success.
func (e *relatedEvidence) current() bool {
	if e.ctx.Err() != nil || e.ctrl.currentGeneration(e.ctx, e.owner, e.generation) != nil {
		return false
	}
	for _, family := range e.families {
		if !e.admitSource(family.target) {
			return false
		}
	}
	for key, entry := range e.checked {
		if !entry.allowed {
			continue
		}
		if e.objectPermission(entry.ref, entry.target) == nil {
			return false
		}
		for i := range entry.seen {
			if !entry.seen[i].current(key.address) {
				return false
			}
		}
	}
	return e.authoritiesCurrent()
}

func (e *relatedEvidence) authoritiesCurrent() bool {
	// A route may retire a particular native type/authority while the plugin
	// still runs. An empty page also needs current authorities, not just rows.
	c := e.ctrl
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	if c.currentGenerationLocked(e.ctx, e.owner, e.generation) != nil {
		return false
	}
	c.finite.mu.Lock()
	defer c.finite.mu.Unlock()
	resolver := c.finite.authorities[e.owner]
	if resolver == nil {
		return false
	}
	for _, family := range e.families {
		t := family.target
		if !resolver.Matches(e.owner, e.route.Connection, t.Provider, t.Type, t.Authority) {
			return false
		}
	}
	return true
}
