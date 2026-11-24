//go:build !windows

package terminal

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/shellenv"
)

// The page's last acknowledgement of an exiting shell's output races the CLOSE event: it can arrive after the
// session is gone. There is nothing left to credit, so it is answered with success; a session that never
// existed is still not found, and a negative count is still refused.
func TestAnAcknowledgementForASessionThatEndedIsAnsweredWithSuccess(t *testing.T) {
	m, rec := newTestManager(t)
	info := m.run(t, "echo bye-$((40+2))", Options{})
	rec.waitEnd(t, info.ID)
	require.Eventually(t, func() bool { return len(m.running()) == 0 }, 10*time.Second, 5*time.Millisecond, "the session leaves the index")

	require.NoError(t, m.Ack(info.ID, 6), "the last acknowledgement of a shell that exited")
	require.NoError(t, m.Ack(info.ID, 0))

	err := m.Ack("never-existed", 1)
	require.Error(t, err)
	assert.Equal(t, appErr(t, apperror.SessionNotFound("x")).Type, appErr(t, err).Type, "a session that never existed is not found")
	require.ErrorIs(t, m.Ack(info.ID, -1), ErrInvalid, "a negative count is refused whatever the session")
}

// The manager remembers the last endedMemory ended sessions, no more: an older one is not found, as one that
// never was.
func TestTheManagerRemembersOnlyTheLastEndedSessions(t *testing.T) {
	m, _ := newTestManager(t)
	for i := range endedMemory + 10 {
		m.mu.Lock()
		m.rememberEnded(fmt.Sprintf("ended-%d", i), "w")
		m.mu.Unlock()
	}
	require.NoError(t, m.Ack(fmt.Sprintf("ended-%d", endedMemory+9), 1), "the newest")
	require.NoError(t, m.Ack("ended-10", 1), "the oldest that is kept")
	require.Error(t, m.Ack("ended-9", 1), "the newest that was forgotten")
	assert.Len(t, m.ended, endedMemory)
}

// gatedClose holds the CLOSE of a session until its gate opens: the session is ending and still in the index.
type gatedClose struct {
	*chunkSink
	entered chan struct{}
	gate    chan struct{}
	once    sync.Once
}

func (g *gatedClose) Closed(id string, end End) {
	g.once.Do(func() { close(g.entered) })
	<-g.gate
	g.chunkSink.Closed(id, end)
}

// A session that is ending, as a retiring window's is, takes an acknowledgement too: nothing is left to credit.
func TestAnAcknowledgementForASessionThatIsEndingIsAnsweredWithSuccess(t *testing.T) {
	sink := &gatedClose{chunkSink: newChunkSink(), entered: make(chan struct{}), gate: make(chan struct{}), once: sync.Once{}}
	m := newChunkManager(t, sink)
	var open sync.Once
	t.Cleanup(func() { open.Do(func() { close(sink.gate) }) })

	info, err := m.Start(Options{Command: []string{sh(t), "-c", "echo bye"}}, nil)
	require.NoError(t, err)
	select {
	case <-sink.entered:
	case <-time.After(10 * time.Second):
		require.FailNow(t, "the session never ended")
	}
	assert.Equal(t, []string{info.ID}, m.running(), "the session is ending and still in the index")
	require.NoError(t, m.Ack(info.ID, 4), "an acknowledgement for a session that is ending")
	open.Do(func() { close(sink.gate) })
}

// wireProblem is the problem as it crosses the binding, with the list of shells that were tried.
type wireProblem struct {
	Type   string             `json:"type"`
	Code   string             `json:"code"`
	Status int                `json:"status"`
	Detail string             `json:"detail"`
	Tried  []shellenv.Attempt `json:"tried"`
}

// The refusal of a shell that is not there carries every shell that was tried as a list of tokens, beside the
// sentence, so that a caller draws one path to a line in its own words.
func TestTheRefusalOfAMissingShellCarriesWhatWasTriedAsTokens(t *testing.T) {
	m, _ := newTestManager(t)
	tried := []shellenv.Attempt{
		{Source: shellenv.SourceRequested, Path: "/nonexistent/bin/zsh", Reason: shellenv.ReasonNotFound, Detail: ""},
		{Source: shellenv.SourceEnvironment, Path: "/x/fish", Reason: shellenv.ReasonNotExecutable, Detail: ""},
		{Source: shellenv.SourceFallback, Path: "/bin/sh", Reason: shellenv.ReasonOther, Detail: "stat /bin/sh: input/output error"},
	}
	m.resolve = func([]string) (string, []string, error) { return "", nil, &shellenv.UnavailableError{Tried: tried} }
	_, err := m.Start(Options{Command: []string{"/nonexistent/bin/zsh"}}, nil)
	require.ErrorIs(t, err, shellenv.ErrUnavailable)
	app := appErr(t, err)
	assert.Equal(t, TypeShellUnavailable, app.Type)
	assert.Equal(t, "SHELL_UNAVAILABLE", app.Code)
	assert.Contains(t, app.Detail, `the shell asked for "/nonexistent/bin/zsh": not found`, "the sentence is kept")

	var wire wireProblem
	require.NoError(t, json.Unmarshal([]byte(err.Error()), &wire), "the error is the problem as JSON, as it crosses the binding")
	assert.Equal(t, tried, wire.Tried)
	assert.Equal(t, TypeShellUnavailable, wire.Type)
	assert.Equal(t, "SHELL_UNAVAILABLE", wire.Code)
	assert.Equal(t, 422, wire.Status)
	assert.Contains(t, wire.Detail, "/x/fish")
}

// The sentence is bounded so that the problem is not refused whole by a reader with a limit; the list keeps
// every path.
func TestTheSentenceOfTheRefusalIsBoundedAndTheListKeepsEveryPath(t *testing.T) {
	m, _ := newTestManager(t)
	long := "/" + strings.Repeat("d", 1400)
	tried := make([]shellenv.Attempt, 0, 3)
	for _, n := range []string{"1", "2", "3"} {
		tried = append(tried, shellenv.Attempt{Source: shellenv.SourceFallback, Path: long + n, Reason: shellenv.ReasonNotFound, Detail: ""})
	}
	m.resolve = func([]string) (string, []string, error) { return "", nil, &shellenv.UnavailableError{Tried: tried} }
	_, err := m.Start(Options{}, nil)
	require.ErrorIs(t, err, shellenv.ErrUnavailable)
	app := appErr(t, err)
	assert.LessOrEqual(t, len(app.Detail), 4096, "the sentence fits the runtime's limit, so the problem is not refused whole")
	assert.True(t, utf8.ValidString(app.Detail))

	var wire wireProblem
	require.NoError(t, json.Unmarshal([]byte(err.Error()), &wire))
	assert.Equal(t, "SHELL_UNAVAILABLE", wire.Code)
	assert.Equal(t, tried, wire.Tried, "the list keeps every path whole")
}
