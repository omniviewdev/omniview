package resource

import (
	"context"
	"encoding/hex"
	"encoding/json"

	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// SchemaFieldsRequest selects one navigation position in one admitted target.
type SchemaFieldsRequest struct {
	Request resourcev2.SchemaRequest      `json:"request"`
	Path    []resourcecatalog.PathSegment `json:"path"`
}

type SchemaFieldsResult struct {
	Type             string                      `json:"type"`
	Target           resourcev2.SchemaTarget     `json:"target"`
	Observation      string                      `json:"observation"`
	SchemaState      string                      `json:"schemaState"`
	SchemaRevision   string                      `json:"schemaRevision,omitempty"`
	Dialect          string                      `json:"dialect,omitempty"`
	Overlay          resourcecatalog.TypeOverlay `json:"overlay"`
	Fields           []resourcecatalog.FieldInfo `json:"fields"`
	Truncated        bool                        `json:"truncated"`
	TruncationReason string                      `json:"truncationReason,omitempty"`
}

// EditorSchemaResult is one coherent target observation and rendered document.
// The frontend owns its stable model URI before requesting this enrichment.
type EditorSchemaResult struct {
	Type           string                  `json:"type"`
	Target         resourcev2.SchemaTarget `json:"target"`
	Observation    string                  `json:"observation"`
	Status         string                  `json:"status"`
	Code           string                  `json:"code,omitempty"`
	SchemaRevision string                  `json:"schemaRevision,omitempty"`
	Dialect        string                  `json:"dialect,omitempty"`
	Root           string                  `json:"root,omitempty"`
	Document       *EditorSchemaDocument   `json:"document,omitempty"`
}

type EditorSchemaDocument struct {
	DocumentID string          `json:"documentId"`
	Schema     json.RawMessage `json:"schema"`
}

const (
	editorStatusAvailable   = "available"
	editorStatusAbsent      = "absent"
	editorStatusUnavailable = "unavailable"
	editorStatusUnsupported = "unsupported"
	editorStatusInvalid     = "invalid"
	editorStatusLimit       = "limit"
)

func isDeterministicSchemaCode(code string) bool {
	return code == "INVALID_REQUEST" || code == "UNSUPPORTED" || code == "RESOURCE_LIMIT"
}

func isSchemaLifecycleCode(code string) bool {
	return code == "CANCELLED" || code == "TIMEOUT" || code == "RESET_REQUIRED"
}

// observeSchemaCatalog is retained for source/privacy and authoring callers that
// independently admit their exact target before using the snapshot.
func (c *controller) observeSchemaCatalog(ctx context.Context, pluginID string, provider ResourceProvider, generation *pluginState, route resourcev2.AccessRoute) (context.Context, *resourcecatalog.Snapshot, error) {
	ctx, catalog, err := c.admitAncillaryCatalog(ctx, pluginID, provider, generation, route, "", nil)
	if err != nil {
		return ctx, nil, err
	}
	return c.observeSchemaSnapshot(ctx, pluginID, generation, route, catalog)
}

func (c *controller) observeSchemaSnapshot(ctx context.Context, pluginID string, generation *pluginState, route resourcev2.AccessRoute, catalog resourcev2.Catalog) (context.Context, *resourcecatalog.Snapshot, error) {
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	if err := c.currentGenerationLocked(ctx, pluginID, generation); err != nil {
		return ctx, nil, err
	}
	epoch, _ := ctx.Value(sourceEpochKey{}).(sourceEpochSnapshot)
	key := resourcecatalog.ConnectionKey{PluginID: pluginID, Generation: generation.generationID, Connection: route.Connection, Epoch: epoch.Epoch}
	return ctx, c.schemas.Observe(key, catalog), nil
}

func schemaBindingSource(provider ResourceProvider) resourcecatalog.BindingSource {
	resolver, ok := provider.(resourcev2.SchemaResolver)
	if !ok {
		return nil
	}
	return resolver.ResolveSchema
}

func schemaDocumentSource(provider ResourceProvider, route resourcev2.AccessRoute) resourcecatalog.DocumentSource {
	documents, ok := provider.(resourcev2.SchemaDocumentProvider)
	if !ok {
		return nil
	}
	return func(ctx context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		return documents.GetSchemaDocument(ctx, route, ref)
	}
}

func schemaReference(request resourcev2.SchemaRequest) *resourcev2.ResourceReference {
	if request.Target.Auxiliary != nil {
		return &request.Target.Auxiliary.Reference
	}
	return nil
}

func schemaInvocationTarget(pluginID string, request resourcev2.SchemaRequest) invocation.Target {
	ref := resourcev2.ResourceReference{}
	if reference := schemaReference(request); reference != nil {
		ref = *reference
	}
	return ancillaryTarget(pluginID, request.Route, request.Type, ref, "")
}

func (c *controller) admitSchemaTarget(ctx context.Context, pluginID string, provider ResourceProvider, generation *pluginState, request resourcev2.SchemaRequest) (context.Context, *resourcecatalog.Entry, error) {
	if err := resourcev2.ValidateSchemaRequest(request); err != nil {
		return ctx, nil, err
	}
	ctx, catalog, err := c.admitAncillaryCatalog(ctx, pluginID, provider, generation, request.Route, request.Type, schemaReference(request))
	if err != nil {
		return ctx, nil, err
	}
	ctx, snapshot, err := c.observeSchemaSnapshot(ctx, pluginID, generation, request.Route, catalog)
	if err != nil {
		return ctx, nil, err
	}
	entry, err := snapshot.Target(request)
	return ctx, entry, err
}

// finishSchemaTarget revalidates the original principal and captured lifecycle.
// A fresh epoch can never bless work started under a retired epoch.
func (c *controller) finishSchemaTarget(ctx context.Context, operation, pluginID string, provider ResourceProvider, generation *pluginState, request resourcev2.SchemaRequest, entry *resourcecatalog.Entry, observation string) error {
	if _, err := c.boundary.Admit(ctx, operation, schemaInvocationTarget(pluginID, request)); err != nil {
		return err
	}
	ctx, current, err := c.admitSchemaTarget(ctx, pluginID, provider, generation, request)
	if err != nil {
		return err
	}
	if current != entry {
		return resourcev2.NewError("RESET_REQUIRED", "Schema target changed during resolution.")
	}
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	if err := c.currentGenerationLocked(ctx, pluginID, generation); err != nil {
		return err
	}
	return entry.Current(observation)
}

func (c *controller) GetSchemaFields(ctx context.Context, pluginID string, request SchemaFieldsRequest) (out SchemaFieldsResult, retErr error) {
	ctx, end := h3StartOperation(
		ctx,
		"resource.GetSchemaFields",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", request.Request.Route.Connection),
		attribute.String("resource_type", request.Request.Type),
	)
	defer end(&retErr)
	ctx, err := c.admit(ctx, "resource.GetSchemaFields", schemaInvocationTarget(pluginID, request.Request))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Request.Route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	sessionCtx, entry, err := c.admitSchemaTarget(sessionCtx, pluginID, provider, generation, request.Request)
	if err != nil {
		return out, err
	}
	resolution, resolveErr := entry.Resolve(sessionCtx, schemaBindingSource(provider), schemaDocumentSource(provider, request.Request.Route))
	if resolveErr != nil && (isDenialCode(resourcev2.ErrorCode(resolveErr)) || isSchemaLifecycleCode(resourcev2.ErrorCode(resolveErr)) || (!isDeterministicSchemaCode(resourcev2.ErrorCode(resolveErr)) && resolution.Binding.State != "unavailable")) {
		return out, resolveErr
	}
	out, err = schemaFields(sessionCtx, entry, resolution, resolveErr, request.Path)
	if err != nil {
		return SchemaFieldsResult{}, err
	}
	if err = c.finishSchemaTarget(sessionCtx, "resource.GetSchemaFields", pluginID, provider, generation, request.Request, entry, resolution.Observation); err != nil {
		return SchemaFieldsResult{}, err
	}
	return out, nil
}

func schemaFields(ctx context.Context, entry *resourcecatalog.Entry, resolution resourcecatalog.Resolution, resolveErr error, path []resourcecatalog.PathSegment) (SchemaFieldsResult, error) {
	out := SchemaFieldsResult{Type: entry.Type, Target: entry.Target, Observation: resolution.Observation,
		SchemaState: resolution.Binding.State, Dialect: resolution.Binding.Dialect,
		Overlay: resourcecatalog.OverlayFor(entry, resolution.Schema, resolveErr), Fields: []resourcecatalog.FieldInfo{}}
	if out.SchemaState == "" {
		out.SchemaState = "unavailable"
	}
	if resolution.Binding.Revision != nil {
		out.SchemaRevision = *resolution.Binding.Revision
	}
	if resolveErr != nil {
		return out, nil
	}
	navigation, err := resourcecatalog.Navigate(ctx, resolution.Schema, path, resourcecatalog.DefaultPolicy())
	if err != nil {
		return SchemaFieldsResult{}, err
	}
	if navigation.Fields != nil {
		out.Fields = navigation.Fields
	}
	out.Truncated, out.TruncationReason = navigation.Truncated, navigation.TruncationReason
	return out, nil
}

func (c *controller) ResolveEditorSchema(ctx context.Context, pluginID string, request resourcev2.SchemaRequest) (out EditorSchemaResult, retErr error) {
	ctx, end := h3StartOperation(
		ctx,
		"resource.ResolveEditorSchema",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", request.Route.Connection),
		attribute.String("resource_type", request.Type),
	)
	defer end(&retErr)
	ctx, err := c.admit(ctx, "resource.ResolveEditorSchema", schemaInvocationTarget(pluginID, request))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	sessionCtx, entry, err := c.admitSchemaTarget(sessionCtx, pluginID, provider, generation, request)
	if err != nil {
		return out, err
	}
	resolution, resolveErr := entry.Resolve(sessionCtx, schemaBindingSource(provider), schemaDocumentSource(provider, request.Route))
	out, err = editorSchema(entry, resolution, resolveErr)
	if err != nil {
		return EditorSchemaResult{}, err
	}
	if err = c.finishSchemaTarget(sessionCtx, "resource.ResolveEditorSchema", pluginID, provider, generation, request, entry, resolution.Observation); err != nil {
		return EditorSchemaResult{}, err
	}
	return out, nil
}

func editorSchema(entry *resourcecatalog.Entry, resolution resourcecatalog.Resolution, resolveErr error) (EditorSchemaResult, error) {
	out := EditorSchemaResult{Type: entry.Type, Target: entry.Target, Observation: resolution.Observation, Dialect: resolution.Binding.Dialect}
	if resolution.Binding.Revision != nil {
		out.SchemaRevision = *resolution.Binding.Revision
	}
	if resolveErr == nil && resolution.Schema != nil {
		rendered, err := resolution.Schema.Document.EditorJSON()
		resolveErr = err
		if err == nil {
			out.Status, out.Root = editorStatusAvailable, resourcecatalog.EditorRoot(resolution.Schema)
			out.Document = &EditorSchemaDocument{DocumentID: hex.EncodeToString(resolution.Schema.Document.Digest[:]), Schema: json.RawMessage(rendered)}
			return out, nil
		}
	}
	if resolveErr == nil {
		out.Status = editorStatusAbsent
		return out, nil
	}
	code := resourcev2.ErrorCode(resolveErr)
	if isSchemaLifecycleCode(code) {
		return EditorSchemaResult{}, resolveErr
	}
	// Only reviewed machine codes are returned; provider diagnostics never cross.
	if resourcev2.ValidateSchemaUnavailableReason(code) != nil {
		code = "UNAVAILABLE"
	}
	out.Code = code
	switch code {
	case "UNSUPPORTED":
		out.Status = editorStatusUnsupported
	case "INVALID_REQUEST":
		out.Status = editorStatusInvalid
	case "RESOURCE_LIMIT":
		out.Status = editorStatusLimit
	default:
		out.Status = editorStatusUnavailable
	}
	return out, nil
}
