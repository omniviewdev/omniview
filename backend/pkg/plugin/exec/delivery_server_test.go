//go:build server && !windows

package exec

import (
	"encoding/json"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// virtualWindow says the Wails transport the transport model stands for serializes every event once more,
// for the window a server build keeps, before any client's worker does.
const virtualWindow = true

// In a server build the serialization for the window is not delivery and the one that writes a client's
// socket is: the real-host run showed a credit given at the window's, which made the bound no bound.
func TestInAServerBuildOnlyTheSocketWritersSerializationIsDelivery(t *testing.T) {
	var reports atomic.Int32
	out := &terminalOutput{data: []byte("x"), delivered: func() { reports.Add(1) }}
	_, err := json.Marshal(&wireEvent{Name: "n", Data: out}) // Event.ToJSON, for the window
	require.NoError(t, err)
	assert.Zero(t, reports.Load(), "the window's serialization is not delivery")
	require.NoError(t, json.NewEncoder(discard{}).Encode(&wireEvent{Name: "n", Data: out})) // the client's worker
	assert.Equal(t, int32(1), reports.Load(), "the socket writer's is")
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }
