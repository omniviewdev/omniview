package exec

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/google/uuid" // UUID package for generating unique identifiers.
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/omniviewdev/plugin-sdk/proto"
)

// Session represents an individual terminal session (shell session with a tty).
type Session struct {
	CreatedAt time.Time               `json:"created_at"`
	ctx       context.Context         `json:"-"`
	pty       *os.File                `json:"-"`
	tty       *os.File                `json:"-"`
	resize    chan SessionResizeInput `json:"-"`
	ttyResize bool                    `json:"-"`
	cancel    context.CancelFunc      `json:"-"`
	stopChan  chan struct{}           `json:"-"`
	buffer    *OutputBuffer           `json:"-"`
	Labels    map[string]string       `json:"labels"`
	Params    map[string]string       `json:"params"`
	ID        string                  `json:"id"`
	Command   []string                `json:"command"`
	Attached  bool                    `json:"attached"`
}

func (s *Session) Close() {
	s.cancel()
	s.pty.Close()
}

func (s *Session) Write(data []byte) (int, error) {
	if s.pty == nil {
		return 0, errors.New("pty is nil")
	}
	return s.pty.Write(data)
}

func (s *Session) GetBufferData() []byte {
	if s.buffer == nil {
		return []byte{}
	}
	return s.buffer.GetAll()
}

func (s *Session) SetPty(pty *os.File) {
	s.pty = pty
}

func (s *Session) SetTty(tty *os.File) {
	s.tty = tty
}

func (s *Session) GetPty() *os.File {
	return s.pty
}

func (s *Session) GetTty() *os.File {
	return s.tty
}

func (s *Session) GetCanceller() context.CancelFunc {
	return s.cancel
}

func (s *Session) RecordToBuffer(data []byte) {
	if s.buffer == nil {
		return
	}
	s.buffer.Append(data)
}

func (s *Session) ToProto() *proto.Session {
	return &proto.Session{
		Id:        s.ID,
		Command:   s.Command,
		Labels:    s.Labels,
		Params:    s.Params,
		Attached:  s.Attached,
		CreatedAt: timestamppb.New(s.CreatedAt),
	}
}

func NewSessionFromProto(s *proto.Session) *Session {
	return &Session{
		ID:        s.GetId(),
		Command:   s.GetCommand(),
		Labels:    s.GetLabels(),
		Params:    s.GetParams(),
		Attached:  s.GetAttached(),
		CreatedAt: s.GetCreatedAt().AsTime(),
	}
}

func NewSessionFromOpts(
	ctx context.Context,
	canceller context.CancelFunc,
	opts SessionOptions,
) *Session {
	// Generate a unique ID for the session.
	if opts.ID == "" {
		opts.ID = uuid.NewString()
	}

	return &Session{
		CreatedAt: time.Now(),
		ctx:       ctx,
		cancel:    canceller,
		buffer:    NewDefaultOutputBuffer(),
		Labels:    opts.Labels,
		Params:    opts.Params,
		ID:        opts.ID,
		Command:   opts.Command,
		Attached:  false,
	}
}

// SessionOptions contains options for creating a new terminal session.
type SessionOptions struct {
	Params         map[string]string      `json:"params"`
	Labels         map[string]string      `json:"labels"`
	ID             string                 `json:"id"`
	ResourcePlugin string                 `json:"resource_plugin"`
	ResourceKey    string                 `json:"resource_key"`
	ResourceData   map[string]interface{} `json:"resource_data"`
	Command        []string               `json:"command"`
	TTY            bool                   `json:"tty"`
}

func NewSessionOptionsFromProto(opts *proto.SessionOptions) *SessionOptions {
	return &SessionOptions{
		ID:             opts.GetId(),
		Command:        opts.GetCommand(),
		TTY:            opts.GetTty(),
		Params:         opts.GetParams(),
		Labels:         opts.GetLabels(),
		ResourcePlugin: opts.GetResourcePlugin(),
		ResourceKey:    opts.GetResourceKey(),
		ResourceData:   opts.GetResourceData().AsMap(),
	}
}

func (o *SessionOptions) ToProto() *proto.SessionOptions {
	data, err := structpb.NewStruct(o.ResourceData)
	if err != nil {
		// ignore
	}

	return &proto.SessionOptions{
		Id:             o.ID,
		Command:        o.Command,
		Tty:            o.TTY,
		Params:         o.Params,
		Labels:         o.Labels,
		ResourcePlugin: o.ResourcePlugin,
		ResourceKey:    o.ResourceKey,
		ResourceData:   data,
	}
}

type SessionResizeInput struct {
	Rows int32 `json:"rows"`
	Cols int32 `json:"cols"`
}
