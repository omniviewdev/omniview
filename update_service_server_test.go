//go:build server

package main

import "testing"

func TestServerBuildRefusesUpdates(t *testing.T) {
	want := "Updates are managed by the server that hosts this Omniview instance."
	if reason := buildUnsupportedReason(); reason != want {
		t.Fatalf("buildUnsupportedReason() = %q, want %q", reason, want)
	}
}
