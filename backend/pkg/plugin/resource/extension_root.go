package resource

import (
	"context"
	"slices"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/extensionread"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// A view receipt consists of a UUID, a colon and a decimal member revision.
const maxExtensionViewReceiptBytes = 36 + len(":") + maxSourceMemberRevisionDigits

// ExtensionRootProof is private broker input, not a capability or a Wails service.
// Owner names the point's plugin. The window principal must come from the native invocation.
type ExtensionRootProof struct {
	Owner          string                       `json:"owner"`
	Connection     string                       `json:"connection"`
	Reference      resourcev2.ResourceReference `json:"reference"`
	ViewID         string                       `json:"viewId"`
	ViewGeneration string                       `json:"viewGeneration"`
	RowKey         string                       `json:"rowKey"`
}

type extensionRootMember struct {
	header           *sourceMemberHeader // immutable revision; do not pin a source body or view
	sourceGeneration string
	admission        catalogAdmission
	window           invocation.Request
	route            resourcev2.AccessRoute
	targetID         string
}

// One selected related read per window; no second source interest, goroutine or work for unrelated rows.
type extensionRootWatch struct {
	view       *sourceView
	header     *sourceMemberHeader
	cancel     context.CancelFunc
	stopSource func() bool
}

func (c *controller) watchExtensionRoot(ctx context.Context, owner string, proof ExtensionRootProof, cancel context.CancelFunc) (func(), error) {
	if proof.Owner != owner || cancel == nil {
		return nil, unavailableExtensionRoot()
	}
	watch := &extensionRootWatch{view: nil, header: nil, cancel: cancel, stopSource: nil}
	if _, err := c.lookupExtensionRoot(ctx, proof, nil, watch); err != nil {
		return nil, err
	}
	return func() {
		v := watch.view
		v.mu.Lock()
		defer v.mu.Unlock()
		if v.rootRead == watch {
			watch.stopSource()
			v.rootRead = nil
		}
	}, nil
}

// Called under view.mu only with a native cancellation function; no subscriber or provider I/O runs here.
func (v *sourceView) cancelRootReadLocked() {
	if w := v.rootRead; w != nil {
		v.rootRead = nil
		w.stopSource()
		w.cancel()
	}
}

func unavailableExtensionRoot() error {
	return resourcev2.NewError("UNAVAILABLE", "No current authorized extension root is available.")
}

func exactRootReference(a, b resourcev2.ResourceReference) bool {
	return a.Address.Provider == b.Address.Provider && a.Address.Authority == b.Address.Authority &&
		a.Address.Type == b.Address.Type && a.Address.ID == b.Address.ID && slices.Equal(a.Address.Scope, b.Address.Scope) &&
		sameIncarnation(a.Incarnation, b.Incarnation)
}

// extensionRootMember resolves one indexed view and one indexed member. Rechecks compare the immutable
// member header, not just its UID: a result admitted before a same-incarnation update must not publish.
func (c *controller) extensionRootMember(ctx context.Context, proof ExtensionRootProof, expected *extensionRootMember) (extensionRootMember, error) {
	return c.lookupExtensionRoot(ctx, proof, expected, nil)
}

func (c *controller) lookupExtensionRoot(ctx context.Context, proof ExtensionRootProof, expected *extensionRootMember, watch *extensionRootWatch) (extensionRootMember, error) {
	var zero extensionRootMember
	if ctx == nil || proof.Owner == "" || proof.Connection == "" || proof.ViewID == "" || len(proof.ViewGeneration) > maxExtensionViewReceiptBytes ||
		proof.RowKey == "" || proof.Reference.Incarnation == nil || *proof.Reference.Incarnation == "" {
		return zero, unavailableExtensionRoot()
	}
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	viewGeneration, memberRevision, ok := strings.Cut(proof.ViewGeneration, ":")
	if !ok || memberRevision == "" || len(memberRevision) > maxSourceMemberRevisionDigits {
		return zero, unavailableExtensionRoot()
	}
	sc := c.sources
	sc.mu.Lock()
	v := sc.views[proof.ViewID]
	sc.mu.Unlock()
	if v == nil || v.session.pluginID != proof.Owner {
		return zero, unavailableExtensionRoot()
	}
	s := v.session
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.followsExtensionRootLocked(proof.Connection) {
		return zero, unavailableExtensionRoot()
	}

	// Reject foreign/released windows even if they saw the same broadcast event and every wire field.
	// Match the original native invocation, not an owner string sent by JavaScript. Release acquires
	// the session before the coordinator; never wait for a session under the coordinator lock.
	sc.mu.Lock()
	defer sc.mu.Unlock()
	window, owned := sc.extensionRootWindowLocked(ctx, v)
	if !owned {
		return zero, unavailableExtensionRoot()
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.closed || !v.synced || v.snapshotStatus != nil || v.generation != viewGeneration {
		return zero, unavailableExtensionRoot()
	}
	return c.bindExtensionRootMemberLocked(v, window, &proof, memberRevision, expected, watch)
}

func (s *sourceSession) followsExtensionRootLocked(connection string) bool {
	return !s.closed && s.hasSnapshot && s.status.State == sourceStateFollowing && s.status.Error == nil &&
		s.mode == resourcev2.SourceModeSnapshotAndUpdates && s.pluginGeneration != nil && s.target.Route.Connection == connection && s.generation != ""
}

func (sc *sourceCoordinator) extensionRootWindowLocked(ctx context.Context, v *sourceView) (invocation.Request, bool) {
	s := v.session
	interest := sc.viewInterests[v.id]
	if sc.views[v.id] != v || sc.sessions[s.key] != s || s.views[v.id] != v || interest == nil || interest.closed || interest.session != s {
		var noWindow invocation.Request
		return noWindow, false
	}
	window, ok := invocation.FromContext(interest.ctx)
	return window, ok && window.OwnedBy(ctx) && window.Principal().Origin() == invocation.TrustedUI && window.Principal().Owner() == v.owner && s.owner == v.owner
}

// The caller holds the session, coordinator and view locks, in that order.
func (c *controller) bindExtensionRootMemberLocked(v *sourceView, window invocation.Request, proof *ExtensionRootProof, memberRevision string, expected *extensionRootMember, watch *extensionRootWatch) (extensionRootMember, error) {
	var zero extensionRootMember
	s := v.session

	var key string
	if expected == nil {
		row, addressKey, err := rowIdentity(s.pluginGeneration.generationID, v.owner, v.targetID, s.target, proof.Reference)
		if err != nil || row != proof.RowKey {
			return zero, unavailableExtensionRoot()
		}
		key = addressKey
	} else {
		key = expected.header.key
	}
	member := s.members[key]
	if member.header == nil || member.ref == nil || member.admission == nil || member.admission != s.admission ||
		s.admissionContext != s.ctx || member.admission.generation != s.generation || member.header.key != key || member.header.memberRevision != memberRevision ||
		!exactRootReference(member.header.reference, proof.Reference) {
		return zero, unavailableExtensionRoot()
	}
	admission := captureCatalogAdmission(s.ctx, s.pluginGeneration)
	if admission.epoch.Connection != proof.Connection || (expected != nil &&
		(expected.header != member.header || expected.sourceGeneration != s.generation || expected.admission != admission)) {
		return zero, unavailableExtensionRoot()
	}
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	if err := c.currentGenerationLocked(s.ctx, proof.Owner, s.pluginGeneration); err != nil {
		return zero, err
	}
	if !c.referenceCurrentLocked(proof.Owner, s.target.Route, member.header.reference) {
		return zero, unavailableExtensionRoot()
	}
	if watch != nil {
		if v.rootRead != nil {
			return zero, unavailableExtensionRoot()
		}
		watch.view, watch.header = v, member.header
		watch.stopSource = context.AfterFunc(s.ctx, watch.cancel)
		v.rootRead = watch
	}
	return extensionRootMember{header: member.header, sourceGeneration: s.generation, admission: admission,
		window: window, route: s.target.Route, targetID: v.targetID}, nil
}

// AdmitExtensionRoot never turns list membership alone into Get permission. Check the exact resource under
// the current caller before dispatch and again before delivery. A finite/finished or retained view does
// not attest an object. Only the native reference and route leave this helper, never the body or the view.
func (c *controller) AdmitExtensionRoot(ctx context.Context, owner string, proof ExtensionRootProof) (resourcev2.ResourceReference, resourcev2.AccessRoute, func(context.Context) error, error) {
	var noRef resourcev2.ResourceReference
	var noRoute resourcev2.AccessRoute
	if proof.Owner != owner {
		return noRef, noRoute, nil, unavailableExtensionRoot()
	}
	member, lookupErr := c.extensionRootMember(ctx, proof, nil)
	if lookupErr != nil {
		return noRef, noRoute, nil, lookupErr
	}
	// Capture only native identity, independent of mutable input and of the caller's returned containers.
	proof.Reference = member.header.reference
	authorize := func(ctx context.Context) error {
		result, err := c.getExpected(extensionread.WithReplyLimit(ctx, maxEvidenceReplyBytes), owner, HostGetRequest{TargetID: member.targetID, Request: resourcev2.GetRequest{
			Route: member.route, Reference: copySourceReference(member.header.reference), Representation: member.header.representation.ID,
		}}, &member.admission)
		if err != nil {
			return err
		}
		size, err := resourcev2.RecordWireSize(result.Record)
		if err != nil || size > maxEvidenceReplyBytes {
			return unavailableExtensionRoot()
		}
		if result.Key != proof.RowKey || !exactRootReference(result.Record.Reference, member.header.reference) {
			return unavailableExtensionRoot()
		}
		_, err = c.extensionRootMember(ctx, proof, &member)
		return err
	}
	if err := authorize(ctx); err != nil {
		return noRef, noRoute, nil, err
	}
	guard := func(ctx context.Context) error {
		if _, err := c.extensionRootMember(ctx, proof, &member); err != nil {
			return err
		}
		return authorize(ctx)
	}
	return copySourceReference(member.header.reference), member.route, guard, nil
}
