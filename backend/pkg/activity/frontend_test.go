package activity

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type activityTestWindow struct {
	application.Window
	id uint
}

func (w activityTestWindow) ID() uint {
	return w.id
}

func frontendCaller(id uint) context.Context {
	return context.WithValue(context.Background(), application.WindowKey, activityTestWindow{id: id})
}

func TestFrontendRequiresNativeCallerAndOwnCapability(t *testing.T) {
	service, _ := testService(t)
	frontend := &FrontendService{Service: service, Realm: invocation.NewScope(invocation.TrustedUI)}
	if _, err := frontend.Subscribe(context.Background()); err == nil {
		t.Fatal("caller without native window admitted")
	}
	first := frontendCaller(1)
	session, err := frontend.Subscribe(first)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := frontend.BeginTask(frontendCaller(2), session.ID, encodeActivitySpec(t, taskSpec("spoof"))); err == nil {
		t.Fatal("another webview used producer capability")
	}
	request := taskSpec("spoof")
	request.Source = &sdk.Source{PluginID: "alpha"}
	if _, err := frontend.BeginTask(first, session.ID, encodeActivitySpec(t, request)); err == nil {
		t.Fatal("frontend claimed plugin provenance")
	}
}

func TestFrontendLeaseDoesNotCrossDocumentsOrOwnNativeWork(t *testing.T) {
	service, _ := testService(t)
	frontend := &FrontendService{Service: service, Realm: invocation.NewScope(invocation.TrustedUI)}
	caller := frontendCaller(1)
	oldDocument, err := frontend.Subscribe(caller)
	if err != nil {
		t.Fatal(err)
	}
	liveDocument, err := frontend.Subscribe(caller)
	if err != nil {
		t.Fatal(err)
	}
	lostTask, err := frontend.BeginTask(caller, oldDocument.ID, encodeActivitySpec(t, taskSpec("lost document")))
	if err != nil {
		t.Fatal(err)
	}
	liveTask, err := frontend.BeginTask(caller, liveDocument.ID, encodeActivitySpec(t, taskSpec("live document")))
	if err != nil {
		t.Fatal(err)
	}
	nativeTask, err := service.BeginOwnedTask("native:alpha", taskSpec("native work"), nil)
	if err != nil {
		t.Fatal(err)
	}
	frontend.mu.Lock()
	oldSession := frontend.sessions[oldDocument.ID]
	oldSession.lastHeartbeat = time.Now().Add(-2 * frontendProducerLease)
	frontend.sessions[oldDocument.ID] = oldSession
	frontend.mu.Unlock()
	if err := frontend.Heartbeat(caller, liveDocument.ID); err != nil {
		t.Fatal(err)
	}
	frontend.expireProducerSessions(time.Now())
	records := make(map[string]sdk.Record)
	for _, record := range service.Snapshot().Records {
		records[record.ID] = record
	}
	if records[lostTask.ID].Task.State != "unknown" {
		t.Fatal("live document renewed lost document producer")
	}
	if !active(records[liveTask.ID]) || !active(records[nativeTask.ID]) {
		t.Fatal("document lease retired another producer")
	}
	if err := frontend.Heartbeat(caller, oldDocument.ID); err == nil {
		t.Fatal("expired capability resurrected producer")
	}
}

func TestUnsubscribeDoesNotFinishReportOnlyTask(t *testing.T) {
	service, _ := testService(t)
	frontend := &FrontendService{Service: service, Realm: invocation.NewScope(invocation.TrustedUI)}
	caller := frontendCaller(1)
	session, err := frontend.Subscribe(caller)
	if err != nil {
		t.Fatal(err)
	}
	record, err := frontend.BeginTask(caller, session.ID, encodeActivitySpec(t, taskSpec("observed work")))
	if err != nil {
		t.Fatal(err)
	}
	if err := frontend.Unsubscribe(caller, session.ID); err != nil {
		t.Fatal(err)
	}
	if err := frontend.Heartbeat(caller, session.ID); err != nil {
		t.Fatal(err)
	}
	if !active(service.Snapshot().Records[0]) {
		t.Fatal("view teardown finished producer task", record.ID)
	}
}

func encodeActivitySpec(t *testing.T, spec sdk.Spec) string {
	t.Helper()
	data, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestFrontendCapabilityNeverEntersPersistedOwner(t *testing.T) {
	service, root := testService(t)
	frontend := &FrontendService{Service: service, Realm: invocation.NewScope(invocation.TrustedUI)}
	caller := frontendCaller(1)
	session, err := frontend.Subscribe(caller)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := frontend.BeginTask(caller, session.ID, encodeActivitySpec(t, taskSpec("work"))); err != nil {
		t.Fatal(err)
	}
	data, err := root.ReadFile("activities.json")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte(session.ID)) {
		t.Fatal("live producer capability leaked into persisted history")
	}
}
