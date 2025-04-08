package exec

import (
	"io"
	"os"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

type StreamTarget int

const (
	StreamTargetStdOut StreamTarget = iota
	StreamTargetStdErr
)

func (t StreamTarget) String() string {
	switch t {
	case StreamTargetStdOut:
		return "stdout"
	case StreamTargetStdErr:
		return "stderr"
	}
	return "unknown"
}

type StreamSignal int

const (
	// while close isn't a signal, it's used to close the stream.
	StreamSignalNone StreamSignal = iota
	StreamSignalClose
	StreamSignalSigint
	StreamSignalSigquit
	StreamSignalSigterm
	StreamSignalSigkill
	StreamSignalSighup
	StreamSignalSigusr1
	StreamSignalSigusr2
	StreamSignalSigwinch
)

func (s StreamSignal) String() string {
	switch s {
	case StreamSignalNone:
		return "NONE"
	case StreamSignalClose:
		return "CLOSE"
	case StreamSignalSigint:
		return "SIGINT"
	case StreamSignalSigquit:
		return "SIGQUIT"
	case StreamSignalSigterm:
		return "SIGTERM"
	case StreamSignalSigkill:
		return "SIGKILL"
	case StreamSignalSighup:
		return "SIGHUP"
	case StreamSignalSigusr1:
		return "SIGUSR1"
	case StreamSignalSigusr2:
		return "SIGUSR2"
	case StreamSignalSigwinch:
		return "SIGWINCH"
	}
	return "NONE"
}

// pointer receiver to allow nil signal (when none is actually sent).
func (s StreamSignal) ToProto() proto.StreamSignal {
	switch s {
	case StreamSignalNone:
		return proto.StreamSignal_NONE
	case StreamSignalClose:
		return proto.StreamSignal_CLOSE
	case StreamSignalSigint:
		return proto.StreamSignal_SIGINT
	case StreamSignalSigquit:
		return proto.StreamSignal_SIGQUIT
	case StreamSignalSigterm:
		return proto.StreamSignal_SIGTERM
	case StreamSignalSigkill:
		return proto.StreamSignal_SIGKILL
	case StreamSignalSighup:
		return proto.StreamSignal_SIGHUP
	case StreamSignalSigusr1:
		return proto.StreamSignal_SIGUSR1
	case StreamSignalSigusr2:
		return proto.StreamSignal_SIGUSR2
	case StreamSignalSigwinch:
		return proto.StreamSignal_SIGWINCH
	}
	return proto.StreamSignal_NONE
}

func NewStreamSignalFromProto(p proto.StreamSignal) StreamSignal {
	switch p {
	case proto.StreamSignal_NONE:
		return StreamSignalNone
	case proto.StreamSignal_CLOSE:
		return StreamSignalClose
	case proto.StreamSignal_SIGINT:
		return StreamSignalSigint
	case proto.StreamSignal_SIGQUIT:
		return StreamSignalSigquit
	case proto.StreamSignal_SIGTERM:
		return StreamSignalSigterm
	case proto.StreamSignal_SIGKILL:
		return StreamSignalSigkill
	case proto.StreamSignal_SIGHUP:
		return StreamSignalSighup
	case proto.StreamSignal_SIGUSR1:
		return StreamSignalSigusr1
	case proto.StreamSignal_SIGUSR2:
		return StreamSignalSigusr2
	case proto.StreamSignal_SIGWINCH:
		return StreamSignalSigwinch
	}
	return StreamSignalNone
}

type StreamOutput struct {
	SessionID string       `json:"session_id"`
	Data      []byte       `json:"data"`
	Target    StreamTarget `json:"target"`
	Signal    StreamSignal `json:"signal"`
}

func (o *StreamOutput) ToProto() *proto.StreamOutput {
	switch o.Target {
	case StreamTargetStdOut:
		return &proto.StreamOutput{
			Id:     o.SessionID,
			Target: proto.StreamOutput_STDOUT,
			Data:   o.Data,
			Signal: o.Signal.ToProto(),
		}
	case StreamTargetStdErr:
		return &proto.StreamOutput{
			Id:     o.SessionID,
			Target: proto.StreamOutput_STDERR,
			Data:   o.Data,
			Signal: o.Signal.ToProto(),
		}
	}
	return nil
}

func NewStreamOutputFromProto(p *proto.StreamOutput) StreamOutput {
	var target StreamTarget
	switch p.GetTarget() {
	case proto.StreamOutput_STDOUT:
		target = StreamTargetStdOut
	case proto.StreamOutput_STDERR:
		target = StreamTargetStdErr
	}
	return StreamOutput{
		SessionID: p.GetId(),
		Target:    target,
		Data:      p.GetData(),
		Signal:    NewStreamSignalFromProto(p.GetSignal()),
	}
}

type StreamInput struct {
	// SessionID
	SessionID string `json:"session_id"`
	// Data
	Data []byte `json:"data"`
}

func (i *StreamInput) ToProto() *proto.StreamInput {
	return &proto.StreamInput{
		Id:   i.SessionID,
		Data: i.Data,
	}
}

func NewStreamInputFromProto(p *proto.StreamInput) StreamInput {
	return StreamInput{
		SessionID: p.GetId(),
		Data:      p.GetData(),
	}
}

type StreamResize struct {
	SessionID string `json:"session_id"`
	Cols      uint16 `json:"cols"`
	Rows      uint16 `json:"rows"`
}

func (r *StreamResize) ToProto() *proto.ResizeSessionRequest {
	return &proto.ResizeSessionRequest{
		Id:   r.SessionID,
		Cols: int32(r.Cols),
		Rows: int32(r.Rows),
	}
}

func NewStreamResizeFromProto(p *proto.ResizeSessionRequest) StreamResize {
	return StreamResize{
		SessionID: p.GetId(),
		Cols:      uint16(p.GetCols()),
		Rows:      uint16(p.GetRows()),
	}
}

// SessionHandler is the expected signature for a function that creates a new session.
//
// The session handler should start a new session against the given resource and return
// the standard input, output, and error streams which will be multiplexed to the client.
type SessionHandler func(ctx *types.PluginContext, opts SessionOptions) (
	stdin io.Writer,
	stdout io.Reader,
	stderr io.Reader,
	err error,
)

// TTYHandler is the expected signature for a function that creates a new session with a TTY.
// It is passed the TTY file descriptor for the session, and a resize channel that will receive
// resize events for the TTY, of which.
type TTYHandler func(ctx *types.PluginContext, opts SessionOptions, tty *os.File, stopCh chan struct{}, resize <-chan SessionResizeInput) error

// CommandHandler is the expected signature for the non-tty handler. It should immediately return it's
// standard output and error.
type CommandHandler func(ctx *types.PluginContext, opts SessionOptions) (
	stdout io.Reader,
	stderr io.Reader,
	err error,
)
