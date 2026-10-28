package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
)

func TestGraphBoundaryDenialDoesNotReturnProtectedNeighborhood(t *testing.T) {
	boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(invocation.Principal, string, invocation.Target) error { return errors.New("private") }))
	service := NewGraphService(graph.NewRelationshipGraph(), invocation.NewScope(invocation.TrustedUI), boundary, validateGraphTestReference)
	node := graphTestNode("supplied-actor", "privileged-route", "opaque", "", "object")
	result, err := service.GetSubgraph(context.Background(), "supplied-actor", node.Reference, node.Route, 1, 1)
	if err == nil || result != nil {
		t.Fatal("denied graph request returned a neighborhood")
	}
}
