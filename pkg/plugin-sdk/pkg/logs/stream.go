package logs

import (
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/omniviewdev/plugin-sdk/proto"
)

// LogLineOrigin indicates the origin of a log line.
type LogLineOrigin int

const (
	LogLineOriginCurrent  LogLineOrigin = iota
	LogLineOriginPrevious
	LogLineOriginSystem
)

func (o LogLineOrigin) ToProto() proto.LogLineOrigin {
	switch o {
	case LogLineOriginCurrent:
		return proto.LogLineOrigin_LOG_LINE_ORIGIN_CURRENT
	case LogLineOriginPrevious:
		return proto.LogLineOrigin_LOG_LINE_ORIGIN_PREVIOUS
	case LogLineOriginSystem:
		return proto.LogLineOrigin_LOG_LINE_ORIGIN_SYSTEM
	}
	return proto.LogLineOrigin_LOG_LINE_ORIGIN_CURRENT
}

func LogLineOriginFromProto(p proto.LogLineOrigin) LogLineOrigin {
	switch p {
	case proto.LogLineOrigin_LOG_LINE_ORIGIN_CURRENT:
		return LogLineOriginCurrent
	case proto.LogLineOrigin_LOG_LINE_ORIGIN_PREVIOUS:
		return LogLineOriginPrevious
	case proto.LogLineOrigin_LOG_LINE_ORIGIN_SYSTEM:
		return LogLineOriginSystem
	}
	return LogLineOriginCurrent
}

// LogLine represents a single log line from any source.
type LogLine struct {
	SessionID string            `json:"session_id"`
	SourceID  string            `json:"source_id"`
	Labels    map[string]string `json:"labels"`
	Timestamp time.Time         `json:"timestamp"`
	Content   string            `json:"content"`
	Origin    LogLineOrigin     `json:"origin"`
}

func (l *LogLine) ToProto() *proto.LogLine {
	return &proto.LogLine{
		SessionId: l.SessionID,
		SourceId:  l.SourceID,
		Labels:    l.Labels,
		Timestamp: timestamppb.New(l.Timestamp),
		Content:   []byte(l.Content),
		Origin:    l.Origin.ToProto(),
	}
}

func LogLineFromProto(p *proto.LogLine) LogLine {
	var ts time.Time
	if p.GetTimestamp() != nil {
		ts = p.GetTimestamp().AsTime()
	}
	return LogLine{
		SessionID: p.GetSessionId(),
		SourceID:  p.GetSourceId(),
		Labels:    p.GetLabels(),
		Timestamp: ts,
		Content:   string(p.GetContent()),
		Origin:    LogLineOriginFromProto(p.GetOrigin()),
	}
}

// LogSource is a generic log-producing entity.
type LogSource struct {
	ID     string            `json:"id"`
	Labels map[string]string `json:"labels"`
}

func (s *LogSource) ToProto() *proto.LogSource {
	return &proto.LogSource{
		Id:     s.ID,
		Labels: s.Labels,
	}
}

func LogSourceFromProto(p *proto.LogSource) LogSource {
	return LogSource{
		ID:     p.GetId(),
		Labels: p.GetLabels(),
	}
}

// SourceEventType represents the type of source lifecycle event.
type SourceEventType int

const (
	SourceAdded SourceEventType = iota
	SourceRemoved
)

// SourceEvent represents a source lifecycle change.
type SourceEvent struct {
	Type   SourceEventType
	Source LogSource
}

// LogStreamEventType represents the type of log stream event.
type LogStreamEventType int

const (
	StreamEventSourceAdded LogStreamEventType = iota
	StreamEventSourceRemoved
	StreamEventStreamError
	StreamEventReconnecting
	StreamEventReconnected
	StreamEventStreamEnded
)

func (t LogStreamEventType) ToProto() proto.LogStreamEventType {
	switch t {
	case StreamEventSourceAdded:
		return proto.LogStreamEventType_LOG_STREAM_EVENT_SOURCE_ADDED
	case StreamEventSourceRemoved:
		return proto.LogStreamEventType_LOG_STREAM_EVENT_SOURCE_REMOVED
	case StreamEventStreamError:
		return proto.LogStreamEventType_LOG_STREAM_EVENT_STREAM_ERROR
	case StreamEventReconnecting:
		return proto.LogStreamEventType_LOG_STREAM_EVENT_RECONNECTING
	case StreamEventReconnected:
		return proto.LogStreamEventType_LOG_STREAM_EVENT_RECONNECTED
	case StreamEventStreamEnded:
		return proto.LogStreamEventType_LOG_STREAM_EVENT_STREAM_ENDED
	}
	return proto.LogStreamEventType_LOG_STREAM_EVENT_SOURCE_ADDED
}

func LogStreamEventTypeFromProto(p proto.LogStreamEventType) LogStreamEventType {
	switch p {
	case proto.LogStreamEventType_LOG_STREAM_EVENT_SOURCE_ADDED:
		return StreamEventSourceAdded
	case proto.LogStreamEventType_LOG_STREAM_EVENT_SOURCE_REMOVED:
		return StreamEventSourceRemoved
	case proto.LogStreamEventType_LOG_STREAM_EVENT_STREAM_ERROR:
		return StreamEventStreamError
	case proto.LogStreamEventType_LOG_STREAM_EVENT_RECONNECTING:
		return StreamEventReconnecting
	case proto.LogStreamEventType_LOG_STREAM_EVENT_RECONNECTED:
		return StreamEventReconnected
	case proto.LogStreamEventType_LOG_STREAM_EVENT_STREAM_ENDED:
		return StreamEventStreamEnded
	}
	return StreamEventSourceAdded
}

// LogStreamEvent represents a lifecycle event during streaming.
type LogStreamEvent struct {
	Type      LogStreamEventType `json:"type"`
	SourceID  string             `json:"source_id"`
	Message   string             `json:"message"`
	Timestamp time.Time          `json:"timestamp"`
}

func (e *LogStreamEvent) ToProto() *proto.LogStreamEvent {
	return &proto.LogStreamEvent{
		Type:      e.Type.ToProto(),
		SourceId:  e.SourceID,
		Message:   e.Message,
		Timestamp: timestamppb.New(e.Timestamp),
	}
}

func LogStreamEventFromProto(p *proto.LogStreamEvent) LogStreamEvent {
	var ts time.Time
	if p.GetTimestamp() != nil {
		ts = p.GetTimestamp().AsTime()
	}
	return LogStreamEvent{
		Type:      LogStreamEventTypeFromProto(p.GetType()),
		SourceID:  p.GetSourceId(),
		Message:   p.GetMessage(),
		Timestamp: ts,
	}
}

// LogStreamCommand represents a command from the client to control the stream.
type LogStreamCommand int

const (
	StreamCommandPause LogStreamCommand = iota
	StreamCommandResume
	StreamCommandClose
)

func (c LogStreamCommand) ToProto() proto.LogStreamCommand {
	switch c {
	case StreamCommandPause:
		return proto.LogStreamCommand_LOG_STREAM_COMMAND_PAUSE
	case StreamCommandResume:
		return proto.LogStreamCommand_LOG_STREAM_COMMAND_RESUME
	case StreamCommandClose:
		return proto.LogStreamCommand_LOG_STREAM_COMMAND_CLOSE
	}
	return proto.LogStreamCommand_LOG_STREAM_COMMAND_PAUSE
}

func LogStreamCommandFromProto(p proto.LogStreamCommand) LogStreamCommand {
	switch p {
	case proto.LogStreamCommand_LOG_STREAM_COMMAND_PAUSE:
		return StreamCommandPause
	case proto.LogStreamCommand_LOG_STREAM_COMMAND_RESUME:
		return StreamCommandResume
	case proto.LogStreamCommand_LOG_STREAM_COMMAND_CLOSE:
		return StreamCommandClose
	}
	return StreamCommandPause
}

// StreamInput is a control message from the client to the stream.
type StreamInput struct {
	SessionID string           `json:"session_id"`
	Command   LogStreamCommand `json:"command"`
}

func (i *StreamInput) ToProto() *proto.LogStreamInput {
	return &proto.LogStreamInput{
		SessionId: i.SessionID,
		Command:   i.Command.ToProto(),
	}
}

func StreamInputFromProto(p *proto.LogStreamInput) StreamInput {
	return StreamInput{
		SessionID: p.GetSessionId(),
		Command:   LogStreamCommandFromProto(p.GetCommand()),
	}
}

// StreamOutput is a log line or event from the stream.
type StreamOutput struct {
	SessionID string
	Line      *LogLine
	Event     *LogStreamEvent
}

// LogStreamRequest is the generic request to open a log stream for one source.
type LogStreamRequest struct {
	SourceID          string
	Labels            map[string]string
	ResourceData      map[string]interface{}
	Target            string
	Follow            bool
	IncludePrevious   bool
	IncludeTimestamps bool
	TailLines         int64
	SinceSeconds      int64
	SinceTime         *time.Time
	LimitBytes        int64
	Params            map[string]string
}
