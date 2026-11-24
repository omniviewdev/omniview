//go:build server && !windows

package streamroute

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	osexec "os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"

	hostexec "github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	logging "github.com/omniviewdev/plugin-sdk/log"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// THE REAL ROUTE. A Wails application in server mode on a free loopback port, the host's own controller and terminal manager
// behind app.HandleStream("terminal", TerminalStreamHandler(controller)) as main.go registers it, and a WebSocket client that
// speaks the frames of docs/ui-next/terminal-channel-protocol.md to /wails/stream/ws?name=terminal. In the server build a stream
// is a plain WebSocket and each binary message is one frame, so the client is the page without the page. The frame table is
// written out here again, by hand and with literal numbers: a test that built its frames with the host's encoder would agree
// with the host about a wrong table.
//
// No wait here decides an outcome. A wait is for an event that must come (the application serves, a frame arrives, the host
// notices that a stream is gone, a shell finishes what it writes), with a bound that only a missing event reaches.

// The frame types.
const (
	pAttach   byte = 0x01
	pInput    byte = 0x02
	hReady    byte = 0x81
	hOutput   byte = 0x82
	hGap      byte = 0x83
	hEnded    byte = 0x84
	hNotFound byte = 0x86
)

// bound is how long an event that must come may take.
const bound = 90 * time.Second

// frameLimit is what the client accepts of one message: a frame of output is at most 64 KiB and a header.
const frameLimit = 1 << 20

//nolint:gochecknoglobals // application.New keeps the first application of the process in a global, so the tests share it
var route struct {
	once    sync.Once
	port    int
	wrapper *hostexec.ServiceWrapper
}

func loopbackPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	address, isTCP := listener.Addr().(*net.TCPAddr)
	require.True(t, isTCP, "the probe listener address is %T", listener.Addr())
	require.NoError(t, listener.Close())
	return address.Port
}

// waitServing returns when the application answers; it waits for that event only and decides nothing.
func waitServing(t *testing.T, port int) {
	t.Helper()
	deadline := time.Now().Add(bound)
	for time.Now().Before(deadline) {
		response, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", port))
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the application did not start serving")
}

// theRoute starts the application the way main.go does for a terminal: the exec service with a real controller (which makes the
// terminal manager when the application starts the service) and the one stream handler.
func theRoute(t *testing.T) (int, *hostexec.ServiceWrapper) {
	t.Helper()
	route.once.Do(func() {
		controller := hostexec.NewController(logging.NewNop(), nil, nil)
		wrapper := &hostexec.ServiceWrapper{Ctrl: controller, Realm: nil}
		port := loopbackPort(t)
		app := application.New(application.Options{
			Name:     "omniview-terminal-route",
			Server:   application.ServerOptions{Host: "127.0.0.1", Port: port},
			Assets:   application.AssetOptions{Handler: http.NotFoundHandler()},
			Services: []application.Service{application.NewService(wrapper)},
		})
		app.HandleStream(hostexec.TerminalStreamName, hostexec.TerminalStreamHandler(controller))
		go func() { _ = app.Run() }()
		waitServing(t, port)
		route.port, route.wrapper = port, wrapper
	})
	if route.wrapper == nil {
		t.Fatal("the application did not start in an earlier test")
	}
	return route.port, route.wrapper
}

// startTerminal opens a channel terminal that runs argv, through the same binding a page calls, with no window.
func startTerminal(t *testing.T, wrapper *hostexec.ServiceWrapper, argv ...string) *terminal.Session {
	t.Helper()
	path, err := osexec.LookPath(argv[0])
	require.NoError(t, err)
	argv[0] = path
	info, err := wrapper.CreateTerminal(context.Background(), execsdk.SessionOptions{Command: argv}, terminal.Launch{Channel: true, Cols: 100, Rows: 30})
	require.NoError(t, err)
	require.NotEmpty(t, info.Cap, "a channel terminal is answered its capability")
	t.Cleanup(func() { _ = wrapper.CloseChannelTerminal(info.Cap) })
	return info
}

// ---- the page's end of a stream ----

type readyFrame struct {
	V       int    `json:"v"`
	Start   uint64 `json:"start"`
	End     uint64 `json:"end"`
	Lost    uint64 `json:"lost"`
	LeaseMs int    `json:"lease_ms"`
}

// streamState is what a page that follows the protocol knows of a stream: the output it has, where it stands, the gaps it was told
// of, and what in the stream was not as the protocol says.
type streamState struct {
	ready    *readyFrame
	output   []byte
	next     uint64
	gaps     [][2]uint64
	ended    int
	notFound int
	faults   []string
}

func (s *streamState) take(frame []byte) {
	if len(frame) == 0 {
		s.faults = append(s.faults, "an empty frame")
		return
	}
	body := frame[1:]
	switch frame[0] {
	case hReady:
		var ready readyFrame
		if err := json.Unmarshal(body, &ready); err != nil {
			s.faults = append(s.faults, "a ready frame that is not json: "+err.Error())
			return
		}
		if s.ready != nil {
			s.faults = append(s.faults, "a second ready frame")
		}
		s.ready, s.next = &ready, ready.Start
	case hOutput:
		if len(body) <= 8 {
			s.faults = append(s.faults, fmt.Sprintf("an output frame of %d bytes", len(body)))
			return
		}
		offset := binary.BigEndian.Uint64(body[:8])
		if offset != s.next {
			s.faults = append(s.faults, fmt.Sprintf("an output at %d where the page stands at %d", offset, s.next))
		}
		s.output = append(s.output, body[8:]...)
		s.next = offset + uint64(len(body)-8)
	case hGap:
		if len(body) != 16 {
			s.faults = append(s.faults, fmt.Sprintf("a gap frame of %d bytes", len(body)))
			return
		}
		from, to := binary.BigEndian.Uint64(body[:8]), binary.BigEndian.Uint64(body[8:])
		if from != s.next || to <= from {
			s.faults = append(s.faults, fmt.Sprintf("a gap [%d, %d) where the page stands at %d", from, to, s.next))
		}
		s.gaps = append(s.gaps, [2]uint64{from, to})
		s.next = to
	case hEnded:
		s.ended++
	case hNotFound:
		s.notFound++
	default:
		s.faults = append(s.faults, fmt.Sprintf("a frame of type %#x", frame[0]))
	}
}

type client struct {
	t     *testing.T
	conn  *websocket.Conn
	ctx   context.Context
	state streamState
}

// dial opens the stream of the real route, as the page's WebSocket does.
func dial(t *testing.T, port int) *client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), bound)
	t.Cleanup(cancel)
	conn, _, err := websocket.Dial(ctx, fmt.Sprintf("ws://127.0.0.1:%d/wails/stream/ws?name=%s", port, hostexec.TerminalStreamName), nil)
	require.NoError(t, err)
	conn.SetReadLimit(frameLimit)
	t.Cleanup(func() { _ = conn.CloseNow() })
	return &client{t: t, conn: conn, ctx: ctx, state: streamState{}}
}

func (c *client) write(frame []byte) {
	c.t.Helper()
	require.NoError(c.t, c.conn.Write(c.ctx, websocket.MessageBinary, frame))
}

// read is the next frame the host sent.
func (c *client) read() []byte {
	c.t.Helper()
	kind, frame, err := c.conn.Read(c.ctx)
	require.NoError(c.t, err, "the stream ended before the frame the test waits for")
	require.Equal(c.t, websocket.MessageBinary, kind, "every frame is one binary message")
	return frame
}

// until reads frames, applying each as a page does, until what the test waits for is so.
func (c *client) until(what string, done func(*streamState) bool) *streamState {
	c.t.Helper()
	for !done(&c.state) {
		c.state.take(c.read())
	}
	assert.Empty(c.t, c.state.faults, "%s: the stream is as the protocol says", what)
	return &c.state
}

// requireClosed says the host closed the stream, with the code of a normal closure.
func (c *client) requireClosed() {
	c.t.Helper()
	_, _, err := c.conn.Read(c.ctx)
	require.Error(c.t, err)
	assert.Equal(c.t, websocket.StatusNormalClosure, websocket.CloseStatus(err), "the host closed the stream normally")
}

func attach(capability string, from *uint64) []byte {
	request := map[string]any{"v": 1, "cap": capability}
	if from != nil {
		request["from_offset"] = *from
	}
	raw, err := json.Marshal(request)
	if err != nil {
		panic(err)
	}
	return append([]byte{pAttach}, raw...)
}

// waitListed polls the binding the page lists its terminals with, until the terminal is as the test waits for: the host noticing
// that a stream is gone is an event that must come.
func waitListed(t *testing.T, wrapper *hostexec.ServiceWrapper, capability string, ok func(terminal.ChannelListed) bool) terminal.ChannelListed {
	t.Helper()
	deadline := time.Now().Add(bound)
	for time.Now().Before(deadline) {
		listed, err := wrapper.ListChannelTerminals([]string{capability})
		require.NoError(t, err)
		if len(listed) == 1 && ok(listed[0]) {
			return listed[0]
		}
		time.Sleep(5 * time.Millisecond)
	}
	require.Fail(t, "the terminal never became what the test waits for")
	return terminal.ChannelListed{}
}

// release lets go the shell that waits on a named pipe (`cat < "$0"`): it writes a byte once the shell has opened the pipe for reading,
// which is the event the test waits for (a pipe that nothing has opened for reading refuses a non-blocking open with ENXIO).
func release(t *testing.T, gatePath string) {
	t.Helper()
	deadline := time.Now().Add(bound)
	for {
		gate, err := os.OpenFile(gatePath, os.O_WRONLY|syscall.O_NONBLOCK, 0)
		if err == nil {
			_, err = gate.WriteString("x")
			require.NoError(t, err)
			require.NoError(t, gate.Close())
			return
		}
		require.ErrorIs(t, err, syscall.ENXIO, "the only reason the pipe cannot be opened is that the shell has not opened it yet")
		require.True(t, time.Now().Before(deadline), "the shell never opened the pipe")
		time.Sleep(5 * time.Millisecond)
	}
}

func TestTheRealRouteOfTheTerminalChannel(t *testing.T) {
	port, wrapper := theRoute(t)

	t.Run("a capability that opens nothing, and a first frame that is no attach, get the one not-found and the stream closes", func(t *testing.T) {
		for name, first := range map[string][]byte{
			"a capability of the right length that opens nothing": attach(strings.Repeat("A", 43), nil),
			"a first frame that is not json":                      append([]byte{pAttach}, "nope"...),
			"a first frame that is not an attach":                 {pInput, 'x'},
		} {
			page := dial(t, port)
			page.write(first)
			require.Equal(t, []byte{hNotFound}, page.read(), name)
			page.requireClosed()
		}
	})

	t.Run("the right capability gets ready first and its input comes back as output", func(t *testing.T) {
		info := startTerminal(t, wrapper, "sh", "-c", "cat")
		page := dial(t, port)
		page.write(attach(info.Cap, nil))
		state := page.until("ready", func(s *streamState) bool { return s.ready != nil })
		assert.Equal(t, 1, state.ready.V)
		assert.Zero(t, state.ready.Start, "the page has nothing and the terminal has written nothing")
		assert.Zero(t, state.ready.End)
		assert.Positive(t, state.ready.LeaseMs, "the lease the terminal is kept for when this stream ends is stated")

		page.write(append([]byte{pInput}, "hello\n"...))
		// Both lines whole, the terminator of the second too: a frame can end anywhere, and the output is compared when it is all there.
		state = page.until("the echo", func(s *streamState) bool { return bytes.Count(s.output, []byte("hello\r\n")) >= 2 })
		assert.EqualValues(t, len(state.output), state.next, "the output is one run of bytes from offset 0")
		assert.Equal(t, "hello\r\nhello\r\n", string(state.output), "the terminal's echo and then cat's own")
	})

	t.Run("a stream that is dropped detaches the terminal and a new one resumes byte for byte by offset", func(t *testing.T) {
		gatePath := filepath.Join(t.TempDir(), "gate")
		require.NoError(t, syscall.Mkfifo(gatePath, 0o600))
		info := startTerminal(t, wrapper, "sh", "-c", `printf 'first\n'; cat < "$0" >/dev/null; printf 'second\n'; exec sleep 600`, gatePath)

		first := dial(t, port)
		first.write(attach(info.Cap, nil))
		state := first.until("the first line", func(s *streamState) bool { return bytes.Contains(s.output, []byte("first\r\n")) })
		got, end := slices.Clone(state.output), state.next
		require.NoError(t, first.conn.CloseNow(), "the page is gone, with no frame to say so")

		detached := waitListed(t, wrapper, info.Cap, func(l terminal.ChannelListed) bool { return !l.Attached })
		assert.NotZero(t, detached.LeaseExpiresUnixMs, "a terminal that no stream holds has its lease running")

		release(t, gatePath)
		listed := waitListed(t, wrapper, info.Cap, func(l terminal.ChannelListed) bool { return l.NextOffset > end })
		assert.False(t, listed.Attached, "the shell went on writing into the ring while nobody held it")

		second := dial(t, port)
		second.write(attach(info.Cap, &end))
		state = second.until("the second line", func(s *streamState) bool { return bytes.Contains(s.output, []byte("second\r\n")) })
		assert.Equal(t, end, state.ready.Start, "the replay starts at the offset the page had")
		assert.Zero(t, state.ready.Lost, "and nothing it asked for is gone")
		assert.Equal(t, "first\r\nsecond\r\n", string(got)+string(state.output), "what the page had, then what it missed, byte for byte")
		assert.Empty(t, state.gaps)
		held := waitListed(t, wrapper, info.Cap, func(l terminal.ChannelListed) bool { return l.Attached })
		assert.Zero(t, held.LeaseExpiresUnixMs, "the stream that took it holds it, and no lease runs")
	})

	t.Run("a stream that never reads does not block the shell, and the page that wakes is told what it missed", func(t *testing.T) {
		const blocks, block = 366, 1 << 16
		const written = blocks * block // 23,986,176 bytes: three rings and more than the transport holds
		dir := t.TempDir()
		gatePath, done := filepath.Join(dir, "gate"), filepath.Join(dir, "done")
		require.NoError(t, syscall.Mkfifo(gatePath, 0o600))
		// The shell writes nothing until the test lets it go, which it does once the stream has the ready frame: the flood cannot begin,
		// overwrite the ring or finish before the stream holds the terminal, whatever the machine is doing.
		// The terminal does no output processing (stty -opost) and the shell writes in blocks of 64 KiB: a pty that turns each newline into
		// two bytes, or a pipeline that writes in small pieces, passes about 1 MB/s on macOS whatever reads it, and the test would be a
		// measure of the pty. Every byte the shell writes is a byte of the stream.
		script := fmt.Sprintf(`stty -opost; cat < "$0" >/dev/null; perl -e '$|=1; print((q(y) x %d)."\n") for 1..%d'; printf 'MARK-END\n'; : > "$1"; exec sleep 600`, block-1, blocks)
		info := startTerminal(t, wrapper, "sh", "-c", script, gatePath, done)

		page := dial(t, port)
		page.write(attach(info.Cap, nil))
		state := page.until("ready", func(s *streamState) bool { return s.ready != nil })
		assert.Zero(t, state.ready.End, "the shell has written nothing: the stream holds the terminal before the flood begins")
		began := time.Now()
		release(t, gatePath)
		// The page reads nothing more until the shell has written everything: the event that must come is the file.
		sampled := time.Now()
		require.Eventually(t, func() bool {
			if time.Since(sampled) >= 2*time.Second {
				sampled = time.Now()
				if listed, err := wrapper.ListChannelTerminals([]string{info.Cap}); err == nil && len(listed) == 1 {
					t.Logf("%v: the shell has written %d bytes, the ring starts at %d", time.Since(began).Round(time.Second), listed[0].NextOffset, listed[0].ReplayStart)
				}
			}
			_, err := os.Stat(done)
			return err == nil
		}, bound, 10*time.Millisecond,
			"the shell wrote %d bytes with nobody reading, and was never blocked", written)
		t.Logf("the shell wrote %d bytes with nobody reading, and was never blocked: %v after the stream attached", written, time.Since(began))

		state = page.until("the end of the output", func(s *streamState) bool { return bytes.HasSuffix(s.output, []byte("MARK-END\n")) })
		t.Logf("the page woke after %v: %d bytes of output, %d gaps, offset %d", time.Since(began), len(state.output), len(state.gaps), state.next)
		assert.NotEmpty(t, state.gaps, "the ring overwrote what the page did not take, and the page is told")
		var lost uint64
		for _, gap := range state.gaps {
			lost += gap[1] - gap[0]
		}
		assert.Equal(t, state.next, uint64(len(state.output))+lost, "what the page has and what it was told it missed are all of the output")
		assert.GreaterOrEqual(t, state.next, uint64(written), "the shell wrote everything")
		listed := waitListed(t, wrapper, info.Cap, func(l terminal.ChannelListed) bool { return l.NextOffset == state.next })
		assert.True(t, listed.Attached)
	})
}
