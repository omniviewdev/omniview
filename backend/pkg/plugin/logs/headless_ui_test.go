package logs

import (
	"bufio"
	"context"
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
