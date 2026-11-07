package activity

import (
	"context"
	"testing"
	"time"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestReporterRejectsMismatchedSourceConnection(t *testing.T) {
	for _, connection := range []string{"", "different-connection"} {
		t.Run("source-"+connection, func(t *testing.T) {
			s, root := testService(t)
			reporter := s.Reporter("alpha", "generation")
			spec := taskSpec("resource observation")
			spec.Source = &sdk.Source{
				PluginID: "alpha", ConnectionID: connection,
				Resource: &resourcev2.ResourceNavigationIntent{
					PluginID: "alpha", TargetID: "target", Representation: "default",
					Route: resourcev2.AccessRoute{Connection: "resource-connection"},
					Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
						Provider: "alpha", Authority: "authority", Type: "resource", ID: "object",
					}},
				},
			}
			ctx := context.Background()
			if _, err := reporter.BeginTask(ctx, spec); err == nil {
				t.Fatal("task accepted a mismatched source connection")
			}
			if _, err := reporter.PublishMessage(ctx, spec); err == nil {
				t.Fatal("message accepted a mismatched source connection")
			}
			if _, err := reporter.UpsertAlert(ctx, sdk.AlertRequest{
				Spec: spec, Key: "rule", ObservedAt: time.Now().UTC().Format(time.RFC3339Nano),
			}); err == nil {
				t.Fatal("alert accepted a mismatched source connection")
			}
			if snapshot := s.Snapshot(); snapshot.Revision != 0 || len(snapshot.Records) != 0 {
				t.Fatalf("rejected observations mutated state: %+v", snapshot)
			}
			reloaded, err := NewService(root, nil)
			if err != nil {
				t.Fatalf("rejected observation poisoned persisted state: %v", err)
			}
			if len(reloaded.Snapshot().Records) != 0 {
				t.Fatal("rejected observation persisted a record")
			}
			spec.Source.ConnectionID = spec.Source.Resource.Route.Connection
			if _, err := reporter.PublishMessage(ctx, spec); err != nil {
				t.Fatalf("valid source connection was rejected: %v", err)
			}
		})
	}
}

func TestUICapabilitiesCannotMutateEachOthersAlerts(t *testing.T) {
	s, _ := testService(t)
	firstOwner := "ui:11111111111111111111111111111111"
	secondOwner := "ui:22222222222222222222222222222222"
	for _, owner := range []string{firstOwner, secondOwner} {
		if err := s.ActivateProducer(owner); err != nil {
			t.Fatal(err)
		}
	}
	at := time.Now().UTC()
	req := sdk.AlertRequest{Spec: taskSpec("first alert"), Key: "shared-rule", ObservedAt: at.Format(time.RFC3339Nano)}
	first, err := s.upsertAlert(firstOwner, req)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.resolveAlert(secondOwner, sdk.ResolveAlertRequest{
		Key: req.Key, ObservedAt: at.Add(time.Second).Format(time.RFC3339Nano),
	}); err == nil {
		t.Fatal("second capability resolved first capability's alert")
	}
	req.Presentation.Title = "second alert"
	req.ObservedAt = at.Add(2 * time.Second).Format(time.RFC3339Nano)
	second, err := s.upsertAlert(secondOwner, req)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID {
		t.Fatal("second capability updated first capability's alert")
	}
	if _, err = s.resolveAlert(secondOwner, sdk.ResolveAlertRequest{
		Key: req.Key, ObservedAt: at.Add(3 * time.Second).Format(time.RFC3339Nano),
	}); err != nil {
		t.Fatal(err)
	}
	if err = s.retire(secondOwner, "producer-lost"); err != nil {
		t.Fatal(err)
	}
	for _, record := range s.Snapshot().Records {
		if record.ID == first.ID {
			if record.Alert.State != "firing" || record.Alert.Occurrences != 1 || record.Presentation.Title != "first alert" {
				t.Fatalf("cross-capability operation mutated first alert: %+v", record)
			}
			return
		}
	}
	t.Fatal("first capability's alert disappeared")
}

func TestInvalidNativeOwnerCannotPoisonHistory(t *testing.T) {
	service, root := testService(t)
	for _, owner := range []string{"native:", "native:invalid/plugin"} {
		if _, err := service.BeginOwnedTask(owner, taskSpec("invalid source"), nil); err == nil {
			t.Fatal("invalid native producer admitted", owner)
		}
	}
	if snapshot := service.Snapshot(); snapshot.Revision != 0 || len(snapshot.Records) != 0 {
		t.Fatal("invalid native identity persisted a record")
	}
	if _, err := NewService(root, nil); err != nil {
		t.Fatal("rejected native identity poisoned startup", err)
	}
}
