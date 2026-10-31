package logs

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// HeadlessResult contains actual source output, never a fabricated resource body.
type HeadlessResult struct {
	Lines     []sdklogs.LogLine `json:"lines"`
	Truncated bool              `json:"truncated"`
	// Native APIs may apply tail/byte limits before host consumption.
	SourceMayBeTruncated bool `json:"source_may_be_truncated"`
}

type headlessRead struct {
	pluginID string
	mu       sync.Mutex
	done     chan struct{}
	result   HeadlessResult
	bytes    int
	limit    int
	ended    bool
	err      error
}

func (r *headlessRead) finish(err error) {
	if !r.ended {
		r.ended = true
		r.err = err
		close(r.done)
	}
}

func (r *headlessRead) accept(out sdklogs.StreamOutput) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.ended {
		return
	}
	if out.Event != nil {
		switch out.Event.Type {
		case sdklogs.StreamEventStreamError:
			r.finish(resourcev2.NewError("INTERNAL", "Log source failed."))
		case sdklogs.StreamEventStreamEnded:
			r.finish(nil)
		}
	}
	if out.Line != nil {
		encoded, err := json.Marshal(out.Line)
		if err != nil {
			r.finish(resourcev2.NewError("INTERNAL", "Log source returned invalid output."))
			return
		}
		size := len(encoded) + 1
		if len(r.result.Lines) >= r.limit || size > (1<<20)-128-r.bytes {
			r.result.Truncated = true
			r.finish(nil)
			return
		}
		r.bytes += size
		r.result.Lines = append(r.result.Lines, *out.Line)
	}
}

// ReadResourceLogs consumes a finite session through the existing logs engine.
// Authorization receives the original invocation principal, not a UI wrapper.
func (c *controller) ReadResourceLogs(ctx context.Context, pluginID string, opts sdklogs.CreateSessionOptions) (result *HeadlessResult, resultErr error) {
	if opts.Reference == nil || opts.Route == nil {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Resource reference and route are required.")
	}
	if err := opts.Validate(); err != nil {
		return nil, err
	}
	if opts.Options.Follow {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Headless logs cannot follow.")
	}
	if opts.Options.TailLines == 0 {
		opts.Options.TailLines = 200
	}
	if opts.Options.TailLines < 1 || opts.Options.TailLines > 5000 {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Tail must be between 1 and 5000 lines.")
	}
	opts.Options.LimitBytes = 1 << 20
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if c.referenceAdmitter == nil {
		return nil, resourcev2.NewError("UNSUPPORTED", "Resource reference admission is unavailable.")
	}
	admitted, err := c.referenceAdmitter(ctx, "logs.CreateSession", pluginID, *opts.Route, *opts.Reference)
	if err != nil {
		return nil, err
	}
	read := &headlessRead{pluginID: pluginID, done: make(chan struct{}), limit: int(opts.Options.TailLines)}
	read.result.SourceMayBeTruncated = true
	// Correlate before dispatch without holding the controller lock across RPC.
	// The selected provider remains the cleanup owner even after replacement.
	opts.SessionID = uuid.NewString()
	c.mu.Lock()
	client := c.clients[pluginID]
	provider, ok := client.(sdklogs.ResourceSessionProvider)
	if !ok {
		c.mu.Unlock()
		return nil, resourcev2.NewError("UNSUPPORTED", "Resource logs provider unavailable.")
	}
	if c.headless == nil {
		c.headless = make(map[string]*headlessRead)
	}
	c.headless[opts.SessionID] = read
	c.mu.Unlock()
	defer func() {
		read.mu.Lock()
		read.finish(context.Canceled)
		read.mu.Unlock()
		closeCtx, stop := context.WithTimeout(context.WithoutCancel(admitted), 5*time.Second)
		defer stop()
		// Rejected acquisition may never have registered the chosen ID.
		if closeErr := client.CloseSession(resourceLogPluginContext(closeCtx, opts.Route.Connection), opts.SessionID); closeErr != nil && resourcev2.ErrorCode(closeErr) != "NOT_FOUND" {
			if c.logger != nil {
				c.logger.Errorw(closeCtx, "resource log session cleanup failed", "session_id", opts.SessionID, "error", closeErr)
			}
			result = nil
			resultErr = errors.Join(resultErr, resourcev2.NewError("INTERNAL", "Log session cleanup failed."))
		}
		c.mu.Lock()
		delete(c.headless, opts.SessionID)
		c.mu.Unlock()
	}()
	pc := resourceLogPluginContext(admitted, opts.Route.Connection)
	session, err := provider.CreateResourceSession(pc, opts)
	if err != nil {
		return nil, err
	}
	if session == nil || session.ID != opts.SessionID {
		return nil, resourcev2.NewError("INTERNAL", "Log provider returned an invalid session.")
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-read.done:
		read.mu.Lock()
		defer read.mu.Unlock()
		return &read.result, read.err
	}
}

// Diagnostic request IDs enable the existing transport context adapter; they
// are correlation data, never an authenticated principal or a resource grant.
func resourceLogPluginContext(ctx context.Context, connectionID string) *sdktypes.PluginContext {
	pc := sdktypes.NewPluginContextWithConnection(ctx, "log", nil, nil, &sdktypes.Connection{ID: connectionID})
	if request, ok := invocation.FromContext(ctx); ok {
		pc.RequestID = request.ID()
	}
	return pc
}
