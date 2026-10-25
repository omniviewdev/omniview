package resource

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
)

// This registered resourcer establishes a real native file before ready, then
// keeps its descriptor and producer alive until the accepted handle is canceled.
type transferFileResourcer struct {
	resourcetest.StubResourcer[string]
	continueWork chan struct{}
	continued    chan error
	opened       chan *os.File
	started      chan struct{}
	stopped      chan struct{}
}

func (*transferFileResourcer) GetActions(context.Context, *string, resource.ResourceMeta) ([]resource.ActionDescriptor, error) {
	return []resource.ActionDescriptor{{ID: "append", Label: "Append"}}, nil
}

func (*transferFileResourcer) ExecuteAction(context.Context, *string, resource.ResourceMeta, string, resource.ActionInput) (*resource.ActionResult, error) {
	return nil, &resource.ResourceOperationError{Code: "UNSUPPORTED", Title: "Streaming action required", Message: "Use the append stream."}
}

func (r *transferFileResourcer) StreamAction(ctx context.Context, root *string, _ resource.ResourceMeta, _ string, _ resource.ActionInput, events chan<- resource.ActionEvent) error {
	close(r.started)
	defer close(r.stopped)
	file, err := os.OpenFile(filepath.Join(*root, "action.txt"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	r.opened <- file
	if _, err := file.WriteString("established\n"); err != nil {
		return err
	}
	select {
	case events <- resource.ActionEvent{Type: "ready"}:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case <-r.continueWork:
	case <-ctx.Done():
		r.continued <- ctx.Err()
		return ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		r.continued <- err
		return err
	}
	_, err = file.WriteString("continued after open cancellation\n")
	r.continued <- err
	if err != nil {
		return err
	}
	<-ctx.Done()
	return ctx.Err()
}

func TestStreamActionCommittedNativeHandleSurvivesReturnCancellation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	root := t.TempDir()
	native := &transferFileResourcer{
		continueWork: make(chan struct{}),
		continued:    make(chan error, 1),
		opened:       make(chan *os.File, 1),
		started:      make(chan struct{}),
		stopped:      make(chan struct{}),
	}
	provider, err := resource.BuildResourceController(context.Background(), resource.ResourcePluginConfig[string]{
		Connections: &resourcetest.StubConnectionProvider[string]{CreateClientFunc: func(context.Context) (*string, error) { return &root, nil }},
		Resources: []resource.ResourceRegistration[string]{{
			Meta:      resource.ResourceMeta{Group: "native", Version: "v1", Kind: "File"},
			Resourcer: native,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(provider.Close)
	if _, err := provider.LoadConnections(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.StartConnection(context.Background(), "conn-1"); err != nil {
		t.Fatal(err)
	}
	registerMockPlugin(ctrl, "native", setupGRPCProvider(t, provider))

	owner := invocation.NewScope(invocation.TrustedUI)
	openCtx, cancelOpen := context.WithCancel(owner.Context(context.Background()))
	t.Cleanup(func() {
		cancelOpen()
		ctrl.actions.stopAll()
		select {
		case <-native.started:
			select {
			case <-native.stopped:
			case <-time.After(2 * time.Second):
				t.Error("native file producer did not stop during cleanup")
				return
			}
		default:
		}
		select {
		case file := <-native.opened:
			if _, err := file.Stat(); !errors.Is(err, os.ErrClosed) {
				t.Errorf("native file descriptor survived cleanup: %v", err)
			}
		default:
		}
		if count := actionCount(ctrl.actions); count != 0 {
			t.Errorf("cleanup retained %d pending/accepted actions", count)
		}
	})

	// The existing timer factory is called under the actual registry commit lock,
	// after insertion and its producer cancellation check. Canceling here forces
	// the commit/return boundary without timing races or context.Err call counts.
	schedule := ctrl.actions.afterFunc
	ctrl.actions.afterFunc = func(delay time.Duration, callback func()) actionTimer {
		timer := schedule(delay, callback)
		if delay == actionAttachTimeout {
			cancelOpen()
		}
		return timer
	}
	id, err := ctrl.StreamAction(openCtx, "native", "conn-1", "native::v1::File", "append", resource.ActionInput{})
	if !errors.Is(openCtx.Err(), context.Canceled) {
		t.Fatal("the request was not canceled at the registry commit boundary")
	}
	if err != nil || id == "" {
		t.Fatalf("committed native handle became a failed open: id=%q err=%v", id, err)
	}
	if count := actionCount(ctrl.actions); count != 1 {
		t.Fatalf("accepted native producer has %d pending/accepted actions", count)
	}
	live := owner.Context(context.Background())
	if _, err := ctrl.actions.owned(live, id); err != nil {
		t.Fatalf("returned handle lost its actual registry owner: %v", err)
	}
	foreign := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	if err := ctrl.CancelStreamAction(foreign, id); requireAppError(t, err).Code != "FORBIDDEN" {
		t.Fatal("foreign cancellation changed the handle ownership contract")
	}
	if snapshot, err := ctrl.AttachStreamAction(live, id); err != nil || snapshot.Terminal {
		t.Fatalf("committed handle could not attach to live native work: snapshot=%+v err=%v", snapshot, err)
	}
	close(native.continueWork)
	select {
	case err := <-native.continued:
		if err != nil {
			t.Fatalf("completed open cancellation reached transferred native work: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("accepted native producer did not continue")
	}
	data, err := os.ReadFile(filepath.Join(root, "action.txt"))
	if err != nil || string(data) != "established\ncontinued after open cancellation\n" {
		t.Fatalf("native work did not survive the transfer: data=%q err=%v", data, err)
	}
	if err := ctrl.CancelStreamAction(live, id); err != nil {
		t.Fatalf("owner could not release accepted native work: %v", err)
	}
	select {
	case <-native.stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("owning cancellation did not stop the native file producer")
	}
	if count := actionCount(ctrl.actions); count != 0 {
		t.Fatalf("owning cancellation retained %d pending/accepted actions", count)
	}
	if err := ctrl.CancelStreamAction(live, id); requireAppError(t, err).Code != "FORBIDDEN" {
		t.Fatal("repeated cancellation became privileged idempotency")
	}
}
