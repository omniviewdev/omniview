package mcprelay

import (
	"context"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
)

type authoritySessionKey struct{}
type authoritySession struct {
	id     string
	epoch  uint64
	ctx    context.Context
	cancel context.CancelFunc
}

// Session binds authenticated bearer possession to the SDK's actual native
// server-session object. The host issues an opaque ownership label, independent
// of transport IDs (which are legitimately empty for some SDK transports).
// A request header, client name or argument cannot issue this scope. Session
// closure cancels consent and accepted work.
func (a *Authority) Session(ctx context.Context, server *mcp.ServerSession) (context.Context, error) {
	if server == nil {
		return ctx, errAuthority
	}
	receipt, ok := ctx.Value(authorityContextKey{}).(*authorityCall)
	if !ok {
		return ctx, errAuthority
	}
	a.mu.Lock()
	// Streamable HTTP preserves the initialize request's private context values
	// for the native session, but its HTTP cancellation has already completed.
	// That value is a credential receipt, not the lifetime of later RPC work.
	if receipt.bound || receipt.principal.Origin() != invocation.ExternalAgent ||
		receipt.epoch != a.epoch || receipt.credential != a.credential || !a.cfg.Enabled {
		a.mu.Unlock()
		return ctx, errAuthority
	}
	session := a.sessionLocked(server)
	if session.epoch != a.epoch || session.ctx.Err() != nil {
		a.mu.Unlock()
		return ctx, errAuthority
	}
	scope := invocation.NewScope(invocation.ExternalAgent)
	sessionCtx, cancel := context.WithCancel(scope.Context(ctx))
	call := &authorityCall{principal: scope.Principal(), ctx: sessionCtx, cancel: cancel,
		credential: a.credential, session: session.id, id: uuid.NewString(), epoch: a.epoch}
	a.calls[call.principal.Owner()] = call
	stop := context.AfterFunc(session.ctx, cancel)
	context.AfterFunc(sessionCtx, func() { stop(); a.forget(call) })
	a.mu.Unlock()
	sessionCtx = context.WithValue(sessionCtx, authorityContextKey{}, call)
	return context.WithValue(sessionCtx, authoritySessionKey{}, session), nil
}
