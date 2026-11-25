package terminal

import (
	"fmt"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// A channel terminal (Launch.Channel) is reached by a capability, and its output, input, size and acknowledgements
// travel on one stream for each terminal, which is its holder (docs/ui-next/terminal-channel-protocol.md). These are
// the shapes the manager and its callers share; the manager's side of it is in channel.go.

// Channel is one connection between the host and the page that holds a channel terminal. The host's transport is
// Wails' GoStream (backend/pkg/plugin/exec/terminal_stream.go), and a test's is a pair of pipes. It is one ordered
// connection: the frames the page sent are received in the order it sent them, and the frames the host sent are
// delivered in the order it sent them.
type Channel interface {
	// Send hands one frame to the page and returns when the transport has taken it. It blocks while the transport's
	// queue is full (a page that does not read, as a hidden one does not), and fails once the connection is gone. The
	// transport keeps the slice until the frame is delivered: the caller never changes it after Send.
	Send(frame []byte) error
	// Recv returns the next frame the page sent, and blocks until there is one. It fails once the connection is gone.
	Recv() ([]byte, error)
	// Close ends the connection, whichever end calls it, and wakes a Send or a Recv that is blocked. It is safe to
	// call more than once.
	Close() error
	// Done is closed once the connection is gone, whichever end ended it.
	Done() <-chan struct{}
}

// ChannelListed is one terminal of ListChannels: what a page that comes back needs to match it with a tab, for a
// capability it holds. It never holds the capability, and it names the terminal by its id, which is a label.
type ChannelListed struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	PID       int       `json:"pid"`
	Shell     Shell     `json:"shell"`
	// Labels and Params are what the page attached when it opened the terminal.
	Labels map[string]string `json:"labels"`
	Params map[string]string `json:"params"`
	// Size is the size now.
	Size Size `json:"size"`
	// Attached says a stream holds the terminal; false: it is detached and ends at LeaseExpiresUnixMs unless a stream
	// shows its capability before.
	Attached bool `json:"attached"`
	// NextOffset is the offset the next output will have and ReplayStart is the oldest offset the host keeps.
	NextOffset  uint64 `json:"next_offset"`
	ReplayStart uint64 `json:"replay_start"`
	// LeaseExpiresUnixMs is when a detached terminal ends, in Unix milliseconds; zero when it is attached.
	LeaseExpiresUnixMs int64 `json:"lease_expires_unix_ms"`
	// Ended is set for a terminal that ended and is kept until it is dismissed or its lease would have run out: how it
	// ended. Its output is still there to attach to.
	Ended *End `json:"ended,omitempty"`
}

// ChannelNotFound is what every call that names a channel terminal by its capability answers when it opens nothing,
// whatever the reason: no such capability, a wrong one, a terminal that ended and was dismissed, one that is closing.
// It is the typed error of an id that never was, and its words hold nothing the caller sent, so that no answer says
// more than another and none repeats the capability.
func ChannelNotFound() error {
	notFound := apperror.SessionNotFound("")
	notFound.Detail = "No terminal is held by that capability."
	return notFound
}

// checkListedCaps refuses a list of capabilities longer than a page holds: the same answer on every platform.
func checkListedCaps(n int) error {
	if n > MaxListedCaps {
		return invalidError(fmt.Sprintf("capabilities holds at most %d entries; got %d.", MaxListedCaps, n))
	}
	return nil
}
