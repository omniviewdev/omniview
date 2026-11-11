package resource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// SchemaFieldsRequest selects one navigation position in a representation schema.
type SchemaFieldsRequest struct {
	Route          resourcev2.AccessRoute        `json:"route"`
	Type           string                        `json:"type"`
	Representation string                        `json:"representation,omitempty"`
	Path           []resourcecatalog.PathSegment `json:"path"`
}

// SchemaFieldsResult is catalog-derived field discovery for one representation.
type SchemaFieldsResult struct {
	CatalogRevision  string                      `json:"catalogRevision"`
	Type             string                      `json:"type"`
	Representation   string                      `json:"representation"`
	SchemaState      string                      `json:"schemaState"` // provider state: absent|available|unavailable
	SchemaRevision   string                      `json:"schemaRevision,omitempty"`
	Dialect          string                      `json:"dialect,omitempty"`
	Overlay          resourcecatalog.TypeOverlay `json:"overlay"`
	Fields           []resourcecatalog.FieldInfo `json:"fields"`
	Truncated        bool                        `json:"truncated"`
	TruncationReason string                      `json:"truncationReason,omitempty"`
}

// EditorSchemaAssociation binds a host-derived Monaco model directory to a
// rendered catalog document.
type EditorSchemaAssociation struct {
	Type           string `json:"type"`
	Representation string `json:"representation,omitempty"`
	Key            string `json:"key,omitempty"`
	Language       string `json:"language"`
	ModelDirectory string `json:"modelDirectory"` // "file:///omniview-schema/<hex16>"
	FileMatch      string `json:"fileMatch"`      // "**/omniview-schema/<hex16>/*"
	DocumentID     string `json:"documentId,omitempty"`
	Root           string `json:"root,omitempty"`
	Status         string `json:"status"` // "available"|"absent"|"unavailable"|"unsupported"|"invalid"|"limit"
	Code           string `json:"code,omitempty"`
}

// EditorSchemaDocument is a host-rendered draft-07 editor document.
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

// isDeterministicSchemaCode reports the normalization set: cached, deterministic
// resolve outcomes (spec §2.3).
func isDeterministicSchemaCode(code string) bool {
	return code == "INVALID_REQUEST" || code == "UNSUPPORTED" || code == "RESOURCE_LIMIT"
}

// isSchemaLifecycleCode reports outcomes that abort editor association derivation.
func isSchemaLifecycleCode(code string) bool {
	return code == "CANCELLED" || code == "TIMEOUT" || code == "RESET_REQUIRED"
}

// observeSchemaCatalog admits a fresh catalog and returns its connection snapshot.
func (c *controller) observeSchemaCatalog(sessionCtx context.Context, pluginID string, provider ResourceProvider, generation *pluginState, route resourcev2.AccessRoute) (context.Context, *resourcecatalog.Snapshot, error) {
	sessionCtx, catalog, err := c.admitAncillaryCatalog(sessionCtx, pluginID, provider, generation, route, "", nil)
	if err != nil {
		return sessionCtx, nil, err
	}
	return c.observeSchemaSnapshot(sessionCtx, pluginID, generation, route, catalog)
}

// observeSchemaSnapshot publishes only while the admitted generation and source
// epoch remain current. The catalog lock is a leaf under pluginsMu.
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

// schemaDocumentSource fetches referenced documents from the provider, or is
// nil when the provider does not serve schema documents.
func schemaDocumentSource(provider ResourceProvider, route resourcev2.AccessRoute) resourcecatalog.DocumentSource {
	documents, ok := provider.(resourcev2.SchemaDocumentProvider)
	if !ok {
		return nil
	}
	return func(ctx context.Context, reference resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		return documents.GetSchemaDocument(ctx, route, reference)
	}
}

func (c *controller) GetSchemaFields(ctx context.Context, pluginID string, request SchemaFieldsRequest) (out SchemaFieldsResult, retErr error) {
	ctx, end := h3StartOperation(
		ctx,
		"resource.GetSchemaFields",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", request.Route.Connection),
		attribute.String("resource_type", request.Type),
	)
	defer end(&retErr)
	ctx, err := c.admit(ctx, "resource.GetSchemaFields", ancillaryTarget(pluginID, request.Route, request.Type, resourcev2.ResourceReference{}, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, request.Route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	sessionCtx, snapshot, err := c.observeSchemaCatalog(sessionCtx, pluginID, provider, generation, request.Route)
	if err != nil {
		return out, err
	}
	out, err = schemaFields(sessionCtx, snapshot, schemaDocumentSource(provider, request.Route), request)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func schemaFields(ctx context.Context, snapshot *resourcecatalog.Snapshot, fetch resourcecatalog.DocumentSource, request SchemaFieldsRequest) (SchemaFieldsResult, error) {
	representation := request.Representation
	if representation == "" {
		for _, entry := range snapshot.Entries() {
			if entry.Type == request.Type {
				representation = entry.Descriptor.DefaultRepresentation
				if representation == "" {
					return SchemaFieldsResult{}, resourcev2.NewError("INVALID_REQUEST", "representation is required for types without a default")
				}
				break
			}
		}
	}
	entry, err := snapshot.Entry(request.Type, representation)
	if err != nil {
		return SchemaFieldsResult{}, err
	}
	out := SchemaFieldsResult{
		CatalogRevision: snapshot.Revision(),
		Type:            entry.Type,
		Representation:  entry.Representation,
		SchemaState:     entry.Binding.State,
		Dialect:         entry.Binding.Dialect,
		Fields:          []resourcecatalog.FieldInfo{},
	}
	if entry.Binding.Revision != nil {
		out.SchemaRevision = *entry.Binding.Revision
	}
	schema, resolveErr := entry.Resolve(ctx, fetch)
	out.Overlay = resourcecatalog.OverlayFor(entry, schema, resolveErr)
	if resolveErr != nil {
		if isDeterministicSchemaCode(resourcev2.ErrorCode(resolveErr)) || entry.Binding.State == "unavailable" {
			return out, nil
		}
		return SchemaFieldsResult{}, resolveErr
	}
	navigation, err := resourcecatalog.Navigate(ctx, schema, request.Path, resourcecatalog.DefaultPolicy())
	if err != nil {
		return SchemaFieldsResult{}, err
	}
	if navigation.Fields != nil {
		out.Fields = navigation.Fields
	}
	out.Truncated = navigation.Truncated
	out.TruncationReason = navigation.TruncationReason
	return out, nil
}

func (c *controller) GetEditorSchemas(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (out []EditorSchemaAssociation, retErr error) {
	ctx, end := h3StartOperation(
		ctx,
		"resource.GetEditorSchemas",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", route.Connection),
	)
	defer end(&retErr)
	ctx, err := c.admit(ctx, "resource.GetEditorSchemas", ancillaryTarget(pluginID, route, "", resourcev2.ResourceReference{}, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	sessionCtx, snapshot, err := c.observeSchemaCatalog(sessionCtx, pluginID, provider, generation, route)
	if err != nil {
		return out, err
	}
	out, err = editorAssociations(sessionCtx, pluginID, provider, route, snapshot)
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

func (c *controller) GetEditorSchemaDocument(ctx context.Context, pluginID string, route resourcev2.AccessRoute, documentID string) (out EditorSchemaDocument, retErr error) {
	ctx, end := h3StartOperation(
		ctx,
		"resource.GetEditorSchemaDocument",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", route.Connection),
	)
	defer end(&retErr)
	ctx, err := c.admit(ctx, "resource.GetEditorSchemaDocument", ancillaryTarget(pluginID, route, "", resourcev2.ResourceReference{}, ""))
	if err != nil {
		return out, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, sessionCtx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return out, err
	}
	defer cleanup()
	sessionCtx, snapshot, err := c.observeSchemaCatalog(sessionCtx, pluginID, provider, generation, route)
	if err != nil {
		return out, err
	}
	document, found := snapshot.Document(documentID)
	if !found {
		// A replaced snapshot holds no resolved documents yet; derive the
		// associations it references before deciding.
		if _, err := editorAssociations(sessionCtx, pluginID, provider, route, snapshot); err != nil {
			return out, err
		}
		document, found = snapshot.Document(documentID)
	}
	if !found {
		return out, resourcev2.NewError("NOT_FOUND", "Editor schema document is not referenced by this connection.")
	}
	rendered, err := document.EditorJSON()
	if err == nil {
		out = EditorSchemaDocument{DocumentID: documentID, Schema: json.RawMessage(rendered)}
	}
	return ancillaryResult(c, sessionCtx, pluginID, generation, out, err)
}

// editorAssociations derives one association per catalog type (default
// representation) plus one per auxiliary provider schema.
func editorAssociations(ctx context.Context, pluginID string, provider ResourceProvider, route resourcev2.AccessRoute, snapshot *resourcecatalog.Snapshot) ([]EditorSchemaAssociation, error) {
	fetch := schemaDocumentSource(provider, route)
	out := []EditorSchemaAssociation{}
	for _, entry := range snapshot.Entries() {
		if entry.Descriptor.DefaultRepresentation == "" || entry.Representation != entry.Descriptor.DefaultRepresentation {
			continue
		}
		schema, err := entry.Resolve(ctx, fetch)
		association, err := editorAssociation(pluginID, route.Connection, entry.Type, entry.Representation, "", "yaml", schema, err)
		if err != nil {
			return nil, err
		}
		out = append(out, association)
	}
	auxiliary, ok := provider.(resourcev2.EditorSchemaProvider)
	if !ok {
		return out, nil
	}
	schemas, err := auxiliary.GetEditorSchemas(ctx, route)
	if err != nil {
		code := resourcev2.ErrorCode(err)
		if isSchemaLifecycleCode(code) {
			return nil, err
		}
		return append(out, EditorSchemaAssociation{Language: "yaml", Status: editorStatusUnavailable, Code: code}), nil
	}
	results, err := snapshot.ResolveAux(ctx, schemas, fetch)
	if err != nil {
		return nil, err
	}
	for _, result := range results {
		association, err := editorAssociation(pluginID, route.Connection, result.Schema.Type, "", result.Schema.Key, result.Schema.Language, result.Resolved, result.Err)
		if err != nil {
			return nil, err
		}
		out = append(out, association)
	}
	return out, nil
}

// editorAssociation maps one resolve outcome to an association. Lifecycle
// codes are returned as errors.
func editorAssociation(pluginID, connection, resourceType, representation, key, language string, schema *resourcecatalog.Schema, resolveErr error) (EditorSchemaAssociation, error) {
	discriminator := representation
	if discriminator == "" {
		discriminator = "aux:" + key
	}
	sum := sha256.Sum256([]byte("omniview.editor.v1\x00" + pluginID + "\x00" + connection + "\x00" + resourceType + "\x00" + discriminator))
	hex16 := hex.EncodeToString(sum[:])[:16]
	association := EditorSchemaAssociation{
		Type:           resourceType,
		Representation: representation,
		Key:            key,
		Language:       language,
		ModelDirectory: "file:///omniview-schema/" + hex16,
		FileMatch:      "**/omniview-schema/" + hex16 + "/*",
	}
	if resolveErr == nil && schema != nil {
		// Rendering is cached per document; a render limit is a schema status.
		_, resolveErr = schema.Document.EditorJSON()
	}
	switch {
	case resolveErr != nil:
		code := resourcev2.ErrorCode(resolveErr)
		if isSchemaLifecycleCode(code) {
			return EditorSchemaAssociation{}, resolveErr
		}
		switch code {
		case "UNSUPPORTED":
			association.Status = editorStatusUnsupported
		case "INVALID_REQUEST":
			association.Status = editorStatusInvalid
		case "RESOURCE_LIMIT":
			association.Status = editorStatusLimit
		default:
			association.Status = editorStatusUnavailable
		}
		association.Code = code
	case schema == nil:
		association.Status = editorStatusAbsent
	default:
		association.Status = editorStatusAvailable
		association.DocumentID = hex.EncodeToString(schema.Document.Digest[:])
		association.Root = resourcecatalog.EditorRoot(schema)
	}
	return association, nil
}
