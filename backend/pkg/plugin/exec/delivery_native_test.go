//go:build !server && !windows

package exec

import (
	"encoding/json"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// virtualWindow says the Wails transport the transport model stands for serializes every event once more,
// for a window a server build keeps. A native build has no such serialization before the clients'.
const virtualWindow = false

// In a native build the first serialization is delivery: the window's, made just before it hands the event
// to the web view.
func TestInANativeBuildTheFirstSerializationIsDelivery(t *testing.T) {
	var reports atomic.Int32
	out := &terminalOutput{data: []byte("x"), delivered: func() { reports.Add(1) }}
	_, err := json.Marshal(&wireEvent{Name: "n", Data: out})
	require.NoError(t, err)
	assert.Equal(t, int32(1), reports.Load())
}
