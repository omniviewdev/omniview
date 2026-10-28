package resource

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ============================================================================
// GetActions
// ============================================================================

func TestGetActions_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetActionsFunc: func(_ context.Context, _ resource.AccessRoute, key string) ([]resource.ActionDescriptor, error) {
			assert.Equal(t, "pods", key)
			return []resource.ActionDescriptor{
				{ID: "restart", Label: "Restart Pod"},
				{ID: "delete", Label: "Delete Pod"},
			}, nil
		},
	}
	registerActionTestPlugin(ctrl, "p1", mock)

	actions, err := ctrl.GetActions(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "pods")
	require.NoError(t, err)
	require.Len(t, actions, 2)
	assert.Equal(t, "restart", actions[0].ID)
	assert.Equal(t, "Restart Pod", actions[0].Label)
	assert.Equal(t, "delete", actions[1].ID)
}

func TestGetActions_PinsMetadataCatalogWithoutGetCapability(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{
		GetActionsFunc: func(ctx context.Context, _ resource.AccessRoute, _ string) ([]resource.ActionDescriptor, error) {
			_, ok := resource.CatalogRevisionFromContext(ctx)
			require.True(t, ok)
			return nil, nil
		},
	}
	registerActionTestPlugin(ctrl, "p1", provider)
	provider.CatalogFunc = func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		catalog := canonicalTestCatalog("p1", "pods")
		catalog.Revision = "metadata-only"
		catalog.Types[0].Capabilities = nil
		return catalog, nil
	}
	_, err := ctrl.GetActions(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "pods")
	require.NoError(t, err)
}

func TestStreamAction_ProducerRetainsAdmittedCatalogRevision(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	observed := make(chan error, 1)
	provider := &mockProvider{}
	provider.StreamActionFunc = func(ctx context.Context, request resource.ActionRequest, events chan<- resource.ActionEvent) error {
		catalog, err := provider.Catalog(context.Background(), resource.CatalogRequest{Route: request.Route})
		if err == nil {
			err = resource.CheckCatalogRevision(ctx, catalog)
		}
		observed <- err
		events <- resource.ActionEvent{Type: "ready"}
		<-ctx.Done()
		return ctx.Err()
	}
	registerActionTestPlugin(ctrl, "p1", provider)
	request := admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "restart")
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	require.NoError(t, <-observed)
	require.NoError(t, ctrl.CancelStreamAction(testInvocationContext(), id))
}

func TestGetActions_DoesNotRepairStaleCatalogAdmission(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{}
	registerActionTestPlugin(ctrl, "p1", provider)
	catalogCalls := 0
	provider.CatalogFunc = func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		catalogCalls++
		catalog := canonicalTestCatalog("p1", "pods")
		catalog.Revision = "accepted"
		return catalog, nil
	}
	provider.GetActionsFunc = func(ctx context.Context, _ resource.AccessRoute, _ string) ([]resource.ActionDescriptor, error) {
		current := canonicalTestCatalog("p1", "pods")
		current.Revision = "replacement"
		return nil, resource.CheckCatalogRevision(ctx, current)
	}
	_, err := ctrl.GetActions(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "pods")
	require.Error(t, err)
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	require.Equal(t, 1, catalogCalls)
}

func TestGetActions_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetActionsFunc: func(_ context.Context, _ resource.AccessRoute, _ string) ([]resource.ActionDescriptor, error) {
			return nil, errors.New("actions unavailable")
		},
	}
	registerActionTestPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetActions(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "pods")
	require.Error(t, err)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

func TestGetActions_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.GetActions(testInvocationContext(), "nonexistent", resource.AccessRoute{Connection: "conn-1"}, "pods")
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

// ============================================================================
// ExecuteAction
// ============================================================================

func TestExecuteAction_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ActionFunc: func(_ context.Context, input resource.ActionRequest) (resource.Value, error) {
			assert.Equal(t, "pods", input.Reference.Address.Type)
			assert.Equal(t, "restart", input.Action)
			return resource.Value{Kind: "bool", Bool: true}, nil
		},
	}
	registerActionTestPlugin(ctrl, "p1", mock)

	result, err := ctrl.Action(testInvocationContext(), "p1", admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "restart"))
	require.NoError(t, err)
	assert.True(t, result.Bool)
}

func TestExecuteAction_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ActionFunc: func(_ context.Context, _ resource.ActionRequest) (resource.Value, error) {
			return resource.Value{}, errors.New("action failed")
		},
	}
	registerActionTestPlugin(ctrl, "p1", mock)

	_, err := ctrl.Action(testInvocationContext(), "p1", admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "restart"))
	require.Error(t, err)
	assert.Equal(t, "PROVIDER_ERROR", requireAppError(t, err).Code)
}

func TestExecuteAction_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.Action(testInvocationContext(), "nonexistent", actionTestRequest("nonexistent", "pods", "restart"))
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

// ============================================================================
// StreamAction
// ============================================================================

func TestStreamAction_OpaqueHandleRequiresProviderReady(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerActionTestPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(ctx context.Context, _ resource.ActionRequest, ch chan<- resource.ActionEvent) error {
		ch <- resource.ActionEvent{Type: "ready"}
		<-ctx.Done()
		return ctx.Err()
	}})
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", admittedActionRequest(t, ctrl, "p1", "conn-1", "opaque", "restart"))
	require.NoError(t, err)
	assert.NotEmpty(t, id)
	assert.NotContains(t, id, "private-object")
	assert.NotContains(t, id, "restart")
	require.NoError(t, ctrl.CancelStreamAction(testInvocationContext(), id))
	assert.Equal(t, 0, actionCount(ctrl.actions))
}

func TestStreamAction_MissingReadyFailsWithoutHandle(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerActionTestPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(context.Context, resource.ActionRequest, chan<- resource.ActionEvent) error {
		return nil
	}})
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", admittedActionRequest(t, ctrl, "p1", "conn-1", "opaque", "restart"))
	require.Error(t, err)
	assert.Empty(t, id)
	assert.Equal(t, 0, actionCount(ctrl.actions))
}

func TestStreamAction_EmitsOrderedSnapshotsOnlyAfterAttach(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	release := make(chan struct{})
	registerActionTestPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(ctx context.Context, _ resource.ActionRequest, ch chan<- resource.ActionEvent) error {
		ch <- resource.ActionEvent{Type: "ready"}
		select {
		case <-release:
		case <-ctx.Done():
			return ctx.Err()
		}
		ch <- resource.ActionEvent{Type: "progress", Data: &resource.Value{Kind: "int64", Int: "50"}}
		ch <- resource.ActionEvent{Type: "complete", Data: &resource.Value{Kind: "int64", Int: "100"}}
		return nil
	}})
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", admittedActionRequest(t, ctrl, "p1", "conn-1", "opaque", "restart"))
	require.NoError(t, err)
	assert.Empty(t, emitter.EventsWithKey("action/stream/"+id))
	first, err := ctrl.AttachStreamAction(testInvocationContext(), id)
	require.NoError(t, err)
	assert.Equal(t, uint64(1), first.Sequence)
	close(release)
	events := emitter.WaitForNEvents(t, "action/stream/"+id, 2, 2*time.Second)
	progress := events[0].Data[0].(ActionSnapshot)
	complete := events[1].Data[0].(ActionSnapshot)
	assert.Equal(t, "progress", progress.Event.Type)
	assert.Equal(t, "complete", complete.Event.Type)
	assert.Greater(t, complete.Sequence, progress.Sequence)
	assert.True(t, complete.Terminal)
}

func TestStreamAction_NormalizesTerminalFailureAfterReady(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	release := make(chan struct{})
	registerActionTestPlugin(ctrl, "p1", &mockProvider{StreamActionFunc: func(ctx context.Context, _ resource.ActionRequest, ch chan<- resource.ActionEvent) error {
		ch <- resource.ActionEvent{Type: "ready"}
		select {
		case <-release:
			return errors.New("secret-provider-diagnostic")
		case <-ctx.Done():
			return ctx.Err()
		}
	}})
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", admittedActionRequest(t, ctrl, "p1", "conn-1", "opaque", "restart"))
	require.NoError(t, err)
	_, err = ctrl.AttachStreamAction(testInvocationContext(), id)
	require.NoError(t, err)
	close(release)
	event := emitter.WaitForEvent(t, "action/stream/"+id, 2*time.Second).Data[0].(ActionSnapshot)
	require.NotNil(t, event.Event.Error)
	assert.Equal(t, "PROVIDER_ERROR", event.Event.Error.Code)
	assert.False(t, strings.Contains(event.Event.Error.Error(), "secret"))
	assert.True(t, event.Terminal)
}

func TestStreamAction_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.StreamAction(testInvocationContext(), "nonexistent", actionTestRequest("nonexistent", "opaque", "restart"))
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}

func actionTestRequest(provider, resourceType, action string) resource.ActionRequest {
	return resource.ActionRequest{
		Route: resource.AccessRoute{Connection: "conn-1"},
		Reference: resource.ResourceReference{Address: resource.ResourceAddress{
			Provider: provider, Authority: "test", Type: resourceType, ID: "private-object", Scope: []resource.ScopeEntry{},
		}},
		Action: action,
		Input:  resource.Value{Kind: "null"},
	}
}

type catalogOnlyActionProvider struct{}

func (catalogOnlyActionProvider) Catalog(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
	return resource.Catalog{Provider: "p1", Revision: "1", Types: []resource.ResourceType{}}, nil
}

func TestAncillaryOptionalAbsenceReturnsUnsupported(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", catalogOnlyActionProvider{})
	route := resource.AccessRoute{Connection: "conn-1"}
	request := actionTestRequest("p1", "pods", "restart")
	get := resource.GetRequest{Route: route, Reference: request.Reference, Representation: "document"}
	checks := []struct {
		name string
		call func() error
	}{
		{"groups", func() error { _, err := ctrl.GetResourceGroups(testInvocationContext(), "p1", route); return err }},
		{"definition", func() error {
			_, err := ctrl.GetResourceDefinition(testInvocationContext(), "p1", route, "pods")
			return err
		}},
		{"editor", func() error { _, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", route); return err }},
		{"schemaDocument", func() error {
			_, err := ctrl.GetSchemaDocument(testInvocationContext(), "p1", route, resource.SchemaDocumentReference{ID: "schema", Revision: "1"})
			return err
		}},
		{"relationships", func() error {
			_, err := ctrl.GetRelationships(testInvocationContext(), "p1", route, "pods")
			return err
		}},
		{"resolved", func() error { _, err := ctrl.ResolveRelationships(testInvocationContext(), "p1", get); return err }},
		{"health", func() error {
			_, err := ctrl.GetHealth(testInvocationContext(), "p1", get, resource.Value{Kind: "null"})
			return err
		}},
		{"events", func() error { _, err := ctrl.GetResourceEvents(testInvocationContext(), "p1", get, 10); return err }},
		{"actions", func() error { _, err := ctrl.GetActions(testInvocationContext(), "p1", route, "pods"); return err }},
		{"stream", func() error {
			id, err := ctrl.StreamAction(testInvocationContext(), "p1", request)
			assert.Empty(t, id)
			return err
		}},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			assert.Equal(t, "UNSUPPORTED", requireAppError(t, check.call()).Code)
		})
	}
	assert.Equal(t, 0, actionCount(ctrl.actions))
}

func TestActionEventPreservesCanonicalValueAndCopiesSnapshot(t *testing.T) {
	value := &resource.Value{Kind: "uint64", Uint: "18446744073709551615"}
	event, err := actionEvent(resource.ActionEvent{Type: "output", Data: value}, "request")
	require.NoError(t, err)
	require.NotNil(t, event.Data)
	assert.Equal(t, *value, *event.Data)
	value.Uint = "0"
	assert.Equal(t, "18446744073709551615", event.Data.Uint)
}

func TestActionEventRequiresDataOnlyForProgressAndOutput(t *testing.T) {
	for _, eventType := range []string{"progress", "output"} {
		_, err := actionEvent(resource.ActionEvent{Type: eventType}, "request")
		require.Error(t, err)
	}
	event, err := actionEvent(resource.ActionEvent{Type: "complete"}, "request")
	require.NoError(t, err)
	assert.Nil(t, event.Data)
}

func registerActionTestPlugin(ctrl *controller, pluginID string, provider *mockProvider) {
	provider.CatalogFunc = func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		catalog := canonicalTestCatalog(pluginID, "pods")
		catalog.Types = append(catalog.Types, canonicalTestCatalog(pluginID, "opaque").Types...)
		return catalog, nil
	}
	registerMockPlugin(ctrl, pluginID, provider)
}

func TestPresentationAncillaryForwardsCanonicalRouteAndDocumentReference(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	route := resource.AccessRoute{Connection: "opaque/connection"}
	reference := resource.SchemaDocumentReference{ID: "opaque/schema", Revision: "r1"}
	groups := []resource.ResourceGroup{{ID: "core", Resources: []string{"k8s:/pods"}}}
	definition := resource.ResourceDefinition{ColumnDefs: []resource.ColumnDefinition{{ID: "name", Header: "Name"}}}
	document := resource.SchemaDocument{Reference: reference, Dialect: "https://json-schema.org/draft/2020-12/schema", Document: []byte(`{"type":"object"}`)}
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
			return canonicalTestCatalog("p1", "k8s:/pods"), nil
		},
		GetResourceGroupsFunc: func(_ context.Context, got resource.AccessRoute) ([]resource.ResourceGroup, error) {
			assert.Equal(t, route, got)
			return groups, nil
		},
		GetResourceDefinitionFunc: func(_ context.Context, got resource.AccessRoute, resourceType string) (resource.ResourceDefinition, error) {
			assert.Equal(t, route, got)
			assert.Equal(t, "k8s:/pods", resourceType)
			return definition, nil
		},
		GetEditorSchemasFunc: func(_ context.Context, got resource.AccessRoute) ([]resource.EditorSchema, error) {
			assert.Equal(t, route, got)
			return []resource.EditorSchema{}, nil
		},
		GetSchemaDocumentFunc: func(_ context.Context, got resource.AccessRoute, ref resource.SchemaDocumentReference) (resource.SchemaDocument, error) {
			assert.Equal(t, route, got)
			assert.Equal(t, reference, ref)
			return document, nil
		},
	})
	gotGroups, err := ctrl.GetResourceGroups(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	assert.Equal(t, groups, gotGroups)
	gotDefinition, err := ctrl.GetResourceDefinition(testInvocationContext(), "p1", route, "k8s:/pods")
	require.NoError(t, err)
	assert.Equal(t, definition, gotDefinition)
	schemas, err := ctrl.GetEditorSchemas(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	assert.NotNil(t, schemas)
	gotDocument, err := ctrl.GetSchemaDocument(testInvocationContext(), "p1", route, reference)
	require.NoError(t, err)
	assert.Equal(t, document, gotDocument)
}
