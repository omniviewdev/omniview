package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/opener"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/ownservers"
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

// The application server is where Wails binds it: WAILS_SERVER_HOST and WAILS_SERVER_PORT override the configured host and port (the e2e harness and the
// docs run on 34215), and a port that is not one is ignored as Wails ignores it.
func TestTheApplicationServerIsWhereWailsBindsIt(t *testing.T) {
	t.Setenv("WAILS_SERVER_HOST", "") // what the environment holds is not the test's
	t.Setenv("WAILS_SERVER_PORT", "")
	assert.Equal(t, "localhost:34115", wailsServerAddress(), "the control: the configured address")
	t.Setenv("WAILS_SERVER_PORT", "34215")
	assert.Equal(t, "localhost:34215", wailsServerAddress())
	t.Setenv("WAILS_SERVER_HOST", "0.0.0.0")
	assert.Equal(t, "0.0.0.0:34215", wailsServerAddress())
	t.Setenv("WAILS_SERVER_PORT", "70000")
	assert.Equal(t, "0.0.0.0:34115", wailsServerAddress(), "a port out of range is ignored")
	t.Setenv("WAILS_SERVER_PORT", "abc")
	assert.Equal(t, "0.0.0.0:34115", wailsServerAddress())

	t.Setenv("WAILS_SERVER_HOST", "")
	t.Setenv("WAILS_SERVER_PORT", "34215")
	if serverBuild {
		service := NewAppService(devcontract.InstanceDescriptor{})
		service.setOwnServers(func() []string { return hostServers() })
		got, err := service.OpenExternalURL("http://127.0.0.1:34215/")
		require.NoError(t, err)
		assert.Equal(t, opener.Result{Opened: false, Reason: opener.ReasonOwnServer}, got)
	}
}

// Wails listens on the application server's address in the server build only: in the native build a user's service on that port is not the host's.
func TestTheApplicationServerIsAnOwnServerInTheServerBuildOnly(t *testing.T) {
	t.Setenv("WAILS_SERVER_HOST", "")
	t.Setenv("WAILS_SERVER_PORT", "")
	if serverBuild {
		assert.Contains(t, hostServers(), "localhost:34115")
		return
	}
	assert.NotContains(t, hostServers(), "localhost:34115")
	assert.NotContains(t, hostServers(), wailsServerAddress())
}

func TestEveryListenerThatRegisteredItselfIsAnOwnServer(t *testing.T) {
	remove := ownservers.Add("127.0.0.1:45671")
	servers := hostServers(func() []string { return []string{"127.0.0.1:45672"} })
	assert.Contains(t, servers, "127.0.0.1:45671")
	assert.Contains(t, servers, "127.0.0.1:45672")
	remove()
	assert.NotContains(t, hostServers(), "127.0.0.1:45671")
}

// The Vite servers of the dev instances, the diagnostics endpoint and the host profiler are own servers through the one wiring main uses.
func TestTheWiringOfTheSourcesNamesTheViteServersTheDiagnosticsAndTheProfiler(t *testing.T) {
	sources := ownServerSources(func() string { return "127.0.0.1:45001" }, func() string { return "127.0.0.1:45002" }, func() []string { return []string{"127.0.0.1:45003"} })
	service := NewAppService(devcontract.InstanceDescriptor{})
	service.setOwnServers(func() []string { return hostServers(sources) })
	for _, raw := range []string{"http://localhost:45001/", "http://localhost:45002/", "http://[::1]:45003/"} {
		got, err := service.OpenExternalURL(raw)
		require.NoError(t, err)
		assert.Equal(t, opener.Result{Opened: false, Reason: opener.ReasonOwnServer}, got, raw)
	}
	assert.Equal(t, []string{"127.0.0.1:45001", "127.0.0.1:45002", "127.0.0.1:45003"}, sources())
}

// The profiler is listed while it runs, from its status, and a failed or disabled one is not.
func TestTheProfilerIsListedOnlyWhileItRuns(t *testing.T) {
	assert.Equal(t, "127.0.0.1:6060", profilerAddress(true, "127.0.0.1:6060"))
	assert.Empty(t, profilerAddress(false, "127.0.0.1:6060"), "a stopped profiler keeps no address")
	assert.Empty(t, profilerAddress(true, ""))
}
