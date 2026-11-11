package resourcecatalog

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"sync"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	schemaStateAbsent      = "absent"
	schemaStateAvailable   = "available"
	schemaStateUnavailable = "unavailable"
	ValidationFull         = "full"
	ValidationReduced      = "reduced"
	// Freshness is demand-time eligibility, never a background refresh schedule.
	Freshness = 30 * time.Second
)

// Catalog owns target observations and the sole bounded normalized document store.
// Its mutex is a leaf lock; provider calls never run under it.
type Catalog struct {
	mu          sync.Mutex
	store       *store
	connections map[connectionSlot]*Snapshot
	policy      Policy
	sequence    uint64
}

type connectionSlot struct{ pluginID, connection string }

func NewCatalog(policy Policy) *Catalog {
	return &Catalog{store: newStore(), connections: map[connectionSlot]*Snapshot{}, policy: policy}
}

// ConnectionKey carries authenticated lifecycle identity, not support revisions.
type ConnectionKey struct {
	PluginID, Generation, Connection string
	Epoch                            uint64
}

type BindingSource func(context.Context, resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error)
type DocumentSource func(context.Context, resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error)

// Snapshot reconciles selected targets across support-only catalog observations.
// All mutable fields are protected by catalog.mu.
type Snapshot struct {
	catalog            *Catalog
	key                ConnectionKey
	revision, provider string
	descriptors        map[string]resourcev2.ResourceType
	entries            map[[2]string]*Entry
	aux                map[string]*Entry
	fetches            map[documentKey]*documentFetch
	documents          map[documentKey]documentAssociation
	retired            bool
}

type documentKey struct {
	reference resourcev2.SchemaDocumentReference
	dialect   string
}

type documentAssociation struct {
	digest   [32]byte
	observed time.Time
}

type documentFetch struct {
	done     chan struct{}
	cancel   context.CancelFunc
	waiters  int
	document *Document // one temporary store reference, released by the last waiter
	err      error
}

// Entry is an immutable selected target contract with independently owned work.
// Descriptor and Target are read-only to callers.
type Entry struct {
	Type, Representation, RepresentationRevision string
	Descriptor                                   resourcev2.ResourceType
	Target                                       resourcev2.SchemaTarget
	snapshot                                     *Snapshot
	active                                       bool
	flight                                       *resolutionFlight
	outcome                                      *resolutionOutcome
	held                                         *Document
	latest                                       string
	latestAt                                     time.Time
}

type resolutionFlight struct {
	done    chan struct{}
	cancel  context.CancelFunc
	stopped <-chan struct{}
	waiters int
	result  Resolution
	err     error
}

type resolutionOutcome struct {
	result   Resolution
	err      error
	observed time.Time
}

// Resolution is one coherent target observation. A nil Schema is known absence
// only when Binding.State is absent and the operation returned no error.
type Resolution struct {
	Binding     resourcev2.SchemaBinding
	Schema      *Schema
	Observation string
}

type Schema struct {
	Document       *Document
	Root           NodeID
	Dialect        string
	SchemaRevision string
	Validation     string
	Unvalidated    []Constraint
}

// Observe performs no I/O. Unrelated support changes preserve live target owners.
func (c *Catalog) Observe(key ConnectionKey, catalog resourcev2.Catalog) *Snapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	slot := connectionSlot{key.PluginID, key.Connection}
	s := c.connections[slot]
	if s == nil || s.key != key || s.provider != catalog.Provider {
		if s != nil {
			c.retireLocked(s)
		}
		s = &Snapshot{catalog: c, key: key, provider: catalog.Provider,
			entries: map[[2]string]*Entry{}, aux: map[string]*Entry{},
			fetches: map[documentKey]*documentFetch{}, documents: map[documentKey]documentAssociation{}}
		c.connections[slot] = s
	}
	if s.revision == catalog.Revision {
		return s
	}
	descriptors := make(map[string]resourcev2.ResourceType, len(catalog.Types))
	next := make(map[[2]string]*Entry)
	for _, typ := range catalog.Types {
		descriptor := cloneResourceType(typ)
		descriptors[typ.Type] = descriptor
		for _, representation := range descriptor.Representations {
			id := [2]string{typ.Type, representation.ID}
			e := s.entries[id]
			if e == nil || !sameTargetContract(e.Descriptor, descriptor) || e.RepresentationRevision != representation.Revision {
				if e != nil {
					c.retireEntryLocked(e)
				}
				e = &Entry{Type: typ.Type, Representation: representation.ID, RepresentationRevision: representation.Revision,
					Descriptor: descriptor, Target: resourcev2.SchemaTarget{Representation: new(representation)}, snapshot: s, active: true}
			}
			next[id] = e
		}
	}
	for id, e := range s.entries {
		if next[id] != e {
			c.retireEntryLocked(e)
		}
	}
	for id, e := range s.aux {
		descriptor, ok := descriptors[e.Type]
		if !ok || !sameTargetContract(e.Descriptor, descriptor) {
			c.retireEntryLocked(e)
			delete(s.aux, id)
		}
	}
	s.entries, s.descriptors, s.revision = next, descriptors, catalog.Revision
	return s
}

// Schema access has no native operation capability. Identity dimensions and the
// exact selected format remain part of admission; presentation does not.
func sameTargetContract(a, b resourcev2.ResourceType) bool {
	return a.Type == b.Type && sameDimensions(a.IdentityDimensions, b.IdentityDimensions) &&
		sameDimensions(a.QueryDimensions, b.QueryDimensions) && reflect.DeepEqual(a.NativeAuthorityHint, b.NativeAuthorityHint)
}

func sameDimensions(a, b []resourcev2.Dimension) bool {
	if len(a) != len(b) {
		return false
	}
	for _, dimension := range a {
		if !slices.Contains(b, dimension) {
			return false
		}
	}
	return true
}

func (c *Catalog) DropConnection(pluginID, connection string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	slot := connectionSlot{pluginID, connection}
	if s := c.connections[slot]; s != nil {
		c.retireLocked(s)
		delete(c.connections, slot)
	}
}

func (c *Catalog) DropPlugin(pluginID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for slot, s := range c.connections {
		if slot.pluginID == pluginID {
			c.retireLocked(s)
			delete(c.connections, slot)
		}
	}
}

func (c *Catalog) retireEntryLocked(e *Entry) {
	e.active = false
	e.outcome = nil
	if e.flight != nil {
		e.flight.cancel()
		e.flight = nil
	}
	if e.held != nil {
		c.store.release(e.held)
		e.held = nil
	}
}

func (c *Catalog) retireLocked(s *Snapshot) {
	s.retired = true
	for _, e := range s.entries {
		c.retireEntryLocked(e)
	}
	for _, e := range s.aux {
		c.retireEntryLocked(e)
	}
	for _, flight := range s.fetches {
		flight.cancel()
	}
	clear(s.fetches)
	clear(s.documents)
}

func cloneResourceType(t resourcev2.ResourceType) resourcev2.ResourceType {
	out := t
	out.IdentityDimensions = slices.Clone(t.IdentityDimensions)
	out.QueryDimensions = slices.Clone(t.QueryDimensions)
	out.NativeQueries = slices.Clone(t.NativeQueries)
	out.Representations = slices.Clone(t.Representations)
	out.Capabilities = make([]resourcev2.Capability, len(t.Capabilities))
	for i, capability := range t.Capabilities {
		scope := make(resourcev2.QueryScope, len(capability.Scope))
		for j, constraint := range capability.Scope {
			if constraint.Values != nil {
				values := slices.Clone(*constraint.Values)
				constraint.Values = &values
			}
			scope[j] = constraint
		}
		capability.Scope = scope
		out.Capabilities[i] = capability
	}
	if t.NativeAuthorityHint != nil {
		out.NativeAuthorityHint = new(*t.NativeAuthorityHint)
	}
	return out
}

func cloneBinding(b resourcev2.SchemaBinding) resourcev2.SchemaBinding {
	out := b
	if b.Revision != nil {
		out.Revision = new(*b.Revision)
	}
	if b.DocumentRef != nil {
		out.DocumentRef = new(*b.DocumentRef)
	}
	if b.UnavailableReason != nil {
		out.UnavailableReason = new(*b.UnavailableReason)
	}
	out.Document = nil // available inline bytes live once in the normalized store
	return out
}

func (s *Snapshot) Revision() string {
	s.catalog.mu.Lock()
	defer s.catalog.mu.Unlock()
	return s.revision
}
func (s *Snapshot) Provider() string { return s.provider }

func (s *Snapshot) Entry(resourceType, representation string) (*Entry, error) {
	s.catalog.mu.Lock()
	defer s.catalog.mu.Unlock()
	if s.retired {
		return nil, resetRequired()
	}
	e := s.entries[[2]string{resourceType, representation}]
	if e == nil {
		return nil, resourcev2.NewError(codeNotFound, "Resource type or representation is not in the route catalog.")
	}
	return e, nil
}

func (s *Snapshot) Descriptor(resourceType string) (resourcev2.ResourceType, error) {
	s.catalog.mu.Lock()
	defer s.catalog.mu.Unlock()
	if s.retired {
		return resourcev2.ResourceType{}, resetRequired()
	}
	typ, ok := s.descriptors[resourceType]
	if !ok {
		return resourcev2.ResourceType{}, resourcev2.NewError(codeNotFound, "Resource type is not in the route catalog.")
	}
	return cloneResourceType(typ), nil
}

func (s *Snapshot) Entries() []*Entry {
	s.catalog.mu.Lock()
	defer s.catalog.mu.Unlock()
	out := make([]*Entry, 0, len(s.entries))
	for _, e := range s.entries {
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Type != out[j].Type {
			return out[i].Type < out[j].Type
		}
		return out[i].Representation < out[j].Representation
	})
	return out
}

// Target admits exactly one current representation or exact auxiliary resource.
// Principal, authority and grant admission belong to the host boundary before this call.
func (s *Snapshot) Target(request resourcev2.SchemaRequest) (*Entry, error) {
	if err := resourcev2.ValidateSchemaRequest(request); err != nil {
		return nil, err
	}
	c := s.catalog
	c.mu.Lock()
	defer c.mu.Unlock()
	if s.retired || request.Route.Connection != s.key.Connection {
		return nil, resetRequired()
	}
	if representation := request.Target.Representation; representation != nil {
		e := s.entries[[2]string{request.Type, representation.ID}]
		if e == nil {
			return nil, resourcev2.NewError(codeNotFound, "Resource type or representation is not in the route catalog.")
		}
		if e.RepresentationRevision != representation.Revision {
			return nil, resetRequired()
		}
		return e, nil
	}
	descriptor, ok := s.descriptors[request.Type]
	if !ok {
		return nil, resourcev2.NewError(codeNotFound, "Resource type is not in the route catalog.")
	}
	if err := resourcev2.ValidateAddress(request.Target.Auxiliary.Reference.Address, descriptor.IdentityDimensions); err != nil {
		return nil, err
	}
	auxiliary := *request.Target.Auxiliary
	auxiliary.Reference.Address.Scope = slices.Clone(auxiliary.Reference.Address.Scope)
	slices.SortFunc(auxiliary.Reference.Address.Scope, func(a, b resourcev2.ScopeEntry) int {
		if a.Dimension < b.Dimension {
			return -1
		}
		if a.Dimension > b.Dimension {
			return 1
		}
		return 0
	})
	encoded, _ := json.Marshal(auxiliary)
	id := string(encoded)
	if e := s.aux[id]; e != nil {
		return e, nil
	}
	// A new source revision replaces only the same auxiliary resource/key owner.
	for key, e := range s.aux {
		a, b := e.Target.Auxiliary, &auxiliary
		if a.Key == b.Key && reflect.DeepEqual(a.Reference, b.Reference) {
			c.retireEntryLocked(e)
			delete(s.aux, key)
		}
	}
	if len(s.aux) >= c.policy.MaxRetainedDocuments {
		return nil, pressure("schema target capacity is exhausted")
	}
	if auxiliary.SourceRevision != nil {
		auxiliary.SourceRevision = new(*auxiliary.SourceRevision)
	}
	if auxiliary.Reference.Incarnation != nil {
		auxiliary.Reference.Incarnation = new(*auxiliary.Reference.Incarnation)
	}
	e := &Entry{Type: request.Type, Descriptor: descriptor, Target: resourcev2.SchemaTarget{Auxiliary: &auxiliary}, snapshot: s, active: true}
	s.aux[id] = e
	return e, nil
}

func resetRequired() error {
	return resourcev2.NewError(codeResetRequired, "Schema target changed during resolution.")
}

// Current is the final target-observation fence. Content identity is not access.
func (e *Entry) Current(observation string) error {
	c := e.snapshot.catalog
	c.mu.Lock()
	defer c.mu.Unlock()
	if !e.active || e.snapshot.retired || observation == "" || e.latest != observation || e.flight != nil || time.Since(e.latestAt) >= Freshness {
		return resetRequired()
	}
	return nil
}

// Resolve coalesces complete target resolution, including provider binding lookup.
// Each caller owns a waiter; the last waiter or target retirement cancels work.
func (e *Entry) Resolve(ctx context.Context, resolve BindingSource, fetch DocumentSource) (Resolution, error) {
	if ctx.Err() != nil {
		return Resolution{}, contextError(ctx)
	}
	c := e.snapshot.catalog
	c.mu.Lock()
	if !e.active || e.snapshot.retired {
		c.mu.Unlock()
		return Resolution{}, resetRequired()
	}
	if cached := e.outcome; cached != nil && time.Since(cached.observed) < Freshness {
		result, err := cached.result, cached.err
		c.mu.Unlock()
		return result, err
	}
	flight := e.flight
	if flight == nil {
		workCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
		flight = &resolutionFlight{done: make(chan struct{}), cancel: cancel, stopped: workCtx.Done()}
		e.flight, e.outcome = flight, nil
		go e.runResolution(workCtx, flight, resolve, fetch)
	}
	flight.waiters++
	c.mu.Unlock()
	select {
	case <-flight.done:
	case <-ctx.Done():
	case <-flight.stopped:
	}
	c.mu.Lock()
	flight.waiters--
	if flight.waiters == 0 && e.flight == flight {
		e.flight = nil
		flight.cancel()
	}
	result, err := flight.result, flight.err
	active := e.active && !e.snapshot.retired
	c.mu.Unlock()
	if ctx.Err() != nil {
		return Resolution{}, contextError(ctx)
	}
	if !active {
		return Resolution{}, resetRequired()
	}
	return result, err
}

func (e *Entry) runResolution(ctx context.Context, flight *resolutionFlight, resolve BindingSource, fetch DocumentSource) {
	result, err := e.resolve(ctx, resolve, fetch)
	c := e.snapshot.catalog
	c.mu.Lock()
	if !e.active || e.snapshot.retired || e.flight != flight || flight.waiters == 0 || ctx.Err() != nil {
		if result.Schema != nil {
			c.store.release(result.Schema.Document)
		}
		result, err = Resolution{}, resetRequired()
	} else {
		c.sequence++
		result.Observation = strconv.FormatUint(c.sequence, 10)
		e.latest = result.Observation
		e.latestAt = time.Now()
		if e.held != nil {
			c.store.release(e.held)
			e.held = nil
		}
		if result.Schema != nil {
			e.held = result.Schema.Document
		}
		// Binding states are observations; transient provider/capacity errors are not.
		if err == nil || result.Binding.State == schemaStateUnavailable || isDeterministic(err) {
			e.outcome = &resolutionOutcome{result: result, err: err, observed: time.Now()}
		}
	}
	flight.result, flight.err = result, err
	if e.flight == flight {
		e.flight = nil
	}
	close(flight.done)
	c.mu.Unlock()
	flight.cancel()
}

func (e *Entry) resolve(ctx context.Context, resolve BindingSource, fetch DocumentSource) (Resolution, error) {
	if ctx.Err() != nil {
		return Resolution{}, contextError(ctx)
	}
	if resolve == nil {
		return Resolution{}, resourcev2.NewError(codeUnsupported, "The provider does not support schema resolution.")
	}
	binding, err := resolve(ctx, resourcev2.SchemaRequest{Route: resourcev2.AccessRoute{Connection: e.snapshot.key.Connection}, Type: e.Type, Target: e.Target})
	if err != nil {
		return Resolution{}, err
	}
	if ctx.Err() != nil {
		return Resolution{}, contextError(ctx)
	}
	result := Resolution{Binding: cloneBinding(binding)}
	if err := resourcev2.ValidateSchemaBinding(binding); err != nil {
		if resourcev2.ErrorCode(err) == codeResourceLimit {
			err = &documentLimitError{err}
		}
		return result, err
	}
	switch binding.State {
	case schemaStateAbsent:
		return result, nil
	case schemaStateUnavailable:
		return result, unavailableBinding(binding)
	case schemaStateAvailable:
		result.Schema, err = e.snapshot.acquireBinding(ctx, binding, fetch)
		if result.Schema != nil && len(binding.Document) > 0 {
			result.Binding.Document = result.Schema.Document.RawJSON()
		}
		return result, err
	default:
		return result, invalidf("unknown schema binding state")
	}
}

// Capacity failures are retryable pressure, unlike document-specific limits.
type capacityError struct{ error }

func pressure(message string) error {
	return &capacityError{resourcev2.NewError(codeResourceLimit, message)}
}
func (e *capacityError) Unwrap() error { return e.error }

type bindingUnavailableError struct{ error }

func (e *bindingUnavailableError) Unwrap() error { return e.error }

type documentLimitError struct{ error }

func (e *documentLimitError) Unwrap() error { return e.error }

// descriptor returns an immutable current support observation without changing
// the target owner when unrelated capabilities or presentation change.
func (e *Entry) descriptor() resourcev2.ResourceType {
	c := e.snapshot.catalog
	c.mu.Lock()
	defer c.mu.Unlock()
	return e.snapshot.descriptors[e.Type]
}
func isDeterministic(err error) bool {
	var capacity *capacityError
	if errors.As(err, &capacity) {
		return false
	}
	var documentLimit *documentLimitError
	return err == nil || errors.As(err, &documentLimit) || resourcev2.ErrorCode(err) == codeInvalidRequest || resourcev2.ErrorCode(err) == codeUnsupported
}

func unavailableBinding(b resourcev2.SchemaBinding) error {
	code := codeUnavailable
	if b.UnavailableReason != nil && *b.UnavailableReason != "" {
		code = *b.UnavailableReason
	}
	return &bindingUnavailableError{resourcev2.NewError(code, "Schema is unavailable for this target.")}
}

func (s *Snapshot) acquireBinding(ctx context.Context, b resourcev2.SchemaBinding, fetch DocumentSource) (*Schema, error) {
	if ctx.Err() != nil {
		return nil, contextError(ctx)
	}
	rules, err := dialectRulesFor(b.Dialect)
	if err != nil {
		return nil, err
	}
	var d *Document
	if len(b.Document) > 0 {
		d, err = s.catalog.store.acquire(b.Dialect, b.Document, s.catalog.policy)
	} else if b.DocumentRef == nil {
		return nil, invalidf("available schema binding has no document")
	} else if fetch == nil {
		return nil, resourcev2.NewError(codeUnsupported, "provider does not serve schema documents")
	} else {
		d, err = s.fetchDocument(ctx, *b.DocumentRef, b.Dialect, fetch)
	}
	if err != nil {
		return nil, err
	}
	root, ok := resolveRoot(d, rules, b.Root)
	if !ok {
		s.catalog.store.release(d)
		return nil, invalidf("schema root does not resolve")
	}
	revision := ""
	if b.Revision != nil {
		revision = *b.Revision
	}
	unvalidated := d.reachableUnvalidated(root)
	validation := ValidationFull
	if len(unvalidated) > 0 {
		validation = ValidationReduced
	}
	return &Schema{Document: d, Root: root, Dialect: b.Dialect, SchemaRevision: revision, Validation: validation, Unvalidated: unvalidated}, nil
}

func resolveRoot(d *Document, rules dialectRules, root string) (NodeID, bool) {
	pointer := ""
	if root != "" {
		var ok bool
		pointer, ok = fragmentPointer(root)
		if !ok {
			return 0, false
		}
	}
	if rules.openAPI && pointer == "" {
		return 0, false
	}
	return d.Lookup(pointer)
}

// fetchDocument retains only normalized content. Successful exact-ref/dialect
// associations reuse the existing store; no parallel raw document cache exists.
func (s *Snapshot) fetchDocument(ctx context.Context, ref resourcev2.SchemaDocumentReference, dialect string, fetch DocumentSource) (*Document, error) {
	if ctx.Err() != nil {
		return nil, contextError(ctx)
	}
	c := s.catalog
	key := documentKey{ref, dialect}
	c.mu.Lock()
	if s.retired {
		c.mu.Unlock()
		return nil, resetRequired()
	}
	if association, ok := s.documents[key]; ok && time.Since(association.observed) < Freshness {
		if document := c.store.retain(association.digest); document != nil {
			c.mu.Unlock()
			return document, nil
		}
		delete(s.documents, key)
	}
	flight := s.fetches[key]
	if flight == nil {
		workCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
		flight = &documentFetch{done: make(chan struct{}), cancel: cancel}
		s.fetches[key] = flight
		go func() {
			var raw resourcev2.SchemaDocument
			var err error
			if workCtx.Err() != nil {
				err = contextError(workCtx)
			} else {
				raw, err = fetch(workCtx, ref)
			}
			var document *Document
			if err == nil && raw.Reference != ref {
				err = invalidf("schema document reference does not match binding")
			}
			if err == nil && raw.Dialect != dialect {
				err = invalidf("schema document dialect does not match binding")
			}
			if err == nil && workCtx.Err() != nil {
				err = contextError(workCtx)
			}
			if err == nil {
				document, err = c.store.acquire(dialect, raw.Document, c.policy)
			}
			c.mu.Lock()
			if s.retired || s.fetches[key] != flight || flight.waiters == 0 || workCtx.Err() != nil {
				if document != nil {
					c.store.release(document)
				}
				document, err = nil, resetRequired()
			} else if err == nil {
				if len(s.documents) >= c.policy.MaxRetainedDocuments {
					var oldest documentKey
					var observed time.Time
					for k, a := range s.documents {
						if observed.IsZero() || a.observed.Before(observed) {
							oldest, observed = k, a.observed
						}
					}
					delete(s.documents, oldest)
				}
				s.documents[key] = documentAssociation{digest: document.Digest, observed: time.Now()}
			}
			flight.document, flight.err = document, err
			close(flight.done)
			c.mu.Unlock()
			cancel()
		}()
	}
	flight.waiters++
	c.mu.Unlock()
	select {
	case <-flight.done:
	case <-ctx.Done():
	}
	c.mu.Lock()
	var document *Document
	if ctx.Err() == nil && flight.document != nil {
		document = c.store.retain(flight.document.Digest)
	}
	err := flight.err
	flight.waiters--
	if flight.waiters == 0 {
		if s.fetches[key] == flight {
			delete(s.fetches, key)
		}
		flight.cancel()
		if flight.document != nil {
			c.store.release(flight.document)
			flight.document = nil
		}
	}
	c.mu.Unlock()
	if ctx.Err() != nil {
		return nil, contextError(ctx)
	}
	return document, err
}
