package invocation

import (
	"context"
	"errors"
	"testing"
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
