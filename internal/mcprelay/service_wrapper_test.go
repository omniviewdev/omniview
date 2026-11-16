package mcprelay

import (
	"encoding/json"
	"fmt"
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

func TestRevealTokenReturnsTheCurrentToken(t *testing.T) {
	h := newHarness(t)
	h.relay.mu.Lock()
	token := h.relay.cfg.Token
	h.relay.mu.Unlock()

	require.Equal(t, token, h.service.RevealToken())

	require.NoError(t, h.service.RotateToken())
	rotated := h.service.RevealToken()
	require.NotEmpty(t, rotated)
	require.NotEqual(t, token, rotated)
}

func TestCopyClientSetupPutsTheSetupOnTheClipboard(t *testing.T) {
	h := newHarness(t)
	token := h.service.RevealToken()
	var copied []string
	h.relay.clipboard = func(text string) bool {
		copied = append(copied, text)
		return true
	}
	copyOf := func(kind string) string {
		t.Helper()
		copied = nil
		require.NoError(t, h.service.CopyClientSetup(kind), kind)
		require.Len(t, copied, 1, kind)
		return copied[0]
	}

	require.Equal(t, token, copyOf(ClientSetupToken))
	require.Equal(t,
		fmt.Sprintf(`claude mcp add --transport http omniview %s --header "Authorization: Bearer %s"`, h.url, token),
		copyOf(ClientSetupClaude))
	require.Equal(t, fmt.Sprintf(`{
  "mcpServers": {
    "omniview": {
      "type": "http",
      "url": "%s",
      "headers": {
        "Authorization": "Bearer %s"
      }
    }
  }
}`, h.url, token), copyOf(ClientSetupJSON))

	// The copied document is valid JSON a client can read as it is.
	var document map[string]map[string]map[string]any
	require.NoError(t, json.Unmarshal([]byte(copyOf(ClientSetupJSON)), &document))
	require.Equal(t, h.url, document["mcpServers"]["omniview"]["url"])

	// A rotated token is what is copied next.
	require.NoError(t, h.service.RotateToken())
	rotated := copyOf(ClientSetupToken)
	require.Equal(t, h.service.RevealToken(), rotated)
	require.NotEqual(t, token, rotated)
}

func TestCopyClientSetupRefusesWhatItCannotCopy(t *testing.T) {
	h := newHarness(t)
	var copied []string
	h.relay.clipboard = func(text string) bool {
		copied = append(copied, text)
		return true
	}

	require.ErrorContains(t, h.service.CopyClientSetup("everything"), `unknown client setup "everything"`)
	require.Empty(t, copied)

	h.relay.clipboard = func(string) bool { return false }
	require.ErrorContains(t, h.service.CopyClientSetup(ClientSetupToken), "clipboard")

	// With no application the Wails clipboard is not there either.
	h.relay.clipboard = nil
	require.ErrorContains(t, h.service.CopyClientSetup(ClientSetupToken), "clipboard")

	// Before the document is loaded there is no token to copy.
	h.relay.clipboard = func(text string) bool {
		copied = append(copied, text)
		return true
	}
	h.relay.mu.Lock()
	h.relay.loaded = false
	h.relay.mu.Unlock()
	require.ErrorContains(t, h.service.CopyClientSetup(ClientSetupToken), "not initialised")
	require.Empty(t, copied)
}
