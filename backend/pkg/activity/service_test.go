package activity

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/appstate"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
)

func testService(t *testing.T) (*Service, *appstate.ScopedRoot) {
	t.Helper()
	state, err := appstate.New(appstate.WithRoot(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	root := state.RootDir()
	s, err := NewService(root, nil)
	if err != nil {
		t.Fatal(err)
	}
	return s, root
}

func taskSpec(title string) sdk.Spec {
	return sdk.Spec{Presentation: sdk.Presentation{Title: title}}
}

func mustRecord(t *testing.T, r sdk.Record, err error) sdk.Record {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestProducerOwnershipAndRetirement(t *testing.T) {
	s, _ := testService(t)
	ctx := context.Background()
	a := s.Reporter("alpha", "generation-one")
	b := s.Reporter("beta", "generation-one")
	r, err := a.BeginTask(ctx, taskSpec("work"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = b.FinishTask(ctx, sdk.FinishTaskRequest{ID: r.ID, State: "succeeded"}); err == nil {
		t.Fatal("cross-plugin finish accepted")
	}
	spoof := taskSpec("spoof")
	spoof.Source = &sdk.Source{PluginID: "beta"}
	if _, err = a.BeginTask(ctx, spoof); err == nil {
		t.Fatal("spoofed source accepted")
	}
	if err = s.RetireProducer("alpha", "generation-one"); err != nil {
		t.Fatal(err)
	}
	if _, err = a.ReportTask(ctx, sdk.ReportTaskRequest{ID: r.ID, Presentation: r.Presentation}); err == nil {
		t.Fatal("retired producer accepted")
	}
	snapshot := s.Snapshot()
	if snapshot.Records[0].Task.State != "unknown" {
		t.Fatal("lost producer claimed terminal outcome")
	}
}

func TestCancellationAndPresentationStayIndependent(t *testing.T) {
	s, _ := testService(t)
	called := 0
	r, err := s.BeginOwnedTask("native:alpha", taskSpec("work"), func() error {
		called++
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	yes := true
	if _, err = s.SetPresentation(sdk.SetPresentationRequest{
		ID: r.ID, Collapsed: &yes, ToastDismissed: &yes, Read: &yes,
	}); err != nil {
		t.Fatal(err)
	}
	if called != 0 {
		t.Fatal("presentation cancelled work")
	}
	r, err = s.RequestCancellation(r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if r.Task.State != "starting" || r.Task.Cancellation != "requested" || called != 1 {
		t.Fatalf("false cancellation outcome: %+v", r.Task)
	}
	r, err = s.FinishOwnedTask("native:alpha", sdk.FinishTaskRequest{ID: r.ID, State: "succeeded"})
	if err != nil {
		t.Fatal(err)
	}
	if !r.Visibility.Collapsed || !r.Visibility.ToastDismissed || !r.Visibility.Read {
		t.Fatal("terminal update reset presentation")
	}
	if r.Task.State != "succeeded" {
		t.Fatal("cancel request replaced real outcome")
	}
}

func TestAlertFreshnessAndRestartGeneration(t *testing.T) {
	s, root := testService(t)
	ctx := context.Background()
	p := s.Reporter("alpha", "one")
	at := time.Now().UTC()
	req := sdk.AlertRequest{
		Spec: taskSpec("pressure"), Key: "connection/resource/rule/dimension",
		ObservedAt: at.Format(time.RFC3339Nano),
	}
	r, err := p.UpsertAlert(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	stale := sdk.ResolveAlertRequest{Key: req.Key, ObservedAt: at.Add(-time.Second).Format(time.RFC3339Nano)}
	r, err = p.ResolveAlert(ctx, stale)
	if err != nil {
		t.Fatal(err)
	}
	if r.Alert.State != "firing" || r.Alert.Occurrences != 1 {
		t.Fatal("stale recovery changed alert")
	}
	restarted, err := NewService(root, nil)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Snapshot().Records[0].Alert.State != "unknown" {
		t.Fatal("restart retained false live observation")
	}
	p2 := restarted.Reporter("alpha", "two")
	req.ObservedAt = at.Add(time.Second).Format(time.RFC3339Nano)
	r2, err := p2.UpsertAlert(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if r2.ID != r.ID || r2.Alert.Occurrences != 2 {
		t.Fatal("generation change duplicated alert")
	}
	r2, err = p2.ResolveAlert(ctx, sdk.ResolveAlertRequest{
		Key: req.Key, ObservedAt: at.Add(2 * time.Second).Format(time.RFC3339Nano),
	})
	if err != nil || r2.Alert.State != "resolved" {
		t.Fatal("fresh recovery did not resolve", err)
	}
}

func TestSubscriptionAttachAndRevision(t *testing.T) {
	s, _ := testService(t)
	var changes []sdk.Change
	s.emit = func(_ string, c sdk.Change) {
		changes = append(changes, c)
	}
	sub, err := s.Subscribe("view")
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.BeginOwnedTask("native:alpha", taskSpec("work"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 0 {
		t.Fatal("unattached subscription emitted")
	}
	snapshot, err := s.Attach("view", sub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Revision <= sub.Snapshot.Revision || len(snapshot.Records) != 1 {
		t.Fatal("attach missed pre-listener update")
	}
	r, err = s.ReportOwnedTask("native:alpha", sdk.ReportTaskRequest{
		ID: r.ID, Presentation: taskSpec("updated").Presentation,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || changes[0].Revision <= snapshot.Revision || changes[0].Record.Revision != r.Revision {
		t.Fatal("revision not monotonic")
	}
	if err = s.Unsubscribe("view", sub.ID); err != nil {
		t.Fatal(err)
	}
	if !active(s.Snapshot().Records[0]) {
		t.Fatal("unsubscribe ended producer")
	}
}

func TestRestartAndBoundedTerminalRetention(t *testing.T) {
	s, root := testService(t)
	activeTask, err := s.BeginOwnedTask("native:alpha", taskSpec("active"), nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := range historyLimit + 3 {
		if _, err = s.publishMessage("ui", taskSpec(fmt.Sprint(i))); err != nil {
			t.Fatal(err)
		}
	}
	snapshot := s.Snapshot()
	if len(snapshot.Records) != historyLimit+1 {
		t.Fatalf("history unbounded: %d", len(snapshot.Records))
	}
	if err = s.ClearHistory(); err != nil {
		t.Fatal(err)
	}
	snapshot = s.Snapshot()
	if len(snapshot.Records) != 1 || snapshot.Records[0].ID != activeTask.ID {
		t.Fatal("clear removed active work")
	}
	restarted, err := NewService(root, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := restarted.Snapshot().Records[0]
	if r.Task.State != "unknown" || r.Task.UnknownReason != "host-restarted" {
		t.Fatal("restart claimed work continued")
	}
}

func TestFailedCommitDoesNotPublishOrChangeTask(t *testing.T) {
	s, root := testService(t)
	r, err := s.BeginOwnedTask("native:alpha", taskSpec("work"), nil)
	if err != nil {
		t.Fatal(err)
	}
	before := s.Snapshot()
	sub, err := s.Subscribe("view")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Attach("view", sub.ID); err != nil {
		t.Fatal(err)
	}
	emitted := false
	s.emit = func(_ string, _ sdk.Change) {
		emitted = true
	}
	if err = root.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = s.FinishOwnedTask("native:alpha", sdk.FinishTaskRequest{ID: r.ID, State: "succeeded"}); err == nil {
		t.Fatal("closed store accepted commit")
	}
	after := s.Snapshot()
	if emitted || after.Revision != before.Revision || after.Records[0].Task.State != "starting" {
		t.Fatal("failed persistence leaked observation")
	}
}

func TestFailedClearHistoryDoesNotPublishOrRemoveRecords(t *testing.T) {
	s, root := testService(t)
	if _, err := s.publishMessage("ui", taskSpec("history")); err != nil {
		t.Fatal(err)
	}
	before := s.Snapshot()
	sub, err := s.Subscribe("view")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Attach("view", sub.ID); err != nil {
		t.Fatal(err)
	}
	emitted := false
	s.emit = func(_ string, _ sdk.Change) {
		emitted = true
	}
	if err = root.Close(); err != nil {
		t.Fatal(err)
	}
	if err = s.ClearHistory(); err == nil {
		t.Fatal("closed store accepted history clear")
	}
	after := s.Snapshot()
	if emitted || after.Revision != before.Revision || len(after.Records) != len(before.Records) {
		t.Fatal("failed history clear leaked observation")
	}
	if after.Records[0].ID != before.Records[0].ID {
		t.Fatal("failed history clear replaced record")
	}
}
