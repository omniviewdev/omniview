package resource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"reflect"
	"sort"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	maxGraphPopulations             = 64
	maxGraphResultItems             = graph.MaxResultItems
	maxGraphResultBytes             = graph.MaxResultBytes
	maxGraphMetadataBytes           = 128 << 20
	maxGraphProjectionRetainedBytes = 128 << 20
	maxGraphAggregateRetainedBytes  = 256 << 20
	maxGraphAggregateScratchBytes   = 128 << 20
	maxGraphAggregateMetadataBytes  = 128 << 20
	maxGraphAggregateResultBytes    = 32 << 20
)

// sourceChange is a full-snapshot invalidation, not an event queue. The source
// never waits for extraction. No graph demand means no notification allocation.
// changes is protected by changeMu; source publication additionally holds s.mu.
type sourceChange struct {
	revision  uint64
	changed   chan struct{}
	observers int
}

func (sc *sourceCoordinator) sourceChangedLocked(s *sourceSession) {
	sc.changeMu.Lock()
	defer sc.changeMu.Unlock()
	change := sc.changes[s]
	if change == nil {
		return
	}
	change.revision++
	close(change.changed)
	if s.closed {
		delete(sc.changes, s)
	} else {
		change.changed = make(chan struct{})
	}
}

func (sc *sourceCoordinator) attachGraphInterest(interest *sourceInterest) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	if interest.closed {
		return resourcev2.NewError("RESET_REQUIRED", "Graph interest retired.")
	}
	sc.changeMu.Lock()
	defer sc.changeMu.Unlock()
	if sc.changes == nil {
		sc.changes = make(map[*sourceSession]*sourceChange)
	}
	change := sc.changes[interest.session]
	if change == nil {
		change = &sourceChange{changed: make(chan struct{})}
		sc.changes[interest.session] = change
	}
	change.observers++
	interest.projection = true
	return nil
}

func (sc *sourceCoordinator) releaseGraphInterest(s *sourceSession) {
	sc.changeMu.Lock()
	defer sc.changeMu.Unlock()
	if change := sc.changes[s]; change != nil {
		change.observers--
		if change.observers == 0 {
			close(change.changed)
			delete(sc.changes, s)
		}
	}
}

func (sc *sourceCoordinator) sourceRevisionLocked(s *sourceSession) (uint64, <-chan struct{}) {
	sc.changeMu.Lock()
	defer sc.changeMu.Unlock()
	change := sc.changes[s]
	if change == nil {
		return 0, nil
	}
	return change.revision, change.changed
}

type graphPopulation struct {
	interest   *sourceInterest
	revision   uint64
	generation string
	target     resourcev2.ReadTarget
	binding    sourceBinding
	mode       string
	changed    <-chan struct{}
	members    []sourceMember
	ledger     *sourceMemberLedger
	aggregate  *sourceMemberLedger
	retained   int
}

func (p *graphPopulation) release() {
	if p.ledger != nil {
		p.ledger.release(p.retained)
	}
	if p.aggregate != nil {
		p.aggregate.release(p.retained)
	}
	p.retained = 0
	p.members = nil
}

func (sc *sourceCoordinator) graphPopulation(ctx context.Context, interest *sourceInterest, ledger *sourceMemberLedger, needsBody func(*sourceMemberHeader) bool) (graphPopulation, error) {
	s := interest.session
	for {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return graphPopulation{}, resourcev2.NewError("RESET_REQUIRED", "Graph population retired.")
		}
		revision, changed := sc.sourceRevisionLocked(s)
		population := graphPopulation{interest: interest, revision: revision, generation: s.generation, target: s.target, changed: changed, ledger: ledger, aggregate: &sc.ctrl.graphRetained, binding: s.ctx.Value(sourceBindingKey{}).(sourceBinding), mode: s.mode}
		sc.mu.Lock()
		retired := interest.closed || sc.sessions[s.key] != s
		sc.mu.Unlock()
		if retired || s.closed || !reflect.DeepEqual(interest.target, s.target) {
			s.mu.Unlock()
			return population, resourcev2.NewError("RESET_REQUIRED", "Graph population binding retired.")
		}
		if err := sc.ctrl.currentGeneration(s.ctx, s.pluginID, s.pluginGeneration); err != nil {
			s.mu.Unlock()
			return population, err
		}
		if s.status.Error != nil {
			err := *s.status.Error
			s.mu.Unlock()
			return population, &err
		}
		if s.status.State == "opening" || s.status.State == "snapshotting" {
			s.mu.Unlock()
			select {
			case <-ctx.Done():
				return population, ctx.Err()
			case <-changed:
				continue
			}
		}
		if !s.hasSnapshot || s.status.Coverage == nil || s.status.Coverage.Enumeration != resourcev2.EnumerationExhausted || (s.status.State != "following" && s.status.State != "finished") {
			s.mu.Unlock()
			return population, resourcev2.NewError("UNAVAILABLE", "Graph population has no complete committed boundary.")
		}
		population.members = make([]sourceMember, 0, len(s.members))
		for _, member := range s.members {
			if member.header != nil && !needsBody(member.header) {
				member.body = nil
				member.size = member.retainedHeaderBytes()
				member.transient = member.headerTransient
			}
			if member.size < 0 || !ledger.reserveLimit(member.size, maxGraphProjectionRetainedBytes) {
				s.mu.Unlock()
				population.release()
				return population, resourcev2.NewError("RESOURCE_LIMIT", "Graph extraction retention is saturated.")
			}
			if !sc.ctrl.graphRetained.reserveLimit(member.size, maxGraphAggregateRetainedBytes) {
				ledger.release(member.size)
				s.mu.Unlock()
				population.release()
				return population, resourcev2.NewError("RESOURCE_LIMIT", "Aggregate graph extraction retention is saturated.")
			}
			// Graph retention has its own bounded charge. It cannot keep a
			// source/view ledger charged after selected membership advances.
			member.ref = nil
			population.retained += member.size
			population.members = append(population.members, member)
		}
		s.mu.Unlock()
		return population, nil
	}
}

func (sc *sourceCoordinator) graphPopulationCurrent(p graphPopulation) error {
	s := p.interest.session
	s.mu.Lock()
	defer s.mu.Unlock()
	sc.mu.Lock()
	retired := p.interest.closed || sc.sessions[s.key] != s
	sc.mu.Unlock()
	if retired || s.closed {
		return resourcev2.NewError("RESET_REQUIRED", "Graph population retired.")
	}
	revision, _ := sc.sourceRevisionLocked(s)
	if retired || s.closed || revision != p.revision || s.generation != p.generation || !reflect.DeepEqual(s.target, p.target) {
		return resourcev2.NewError("UNAVAILABLE", "Graph extraction watermark is no longer current.")
	}
	return sc.ctrl.currentGeneration(s.ctx, s.pluginID, s.pluginGeneration)
}

type graphDemand struct {
	service              *GraphService
	request              HostGraphObservationRequest
	operation            string
	admission            catalogAdmission
	observation          Observation
	catalog              resourcev2.Catalog
	declarations         map[string][]resourcev2.RelationshipDescriptor
	targets              map[string]resourcev2.ReadTarget
	selected             map[string][]resourcev2.RelationshipDescriptor
	declarers            map[string]bool
	allDeclarers         map[string]bool
	selectorDemands      []graph.SelectorDemand
	interests            map[string]*sourceInterest
	populations          []graphPopulation
	scratch              sourceTransientLedger
	retained             sourceMemberLedger
	projection           *graph.RelationshipGraph
	store                registry.Store
	indexed              map[string]graphIndexedMember
	bound                map[string][]resourcev2.RelationshipDescriptor
	metadataUsed         int
	memberMetadataCharge int
	resultHeld           bool
	order                []string
	relatedLimit         int
	declarationsRevision string
}

type graphIndexedMember struct {
	header *sourceMemberHeader
	body   bool
}

func (d *graphDemand) needsBody(header *sourceMemberHeader) bool {
	return header != nil && len(d.selected[header.reference.Address.Type]) > 0 && (d.allDeclarers[header.reference.Address.Type] || d.declarers[header.key])
}

func (s *GraphService) newDemand(ctx context.Context, request HostGraphObservationRequest) (*graphDemand, error) {
	if s.ctrl == nil {
		return nil, resourcev2.NewError("UNAVAILABLE", "Graph source coordinator is unavailable.")
	}
	operation, err := request.operation()
	if err != nil {
		return nil, err
	}
	const acquisitionScratch = 8 << 20
	if !s.ctrl.graphScratch.reserveLimit(acquisitionScratch, maxGraphAggregateScratchBytes) {
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Graph metadata acquisition scratch is saturated.")
	}
	defer s.ctrl.graphScratch.release(acquisitionScratch)
	admission, catalog, err := s.ctrl.routeCatalog(ctx, request.PluginID, request.Route)
	if err != nil {
		return nil, err
	}
	if catalog.Coverage.Kind != "complete" {
		return nil, resourcev2.NewError("UNAVAILABLE", "Graph declarations require complete discovered support.")
	}
	ctx = context.WithValue(ctx, sourceEpochKey{}, admission.epoch)
	provider, generation, ctx, cleanup, err := s.ctrl.operationGenerationExpected(ctx, request.PluginID, request.Route, &admission)
	if err != nil {
		return nil, err
	}
	// Metadata acquisition has caller lifetime. Population interests retain the
	// original principal separately; they never retain this canceled I/O context.
	defer cleanup()
	features, err := s.ctrl.providerFeatures(ctx, request.PluginID, provider)
	if err != nil {
		return nil, err
	}
	relations, ok := provider.(resourcev2.RelationshipProvider)
	if !features.Has(resourcev2.FeatureRelationships) || !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Relationships are not supported.")
	}
	demand := &graphDemand{service: s, request: request, operation: operation, admission: admission, catalog: catalog, declarationsRevision: catalog.Revision, declarations: make(map[string][]resourcev2.RelationshipDescriptor), interests: make(map[string]*sourceInterest)}
	accepted := false
	defer func() {
		if !accepted {
			demand.close()
		}
	}()
	encoded, err := json.Marshal(catalog)
	if err != nil {
		return nil, err
	}
	if len(encoded) > acquisitionScratch || !demand.reserveMetadata(8*len(encoded)+1024*len(catalog.Types)) {
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Graph catalog metadata is saturated.")
	}
	demand.observation = Observation{admission: admission, plugin: request.PluginID, route: request.Route, digest: sha256.Sum256(encoded)}
	// Reverse declarations can come from any discovered source type, including
	// EdgeIncoming rules. Metadata discovery does not acquire those populations.
	for _, descriptor := range catalog.Types {
		admitted, err := s.boundary.Admit(ctx, operation, invocation.Target{Provider: request.PluginID, Connection: request.Route.Connection, ResourceType: descriptor.Type})
		if err != nil {
			return nil, err
		}
		declarations, err := relations.GetRelationships(resourcev2.WithCatalogRevision(admitted, catalog.Revision), request.Route, descriptor.Type)
		if err != nil {
			return nil, err
		}
		if len(declarations) > resourcev2.MaxRelationshipTargets {
			return nil, resourcev2.NewError("RESOURCE_LIMIT", "Too many graph declarations.")
		}
		encoded, err := json.Marshal(declarations)
		if err != nil {
			return nil, err
		}
		if len(encoded) > acquisitionScratch || !demand.reserveMetadata(8*len(encoded)+512*len(declarations)) {
			return nil, resourcev2.NewError("RESOURCE_LIMIT", "Graph declaration metadata is saturated.")
		}
		demand.declarations[descriptor.Type] = declarations
	}
	if err := s.ctrl.currentGeneration(ctx, request.PluginID, generation); err != nil {
		return nil, err
	}
	accepted = true
	return demand, nil
}

func (d *graphDemand) close() {
	for _, population := range d.populations {
		population.release()
	}
	d.populations = nil
	interests := make([]*sourceInterest, 0, len(d.interests))
	for key, interest := range d.interests {
		interests = append(interests, interest)
		delete(d.interests, key)
	}
	d.service.ctrl.sources.releaseInterests(interests)
	if d.projection != nil {
		d.projection.Close()
		d.projection = nil
	}
	d.store = nil
	d.indexed = nil
	d.releaseMetadata(d.metadataUsed)
	d.releaseResult()
}

func (d *graphDemand) reserveMetadata(size int) bool {
	if size < 0 || size > maxGraphMetadataBytes-d.metadataUsed || !d.service.ctrl.graphMetadata.reserveLimit(size, maxGraphAggregateMetadataBytes) {
		return false
	}
	d.metadataUsed += size
	return true
}

func (d *graphDemand) releaseMetadata(size int) {
	d.metadataUsed -= size
	d.service.ctrl.graphMetadata.release(size)
}

func (d *graphDemand) releaseResult() {
	if d.resultHeld {
		d.service.ctrl.graphResults.release(maxGraphResultBytes)
		d.resultHeld = false
	}
}

func (d *graphDemand) typeTarget(ctx context.Context, typ string, scope []resourcev2.ScopeEntry) (resourcev2.ReadTarget, error) {
	var descriptor *resourcev2.ResourceType
	for i := range d.catalog.Types {
		if d.catalog.Types[i].Type == typ {
			descriptor = &d.catalog.Types[i]
			break
		}
	}
	if descriptor == nil || descriptor.DefaultRepresentation == "" {
		return resourcev2.ReadTarget{}, resourcev2.NewError("UNSUPPORTED", "Graph population requires an explicit representation.")
	}
	authority, err := d.service.ctrl.resolveAuthority(ctx, d.request.PluginID, d.request.Route, d.catalog, d.admission, typ)
	if err != nil {
		return resourcev2.ReadTarget{}, err
	}
	target := resourcev2.ReadTarget{Route: d.request.Route, Provider: d.catalog.Provider, Authority: authority.Authority, Type: typ, Representation: descriptor.DefaultRepresentation, Scope: make(resourcev2.QueryScope, 0, len(descriptor.QueryDimensions))}
	for _, dimension := range descriptor.QueryDimensions {
		constraint := resourcev2.ScopeConstraint{Dimension: dimension.Name, Match: resourcev2.ScopeAny}
		for _, entry := range scope {
			if entry.Dimension == dimension.Name {
				values := []string{entry.Value}
				constraint.Match, constraint.Values = resourcev2.ScopeOneOf, &values
			}
		}
		target.Scope = append(target.Scope, constraint)
	}
	return target, nil
}

func (d *graphDemand) addTarget(ctx context.Context, typ string, scope []resourcev2.ScopeEntry) error {
	target, err := d.typeTarget(ctx, typ, scope)
	if err != nil {
		return err
	}
	return d.addReadTarget(ctx, target)
}

func (d *graphDemand) addReadTarget(ctx context.Context, target resourcev2.ReadTarget) error {
	if _, err := d.service.boundary.Admit(ctx, d.operation, readTarget(d.request.PluginID, target)); err != nil {
		return err
	}
	key := sourceKey(d.request.PluginID, "", target, "ifSupported")
	if _, exists := d.targets[key]; !exists && len(d.targets) >= maxGraphPopulations {
		return resourcev2.NewError("RESOURCE_LIMIT", "Graph population limit reached.")
	}
	d.targets[key] = target
	return nil
}

func (d *graphDemand) expand(ctx context.Context, nodes []graph.GraphNode, direction graph.Direction) error {
	for _, node := range nodes {
		if len(d.selectorDemands) >= 2*maxGraphResultItems {
			return resourcev2.NewError("RESOURCE_LIMIT", "Graph traversal frontier limit reached.")
		}
		d.selectorDemands = append(d.selectorDemands, graph.SelectorDemand{Node: node, Direction: direction})
		for sourceType, declarations := range d.declarations {
			for _, declaration := range declarations {
				if d.request.RelationshipType != nil && string(declaration.Type) != *d.request.RelationshipType {
					continue
				}
				from, to := sourceType, declaration.TargetType
				if declaration.Direction == resourcev2.EdgeIncoming {
					from, to = to, from
				}
				if !((direction == graph.Outgoing && from == node.Reference.Address.Type) || (direction == graph.Incoming && to == node.Reference.Address.Type)) {
					continue
				}
				var scope []resourcev2.ScopeEntry
				declaring := (direction == graph.Outgoing && declaration.Direction != resourcev2.EdgeIncoming) || (direction == graph.Incoming && declaration.Direction == resourcev2.EdgeIncoming)
				if declaring {
					scope = node.Reference.Address.Scope
				}
				if declaration.Extractor == nil {
					return resourcev2.NewError("UNSUPPORTED", "Graph declaration requires provider-side relationship resolution.")
				}
				switch declaration.Extractor.Method {
				case "fieldPath", "labelSelector", "labelSelectorObject":
				default:
					return resourcev2.NewError("UNSUPPORTED", "Graph declaration extractor is not supported.")
				}
				if err := d.addTarget(ctx, sourceType, scope); err != nil {
					return err
				}
				if declaring {
					d.declarers[node.Key()] = true
				} else {
					d.allDeclarers[sourceType] = true
				}
				duplicate := false
				for _, existing := range d.selected[sourceType] {
					if reflect.DeepEqual(existing, declaration) {
						duplicate = true
						break
					}
				}
				if !duplicate {
					d.selected[sourceType] = append(d.selected[sourceType], declaration)
				}
			}
		}
	}
	return nil
}

func (d *graphDemand) acquire(ctx context.Context) error {
	ctx = WithObservation(ctx, d.observation)
	keys := make([]string, 0, len(d.targets))
	for key := range d.targets {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	d.order = keys
	for _, key := range keys {
		if d.interests[key] != nil {
			continue
		}
		target := d.targets[key]
		admitted, err := d.service.boundary.Admit(ctx, d.operation, readTarget(d.request.PluginID, target))
		if err != nil {
			return err
		}
		interest, err := d.service.ctrl.sources.acquire(admitted, d.request.PluginID, target, "ifSupported")
		if err != nil {
			return err
		}
		if err := d.service.ctrl.sources.attachGraphInterest(interest); err != nil {
			d.service.ctrl.sources.releaseInterest(interest)
			return err
		}
		d.interests[key] = interest
	}
	return nil
}

func (d *graphDemand) project(ctx context.Context) (*graph.RelationshipGraph, error) {
	for i := range d.populations {
		d.populations[i].release()
	}
	d.populations = nil
	defer func() {
		for i := range d.populations {
			d.populations[i].release()
		}
	}()
	if d.projection == nil {
		d.projection = graph.NewRelationshipGraph()
		d.projection.SetMemoryBudget(d.reserveMetadata, d.releaseMetadata)
		d.store = registry.NewMemoryStore()
		d.indexed = make(map[string]graphIndexedMember)
		d.bound = make(map[string][]resourcev2.RelationshipDescriptor)
	}
	g, store := d.projection, d.store
	index := graph.NewGraphIndexer(g, store)
	changedTypes := make(map[string]bool)
	nextBound := make(map[string][]resourcev2.RelationshipDescriptor, len(d.catalog.Types))
	for _, descriptor := range d.catalog.Types {
		declarations := d.selected[descriptor.Type]
		nextBound[descriptor.Type] = declarations
		if old, exists := d.bound[descriptor.Type]; exists && reflect.DeepEqual(old, declarations) {
			continue
		}
		changedTypes[descriptor.Type] = true
		if len(declarations) == 0 {
			g.SetNoDeclarations(d.request.PluginID, d.request.Route, descriptor.Type)
		} else if err := d.bindDeclarations(ctx, g, descriptor.Type, declarations); err != nil {
			return nil, err
		}
	}
	seen := make(map[string]sourceMember)
	metadataBytes := 0
	for _, key := range d.order {
		population, err := d.service.ctrl.sources.graphPopulation(ctx, d.interests[key], &d.retained, d.needsBody)
		d.populations = append(d.populations, population)
		if err != nil {
			return nil, err
		}
		for _, member := range population.members {
			if member.header == nil {
				return nil, resourcev2.NewError("UNAVAILABLE", "Graph member admission is unavailable.")
			}
			address := member.header.key
			if old, exists := seen[address]; exists {
				if !sameIncarnation(old.header.reference.Incarnation, member.header.reference.Incarnation) || !sameIncarnation(old.header.sourceRevision, member.header.sourceRevision) || !bytes.Equal(old.body, member.body) || !reflect.DeepEqual(old.metadata, member.metadata) {
					return nil, resourcev2.NewError("UNAVAILABLE", "Overlapping graph populations contain conflicting observations.")
				}
				continue
			}
			if len(seen) >= maxSourceSessionMembers {
				return nil, resourcev2.NewError("RESOURCE_LIMIT", "Graph member limit reached.")
			}
			cost := member.retainedHeaderBytes() + 512
			if cost < 0 || cost > maxGraphMetadataBytes-metadataBytes {
				return nil, resourcev2.NewError("RESOURCE_LIMIT", "Graph metadata limit reached.")
			}
			metadataBytes += cost
			seen[address] = member
		}
	}
	if metadataBytes > d.memberMetadataCharge {
		if !d.reserveMetadata(metadataBytes - d.memberMetadataCharge) {
			return nil, resourcev2.NewError("RESOURCE_LIMIT", "Aggregate graph member metadata is saturated.")
		}
		d.memberMetadataCharge = metadataBytes
	}
	for address, previous := range d.indexed {
		if _, exists := seen[address]; exists {
			continue
		}
		if entry, exists := store.Delete(d.request.PluginID, previous.header.reference, d.request.Route); exists {
			index.OnDelete(*entry)
		}
	}
	// Candidate populations need metadata, not bodies. Only actual declaring
	// nodes decode native JSON; immutable header identity witnesses reuse.
	for address, member := range seen {
		if d.indexed[address].header == member.header {
			continue
		}
		entry := registry.ResourceEntry{PluginID: d.request.PluginID, Route: d.request.Route, Reference: member.header.reference}
		if member.metadata != nil {
			entry.Labels = member.metadata.Labels
			if member.metadata.CreatedAt != nil {
				entry.CreatedAt = *member.metadata.CreatedAt
			}
		}
		store.Put(entry)
	}
	nextIndexed := make(map[string]graphIndexedMember, len(seen))
	for address, member := range seen {
		bodyNeeded := d.needsBody(member.header)
		witness := graphIndexedMember{header: member.header, body: bodyNeeded}
		nextIndexed[address] = witness
		if d.indexed[address] == witness && !changedTypes[member.header.reference.Address.Type] {
			continue
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		entry, exists := store.Get(d.request.PluginID, member.header.reference, d.request.Route)
		if !exists {
			return nil, resourcev2.NewError("UNAVAILABLE", "Graph member contribution retired.")
		}
		if bodyNeeded && member.header.coverage.Kind != "complete" {
			return nil, resourcev2.NewError("UNAVAILABLE", "Graph declaring document is not complete.")
		}
		cost := member.headerTransient + g.SelectorScratchBytes() + 2048*len(d.selected[member.header.reference.Address.Type])
		if bodyNeeded {
			cost += member.transient
		}
		if cost < 0 || !d.scratch.reserveLimit(cost, maxGraphAggregateScratchBytes) {
			return nil, resourcev2.NewError("RESOURCE_LIMIT", "Graph extraction scratch is saturated.")
		}
		if !d.service.ctrl.graphScratch.reserveLimit(cost, maxGraphAggregateScratchBytes) {
			d.scratch.release(cost)
			return nil, resourcev2.NewError("RESOURCE_LIMIT", "Aggregate graph extraction scratch is saturated.")
		}
		var raw []byte
		var err error
		if bodyNeeded {
			var body resourcev2.Value
			body, err = decodeSourceBody(member)
			if err == nil {
				var native any
				native, err = resourcev2.NativeFromValue(body)
				if err == nil {
					raw, err = json.Marshal(native)
				}
			}
		}
		if err == nil {
			index.OnAdd(*entry, raw)
		}
		d.scratch.release(cost)
		d.service.ctrl.graphScratch.release(cost)
		if err != nil {
			return nil, err
		}
		if err := g.CheckLimit(); err != nil {
			return nil, err
		}
	}
	if err := d.current(ctx); err != nil {
		return nil, err
	}
	if err := g.CheckComplete(d.request.PluginID, d.request.Route); err != nil {
		return nil, err
	}
	d.indexed, d.bound = nextIndexed, nextBound
	if metadataBytes < d.memberMetadataCharge {
		d.releaseMetadata(d.memberMetadataCharge - metadataBytes)
		d.memberMetadataCharge = metadataBytes
	}
	return g, nil
}

func (d *graphDemand) bindDeclarations(ctx context.Context, g *graph.RelationshipGraph, typ string, declarations []resourcev2.RelationshipDescriptor) error {
	source, err := d.typeTarget(ctx, typ, nil)
	if err != nil {
		return err
	}
	bindings := graph.DeclarationBindings{SourceEpoch: d.admission.epoch.Epoch, Source: graph.TargetBinding{Target: source}}
	for _, descriptor := range d.catalog.Types {
		if descriptor.Type == typ {
			bindings.Source.IdentityDimensions = descriptor.IdentityDimensions
			break
		}
	}
	targets := make(map[string]bool)
	for _, declaration := range declarations {
		if targets[declaration.TargetType] {
			continue
		}
		targets[declaration.TargetType] = true
		target, err := d.typeTarget(ctx, declaration.TargetType, nil)
		if err != nil {
			return err
		}
		binding := graph.TargetBinding{Target: target}
		for _, descriptor := range d.catalog.Types {
			if descriptor.Type == target.Type {
				binding.IdentityDimensions = descriptor.IdentityDimensions
				break
			}
		}
		bindings.Targets = append(bindings.Targets, binding)
	}
	return g.SetBoundDeclarations(d.request.PluginID, d.request.Route, typ, declarations, bindings)
}

func (d *graphDemand) current(ctx context.Context) error {
	ctx = context.WithValue(ctx, sourceEpochKey{}, d.admission.epoch)
	admission, catalog, err := d.service.ctrl.routeCatalog(ctx, d.request.PluginID, d.request.Route)
	if err != nil {
		return err
	}
	if admission != d.admission {
		return resourcev2.NewError("RESET_REQUIRED", "Graph support observation retired.")
	}
	if catalog.Coverage.Kind != "complete" {
		return resourcev2.NewError("UNAVAILABLE", "Graph support coverage is not complete.")
	}
	authorities, err := d.service.ctrl.resolveCatalogAuthorities(ctx, d.request.PluginID, d.request.Route, catalog, admission)
	if err != nil {
		return err
	}
	root := d.request.Reference.Address
	rootAuthority, exists := authorities[root.Type]
	if !exists || catalog.Provider != root.Provider || rootAuthority.Authority != root.Authority {
		return resourcev2.NewError("RESET_REQUIRED", "Graph root authority retired.")
	}
	for _, population := range d.populations {
		if err := d.service.ctrl.sources.graphPopulationCurrent(population); err != nil {
			return err
		}
		if _, err := d.service.boundary.Admit(ctx, d.operation, readTarget(d.request.PluginID, population.target)); err != nil {
			return err
		}
		request := resourcev2.SourceOpenRequest{Target: population.target, Mode: population.mode, Acquisition: resourcev2.SourceAcquisition{Kind: resourcev2.SourceAcquisitionEnumerate}, Binding: resourcev2.RepresentationBinding{Representation: population.binding.Representation}}
		if err := resourcev2.CheckSourceCatalog(resourcev2.WithCatalogRevision(ctx, population.binding.CatalogRevision), catalog, request, population.binding.Descriptor); err != nil {
			return err
		}
	}
	if catalog.Revision != d.declarationsRevision {
		if len(catalog.Types) != len(d.declarations) {
			return resourcev2.NewError("RESET_REQUIRED", "Graph declaration membership changed.")
		}
		const scratch = 8 << 20
		if !d.service.ctrl.graphScratch.reserveLimit(scratch, maxGraphAggregateScratchBytes) {
			return resourcev2.NewError("RESOURCE_LIMIT", "Graph declaration admission scratch is saturated.")
		}
		defer d.service.ctrl.graphScratch.release(scratch)
		provider, _, work, cleanup, err := d.service.ctrl.operationGenerationExpected(ctx, d.request.PluginID, d.request.Route, &d.admission)
		if err != nil {
			return err
		}
		defer cleanup()
		relations, ok := provider.(resourcev2.RelationshipProvider)
		if !ok {
			return resourcev2.NewError("UNSUPPORTED", "Graph declaration provider is unavailable.")
		}
		for _, descriptor := range catalog.Types {
			previous, exists := d.declarations[descriptor.Type]
			if !exists {
				return resourcev2.NewError("RESET_REQUIRED", "Graph declaration membership changed.")
			}
			admitted, err := d.service.boundary.Admit(work, d.operation, invocation.Target{Provider: d.request.PluginID, Connection: d.request.Route.Connection, ResourceType: descriptor.Type})
			if err != nil {
				return err
			}
			declarations, err := relations.GetRelationships(resourcev2.WithCatalogRevision(admitted, catalog.Revision), d.request.Route, descriptor.Type)
			if err != nil {
				return err
			}
			if !reflect.DeepEqual(previous, declarations) {
				return resourcev2.NewError("RESET_REQUIRED", "Graph declarations changed.")
			}
		}
		if err := d.service.ctrl.currentGeneration(work, d.request.PluginID, d.admission.generation); err != nil {
			return err
		}
		d.declarationsRevision = catalog.Revision
	}
	return d.service.ctrl.currentGeneration(ctx, d.request.PluginID, d.admission.generation)
}

type graphFrontierKey struct{ plugin, connection, address string }

func graphFrontier(g *graph.RelationshipGraph, nodes []graph.GraphNode, direction graph.Direction, visited map[graphFrontierKey]bool) ([]graph.GraphNode, error) {
	var next []graph.GraphNode
	for _, node := range nodes {
		edges, err := g.GetRelated(node, direction, nil)
		if err != nil {
			return nil, err
		}
		for _, edge := range edges {
			target := edge.Target
			if direction == graph.Incoming {
				target = edge.Source
			}
			key := graphFrontierKey{target.PluginID, target.Route.Connection, target.Key()}
			if visited[key] {
				continue
			}
			if len(visited) >= maxGraphResultItems {
				return nil, resourcev2.NewError("RESOURCE_LIMIT", "Graph traversal frontier limit reached.")
			}
			visited[key] = true
			next = append(next, target)
		}
	}
	return next, nil
}

func (d *graphDemand) evaluate(ctx context.Context) (graphQueryResult, error) {
	d.releaseResult()
	admitted, err := d.service.admit(ctx, d.operation, d.request.PluginID, d.request.Reference, d.request.Route)
	if err != nil {
		return graphQueryResult{}, err
	}
	ctx = admitted
	d.targets = make(map[string]resourcev2.ReadTarget)
	d.selected = make(map[string][]resourcev2.RelationshipDescriptor)
	d.declarers, d.allDeclarers = make(map[string]bool), make(map[string]bool)
	d.selectorDemands = nil
	root := graph.GraphNode{PluginID: d.request.PluginID, Route: d.request.Route, Reference: d.request.Reference}
	upDepth, downDepth := d.request.depths()
	up, down := []graph.GraphNode{root}, []graph.GraphNode{root}
	rootKey := graphFrontierKey{root.PluginID, root.Route.Connection, root.Key()}
	upSeen, downSeen := map[graphFrontierKey]bool{rootKey: true}, map[graphFrontierKey]bool{rootKey: true}
	var g *graph.RelationshipGraph
	for depth := 0; depth < max(1, upDepth, downDepth); depth++ {
		if depth < upDepth {
			if err := d.expand(ctx, up, graph.Incoming); err != nil {
				return graphQueryResult{}, err
			}
		}
		if depth < downDepth {
			if err := d.expand(ctx, down, graph.Outgoing); err != nil {
				return graphQueryResult{}, err
			}
		}
		// Read real declarers before deriving selector candidate scopes. Each
		// derived target is independently admitted under the original operation.
		for {
			if err := d.acquire(ctx); err != nil {
				return graphQueryResult{}, err
			}
			g, err = d.project(ctx)
			if err != nil {
				return graphQueryResult{}, err
			}
			before := len(d.targets)
			if err := g.VisitSelectorTargets(d.selectorDemands, func(target resourcev2.ReadTarget) error { return d.addReadTarget(ctx, target) }); err != nil {
				return graphQueryResult{}, err
			}
			if before == len(d.targets) {
				break
			}
		}
		if depth+1 < upDepth {
			up, err = graphFrontier(g, up, graph.Incoming, upSeen)
			if err != nil {
				return graphQueryResult{}, err
			}
		} else {
			up = nil
		}
		if depth+1 < downDepth {
			down, err = graphFrontier(g, down, graph.Outgoing, downSeen)
			if err != nil {
				return graphQueryResult{}, err
			}
		} else {
			down = nil
		}
		if len(up) == 0 && len(down) == 0 {
			break
		}
	}
	if observed := d.indexed[root.Key()].header; observed != nil {
		if root.Reference.Incarnation != nil && !sameIncarnation(root.Reference.Incarnation, observed.reference.Incarnation) {
			return graphQueryResult{}, resourcev2.NewError("RESET_REQUIRED", "Graph root incarnation retired.")
		}
	} else if d.declarers[root.Key()] {
		return graphQueryResult{}, resourcev2.NewError("NOT_FOUND", "Graph declaring root is not observed in the complete population.")
	}
	var retired []*sourceInterest
	for key, interest := range d.interests {
		if _, wanted := d.targets[key]; !wanted {
			retired = append(retired, interest)
			delete(d.interests, key)
		}
	}
	d.service.ctrl.sources.releaseInterests(retired)
	if !d.service.ctrl.graphResults.reserveLimit(maxGraphResultBytes, maxGraphAggregateResultBytes) {
		return graphQueryResult{}, resourcev2.NewError("RESOURCE_LIMIT", "Aggregate graph result delivery is saturated.")
	}
	d.resultHeld = true
	result, err := d.service.graphResult(ctx, g, d.request, d.relatedLimit)
	if err != nil {
		return graphQueryResult{}, err
	}
	if err := d.current(ctx); err != nil {
		return graphQueryResult{}, err
	}
	return result, nil
}

func (d *graphDemand) wait(ctx context.Context, wake <-chan struct{}) error {
	cases := []reflect.SelectCase{{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ctx.Done())}, {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(wake)}}
	for _, population := range d.populations {
		if population.changed != nil {
			cases = append(cases, reflect.SelectCase{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(population.changed)})
		}
	}
	if len(cases) == 2 && wake == nil {
		<-ctx.Done()
		return ctx.Err()
	}
	index, _, _ := reflect.Select(cases)
	if index == 0 {
		return ctx.Err()
	}
	return nil
}
