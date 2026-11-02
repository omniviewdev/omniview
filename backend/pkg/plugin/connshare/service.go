// Package connshare brokers invocation-scoped access to another plugin's resources.
package connshare

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"slices"
	"sync"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	v2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/hostconnections"
)

// Resources is the host resource boundary, not the owner's native client.
type Resources interface {
	ObserveCatalog(context.Context, string, v2.AccessRoute) (v2.Catalog, resource.Observation, error)
	Catalog(context.Context, string, v2.CatalogRequest) (v2.Catalog, error)
	ResolveTarget(context.Context, string, resource.ResolveTargetRequest) (resource.ResolvedTarget, error)
	GetSchemaDocument(context.Context, string, v2.AccessRoute, v2.SchemaDocumentReference) (v2.SchemaDocument, error)
	Get(context.Context, string, resource.HostGetRequest) (resource.HostRecord, error)
	Enumerate(context.Context, string, resource.HostEnumerateRequest) (resource.HostSourcePage, error)
	Mutate(context.Context, string, v2.MutationRequest) (v2.Record, error)
}

type call struct {
	ctx         context.Context
	cancel      context.CancelFunc
	owner       string
	route       v2.AccessRoute
	grant       config.ConnectionGrant
	readonly    bool
	catalog     v2.Catalog
	observation resource.Observation
	validate    func() error
	unregister  func()
	targets     map[string]v2.ReadTarget
}

// Service is bound to exactly one consumer process. Close retires all its calls.
type Service struct {
	mu        sync.Mutex
	consumer  string
	resources Resources
	boundary  *invocation.Boundary
	closed    bool
	calls     map[string]*call
}

func New(consumer string, resources Resources, boundary *invocation.Boundary) *Service {
	return &Service{consumer: consumer, resources: resources, boundary: boundary, calls: make(map[string]*call)}
}

func inactive() error {
	return v2.NewError("DELEGATION_NOT_ACTIVE", "The delegated tool call is not active.")
}
func denied() error {
	return v2.NewError("GRANT_DENIED", "Cross-plugin connection access is not permitted.")
}

// Begin pins one owner catalog and installs its authority on the admitted call.
// validate must check current manifests, owner process, connection state and grants.
func (s *Service) Begin(ctx context.Context, owner string, route v2.AccessRoute, grant config.ConnectionGrant, readonly bool, validate func() error) ([]byte, func(), error) {
	if ctx == nil || owner == "" || route.Connection == "" || validate == nil || s.resources == nil {
		return nil, nil, inactive()
	}
	if err := validate(); err != nil {
		return nil, nil, err
	}
	unregister, err := s.boundary.RegisterDelegation(ctx, invocation.Delegation{Consumer: s.consumer, Owner: owner, Connection: route.Connection, ReadOnly: readonly, Grant: grant})
	if err != nil {
		return nil, nil, err
	}
	callCtx, cancel := context.WithCancel(ctx)
	catalog, observation, err := s.resources.ObserveCatalog(callCtx, owner, route)
	if err != nil {
		cancel()
		unregister()
		return nil, nil, err
	}
	filtered := catalog
	filtered.Types = make([]v2.ResourceType, 0, len(catalog.Types))
	for _, typ := range catalog.Types {
		if grant.Allows("catalog", typ.Type) {
			filtered.Types = append(filtered.Types, typ)
		}
	}
	var token [32]byte
	if _, err = rand.Read(token[:]); err != nil {
		cancel()
		unregister()
		return nil, nil, err
	}
	key := hex.EncodeToString(token[:])
	entry := &call{ctx: callCtx, cancel: cancel, owner: owner, route: route, grant: grant, readonly: readonly, catalog: filtered, observation: observation, validate: validate, unregister: unregister, targets: make(map[string]v2.ReadTarget)}
	s.mu.Lock()
	if s.closed || s.calls[key] != nil {
		s.mu.Unlock()
		cancel()
		unregister()
		return nil, nil, inactive()
	}
	s.calls[key] = entry
	s.mu.Unlock()
	stop := func() { s.retire(key, entry) }
	context.AfterFunc(callCtx, stop)
	return token[:], stop, nil
}

func (s *Service) retire(key string, entry *call) {
	s.mu.Lock()
	if s.calls[key] != entry {
		s.mu.Unlock()
		return
	}
	delete(s.calls, key)
	s.mu.Unlock()
	entry.cancel()
	entry.unregister()
}

func (s *Service) Close() {
	s.mu.Lock()
	s.closed = true
	entries := s.calls
	s.calls = make(map[string]*call)
	s.mu.Unlock()
	for _, entry := range entries {
		entry.cancel()
		entry.unregister()
	}
}

// RetireOwner cancels calls that borrowed a retired owner process.
func (s *Service) RetireOwner(owner string) {
	s.retireRoute(owner, "")
}

// RetireConnection cancels every capability for a changing owner route.
func (s *Service) RetireConnection(owner, connection string) {
	s.retireRoute(owner, connection)
}

func (s *Service) retireRoute(owner, connection string) {
	s.mu.Lock()
	var retired []*call
	for key, entry := range s.calls {
		if entry.owner == owner && (connection == "" || entry.route.Connection == connection) {
			delete(s.calls, key)
			retired = append(retired, entry)
		}
	}
	s.mu.Unlock()
	for _, entry := range retired {
		entry.cancel()
		entry.unregister()
	}
}

func (s *Service) acquire(ctx context.Context, token []byte, owner string, route v2.AccessRoute) (*call, context.Context, func(), error) {
	if len(token) != 32 || ctx == nil {
		return nil, nil, nil, inactive()
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, nil, err
	}
	s.mu.Lock()
	entry := s.calls[hex.EncodeToString(token)]
	s.mu.Unlock()
	if entry == nil || entry.owner != owner || entry.route != route || entry.ctx.Err() != nil {
		return nil, nil, nil, inactive()
	}
	if err := entry.validate(); err != nil {
		return nil, nil, nil, err
	}
	joined, cancel := context.WithCancel(entry.ctx)
	stop := context.AfterFunc(ctx, cancel)
	return entry, resource.WithObservation(joined, entry.observation), func() { stop(); cancel() }, nil
}

func (s *Service) finish(entry *call, ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := entry.validate(); err != nil {
		return err
	}
	if _, err := s.resources.Catalog(ctx, entry.owner, v2.CatalogRequest{Route: entry.route}); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return entry.validate()
}

func (s *Service) Catalog(ctx context.Context, token []byte, owner string, req v2.CatalogRequest) (v2.Catalog, error) {
	entry, callCtx, done, err := s.acquire(ctx, token, owner, req.Route)
	if err != nil {
		return v2.Catalog{}, err
	}
	defer done()
	if err = s.finish(entry, callCtx); err != nil {
		return v2.Catalog{}, err
	}
	return entry.catalog, nil
}
func (s *Service) ResolveTarget(ctx context.Context, token []byte, owner string, req hostconnections.ResolveTargetRequest) (hostconnections.ResolvedTarget, error) {
	entry, callCtx, done, err := s.acquire(ctx, token, owner, req.Route)
	if err != nil {
		return hostconnections.ResolvedTarget{}, err
	}
	defer done()
	if !entry.grant.Allows("catalog", req.Type) {
		return hostconnections.ResolvedTarget{}, denied()
	}
	out, err := s.resources.ResolveTarget(callCtx, owner, resource.ResolveTargetRequest{Route: req.Route, Type: req.Type, Scope: req.Scope, Representation: req.Representation})
	if err != nil {
		return hostconnections.ResolvedTarget{}, err
	}
	if err = s.finish(entry, callCtx); err != nil {
		return hostconnections.ResolvedTarget{}, err
	}
	target, _, err := v2.CanonicalReadTarget(out.Target)
	if err != nil {
		return hostconnections.ResolvedTarget{}, err
	}
	s.mu.Lock()
	if s.calls[hex.EncodeToString(token)] != entry {
		s.mu.Unlock()
		return hostconnections.ResolvedTarget{}, inactive()
	}
	entry.targets[out.TargetID] = target
	s.mu.Unlock()
	return hostconnections.ResolvedTarget{TargetID: out.TargetID, Target: target}, nil
}
func (s *Service) GetSchemaDocument(ctx context.Context, token []byte, owner string, route v2.AccessRoute, ref v2.SchemaDocumentReference) (v2.SchemaDocument, error) {
	entry, callCtx, done, err := s.acquire(ctx, token, owner, route)
	if err != nil {
		return v2.SchemaDocument{}, err
	}
	defer done()
	found := false
	for _, typ := range entry.catalog.Types {
		for _, representation := range typ.Representations {
			if representation.Schema.DocumentRef != nil && *representation.Schema.DocumentRef == ref {
				found = true
			}
		}
	}
	if !found {
		return v2.SchemaDocument{}, denied()
	}
	out, err := s.resources.GetSchemaDocument(callCtx, owner, route, ref)
	if err != nil {
		return v2.SchemaDocument{}, err
	}
	if err = s.finish(entry, callCtx); err != nil {
		return v2.SchemaDocument{}, err
	}
	return out, nil
}
func (s *Service) target(token []byte, entry *call, id string) (v2.ReadTarget, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.calls[hex.EncodeToString(token)] != entry {
		return v2.ReadTarget{}, false
	}
	t, ok := entry.targets[id]
	return t, ok
}
func targetMatchesReference(target v2.ReadTarget, route v2.AccessRoute, reference v2.ResourceReference) bool {
	a := reference.Address
	if target.Route != route || target.Provider != a.Provider || target.Authority != a.Authority || target.Type != a.Type {
		return false
	}
	for _, constraint := range target.Scope {
		if constraint.Match == v2.ScopeAny {
			continue
		}
		found := false
		for _, entry := range a.Scope {
			if entry.Dimension == constraint.Dimension && constraint.Values != nil && slices.Contains(*constraint.Values, entry.Value) {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}
func (s *Service) Get(ctx context.Context, token []byte, owner, id string, req v2.GetRequest) (v2.Record, error) {
	entry, callCtx, done, err := s.acquire(ctx, token, owner, req.Route)
	if err != nil {
		return v2.Record{}, err
	}
	defer done()
	target, ok := s.target(token, entry, id)
	if !ok {
		return v2.Record{}, inactive()
	}
	if !targetMatchesReference(target, req.Route, req.Reference) || target.Representation != req.Representation || !entry.grant.Allows("get", target.Type) {
		return v2.Record{}, denied()
	}
	out, err := s.resources.Get(callCtx, owner, resource.HostGetRequest{TargetID: id, Request: req})
	if err != nil {
		return v2.Record{}, err
	}
	if err = s.finish(entry, callCtx); err != nil {
		return v2.Record{}, err
	}
	return out.Record, nil
}
func (s *Service) Enumerate(ctx context.Context, token []byte, owner, id string, req v2.EnumerateRequest) (v2.SourcePage, error) {
	entry, callCtx, done, err := s.acquire(ctx, token, owner, req.Target.Route)
	if err != nil {
		return v2.SourcePage{}, err
	}
	defer done()
	target, ok := s.target(token, entry, id)
	if !ok {
		return v2.SourcePage{}, inactive()
	}
	_, wanted, err := v2.CanonicalReadTarget(req.Target)
	if err != nil {
		return v2.SourcePage{}, err
	}
	_, actual, err := v2.CanonicalReadTarget(target)
	if err != nil || actual != wanted || !entry.grant.Allows("enumerate", target.Type) {
		return v2.SourcePage{}, denied()
	}
	out, err := s.resources.Enumerate(callCtx, owner, resource.HostEnumerateRequest{TargetID: id, Request: req})
	if err != nil {
		return v2.SourcePage{}, err
	}
	if err = s.finish(entry, callCtx); err != nil {
		return v2.SourcePage{}, err
	}
	page := v2.SourcePage{Records: make([]v2.Record, 0, len(out.Records)), NextCursor: out.SourcePage.NextCursor, Count: out.SourcePage.Count, Coverage: out.SourcePage.Coverage, Consistency: out.SourcePage.Consistency, SourceRevision: out.SourcePage.SourceRevision}
	for _, row := range out.Records {
		page.Records = append(page.Records, row.Record)
	}
	return page, nil
}
func (s *Service) Update(ctx context.Context, token []byte, owner, id string, req v2.MutationRequest) (v2.Record, error) {
	entry, callCtx, done, err := s.acquire(ctx, token, owner, req.Route)
	if err != nil {
		return v2.Record{}, err
	}
	defer done()
	target, ok := s.target(token, entry, id)
	if !ok {
		return v2.Record{}, inactive()
	}
	if entry.readonly || req.Operation != "update" || req.ExpectedRevision == nil || *req.ExpectedRevision == "" || !targetMatchesReference(target, req.Route, req.Reference) || !entry.grant.Allows("update", target.Type) {
		return v2.Record{}, denied()
	}
	out, err := s.resources.Mutate(callCtx, owner, req)
	if err != nil {
		return v2.Record{}, err
	}
	if err = s.finish(entry, callCtx); err != nil {
		return v2.Record{}, err
	}
	return out, nil
}

var _ hostconnections.Service = (*Service)(nil)
