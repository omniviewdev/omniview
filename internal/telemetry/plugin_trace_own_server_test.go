package telemetry

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/ownservers"
)

// A plugin's trace receiver is a server of the host: its address is one the host's URL opener refuses while it listens, and not after.
func TestAPluginTraceReceiverIsAnOwnServerWhileItListens(t *testing.T) {
	svc := New(Config{Enabled: true, Traces: true, OTLPEndpoint: "http://127.0.0.1:1"}, "", "", "", false, t.TempDir())
	endpoint, _, cleanup, err := svc.StartPluginTraceReceiver("kubernetes")
	require.NoError(t, err)
	address := strings.TrimSuffix(strings.TrimPrefix(endpoint, "http://"), "/v1/traces")
	assert.Contains(t, ownservers.Addresses(), address)
	cleanup()
	assert.NotContains(t, ownservers.Addresses(), address)
}
