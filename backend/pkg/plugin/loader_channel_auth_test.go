package plugin

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// TestCreateBackendEnablesChannelAuthentication holds one guarantee: a plugin
// launched through createBackend is handed the host's AutoMTLS certificate in
// PLUGIN_CLIENT_CERT, and go-plugin's server serves TLS only when that
// variable is set. The launched process's environment is the observable proof
// of the channel configuration; no production seam is needed. The channel
// itself is inspected in loader_channel_mtls_test.go.
func TestCreateBackendEnablesChannelAuthentication(t *testing.T) {
	pm := newTestManager(t)
	root := channelWrapperFor(t, "TestActivityBrokerChildProcess", `if [ -n "$PLUGIN_CLIENT_CERT" ]; then
  printf 'set' > "$CHANNEL_TEST_ENV_FILE"
else
  printf 'unset' > "$CHANNEL_TEST_ENV_FILE"
fi`)
	file := filepath.Join(t.TempDir(), "environment")
	t.Setenv("CHANNEL_TEST_ENV_FILE", file)
	t.Setenv(activityBrokerChildEnv, "normal")

	backend, err := pm.createBackend("activity-broker-test", config.PluginMeta{ID: "activity-broker-test"}, root)
	require.NoError(t, err)
	defer backend.Kill()

	data, err := os.ReadFile(file)
	require.NoError(t, err)
	if got := strings.TrimSpace(string(data)); got != "set" {
		t.Errorf("plugin launched by createBackend got PLUGIN_CLIENT_CERT %s: "+
			"the host-plugin channel has no AutoMTLS (loader.go goplugin.ClientConfig)", got)
	}
}
