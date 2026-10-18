//go:build !server

package main

import (
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
)

func TestDevelopmentServerRequestPolicyNativeUnchanged(t *testing.T) {
	for _, kind := range []string{"development", "production", ""} {
		if middleware := developmentServerMiddleware(instance.Profile{Descriptor: devcontract.InstanceDescriptor{Kind: kind}}); middleware != nil {
			t.Fatalf("native profile kind %q unexpectedly acquired HTTP server request policy", kind)
		}
	}
}
