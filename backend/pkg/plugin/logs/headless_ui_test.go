package logs

import (
	"bufio"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

type immediateUIConnection struct{ hostresource.ConnectionReader }

func (immediateUIConnection) GetConnection(context.Context, string, string) (sdktypes.Connection, error) {
	return sdktypes.Connection{ID: "route"}, nil
}

type immediateUIProvider struct {
	stubLogsProvider
	controller *controller
	timer      *time.Timer
	indexed    bool
}

func (p *immediateUIProvider) CreateSession(_ *sdktypes.PluginContext, opts sdklogs.CreateSessionOptions) (*sdklogs.LogSession, error) {
	p.controller.mu.RLock()
	_, p.indexed = p.controller.sessionIndex[opts.SessionID]
	p.controller.mu.RUnlock()
	// An inert timer lets this headless test inspect actual batching without a
	// Wails singleton or wall-clock dependence on the production flush timer.
	p.timer = time.NewTimer(time.Hour)
	p.controller.batchMux.Lock()
	p.controller.batches[opts.SessionID] = &logBatch{timer: p.timer}
	p.controller.batchMux.Unlock()
	source := bufio.NewScanner(strings.NewReader("immediate native output\n"))
	for source.Scan() {
		p.controller.handleOutput(sdklogs.StreamOutput{SessionID: opts.SessionID, Line: &sdklogs.LogLine{SessionID: opts.SessionID, Content: source.Text()}})
	}
	return &sdklogs.LogSession{ID: opts.SessionID}, nil
}

func TestImmediateFiniteUIOutputPrecedesCreationResponse(t *testing.T) {
	ctrl := &controller{logger: logging.NewNop(), clients: make(map[string]Provider), sessionIndex: make(map[string]sessionIndex), batches: make(map[string]*logBatch), resourceClient: immediateUIConnection{}}
	provider := &immediateUIProvider{controller: ctrl}
	ctrl.clients["plugin"] = provider
	session, err := ctrl.CreateSession("plugin", "route", sdklogs.CreateSessionOptions{ResourceKey: "pod", ResourceID: "pod"})
	if provider.timer != nil {
		defer provider.timer.Stop()
	}
	if err != nil {
		t.Fatal(err)
	}
	if !provider.indexed {
		t.Fatal("UI session was not indexed before native creation")
	}
	ctrl.batchMux.Lock()
	defer ctrl.batchMux.Unlock()
	batch := ctrl.batches[session.ID]
	if batch == nil || len(batch.lines) != 1 || batch.lines[0].Content != "immediate native output" {
		t.Fatal("first finite UI output was lost")
	}
}

func TestUICorrelationIDIsPreservedAndCannotBeReused(t *testing.T) {
	const id = "cc649ffe-874b-49c4-8e73-26eea4df1e39"
	ctrl := &controller{logger: logging.NewNop(), clients: make(map[string]Provider), sessionIndex: make(map[string]sessionIndex), batches: make(map[string]*logBatch), resourceClient: immediateUIConnection{}}
	provider := &immediateUIProvider{controller: ctrl}
	ctrl.clients["plugin"] = provider
	session, err := ctrl.CreateSession("plugin", "route", sdklogs.CreateSessionOptions{SessionID: id})
	if provider.timer != nil {
		defer provider.timer.Stop()
	}
	if err != nil {
		t.Fatal(err)
	}
	if session.ID != id {
		t.Fatalf("listener reserved %s, provider received %s", id, session.ID)
	}
	_, err = ctrl.CreateSession("plugin", "other-route", sdklogs.CreateSessionOptions{SessionID: id})
	if resourcev2.ErrorCode(err) != "INVALID_REQUEST" {
		t.Fatalf("duplicate correlation must be rejected, got %v", err)
	}
	if ctrl.sessionIndex[id].connectionID != "route" {
		t.Fatal("duplicate request replaced session routing")
	}
}

func TestUIRejectsInvalidCorrelationID(t *testing.T) {
	ctrl := &controller{clients: map[string]Provider{"plugin": &stubLogsProvider{}}}
	_, err := ctrl.CreateSession("plugin", "route", sdklogs.CreateSessionOptions{SessionID: "not-a-uuid"})
	if resourcev2.ErrorCode(err) != "INVALID_REQUEST" {
		t.Fatalf("invalid correlation must be rejected before provider call, got %v", err)
	}
}

type stalledUIProvider struct {
	stubLogsProvider
	controller      *controller
	timer           *time.Timer
	closedSessionID string
	closeContextErr error
	lateSuccess     bool
}

func (p *stalledUIProvider) CreateSession(ctx *sdktypes.PluginContext, opts sdklogs.CreateSessionOptions) (*sdklogs.LogSession, error) {
	p.timer = time.NewTimer(time.Hour)
	p.controller.batchMux.Lock()
	p.controller.batches[opts.SessionID] = &logBatch{timer: p.timer}
	p.controller.batchMux.Unlock()
	p.controller.handleOutput(sdklogs.StreamOutput{
		SessionID: opts.SessionID,
		Line:      &sdklogs.LogLine{SessionID: opts.SessionID, Content: "output before deadline"},
	})
	<-ctx.Context.Done()
	if p.lateSuccess {
		return &sdklogs.LogSession{ID: opts.SessionID}, nil
	}
	return nil, ctx.Context.Err()
}

func (p *stalledUIProvider) CloseSession(ctx *sdktypes.PluginContext, sessionID string) error {
	p.closedSessionID = sessionID
	p.closeContextErr = ctx.Context.Err()
	return nil
}

func TestUICreationDeadlineRetiresCorrelationAndPendingOutput(t *testing.T) {
	for _, lateSuccess := range []bool{false, true} {
		name := "deadline error"
		if lateSuccess {
			name = "late provider success"
		}
		t.Run(name, func(t *testing.T) {
			const id = "cc649ffe-874b-49c4-8e73-26eea4df1e39"
			ctrl := &controller{
				logger: logging.NewNop(), clients: make(map[string]Provider),
				sessionIndex: make(map[string]sessionIndex), batches: make(map[string]*logBatch),
				resourceClient: immediateUIConnection{},
			}
			provider := &stalledUIProvider{controller: ctrl, lateSuccess: lateSuccess}
			ctrl.clients["plugin"] = provider
			defer func() {
				if provider.timer != nil {
					provider.timer.Stop()
				}
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
			defer cancel()
			session, err := ctrl.createSessionWithContext(ctx, "plugin", "route", sdklogs.CreateSessionOptions{SessionID: id})
			if !errors.Is(err, context.DeadlineExceeded) || session != nil {
				t.Fatalf("creation returned session=%v error=%v, want deadline failure", session, err)
			}
			if provider.closedSessionID != id || provider.closeContextErr != nil {
				t.Fatalf("cleanup closed=%q context=%v, want correlated close with live context", provider.closedSessionID, provider.closeContextErr)
			}
			if _, indexed := ctrl.sessionIndex[id]; indexed {
				t.Fatal("timed-out creation retained its correlation")
			}
			if _, buffered := ctrl.batches[id]; buffered {
				t.Fatal("timed-out creation retained pending output")
			}
		})
	}
}
