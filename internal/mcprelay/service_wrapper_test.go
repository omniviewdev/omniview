package mcprelay

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
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

func TestCopyClientSetupPutsTheSetupOnTheClipboard(t *testing.T) {
	h := newHarness(t)
	token := relayToken(h.relay)
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
	require.Equal(t, relayToken(h.relay), rotated)
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

// relayToken reads the bearer token from the relay itself. No bound method
// returns it, so tests that need it go around the service.
func relayToken(r *Relay) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cfg.Token
}

// wireOf is what JavaScript receives for one result of a bound method: the
// text of an error, or the JSON of anything else.
func wireOf(t *testing.T, result reflect.Value) string {
	t.Helper()
	if err, ok := result.Interface().(error); ok {
		return err.Error()
	}
	wire, err := json.Marshal(result.Interface())
	require.NoError(t, err)
	return string(wire)
}

// Wails sends every result of a bound method, and the text of every error, to
// JavaScript, and any script in the window can call any bound method. The
// bearer token is the relay's only credential, so no bound method may return
// it: the settings page shows a mask and asks Go to copy it.
//
// This walks the whole bound surface of the service (every exported method of
// *ServiceWrapper except the two lifecycle hooks Wails never binds), calls each
// method with zero arguments on a relay with a known token, and fails when the
// results or the error text carry the token. A method added later is covered
// without being listed here.
func TestNoBoundMethodReturnsTheBearerToken(t *testing.T) {
	service := reflect.TypeFor[*ServiceWrapper]()
	for i := range service.NumMethod() {
		method := service.Method(i)
		if method.Name == "ServiceStartup" || method.Name == "ServiceShutdown" {
			continue
		}
		t.Run(method.Name, func(t *testing.T) {
			h := newHarness(t)
			before := relayToken(h.relay)
			require.NotEmpty(t, before)

			arguments := []reflect.Value{reflect.ValueOf(h.service)}
			for in := 1; in < method.Type.NumIn(); in++ { // 0 is the receiver
				arguments = append(arguments, reflect.Zero(method.Type.In(in)))
			}
			var wire strings.Builder
			for _, result := range method.Func.Call(arguments) {
				wire.WriteString(wireOf(t, result))
				wire.WriteByte('\n')
			}

			// RotateToken replaces the token, so neither the old nor the new one may appear.
			for _, token := range []string{before, relayToken(h.relay)} {
				require.NotContains(t, wire.String(), token, "%s hands the bearer token to JavaScript", method.Name)
			}
		})
	}
}
