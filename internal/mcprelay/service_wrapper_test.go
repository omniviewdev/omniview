package mcprelay

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

// GetConfig is bound to every page of the window, plugin code included, and
// Wails sends its result to JavaScript as JSON. The bearer token is the relay's
// only credential, so no field of that result may carry it.
func TestGetConfigDoesNotHandTheBearerTokenToJavaScript(t *testing.T) {
	h := newHarness(t)
	h.relay.mu.Lock()
	token := h.relay.cfg.Token
	h.relay.mu.Unlock()
	require.NotEmpty(t, token)

	view := h.service.GetConfig()
	wire, err := json.Marshal(view)
	require.NoError(t, err)
	require.NotContains(t, string(wire), token)

	// The rest of the settings page still gets what it renders.
	require.True(t, view.Enabled)
	require.Equal(t, h.url, view.Endpoint)
}
