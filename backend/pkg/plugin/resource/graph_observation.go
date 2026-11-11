package resource

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const maxGraphObservationsPerOwner = 64
const maxGraphObservationTokens = 4096
const graphObservationProofBytes = 256

type HostGraphObservationRequest struct {
	ClientToken      string                       `json:"clientToken"`
	PluginID         string                       `json:"pluginID"`
	Reference        resourcev2.ResourceReference `json:"reference"`
	Route            resourcev2.AccessRoute       `json:"route"`
	Kind             string                       `json:"kind"`
	Direction        string                       `json:"direction,omitempty"`
	RelationshipType *string                      `json:"relationshipType,omitempty"`
	MaxDepth         int                          `json:"maxDepth,omitempty"`
	UpDepth          int                          `json:"upDepth,omitempty"`
	DownDepth        int                          `json:"downDepth,omitempty"`
}

type HostGraphObservationOpened struct {
	ObservationID string `json:"observationId"`
	Topic         string `json:"topic"`
}

type HostGraphObservationSnapshot struct {
	ObservationID string                             `json:"observationId"`
	Generation    string                             `json:"generation"`
	Sequence      string                             `json:"sequence"`
	State         string                             `json:"state"`
	Edges         []graph.GraphEdge                  `json:"edges,omitempty"`
	Chain         [][]graph.GraphEdge                `json:"chain,omitempty"`
	Tree          *graph.DependencyTree              `json:"tree,omitempty"`
	Subgraph      *graph.Subgraph                    `json:"subgraph,omitempty"`
	Error         *resourcev2.ResourceOperationError `json:"error,omitempty"`
}

func (r HostGraphObservationRequest) operation() (string, error) {
	if r.MaxDepth < 0 || r.MaxDepth > 5 || r.UpDepth < 0 || r.UpDepth > 5 || r.DownDepth < 0 || r.DownDepth > 5 {
		return "", resourcev2.NewError("INVALID_REQUEST", "Graph depth must be between zero and five.")
	}
	switch r.Kind {
	case "related":
		if r.Direction != "outgoing" && r.Direction != "incoming" && r.Direction != "both" {
			return "", resourcev2.NewError("INVALID_REQUEST", "Graph direction must be outgoing, incoming, or both.")
		}
		return "graph.GetRelated", nil
	case "chain":
		if r.RelationshipType == nil || *r.RelationshipType == "" {
			return "", resourcev2.NewError("INVALID_REQUEST", "Graph chain requires a relationship type.")
		}
		return "graph.GetRelationshipChain", nil
	case "tree":
		return "graph.GetDependencyTree", nil
	case "subgraph":
		return "graph.GetSubgraph", nil
	default:
		return "", resourcev2.NewError("INVALID_REQUEST", "Unknown graph observation kind.")
	}
}

func (r HostGraphObservationRequest) depths() (int, int) {
	switch r.Kind {
	case "related":
		if r.Direction == "both" {
			return 1, 1
		}
		if r.Direction == "incoming" {
			return 1, 0
		}
		return 0, 1
	case "chain", "tree":
		return 0, r.MaxDepth
	default:
		return r.UpDepth, r.DownDepth
	}
}

type graphObservationKey struct{ owner, token string }
type graphWindow struct {
	ctx    context.Context
	cancel context.CancelFunc
}

type graphObservation struct {
	service        *GraphService
	key            graphObservationKey
	request        HostGraphObservationRequest
	ctx            context.Context
	cancel         context.CancelFunc
	stopLife       func() bool
	emit           func(HostGraphObservationSnapshot)
	mu             sync.Mutex
	active         bool
	refresh        bool
	failed         bool
	wake           chan struct{}
	done           chan struct{}
	generation     string
	sequence       uint64
	metadataCharge int
}

func (s *GraphService) graphWindow(ctx context.Context) (context.Context, *graphWindow, application.Window, error) {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok || window == nil || s.realm == nil {
		return ctx, nil, nil, resourcev2.NewError("FORBIDDEN", "Graph observations require an authenticated frontend window.")
	}
	ctx = s.realm.Context(ctx)
	identity := invocation.IdentityOf(window)
	s.mu.Lock()
	if s.windows == nil {
		s.windows = make(map[invocation.WindowIdentity]*graphWindow)
	}
	session := s.windows[identity]
	if session == nil {
		if len(s.windows) >= 64 {
			s.mu.Unlock()
			return ctx, nil, nil, resourcev2.NewError("RESOURCE_LIMIT", "Graph frontend session limit reached.")
		}
		life, cancel := context.WithCancel(context.WithoutCancel(ctx))
		session = &graphWindow{ctx: life, cancel: cancel}
		s.windows[identity] = session
		window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
			cancel()
			s.mu.Lock()
			if s.windows[identity] == session {
				delete(s.windows, identity)
			}
			s.mu.Unlock()
		})
	}
	s.mu.Unlock()
	if err := session.ctx.Err(); err != nil {
		return ctx, nil, nil, err
	}
	return ctx, session, window, nil
}

// Open reserves only. Listener installation must precede Sync activation.
func (s *GraphService) OpenGraphObservation(ctx context.Context, request HostGraphObservationRequest) (HostGraphObservationOpened, error) {
	ctx, session, window, err := s.graphWindow(ctx)
	if err != nil {
		return HostGraphObservationOpened{}, err
	}
	return s.openObservation(ctx, session.ctx, request, func(snapshot HostGraphObservationSnapshot) {
		if session.ctx.Err() == nil {
			window.EmitEvent("resource/graph-observation/"+request.ClientToken, snapshot)
		}
	})
}

func (s *GraphService) openObservation(ctx, lifetime context.Context, request HostGraphObservationRequest, emit func(HostGraphObservationSnapshot)) (_ HostGraphObservationOpened, retErr error) {
	if _, err := uuid.Parse(request.ClientToken); err != nil {
		return HostGraphObservationOpened{}, resourcev2.NewError("INVALID_REQUEST", "Graph observation token must be a UUID.")
	}
	if s.ctrl == nil {
		return HostGraphObservationOpened{}, resourcev2.NewError("UNAVAILABLE", "Graph source coordinator is unavailable.")
	}
	operation, err := request.operation()
	if err != nil {
		return HostGraphObservationOpened{}, err
	}
	ctx, err = s.admit(ctx, operation, request.PluginID, request.Reference, request.Route)
	if err != nil {
		return HostGraphObservationOpened{}, err
	}
	defer finishResource(ctx, &retErr)
	ctx, err = s.boundary.Admit(ctx, "graph.OpenGraphObservation", referenceTarget(request.PluginID, request.Route, request.Reference))
	if err != nil {
		return HostGraphObservationOpened{}, err
	}
	authenticated, _ := invocation.FromContext(ctx)
	key := graphObservationKey{owner: authenticated.Principal().Owner(), token: request.ClientToken}
	s.mu.Lock()
	if _, closed := s.closed[key]; closed {
		s.mu.Unlock()
		return HostGraphObservationOpened{}, resourcev2.NewError("NOT_FOUND", "Graph observation already closed.")
	}
	if s.observations[key] != nil {
		s.mu.Unlock()
		return HostGraphObservationOpened{}, resourcev2.NewError("INVALID_REQUEST", "Graph observation token is already in use.")
	}
	owned := 0
	for existing := range s.observations {
		if existing.owner == key.owner {
			owned++
		}
	}
	if owned >= maxGraphObservationsPerOwner || len(s.observations)+len(s.closed) >= maxGraphObservationTokens {
		s.mu.Unlock()
		return HostGraphObservationOpened{}, resourcev2.NewError("RESOURCE_LIMIT", "Graph observation limit reached.")
	}
	charge := graphObservationMetadata(request)
	if !s.ctrl.graphMetadata.reserveLimit(charge, maxGraphAggregateMetadataBytes) {
		s.mu.Unlock()
		return HostGraphObservationOpened{}, resourcev2.NewError("RESOURCE_LIMIT", "Graph observation metadata is saturated.")
	}
	request.Reference.Address.Scope = append([]resourcev2.ScopeEntry(nil), request.Reference.Address.Scope...)
	if request.Reference.Incarnation != nil {
		token := *request.Reference.Incarnation
		request.Reference.Incarnation = &token
	}
	if request.RelationshipType != nil {
		typ := *request.RelationshipType
		request.RelationshipType = &typ
	}
	work, cancel := context.WithCancel(context.WithoutCancel(ctx))
	observation := &graphObservation{service: s, key: key, request: request, ctx: work, cancel: cancel, emit: emit, wake: make(chan struct{}, 1), done: make(chan struct{}), generation: uuid.NewString(), metadataCharge: charge}
	s.observations[key] = observation
	s.mu.Unlock()
	observation.mu.Lock()
	observation.stopLife = context.AfterFunc(lifetime, func() { s.retireObservation(observation) })
	observation.mu.Unlock()
	if err := ctx.Err(); err != nil {
		s.retireObservation(observation)
		return HostGraphObservationOpened{}, err
	}
	if err := lifetime.Err(); err != nil {
		s.retireObservation(observation)
		return HostGraphObservationOpened{}, err
	}
	return HostGraphObservationOpened{ObservationID: request.ClientToken, Topic: "resource/graph-observation/" + request.ClientToken}, nil
}

func (s *GraphService) observation(ctx context.Context, id, operation string) (context.Context, *graphObservation, error) {
	if s.realm != nil {
		ctx = s.realm.Context(ctx)
	}
	// Authenticate ownership first; policy authorizes the stored target below.
	var ownership *invocation.Boundary
	ctx, err := ownership.Admit(ctx, operation, invocation.Target{})
	if err != nil {
		return ctx, nil, err
	}
	request, _ := invocation.FromContext(ctx)
	s.mu.Lock()
	observation := s.observations[graphObservationKey{owner: request.Principal().Owner(), token: id}]
	s.mu.Unlock()
	if observation == nil {
		return ctx, nil, resourcev2.NewError("NOT_FOUND", "Graph observation not found.")
	}
	ctx, err = s.boundary.Admit(ctx, operation, referenceTarget(observation.request.PluginID, observation.request.Route, observation.request.Reference))
	return ctx, observation, err
}

func (s *GraphService) SyncGraphObservation(ctx context.Context, id string) error {
	return s.syncObservation(ctx, id)
}

func (s *GraphService) syncObservation(ctx context.Context, id string) error {
	operation := "graph.SyncGraphObservation"
	ctx, observation, err := s.observation(ctx, id, operation)
	if err != nil {
		return err
	}
	semantic, err := observation.request.operation()
	if err != nil {
		return err
	}
	if _, err := s.admit(ctx, semantic, observation.request.PluginID, observation.request.Reference, observation.request.Route); err != nil {
		return err
	}
	observation.mu.Lock()
	if observation.ctx.Err() != nil {
		observation.mu.Unlock()
		return resourcev2.NewError("NOT_FOUND", "Graph observation closed.")
	}
	observation.refresh = observation.refresh || observation.failed
	if !observation.active {
		observation.active = true
		go observation.run()
	} else {
		select {
		case observation.wake <- struct{}{}:
		default:
		}
	}
	observation.mu.Unlock()
	return nil
}

func (s *GraphService) CloseGraphObservation(ctx context.Context, id string) error {
	return s.closeObservation(ctx, id)
}

func (s *GraphService) closeObservation(ctx context.Context, id string) error {
	if _, err := uuid.Parse(id); err != nil {
		return resourcev2.NewError("INVALID_REQUEST", "Graph observation token must be a UUID.")
	}
	if s.realm != nil {
		ctx = s.realm.Context(ctx)
	}
	var ownership *invocation.Boundary
	ctx, err := ownership.Admit(ctx, "graph.CloseGraphObservation", invocation.Target{})
	if err != nil {
		return err
	}
	request, _ := invocation.FromContext(ctx)
	key := graphObservationKey{owner: request.Principal().Owner(), token: id}
	s.mu.Lock()
	observation := s.observations[key]
	if _, exists := s.closed[key]; !exists && len(s.observations)+len(s.closed) >= maxGraphObservationTokens && observation == nil {
		s.mu.Unlock()
		return resourcev2.NewError("RESOURCE_LIMIT", "Graph observation retirement limit reached.")
	}
	if _, exists := s.closed[key]; !exists && observation == nil {
		if s.ctrl == nil || !s.ctrl.graphMetadata.reserveLimit(graphObservationProofBytes, maxGraphAggregateMetadataBytes) {
			s.mu.Unlock()
			return resourcev2.NewError("RESOURCE_LIMIT", "Graph observation retirement metadata is saturated.")
		}
	}
	s.closed[key] = struct{}{}
	delete(s.observations, key)
	s.mu.Unlock()
	if observation != nil {
		if _, err := s.boundary.Admit(ctx, "graph.CloseGraphObservation", referenceTarget(observation.request.PluginID, observation.request.Route, observation.request.Reference)); err != nil {
			// Releasing owned work is fail-closed even if access was revoked.
			s.retireObservation(observation)
			return err
		}
		s.retireObservation(observation)
		observation.mu.Lock()
		active := observation.active
		observation.mu.Unlock()
		if active {
			select {
			case <-observation.done:
			case <-time.After(sourceCloseJoinTimeout):
			}
		}
	}
	return nil
}

func (s *GraphService) retireObservation(observation *graphObservation) {
	s.mu.Lock()
	if s.observations[observation.key] == observation {
		delete(s.observations, observation.key)
		s.closed[observation.key] = struct{}{}
	}
	s.mu.Unlock()
	observation.cancel()
	observation.mu.Lock()
	stop := observation.stopLife
	active := observation.active
	observation.mu.Unlock()
	if stop != nil {
		stop()
	}
	if !active {
		observation.releaseReservation()
	}
}

func graphObservationMetadata(request HostGraphObservationRequest) int {
	a := request.Reference.Address
	size := 2048 + graphObservationProofBytes + 8*(len(request.ClientToken)+len(request.PluginID)+len(request.Route.Connection)+len(request.Kind)+len(request.Direction)+len(a.Provider)+len(a.Authority)+len(a.Type)+len(a.ID))
	if request.Reference.Incarnation != nil {
		size += 8 * len(*request.Reference.Incarnation)
	}
	if request.RelationshipType != nil {
		size += 8 * len(*request.RelationshipType)
	}
	for _, entry := range a.Scope {
		size += 128 + 8*(len(entry.Dimension)+len(entry.Value))
	}
	return size
}

func (o *graphObservation) releaseReservation() {
	o.mu.Lock()
	charge := o.metadataCharge
	o.metadataCharge = 0
	o.mu.Unlock()
	if charge != 0 {
		o.service.ctrl.graphMetadata.release(charge - graphObservationProofBytes)
	}
}

func (o *graphObservation) publish(snapshot HostGraphObservationSnapshot) {
	if o.ctx.Err() != nil {
		return
	}
	o.mu.Lock()
	o.failed = snapshot.State == "failed"
	o.mu.Unlock()
	o.sequence++
	snapshot.ObservationID, snapshot.Generation, snapshot.Sequence = o.key.token, o.generation, strconv.FormatUint(o.sequence, 10)
	o.emit(snapshot)
}

func graphObservationFailure(err error) HostGraphObservationSnapshot {
	var operation *resourcev2.ResourceOperationError
	if errors.As(err, &operation) {
		copy := *operation
		return HostGraphObservationSnapshot{State: "failed", Error: &copy}
	}
	return HostGraphObservationSnapshot{State: "failed", Error: &resourcev2.ResourceOperationError{Code: resourcev2.ErrorCode(err), Message: "Graph observation is unavailable."}}
}

func (o *graphObservation) run() {
	defer close(o.done)
	defer o.releaseReservation()
	var demand *graphDemand
	defer func() {
		if demand != nil {
			demand.close()
		}
	}()
	first := true
	for o.ctx.Err() == nil {
		o.mu.Lock()
		refresh := o.refresh
		o.refresh = false
		o.mu.Unlock()
		if refresh && demand != nil {
			demand.close()
			demand = nil
		}
		if first || refresh {
			o.publish(HostGraphObservationSnapshot{State: "pending"})
			var err error
			demand, err = o.service.newDemand(o.ctx, o.request)
			first = false
			if err != nil {
				o.publish(graphObservationFailure(err))
			}
		}
		if demand != nil {
			result, err := demand.evaluate(o.ctx)
			if err == nil {
				o.publish(result.HostGraphObservationSnapshot)
			} else {
				o.publish(graphObservationFailure(err))
				if code := resourcev2.ErrorCode(err); code != "UNAVAILABLE" {
					demand.close()
					demand = nil
				}
			}
			if demand != nil {
				demand.releaseResult()
			}
		}
		if demand == nil {
			select {
			case <-o.ctx.Done():
				return
			case <-o.wake:
			}
		} else {
			if err := demand.wait(o.ctx, o.wake); err != nil {
				return
			}
		}
	}
}
