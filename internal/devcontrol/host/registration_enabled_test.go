//go:build devcontrol

package host

import (
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
)

func TestRuntimeReadyPublishesLatestSnapshotWithoutInventingEndpoints(t *testing.T) {
	for _, readiness := range []string{"starting", "backend-ready"} {
		t.Run(readiness, func(t *testing.T) {
			snapshot := devcontract.InstanceDescriptor{SchemaVersion: 1, WorkspaceID: "workspace-a", InstanceID: "instance-a", Generation: "generation-a", Kind: "development", DisplayName: "A", Readiness: readiness}
			publications := 0
			service := &developmentControlLifecycle{
				readSnapshot: func() devcontract.InstanceDescriptor {
					return instance.Snapshot(snapshot)
				},
				publishSnapshot: func(descriptor devcontract.InstanceDescriptor) {
					publications++
					snapshot = instance.Snapshot(descriptor)
				},
			}
			// The publisher may have newer state than lifecycle construction.
			control := "http://127.0.0.1:12345/v1/control"
			snapshot.Endpoints.Control = &control
			snapshot.DisplayName = "Renamed A"
			service.markRuntimeReady()
			if !service.runtimeReady || snapshot.Readiness != "host-ready" || publications != 1 {
				t.Fatalf("runtime readiness was not published: ready=%v snapshot=%+v publications=%d", service.runtimeReady, snapshot, publications)
			}
			if snapshot.WorkspaceID != "workspace-a" || snapshot.InstanceID != "instance-a" || snapshot.Generation != "generation-a" || snapshot.DisplayName != "Renamed A" {
				t.Fatalf("runtime readiness replaced the current identity: %+v", snapshot)
			}
			if snapshot.Endpoints.Control == nil || *snapshot.Endpoints.Control != control || snapshot.Endpoints.Browser != nil || snapshot.Endpoints.MCP != nil || snapshot.Endpoints.Vite != nil || snapshot.Endpoints.HMR != nil {
				t.Fatalf("runtime readiness changed observed endpoints: %+v", snapshot.Endpoints)
			}
		})
	}
}
