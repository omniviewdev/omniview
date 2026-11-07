package activity

import (
	"context"
	"fmt"
	"testing"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
)

func TestTaskAdmissionBoundReleasesAfterOutcome(t *testing.T) {
	service, _ := testService(t)
	firstID := ""
	for range maxActiveTasksPerProducer {
		record, err := service.BeginOwnedTask("native:alpha", taskSpec("work"), nil)
		if err != nil {
			t.Fatal(err)
		}
		if firstID == "" {
			firstID = record.ID
		}
	}
	if _, err := service.BeginOwnedTask("native:alpha", taskSpec("overflow"), nil); err == nil {
		t.Fatal("producer exceeded active task limit")
	}
	if _, err := service.FinishOwnedTask("native:alpha", sdk.FinishTaskRequest{ID: firstID, State: "succeeded"}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.BeginOwnedTask("native:alpha", taskSpec("new work"), nil); err != nil {
		t.Fatal("real outcome did not release admission", err)
	}
}

func TestSubscriptionAdmissionAndViewCleanup(t *testing.T) {
	service, _ := testService(t)
	for range maxSubscriptionsPerOwner {
		if _, err := service.Subscribe("view"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.Subscribe("view"); err == nil {
		t.Fatal("view exceeded subscription limit")
	}
	service.DropSubscriptions("view")
	if _, err := service.Subscribe("view"); err != nil {
		t.Fatal("view cleanup did not release admission", err)
	}
}

func TestRetirementReleasesProducerAdmissionWithoutReauthorizingOldReporter(t *testing.T) {
	service, _ := testService(t)
	ctx := context.Background()
	old := service.Reporter("alpha", "old")
	if err := service.RetireProducer("alpha", "old"); err != nil {
		t.Fatal(err)
	}
	for i := range maxProducerOwners * 2 {
		generation := fmt.Sprint(i)
		service.Reporter("alpha", generation)
		if err := service.RetireProducer("alpha", generation); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := old.BeginTask(ctx, taskSpec("late replay")); err == nil {
		t.Fatal("retired producer became authorized after cleanup")
	}
	current := service.Reporter("alpha", "current")
	if _, err := current.BeginTask(ctx, taskSpec("current work")); err != nil {
		t.Fatal("retirement leaked producer admission", err)
	}
}
