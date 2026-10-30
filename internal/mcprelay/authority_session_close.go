package mcprelay

import (
	"context"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// sessionLocked retains a native session's ownership until SDK drain completes.
// A canceled entry also fences a first tool call racing with DELETE admission.
func (a *Authority) sessionLocked(server *mcp.ServerSession) *authoritySession {
	if a.sessions == nil {
		a.sessions = map[*mcp.ServerSession]*authoritySession{}
	}
	session := a.sessions[server]
	if session != nil {
		return session
	}
	sessionCtx, cancel := context.WithCancel(context.Background())
	session = &authoritySession{id: uuid.NewString(), epoch: a.epoch, ctx: sessionCtx, cancel: cancel}
	a.sessions[server] = session
	go func(owned *authoritySession) {
		_ = server.Wait()
		owned.cancel()
		a.mu.Lock()
		if a.sessions[server] == owned {
			delete(a.sessions, server)
		}
		a.mu.Unlock()
	}(session)
	return session
}

// CloseSession retires work at close START, before the transport asks the SDK
// to gracefully drain active RPCs. Waiting for ServerSession.Wait alone creates
// a cycle: drain waits for a consent-blocked RPC which still accepts approval.
// The authenticated HTTP layer must resolve its session selector against the
// server's actual native sessions and pass that object, never a client identity.
func (a *Authority) CloseSession(ctx context.Context, server *mcp.ServerSession) error {
	if server == nil || ctx == nil || ctx.Err() != nil {
		return errAuthority
	}
	receipt, ok := ctx.Value(authorityContextKey{}).(*authorityCall)
	if !ok {
		return errAuthority
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if receipt.bound || !a.allowedLocked(receipt) {
		return errAuthority
	}
	session := a.sessionLocked(server)
	if session.epoch != a.epoch {
		return errAuthority
	}
	session.cancel()
	// AfterFunc propagation is asynchronous. Cancel matching calls directly so
	// approval/dispatch cannot win after this method's close-start boundary.
	for _, call := range a.calls {
		if call.session == session.id {
			call.cancel()
		}
	}
	return nil
}
