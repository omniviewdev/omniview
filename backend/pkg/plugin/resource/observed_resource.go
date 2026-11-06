package resource

import (
	"context"
	"reflect"
	"sort"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ReadObservedResource is trusted host wiring, not a plugin-facing body grant.
// It returns only schema-approved scalar paths from an immutable owner source.
// Missing observations never fall back to an upstream resource Get. The guard
// must run before publishing derived results, including completed-cache hits.
func (c *controller) ReadObservedResource(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference, paths []string) (*resourcev2.Value, func(context.Context) error, error) {
	if len(paths) == 0 || len(paths) > 16 {
		return nil, nil, resourcev2.NewError("INVALID_REQUEST", "One to sixteen public scalar paths are required.")
	}
	paths = append([]string(nil), paths...)
	for _, path := range paths {
		if _, err := observedPublicPointer(path); err != nil {
			return nil, nil, err
		}
	}
	return c.readObservedResource(ctx, "resource.Get", pluginID, route, reference, paths, nil, false)
}

// GuardObservedReference authorizes native metrics without resource.Get or a
// resource body grant. Same-incarnation updates remain valid; source generation,
// owner authorization, schema binding and authority retirement do not.
func (c *controller) GuardObservedReference(ctx context.Context, operation, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (func(context.Context) error, error) {
	if operation != "metric.Query" && operation != "metric.Subscribe" {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Unsupported observed identity operation.")
	}
	_, guard, err := c.readObservedResource(ctx, operation, pluginID, route, reference, nil, nil, true)
	return guard, err
}

func (c *controller) readObservedResource(ctx context.Context, operation, pluginID string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference, paths []string, expected *sourceSession, identityOnly bool) (_ *resourcev2.Value, _ func(context.Context) error, retErr error) {
	ctx, err := c.admit(ctx, operation, referenceTarget(pluginID, route, reference))
	if err != nil {
		return nil, nil, err
	}
	defer finishResource(ctx, &retErr)
	if err := resourcev2.ValidateGetRequest(resourcev2.GetRequest{Route: route, Reference: reference, Representation: "native"}); err != nil {
		return nil, nil, err
	}
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return nil, nil, err
	}
	defer cleanup()
	ctx, catalog, err := c.admitAncillaryCatalog(ctx, pluginID, provider, generation, route, reference.Address.Type, &reference)
	if err != nil {
		return nil, nil, err
	}
	var descriptor resourcev2.ResourceType
	for _, candidate := range catalog.Types {
		if candidate.Type == reference.Address.Type {
			descriptor = candidate
			break
		}
	}
	representation := descriptor.DefaultRepresentation
	if representation == "" {
		representation = "native"
	}
	if !identityOnly {
		if _, err := resourcev2.AdmitCatalogOperation(catalog, resourcev2.GetRequest{Route: route, Reference: reference, Representation: representation}); err != nil {
			return nil, nil, err
		}
	}
	scope, err := resourcev2.ScopeForAddress(reference.Address, descriptor)
	if err != nil {
		return nil, nil, err
	}
	target := resourcev2.ReadTarget{Route: route, Provider: reference.Address.Provider, Authority: reference.Address.Authority, Type: reference.Address.Type, Scope: scope, Representation: representation}
	ctx, err = c.boundary.Reauthorize(ctx, referenceQueryTarget(pluginID, target, reference))
	if err != nil {
		return nil, nil, err
	}
	principal, _ := invocation.FromContext(ctx)
	owner := principal.Principal().Owner()
	key, err := registry.CanonicalAddressKey(reference.Address)
	if err != nil {
		return nil, nil, err
	}
	// Never acquire session.mu under coordinator.mu: release uses the reverse.
	type candidate struct {
		key     string
		session *sourceSession
	}
	c.sources.mu.Lock()
	candidates := make([]candidate, 0, len(c.sources.sessions))
	for key, session := range c.sources.sessions {
		candidates = append(candidates, candidate{key: key, session: session})
	}
	c.sources.mu.Unlock()
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].key < candidates[j].key })
	representations := []string{representation}
	if descriptor.ModelRepresentation != "" && descriptor.ModelRepresentation != representation {
		representations = append(representations, descriptor.ModelRepresentation)
	}
	// Conflicting retained incarnations cannot be ordered by representation or
	// source key. Refuse identity admission until every owner source agrees.
	if identityOnly {
		for _, candidate := range candidates {
			session := candidate.session
			session.mu.Lock()
			if !observedSessionCurrent(session, pluginID, owner, route, generation, catalog.Revision) {
				session.mu.Unlock()
				continue
			}
			binding, _ := session.ctx.Value(sourceBindingKey{}).(sourceBinding)
			if binding.Representation.ID != representation && binding.Representation.ID != descriptor.ModelRepresentation {
				session.mu.Unlock()
				continue
			}
			member, exists := session.members[key]
			if !exists {
				session.mu.Unlock()
				continue
			}
			observation, err := decodeObservedMember(session, member)
			if err == nil {
				session.transientLedger.release(member.transient)
			}
			session.mu.Unlock()
			if err != nil {
				return nil, nil, err
			}
			if !sameIncarnation(observation.Record.Reference.Incarnation, reference.Incarnation) {
				return nil, nil, resourcev2.NewError("RESET_REQUIRED", "Retained source observations disagree on the requested incarnation.")
			}
		}
	}
	for _, representation := range representations {
		for _, candidate := range candidates {
			session := candidate.session
			session.mu.Lock()
			binding, _ := session.ctx.Value(sourceBindingKey{}).(sourceBinding)
			if !observedSessionCurrent(session, pluginID, owner, route, generation, catalog.Revision) || binding.Representation.ID != representation {
				session.mu.Unlock()
				continue
			}
			var currentRepresentation resourcev2.Representation
			for _, declared := range descriptor.Representations {
				if declared.ID == representation {
					currentRepresentation = declared
					break
				}
			}
			if !reflect.DeepEqual(binding.Representation, currentRepresentation) {
				session.mu.Unlock()
				continue
			}
			member, exists := session.members[key]
			if !exists || member.ref == nil {
				session.mu.Unlock()
				continue
			}
			observation, err := decodeObservedMember(session, member)
			if err != nil {
				session.mu.Unlock()
				return nil, nil, err
			}
			if !sameIncarnation(observation.Record.Reference.Incarnation, reference.Incarnation) {
				session.transientLedger.release(member.transient)
				session.mu.Unlock()
				continue
			}
			defer session.transientLedger.release(member.transient)
			c.pluginsMu.RLock()
			err = c.currentGenerationLocked(ctx, pluginID, generation)
			if err == nil {
				err = c.currentGenerationLocked(session.ctx, pluginID, generation)
			}
			if err == nil && !c.referenceCurrentLocked(pluginID, route, reference) {
				err = resourcev2.NewError("RESET_REQUIRED", "Observation authority retired.")
			}
			c.pluginsMu.RUnlock()
			sourceGeneration, revision, catalogRevision := session.generation, member.ref, catalog.Revision
			session.mu.Unlock()
			if err != nil {
				return nil, nil, err
			}
			var projected *resourcev2.Value
			if !identityOnly {
				_, snapshot, err := c.observeSchemaSnapshot(ctx, pluginID, generation, route, catalog)
				if err != nil {
					return nil, nil, err
				}
				entry, err := snapshot.Entry(reference.Address.Type, representation)
				if err != nil {
					return nil, nil, err
				}
				schema, err := entry.Resolve(ctx, schemaDocumentSource(provider, route))
				if err != nil {
					return nil, nil, err
				}
				projected, err = projectObservedScalars(ctx, schema, observation.Record.Body, paths)
				if err != nil {
					return nil, nil, err
				}
			}
			if expected != nil {
				if expected != session {
					return nil, nil, resourcev2.NewError("UNAVAILABLE", "Preferred source observation changed before delivery.")
				}
				return projected, nil, nil
			}
			// Capture immutable fences, not a resource body or member wire bytes.
			reference.Address.Scope = append([]resourcev2.ScopeEntry(nil), reference.Address.Scope...)
			if reference.Incarnation != nil {
				token := *reference.Incarnation
				reference.Incarnation = &token
			}
			guard := func(delivery context.Context) (retErr error) {
				delivery, err := c.admit(delivery, operation, referenceTarget(pluginID, route, reference))
				if err != nil {
					return err
				}
				defer finishResource(delivery, &retErr)
				request, ok := invocation.FromContext(delivery)
				if !ok || request.Principal().Owner() != owner {
					return resourcev2.NewError("FORBIDDEN", "Observation belongs to another principal.")
				}
				if _, _, err := c.readObservedResource(delivery, operation, pluginID, route, reference, paths, session, identityOnly); err != nil {
					return err
				}
				session.mu.Lock()
				defer session.mu.Unlock()
				current, exists := session.members[key]
				if !observedSessionCurrent(session, pluginID, owner, route, generation, catalogRevision) || session.generation != sourceGeneration || !exists || (!identityOnly && current.ref != revision) {
					return resourcev2.NewError("UNAVAILABLE", "Source observation retired before projection delivery.")
				}
				if identityOnly {
					observation, err := decodeObservedMember(session, current)
					if err != nil {
						return err
					}
					defer session.transientLedger.release(current.transient)
					if !sameIncarnation(observation.Record.Reference.Incarnation, reference.Incarnation) {
						return resourcev2.NewError("RESET_REQUIRED", "Observed identity changed before delivery.")
					}
				}
				c.pluginsMu.RLock()
				defer c.pluginsMu.RUnlock()
				if err := c.currentGenerationLocked(session.ctx, pluginID, generation); err != nil {
					return err
				}
				if !c.referenceCurrentLocked(pluginID, route, reference) {
					return resourcev2.NewError("RESET_REQUIRED", "Observation authority retired.")
				}
				return nil
			}
			return projected, guard, nil
		}
	}
	return nil, nil, resourcev2.NewError("UNAVAILABLE", "No current authorized source observation is available.")
}

// Caller holds session.mu. A successful decode retains its scratch reservation;
// the caller releases it after the last body read, including schema resolution.
func decodeObservedMember(session *sourceSession, member sourceMember) (resourcev2.SourceObservation, error) {
	if !session.transientLedger.reserve(member.transient) {
		return resourcev2.SourceObservation{}, resourcev2.NewError("RESOURCE_LIMIT", "Observed resource decode exceeds host limits.")
	}
	observation, err := decodeSourceMember(member)
	if err != nil {
		session.transientLedger.release(member.transient)
	}
	return observation, err
}

func observedSessionCurrent(session *sourceSession, pluginID, owner string, route resourcev2.AccessRoute, generation *pluginState, catalogRevision string) bool {
	binding, ok := session.ctx.Value(sourceBindingKey{}).(sourceBinding)
	return ok && binding.CatalogRevision == catalogRevision && session.pluginID == pluginID && session.owner == owner && session.pluginGeneration == generation && session.target.Route == route && !session.closed && session.ctx.Err() == nil && session.hasSnapshot && (session.status.State == "following" || session.status.State == "finished")
}

func observedPublicPointer(path string) ([]string, error) {
	if len(path) == 0 || len(path) > 1024 || path[0] != '/' {
		return nil, resourcev2.NewError("INVALID_REQUEST", "A bounded RFC6901 scalar pointer is required.")
	}
	parts := strings.Split(path[1:], "/")
	if len(parts) > 16 {
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Public scalar path nesting exceeds host limits.")
	}
	for i, part := range parts {
		for at := 0; at < len(part); at++ {
			if part[at] == '~' {
				at++
				if at >= len(part) || (part[at] != '0' && part[at] != '1') {
					return nil, resourcev2.NewError("INVALID_REQUEST", "Invalid RFC6901 escape.")
				}
			}
		}
		parts[i] = strings.NewReplacer("~1", "/", "~0", "~").Replace(part)
		normalized := strings.ToLower(strings.NewReplacer("-", "", "_", "", ".", "").Replace(parts[i]))
		for _, private := range []string{"secret", "password", "passwd", "token", "credential", "kubeconfig", "privatekey", "clientkey", "authorization", "cookie"} {
			if strings.Contains(normalized, private) {
				return nil, resourcev2.NewError("FORBIDDEN", "Sensitive resource fields cannot be projected.")
			}
		}
		if i == 0 && (normalized == "data" || normalized == "stringdata" || normalized == "binarydata") {
			return nil, resourcev2.NewError("FORBIDDEN", "Resource data payloads cannot be projected.")
		}
	}
	return parts, nil
}

func projectObservedScalars(ctx context.Context, schema *resourcecatalog.Schema, body resourcev2.Value, paths []string) (*resourcev2.Value, error) {
	if schema == nil {
		return nil, resourcev2.NewError("UNSUPPORTED", "Public scalar projection requires an available declared schema.")
	}
	result := resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{}}
	for _, path := range paths {
		parts, err := observedPublicPointer(path)
		if err != nil {
			return nil, err
		}
		if err := approveObservedSchemaPath(ctx, schema, parts); err != nil {
			return nil, err
		}
		leaf := body
		for _, part := range parts {
			if leaf.Kind != "map" {
				return nil, resourcev2.NewError("INVALID_REQUEST", "Public scalar paths cannot traverse arrays or scalar values.")
			}
			var exists bool
			leaf, exists = leaf.Map[part]
			if !exists {
				return nil, resourcev2.NewError("NOT_FOUND", "Public scalar field is not observed.")
			}
		}
		switch leaf.Kind {
		case "string", "bool", "int64", "uint64", "double", "timestamp":
		default:
			return nil, resourcev2.NewError("INVALID_REQUEST", "Public projection requires a non-null scalar.")
		}
		if err := resourcev2.ValidateValue(leaf); err != nil {
			return nil, err
		}
		out := result
		for i, part := range parts {
			if i == len(parts)-1 {
				out.Map[part] = leaf
				break
			}
			next, exists := out.Map[part]
			if !exists {
				next = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{}}
				out.Map[part] = next
			}
			out = next
		}
	}
	return &result, nil
}

// Navigate supplies the catalog's branch-aware declaration and scalar typing.
// Inspect the same normalized nodes separately for inherited privacy annotations;
// neither additionalProperties nor dynamic/conditional fields confer approval.
func approveObservedSchemaPath(ctx context.Context, schema *resourcecatalog.Schema, parts []string) error {
	positions := []resourcecatalog.NodeID{schema.Root}
	navigation := make([]resourcecatalog.PathSegment, 0, len(parts))
	for index, part := range parts {
		fields, err := resourcecatalog.Navigate(ctx, schema, navigation, resourcecatalog.DefaultPolicy())
		if err != nil {
			return err
		}
		if fields.Truncated {
			return resourcev2.NewError("RESOURCE_LIMIT", "Schema navigation exceeds host limits.")
		}
		var field *resourcecatalog.FieldInfo
		for i := range fields.Fields {
			candidate := &fields.Fields[i]
			if candidate.Segment.Kind == resourcecatalog.SegmentField && candidate.Segment.Name == part {
				field = candidate
				break
			}
		}
		if field == nil || field.Applicability != resourcecatalog.ApplicabilityUnconditional || len(field.Types) == 0 {
			return resourcev2.NewError("FORBIDDEN", "Public scalar path must be unconditionally declared in the schema.")
		}
		for _, kind := range field.Types {
			if kind == "null" {
				continue
			}
			if index < len(parts)-1 && kind != "object" || index == len(parts)-1 && kind != "string" && kind != "boolean" && kind != "integer" && kind != "number" {
				return resourcev2.NewError("FORBIDDEN", "Schema does not approve this public scalar path.")
			}
		}
		seen := map[resourcecatalog.NodeID]bool{}
		var next []resourcecatalog.NodeID
		var inspect func(resourcecatalog.NodeID) error
		inspect = func(id resourcecatalog.NodeID) error {
			if id == 0 || seen[id] {
				return nil
			}
			seen[id] = true
			if len(seen) > resourcecatalog.DefaultPolicy().MaxNavigationVisits {
				return resourcev2.NewError("RESOURCE_LIMIT", "Schema privacy inspection exceeds host limits.")
			}
			node := &schema.Document.Nodes[id]
			if node.Sensitive || node.Format == "password" || node.Format == "binary" || node.Format == "byte" {
				return resourcev2.NewError("FORBIDDEN", "Sensitive schema fields cannot be projected.")
			}
			for _, property := range node.Properties {
				if property.Name == part {
					next = append(next, property.Node)
				}
			}
			if err := inspect(node.Ref); err != nil {
				return err
			}
			for _, branches := range [][]resourcecatalog.NodeID{node.AllOf, node.AnyOf, node.OneOf} {
				for _, branch := range branches {
					if err := inspect(branch); err != nil {
						return err
					}
				}
			}
			return nil
		}
		for _, position := range positions {
			if err := inspect(position); err != nil {
				return err
			}
		}
		positions = next
		navigation = append(navigation, resourcecatalog.PathSegment{Kind: resourcecatalog.SegmentField, Name: part})
	}
	// Leaf annotations and referenced/allOf annotations also apply.
	seen := map[resourcecatalog.NodeID]bool{}
	var inspectLeaf func(resourcecatalog.NodeID) error
	inspectLeaf = func(id resourcecatalog.NodeID) error {
		if id == 0 || seen[id] {
			return nil
		}
		seen[id] = true
		if len(seen) > resourcecatalog.DefaultPolicy().MaxNavigationVisits {
			return resourcev2.NewError("RESOURCE_LIMIT", "Schema privacy inspection exceeds host limits.")
		}
		node := &schema.Document.Nodes[id]
		if node.Sensitive || node.Format == "password" || node.Format == "binary" || node.Format == "byte" {
			return resourcev2.NewError("FORBIDDEN", "Sensitive schema fields cannot be projected.")
		}
		if err := inspectLeaf(node.Ref); err != nil {
			return err
		}
		for _, branches := range [][]resourcecatalog.NodeID{node.AllOf, node.AnyOf, node.OneOf} {
			for _, branch := range branches {
				if err := inspectLeaf(branch); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, position := range positions {
		if err := inspectLeaf(position); err != nil {
			return err
		}
	}
	return nil
}
