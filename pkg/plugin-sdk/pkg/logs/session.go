package logs

import (
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/omniviewdev/plugin-sdk/proto"
)

// LogSessionStatus represents the status of a log session.
type LogSessionStatus int

const (
	LogSessionStatusActive LogSessionStatus = iota
	LogSessionStatusPaused
	LogSessionStatusClosed
	LogSessionStatusError
)

func (s LogSessionStatus) ToProto() proto.LogSessionStatus {
	switch s {
	case LogSessionStatusActive:
		return proto.LogSessionStatus_LOG_SESSION_STATUS_ACTIVE
	case LogSessionStatusPaused:
		return proto.LogSessionStatus_LOG_SESSION_STATUS_PAUSED
	case LogSessionStatusClosed:
		return proto.LogSessionStatus_LOG_SESSION_STATUS_CLOSED
	case LogSessionStatusError:
		return proto.LogSessionStatus_LOG_SESSION_STATUS_ERROR
	}
	return proto.LogSessionStatus_LOG_SESSION_STATUS_ACTIVE
}

func LogSessionStatusFromProto(p proto.LogSessionStatus) LogSessionStatus {
	switch p {
	case proto.LogSessionStatus_LOG_SESSION_STATUS_ACTIVE:
		return LogSessionStatusActive
	case proto.LogSessionStatus_LOG_SESSION_STATUS_PAUSED:
		return LogSessionStatusPaused
	case proto.LogSessionStatus_LOG_SESSION_STATUS_CLOSED:
		return LogSessionStatusClosed
	case proto.LogSessionStatus_LOG_SESSION_STATUS_ERROR:
		return LogSessionStatusError
	}
	return LogSessionStatusActive
}

// LogSession represents an active log viewing session.
type LogSession struct {
	ID             string            `json:"id"`
	PluginID       string            `json:"plugin_id"`
	ConnectionID   string            `json:"connection_id"`
	ResourceKey    string            `json:"resource_key"`
	ResourceID     string            `json:"resource_id"`
	Options        LogSessionOptions `json:"options"`
	Status         LogSessionStatus  `json:"status"`
	ActiveSources  []LogSource       `json:"active_sources"`
	CreatedAt      time.Time         `json:"created_at"`
}

func (s *LogSession) ToProto() *proto.LogSession {
	sources := make([]*proto.LogSource, 0, len(s.ActiveSources))
	for _, src := range s.ActiveSources {
		sources = append(sources, src.ToProto())
	}
	return &proto.LogSession{
		Id:            s.ID,
		PluginId:      s.PluginID,
		ConnectionId:  s.ConnectionID,
		ResourceKey:   s.ResourceKey,
		ResourceId:    s.ResourceID,
		Options:       s.Options.ToProto(),
		Status:        s.Status.ToProto(),
		ActiveSources: sources,
		CreatedAt:     timestamppb.New(s.CreatedAt),
	}
}

func LogSessionFromProto(p *proto.LogSession) *LogSession {
	sources := make([]LogSource, 0, len(p.GetActiveSources()))
	for _, src := range p.GetActiveSources() {
		sources = append(sources, LogSourceFromProto(src))
	}
	return &LogSession{
		ID:            p.GetId(),
		PluginID:      p.GetPluginId(),
		ConnectionID:  p.GetConnectionId(),
		ResourceKey:   p.GetResourceKey(),
		ResourceID:    p.GetResourceId(),
		Options:       LogSessionOptionsFromProto(p.GetOptions()),
		Status:        LogSessionStatusFromProto(p.GetStatus()),
		ActiveSources: sources,
		CreatedAt:     p.GetCreatedAt().AsTime(),
	}
}

// LogSessionOptions contains options for creating or updating a log session.
type LogSessionOptions struct {
	Target              string            `json:"target"`
	Follow              bool              `json:"follow"`
	IncludePrevious     bool              `json:"include_previous"`
	IncludeTimestamps   bool              `json:"include_timestamps"`
	TailLines           int64             `json:"tail_lines"`
	SinceSeconds        int64             `json:"since_seconds"`
	SinceTime           *time.Time        `json:"since_time,omitempty"`
	LimitBytes          int64             `json:"limit_bytes"`
	IncludeSourceEvents bool              `json:"include_source_events"`
	Params              map[string]string `json:"params"`
}

func (o *LogSessionOptions) ToProto() *proto.LogSessionOptions {
	if o == nil {
		return nil
	}
	p := &proto.LogSessionOptions{
		Target:              o.Target,
		Follow:              o.Follow,
		IncludePrevious:     o.IncludePrevious,
		IncludeTimestamps:   o.IncludeTimestamps,
		TailLines:           o.TailLines,
		SinceSeconds:        o.SinceSeconds,
		LimitBytes:          o.LimitBytes,
		IncludeSourceEvents: o.IncludeSourceEvents,
		Params:              o.Params,
	}
	if o.SinceTime != nil {
		p.SinceTime = timestamppb.New(*o.SinceTime)
	}
	return p
}

func LogSessionOptionsFromProto(p *proto.LogSessionOptions) LogSessionOptions {
	if p == nil {
		return LogSessionOptions{}
	}
	opts := LogSessionOptions{
		Target:              p.GetTarget(),
		Follow:              p.GetFollow(),
		IncludePrevious:     p.GetIncludePrevious(),
		IncludeTimestamps:   p.GetIncludeTimestamps(),
		TailLines:           p.GetTailLines(),
		SinceSeconds:        p.GetSinceSeconds(),
		LimitBytes:          p.GetLimitBytes(),
		IncludeSourceEvents: p.GetIncludeSourceEvents(),
		Params:              p.GetParams(),
	}
	if p.GetSinceTime() != nil {
		t := p.GetSinceTime().AsTime()
		opts.SinceTime = &t
	}
	return opts
}

// CreateSessionOptions contains everything needed to create a log session.
type CreateSessionOptions struct {
	ResourceKey  string                 `json:"resource_key"`
	ResourceID   string                 `json:"resource_id"`
	ResourceData map[string]interface{} `json:"resource_data"`
	Options      LogSessionOptions      `json:"options"`
}
