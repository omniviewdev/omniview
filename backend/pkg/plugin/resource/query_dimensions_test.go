package resource

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync/atomic"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func hostSelectionScope(repository string) resource.QueryScope {
	domain := []string{"helm-client"}
	scope := resource.QueryScope{{Dimension: "domain", Match: resource.ScopeOneOf, Values: &domain}, {Dimension: "repository", Match: resource.ScopeAny}}
	if repository != "" {
		values := []string{repository}
		scope[1].Match, scope[1].Values = resource.ScopeOneOf, &values
	}
	return scope
}

// Use the actual SDK controller and transport. Native rows carry repository as
// source data, never as identity or a host-inferred substring of their opaque ID.
func hostSelectionProvider(t *testing.T, restrictedGet bool) (resource.Provider, *atomic.Int32, chan resource.Session) {
	t.Helper()
	catalog := canonicalTestCatalog("native-helm-fixture", "opaque/charts")
	descriptor := &catalog.Types[0]
	descriptor.DefaultRepresentation = "native"
	descriptor.IdentityDimensions = []resource.Dimension{{Name: "domain"}}
	descriptor.QueryDimensions = []resource.Dimension{{Name: "domain"}, {Name: "repository"}}
	descriptor.Capabilities = []resource.Capability{
		{Operation: resource.OperationGet, Scope: hostSelectionScope("")},
		{Operation: resource.OperationEnumerate, Scope: hostSelectionScope("")},
		{Operation: resource.OperationNativeQuery, Scope: hostSelectionScope("")},
	}
	if restrictedGet {
		descriptor.Capabilities[0].Scope = hostSelectionScope("repository-X")
	}
	native := []struct{ id, repository string }{{"repository-X/opaque-looking-ID", "repository-Y"}, {"native::雪%2F", "repository-X"}}
	record := func(authority, id, repository string) resource.Record {
		row := canonicalTestRecord(catalog.Provider, authority, descriptor.Type, id)
		row.Reference.Address.Scope = []resource.ScopeEntry{{Dimension: "domain", Value: "helm-client"}}
		row.Body.Map["nativeRepository"] = resource.Value{Kind: "string", String: repository}
		return row
	}
	calls := &atomic.Int32{}
	sessions := make(chan resource.Session, 64)
	page := func(target resource.ReadTarget) (resource.SourcePage, error) {
		var repository string
		for _, constraint := range target.Scope {
			if constraint.Dimension == "repository" && constraint.Match == resource.ScopeOneOf && constraint.Values != nil && len(*constraint.Values) == 1 {
				repository = (*constraint.Values)[0]
			}
		}
		if repository == "" {
			return resource.SourcePage{}, resource.NewError("INVALID_REQUEST", "Select a native repository.")
		}
		rows := []resource.Record{}
		for _, row := range native {
			if row.repository == repository {
				rows = append(rows, record(target.Authority, row.id, row.repository))
			}
		}
		return resource.SourcePage{Records: rows, Count: resource.Count{Kind: "unknown"}, Coverage: resource.Coverage{Kind: "partial", Paths: []string{}, Reason: "Only the selected native repository was acquired."}, Consistency: "bestEffort"}, nil
	}
	provider, err := resource.NewController(resource.Config[struct{}]{
		Catalog: func(ctx context.Context, _ resource.CatalogRequest) (resource.Catalog, error) {
			session, _ := resource.SessionFromContext(ctx)
			sessions <- session
			return catalog, nil
		},
		Registrations: []resource.Registration[struct{}]{{Type: descriptor.Type,
			Get: func(_ context.Context, _ *struct{}, request resource.GetRequest) (resource.Record, error) {
				calls.Add(1)
				for _, row := range native {
					if row.id == request.Reference.Address.ID {
						return record(request.Reference.Address.Authority, row.id, row.repository), nil
					}
				}
				return resource.Record{}, resource.NewError("NOT_FOUND", "Native row not found.")
			},
			Enumerate: func(_ context.Context, _ *struct{}, request resource.EnumerateRequest) (resource.SourcePage, error) {
				return page(request.Target)
			},
			NativeQuery: func(_ context.Context, _ *struct{}, request resource.NativeQueryRequest) (resource.SourcePage, error) {
				return page(request.Target)
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = provider.Close() })
	return setupGRPCProvider(t, provider), calls, sessions
}

func hostSelectionReference(t *testing.T, ctrl *controller) ResolvedReference {
	t.Helper()
	resolved, err := ctrl.ResolveReference(testInvocationContext(), "helm-fixture", ResolveReferenceRequest{
		Route: resource.AccessRoute{Connection: "explicit-native-route"}, Type: "opaque/charts", Representation: "native",
		Scope: []resource.ScopeEntry{{Dimension: "domain", Value: "helm-client"}}, ID: "repository-X/opaque-looking-ID",
	})
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}

func TestHostGetQueryOnlyScopePolicyDenialPreventsNativeAcquisition(t *testing.T) {
	provider, calls, sessions := hostSelectionProvider(t, false)
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "helm-fixture", provider)
	resolved := hostSelectionReference(t, ctrl)
	<-sessions // Reference metadata, not the subsequent Get's correlation.
	identityAllowed, derivedDenied := false, false
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, target invocation.Target) error {
		if operation != "resource.Get" {
			return nil
		}
		if target.Scope["query-scope"] == "" {
			identityAllowed = true
			return nil
		}
		var scope resource.QueryScope
		if err := json.Unmarshal([]byte(target.Scope["query-scope"]), &scope); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(scope, hostSelectionScope("")) {
			t.Fatalf("derived selection was guessed or narrowed: %+v", scope)
		}
		derivedDenied = true
		return errors.New("private repository access policy")
	}))
	result, err := ctrl.Get(testInvocationContext(), "helm-fixture", HostGetRequest{TargetID: resolved.TargetID, Request: resource.GetRequest{Route: resolved.Route, Reference: resolved.Reference, Representation: resolved.Representation}})
	app := requireAppError(t, err)
	metadataSession := <-sessions
	if app.Code != "FORBIDDEN" || app.RequestID == "" || app.RequestID != metadataSession.RequestID || !identityAllowed || !derivedDenied {
		t.Fatalf("derived policy admission/correlation lost: %+v metadata=%+v", app, metadataSession)
	}
	if calls.Load() != 0 || result.Key != "" {
		t.Fatal("denial acquired or published a native row")
	}
	if _, found := ctrl.registryStore.Get("helm-fixture", resolved.Reference, resolved.Route); found {
		t.Fatal("denial populated registry state")
	}
}

func TestHostGetQueryOnlyDimensionNeverBecomesIdentityOrIDInference(t *testing.T) {
	for _, restricted := range []bool{false, true} {
		t.Run(map[bool]string{false: "unknown-selection-supported", true: "restricted-selection-rejected"}[restricted], func(t *testing.T) {
			provider, calls, _ := hostSelectionProvider(t, restricted)
			ctrl, _ := newTestControllerWithEmitter(t)
			registerMockPlugin(ctrl, "helm-fixture", provider)
			resolved := hostSelectionReference(t, ctrl)
			result, err := ctrl.Get(testInvocationContext(), "helm-fixture", HostGetRequest{TargetID: resolved.TargetID, Request: resource.GetRequest{Route: resolved.Route, Reference: resolved.Reference, Representation: resolved.Representation}})
			if restricted {
				if requireAppError(t, err).Code != "UNSUPPORTED" || calls.Load() != 0 {
					t.Fatal("Get inferred a restricted repository from an opaque ID")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if calls.Load() != 1 || !reflect.DeepEqual(result.Record.Reference, resolved.Reference) || result.Record.Body.Map["nativeRepository"].String != "repository-Y" {
				t.Fatalf("Get changed native identity or guessed repository: %+v", result)
			}
			bad := resolved.Reference.Address
			bad.Scope = append(append([]resource.ScopeEntry{}, bad.Scope...), resource.ScopeEntry{Dimension: "repository", Value: "repository-X"})
			if _, err := ctrl.ResolveReference(testInvocationContext(), "helm-fixture", ResolveReferenceRequest{Route: resolved.Route, Type: bad.Type, Scope: bad.Scope, ID: bad.ID, Representation: "native"}); err == nil {
				t.Fatal("query-only repository accepted as identity")
			}
		})
	}
}

func TestHostNativeQueryOnlySelectionRetainsNativePages(t *testing.T) {
	provider, _, _ := hostSelectionProvider(t, false)
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "helm-fixture", provider)
	for _, repository := range []string{"repository-X", "repository-Y"} {
		resolved, err := ctrl.ResolveTarget(testInvocationContext(), "helm-fixture", ResolveTargetRequest{Route: resource.AccessRoute{Connection: "explicit-native-route"}, Type: "opaque/charts", Representation: "native", Scope: hostSelectionScope(repository)})
		if err != nil {
			t.Fatal(err)
		}
		for _, query := range []bool{false, true} {
			var result HostSourcePage
			if query {
				result, err = ctrl.NativeQuery(testInvocationContext(), "helm-fixture", HostNativeQueryRequest{TargetID: resolved.TargetID, Request: resource.NativeQueryRequest{Target: resolved.Target, PageSize: 1, Language: "native-fixture", Query: resource.Value{Kind: "map", Map: map[string]resource.Value{}}}})
			} else {
				result, err = ctrl.Enumerate(testInvocationContext(), "helm-fixture", HostEnumerateRequest{TargetID: resolved.TargetID, Request: resource.EnumerateRequest{Target: resolved.Target, PageSize: 1}})
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Records) != 1 || result.Records[0].Record.Body.Map["nativeRepository"].String != repository || len(result.Records[0].Record.Reference.Address.Scope) != 1 {
				t.Fatalf("native selection or identity changed: %+v", result)
			}
			if result.SourcePage.Count.Kind != "unknown" || result.SourcePage.Coverage.Kind != "partial" || result.SourcePage.Consistency != "bestEffort" {
				t.Fatalf("host promoted native coverage/count: %+v", result.SourcePage)
			}
		}
	}
}

func TestExactReadTargetProjectsOnlyDeclaredQueryDimensions(t *testing.T) {
	descriptor := resource.ResourceType{IdentityDimensions: []resource.Dimension{{Name: "domain"}, {Name: "identity-only"}}, QueryDimensions: []resource.Dimension{{Name: "repository"}, {Name: "domain"}}}
	request := resource.GetRequest{Route: resource.AccessRoute{Connection: "explicit"}, Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: "provider", Authority: "host-issued", Type: "opaque/type", ID: "repository-X/not-a-query-proof", Scope: []resource.ScopeEntry{{Dimension: "identity-only", Value: "opaque"}, {Dimension: "domain", Value: "helm-client"}}}}, Representation: "native"}
	target, err := exactReadTarget(request, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if len(target.Scope) != 2 || target.Scope[0].Dimension != "repository" || target.Scope[0].Match != resource.ScopeAny || target.Scope[1].Dimension != "domain" || target.Scope[1].Values == nil || !reflect.DeepEqual(*target.Scope[1].Values, []string{"helm-client"}) {
		t.Fatalf("identity-only dimensions leaked or query-only scope was guessed: %+v", target)
	}
	if !targetContainsReference(target, request.Route, request.Reference) {
		t.Fatal("query-only any rejected exact identity")
	}
	repository := []string{"repository-X"}
	target.Scope[0] = resource.ScopeConstraint{Dimension: "repository", Match: resource.ScopeOneOf, Values: &repository}
	if targetContainsReference(target, request.Route, request.Reference) {
		t.Fatal("address matching claimed unproven query-only membership")
	}
}

func TestHostGetReauthorizationKeepsCapturedRouteEpoch(t *testing.T) {
	provider, calls, _ := hostSelectionProvider(t, false)
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "helm-fixture", provider)
	resolved := hostSelectionReference(t, ctrl)
	entered, resume := make(chan struct{}), make(chan struct{})
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, target invocation.Target) error {
		if operation == "resource.Get" && target.Scope["query-scope"] != "" {
			close(entered)
			<-resume
		}
		return nil
	}))
	done := make(chan error, 1)
	go func() {
		_, err := ctrl.Get(testInvocationContext(), "helm-fixture", HostGetRequest{TargetID: resolved.TargetID, Request: resource.GetRequest{Route: resolved.Route, Reference: resolved.Reference, Representation: resolved.Representation}})
		done <- err
	}()
	<-entered
	invalidationErr := ctrl.invalidateProfileRoutes("helm-fixture", []string{resolved.Route.Connection})
	close(resume)
	if invalidationErr != nil {
		t.Fatal(invalidationErr)
	}
	if err := <-done; requireAppError(t, err).Code != "RESET_REQUIRED" || calls.Load() != 0 {
		t.Fatalf("policy callback replaced captured source generation: %v", err)
	}
	if _, found := ctrl.registryStore.Get("helm-fixture", resolved.Reference, resolved.Route); found {
		t.Fatal("retired target populated registry")
	}
}
