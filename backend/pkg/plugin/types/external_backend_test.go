package types

import (
	"testing"

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
