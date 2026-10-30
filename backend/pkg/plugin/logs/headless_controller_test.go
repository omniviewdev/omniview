package logs

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"strings"
	"testing"

	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

type headlessSourceProvider struct {
	Provider
	controller     *controller
	closed         chan struct{}
	principal      any
	tail           int64
	cancel         context.CancelFunc
	id             string
	createErr      error
	closeErr       error
	requestID      string
	closeRequestID string
}

func (p *headlessSourceProvider) CreateResourceSession(pc *sdktypes.PluginContext, opts sdklogs.CreateSessionOptions) (*sdklogs.LogSession, error) {
	p.principal = pc.Context.Value(headlessPrincipalKey{})
	p.tail = opts.Options.TailLines
	p.id = opts.SessionID
	p.requestID = pc.RequestID
	if p.createErr != nil {
		return nil, p.createErr
	}
	if p.cancel != nil {
		p.cancel()
		return &sdklogs.LogSession{ID: opts.SessionID}, nil
	}
	reader := io.NopCloser(strings.NewReader("actual first line\nactual second line\n"))
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		p.controller.handleOutput(sdklogs.StreamOutput{SessionID: opts.SessionID, Line: &sdklogs.LogLine{SessionID: opts.SessionID, Content: scanner.Text()}})
	}
	_ = reader.Close()
	p.controller.handleOutput(sdklogs.StreamOutput{SessionID: opts.SessionID, Event: &sdklogs.LogStreamEvent{Type: sdklogs.StreamEventStreamEnded}})
	return &sdklogs.LogSession{ID: opts.SessionID}, nil
}
func (p *headlessSourceProvider) CloseSession(pc *sdktypes.PluginContext, id string) error {
	p.closeRequestID = pc.RequestID
	if p.id != id {
		return fmt.Errorf("cleanup correlation mismatch")
	}
	close(p.closed)
	return p.closeErr
}

type headlessPrincipalKey struct{}

func TestHeadlessControllerUsesOriginalPrincipalAndClosesSession(t *testing.T) {
	ctrl := &controller{clients: make(map[string]Provider)}
	provider := &headlessSourceProvider{controller: ctrl, closed: make(chan struct{})}
	ctrl.clients["plugin"] = provider
	principal := &struct{}{}
	ctrl.referenceAdmitter = func(ctx context.Context, operation, plugin string, route sdkresource.AccessRoute, reference sdkresource.ResourceReference) (context.Context, error) {
		if ctx.Value(headlessPrincipalKey{}) != principal || operation != "logs.CreateSession" {
			t.Fatal("principal or native operation changed")
		}
		return ctx, nil
	}
	ctx := context.WithValue(context.Background(), headlessPrincipalKey{}, principal)
	result, err := ctrl.ReadResourceLogs(ctx, "plugin", sdklogs.CreateSessionOptions{ResourceKey: "pod", ResourceID: "pod", Route: &sdkresource.AccessRoute{Connection: "route"}, Reference: &sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{Provider: "provider", Authority: "authority", Type: "pod", ID: "pod", Scope: []sdkresource.ScopeEntry{}}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Lines) != 2 || result.Truncated || result.Lines[0].Content != "actual first line" {
		t.Fatalf("unexpected actual output: %#v", result)
	}
	if provider.principal != principal || provider.tail != 200 {
		t.Fatal("provenance or default tail changed")
	}
	select {
	case <-provider.closed:
	default:
		t.Fatal("accepted session not closed")
	}
	if len(ctrl.headless) != 0 {
		t.Fatal("consumer subscription leaked")
	}
}

func TestHeadlessControllerCancellationClosesAcceptedSession(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctrl := &controller{clients: make(map[string]Provider)}
	provider := &headlessSourceProvider{controller: ctrl, closed: make(chan struct{}), cancel: cancel}
	ctrl.clients["plugin"] = provider
	ctrl.referenceAdmitter = func(ctx context.Context, _ string, _ string, _ sdkresource.AccessRoute, _ sdkresource.ResourceReference) (context.Context, error) {
		return ctx, nil
	}
	_, err := ctrl.ReadResourceLogs(ctx, "plugin", sdklogs.CreateSessionOptions{ResourceKey: "pod", ResourceID: "pod", Route: &sdkresource.AccessRoute{Connection: "route"}, Reference: &sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{Provider: "provider", Authority: "authority", Type: "pod", ID: "pod", Scope: []sdkresource.ScopeEntry{}}}})
	if err != context.Canceled {
		t.Fatalf("cancellation: %v", err)
	}
	select {
	case <-provider.closed:
	default:
		t.Fatal("canceled session not closed")
	}
	if len(ctrl.headless) != 0 {
		t.Fatal("canceled subscription leaked")
	}
}

func TestHeadlessCorrelatedCleanupAfterLostReplyAndCleanupFailure(t *testing.T) {
	for _, cleanupFails := range []bool{false, true} {
		t.Run(fmt.Sprint(cleanupFails), func(t *testing.T) {
			ctrl := &controller{clients: make(map[string]Provider)}
			provider := &headlessSourceProvider{controller: ctrl, closed: make(chan struct{}), createErr: fmt.Errorf("acceptance reply lost")}
			if cleanupFails {
				provider.closeErr = fmt.Errorf("secret native cleanup diagnostic")
			}
			ctrl.clients["plugin"] = provider
			ctrl.referenceAdmitter = func(ctx context.Context, _ string, _ string, _ sdkresource.AccessRoute, _ sdkresource.ResourceReference) (context.Context, error) {
				return ctx, nil
			}
			_, err := ctrl.ReadResourceLogs(context.Background(), "plugin", sdklogs.CreateSessionOptions{ResourceKey: "pod", ResourceID: "pod", Route: &sdkresource.AccessRoute{Connection: "route"}, Reference: &sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{Provider: "provider", Authority: "authority", Type: "pod", ID: "pod", Scope: []sdkresource.ScopeEntry{}}}})
			if err == nil || strings.Contains(err.Error(), "secret") {
				t.Fatalf("unsafe cleanup outcome: %v", err)
			}
			if cleanupFails && !strings.Contains(err.Error(), "cleanup failed") {
				t.Fatalf("cleanup failure disappeared: %v", err)
			}
			if provider.id == "" {
				t.Fatal("creation lacked preallocated correlation")
			}
			select {
			case <-provider.closed:
			default:
				t.Fatal("lost reply did not close known ID")
			}
			if len(ctrl.headless) != 0 {
				t.Fatal("lost-reply subscription leaked")
			}
		})
	}
}
