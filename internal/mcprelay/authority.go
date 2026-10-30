package mcprelay

import (
	"context"
	"errors"
	"maps"
	"reflect"
	"sync"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
)

var errAuthority = errors.New("external invocation is no longer permitted")

type authorityContextKey struct{}
type authorityCall struct {
	principal               invocation.Principal
	ctx                     context.Context
	cancel                  context.CancelFunc
	credential, session, id string
	epoch, policy, catalog  uint64
	tool                    ToolInfo
	connection              string
	arguments               []byte
	operation               string
	target                  invocation.Target
	bound, dispatched       bool
	confirm, approved       bool
	config                  Config
}

// Authority owns the relay's credential epoch and immutable call observations.
// A shared bearer proves possession of one credential, not a client name or a
// distinct person. Consent uses a host-issued scope for the SDK server session;
// clients sharing the bearer still share its policy and can use each other's
// session identifiers. Session IDs are ownership labels, not second credentials.
// Retirement invalidates every credential and session scope.
//
// Policy updates and dispatch admission linearize under mu. An update that wins
// admission prevents dispatch. An update after admission cancels accepted work
// and fences its result; native side effects already started cannot be undone.
// No authority lock is held across a provider call or native resource lock.
type Authority struct {
	mu                     sync.Mutex
	cfg                    Config
	credential             string
	epoch, policy, catalog uint64
	tools                  []ToolInfo
	calls                  map[string]*authorityCall
	audit                  func(AuditEvent)
	sessions               map[*mcp.ServerSession]*authoritySession
}

func NewAuthority() *Authority {
	return &Authority{cfg: DefaultConfig("unconfigured"), credential: uuid.NewString(), calls: map[string]*authorityCall{}}
}

// Authenticate is called only after the listener has checked the bearer.
// Neither MCP client information nor tool arguments are used as identity.
func (a *Authority) Authenticate(ctx context.Context) context.Context {
	a.mu.Lock()
	defer a.mu.Unlock()
	scope := invocation.NewScope(invocation.ExternalAgent)
	callCtx, cancel := context.WithCancel(scope.Context(ctx))
	c := &authorityCall{principal: scope.Principal(), ctx: callCtx, cancel: cancel,
		credential: a.credential, session: uuid.NewString(), id: uuid.NewString(), epoch: a.epoch}
	a.calls[c.principal.Owner()] = c
	context.AfterFunc(callCtx, func() { a.forget(c) })
	return context.WithValue(callCtx, authorityContextKey{}, c)
}

func (a *Authority) forget(c *authorityCall) {
	a.mu.Lock()
	if a.calls[c.principal.Owner()] == c {
		delete(a.calls, c.principal.Owner())
	}
	a.mu.Unlock()
}

func (a *Authority) retireLocked() {
	a.epoch++
	a.credential = uuid.NewString()
	for _, c := range a.calls {
		c.cancel()
	}
	for _, session := range a.sessions {
		session.cancel()
	}
	a.calls = map[string]*authorityCall{}
}

// Retire revokes listener, credential and all outstanding consent ownership.
func (a *Authority) Retire() { a.mu.Lock(); a.retireLocked(); a.mu.Unlock() }

func (a *Authority) UpdatePolicy(cfg Config) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if reflect.DeepEqual(a.cfg, cfg) {
		return
	}
	a.policy++
	for _, c := range a.calls {
		if c.bound {
			c.cancel()
		}
	}
	if a.cfg.Token != cfg.Token || a.cfg.Port != cfg.Port || a.cfg.Enabled != cfg.Enabled {
		a.retireLocked()
	}
	a.cfg = cfg.clone()
}

func (a *Authority) UpdateCatalog(tools []ToolInfo) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if reflect.DeepEqual(a.tools, tools) {
		return
	}
	a.catalog++
	for _, c := range a.calls {
		if c.bound {
			c.cancel()
		}
	}
	a.tools = append([]ToolInfo(nil), tools...)
}

func (a *Authority) allowedLocked(c *authorityCall) bool {
	if c.ctx.Err() != nil || c.epoch != a.epoch || !a.cfg.Enabled || a.calls[c.principal.Owner()] != c {
		return false
	}
	if !c.bound {
		return true
	}
	if c.policy != a.policy || c.catalog != a.catalog || c.tool.Status != StatusOK {
		return false
	}
	found := false
	for _, t := range a.tools {
		if reflect.DeepEqual(t, c.tool) {
			found = true
			break
		}
	}
	if !found {
		return false
	}
	if c.connection != "" {
		return a.cfg.ConnectionEnabled(c.tool.PluginID, c.connection, c.tool)
	}
	return a.cfg.GlobalEnabled(c.tool)
}

// Bind captures arguments and target before consent. Callers must pass the
// returned context unchanged to both consent and actual native dispatch.
func (a *Authority) Bind(ctx context.Context, tool ToolInfo, connection string, args []byte) (context.Context, error) {
	parent, ok := ctx.Value(authorityContextKey{}).(*authorityCall)
	if !ok {
		return ctx, errAuthority
	}
	session, ok := ctx.Value(authoritySessionKey{}).(*authoritySession)
	if !ok || session.ctx.Err() != nil {
		return ctx, errAuthority
	}
	target := invocation.Target{Provider: tool.PluginID, Connection: connection, Action: tool.Name}
	operation := "tools.call"
	if tool.BuiltIn {
		operation = "resource.ListConnections"
		target = invocation.Target{Provider: tool.PluginID}
	}
	if tool.Resource != nil {
		var err error
		target, err = tool.Resource.InvocationTarget(args)
		if err != nil {
			return ctx, err
		}
		operation = tool.Resource.Operation
		if connection != "" && connection != target.Connection {
			return ctx, errAuthority
		}
		connection = target.Connection
	}
	if tool.Resource == nil && tool.Scope == ScopeConnection && connection == "" {
		return ctx, errAuthority
	}
	a.mu.Lock()
	if !a.allowedLocked(parent) || session.epoch != a.epoch {
		a.mu.Unlock()
		a.Record(ctx, "admission-denied")
		return ctx, errAuthority
	}
	scope := invocation.NewScope(invocation.ExternalAgent)
	callCtx, cancel := context.WithCancel(scope.Context(ctx))
	c := &authorityCall{principal: scope.Principal(), ctx: callCtx, cancel: cancel,
		credential: parent.credential, session: session.id, id: uuid.NewString(), epoch: a.epoch,
		policy: a.policy, catalog: a.catalog, tool: tool, connection: connection,
		arguments: append([]byte(nil), args...), operation: operation, target: target, bound: true}
	c.confirm = a.cfg.Confirm(tool.PluginID, connection, tool)
	// Authority replaces its document on update; the captured maps remain
	// immutable and share the exact revision used to bind consent.
	c.config = a.cfg
	c.target.Scope = maps.Clone(target.Scope)
	a.calls[c.principal.Owner()] = c
	if !a.allowedLocked(c) {
		delete(a.calls, c.principal.Owner())
		cancel()
		a.mu.Unlock()
		a.Record(context.WithValue(callCtx, authorityContextKey{}, c), "admission-denied")
		return ctx, errAuthority
	}
	context.AfterFunc(callCtx, func() { a.forget(c) })
	boundCtx := context.WithValue(callCtx, authorityContextKey{}, c)
	a.mu.Unlock()
	a.Record(boundCtx, "admitted")
	return boundCtx, nil
}

// Dispatch admits once, then fences cancellation and retirement before returning
// any result. The callback must use its supplied context, never a UI/host scope.
// Completion cancels the bound context to release ownership. Callers must use
// the returned error, not that context's post-completion Err, to classify native
// failure; only the original transport context can establish caller cancellation.
func (a *Authority) Dispatch(ctx context.Context, fn func(context.Context) error) error {
	c, ok := ctx.Value(authorityContextKey{}).(*authorityCall)
	if !ok {
		return errAuthority
	}
	a.mu.Lock()
	if !c.bound || c.dispatched || (c.confirm && !c.approved) || !a.allowedLocked(c) {
		a.mu.Unlock()
		a.Record(ctx, "dispatch-denied")
		return errAuthority
	}
	c.dispatched = true
	a.mu.Unlock()
	a.Record(ctx, "dispatched")
	err := fn(ctx)
	a.mu.Lock()
	valid := a.allowedLocked(c)
	delete(a.calls, c.principal.Owner())
	a.mu.Unlock()
	c.cancel()
	if !valid {
		a.Record(ctx, "result-retired")
		return errAuthority
	}
	if err != nil {
		a.Record(ctx, "failed")
	} else {
		a.Record(ctx, "succeeded")
	}
	return err
}

// Authorize is the single native invocation authorizer. Relay policy is checked
// here against the actual operation and target, not against an MCP tool hint.
func (a *Authority) Authorize(p invocation.Principal, operation string, target invocation.Target) error {
	if p.Origin() == invocation.Host || p.Origin() == invocation.TrustedUI {
		return nil
	}
	if p.Origin() != invocation.ExternalAgent {
		return errAuthority
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	c := a.calls[p.Owner()]
	if c == nil || c.principal != p || !a.allowedLocked(c) {
		return errAuthority
	}
	if !c.bound {
		switch operation {
		case "resource.ListConnections":
			if a.cfg.PluginOn(target.Provider) {
				return nil
			}
		case "resource.GetConnection":
			if a.cfg.PluginOn(target.Provider) && a.cfg.ConnectionAccess(target.Provider, target.Connection) {
				return nil
			}
		}
		return errAuthority
	}
	if !c.dispatched || operation != c.operation {
		return errAuthority
	}
	// The native boundary alone derives query-scope after validating an exact
	// reference. It may add that scope, never change the bound address or route.
	if c.target.Object != "" && c.target.Scope["query-scope"] == "" {
		target.Scope = maps.Clone(target.Scope)
		delete(target.Scope, "query-scope")
	}
	if !reflect.DeepEqual(target, c.target) {
		return errAuthority
	}
	return nil
}

// Confirmation binds presentation to the same immutable record used at dispatch.
func (a *Authority) Confirmation(ctx context.Context, payload PendingConfirmation) PendingConfirmation {
	c, ok := ctx.Value(authorityContextKey{}).(*authorityCall)
	if !ok || !c.bound {
		return payload
	}
	payload.Origin = string(c.principal.Origin())
	payload.CredentialID, payload.SessionID, payload.InvocationID = c.credential, c.session, c.id
	payload.PolicyRevision, payload.CatalogRevision = c.policy, c.catalog
	payload.Target = c.target
	payload.Target.Scope = maps.Clone(c.target.Scope)
	payload.ArgumentsJSON = string(c.arguments)
	return payload
}
