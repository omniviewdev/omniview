//go:build !windows

package exec

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// probe is a payload that asks, when it is serialized, whether the serialization is a client socket's.
type probe struct {
	socket atomic.Int32
	other  atomic.Int32
}

func (p *probe) MarshalJSON() ([]byte, error) {
	if serializedForAClientSocket() {
		p.socket.Add(1)
	} else {
		p.other.Add(1)
	}
	return []byte(`"p"`), nil
}

// What Wails' server mode does with an event, with the library it uses: the worker of a client writes it
// with wsjson.Write, and the dispatch worker serializes it with json.Marshal for the window the server
// keeps. Only the first is a client socket's.
func TestTheSerializationThatWritesAClientSocketIsTheOneThatIsRecognized(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	viaMarshal := &probe{}
	_, err := json.Marshal(&wireEvent{Name: "n", Data: viaMarshal})
	require.NoError(t, err)
	assert.Zero(t, viaMarshal.socket.Load(), "Event.ToJSON is json.Marshal: it is not a client's socket")
	assert.Equal(t, int32(1), viaMarshal.other.Load())

	viaEncoder := &probe{}
	require.NoError(t, json.NewEncoder(&bytes.Buffer{}).Encode(&wireEvent{Name: "n", Data: viaEncoder}))
	assert.Equal(t, int32(1), viaEncoder.socket.Load(), "an encoder writing to a writer is what a socket writer is")

	viaSocket := &probe{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, acceptErr := websocket.Accept(w, r, nil)
		if acceptErr != nil {
			return
		}
		defer func() { _ = conn.CloseNow() }()
		if writeErr := wsjson.Write(r.Context(), conn, &wireEvent{Name: "n", Data: viaSocket}); writeErr != nil {
			t.Errorf("write: %v", writeErr)
		}
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}))
	defer server.Close()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	require.NoError(t, err)
	defer func() { _ = conn.CloseNow() }()
	var got struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}
	require.NoError(t, wsjson.Read(ctx, conn, &got))
	assert.Equal(t, "p", got.Data, "the event arrived as the payload serialized it")
	assert.Equal(t, int32(1), viaSocket.socket.Load(), "wsjson.Write, which Wails' server mode uses, is recognized")
	assert.Zero(t, viaSocket.other.Load())
}

// The payload is the base64 text a byte slice is, and it reports the delivery once.
func TestAStdoutPayloadSerializesAsABytesSliceDoesAndReportsDeliveryOnce(t *testing.T) {
	var reports atomic.Int32
	out := &terminalOutput{data: []byte("hello \x00\xff world"), delivered: func() { reports.Add(1) }}
	want, err := json.Marshal([]byte("hello \x00\xff world"))
	require.NoError(t, err)
	for range 3 {
		got, marshalErr := json.Marshal(out)
		require.NoError(t, marshalErr)
		assert.JSONEq(t, string(want), string(got))
	}
	// An encoder writing to a connection is a client socket's serialization in every build.
	for range 3 {
		var frame bytes.Buffer
		require.NoError(t, json.NewEncoder(&frame).Encode(out))
		assert.JSONEq(t, string(want), frame.String())
	}
	assert.Equal(t, int32(1), reports.Load(), "however many clients serialize it")
	assert.Equal(t, []byte("hello \x00\xff world"), out.Bytes())
}
