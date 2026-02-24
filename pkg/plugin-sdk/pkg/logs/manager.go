package logs

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hashicorp/go-hclog"
	"github.com/omniviewdev/settings"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	MaxConcurrentStreamsPerSession = 20
	MaxScannerBuffer              = 1024 * 1024 // 1MB
	ReconnectMaxAttempts          = 5
	ReconnectInitialDelay         = 1 * time.Second
	ReconnectMaxDelay             = 30 * time.Second
)

// Manager manages the lifecycle of log sessions within a plugin process.
type Manager struct {
	log              hclog.Logger
	settingsProvider settings.Provider
	sessions         map[string]*managedSession
	handlers         map[string]Handler
	resolvers        map[string]SourceResolver
	out              chan StreamOutput
	mux              sync.Mutex
}

type managedSession struct {
	session    *LogSession
	ctx        context.Context
	cancel     context.CancelFunc
	streamDone chan struct{}
	sourceCtxs map[string]context.CancelFunc // per-source cancel functions
	sourceMux  sync.Mutex
	opts       CreateSessionOptions   // stored for re-streaming
	pluginctx  *types.PluginContext   // stored for re-streaming
}

var _ Provider = (*Manager)(nil)

func NewManager(
	log hclog.Logger,
	sp settings.Provider,
	handlers map[string]Handler,
	resolvers map[string]SourceResolver,
) *Manager {
	return &Manager{
		log:              log.Named("LogManager"),
		settingsProvider: sp,
		sessions:         make(map[string]*managedSession),
		handlers:         handlers,
		resolvers:        resolvers,
		out:              make(chan StreamOutput, 256),
	}
}

func (m *Manager) GetSupportedResources(_ *types.PluginContext) []Handler {
	resources := make([]Handler, 0, len(m.handlers))
	for _, handler := range m.handlers {
		resources = append(resources, handler)
	}
	return resources
}

func (m *Manager) CreateSession(
	pluginctx *types.PluginContext,
	opts CreateSessionOptions,
) (*LogSession, error) {
	logger := m.log.With("resource_key", opts.ResourceKey, "resource_id", opts.ResourceID)

	sessionID := uuid.NewString()
	ctx, cancel := context.WithCancel(context.Background())
	pluginctx.Context = ctx
	pluginctx.SetSettingsProvider(m.settingsProvider)

	session := &LogSession{
		ID:          sessionID,
		ResourceKey: opts.ResourceKey,
		ResourceID:  opts.ResourceID,
		Options:     opts.Options,
		Status:      LogSessionStatusActive,
		CreatedAt:   time.Now(),
	}

	ms := &managedSession{
		session:    session,
		ctx:        ctx,
		cancel:     cancel,
		streamDone: make(chan struct{}),
		sourceCtxs: make(map[string]context.CancelFunc),
		opts:       opts,
		pluginctx:  pluginctx,
	}

	m.mux.Lock()
	m.sessions[sessionID] = ms
	m.mux.Unlock()

	// Start streaming in background
	go m.startStreaming(ctx, pluginctx, ms, opts)

	logger.Debug("log session created", "session_id", sessionID)
	return session, nil
}

func (m *Manager) GetSession(_ *types.PluginContext, sessionID string) (*LogSession, error) {
	m.mux.Lock()
	defer m.mux.Unlock()

	ms, ok := m.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("log session %s not found", sessionID)
	}
	return ms.session, nil
}

func (m *Manager) ListSessions(_ *types.PluginContext) ([]*LogSession, error) {
	m.mux.Lock()
	defer m.mux.Unlock()

	sessions := make([]*LogSession, 0, len(m.sessions))
	for _, ms := range m.sessions {
		sessions = append(sessions, ms.session)
	}
	return sessions, nil
}

func (m *Manager) CloseSession(_ *types.PluginContext, sessionID string) error {
	m.mux.Lock()
	ms, ok := m.sessions[sessionID]
	if !ok {
		m.mux.Unlock()
		return fmt.Errorf("log session %s not found", sessionID)
	}
	delete(m.sessions, sessionID)
	m.mux.Unlock()

	ms.cancel()
	ms.session.Status = LogSessionStatusClosed
	return nil
}

func (m *Manager) UpdateSessionOptions(
	_ *types.PluginContext,
	sessionID string,
	opts LogSessionOptions,
) (*LogSession, error) {
	m.mux.Lock()
	ms, ok := m.sessions[sessionID]
	if !ok {
		m.mux.Unlock()
		return nil, fmt.Errorf("log session %s not found", sessionID)
	}
	ms.session.Options = opts
	m.mux.Unlock()

	// Handle per-source enable/disable via params
	if enabledStr, hasEnabled := opts.Params["enabled_sources"]; hasEnabled {
		m.updateEnabledSources(ms, enabledStr)
	}

	m.mux.Lock()
	defer m.mux.Unlock()
	return ms.session, nil
}

// updateEnabledSources stops streams for deselected sources and starts streams
// for newly re-enabled sources.
func (m *Manager) updateEnabledSources(ms *managedSession, enabledStr string) {
	// Build set of enabled source IDs. Empty string means all enabled.
	enabledSet := make(map[string]bool)
	allEnabled := enabledStr == ""
	if !allEnabled {
		for _, id := range strings.Split(enabledStr, ",") {
			id = strings.TrimSpace(id)
			if id != "" {
				enabledSet[id] = true
			}
		}
	}

	ms.sourceMux.Lock()
	// Cancel streams for sources not in the enabled set
	for sourceID, cancel := range ms.sourceCtxs {
		if !allEnabled && !enabledSet[sourceID] {
			cancel()
			m.emitEvent(ms.session.ID, LogStreamEvent{
				Type:      StreamEventSourceRemoved,
				SourceID:  sourceID,
				Message:   fmt.Sprintf("Source disabled: %s", sourceID),
				Timestamp: time.Now(),
			})
		}
	}

	// Find sources that need to be re-enabled (in enabled set but no active context)
	var toRestart []LogSource
	if !allEnabled {
		m.mux.Lock()
		for _, src := range ms.session.ActiveSources {
			if enabledSet[src.ID] {
				if _, hasCtx := ms.sourceCtxs[src.ID]; !hasCtx {
					toRestart = append(toRestart, src)
				}
			}
		}
		m.mux.Unlock()
	} else {
		// All enabled: restart any source that doesn't have an active context
		m.mux.Lock()
		for _, src := range ms.session.ActiveSources {
			if _, hasCtx := ms.sourceCtxs[src.ID]; !hasCtx {
				toRestart = append(toRestart, src)
			}
		}
		m.mux.Unlock()
	}
	ms.sourceMux.Unlock()

	// Start fresh streams for re-enabled sources
	for _, src := range toRestart {
		go func(source LogSource) {
			m.streamSource(ms.ctx, ms.pluginctx, ms, source, ms.opts)
		}(src)

		m.emitEvent(ms.session.ID, LogStreamEvent{
			Type:      StreamEventSourceAdded,
			SourceID:  src.ID,
			Message:   fmt.Sprintf("Source re-enabled: %s", src.ID),
			Timestamp: time.Now(),
		})
	}
}

func (m *Manager) Stream(ctx context.Context, in chan StreamInput) (chan StreamOutput, error) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				// Close all sessions
				m.mux.Lock()
				for _, ms := range m.sessions {
					ms.cancel()
				}
				m.mux.Unlock()
				return

			case input := <-in:
				m.handleStreamCommand(input)
			}
		}
	}()

	return m.out, nil
}

func (m *Manager) handleStreamCommand(input StreamInput) {
	m.mux.Lock()
	ms, ok := m.sessions[input.SessionID]
	m.mux.Unlock()

	if !ok {
		m.log.Error("session not found for stream command", "session_id", input.SessionID)
		return
	}

	switch input.Command {
	case StreamCommandPause:
		ms.session.Status = LogSessionStatusPaused
	case StreamCommandResume:
		ms.session.Status = LogSessionStatusActive
	case StreamCommandClose:
		m.CloseSession(nil, input.SessionID)
	}
}

// startStreaming resolves sources and starts log streaming goroutines.
func (m *Manager) startStreaming(
	ctx context.Context,
	pluginctx *types.PluginContext,
	ms *managedSession,
	opts CreateSessionOptions,
) {
	defer close(ms.streamDone)
	logger := m.log.With("session_id", ms.session.ID)

	// Try to find a direct handler for this resource key
	handlerKey := m.findHandlerKey(opts.ResourceKey)
	if handlerKey != "" {
		handler := m.handlers[handlerKey]
		m.streamFromHandler(ctx, pluginctx, ms, handler, opts)
		return
	}

	// Try to find a source resolver for this resource key
	resolver, ok := m.resolvers[opts.ResourceKey]
	if !ok {
		logger.Error("no handler or resolver found for resource", "key", opts.ResourceKey)
		m.emitEvent(ms.session.ID, LogStreamEvent{
			Type:      StreamEventStreamError,
			Message:   fmt.Sprintf("no log handler found for resource type %s", opts.ResourceKey),
			Timestamp: time.Now(),
		})
		return
	}

	// Resolve sources
	result, err := resolver(pluginctx, opts.ResourceData, SourceResolverOptions{
		Watch:  opts.Options.Follow,
		Target: opts.Options.Target,
		Params: opts.Options.Params,
	})
	if err != nil {
		logger.Error("failed to resolve sources", "error", err)
		m.emitEvent(ms.session.ID, LogStreamEvent{
			Type:      StreamEventStreamError,
			Message:   fmt.Sprintf("failed to resolve sources: %v", err),
			Timestamp: time.Now(),
		})
		return
	}

	// Update active sources
	m.mux.Lock()
	ms.session.ActiveSources = result.Sources
	m.mux.Unlock()

	// Fan out to each source
	sem := make(chan struct{}, MaxConcurrentStreamsPerSession)
	var wg sync.WaitGroup

	for _, source := range result.Sources {
		wg.Add(1)
		sem <- struct{}{}

		go func(src LogSource) {
			defer wg.Done()
			defer func() { <-sem }()

			m.streamSource(ctx, pluginctx, ms, src, opts)
		}(source)
	}

	// Watch for dynamic source changes
	if result.Events != nil {
		go m.watchSourceEvents(ctx, pluginctx, ms, result.Events, opts, sem, &wg)
	}

	wg.Wait()
}

func (m *Manager) findHandlerKey(resourceKey string) string {
	for key := range m.handlers {
		// handler keys are stored as "plugin/resourceKey"
		parts := strings.SplitN(key, "/", 2)
		if len(parts) == 2 && parts[1] == resourceKey {
			return key
		}
	}
	return ""
}

func (m *Manager) streamFromHandler(
	ctx context.Context,
	pluginctx *types.PluginContext,
	ms *managedSession,
	handler Handler,
	opts CreateSessionOptions,
) {
	// Use the handler's SourceBuilder to create properly-labeled sources.
	// The SourceBuilder is plugin-specific: it knows how to extract sub-entities
	// (e.g., containers from a pod spec) and build sources with correct labels.
	var sources []LogSource
	if handler.SourceBuilder != nil {
		sources = handler.SourceBuilder(opts.ResourceID, opts.ResourceData, opts.Options)
	} else {
		// Fallback: single source with no labels (handler must handle this)
		sources = []LogSource{{ID: opts.ResourceID, Labels: make(map[string]string)}}
	}

	if len(sources) == 0 {
		m.log.Warn("source builder returned no sources", "resource_key", opts.ResourceKey)
		m.emitEvent(ms.session.ID, LogStreamEvent{
			Type:      StreamEventStreamError,
			Message:   "No log sources found for this resource",
			Timestamp: time.Now(),
		})
		return
	}

	m.mux.Lock()
	ms.session.ActiveSources = sources
	m.mux.Unlock()

	// Fan out to each source
	sem := make(chan struct{}, MaxConcurrentStreamsPerSession)
	var wg sync.WaitGroup

	for _, source := range sources {
		wg.Add(1)
		sem <- struct{}{}

		go func(src LogSource) {
			defer wg.Done()
			defer func() { <-sem }()
			m.streamSource(ctx, pluginctx, ms, src, opts)
		}(source)
	}

	wg.Wait()
}

func (m *Manager) streamSource(
	ctx context.Context,
	pluginctx *types.PluginContext,
	ms *managedSession,
	source LogSource,
	opts CreateSessionOptions,
) {
	logger := m.log.With("session_id", ms.session.ID, "source_id", source.ID)

	// Create per-source child context for individual cancellation
	sourceCtx, sourceCancel := context.WithCancel(ctx)
	ms.sourceMux.Lock()
	ms.sourceCtxs[source.ID] = sourceCancel
	ms.sourceMux.Unlock()

	defer func() {
		ms.sourceMux.Lock()
		delete(ms.sourceCtxs, source.ID)
		ms.sourceMux.Unlock()
	}()

	// Emit source added event
	if opts.Options.IncludeSourceEvents {
		m.emitEvent(ms.session.ID, LogStreamEvent{
			Type:      StreamEventSourceAdded,
			SourceID:  source.ID,
			Message:   fmt.Sprintf("Started streaming from %s", source.ID),
			Timestamp: time.Now(),
		})
	}

	req := LogStreamRequest{
		SourceID:          source.ID,
		Labels:            source.Labels,
		ResourceData:      opts.ResourceData,
		Target:            opts.Options.Target,
		Follow:            opts.Options.Follow,
		IncludePrevious:   opts.Options.IncludePrevious,
		IncludeTimestamps: opts.Options.IncludeTimestamps,
		TailLines:         opts.Options.TailLines,
		SinceSeconds:      opts.Options.SinceSeconds,
		SinceTime:         opts.Options.SinceTime,
		LimitBytes:        opts.Options.LimitBytes,
		Params:            opts.Options.Params,
	}

	handlerKey := m.findHandlerKey(opts.ResourceKey)
	if handlerKey == "" {
		// For resolved sources, find the handler from the resolver's target resource
		for key := range m.handlers {
			handlerKey = key
			break
		}
	}
	if handlerKey == "" {
		logger.Error("no handler found for streaming")
		return
	}

	handler := m.handlers[handlerKey]
	m.streamWithReconnect(sourceCtx, pluginctx, ms, handler, source, req, logger)
}

func (m *Manager) streamWithReconnect(
	ctx context.Context,
	pluginctx *types.PluginContext,
	ms *managedSession,
	handler Handler,
	source LogSource,
	req LogStreamRequest,
	logger hclog.Logger,
) {
	delay := ReconnectInitialDelay

	for attempt := 0; attempt <= ReconnectMaxAttempts; attempt++ {
		if ctx.Err() != nil {
			return
		}

		if attempt > 0 {
			m.emitEvent(ms.session.ID, LogStreamEvent{
				Type:      StreamEventReconnecting,
				SourceID:  source.ID,
				Message:   fmt.Sprintf("Reconnecting (attempt %d/%d)", attempt, ReconnectMaxAttempts),
				Timestamp: time.Now(),
			})

			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}

			delay *= 2
			if delay > ReconnectMaxDelay {
				delay = ReconnectMaxDelay
			}
		}

		reader, err := handler.Handler(pluginctx, req)
		if err != nil {
			logger.Error("failed to open log stream", "error", err, "attempt", attempt)
			continue
		}

		if attempt > 0 {
			m.emitEvent(ms.session.ID, LogStreamEvent{
				Type:      StreamEventReconnected,
				SourceID:  source.ID,
				Message:   "Reconnected",
				Timestamp: time.Now(),
			})
		}

		err = m.readStream(ctx, ms, source, reader)
		reader.Close()

		if ctx.Err() != nil {
			return
		}

		if err == nil || err == io.EOF {
			// Stream ended naturally (non-follow mode)
			if !req.Follow {
				return
			}
		}

		logger.Warn("log stream interrupted", "error", err, "source", source.ID)
	}

	m.emitEvent(ms.session.ID, LogStreamEvent{
		Type:      StreamEventStreamError,
		SourceID:  source.ID,
		Message:   fmt.Sprintf("Failed to reconnect after %d attempts", ReconnectMaxAttempts),
		Timestamp: time.Now(),
	})
}

func (m *Manager) readStream(
	ctx context.Context,
	ms *managedSession,
	source LogSource,
	reader io.ReadCloser,
) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, MaxScannerBuffer), MaxScannerBuffer)

	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		// Skip output if paused
		if ms.session.Status == LogSessionStatusPaused {
			continue
		}

		line := scanner.Bytes()
		ts, content := extractTimestamp(line)

		logLine := LogLine{
			SessionID: ms.session.ID,
			SourceID:  source.ID,
			Labels:    source.Labels,
			Timestamp: ts,
			Content:   string(content),
			Origin:    LogLineOriginCurrent,
		}

		m.out <- StreamOutput{
			SessionID: ms.session.ID,
			Line:      &logLine,
		}
	}

	return scanner.Err()
}

func (m *Manager) watchSourceEvents(
	ctx context.Context,
	pluginctx *types.PluginContext,
	ms *managedSession,
	events <-chan SourceEvent,
	opts CreateSessionOptions,
	sem chan struct{},
	wg *sync.WaitGroup,
) {
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-events:
			if !ok {
				return
			}

			switch event.Type {
			case SourceAdded:
				m.mux.Lock()
				ms.session.ActiveSources = append(ms.session.ActiveSources, event.Source)
				m.mux.Unlock()

				m.emitEvent(ms.session.ID, LogStreamEvent{
					Type:      StreamEventSourceAdded,
					SourceID:  event.Source.ID,
					Message:   fmt.Sprintf("Source added: %s", event.Source.ID),
					Timestamp: time.Now(),
				})

				wg.Add(1)
				sem <- struct{}{}
				go func(src LogSource) {
					defer wg.Done()
					defer func() { <-sem }()
					m.streamSource(ctx, pluginctx, ms, src, opts)
				}(event.Source)

			case SourceRemoved:
				m.mux.Lock()
				for i, s := range ms.session.ActiveSources {
					if s.ID == event.Source.ID {
						ms.session.ActiveSources = append(
							ms.session.ActiveSources[:i],
							ms.session.ActiveSources[i+1:]...,
						)
						break
					}
				}
				m.mux.Unlock()

				m.emitEvent(ms.session.ID, LogStreamEvent{
					Type:      StreamEventSourceRemoved,
					SourceID:  event.Source.ID,
					Message:   fmt.Sprintf("Source removed: %s", event.Source.ID),
					Timestamp: time.Now(),
				})
			}
		}
	}
}

func (m *Manager) emitEvent(sessionID string, event LogStreamEvent) {
	m.out <- StreamOutput{
		SessionID: sessionID,
		Event:     &event,
	}
}

// extractTimestamp tries to extract a timestamp from the beginning of a log line.
// Common formats: RFC3339, RFC3339Nano, K8s timestamp format.
// Returns the parsed timestamp and the remaining content.
func extractTimestamp(line []byte) (time.Time, []byte) {
	s := string(line)

	// Try common timestamp formats at the start of the line
	formats := []struct {
		length int
		layout string
	}{
		{30, time.RFC3339Nano},
		{25, time.RFC3339},
		{20, "2006-01-02T15:04:05Z"},
		{19, "2006-01-02T15:04:05"},
	}

	for _, f := range formats {
		if len(s) < f.length {
			continue
		}
		candidate := s[:f.length]
		ts, err := time.Parse(f.layout, candidate)
		if err == nil {
			rest := s[f.length:]
			rest = strings.TrimLeft(rest, " ")
			return ts, []byte(rest)
		}
	}

	return time.Now(), line
}
