package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
)

func TestGraphBoundaryDenialDoesNotReturnProtectedNeighborhood(t *testing.T) {
	boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(invocation.Principal, string, invocation.Target) error { return errors.New("private") }))
	ctrl, _ := newTestControllerWithEmitter(t)
	service := NewGraphService(ctrl, invocation.NewScope(invocation.TrustedUI), boundary)
	node := graphTestNode("supplied-actor", "privileged-route", "opaque", "", "object")
	result, err := service.GetSubgraph(context.Background(), "supplied-actor", node.Reference, node.Route, 1, 1)
	if err == nil || result != nil {
		t.Fatal("denied graph request returned a neighborhood")
	}
}
