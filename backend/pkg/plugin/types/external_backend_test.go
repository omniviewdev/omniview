package types

import (
	"testing"

	"github.com/omniviewdev/omniview/internal/devsession"

	goplugin "github.com/hashicorp/go-plugin"
)

func TestExternalBackendOwnsSnapshotCleanupUntilStopped(t *testing.T) {
	// No process is started: this exercises the actual go-plugin no-runner
	// lifecycle and idempotent cleanup without launching an app/plugin fixture.
	client := goplugin.NewClient(&goplugin.ClientConfig{})
	backend := NewExternalBackend(client, nil)
	calls := 0
	backend.SetProcessCleanup(func() { calls++ })
	if calls != 0 {
		t.Fatal("cleanup ran before backend was stopped")
	}
	backend.Kill()
	backend.Kill()
	if calls != 1 {
		t.Fatalf("cleanup called %d times, want once", calls)
	}
}

func TestExternalBackendDiagnosticFailureDoesNotFailConstructionOrCleanUp(t *testing.T) {
	backend := NewExternalBackend(goplugin.NewClient(&goplugin.ClientConfig{}), nil)
	calls := 0
	backend.SetProcessCleanup(func() { calls++ })
	identity, err := backend.ProcessObservation()
	if err == nil || identity.PID != 0 {
		t.Fatalf("unstarted backend returned identity %+v, error %v", identity, err)
	}
	backend.ProcessExited()
	if calls != 0 {
		t.Fatal("diagnostic liveness check invoked lifecycle cleanup")
	}
}

func TestExternalBackendObservationReturnsImmutableCopy(t *testing.T) {
	want := devsession.ProcessObservation{PID: 123, StartIdentity: "launch-start", Executable: "/plugin"}
	backend := &ExternalBackend{observation: want}
	first, err := backend.ProcessObservation()
	if err != nil {
		t.Fatal(err)
	}
	first.StartIdentity = "replacement-start"
	second, err := backend.ProcessObservation()
	if err != nil || second != want {
		t.Fatalf("launch observation changed: %+v, error %v", second, err)
	}
}
