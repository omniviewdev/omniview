package plugin

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// Defect (plan item H2, host-plugin channel protection, host side):
// createBackend (loader.go) builds goplugin.ClientConfig without AutoMTLS, so
// go-plugin starts the plugin with no client certificate and the host-plugin
// gRPC channel (a Unix socket, or loopback TCP on Windows) is unauthenticated
// plaintext: any local process that can connect to the socket is accepted as
// the host. go-plugin signals AutoMTLS to the child through the
// PLUGIN_CLIENT_CERT environment variable, so the launched process's
// environment is the observable proof of the channel configuration; no
// production seam is needed.
//
// Fixed looks like: a plugin launched through createBackend is handed
// PLUGIN_CLIENT_CERT (the host's AutoMTLS client certificate), and the plugin
// side (plugin.Serve in the SDK) picks it up from the environment and serves
// over TLS.
func TestCreateBackendEnablesChannelAuthentication(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses a Unix executable wrapper")
	}
	pm := newTestManager(t)
	binary, err := os.Executable()
	require.NoError(t, err)
	root := t.TempDir()
	require.NoError(t, os.Mkdir(filepath.Join(root, "bin"), 0700))
	wrapper := `#!/bin/sh
if [ -n "$PLUGIN_CLIENT_CERT" ]; then
  printf 'set' > "$CHANNEL_TEST_ENV_FILE"
else
  printf 'unset' > "$CHANNEL_TEST_ENV_FILE"
fi
exec "$CHANNEL_TEST_BINARY" -test.run='^TestActivityBrokerChildProcess$'
`
	require.NoError(t, os.WriteFile(filepath.Join(root, "bin", "plugin"), []byte(wrapper), 0700))
	file := filepath.Join(t.TempDir(), "environment")
	t.Setenv("CHANNEL_TEST_ENV_FILE", file)
	t.Setenv("CHANNEL_TEST_BINARY", binary)
	t.Setenv(activityBrokerChildEnv, "normal")

	backend, err := pm.createBackend("activity-broker-test", config.PluginMeta{ID: "activity-broker-test"}, root)
	require.NoError(t, err)
	defer backend.Kill()

	data, err := os.ReadFile(file)
	require.NoError(t, err)
	if got := strings.TrimSpace(string(data)); got != "set" {
		t.Errorf("H2: plugin launched by createBackend got PLUGIN_CLIENT_CERT %s: "+
			"the host-plugin channel has no AutoMTLS (loader.go goplugin.ClientConfig)", got)
	}
}
