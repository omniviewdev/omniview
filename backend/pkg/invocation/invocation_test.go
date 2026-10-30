package invocation

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

func TestAdmissionRejectsUnissuedContextBeforeAuthorizer(t *testing.T) {
	called := false
	boundary := NewBoundary(AuthorizeFunc(func(Principal, string, Target) error { called = true; return nil }))
	_, err := boundary.Admit(context.Background(), "resource.get", Target{Provider: "cloud", Connection: "admin"})
	if err == nil || called {
		t.Fatalf("unissued caller reached authorization: called=%v err=%v", called, err)
	}
}

func TestTargetIDsNeverChangeIssuedOwner(t *testing.T) {
	boundary := NewBoundary(nil)
	owner := NewScope(TrustedUI)
	other := NewScope(Host)
	ctx, err := boundary.Admit(owner.Context(context.Background()), "resource.get", Target{Provider: other.Principal().Owner(), Connection: "root"})
	if err != nil {
		t.Fatal(err)
	}
	request, ok := FromContext(ctx)
	if !ok || request.Principal() != owner.Principal() || request.ID() == "" {
		t.Fatal("route input changed issued principal or lost correlation")
	}
	if request.OwnedBy(other.Context(context.Background())) {
		t.Fatal("foreign scope acquired ownership")
	}
}

func TestAdmissionCopiesTargetAndPreservesCancellation(t *testing.T) {
	boundary := NewBoundary(nil)
	scope := NewScope(TrustedUI)
	base, cancel := context.WithCancel(context.Background())
	target := Target{Provider: "hypervisor", Scope: map[string]string{"pool": "exact"}}
	ctx, err := boundary.Admit(scope.Context(base), "resource.get", target)
	if err != nil {
		t.Fatal(err)
	}
	target.Scope["pool"] = "all"
	request, _ := FromContext(ctx)
	got := request.Target()
	got.Scope["pool"] = "mutated"
	if request.Target().Scope["pool"] != "exact" {
		t.Fatal("caller mutated admitted target")
	}
	cancel()
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatal("request cancellation lost")
	}
	if _, err = boundary.Admit(scope.Context(base), "resource.get", target); err == nil {
		t.Fatal("canceled request admitted")
	}
}

func TestAuthorizerDenialDoesNotIssueRequest(t *testing.T) {
	deny := errors.New("private policy")
	boundary := NewBoundary(AuthorizeFunc(func(Principal, string, Target) error { return deny }))
	ctx, err := boundary.Admit(NewScope(TrustedUI).Context(context.Background()), "action.open", Target{Provider: "container"})
	if err == nil {
		t.Fatal("denial became success")
	}
	if _, ok := FromContext(ctx); ok {
		t.Fatal("denied request was committed")
	}
}

func TestReauthorizePreservesRequestOwnershipAndContext(t *testing.T) {
	type generationKey struct{}
	owner := NewScope(TrustedUI)
	base, cancel := context.WithCancel(owner.Context(context.Background()))
	defer cancel()
	base = context.WithValue(base, generationKey{}, "captured-source-epoch")
	calls := 0
	boundary := NewBoundary(AuthorizeFunc(func(principal Principal, operation string, target Target) error {
		calls++
		if principal != owner.Principal() || operation != "resource.Get" {
			t.Fatal("reauthorization changed provenance or operation")
		}
		target.Scope["authorizer-only"] = "must-not-escape"
		return nil
	}))
	target := Target{Provider: "provider", Connection: "route", ResourceType: "opaque/type", Object: "native/id", Scope: map[string]string{"resource-scope": "exact", "authority": "host-issued"}}
	initial, err := boundary.Admit(base, "resource.Get", target)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := FromContext(initial)
	target.Scope["query-scope"] = "explicit-any"
	refined, err := boundary.Reauthorize(initial, target)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := FromContext(refined)
	if calls != 2 || after.ID() != before.ID() || after.Principal() != before.Principal() || after.Operation() != before.Operation() ||
		!after.OwnedBy(initial) || refined.Value(generationKey{}) != "captured-source-epoch" {
		t.Fatal("reauthorization lost request identity, ownership, or captured context")
	}
	if before.Target().Scope["query-scope"] != "" || before.Target().Scope["authorizer-only"] != "" {
		t.Fatal("reauthorization mutated the original shared request")
	}
	target.Scope["query-scope"] = "caller-mutation"
	if after.Target().Scope["query-scope"] != "explicit-any" || after.Target().Scope["authorizer-only"] != "" {
		t.Fatal("refined target aliases caller or authorizer memory")
	}
	cancel()
	if !errors.Is(refined.Err(), context.Canceled) {
		t.Fatal("cancellation was detached")
	}
	if _, err := boundary.Reauthorize(refined, after.Target()); err == nil {
		t.Fatal("canceled refinement admitted")
	}
}

func TestReauthorizeCurrentPolicyDenialKeepsCorrelation(t *testing.T) {
	deny := false
	boundary := NewBoundary(AuthorizeFunc(func(Principal, string, Target) error {
		if deny {
			return errors.New("private changed policy")
		}
		return nil
	}))
	ctx, err := boundary.Admit(NewScope(TrustedUI).Context(context.Background()), "resource.Get",
		Target{Provider: "provider", ResourceType: "type", Object: "id", Scope: map[string]string{"resource-scope": "exact"}})
	if err != nil {
		t.Fatal(err)
	}
	request, _ := FromContext(ctx)
	target := request.Target()
	target.Scope["query-scope"] = "any"
	deny = true
	got, err := boundary.Reauthorize(ctx, target)
	var app *apperror.AppError
	if !errors.As(err, &app) || app.Code != "FORBIDDEN" || app.RequestID != request.ID() {
		t.Fatalf("policy denial lost typed error/correlation: %v", err)
	}
	unchanged, _ := FromContext(got)
	if unchanged.Target().Scope["query-scope"] != "" {
		t.Fatal("denial published a refined request")
	}
}

func TestReauthorizeRejectsForgedForeignAndRetargetedRequests(t *testing.T) {
	boundary := NewBoundary(nil)
	owner := NewScope(TrustedUI)
	ctx, err := boundary.Admit(owner.Context(context.Background()), "resource.Get",
		Target{Provider: "provider", Connection: "route", ResourceType: "type", Object: "id", Scope: map[string]string{"resource-scope": "exact", "authority": "host-issued"}})
	if err != nil {
		t.Fatal(err)
	}
	request, _ := FromContext(ctx)
	for _, candidate := range []context.Context{
		context.Background(),
		owner.Context(context.Background()),
		context.WithValue(owner.Context(context.Background()), requestKey{}, Request{id: "caller-supplied"}),
		NewScope(TrustedUI).Context(ctx),
	} {
		_, err := boundary.Reauthorize(candidate, request.Target())
		var app *apperror.AppError
		if !errors.As(err, &app) || app.Code != "FORBIDDEN" || app.RequestID == "caller-supplied" {
			t.Fatalf("unissued or foreign request admitted/correlation trusted: %v", err)
		}
	}
	if _, err := NewBoundary(nil).Reauthorize(ctx, request.Target()); err == nil {
		t.Fatal("another boundary reused an admission")
	}
	for _, change := range []func(*Target){
		func(target *Target) { target.Provider = "other" },
		func(target *Target) { target.Connection = "other" },
		func(target *Target) { target.ResourceType = "other" },
		func(target *Target) { target.Object = "other" },
		func(target *Target) { target.Action = "other" },
		func(target *Target) { target.Scope["authority"] = "other" },
		func(target *Target) { delete(target.Scope, "resource-scope") },
		func(target *Target) { target.Scope["permission"] = "grant" },
	} {
		target := request.Target()
		change(&target)
		if _, err := boundary.Reauthorize(ctx, target); err == nil {
			t.Fatal("refinement retargeted or broadened an invocation")
		}
	}
}
