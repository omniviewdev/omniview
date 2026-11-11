package resource

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	defaultSourceMaxFrameBytes = resourcev2.MaxSourceFrameBytes
	// Full managedFields measurements: the 16 largest observed Pods plus
	// encoder scratch used ~195 MB of the 256 MiB transient pool; 32 used
	// ~260 MB. This is headroom, not a guarantee for arbitrary observations.
	defaultSourceMaxBatchItems = 16
	maxSourceSessionMembers    = 65536
	defaultSourceStagingBytes  = 128 << 20
	maxSourceSessionBytes      = 256 << 20
	maxSourceViews             = 4096
	sourceViewQueueItems       = 256
	sourceViewQueueBytes       = 32 << 20
	sourceViewChunkRecords     = 256
	sourceReopenWindow         = 60 * time.Second
	sourceCloseJoinTimeout     = 5 * time.Second
)

var sourceReopenBackoff = []time.Duration{time.Second, 5 * time.Second, 15 * time.Second}

type HostSourceViewRequest struct {
	TargetID string                `json:"targetId"`
	Target   resourcev2.ReadTarget `json:"target"`
	Updates  string                `json:"updates"`
}
type HostSourceViewOpened struct {
	ViewID string `json:"viewId"`
	Topic  string `json:"topic"`
	Mode   string `json:"mode"`
}
type HostSourceStatus struct {
	State      string                             `json:"state"`
	Mode       string                             `json:"mode"`
	Continuity string                             `json:"continuity,omitempty"`
	Coverage   *resourcev2.SourceCoverage         `json:"coverage,omitempty"`
	Count      resourcev2.Count                   `json:"count"`
	Error      *resourcev2.ResourceOperationError `json:"error,omitempty"`
}
type HostRecordRemoval struct {
	Key        string `json:"key"`
	AddressKey string `json:"addressKey"`
}
type HostSourceViewReset struct {
	Reason  string `json:"reason"`
	Message string `json:"message"`
}
type HostSourceViewEvent struct {
	ViewID         string               `json:"viewId"`
	ViewGeneration string               `json:"viewGeneration"`
	Sequence       string               `json:"sequence"`
	Kind           string               `json:"kind"`
	Records        []HostRecord         `json:"records,omitempty"`
	Upserts        []HostRecord         `json:"upserts,omitempty"`
	Removes        []HostRecordRemoval  `json:"removes,omitempty"`
	Status         *HostSourceStatus    `json:"status,omitempty"`
	Reset          *HostSourceViewReset `json:"reset,omitempty"`
}
type HostSourceStates struct {
	Route resourcev2.AccessRoute      `json:"route"`
	Types map[string]HostSourceStatus `json:"types"`
}
type HostSourceStateEvent struct {
	PluginID string                 `json:"pluginID"`
	Route    resourcev2.AccessRoute `json:"route"`
	Type     string                 `json:"type"`
	Status   HostSourceStatus       `json:"status"`
}
type sourceStateKey struct {
	pluginID string
	route    resourcev2.AccessRoute
	kind     string
}

type sourceAggregate struct {
	sessions map[*sourceSession]HostSourceStatus
	selected *sourceSession
	status   HostSourceStatus
}

func sourceStateRank(state string) int {
	switch state {
	case "following":
		return 6
	case "finished":
		return 5
	case "snapshotting":
		return 4
	case "opening":
		return 3
	case "resetRequired":
		return 2
	case "failed":
		return 1
	default:
		return 0
	}
}

type sourceCoordinator struct {
	ctrl                *controller
	mu                  sync.Mutex
	sessions            map[string]*sourceSession
	views               map[string]*sourceView
	interests           map[string]*sourceInterest
	viewInterests       map[string]*sourceInterest
	connectionInterests map[string]*sourceInterest
	changeMu            sync.Mutex
	changes             map[*sourceSession]*sourceChange
	now                 func() time.Time
	// Retired host-issued owners cannot regain interests through an in-flight open.
	retiredOwners  map[string]struct{}
	after          func(time.Duration) <-chan time.Time
	stateMu        sync.Mutex
	states         map[sourceStateKey]*sourceAggregate
	policyFailures map[sourceStateKey]HostSourceStatus
}

func newSourceCoordinator(c *controller) *sourceCoordinator {
	return &sourceCoordinator{ctrl: c, sessions: make(map[string]*sourceSession), views: make(map[string]*sourceView), interests: make(map[string]*sourceInterest), viewInterests: make(map[string]*sourceInterest), connectionInterests: make(map[string]*sourceInterest), changes: make(map[*sourceSession]*sourceChange), now: time.Now, after: time.After}
}
func (sc *sourceCoordinator) emitSourceState(s *sourceSession) {
	sc.sourceChangedLocked(s)
	key := sourceStateKey{pluginID: s.pluginID, route: s.target.Route, kind: s.target.Type}
	sc.stateMu.Lock()
	defer sc.stateMu.Unlock()
	if sc.states == nil {
		sc.states = make(map[sourceStateKey]*sourceAggregate)
	}
	aggregate := sc.states[key]
	if aggregate == nil {
		aggregate = &sourceAggregate{sessions: make(map[*sourceSession]HostSourceStatus)}
		sc.states[key] = aggregate
	}
	delete(sc.policyFailures, key)
	previous, hadPrevious := aggregate.status, aggregate.selected != nil
	if s.status.State == "closed" {
		delete(aggregate.sessions, s)
	} else {
		aggregate.sessions[s] = s.status
	}
	selected := aggregate.selected
	status, ok := aggregate.sessions[selected]
	if !ok {
		selected = nil
	}
	for candidate, candidateStatus := range aggregate.sessions {
		if selected == nil || sourceStateRank(candidateStatus.State) > sourceStateRank(status.State) {
			selected, status = candidate, candidateStatus
		}
	}
	aggregate.selected = selected
	if selected == nil {
		status = s.status
		delete(sc.states, key)
	}
	aggregate.status = status
	if hadPrevious && reflect.DeepEqual(previous, status) {
		return
	}
	event := HostSourceStateEvent{PluginID: key.pluginID, Route: key.route, Type: key.kind, Status: status}
	if emitter := sc.ctrl.emitter; emitter != nil {
		emitter.Emit(key.pluginID+"/"+key.route.Connection+"/source/STATE", event)
		emitter.Emit(EventSourceState, event)
	}
}

func sourceKey(pluginID, owner string, target resourcev2.ReadTarget, mode string) string {
	scope := append(resourcev2.QueryScope(nil), target.Scope...)
	for i := range scope {
		if scope[i].Values != nil {
			values := append([]string(nil), (*scope[i].Values)...)
			sort.Strings(values)
			scope[i].Values = &values
		}
	}
	sort.Slice(scope, func(i, j int) bool { return scope[i].Dimension < scope[j].Dimension })
	target.Scope = scope
	b, err := json.Marshal([]any{pluginID, owner, target, mode, resourcev2.SourceAcquisitionEnumerate})
	if err != nil {
		logging.Default().Debugw(
			context.Background(),
			"source key encoding failed",
			"pluginID",
			pluginID,
			"errorClass",
			telemetryutil.ErrorClass(err),
		)
	}
	return string(b)
}

type sourceBindingKey struct{}

type sourceRecoveryFailureKey struct{}

type sourceRecoveryFailure struct {
	epoch   uint64
	message string
}

func sourceRecoveryError(ctx context.Context, epoch uint64) error {
	if failure, ok := ctx.Value(sourceRecoveryFailureKey{}).(sourceRecoveryFailure); ok && failure.epoch == epoch {
		return resourcev2.NewError("RESET_REQUIRED", failure.message)
	}
	return resourcev2.NewError("RESET_REQUIRED", "Source binding is being renewed.")
}

type sourceBinding struct {
	Representation  resourcev2.Representation
	Descriptor      resourcev2.ResourceType
	CatalogRevision string
	Epoch           sourceEpochSnapshot
}

func boundSourceKey(pluginID, owner string, target resourcev2.ReadTarget, mode string, binding sourceBinding) string {
	// Native identity and the selected body format form a stable lookup key.
	// SDK comparison below admits the exact operation/scope contract; unrelated
	// capabilities, defaults, presentation and catalog revisions are not keys.
	b, err := json.Marshal([]any{sourceKey(pluginID, owner, target, mode), binding.Representation, binding.Epoch})
	if err != nil {
		logging.Default().Debugw(
			context.Background(),
			"source binding key encoding failed",
			"pluginID",
			pluginID,
			"errorClass",
			telemetryutil.ErrorClass(err),
		)
	}
	return string(b)
}

// Recovery resolves provider, authority, and update mode again for the same route and type.
func recoveringSourceKey(pluginID, owner string, target resourcev2.ReadTarget) string {
	target.Provider = ""
	target.Authority = ""
	return sourceKey(pluginID, owner, target, "")
}

func (sc *sourceCoordinator) prepare(ctx context.Context, pluginID string, target resourcev2.ReadTarget, updates string) (resourcev2.SourceStreamOpener, *pluginState, context.Context, context.CancelFunc, string, string, error) {
	c := sc.ctrl
	if updates != "none" && updates != "ifSupported" && updates != "required" {
		return nil, nil, nil, nil, "", "", resourcev2.NewError("INVALID_REQUEST", "Invalid updates mode.")
	}
	if err := resourcev2.ValidateEnumerateRequest(resourcev2.EnumerateRequest{Target: target}); err != nil {
		return nil, nil, nil, nil, "", "", err
	}
	provider, generation, opctx, cleanup, err := c.operationGeneration(context.WithoutCancel(ctx), pluginID, target.Route)
	if err != nil {
		return nil, nil, nil, nil, "", "", err
	}
	fail := func(err error) (resourcev2.SourceStreamOpener, *pluginState, context.Context, context.CancelFunc, string, string, error) {
		cleanup()
		return nil, nil, nil, nil, "", "", err
	}
	features, err := c.providerFeatures(ctx, pluginID, provider)
	if err != nil {
		return fail(err)
	}
	opener, ok := provider.(resourcev2.SourceStreamOpener)
	nativeSource := features.Has(resourcev2.FeatureSourceSessions)
	if nativeSource && !ok {
		return fail(resourcev2.NewError("PROVIDER_ERROR", "Plugin advertised source sessions without a source transport."))
	}
	admission, catalog, err := c.routeCatalog(ctx, pluginID, target.Route)
	if err != nil {
		return fail(err)
	}
	if captured := captureCatalogAdmission(opctx, generation); captured != admission {
		return fail(resourcev2.NewError("RESET_REQUIRED", "Source admission changed during catalog acquisition."))
	}
	authority, err := c.resolveAuthority(ctx, pluginID, target.Route, catalog, admission, target.Type)
	if err != nil {
		return fail(err)
	}
	if catalog.Provider != target.Provider {
		return fail(resourcev2.NewError("INVALID_REQUEST", "Target provider is not bound to this route."))
	}
	if authority.Authority != target.Authority {
		return fail(resourcev2.NewError("RESET_REQUIRED", "Target authority is not current for this route."))
	}
	mode := resourcev2.SourceModeSnapshot
	var descriptor resourcev2.ResourceType
	if updates != "none" && nativeSource {
		if descriptor, err = resourcev2.AdmitCatalogOperation(catalog, target); err == nil {
			mode = resourcev2.SourceModeSnapshotAndUpdates
		}
	}
	if updates == "required" && mode != resourcev2.SourceModeSnapshotAndUpdates {
		return fail(resourcev2.NewError("UNSUPPORTED", "Source updates are no longer supported for the selected scope."))
	}
	if mode == resourcev2.SourceModeSnapshot {
		if descriptor, err = resourcev2.AdmitCatalogOperation(catalog, resourcev2.EnumerateRequest{Target: target}); err != nil {
			return fail(err)
		}
	}
	var representation resourcev2.Representation
	for _, candidate := range descriptor.Representations {
		if candidate.ID == target.Representation {
			representation = candidate
			break
		}
	}
	if representation.ID == "" {
		return fail(resourcev2.NewError("RESET_REQUIRED", "Source representation is no longer available."))
	}
	if !nativeSource {
		opener = newLegacySourceOpener(provider, descriptor)
	}
	binding := sourceBinding{Representation: representation, Descriptor: descriptor, CatalogRevision: catalog.Revision, Epoch: admission.epoch}
	if err = c.currentGeneration(opctx, pluginID, generation); err != nil {
		return fail(err)
	}
	opctx = context.WithValue(opctx, observationKey{}, nil)
	opctx = context.WithValue(opctx, sourceBindingKey{}, binding)
	req, _ := invocation.FromContext(ctx)
	return opener, generation, opctx, cleanup, mode, req.Principal().Owner(), nil
}

func (sc *sourceCoordinator) acquire(ctx context.Context, pluginID string, target resourcev2.ReadTarget, updates string) (_ *sourceInterest, retErr error) {
	request, ok := invocation.FromContext(ctx)
	if !ok || !request.OwnedBy(ctx) {
		return nil, resourcev2.NewError("FORBIDDEN", "Source interests require an admitted original principal.")
	}
	target.Scope = append(resourcev2.QueryScope(nil), target.Scope...)
	for i := range target.Scope {
		if values := target.Scope[i].Values; values != nil {
			copy := append([]string(nil), (*values)...)
			target.Scope[i].Values = &copy
		}
	}
	interest := &sourceInterest{id: uuid.NewString(), owner: request.Principal().Owner(), ctx: ctx, operation: request.Operation(), target: target}
	sc.mu.Lock()
	if sc.interests == nil {
		sc.interests = make(map[string]*sourceInterest)
	}
	_, retired := sc.retiredOwners[interest.owner]
	if retired {
		sc.mu.Unlock()
		return nil, resourcev2.NewError("NOT_FOUND", "Source owner retired.")
	}
	if len(sc.interests) >= maxSourceViews {
		sc.mu.Unlock()
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Source interest limit reached.")
	}
	sc.interests[interest.id] = interest
	sc.mu.Unlock()
	defer func() {
		if retErr != nil {
			sc.releaseInterest(interest)
		}
	}()
	opener, generation, opctx, cancel, mode, owner, err := sc.prepare(ctx, pluginID, target, updates)
	if err != nil {
		return nil, err
	}
	key := boundSourceKey(pluginID, owner, target, mode, opctx.Value(sourceBindingKey{}).(sourceBinding))
retry:
	sc.mu.Lock()
	_, retired = sc.retiredOwners[owner]
	if err := ctx.Err(); err != nil || retired || interest.closed {
		sc.mu.Unlock()
		cancel()
		if err != nil {
			return nil, err
		}
		return nil, resourcev2.NewError("NOT_FOUND", "Source owner retired.")
	}
	if err := sc.ctrl.currentGeneration(opctx, pluginID, generation); err != nil {
		sc.mu.Unlock()
		cancel()
		return nil, err
	}
	if existing := sc.sessions[key]; existing != nil {
		sc.mu.Unlock()
		existing.mu.Lock()
		sc.mu.Lock()
		if sc.sessions[key] != existing {
			sc.mu.Unlock()
			existing.mu.Unlock()
			goto retry
		}
		if sc.ctrl.currentGeneration(existing.ctx, pluginID, existing.pluginGeneration) != nil {
			err := sourceRecoveryError(existing.ctx, opctx.Value(sourceBindingKey{}).(sourceBinding).Epoch.Epoch)
			sc.mu.Unlock()
			existing.mu.Unlock()
			cancel()
			return nil, err
		}
		previous := existing.ctx.Value(sourceBindingKey{}).(sourceBinding)
		current := opctx.Value(sourceBindingKey{}).(sourceBinding)
		request := resourcev2.SourceOpenRequest{Target: target, Mode: mode, Acquisition: resourcev2.SourceAcquisition{Kind: resourcev2.SourceAcquisitionEnumerate}, Binding: resourcev2.RepresentationBinding{Representation: current.Representation}}
		if !resourcev2.SourceOperationalContractEqual(previous.Descriptor, current.Descriptor, request) {
			sc.mu.Unlock()
			existing.mu.Unlock()
			cancel()
			return nil, resourcev2.NewError("RESET_REQUIRED", "Selected source operational contract changed.")
		}
		if interest.closed || ctx.Err() != nil {
			sc.mu.Unlock()
			existing.mu.Unlock()
			cancel()
			return nil, resourcev2.NewError("CANCELLED", "Source interest cancelled.")
		}
		interest.session = existing
		sc.mu.Unlock()
		existing.mu.Unlock()
		cancel()
		return interest, nil
	}
	// A retired session still owns its logical source until recovery rekeys it.
	// Its provider and authority can change during that recovery.
	binding := opctx.Value(sourceBindingKey{}).(sourceBinding)
	logicalKey := recoveringSourceKey(pluginID, owner, target)
	for _, existing := range sc.sessions {
		oldBinding, ok := existing.ctx.Value(sourceBindingKey{}).(sourceBinding)
		if ok && existing.pluginGeneration == generation && oldBinding.Epoch.Epoch < binding.Epoch.Epoch &&
			recoveringSourceKey(existing.pluginID, existing.owner, existing.target) == logicalKey {
			err := sourceRecoveryError(existing.ctx, binding.Epoch.Epoch)
			sc.mu.Unlock()
			cancel()
			return nil, err
		}
	}
	s := &sourceSession{coordinator: sc, key: key, pluginID: pluginID, owner: owner, target: target, mode: mode, opener: opener, pluginGeneration: generation, ctx: opctx, cancel: cancel, members: make(map[string]sourceMember), views: make(map[string]*sourceView)}
	interest.session = s
	s.status = HostSourceStatus{State: "opening", Mode: mode}
	s.updateCount()
	sc.sessions[key] = s
	sc.mu.Unlock()
	go s.run()
	return interest, nil
}

type sourceInterest struct {
	id, owner, operation string
	ctx                  context.Context
	target               resourcev2.ReadTarget
	session              *sourceSession
	closed               bool
	projection           bool
}

// Caller holds sc.mu. A pending open is an interest before provider I/O.
func (sc *sourceCoordinator) hasInterestsLocked(s *sourceSession) bool {
	for _, interest := range sc.interests {
		if !interest.closed && interest.session == s {
			return true
		}
	}
	return false
}

func (sc *sourceCoordinator) releaseInterest(interest *sourceInterest) {
	if interest == nil {
		return
	}
	sc.releaseInterests([]*sourceInterest{interest})
}

func (sc *sourceCoordinator) releaseInterests(interests []*sourceInterest) {
	if len(interests) == 0 {
		return
	}
	sc.closeSessions(sc.detachInterests(interests))
}

// Detach the last owner and its lookup entry under one coordinator fence.
// Teardown never keeps a failed, unowned session available to an explicit open.
func (sc *sourceCoordinator) detachInterests(interests []*sourceInterest) []*sourceSession {
	if len(interests) == 0 {
		return nil
	}
	sc.mu.Lock()
	candidates := make(map[*sourceSession]struct{}, len(interests))
	var projections []*sourceSession
	for _, interest := range interests {
		if interest == nil || interest.closed {
			continue
		}
		interest.closed = true
		delete(sc.interests, interest.id)
		if s := interest.session; s != nil {
			candidates[s] = struct{}{}
			if interest.projection {
				projections = append(projections, s)
			}
		}
	}
	for key, interest := range sc.connectionInterests {
		if interest.closed {
			delete(sc.connectionInterests, key)
		}
	}
	for _, interest := range sc.interests {
		delete(candidates, interest.session)
	}
	var closing []*sourceSession
	for s := range candidates {
		if sc.sessions[s.key] == s {
			delete(sc.sessions, s.key)
			closing = append(closing, s)
		}
	}
	sc.mu.Unlock()
	for _, s := range projections {
		sc.releaseGraphInterest(s)
	}
	return closing
}

func (sc *sourceCoordinator) closeConnectionInterests(pluginID, connectionID string) {
	sc.mu.Lock()
	var closing []*sourceInterest
	for key, interest := range sc.connectionInterests {
		if s := interest.session; s != nil && s.pluginID == pluginID && s.target.Route.Connection == connectionID {
			delete(sc.connectionInterests, key)
			closing = append(closing, interest)
		}
	}
	sc.mu.Unlock()
	sc.releaseInterests(closing)
}
func (sc *sourceCoordinator) invalidate(pluginID, connectionID string) {
	sc.mu.Lock()
	var candidates []*sourceSession
	for _, s := range sc.sessions {
		if s.pluginID == pluginID && (connectionID == "" || s.target.Route.Connection == connectionID) {
			candidates = append(candidates, s)
		}
	}
	sc.mu.Unlock()
	var closing []*sourceSession
	for _, s := range candidates {
		s.mu.Lock()
		sc.mu.Lock()
		if sc.sessions[s.key] == s && s.pluginID == pluginID && (connectionID == "" || s.target.Route.Connection == connectionID) && sc.ctrl.currentGeneration(s.ctx, pluginID, s.pluginGeneration) != nil {
			delete(sc.sessions, s.key)
			for id, interest := range sc.interests {
				if interest.session == s {
					interest.closed = true
					delete(sc.interests, id)
				}
			}
			for key, interest := range sc.connectionInterests {
				if interest.session == s {
					delete(sc.connectionInterests, key)
				}
			}
			for id := range s.views {
				delete(sc.views, id)
				delete(sc.viewInterests, id)
			}
			closing = append(closing, s)
		}
		sc.mu.Unlock()
		s.mu.Unlock()
	}
	sc.closeSessions(closing)
}
func (sc *sourceCoordinator) closeSessions(sessions []*sourceSession) {
	if len(sessions) == 0 {
		return
	}
	stopWaiting := make(chan struct{})
	defer close(stopWaiting)
	var wg sync.WaitGroup
	wg.Add(len(sessions))
	for _, s := range sessions {
		go func() {
			defer wg.Done()
			if done := s.closeWithoutJoin(); done != nil {
				select {
				case <-done:
				case <-stopWaiting:
				}
			}
		}()
	}
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-sc.after(sourceCloseJoinTimeout):
	}
}

func (sc *sourceCoordinator) release(s *sourceSession, v *sourceView) {
	s.mu.Lock()
	sc.mu.Lock()
	delete(sc.views, v.id)
	delete(s.views, v.id)
	interest := sc.viewInterests[v.id]
	delete(sc.viewInterests, v.id)
	sc.mu.Unlock()
	s.mu.Unlock()
	v.close()
	sc.releaseInterest(interest)
}

// RetireSourceOwner is native-only. The caller supplies the host-issued window
// owner, never a browser-provided view or owner identifier.
func (c *controller) RetireSourceOwner(owner string) {
	if owner == "" {
		return
	}
	sc := c.sources
	sc.mu.Lock()
	if sc.retiredOwners == nil {
		sc.retiredOwners = make(map[string]struct{})
	}
	sc.retiredOwners[owner] = struct{}{}
	for _, interest := range sc.interests {
		if interest.owner == owner {
			interest.closed = true
			delete(sc.interests, interest.id)
		}
	}
	for key, interest := range sc.connectionInterests {
		if interest.owner == owner {
			delete(sc.connectionInterests, key)
		}
	}
	var closing []*sourceSession
	for key, s := range sc.sessions {
		if s.owner == owner {
			delete(sc.sessions, key)
			closing = append(closing, s)
		}
	}
	for id, v := range sc.views {
		if v.owner == owner {
			delete(sc.views, id)
			delete(sc.viewInterests, id)
		}
	}
	sc.mu.Unlock()
	// Never acquire a session lock or join a stream while holding sc.mu.
	sc.closeSessions(closing)
}

func (c *controller) OpenSourceView(ctx context.Context, pluginID string, request HostSourceViewRequest) (_ HostSourceViewOpened, retErr error) {
	ctx, end := h3StartOperation(
		ctx,
		"resource.OpenSourceView",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", request.Target.Route.Connection),
		attribute.String("resource_type", request.Target.Type),
	)
	defer end(&retErr)
	ctx, err := c.admit(ctx, "resource.OpenSourceView", readTarget(pluginID, request.Target))
	if err != nil {
		return HostSourceViewOpened{}, err
	}
	defer finishResource(ctx, &retErr)
	if request.Updates != "none" && request.Updates != "ifSupported" {
		return HostSourceViewOpened{}, resourcev2.NewError("INVALID_REQUEST", "Invalid updates mode.")
	}
	if err = validateTargetLabel(request.TargetID); err != nil {
		return HostSourceViewOpened{}, err
	}
	interest, err := c.sources.acquire(ctx, pluginID, request.Target, request.Updates)
	if err != nil {
		return HostSourceViewOpened{}, err
	}
	s, owner := interest.session, interest.owner
	sc := c.sources
	s.mu.Lock()
	sc.mu.Lock()
	_, retired := sc.retiredOwners[owner]
	if err := ctx.Err(); err != nil || retired || interest.closed || len(sc.views) >= maxSourceViews || s.closed {
		sc.mu.Unlock()
		s.mu.Unlock()
		sc.releaseInterest(interest)
		if err != nil {
			return HostSourceViewOpened{}, err
		}
		return HostSourceViewOpened{}, resourcev2.NewError("RESOURCE_LIMIT", "Source view limit reached or source retired.")
	}
	id := uuid.NewString()
	v := newSourceView(s, id, owner, request.TargetID)
	sc.views[id] = v
	if sc.viewInterests == nil {
		sc.viewInterests = make(map[string]*sourceInterest)
	}
	sc.viewInterests[id] = interest
	mode := s.mode
	s.views[id] = v
	sc.mu.Unlock()
	s.mu.Unlock()
	go v.emitLoop()
	return HostSourceViewOpened{ViewID: id, Topic: "resource/source-view/" + id, Mode: mode}, nil
}
func (c *controller) sourceView(ctx context.Context, pluginID, id, operation string) (*sourceView, error) {
	c.sources.mu.Lock()
	v := c.sources.views[id]
	c.sources.mu.Unlock()
	if v == nil || v.session.pluginID != pluginID {
		return nil, nil
	}
	v.session.mu.Lock()
	target := v.session.target
	v.session.mu.Unlock()
	ctx, err := c.admit(ctx, operation, readTarget(pluginID, target))
	if err != nil {
		return nil, err
	}
	req, _ := invocation.FromContext(ctx)
	if req.Principal().Owner() != v.owner {
		return nil, nil
	}
	return v, nil
}

//nolint:nonamedreturns // Deferred span completion observes the returned error.
func (c *controller) SyncSourceView(ctx context.Context, pluginID, id string) (retErr error) {
	ctx, end := h3StartOperation(ctx, "resource.SyncSourceView", attribute.String("plugin_id", pluginID))
	defer end(&retErr)
	v, err := c.sourceView(ctx, pluginID, id, "resource.SyncSourceView")
	if err != nil {
		return err
	}
	if v == nil {
		return resourcev2.NewError("NOT_FOUND", "Source view not found.")
	}
	v.session.mu.Lock()
	defer v.session.mu.Unlock()
	v.syncLocked("resync")
	return ctx.Err()
}

//nolint:nonamedreturns // Deferred span completion observes the returned error.
func (c *controller) RefreshSourceView(ctx context.Context, pluginID, id string) (retErr error) {
	ctx, end := h3StartOperation(ctx, "resource.RefreshSourceView", attribute.String("plugin_id", pluginID))
	defer end(&retErr)
	v, err := c.sourceView(ctx, pluginID, id, "resource.RefreshSourceView")
	if err != nil {
		return err
	}
	if v == nil {
		return resourcev2.NewError("NOT_FOUND", "Source view not found.")
	}
	if c.sources.retryBinding(v.session) {
		return ctx.Err()
	}
	v.session.refresh()
	return ctx.Err()
}

//nolint:nonamedreturns // Deferred span completion observes the returned error.
func (c *controller) CloseSourceView(ctx context.Context, pluginID, id string) (retErr error) {
	ctx, end := h3StartOperation(ctx, "resource.CloseSourceView", attribute.String("plugin_id", pluginID))
	defer end(&retErr)
	v, err := c.sourceView(ctx, pluginID, id, "resource.CloseSourceView")
	if err != nil {
		return err
	}
	if v != nil {
		c.sources.release(v.session, v)
	}
	return nil
}
func (c *controller) GetSourceStates(
	ctx context.Context,
	pluginID string,
	route resourcev2.AccessRoute,
) (_ HostSourceStates, retErr error) { //nolint:nonamedreturns // Deferred span completion observes the returned error.
	ctx, end := h3StartOperation(
		ctx,
		"resource.GetSourceStates",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", route.Connection),
	)
	defer end(&retErr)
	out := HostSourceStates{Route: route, Types: map[string]HostSourceStatus{}}
	ctx, err := c.admit(ctx, "resource.GetSourceStates", invocation.Target{Provider: pluginID, Connection: route.Connection})
	if err != nil {
		return out, err
	}
	// State events use the same ordering when selecting a session per type.
	preferred := make(map[string]*sourceSession)
	c.sources.stateMu.Lock()
	for key, status := range c.sources.policyFailures {
		if key.pluginID == pluginID && key.route == route {
			out.Types[key.kind] = status
		}
	}
	for key, aggregate := range c.sources.states {
		if key.pluginID == pluginID && key.route == route {
			preferred[key.kind] = aggregate.selected
		}
	}
	c.sources.stateMu.Unlock()
	c.sources.mu.Lock()
	var sessions []*sourceSession
	for _, s := range c.sources.sessions {
		if s.pluginID == pluginID && s.target.Route == route {
			sessions = append(sessions, s)
		}
	}
	c.sources.mu.Unlock()
	for _, s := range sessions {
		s.mu.Lock()
		status := s.status
		resourceType := s.target.Type
		s.mu.Unlock()
		if old, ok := out.Types[resourceType]; !ok || sourceStateRank(status.State) > sourceStateRank(old.State) || (sourceStateRank(status.State) == sourceStateRank(old.State) && preferred[resourceType] == s) {
			out.Types[resourceType] = status
		}
	}
	return out, ctx.Err()
}
func (c *controller) RetryConnectionSources(
	ctx context.Context,
	pluginID string,
	route resourcev2.AccessRoute,
) (retErr error) { //nolint:nonamedreturns // Deferred span completion observes the returned error.
	ctx, end := h3StartOperation(
		ctx,
		"resource.RetryConnectionSources",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", route.Connection),
	)
	defer end(&retErr)
	ctx, err := c.admit(ctx, "resource.RetryConnectionSources", invocation.Target{Provider: pluginID, Connection: route.Connection})
	if err != nil {
		return err
	}
	c.sources.mu.Lock()
	var sessions []*sourceSession
	for _, s := range c.sources.sessions {
		if s.pluginID == pluginID && s.target.Route == route {
			sessions = append(sessions, s)
		}
	}
	c.sources.mu.Unlock()
	for _, s := range sessions {
		if !c.sources.retryBinding(s) {
			s.refresh()
		}
	}
	return ctx.Err()
}
