package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/opener"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

// The bound call refuses the host's own server, as the opener does: the service passes the servers it was told of, and nothing is started for a refusal.
func TestTheBoundOpenerRefusesTheHostsOwnServersAndTheOtherSchemes(t *testing.T) {
	service := NewAppService(devcontract.InstanceDescriptor{})
	service.setOwnServers(func() []string { return []string{"localhost:34115", "", "127.0.0.1:41111"} })
	for raw, reason := range map[string]opener.Reason{
		"http://127.1:34115/":    opener.ReasonOwnServer,
		"http://localhost:41111": opener.ReasonOwnServer,
		"vscode://file/x":        opener.ReasonScheme,
		"https://u@a.example/":   opener.ReasonUserinfo,
	} {
		got, err := service.OpenExternalURL(raw)
		require.NoError(t, err)
		assert.Equal(t, opener.Result{Opened: false, Reason: reason}, got, raw)
	}
}
