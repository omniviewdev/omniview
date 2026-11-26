//go:build !server

package main

import "testing"

func TestNativeBuildSupportsUpdates(t *testing.T) {
	if reason := buildUnsupportedReason(); reason != "" {
		t.Fatalf("buildUnsupportedReason() = %q", reason)
	}
}
