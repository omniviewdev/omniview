//go:build !windows

package exec

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"hash"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal"
)

// mailboxClient is what Wails' server mode does with an event, as the host sees it (v3.1.0
// internal/mailbox and pkg/application/websocket_server.go): a per-client mailbox that never makes a sender
// wait, drained by ONE worker that serializes each event (json.Marshal of the event, which is where a
// payload's MarshalJSON runs) and writes it to the client's socket. While the client does not read, the
// worker waits in the write, and everything behind it stays in the host's memory.
type mailboxClient struct {
	mu      sync.Mutex
	cond    *sync.Cond
	pending []*wireEvent
	pendingData,
	maxPendingData int
	worker  bool
	stalled bool
	streams map[string]*clientStream
	ends    map[string][]terminal.End
}

type wireEvent struct {
	Name string `json:"name"`
	Data any    `json:"data"`
	size int
}

type clientStream struct {
	sum   hash.Hash
	bytes int
}

func newMailboxClient() *mailboxClient {
	c := &mailboxClient{streams: map[string]*clientStream{}, ends: map[string][]terminal.End{}}
	c.cond = sync.NewCond(&c.mu)
	return c
}

// outputSize is how many bytes of shell output an event carries: the bytes themselves, or the payload of a
// local terminal's stdout event.
func outputSize(data any) int {
	switch value := data.(type) {
	case []byte:
		return len(value)
	case interface{ Bytes() []byte }:
		return len(value.Bytes())
	default:
		return 0
	}
}

// Emit never waits, as Wails' Emit does for a server client.
func (c *mailboxClient) Emit(name string, data ...any) bool {
	event := &wireEvent{Name: name, Data: data[0]}
	event.size = outputSize(data[0])
	if virtualWindow {
		// A server build serializes every event for the window it keeps (Event.ToJSON, in the dispatch
		// worker), before any client's worker does.
		if _, err := json.Marshal(event); err != nil {
			panic(err)
		}
	}
	c.mu.Lock()
	c.pending = append(c.pending, event)
	c.pendingData += event.size
	c.maxPendingData = max(c.maxPendingData, c.pendingData)
	start := !c.worker
	c.worker = true
	c.mu.Unlock()
	if start {
		go c.drain()
	}
	return false
}

func (c *mailboxClient) drain() {
	for {
		c.mu.Lock()
		if len(c.pending) == 0 {
			c.worker = false
			c.mu.Unlock()
			return
		}
		event := c.pending[0]
		c.mu.Unlock()

		// What wsjson.Write does: an encoder writing the event to the client's connection.
		var frame bytes.Buffer
		if err := json.NewEncoder(&frame).Encode(event); err != nil {
			panic(err)
		}
		payload := frame.Bytes()

		c.mu.Lock()
		for c.stalled {
			c.cond.Wait() // the socket's send buffer is full
		}
		c.record(payload)
		c.pending[0] = nil
		c.pending = c.pending[1:]
		c.pendingData -= event.size
		c.mu.Unlock()
	}
}

// record is what the page's socket receives.
func (c *mailboxClient) record(payload []byte) {
	var wire struct {
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(payload, &wire); err != nil {
		panic(err)
	}
	const stdout, closed = localOutputEvent, localCloseEvent
	switch {
	case len(wire.Name) > len(stdout) && wire.Name[:len(stdout)] == stdout:
		var encoded string
		if err := json.Unmarshal(wire.Data, &encoded); err != nil {
			panic(err)
		}
		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			panic(err)
		}
		id := wire.Name[len(stdout):]
		stream := c.streams[id]
		if stream == nil {
			stream = &clientStream{sum: sha256.New()}
			c.streams[id] = stream
		}
		stream.sum.Write(raw)
		stream.bytes += len(raw)
	case len(wire.Name) > len(closed) && wire.Name[:len(closed)] == closed:
		var end terminal.End
		if err := json.Unmarshal(wire.Data, &end); err != nil {
			panic(err)
		}
		id := wire.Name[len(closed):]
		c.ends[id] = append(c.ends[id], end)
	}
}

func (c *mailboxClient) stall() {
	c.mu.Lock()
	c.stalled = true
	c.mu.Unlock()
}

func (c *mailboxClient) unstall() {
	c.mu.Lock()
	c.stalled = false
	c.mu.Unlock()
	c.cond.Broadcast()
}

// held is how much shell output is in the host's memory, waiting for the client.
func (c *mailboxClient) held() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.pendingData
}

// peak is the most shell output the host ever held for the client at one time. Emit writes it under the
// lock, so it is read under the lock.
func (c *mailboxClient) peak() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.maxPendingData
}

func (c *mailboxClient) received(id string) (int, []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	stream := c.streams[id]
	if stream == nil {
		return 0, nil
	}
	return stream.bytes, stream.sum.Sum(nil)
}

func (c *mailboxClient) endsOf(id string) []terminal.End {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]terminal.End(nil), c.ends[id]...)
}

// withClient makes the fixture's events go to a Wails-like client, from before any terminal starts.
func (fx *terminalFixture) withClient() *mailboxClient {
	client := newMailboxClient()
	fx.ctrl.events = client
	return client
}

// The flood of a shell that never stops writing, against a client whose socket stalls: the host holds the
// credit and not more. It used to hold everything the shell wrote (7.9 GiB in 40 s on the real host).
func TestAStalledClientCannotTakeTheHostsMemory(t *testing.T) {
	fx := newTerminalFixture(t)
	client := fx.withClient()
	client.stall()
	fx.ctrl.terminalManager.SetFlowStall(time.Hour) // the watchdog is not what this test is about
	info := fx.open(fx.page(1), terminal.Options{Command: append(shell(t), "-c", "yes flood-yes")})

	bound := terminal.FlowHighBytes + 3*terminal.DefaultReadBufferSize
	require.Never(t, func() bool { return client.held() > bound }, 2*time.Second, 5*time.Millisecond,
		"the host holds more than the credit for a client that does not read")
	require.Eventually(t, func() bool { return client.held() >= terminal.FlowHighBytes }, 20*time.Second, 5*time.Millisecond,
		"the host did not even fill the credit")
	plateau := client.held()
	time.Sleep(500 * time.Millisecond)
	assert.Equal(t, plateau, client.held(), "the shell is blocked in its own write: nothing more arrives")

	// The client reads again: the credit comes back and the shell goes on.
	before, _ := client.received(info.ID)
	client.unstall()
	require.Eventually(t, func() bool {
		got, _ := client.received(info.ID)
		return got > before+2*terminal.FlowHighBytes
	}, 30*time.Second, 5*time.Millisecond, "the stream never went on after the client read again")
	assert.LessOrEqual(t, client.peak(), terminal.FlowHighBytes+4*terminal.DefaultReadBufferSize, "the most the host ever held")
	require.NoError(t, fx.ctrl.CloseSession(info.ID))
}

// A stalled client can still close its terminal: the dying shell is read, the CLOSE is delivered, and
// nothing is left (on macOS a shell cannot finish exiting while its pty holds output nobody reads).
func TestAStalledClientCanStillCloseItsTerminalAndGetsTheClose(t *testing.T) {
	for i := range 6 {
		t.Run(fmt.Sprintf("run %d", i), func(t *testing.T) {
			fx := newTerminalFixture(t)
			client := fx.withClient()
			client.stall()
			fx.ctrl.terminalManager.SetFlowStall(time.Hour)
			info := fx.open(fx.page(1), terminal.Options{Command: append(shell(t), "-c", "yes flood-yes")})
			require.Eventually(t, func() bool { return client.held() >= terminal.FlowHighBytes }, 20*time.Second, 5*time.Millisecond)

			// The close returns when the session is gone, or the test runs out: the time it took is not what decides it.
			closed := make(chan error, 1)
			go func() { closed <- fx.ctrl.CloseSession(info.ID) }()
			select {
			case closeErr := <-closed:
				require.NotErrorIs(t, closeErr, terminal.ErrCloseTimeout, "the close gave up waiting: the session was still ending")
				require.NoError(t, closeErr, "closing a session whose client does not read")
			case <-time.After(60 * time.Second):
				require.FailNow(t, "closing a session whose client does not read hung")
			}
			assert.Empty(t, fx.ctrl.terminalManager.ListSessions())
			assert.True(t, gone(info.PID), "the close returned with the shell gone: a dying shell is read to finish exiting while the client reads nothing")
			client.unstall()
			require.Eventually(t, func() bool { return len(client.endsOf(info.ID)) == 1 }, 20*time.Second, 5*time.Millisecond, "the CLOSE never reached the client")
			assert.Equal(t, terminal.EndClosed, client.endsOf(info.ID)[0].Reason)
			assert.True(t, gone(info.PID), "the shell is gone")
		})
	}
}

// A client that never acknowledges and reads everything, which is what the legacy terminal and the first
// version of the new one are: ten MiB arrive complete and in order, and the shell is never held up.
func TestAClientThatNeverAcknowledgesStillGetsEveryByteInOrder(t *testing.T) {
	const lines = 1 << 20
	expected := sha256.New()
	for i := range lines {
		fmt.Fprintf(expected, "%08d\r\n", i)
	}
	fx := newTerminalFixture(t)
	client := fx.withClient()
	script := `awk 'BEGIN { for (i = 0; i < 1048576; i++) printf "%08d\n", i }'`
	info := fx.open(fx.page(1), terminal.Options{Command: append(shell(t), "-c", script)})

	require.Eventually(t, func() bool { return len(client.endsOf(info.ID)) == 1 }, 120*time.Second, 20*time.Millisecond, "the CLOSE never reached the client")
	got, sum := client.received(info.ID)
	assert.Equal(t, lines*10, got)
	assert.Equal(t, expected.Sum(nil), sum, "every byte arrived, in order")
	end := client.endsOf(info.ID)[0]
	assert.Equal(t, terminal.EndExited, end.Reason)
}
