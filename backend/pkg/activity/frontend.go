package activity

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/transportjson"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	frontendProducerLease = 30 * time.Second
	frontendLeaseInterval = 5 * time.Second
	maxFrontendSessions   = 128
)

type frontendSession struct {
	windowID      uint
	viewOwner     string
	producerOwner string
	lastHeartbeat time.Time
}

// FrontendService admits only native host-window calls. A subscription ID is also
// an unguessable producer-session capability, bound to its issuing native window.
// This keeps document reloads and different webviews from renewing each other's
// report-only work. The capability never grants plugin producer authority.
type FrontendService struct {
	Service *Service
	Realm   invocation.ContextScope

	mu       sync.Mutex
	sessions map[string]frontendSession
	stop     context.CancelFunc
}

func (f *FrontendService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	leaseContext, stop := context.WithCancel(ctx)
	f.stop = stop
	go f.watchProducerLeases(leaseContext)
	return nil
}

func (f *FrontendService) ServiceShutdown() error {
	if f.stop != nil {
		f.stop()
	}
	return f.Service.Shutdown()
}

func (f *FrontendService) watchProducerLeases(ctx context.Context) {
	ticker := time.NewTicker(frontendLeaseInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case at := <-ticker.C:
			f.expireProducerSessions(at)
		}
	}
}

func (f *FrontendService) expireProducerSessions(at time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, session := range f.sessions {
		if at.Sub(session.lastHeartbeat) <= frontendProducerLease {
			continue
		}
		// Keep the expired session for retry if durable retirement fails. Its
		// producer is already fenced, so no late report can claim an outcome.
		if err := f.Service.retire(session.producerOwner, "producer-lost"); err != nil {
			continue
		}
		f.Service.DropSubscriptions(session.viewOwner)
		delete(f.sessions, id)
	}
}

func (f *FrontendService) caller(ctx context.Context) (application.Window, error) {
	if f.Realm == nil || ctx == nil {
		return nil, errors.New("native activity caller required")
	}
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok || window == nil {
		return nil, errors.New("native activity caller required")
	}
	return window, nil
}

func (f *FrontendService) session(ctx context.Context, id string, renew bool) (frontendSession, error) {
	window, err := f.caller(ctx)
	if err != nil {
		return frontendSession{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	session, ok := f.sessions[id]
	if !ok || session.windowID != window.ID() {
		return frontendSession{}, errors.New("activity session unavailable")
	}
	if time.Since(session.lastHeartbeat) > frontendProducerLease {
		return frontendSession{}, errors.New("activity producer lease expired")
	}
	if renew {
		session.lastHeartbeat = time.Now()
		f.sessions[id] = session
	}
	return session, nil
}

// Heartbeat renews only the specified document's report-only producer lease.
func (f *FrontendService) Heartbeat(ctx context.Context, id string) error {
	_, err := f.session(ctx, id, true)
	return err
}

func (f *FrontendService) Snapshot(ctx context.Context) (sdk.Snapshot, error) {
	if _, err := f.caller(ctx); err != nil {
		return sdk.Snapshot{}, err
	}
	return f.Service.Snapshot(), nil
}

func (f *FrontendService) Subscribe(ctx context.Context) (sdk.Subscription, error) {
	window, err := f.caller(ctx)
	if err != nil {
		return sdk.Subscription{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.sessions) >= maxFrontendSessions {
		return sdk.Subscription{}, errors.New("activity session limit reached")
	}
	owner := "view:" + newID()
	subscription, err := f.Service.Subscribe(owner)
	if err != nil {
		return sdk.Subscription{}, err
	}
	if f.sessions == nil {
		f.sessions = make(map[string]frontendSession)
	}
	producerOwner := "ui:" + newID()
	f.sessions[subscription.ID] = frontendSession{
		windowID:      window.ID(),
		viewOwner:     owner,
		producerOwner: producerOwner,
		lastHeartbeat: time.Now(),
	}
	if err := f.Service.ActivateProducer(producerOwner); err != nil {
		delete(f.sessions, subscription.ID)
		_ = f.Service.Unsubscribe(owner, subscription.ID)
		return sdk.Subscription{}, err
	}
	return subscription, nil
}

// Attach arms publication under the same lock used to capture the snapshot.
// Clients install their subscription listener before calling this barrier.
func (f *FrontendService) Attach(ctx context.Context, id string) (sdk.Snapshot, error) {
	session, err := f.session(ctx, id, false)
	if err != nil {
		return sdk.Snapshot{}, err
	}
	return f.Service.Attach(session.viewOwner, id)
}

// Unsubscribe removes a view, never cancels work or immediately retires producers.
func (f *FrontendService) Unsubscribe(ctx context.Context, id string) error {
	session, err := f.session(ctx, id, false)
	if err != nil {
		return err
	}
	return f.Service.Unsubscribe(session.viewOwner, id)
}

func validateFrontendSource(spec sdk.Spec) error {
	if spec.Source != nil && (spec.Source.PluginID != "" || spec.Source.Resource != nil) {
		return errors.New("frontend observations cannot claim plugin provenance")
	}
	return nil
}

func (f *FrontendService) BeginTask(ctx context.Context, sessionID, encoded string) (sdk.Record, error) {
	session, err := f.session(ctx, sessionID, true)
	if err != nil {
		return sdk.Record{}, err
	}
	var request sdk.Spec
	if err := transportjson.Decode(encoded, &request); err != nil {
		return sdk.Record{}, err
	}
	if err := validateFrontendSource(request); err != nil {
		return sdk.Record{}, err
	}
	return f.Service.BeginOwnedTask(session.producerOwner, request, nil)
}

func (f *FrontendService) ReportTask(ctx context.Context, sessionID, encoded string) (sdk.Record, error) {
	session, err := f.session(ctx, sessionID, true)
	if err != nil {
		return sdk.Record{}, err
	}
	var request sdk.ReportTaskRequest
	if err := transportjson.Decode(encoded, &request); err != nil {
		return sdk.Record{}, err
	}
	return f.Service.ReportOwnedTask(session.producerOwner, request)
}

func (f *FrontendService) FinishTask(ctx context.Context, sessionID, encoded string) (sdk.Record, error) {
	session, err := f.session(ctx, sessionID, true)
	if err != nil {
		return sdk.Record{}, err
	}
	var request sdk.FinishTaskRequest
	if err := transportjson.Decode(encoded, &request); err != nil {
		return sdk.Record{}, err
	}
	return f.Service.FinishOwnedTask(session.producerOwner, request)
}

func (f *FrontendService) PublishMessage(ctx context.Context, sessionID, encoded string) (sdk.Record, error) {
	session, err := f.session(ctx, sessionID, true)
	if err != nil {
		return sdk.Record{}, err
	}
	var request sdk.Spec
	if err := transportjson.Decode(encoded, &request); err != nil {
		return sdk.Record{}, err
	}
	if err := validateFrontendSource(request); err != nil {
		return sdk.Record{}, err
	}
	return f.Service.publishMessage(session.producerOwner, request)
}

func (f *FrontendService) UpsertAlert(ctx context.Context, sessionID, encoded string) (sdk.Record, error) {
	session, err := f.session(ctx, sessionID, true)
	if err != nil {
		return sdk.Record{}, err
	}
	var request sdk.AlertRequest
	if err := transportjson.Decode(encoded, &request); err != nil {
		return sdk.Record{}, err
	}
	if err := validateFrontendSource(request.Spec); err != nil {
		return sdk.Record{}, err
	}
	return f.Service.upsertAlert(session.producerOwner, request)
}

func (f *FrontendService) ResolveAlert(ctx context.Context, sessionID string, request sdk.ResolveAlertRequest) (sdk.Record, error) {
	session, err := f.session(ctx, sessionID, true)
	if err != nil {
		return sdk.Record{}, err
	}
	return f.Service.resolveAlert(session.producerOwner, request)
}

func (f *FrontendService) SetPresentation(ctx context.Context, request sdk.SetPresentationRequest) (sdk.Record, error) {
	if _, err := f.caller(ctx); err != nil {
		return sdk.Record{}, err
	}
	return f.Service.SetPresentation(request)
}

func (f *FrontendService) ClearHistory(ctx context.Context) error {
	if _, err := f.caller(ctx); err != nil {
		return err
	}
	return f.Service.ClearHistory()
}

func (f *FrontendService) RequestCancellation(ctx context.Context, id string) (sdk.Record, error) {
	if _, err := f.caller(ctx); err != nil {
		return sdk.Record{}, err
	}
	return f.Service.RequestCancellation(id)
}

func (f *FrontendService) StartResourceAction(ctx context.Context, encoded string) (sdk.Record, error) {
	if _, err := f.caller(ctx); err != nil {
		return sdk.Record{}, err
	}
	var request sdk.StartResourceActionRequest
	if err := transportjson.Decode(encoded, &request); err != nil {
		return sdk.Record{}, err
	}
	return f.Service.StartResourceAction(f.Realm.Context(ctx), request)
}
