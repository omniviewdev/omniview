// Package invocation owns host-issued provenance, request admission and ownership.
// Route IDs and SDK diagnostic metadata are never authenticated principals.
package invocation

import (
	"context"
	"maps"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

type Origin string

const (
	Host          Origin = "host"
	TrustedUI     Origin = "trusted-ui"
	ExternalAgent Origin = "external-agent"
)

type principalKey struct{}
type requestKey struct{}

// Principal can only be issued by native host code. Initial generation reserves
// an ownership slot; it does not implement revocation or policy change detection.
type Principal struct {
	owner      string
	origin     Origin
	generation string
}

func (p Principal) Owner() string      { return p.owner }
func (p Principal) Origin() Origin     { return p.origin }
func (p Principal) Generation() string { return p.generation }

type Scope struct{ principal Principal }

func NewScope(origin Origin) *Scope {
	if origin != Host && origin != TrustedUI && origin != ExternalAgent {
		panic("invalid host invocation origin")
	}
	return &Scope{principal: Principal{owner: uuid.NewString(), origin: origin, generation: "initial"}}
}
func (s *Scope) Principal() Principal { return s.principal }
func (s *Scope) Context(ctx context.Context) context.Context {
	return context.WithValue(ctx, principalKey{}, s.principal)
}

var hostScope = NewScope(Host)

// HostContext is native lifecycle/service provenance, never a frontend binding.
func HostContext(ctx context.Context) context.Context { return hostScope.Context(ctx) }

// Target is access-route input, not canonical resource identity or a grant.
type Target struct {
	Provider     string
	Connection   string
	ResourceType string
	Object       string
	Action       string
	Scope        map[string]string
}

func (t Target) clone() Target { t.Scope = maps.Clone(t.Scope); return t }

type Request struct {
	id        string
	operation string
	target    Target
	principal Principal
	boundary  *Boundary
}

func (r Request) ID() string           { return r.id }
func (r Request) Operation() string    { return r.operation }
func (r Request) Target() Target       { return r.target.clone() }
func (r Request) Principal() Principal { return r.principal }
func (r Request) OwnedBy(ctx context.Context) bool {
	principal, ok := ctx.Value(principalKey{}).(Principal)
	return ok && principal.owner != "" && principal == r.principal
}
func FromContext(ctx context.Context) (Request, bool) {
	if ctx == nil {
		return Request{}, false
	}
	request, ok := ctx.Value(requestKey{}).(Request)
	return request, ok
}

type Authorizer interface {
	Authorize(Principal, string, Target) error
}
type AuthorizeFunc func(Principal, string, Target) error

func (f AuthorizeFunc) Authorize(p Principal, op string, target Target) error {
	return f(p, op, target)
}

type Boundary struct{ authorizer Authorizer }

func NewBoundary(authorizer Authorizer) *Boundary { return &Boundary{authorizer: authorizer} }
func (b *Boundary) Admit(ctx context.Context, operation string, target Target) (context.Context, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	requestID := uuid.NewString()
	if err := ctx.Err(); err != nil {
		return ctx, apperror.ForResource(err, requestID)
	}
	principal, ok := ctx.Value(principalKey{}).(Principal)
	if !ok || principal.owner == "" || (principal.origin != Host && principal.origin != TrustedUI && principal.origin != ExternalAgent) {
		return ctx, apperror.ForResource(apperror.Forbidden("Access denied", "This operation requires a host-issued invocation."), requestID)
	}
	if operation == "" {
		return ctx, apperror.ForResource(apperror.New(apperror.TypeValidation, 400, "Invalid request", "An operation is required."), requestID)
	}
	target = target.clone()
	// External callers always require the host's authorizer. A missing policy
	// dependency must not turn an authenticated credential into unrestricted access.
	if principal.origin == ExternalAgent && (b == nil || b.authorizer == nil) {
		return ctx, apperror.ForResource(apperror.Forbidden("Access denied", "External operations require host authorization."), requestID)
	}
	if b != nil && b.authorizer != nil {
		if err := b.authorizer.Authorize(principal, operation, target.clone()); err != nil {
			return ctx, apperror.ForResource(apperror.Forbidden("Access denied", "The operation is not permitted."), requestID)
		}
	}
	request := Request{id: requestID, operation: operation, target: target, principal: principal, boundary: b}
	return context.WithValue(ctx, requestKey{}, request), nil
}

// Reauthorize refines an existing reference request with its catalogue-derived
// query scope. It never issues a new identity, changes the bound resource, or
// treats an earlier allow decision as permission for the refined scope.
func (b *Boundary) Reauthorize(ctx context.Context, target Target) (context.Context, error) {
	request, ok := FromContext(ctx)
	if !ok || request.id == "" || request.operation == "" || request.boundary != b || !request.OwnedBy(ctx) {
		return ctx, apperror.ForResource(apperror.Forbidden("Access denied", "An existing host-issued invocation is required."), "")
	}
	if err := ctx.Err(); err != nil {
		return ctx, apperror.ForResource(err, request.id)
	}
	current := request.target
	if current.Provider == "" || current.ResourceType == "" || current.Object == "" ||
		target.Provider != current.Provider || target.Connection != current.Connection ||
		target.ResourceType != current.ResourceType || target.Object != current.Object || target.Action != current.Action {
		return ctx, apperror.ForResource(apperror.Forbidden("Access denied", "An invocation cannot be retargeted."), request.id)
	}
	for key, value := range current.Scope {
		if refined, present := target.Scope[key]; !present || refined != value {
			return ctx, apperror.ForResource(apperror.Forbidden("Access denied", "An invocation cannot change its bound scope."), request.id)
		}
	}
	for key := range target.Scope {
		if _, present := current.Scope[key]; !present && key != "query-scope" {
			return ctx, apperror.ForResource(apperror.Forbidden("Access denied", "Only a derived query scope may refine an invocation."), request.id)
		}
	}
	target = target.clone()
	if b != nil && b.authorizer != nil {
		if err := b.authorizer.Authorize(request.principal, request.operation, target.clone()); err != nil {
			return ctx, apperror.ForResource(apperror.Forbidden("Access denied", "The operation is not permitted."), request.id)
		}
	}
	request.target = target
	return context.WithValue(ctx, requestKey{}, request), nil
}
