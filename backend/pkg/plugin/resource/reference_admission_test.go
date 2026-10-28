package resource

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestAdmitReferencePinsMetadataWithoutGetAndKeepsRequestLifetime(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{}
	registerActionTestPlugin(ctrl, "p1", provider)
	input := admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "restart")
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := canonicalTestCatalog("p1", "pods")
		catalog.Revision = "utility-admission"
		catalog.Types[0].Capabilities = nil
		return catalog, nil
	}
	var targets []invocation.Target
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, target invocation.Target) error {
		require.Equal(t, "exec.CreateSession", operation)
		targets = append(targets, target)
		return nil
	}))
	parent, cancel := context.WithCancel(testInvocationContext())
	defer cancel()
	ctx, err := ctrl.AdmitReference(parent, "exec.CreateSession", "p1", input.Route, input.Reference)
	require.NoError(t, err)
	require.NoError(t, ctx.Err(), "temporary catalog cleanup must not cancel utility admission")
	_, ok := resourcev2.CatalogRevisionFromContext(ctx)
	require.True(t, ok)
	require.Len(t, targets, 2)
	require.NotEmpty(t, targets[1].Scope["query-scope"])
	request, ok := invocation.FromContext(ctx)
	require.True(t, ok)
	require.Equal(t, "exec.CreateSession", request.Operation())
	require.Equal(t, input.Reference.Address.ID, request.Target().Object)
	cancel()
	require.ErrorIs(t, ctx.Err(), context.Canceled)
}

func TestAdmitReferenceDerivedScopeDenialStopsUtilityAdmission(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{}
	registerActionTestPlugin(ctrl, "p1", provider)
	input := admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "restart")
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, target invocation.Target) error {
		require.Equal(t, "logs.CreateSession", operation)
		if target.Scope["query-scope"] != "" {
			return errors.New("derived scope denied")
		}
		return nil
	}))
	_, err := ctrl.AdmitReference(testInvocationContext(), "logs.CreateSession", "p1", input.Route, input.Reference)
	require.Error(t, err)
	require.Equal(t, "FORBIDDEN", requireAppError(t, err).Code)
}

func TestAdmitReferenceRejectsUnknownOperationAndUntrustedContext(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	_, err := ctrl.AdmitReference(testInvocationContext(), "resource.Get", "p1", resourcev2.AccessRoute{}, resourcev2.ResourceReference{})
	require.Error(t, err)
	_, err = ctrl.AdmitReference(context.Background(), "metric.Query", "p1", resourcev2.AccessRoute{}, resourcev2.ResourceReference{})
	require.Error(t, err)
	require.Equal(t, "FORBIDDEN", requireAppError(t, err).Code)
}

func TestAdmitReferenceBoundsAcceptedCatalogRevision(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &mockProvider{}
	registerActionTestPlugin(ctrl, "p1", provider)
	input := admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "restart")
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := canonicalTestCatalog("p1", "pods")
		catalog.Revision = strings.Repeat("r", resourcev2.MaxCatalogRevisionBytes+1)
		return catalog, nil
	}
	ctx, err := ctrl.AdmitReference(testInvocationContext(), "metric.Query", "p1", input.Route, input.Reference)
	require.NoError(t, err)
	revision, ok := resourcev2.CatalogRevisionFromContext(ctx)
	require.True(t, ok)
	require.NotEmpty(t, revision)
	require.LessOrEqual(t, len(revision), resourcev2.MaxCatalogRevisionBytes)
}

func TestAdmitReferenceDistinguishesProviderMismatchFromRetiredAuthority(t *testing.T) {
	for _, mismatch := range []struct {
		name   string
		code   string
		mutate func(*resourcev2.ResourceReference)
	}{
		{name: "provider", code: "INVALID_REQUEST", mutate: func(reference *resourcev2.ResourceReference) { reference.Address.Provider = "other-provider" }},
		{name: "authority", code: "RESET_REQUIRED", mutate: func(reference *resourcev2.ResourceReference) { reference.Address.Authority += "-retired" }},
	} {
		t.Run(mismatch.name, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			provider := &mockProvider{}
			registerActionTestPlugin(ctrl, "p1", provider)
			input := admittedActionRequest(t, ctrl, "p1", "conn-1", "pods", "restart")
			mismatch.mutate(&input.Reference)
			_, err := ctrl.AdmitReference(testInvocationContext(), "exec.CreateSession", "p1", input.Route, input.Reference)
			require.Error(t, err)
			require.Equal(t, mismatch.code, requireAppError(t, err).Code)
		})
	}
}
