package resourcecatalog

import (
	"context"
	"encoding/hex"
	"slices"
	"sort"
	"sync"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	schemaStateAbsent      = "absent"
	schemaStateAvailable   = "available"
	schemaStateUnavailable = "unavailable"

	// ValidationFull marks a schema whose reachable constraints are all enforced.
	ValidationFull = "full"
	// ValidationReduced marks a schema with listed unenforced constraints.
	ValidationReduced = "reduced"
)

// Catalog is the host's single schema catalog. It holds one Snapshot per
// (plugin, connection) and shares immutable documents across snapshots by
// content digest. Its mutex is a leaf lock: nothing called under it reaches
// back into the resource controller.
type Catalog struct {
	mu          sync.Mutex
	store       *store
	connections map[connectionSlot]*Snapshot
	policy      Policy
}

type connectionSlot struct{ pluginID, connection string }

// NewCatalog returns an empty catalog bounded by policy.
func NewCatalog(policy Policy) *Catalog {
	return &Catalog{store: newStore(), connections: map[connectionSlot]*Snapshot{}, policy: policy}
}

// ConnectionKey scopes a snapshot; every field takes part in snapshot identity.
type ConnectionKey struct {
	PluginID, Generation, Connection string
	Epoch                            uint64
}

// DocumentSource fetches a referenced raw schema document from the provider.
type DocumentSource func(ctx context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error)

// Snapshot is the catalog view of one connection at one key and catalog
// revision. A replaced or dropped snapshot is retired: it releases its
// documents and its resolutions return RESET_REQUIRED.
type Snapshot struct {
	catalog  *Catalog
	key      ConnectionKey
	revision string
	provider string
	entries  map[[2]string]*Entry
	sorted   []*Entry
	fetchMu  sync.Mutex
	fetches  map[resourcev2.SchemaDocumentReference]*documentFetch

	// Guarded by catalog.mu.
	aux     []*Document
	retired bool
}

type documentFetch struct {
	done     chan struct{}
	cancel   context.CancelFunc
	waiters  int
	document resourcev2.SchemaDocument
	err      error
}

// Entry is one (type, representation) binding of a snapshot. Exported fields
// are read-only; callers must not mutate them.
type Entry struct {
	Type, Representation, RepresentationRevision string
	Binding                                      resourcev2.SchemaBinding
	Descriptor                                   resourcev2.ResourceType

	snapshot *Snapshot

	mu       sync.Mutex
	inflight chan struct{}  // closed when the in-flight resolve finishes
	outcome  *resolveResult // cached deterministic outcome

	held *Document // installed document; guarded by catalog.mu
}

type resolveResult struct {
	schema *Schema
	err    error
}

// Schema is a resolved representation schema: a normalized document, the root
// node selected by the binding, and the constraints admission cannot enforce.
type Schema struct {
	Document       *Document
	Root           NodeID
	Dialect        string
	SchemaRevision string
	Validation     string       // "full" | "reduced"
	Unvalidated    []Constraint // reachable from Root, sorted, deduplicated
}

// AuxResult is the per-item outcome of ResolveAux.
type AuxResult struct {
	Schema   resourcev2.EditorSchema
	Resolved *Schema // nil for absent bindings and failures
	Err      error
}

// Observe returns the snapshot for key and catalog, replacing (and retiring)
// the stored snapshot of the same (plugin, connection) when any key field or
// the catalog revision differs. It performs no I/O.
func (c *Catalog) Observe(key ConnectionKey, catalog resourcev2.Catalog) *Snapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	slot := connectionSlot{pluginID: key.PluginID, connection: key.Connection}
	current := c.connections[slot]
	if current != nil && current.key == key && current.revision == catalog.Revision {
		return current
	}
	next := newSnapshot(c, key, catalog)
	if current != nil {
		c.retireLocked(current)
	}
	c.connections[slot] = next
	return next
}

// DropConnection retires the snapshot of one connection.
func (c *Catalog) DropConnection(pluginID, connection string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	slot := connectionSlot{pluginID: pluginID, connection: connection}
	if s := c.connections[slot]; s != nil {
		c.retireLocked(s)
		delete(c.connections, slot)
	}
}

// DropPlugin retires every snapshot of one plugin.
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

func (c *Catalog) retireLocked(s *Snapshot) {
	s.retired = true
	for _, e := range s.sorted {
		if e.held != nil {
			c.store.release(e.held)
			e.held = nil
		}
	}
	for _, d := range s.aux {
		c.store.release(d)
	}
	s.aux = nil
}

func newSnapshot(c *Catalog, key ConnectionKey, catalog resourcev2.Catalog) *Snapshot {
	s := &Snapshot{
		catalog:  c,
		key:      key,
		revision: catalog.Revision,
		provider: catalog.Provider,
		entries:  map[[2]string]*Entry{},
	}
	for _, t := range catalog.Types {
		descriptor := cloneResourceType(t)
		for _, r := range descriptor.Representations {
			s.entries[[2]string{t.Type, r.ID}] = &Entry{
				Type:                   t.Type,
				Representation:         r.ID,
				RepresentationRevision: r.Revision,
				Binding:                r.Schema,
				Descriptor:             descriptor,
				snapshot:               s,
			}
		}
	}
	s.sorted = make([]*Entry, 0, len(s.entries))
	for _, e := range s.entries {
		s.sorted = append(s.sorted, e)
	}
	sort.Slice(s.sorted, func(i, j int) bool {
		if s.sorted[i].Type != s.sorted[j].Type {
			return s.sorted[i].Type < s.sorted[j].Type
		}
		return s.sorted[i].Representation < s.sorted[j].Representation
	})
	return s
}

// cloneResourceType copies the descriptor containers the catalog retains so
// later mutation of the observed catalog cannot change a snapshot. Native
// query input schemas are shared read-only.
func cloneResourceType(t resourcev2.ResourceType) resourcev2.ResourceType {
	out := t
	out.IdentityDimensions = slices.Clone(t.IdentityDimensions)
	out.QueryDimensions = slices.Clone(t.QueryDimensions)
	out.NativeQueries = slices.Clone(t.NativeQueries)
	out.Representations = make([]resourcev2.Representation, len(t.Representations))
	for i, r := range t.Representations {
		r.Schema = cloneBinding(r.Schema)
		out.Representations[i] = r
	}
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
	out.Document = slices.Clone(b.Document)
	return out
}

// Revision returns the observed catalog revision.
func (s *Snapshot) Revision() string { return s.revision }

// Provider returns the observed catalog provider.
func (s *Snapshot) Provider() string { return s.provider }

// Entry returns the binding of one (type, representation).
func (s *Snapshot) Entry(resourceType, representation string) (*Entry, error) {
	e, ok := s.entries[[2]string{resourceType, representation}]
	if !ok {
		return nil, resourcev2.NewError(codeNotFound, "Resource type or representation is not in the route catalog.")
	}
	return e, nil
}

// Entries returns every entry sorted by type, then representation.
func (s *Snapshot) Entries() []*Entry { return slices.Clone(s.sorted) }

// Document returns a document referenced by this snapshot's resolved entries
// or auxiliary results, by full hex digest.
func (s *Snapshot) Document(digestHex string) (*Document, bool) {
	c := s.catalog
	c.mu.Lock()
	defer c.mu.Unlock()
	if s.retired {
		return nil, false
	}
	match := func(d *Document) bool { return d != nil && hex.EncodeToString(d.Digest[:]) == digestHex }
	for _, e := range s.sorted {
		if match(e.held) {
			return e.held, true
		}
	}
	for _, d := range s.aux {
		if match(d) {
			return d, true
		}
	}
	return nil, false
}

func (s *Snapshot) isRetired() bool {
	s.catalog.mu.Lock()
	defer s.catalog.mu.Unlock()
	return s.retired
}

func resetRequired() error {
	return resourcev2.NewError(codeResetRequired, "Schema catalog changed during resolution.")
}

// Resolve returns the entry's normalized schema. Absent bindings return
// (nil, nil). At most one resolve per entry is in flight; deterministic
// outcomes (success, INVALID_REQUEST, UNSUPPORTED, RESOURCE_LIMIT and the
// binding-state outcomes) are cached, transient fetch errors and
// RESET_REQUIRED are not.
func (e *Entry) Resolve(ctx context.Context, fetch DocumentSource) (*Schema, error) {
	switch e.Binding.State {
	case schemaStateAbsent:
		return nil, nil
	case schemaStateUnavailable:
		return nil, unavailableBinding(e.Binding)
	case schemaStateAvailable:
	default:
		return nil, invalidf("unknown schema binding state")
	}
	for {
		if e.snapshot.isRetired() {
			return nil, resetRequired()
		}
		e.mu.Lock()
		if e.outcome != nil {
			result := e.outcome
			e.mu.Unlock()
			return result.schema, result.err
		}
		if wait := e.inflight; wait != nil {
			e.mu.Unlock()
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return nil, contextError(ctx)
			}
		}
		done := make(chan struct{})
		e.inflight = done
		e.mu.Unlock()

		schema, err := e.resolveAvailable(ctx, fetch)
		e.mu.Lock()
		e.inflight = nil
		if isDeterministic(err) {
			e.outcome = &resolveResult{schema: schema, err: err}
		}
		e.mu.Unlock()
		close(done)
		return schema, err
	}
}

func (e *Entry) resolveAvailable(ctx context.Context, fetch DocumentSource) (*Schema, error) {
	s := e.snapshot
	schema, err := s.acquireBinding(ctx, e.Binding, fetch)
	if err != nil {
		return nil, err
	}
	c := s.catalog
	c.mu.Lock()
	if s.retired {
		c.mu.Unlock()
		c.store.release(schema.Document)
		return nil, resetRequired()
	}
	e.held = schema.Document
	c.mu.Unlock()
	return schema, nil
}

// isDeterministic reports whether an outcome is cached: success and the
// normalization codes, whatever their origin.
func isDeterministic(err error) bool {
	if err == nil {
		return true
	}
	switch resourcev2.ErrorCode(err) {
	case codeInvalidRequest, codeUnsupported, codeResourceLimit:
		return true
	default:
		return false
	}
}

func unavailableBinding(b resourcev2.SchemaBinding) error {
	code := codeUnavailable
	if b.UnavailableReason != nil && *b.UnavailableReason != "" {
		code = *b.UnavailableReason
	}
	return resourcev2.NewError(code, "Schema is unavailable for this representation.")
}

// acquireBinding resolves an available binding into a Schema whose Document
// carries one store reference owned by the caller.
func (s *Snapshot) acquireBinding(ctx context.Context, b resourcev2.SchemaBinding, fetch DocumentSource) (*Schema, error) {
	rules, err := dialectRulesFor(b.Dialect)
	if err != nil {
		return nil, err
	}
	raw := []byte(b.Document)
	if len(raw) == 0 {
		if b.DocumentRef == nil {
			return nil, invalidf("available schema binding has no document")
		}
		if fetch == nil {
			return nil, resourcev2.NewError(codeUnsupported, "provider does not serve schema documents")
		}
		raw, err = s.fetchDocument(ctx, *b.DocumentRef, b.Dialect, fetch)
		if err != nil {
			return nil, err
		}
	}
	c := s.catalog
	d, err := c.store.acquire(b.Dialect, raw, c.policy)
	if err != nil {
		return nil, err
	}
	root, ok := resolveRoot(d, rules, b.Root)
	if !ok {
		c.store.release(d)
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
	return &Schema{
		Document:       d,
		Root:           root,
		Dialect:        b.Dialect,
		SchemaRevision: revision,
		Validation:     validation,
		Unvalidated:    unvalidated,
	}, nil
}

// resolveRoot maps a binding Root URI fragment to a normalized node. OpenAPI
// documents have no root schema, so their bindings must name one.
func resolveRoot(d *Document, rules dialectRules, root string) (NodeID, bool) {
	pointer := ""
	if root != "" {
		var ok bool
		if pointer, ok = fragmentPointer(root); !ok {
			return 0, false
		}
	}
	if rules.openAPI && pointer == "" {
		return 0, false
	}
	return d.Lookup(pointer)
}

// fetchDocument shares an in-flight provider fetch by reference. Each caller
// validates the returned dialect against its own binding.
func (s *Snapshot) fetchDocument(ctx context.Context, ref resourcev2.SchemaDocumentReference, dialect string, fetch DocumentSource) ([]byte, error) {
	if ctx.Err() != nil {
		return nil, contextError(ctx)
	}
	s.fetchMu.Lock()
	if s.fetches == nil {
		s.fetches = make(map[resourcev2.SchemaDocumentReference]*documentFetch)
	}
	flight := s.fetches[ref]
	if flight == nil {
		fetchCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
		flight = &documentFetch{done: make(chan struct{}), cancel: cancel}
		s.fetches[ref] = flight
		go func() {
			document, err := fetch(fetchCtx, ref)
			s.fetchMu.Lock()
			flight.document, flight.err = document, err
			if s.fetches[ref] == flight {
				delete(s.fetches, ref)
			}
			close(flight.done)
			s.fetchMu.Unlock()
			cancel()
		}()
	}
	flight.waiters++
	s.fetchMu.Unlock()

	select {
	case <-flight.done:
	case <-ctx.Done():
	}
	s.fetchMu.Lock()
	flight.waiters--
	if flight.waiters == 0 && s.fetches[ref] == flight {
		delete(s.fetches, ref)
		flight.cancel()
	}
	s.fetchMu.Unlock()
	if ctx.Err() != nil {
		return nil, contextError(ctx)
	}
	if flight.err != nil {
		return nil, flight.err
	}
	if flight.document.Reference != ref {
		return nil, invalidf("schema document reference does not match binding")
	}
	if flight.document.Dialect != dialect {
		return nil, invalidf("schema document dialect does not match binding")
	}
	return []byte(flight.document.Document), nil
}

// ResolveAux normalizes auxiliary editor schemas (not catalog
// representations), atomically replaces the snapshot's auxiliary documents
// and releases the previous ones. Per-item failures are reported in
// AuxResult.Err; lifecycle failures (cancellation, retirement) fail the call.
func (s *Snapshot) ResolveAux(ctx context.Context, schemas []resourcev2.EditorSchema, fetch DocumentSource) ([]AuxResult, error) {
	c := s.catalog
	if s.isRetired() {
		return nil, resetRequired()
	}
	results := make([]AuxResult, len(schemas))
	var held []*Document
	releaseHeld := func() {
		for _, d := range held {
			c.store.release(d)
		}
	}
	for i, schema := range schemas {
		results[i].Schema = schema
		switch schema.Binding.State {
		case schemaStateAbsent:
		case schemaStateUnavailable:
			results[i].Err = unavailableBinding(schema.Binding)
		case schemaStateAvailable:
			resolved, err := s.acquireBinding(ctx, schema.Binding, fetch)
			if err != nil {
				results[i].Err = err
				break
			}
			held = append(held, resolved.Document)
			results[i].Resolved = resolved
		default:
			results[i].Err = invalidf("unknown schema binding state")
		}
		if err := results[i].Err; err != nil {
			switch resourcev2.ErrorCode(err) {
			case codeCancelled, codeTimeout, codeResetRequired:
				releaseHeld()
				return nil, err
			}
		}
	}
	if ctx.Err() != nil {
		releaseHeld()
		return nil, contextError(ctx)
	}
	c.mu.Lock()
	if ctx.Err() != nil {
		c.mu.Unlock()
		releaseHeld()
		return nil, contextError(ctx)
	}
	if s.retired {
		c.mu.Unlock()
		releaseHeld()
		return nil, resetRequired()
	}
	previous := s.aux
	s.aux = held
	for _, d := range previous {
		c.store.release(d)
	}
	c.mu.Unlock()
	return results, nil
}
