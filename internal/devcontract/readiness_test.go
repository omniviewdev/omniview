package devcontract

import "testing"

func TestFailedReadinessStage(t *testing.T) {
	for _, test := range []struct {
		name                          string
		build, vite, rpc, controllers string
		want                          string
	}{
		{name: "backend only", build: "ready", vite: "n/a", rpc: "ready", controllers: "ready"},
		{name: "frontend only", build: "n/a", vite: "ready", rpc: "n/a", controllers: "n/a"},
		{name: "pending", build: "building", vite: "starting", rpc: "pending", controllers: "pending"},
		{name: "stopped", build: "stopped", vite: "stopped", rpc: "stopped", controllers: "stopped"},
		{name: "build", build: "error", want: "build"},
		{name: "vite", vite: "error", want: "Vite"},
		{name: "rpc", rpc: "error", want: "RPC"},
		{name: "controllers", controllers: "error", want: "controllers"},
		{name: "stable failure precedence", build: "error", vite: "error", rpc: "error", controllers: "error", want: "build"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := FailedReadinessStage(test.build, test.vite, test.rpc, test.controllers); got != test.want {
				t.Fatalf("failed stage = %q, want %q", got, test.want)
			}
		})
	}
}
