package resource

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestSourceStatusDoesNotExposeProviderDetails(t *testing.T) {
	const secret = "fake-provider-secret"
	ctrl, emitter := newTestControllerWithEmitter(t)
	session := &sourceSession{
		coordinator: ctrl.sources, ctx: context.Background(), pluginID: "plugin", members: make(map[string]sourceMember),
	}
	session.statusLocked("failed", &resourcev2.ResourceOperationError{
		Code: "FORBIDDEN", Title: secret, Message: secret, Suggestions: []string{secret},
	})
	events := emitter.Events()
	if len(events) != 2 || events[1].Key != EventSourceState || len(events[1].Data) != 1 {
		t.Fatalf("expected source state event, got %v", events)
	}
	event, ok := events[1].Data[0].(HostSourceStateEvent)
	if !ok || event.Status.Error == nil || event.Status.Error.Code != "FORBIDDEN" ||
		event.Status.Error.Message != "Source session failed." {
		t.Fatalf("unexpected source error: %#v", events[1].Data[0])
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), secret) {
		t.Fatal("provider details leaked into source state event")
	}
}
