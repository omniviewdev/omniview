package main

import (
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestInstanceServicePublishesDetachedLiveDescriptor(t *testing.T) {
	initial := devcontract.InstanceDescriptor{InstanceID: "stable", Readiness: "starting"}
	service := NewAppService(initial)
	endpoint := "http://127.0.0.1:23456"
	current := initial
	current.Readiness = "ready"
	current.Endpoints.Control = &endpoint
	service.updateInstanceInfo(current)
	current.Readiness = "foreign"
	got := service.GetInstanceInfo()
	if got.Readiness != "ready" || got.Endpoints.Control == nil || *got.Endpoints.Control != endpoint {
		t.Fatalf("descriptor did not publish ready endpoint: %+v", got)
	}
	*got.Endpoints.Control = "foreign"
	if *service.GetInstanceInfo().Endpoints.Control != endpoint {
		t.Fatal("caller mutated retained descriptor")
	}
}
