//go:build !windows

package exec

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// THE GOSTREAM ADAPTER (terminal_stream.go).
//
// Wails builds a connection only for a page that opened one, so the adapter is tested over the narrowest fake of the part of
// *application.StreamConn that it uses; the real route (a WebSocket in the server build) is driven by the test of
// backend/pkg/plugin/exec/streamroute, which holds a real application.

// fakeStreamConn is a GoStream connection as the adapter sees it: frames in, frames out, a context that ends with the connection.
type fakeStreamConn struct {
	mu     sync.Mutex
	in     chan []byte
	sent   [][]byte
	closes int
	ctx    context.Context
	cancel context.CancelFunc
}

func newFakeStreamConn() *fakeStreamConn {
	ctx, cancel := context.WithCancel(context.Background())
	return &fakeStreamConn{mu: sync.Mutex{}, in: make(chan []byte, 16), sent: nil, closes: 0, ctx: ctx, cancel: cancel}
}

var errFakeStreamClosed = errors.New("stream closed")

func (c *fakeStreamConn) Send(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ctx.Err() != nil {
		return errFakeStreamClosed
	}
	c.sent = append(c.sent, data)
	return nil
}

func (c *fakeStreamConn) Receive() ([]byte, error) {
	select {
	case frame := <-c.in:
		return frame, nil
	case <-c.ctx.Done():
		return nil, errFakeStreamClosed
	}
}

func (c *fakeStreamConn) Close() error {
	c.mu.Lock()
	c.closes++
	c.mu.Unlock()
	c.cancel()
	return nil
}

func (c *fakeStreamConn) Context() context.Context { return c.ctx }

// The adapter passes a frame each way unchanged and without a copy (GoStream queues the slice it is given and the caller never
// reuses it), a Recv waits for the page and fails once the connection is gone, Done is closed with the connection whichever end
// ended it, and closing twice is closing once as far as the host is concerned.
func TestTheStreamAdapterPassesFramesBothWaysAndEndsWithTheConnection(t *testing.T) {
	conn := newFakeStreamConn()
	channel := streamChannel{conn: conn}

	frame := []byte{0x82, 1, 2, 3}
	require.NoError(t, channel.Send(frame))
	require.Len(t, conn.sent, 1)
	assert.Same(t, &frame[0], &conn.sent[0][0], "the frame is handed over, not copied")

	conn.in <- []byte{0x02, 'a'}
	conn.in <- []byte{0x02, 'b'}
	first, err := channel.Recv()
	require.NoError(t, err)
	second, err := channel.Recv()
	require.NoError(t, err)
	assert.Equal(t, [][]byte{{0x02, 'a'}, {0x02, 'b'}}, [][]byte{first, second}, "in the order the page sent them")

	select {
	case <-channel.Done():
		require.Fail(t, "the connection is not gone")
	default:
	}
	blocked := make(chan error, 1)
	go func() { _, recvErr := channel.Recv(); blocked <- recvErr }()
	conn.cancel() // the page went away: Wails closes the connection's context
	select {
	case blockedErr := <-blocked:
		require.Error(t, blockedErr, "a Recv that waits returns once the connection is gone")
	case <-time.After(30 * time.Second):
		require.Fail(t, "a Recv that waited never returned")
	}
	select {
	case <-channel.Done():
	case <-time.After(30 * time.Second):
		require.Fail(t, "Done was never closed")
	}
	require.Error(t, channel.Send([]byte{1}), "a Send fails once the connection is gone")
	require.NoError(t, channel.Close())
	require.NoError(t, channel.Close())
	assert.Equal(t, 2, conn.closes, "both closes reached the connection, whose own Close is idempotent")
}

// The handler of main's registration is the adapter over the controller: a stream served through it speaks the protocol the
// manager speaks, so the first frame answered to a capability is the ready frame, and a capability that opens nothing is told
// not-found and closed. This is the code path of a real connection with the transport put aside.
func TestAStreamServedThroughTheAdapterSpeaksTheProtocol(t *testing.T) {
	fx := newTerminalFixture(t)
	info := fx.openChannel(nil, `stty -echo; printf 'up\n'; cat`)

	conn := newFakeStreamConn()
	served := make(chan struct{})
	go func() {
		defer close(served)
		fx.ctrl.ServeTerminalChannel(streamChannel{conn: conn})
	}()
	conn.in <- attachRequest(info.Cap)
	require.Eventually(t, func() bool {
		conn.mu.Lock()
		defer conn.mu.Unlock()
		return len(conn.sent) >= 2
	}, 30*time.Second, 2*time.Millisecond, "the host answered the attach")
	conn.mu.Lock()
	assert.Equal(t, byte(0x81), conn.sent[0][0], "the first frame is ready")
	assert.Equal(t, byte(0x82), conn.sent[1][0], "and the replay follows")
	conn.mu.Unlock()
	conn.cancel()
	select {
	case <-served:
	case <-time.After(30 * time.Second):
		require.Fail(t, "the host did not return from serving the stream")
	}

	wrong := newFakeStreamConn()
	refused := make(chan struct{})
	go func() {
		defer close(refused)
		fx.ctrl.ServeTerminalChannel(streamChannel{conn: wrong})
	}()
	wrong.in <- attachRequest("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
	select {
	case <-refused:
	case <-time.After(30 * time.Second):
		require.Fail(t, "a capability that opens nothing was not refused")
	}
	wrong.mu.Lock()
	assert.Equal(t, [][]byte{{0x86}}, wrong.sent, "one frame, not-found")
	assert.Positive(t, wrong.closes, "and the connection was closed")
	wrong.mu.Unlock()
}

// The handler that main registers is the one of this package, built for one controller, and its type is Wails'.
func TestTheStreamHandlerIsWailsHandlerTypeForTheName(t *testing.T) {
	fx := newTerminalFixture(t)
	handler := TerminalStreamHandler(fx.ctrl)
	assert.NotNil(t, handler)
	assert.IsType(t, application.StreamHandler(nil), handler, "the handler is of Wails' type, so that HandleStream takes it")
	assert.Equal(t, "terminal", TerminalStreamName, "the name carries nothing secret")
}
