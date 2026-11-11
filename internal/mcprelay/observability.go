package mcprelay

import (
	"context"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
)

//nolint:gochecknoglobals // Package tracer follows the host telemetry convention.
var tracer = otel.Tracer("omniview.mcprelay")

// relayMethods is the closed set of MCP methods that get their own span name.
// Client-chosen method strings outside the set collapse to "other" so span
// names stay bounded.
//
//nolint:gochecknoglobals // This immutable allowlist bounds telemetry cardinality.
var relayMethods = map[string]struct{}{
	"initialize": {}, "ping": {},
	"tools/list": {}, "tools/call": {},
	"resources/list": {}, "resources/read": {}, "resources/templates/list": {},
	"resources/subscribe": {}, "resources/unsubscribe": {},
	"prompts/list": {}, "prompts/get": {},
	"completion/complete": {}, "logging/setLevel": {},
}

// observeMiddleware spans every relayed MCP request as mcp.relay.<method>.
// Arguments, results and error text are never exported; tool calls carry only
// the registered tool name.
//
//nolint:gocognit // Middleware keeps request classification and span completion together.
func (r *Relay) observeMiddleware() mcp.Middleware {
	return func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			name := method
			if _, ok := relayMethods[method]; !ok {
				name = "other"
			}
			ctx, span := tracer.Start(ctx, "mcp.relay."+name)
			start := time.Now()
			tool := ""
			if method == "tools/call" {
				if params, ok := req.GetParams().(*mcp.CallToolParamsRaw); ok {
					tool = r.registeredToolName(params.Name)
					span.SetAttributes(attribute.String("tool", tool))
				}
			}

			result, err := next(ctx, method, req)

			outcome, class := "success", ""
			switch {
			case err != nil:
				outcome, class = "failure", telemetryutil.ErrorClass(err)
				if class == "canceled" {
					outcome = "canceled"
				}
			default:
				if call, ok := result.(*mcp.CallToolResult); ok && call != nil && call.IsError {
					outcome, class = "failure", "tool_error"
				}
			}
			elapsed := time.Since(start)
			span.SetAttributes(
				attribute.String("outcome", outcome),
				attribute.Int64("duration_ms", elapsed.Milliseconds()),
			)
			if class != "" {
				span.SetAttributes(attribute.String("error_class", class))
				span.SetStatus(codes.Error, class)
			}
			span.End()
			if method != "ping" {
				r.log.Debugw(ctx, "mcp relay request",
					"method", name, "tool", tool, "outcome", outcome, "errorClass", class,
					"durationMs", elapsed.Milliseconds())
			}
			return result, err
		}
	}
}

// registeredToolName returns the name only when it is a published tool, so
// client-chosen strings never reach spans or logs.
func (r *Relay) registeredToolName(name string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.registered[name] {
		return name
	}
	return "unknown"
}

// onInitialized logs client connect and, once the session ends, disconnect.
// The client-supplied implementation name is not recorded.
func (r *Relay) onInitialized(ctx context.Context, req *mcp.InitializedRequest) {
	session := req.Session
	if session == nil {
		return
	}
	connectedAt := time.Now()
	sessionID := session.ID()
	r.log.Infow(ctx, "mcp relay client connected", "sessionID", sessionID)
	go func() {
		_ = session.Wait() // the transport's own end-of-session reason; classified by the disconnect log only
		r.log.Infow(context.WithoutCancel(ctx), "mcp relay client disconnected",
			"sessionID", sessionID, "durationMs", time.Since(connectedAt).Milliseconds())
	}()
}

// logAuthRejected records a rejected request without any request data: only the
// closed rejection reason is logged, never the token, headers or peer.
func (r *Relay) logAuthRejected(ctx context.Context, reason string) {
	r.log.Warnw(ctx, "mcp relay authentication failed", "reason", reason)
}

// errorLogFields returns log fields describing err by class and Go type only.
// Provider-, filesystem- and network-originated error text is never logged.
func errorLogFields(err error, kv ...any) []any {
	return append(kv, "errorClass", telemetryutil.ErrorClass(err), "errorType", fmt.Sprintf("%T", err))
}
