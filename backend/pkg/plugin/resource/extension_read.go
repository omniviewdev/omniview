package resource

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/extensionpolicy"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/extensionread"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	extensionReadTimeout = 5 * time.Second
	readStateUnavailable = "unavailable"
	readStateFailed      = "failed"
	readStateReady       = "ready"
	readCoverageComplete = "complete"
	readCoveragePartial  = "partial"
)

// ExtensionReadResult is the entire renderer response. No native error, citation,
// count, continuation, target, or provider-specific metadata crosses this boundary.
type ExtensionReadResult struct {
	State string             `json:"state"`
	Page  *ExtensionReadPage `json:"page,omitempty"`
}

func unavailableRead() ExtensionReadResult {
	return ExtensionReadResult{State: readStateUnavailable, Page: nil}
}

func failedRead() ExtensionReadResult {
	return ExtensionReadResult{State: readStateFailed, Page: nil}
}

type ExtensionReadPage struct {
	Rows      []map[string]any `json:"rows"`
	Coverage  string           `json:"coverage"`
	Truncated bool             `json:"truncated"`
}

// Neither a renderer locator nor a scalar grant is a read capability. Resolve the
// signed declarations and the independent profile decision inside the host.
type extensionReadRequest struct {
	Binding extensionread.Binding `json:"binding"`
	Root    ExtensionRootProof    `json:"root"`
}

type readConsent func(extensionread.Binding) (extensionread.Contract, bool)

type ExtensionReadService struct {
	ctrl     *controller
	realm    *invocation.WindowRealm
	boundary *invocation.Boundary
	resolve  readConsent

	mu      sync.Mutex
	windows map[invocation.WindowIdentity]*extensionReadLane
}

// The invalidator is native-only. Register it before opening the policy store.
// It never reads the store or runs provider code under its lock.
func NewExtensionReadService(ctrl Controller, realm *invocation.WindowRealm, boundary *invocation.Boundary, resolve func(extensionread.Binding) (extensionread.Contract, bool)) (*ExtensionReadService, func(extensionpolicy.Change)) {
	implementation, _ := ctrl.(*controller)
	s := &ExtensionReadService{
		ctrl: implementation, realm: realm, boundary: boundary, resolve: resolve,
		mu: sync.Mutex{}, windows: nil,
	}
	if realm != nil {
		realm.OnRetire(func(key invocation.WindowIdentity) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if lane := s.windows[key]; lane != nil {
				lane.invalidate(nil)
			}
		})
	}
	return s, s.invalidatePolicy
}

// ReadRelatedV1 accepts only two private selectors. The operation, row shape,
// configured connection, principal and exact object come from native admissions.
// Bound the JSON *before* decoding nested resource identity and scope arrays.
func (s *ExtensionReadService) ReadRelatedV1(ctx context.Context, encoded string) ExtensionReadResult {
	unavailable := unavailableRead()
	if s.realm == nil || s.ctrl == nil || s.resolve == nil || len(encoded) == 0 || len(encoded) > 16<<10 {
		return unavailable
	}
	var req extensionReadRequest
	if err := decodeHostRequest([]byte(encoded), &req); err != nil {
		return unavailable
	}
	owner, _, ok := strings.Cut(req.Binding.Point, "/")
	if !ok || owner == "" || owner != req.Root.Owner || req.Binding.Read == "" || req.Binding.Continuity == "" {
		return unavailable
	}
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	if window == nil {
		return unavailable
	}
	ctx = s.realm.Context(ctx)
	ctx, err := s.boundary.Admit(ctx, "resource.ReadRelatedV1", referenceTarget(owner, resourcev2.AccessRoute{Connection: req.Root.Connection}, req.Root.Reference))
	actor, admitted := invocation.FromContext(ctx)
	if err != nil || !admitted || actor.Principal().Origin() != invocation.TrustedUI || !actor.OwnedBy(ctx) {
		return unavailable
	}
	return s.inLane(ctx, invocation.IdentityOf(window), req.Binding, func(ctx context.Context) ExtensionReadResult {
		// Close the gap between admitting the realm and reserving its work slot.
		if !actor.OwnedBy(s.realm.Context(ctx)) {
			return unavailable
		}
		return s.read(ctx, owner, req)
	})
}

type extensionReadTask struct {
	binding extensionread.Binding
	ctx     context.Context
	cancel  context.CancelFunc
	done    chan struct{}
}

type extensionReadLane struct {
	active  *extensionReadTask
	waiting *extensionReadTask
}

func (l *extensionReadLane) invalidate(affected *[]extensionpolicy.AffectedBinding) {
	for _, t := range [2]*extensionReadTask{l.active, l.waiting} {
		if t == nil {
			continue
		}
		if affected == nil {
			t.cancel()
			continue
		}
		for _, b := range *affected {
			if b.Point == t.binding.Point && b.Offer == t.binding.Offer {
				t.cancel()
				break
			}
		}
	}
}

func (s *ExtensionReadService) invalidatePolicy(change extensionpolicy.Change) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, lane := range s.windows {
		lane.invalidate(change.Affected)
	}
}

func readStopped(ctx context.Context) ExtensionReadResult {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return failedRead()
	}
	return unavailableRead()
}

// Reserve the window under the service lock. A nil lane refuses a hung owner
// generation. A non-nil predecessor must settle before the reservation can run.
func (s *ExtensionReadService) reserveLane(window invocation.WindowIdentity, task *extensionReadTask) (*extensionReadLane, <-chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.windows == nil {
		s.windows = make(map[invocation.WindowIdentity]*extensionReadLane)
	}
	lane := s.windows[window]
	if lane == nil {
		lane = new(extensionReadLane)
		s.windows[window] = lane
	}
	if lane.waiting != nil {
		lane.waiting.cancel()
	}
	active := lane.active
	if active == nil {
		lane.active, lane.waiting = task, nil
		return lane, nil
	}
	if errors.Is(active.ctx.Err(), context.DeadlineExceeded) && active.binding.OwnerGeneration == task.binding.OwnerGeneration {
		return nil, nil
	}
	active.cancel()
	lane.waiting = task
	return lane, active.done
}

func (s *ExtensionReadService) awaitLane(window invocation.WindowIdentity, lane *extensionReadLane, task *extensionReadTask, predecessor <-chan struct{}) bool {
	select {
	case <-predecessor:
	case <-task.ctx.Done():
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if lane.waiting != task {
		return false
	}
	if task.ctx.Err() != nil {
		lane.waiting = nil
		if lane.active == nil {
			delete(s.windows, window)
		}
		return false
	}
	lane.active, lane.waiting = task, nil
	return true
}

// One physical demand and at most one superseding selection per window. A
// noncooperative handler holds its slot until settlement, not just until abort.
// No queued request starts after deselection, policy loss or its own deadline.
func (s *ExtensionReadService) inLane(parent context.Context, window invocation.WindowIdentity, binding extensionread.Binding, work func(context.Context) ExtensionReadResult) ExtensionReadResult {
	ctx, cancel := context.WithTimeout(parent, extensionReadTimeout)
	defer cancel()
	t := &extensionReadTask{ctx: ctx, cancel: cancel, binding: binding, done: make(chan struct{})}
	lane, predecessor := s.reserveLane(window, t)
	if lane == nil {
		return unavailableRead()
	}
	if predecessor != nil && !s.awaitLane(window, lane, t, predecessor) {
		return readStopped(ctx)
	}
	answer := make(chan ExtensionReadResult, 1)
	delivered := make(chan struct{})
	defer close(delivered)
	go func() {
		var out ExtensionReadResult
		if ctx.Err() == nil {
			out = work(ctx)
		}
		if ctx.Err() != nil {
			out = readStopped(ctx)
		}
		answer <- out
		// A completed worker is still supersedable until the transport caller
		// takes the result. This closes the gap between settlement and delivery.
		<-delivered
		s.mu.Lock()
		lane.active = nil
		if lane.waiting == nil {
			delete(s.windows, window)
		}
		close(t.done)
		s.mu.Unlock()
	}()
	select {
	case <-ctx.Done():
		return readStopped(ctx)
	case result := <-answer:
		if ctx.Err() != nil {
			return readStopped(ctx)
		}
		return result
	}
}

func (s *ExtensionReadService) read(ctx context.Context, owner string, req extensionReadRequest) ExtensionReadResult {
	contract, ok := s.resolve(req.Binding)
	if !ok || contract.OwnerLife == nil || contract.ContributorLife == nil || contract.OwnerLife.Err() != nil || contract.ContributorLife.Err() != nil {
		return unavailableRead()
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stopOwner := context.AfterFunc(contract.OwnerLife, cancel)
	defer stopOwner()
	stopPeer := context.AfterFunc(contract.ContributorLife, cancel)
	defer stopPeer()
	stopRoot, err := s.ctrl.watchExtensionRoot(ctx, owner, req.Root, cancel)
	if err != nil {
		return unavailableRead()
	}
	defer stopRoot()
	root, route, guard, err := s.ctrl.AdmitExtensionRoot(ctx, owner, req.Root)
	if err != nil || guard == nil || root.Incarnation == nil || *root.Incarnation == "" || route.Connection == "" {
		return unavailableRead()
	}
	provider, gen, ctx, release, err := s.ctrl.operationGeneration(ctx, owner, route)
	if err != nil {
		return unavailableRead()
	}
	defer release()
	ctx, ok = relatedReadRequester(ctx)
	if !ok {
		return unavailableRead()
	}
	reader, ok := provider.(relatedReadProvider)
	if !ok {
		return unavailableRead()
	}
	ctx, catalog, err := s.ctrl.admitAncillaryCatalog(ctx, owner, provider, gen, route, root.Address.Type, &root)
	if err != nil {
		return unavailableRead()
	}
	admission := relatedReadAdmission{service: s, owner: owner, generation: gen, binding: &req.Binding, contract: &contract, guard: guard}
	request := extensionread.Request{Operation: contract.Operation, Root: root, Route: route, Sources: nil}
	result, proof := admission.collect(ctx, reader, catalog, &request)
	return admission.disclose(ctx, result, proof)
}

type relatedReadProvider interface {
	ResourceProvider
	extensionread.Provider
	extensionread.SourceProvider
}

func relatedReadRequester(ctx context.Context) (context.Context, bool) {
	actor, admitted := invocation.FromContext(ctx)
	session, native := resourcev2.SessionFromContext(ctx)
	if !admitted || !native || !actor.OwnedBy(ctx) {
		return ctx, false
	}
	// The connection determines native credentials. The private requester on
	// this RPC is the actual caller, not the shared "trusted-ui" origin class.
	session.RequesterID = actor.Principal().Owner()
	return resourcev2.WithSession(ctx, session), true
}

type relatedReadAdmission struct {
	service    *ExtensionReadService
	owner      string
	generation *pluginState
	binding    *extensionread.Binding
	contract   *extensionread.Contract
	guard      func(context.Context) error
}

// A changed or revoked binding is never promoted to its replacement, even if
// both versions authorize the same read and have identical scalar fields.
func (a *relatedReadAdmission) current(ctx context.Context) bool {
	if ctx.Err() != nil || a.contract.OwnerLife.Err() != nil || a.contract.ContributorLife.Err() != nil ||
		a.service.ctrl.currentGeneration(ctx, a.owner, a.generation) != nil {
		return false
	}
	_, permitted := a.service.resolve(*a.binding)
	return permitted && ctx.Err() == nil
}

func (a *relatedReadAdmission) disclose(ctx context.Context, result ExtensionReadResult, proof *relatedEvidence) ExtensionReadResult {
	// Failed replies also disclose a state. A revoked root, replaced source or
	// changed grant cannot publish an old failure either.
	if result.State != readStateUnavailable && (ctx.Err() != nil || a.guard(ctx) != nil || (proof != nil && !proof.current()) || !a.current(ctx)) {
		return unavailableRead()
	}
	if result.Page != nil && result.Page.Coverage == readCoverageComplete && !proof.scopeCovered() {
		result.Page.Coverage = readCoveragePartial
	}
	return result
}

func (a *relatedReadAdmission) collect(ctx context.Context, provider relatedReadProvider, catalog resourcev2.Catalog, request *extensionread.Request) (ExtensionReadResult, *relatedEvidence) {
	if !a.current(ctx) {
		return unavailableRead(), nil
	}
	families, err := provider.RelatedSourcesV1(ctx, *request)
	if err != nil {
		return readError(ctx, err), nil
	}
	if len(families) == 0 || len(families) > maxRelatedSources {
		return failedRead(), nil
	}
	ctrl := a.service.ctrl
	authorities, err := ctrl.resolveCatalogAuthorities(ctx, a.owner, request.Route, catalog, captureCatalogAdmission(ctx, a.generation))
	if err != nil {
		return unavailableRead(), nil
	}
	proof := newRelatedEvidence(ctx, ctrl, a.owner, request.Root, request.Route, a.generation, catalog, provider)
	permitted := proof.admitFamilies(request, families, authorities)
	if permitted == nil {
		return failedRead(), proof
	}
	return a.readPage(ctx, provider, request, permitted, proof), proof
}

func (e *relatedEvidence) admitFamilies(request *extensionread.Request, families []string, authorities map[string]AuthorityResolution) map[string]bool {
	permitted := make(map[string]bool, len(families))
	for _, typ := range families {
		if _, duplicate := permitted[typ]; duplicate || typ == "" {
			return nil
		}
		target, allowed := e.source(typ, authorities[typ].Authority)
		permitted[typ] = allowed
		if allowed {
			if request.Sources == nil {
				request.Sources = make([]resourcev2.ReadTarget, 0, len(families))
			}
			request.Sources = append(request.Sources, target)
		}
	}
	return permitted
}

func (a *relatedReadAdmission) readPage(ctx context.Context, read extensionread.Provider, request *extensionread.Request, permitted map[string]bool, proof *relatedEvidence) ExtensionReadResult {
	if len(request.Sources) == 0 || !a.current(ctx) || a.guard(ctx) != nil {
		return unavailableRead()
	}
	// Coverage is a question about all potential objects, not about whether
	// this response happens to contain any refused neighbor.
	scopeCovered := len(request.Sources) == len(permitted) && proof.scopeCovered()
	page, err := read.ReadRelatedV1(ctx, *request)
	if !a.current(ctx) {
		return unavailableRead()
	}
	if err != nil {
		return readError(ctx, err)
	}
	for _, typ := range page.Sources {
		if !permitted[typ] {
			return failedRead()
		}
	}
	for _, target := range request.Sources {
		if !proof.admitSource(target) {
			permitted[target.Type] = false
			delete(proof.families, target.Type)
			scopeCovered = false
		}
	}
	return projectRelatedPage(page, a.contract.Row, permitted, func() bool { return scopeCovered && !proof.limited }, proof.admit)
}

func readError(ctx context.Context, err error) ExtensionReadResult {
	if errors.Is(err, extensionread.ErrUnavailable) || errors.Is(ctx.Err(), context.Canceled) {
		return unavailableRead()
	}
	return failedRead()
}
