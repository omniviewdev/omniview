//go:build !windows

package terminal

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

// gatedSink is a Sink whose Output holds until the test opens the gate: a transport that does not take the
// bytes. It says when its first Output is in.
type gatedSink struct {
	*recorder
	entered chan struct{}
	gate    chan struct{}
	once    sync.Once
}

func newGatedSink() *gatedSink {
	return &gatedSink{recorder: newRecorder(), entered: make(chan struct{}), gate: make(chan struct{}), once: sync.Once{}}
}

func (g *gatedSink) Output(id string, data []byte) {
	g.once.Do(func() { close(g.entered) })
	<-g.gate
	g.recorder.Output(id, data)
}

// A close that gave up waiting for the session (a sink that holds the last output) says so: the caller is
// told the session is not gone yet, with a type it can branch on, and the session is still answered later.
func TestACloseThatGaveUpWaitingForTheSessionSaysSo(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	sink := newGatedSink()
	ctx, cancel := context.WithCancel(context.Background())
	m := NewManager(ctx, logging.NewNop(), sink)
	m.closeWait = 200 * time.Millisecond
	t.Cleanup(func() {
		select {
		case <-sink.gate:
		default:
			close(sink.gate)
		}
		cancel()
		m.Shutdown()
	})

	info := m.run(t, "echo held-$((1000+1)); sleep 600", Options{})
	<-sink.entered

	err := m.CloseSession(info.ID)
	require.Error(t, err, "the session is not gone: the sink holds its last output")
	problem := appErr(t, err)
	assert.Equal(t, "omniview:terminal/close-timeout", problem.Type)
	assert.Equal(t, "CLOSE_TIMEOUT", problem.Code)
	assert.Equal(t, 504, problem.Status)

	close(sink.gate)
	sink.waitEnd(t, info.ID)
	requireGone(t, info.PID, "the shell")
}
