package resource

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/resourceauthoring"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// authoringState is the controller's authoring bookkeeping: the per-document
// supersession registry and the limits it enforces. The zero value is ready; the
// registry is created on first use with the default policy unless a policy was
// set before then.
type authoringState struct {
	once     sync.Once
	policy   resourceauthoring.Policy
	sessions *resourceauthoring.Sessions
}

func (a *authoringState) use() (*resourceauthoring.Sessions, resourceauthoring.Policy) {
	a.once.Do(func() {
		if a.policy == (resourceauthoring.Policy{}) {
			a.policy = resourceauthoring.DefaultPolicy()
		}
		a.sessions = resourceauthoring.NewSessions(a.policy)
	})
	return a.sessions, a.policy
}

// isDenialCode reports codes where permission dominates: an authoring response
// must be a safe error, never an empty success that hides the denial.
func isDenialCode(code string) bool {
	return code == "FORBIDDEN" || code == "UNAUTHORIZED" || code == "PERMISSION_DENIED"
}

// CompletePredicate returns the edits valid at one cursor of one predicate
// draft (P16, contract omniview.authoring.v1). Every part of the answer comes
// from state the host admitted itself: the catalog snapshot of the route, the
// resolved schema, the connection's access generation and the invocation's
// principal. The request supplies only the draft, the cursor, the target to
// admit and what the caller last observed; an observation that no longer holds
// rejects the request with RESET_REQUIRED instead of answering for a state the
// caller does not have.
//
// The call is one active request per document and owner: a newer request
// supersedes the one in flight (CANCELLED) and a request older than one already
// seen is refused. It is bounded in suggestions, response bytes, traversal and
// time, and it honors cancellation before every expensive step and before it
// returns.
func (c *controller) CompletePredicate(ctx context.Context, pluginID string, request resourceauthoring.CompletionRequest) (out resourceauthoring.CompletionResponse, retErr error) {
	ctx, end := h3StartOperation(
		ctx,
		"resource.CompletePredicate",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", request.Target.Route.Connection),
		attribute.String("resource_type", request.Target.Type),
	)
	defer end(&retErr)
	ctx, err := c.admit(ctx, "resource.CompletePredicate", ancillaryTarget(pluginID, request.Target.Route, request.Target.Type, resourcev2.ResourceReference{}, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	sessions, policy := c.authoring.use()
	if err := resourceauthoring.ValidateRequest(request, policy); err != nil {
		return out, err
	}
	admitted, _ := invocation.FromContext(ctx)
	principal := admitted.Principal()
	requestCtx, release, err := sessions.Begin(ctx, principal.Owner(), request.DocumentID, request.DocumentRevision)
	if err != nil {
		return out, err
	}
	defer release()
	if policy.Deadline > 0 {
		var cancel context.CancelFunc
		requestCtx, cancel = context.WithTimeout(requestCtx, policy.Deadline)
		defer cancel()
	}
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(requestCtx, pluginID, request.Target.Route)
	if err != nil {
		return out, resourceauthoring.SupersededError(requestCtx, err)
	}
	defer cleanup()
	sessionCtx, snapshot, err := c.observeSchemaCatalog(sessionCtx, pluginID, provider, generation, request.Target.Route)
	if err != nil {
		return out, resourceauthoring.SupersededError(sessionCtx, err)
	}
	epoch, _ := sessionCtx.Value(sourceEpochKey{}).(sourceEpochSnapshot)
	out, err = c.completeAgainstSnapshot(sessionCtx, pluginID, provider, generation.generationID, epoch, principal, snapshot, request, policy)
	if err != nil {
		return resourceauthoring.CompletionResponse{}, resourceauthoring.SupersededError(sessionCtx, err)
	}
	out, err = ancillaryResult(c, sessionCtx, pluginID, generation, out, nil)
	return out, resourceauthoring.SupersededError(sessionCtx, err)
}

// completeAgainstSnapshot admits the target against the observed catalog
// snapshot, resolves its schema and runs the completion engine.
func (c *controller) completeAgainstSnapshot(ctx context.Context, pluginID string, provider ResourceProvider, generationID string, epoch sourceEpochSnapshot, principal invocation.Principal, snapshot *resourcecatalog.Snapshot, request resourceauthoring.CompletionRequest, policy resourceauthoring.Policy) (resourceauthoring.CompletionResponse, error) {
	target := request.Target
	representation := target.Representation
	var descriptor *resourcev2.ResourceType
	for _, entry := range snapshot.Entries() {
		if entry.Type == target.Type {
			descriptor = &entry.Descriptor
			break
		}
	}
	if descriptor == nil {
		return resourceauthoring.CompletionResponse{}, resourcev2.NewError("NOT_FOUND", "Resource type is not in the route catalog.")
	}
	if representation == "" {
		representation = descriptor.DefaultRepresentation
		if representation == "" {
			return resourceauthoring.CompletionResponse{}, resourcev2.NewError("INVALID_REQUEST", "representation is required for types without a default")
		}
	}
	scope, err := normalizeQueryScope(*descriptor, target.Scope)
	if err != nil {
		return resourceauthoring.CompletionResponse{}, err
	}
	entry, err := snapshot.Entry(target.Type, representation)
	if err != nil {
		return resourceauthoring.CompletionResponse{}, err
	}
	if err := ctx.Err(); err != nil {
		return resourceauthoring.CompletionResponse{}, err
	}
	schema, resolveErr := entry.Resolve(ctx, schemaDocumentSource(provider, target.Route))
	if resolveErr != nil {
		code := resourcev2.ErrorCode(resolveErr)
		deterministic := isDeterministicSchemaCode(code) || entry.Binding.State == "unavailable"
		if isDenialCode(code) || isSchemaLifecycleCode(code) || !deterministic {
			return resourceauthoring.CompletionResponse{}, resolveErr
		}
		schema = nil
	}
	overlay := resourcecatalog.OverlayFor(entry, schema, resolveErr)
	environment, err := celtypes.NewEnvironment(snapshot.Revision(), entry, schema)
	if err != nil {
		return resourceauthoring.CompletionResponse{}, err
	}
	identity := resourceauthoring.Identity{
		Plugin:                 pluginID,
		Provider:               snapshot.Provider(),
		Connection:             target.Route.Connection,
		Type:                   target.Type,
		Representation:         representation,
		ScopeKey:               resourceauthoring.ScopeKey(scope),
		CatalogRevision:        snapshot.Revision(),
		RepresentationRevision: entry.RepresentationRevision,
		EnvironmentRevision:    resourceauthoring.EnvironmentRevision(environment.Revision, request.Declarations),
		AccessGeneration: resourceauthoring.AccessGeneration(
			generationID, target.Route.Connection, strconv.FormatUint(epoch.Epoch, 10),
			string(principal.Origin()), principal.Owner(), principal.Generation()),
	}
	if entry.Binding.Revision != nil {
		identity.SchemaRevision = *entry.Binding.Revision
	}
	if stale := resourceauthoring.StaleMembers(request, identity); len(stale) > 0 {
		return resourceauthoring.CompletionResponse{}, resourcev2.NewError("RESET_REQUIRED", "Authoring identity is stale: "+strings.Join(stale, ", ")+".")
	}
	return resourceauthoring.Complete(ctx, resourceauthoring.Input{
		Request:  request,
		Identity: identity,
		Schema:   schema,
		Summary: resourceauthoring.SchemaSummary{
			State: entry.Binding.State, Dialect: entry.Binding.Dialect, Validation: overlay.Validation,
			HostEvaluation: overlay.HostEvaluation, HostEvaluationCode: overlay.HostEvaluationCode,
		},
		Navigation: resourcecatalog.DefaultPolicy(),
		Policy:     policy,
	})
}
