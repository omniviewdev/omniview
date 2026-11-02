package resource

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	defaultSourceMaxFrameBytes = resourcev2.MaxSourceFrameBytes
	defaultSourceMaxBatchItems = 256
	maxSourceSessionMembers    = 65536
	maxSourceSessionBytes      = 512 << 20
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
	ctrl     *controller
	mu       sync.Mutex
	sessions map[string]*sourceSession
	views    map[string]*sourceView
	now      func() time.Time
	after    func(time.Duration) <-chan time.Time
	stateMu  sync.Mutex
	states   map[sourceStateKey]*sourceAggregate
}

func newSourceCoordinator(c *controller) *sourceCoordinator {
	return &sourceCoordinator{ctrl: c, sessions: make(map[string]*sourceSession), views: make(map[string]*sourceView), now: time.Now, after: time.After}
}
func (sc *sourceCoordinator) emitSourceState(s *sourceSession) {
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
	b, _ := json.Marshal([]any{pluginID, owner, target, mode, resourcev2.SourceAcquisitionEnumerate})
	return string(b)
}

func (sc *sourceCoordinator) prepare(ctx context.Context, pluginID string, target resourcev2.ReadTarget, updates string) (resourcev2.SourceStreamOpener, *pluginState, context.Context, context.CancelFunc, string, string, error) {
	c := sc.ctrl
	if updates != "none" && updates != "ifSupported" {
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
	if !ok || !features.Has(resourcev2.FeatureSourceSessions) {
		return fail(resourcev2.NewError("UNSUPPORTED", "Plugin does not support source sessions."))
	}
	admission, catalog, err := c.routeCatalog(ctx, pluginID, target.Route)
	if err != nil {
		return fail(err)
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
	if updates == "ifSupported" {
		if _, err = resourcev2.AdmitCatalogOperation(catalog, target); err == nil {
			mode = resourcev2.SourceModeSnapshotAndUpdates
		}
	}
	if mode == resourcev2.SourceModeSnapshot {
		if _, err = resourcev2.AdmitCatalogOperation(catalog, resourcev2.EnumerateRequest{Target: target}); err != nil {
			return fail(err)
		}
	}
	if err = c.currentGeneration(opctx, pluginID, generation); err != nil {
		return fail(err)
	}
	opctx = context.WithValue(opctx, observationKey{}, nil)
	req, _ := invocation.FromContext(ctx)
	return opener, generation, opctx, cleanup, mode, req.Principal().Owner(), nil
}

func (sc *sourceCoordinator) acquire(ctx context.Context, pluginID string, target resourcev2.ReadTarget, updates string, inventory bool) (*sourceSession, string, error) {
	opener, generation, opctx, cancel, mode, owner, err := sc.prepare(ctx, pluginID, target, updates)
	if err != nil {
		return nil, "", err
	}
	if err = ctx.Err(); err != nil {
		cancel()
		return nil, "", err
	}
	key := sourceKey(pluginID, owner, target, mode)
	sc.mu.Lock()
	defer sc.mu.Unlock()
	if err := sc.ctrl.currentGeneration(opctx, pluginID, generation); err != nil {
		cancel()
		return nil, "", err
	}
	if inventory && mode != resourcev2.SourceModeSnapshotAndUpdates {
		cancel()
		return nil, "", resourcev2.NewError("UNSUPPORTED", "Source updates are not supported for this scope.")
	}
	if existing := sc.sessions[key]; existing != nil {
		existing.mu.Lock()
		if sc.ctrl.currentGeneration(existing.ctx, pluginID, existing.pluginGeneration) != nil {
			existing.mu.Unlock()
			cancel()
			return nil, "", resourcev2.NewError("RESET_REQUIRED", "Source binding is being renewed.")
		}
		cancel()
		if inventory {
			existing.inventory = true
		} else {
			existing.reservations++
		}
		existing.mu.Unlock()
		return existing, owner, nil
	}
	s := &sourceSession{coordinator: sc, key: key, pluginID: pluginID, owner: owner, target: target, mode: mode, opener: opener, pluginGeneration: generation, ctx: opctx, cancel: cancel, inventory: inventory, members: make(map[string]sourceMember), views: make(map[string]*sourceView)}
	if !inventory {
		s.reservations = 1
	}
	s.status = HostSourceStatus{State: "opening", Mode: mode}
	s.updateCount()
	sc.sessions[key] = s
	go s.run()
	return s, owner, nil
}
func (sc *sourceCoordinator) openInventory(ctx context.Context, pluginID string, target resourcev2.ReadTarget) error {
	_, _, err := sc.acquire(ctx, pluginID, target, "ifSupported", true)
	return err
}
func (sc *sourceCoordinator) closeInventory(pluginID, connectionID string) {
	sc.mu.Lock()
	var closing []*sourceSession
	for key, s := range sc.sessions {
		if s.pluginID == pluginID && s.target.Route.Connection == connectionID {
			s.mu.Lock()
			s.inventory = false
			empty := len(s.views) == 0 && s.reservations == 0
			s.mu.Unlock()
			if empty {
				delete(sc.sessions, key)
				closing = append(closing, s)
			}
		}
	}
	sc.mu.Unlock()
	sc.closeSessions(closing)
}
func (sc *sourceCoordinator) invalidate(pluginID, connectionID string) {
	sc.mu.Lock()
	var closing []*sourceSession
	for key, s := range sc.sessions {
		if s.pluginID == pluginID && (connectionID == "" || s.target.Route.Connection == connectionID) && sc.ctrl.currentGeneration(s.ctx, pluginID, s.pluginGeneration) != nil {
			delete(sc.sessions, key)
			s.mu.Lock()
			for id := range s.views {
				delete(sc.views, id)
			}
			s.mu.Unlock()
			closing = append(closing, s)
		}
	}
	sc.mu.Unlock()
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
	sc.mu.Lock()
	s.mu.Lock()
	delete(sc.views, v.id)
	delete(s.views, v.id)
	empty := !s.inventory && len(s.views) == 0 && s.reservations == 0
	if empty && sc.sessions[s.key] == s {
		delete(sc.sessions, s.key)
	}
	s.mu.Unlock()
	sc.mu.Unlock()
	v.close()
	if empty {
		s.close()
	}
}

func (c *controller) OpenSourceView(ctx context.Context, pluginID string, request HostSourceViewRequest) (_ HostSourceViewOpened, retErr error) {
	ctx, err := c.admit(ctx, "resource.OpenSourceView", readTarget(pluginID, request.Target))
	if err != nil {
		return HostSourceViewOpened{}, err
	}
	defer finishResource(ctx, &retErr)
	if err = validateTargetLabel(request.TargetID); err != nil {
		return HostSourceViewOpened{}, err
	}
	s, owner, err := c.sources.acquire(ctx, pluginID, request.Target, request.Updates, false)
	if err != nil {
		return HostSourceViewOpened{}, err
	}
	sc := c.sources
	sc.mu.Lock()
	s.mu.Lock()
	s.reservations--
	if err := ctx.Err(); err != nil || len(sc.views) >= maxSourceViews || s.closed {
		empty := !s.inventory && len(s.views) == 0 && s.reservations == 0
		if empty && sc.sessions[s.key] == s {
			delete(sc.sessions, s.key)
		}
		s.mu.Unlock()
		sc.mu.Unlock()
		if empty {
			s.close()
		}
		if err != nil {
			return HostSourceViewOpened{}, err
		}
		return HostSourceViewOpened{}, resourcev2.NewError("RESOURCE_LIMIT", "Source view limit reached or source retired.")
	}
	id := uuid.NewString()
	v := newSourceView(s, id, owner, request.TargetID)
	sc.views[id] = v
	mode := s.mode
	s.views[id] = v
	s.mu.Unlock()
	sc.mu.Unlock()
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
func (c *controller) SyncSourceView(ctx context.Context, pluginID, id string) error {
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
func (c *controller) RefreshSourceView(ctx context.Context, pluginID, id string) error {
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
func (c *controller) CloseSourceView(ctx context.Context, pluginID, id string) error {
	v, err := c.sourceView(ctx, pluginID, id, "resource.CloseSourceView")
	if err != nil {
		return err
	}
	if v != nil {
		c.sources.release(v.session, v)
	}
	return nil
}
func (c *controller) GetSourceStates(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (HostSourceStates, error) {
	out := HostSourceStates{Route: route, Types: map[string]HostSourceStatus{}}
	ctx, err := c.admit(ctx, "resource.GetSourceStates", invocation.Target{Provider: pluginID, Connection: route.Connection})
	if err != nil {
		return out, err
	}
	// State events use the same ordering when selecting a session per type.
	preferred := make(map[string]*sourceSession)
	c.sources.stateMu.Lock()
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
func (c *controller) RetryConnectionSources(ctx context.Context, pluginID string, route resourcev2.AccessRoute) error {
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
