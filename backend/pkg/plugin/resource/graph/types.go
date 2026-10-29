package graph

import (
	"encoding/json"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// RelationshipType re-exports from SDK for convenience.
type RelationshipType = resource.RelationshipType

const (
	RelOwns     = resource.RelOwns
	RelRunsOn   = resource.RelRunsOn
	RelUses     = resource.RelUses
	RelExposes  = resource.RelExposes
	RelManages  = resource.RelManages
	RelMemberOf = resource.RelMemberOf
)

// Direction controls which edges GetRelated returns.
type Direction int

const (
	Outgoing Direction = iota
	Incoming
	Both
)

// GraphNode identifies a specific resource instance in the graph.
type GraphNode struct {
	PluginID  string                     `json:"pluginId"`
	Reference resource.ResourceReference `json:"reference"`
	Route     resource.AccessRoute       `json:"route"`
	// addressKey is cached only on graph-owned immutable snapshots.
	addressKey string
}

// Key uses the host's canonical identity key. Routes never establish identity.
func (n GraphNode) Key() string {
	if n.addressKey != "" {
		return n.addressKey
	}
	key, err := registry.CanonicalAddressKey(n.Reference.Address)
	if err != nil {
		panic(err)
	}
	return key
}

// MarshalJSON supplies the host-issued key so clients never reconstruct identity.
func (n GraphNode) MarshalJSON() ([]byte, error) {
	key, err := registry.CanonicalAddressKey(n.Reference.Address)
	if err != nil {
		return nil, err
	}
	if n.Reference.Address.Scope == nil {
		n.Reference.Address.Scope = []resource.ScopeEntry{}
	}
	type node GraphNode
	return json.Marshal(struct {
		node
		Key string `json:"key"`
	}{node(n), key})
}

type GraphEdge struct {
	Source GraphNode        `json:"source"`
	Target GraphNode        `json:"target"`
	Type   RelationshipType `json:"type"`
	Label  string           `json:"label"`
}

type DependencyTree struct {
	Root     GraphNode        `json:"root"`
	Children []DependencyNode `json:"children"`
}

type DependencyNode struct {
	Edge     GraphEdge        `json:"edge"`
	Children []DependencyNode `json:"children"`
}

func cloneNode(node GraphNode) GraphNode {
	node.addressKey = ""
	node.Reference.Address.Scope = append([]resource.ScopeEntry{}, node.Reference.Address.Scope...)
	if node.Reference.Incarnation != nil {
		token := *node.Reference.Incarnation
		node.Reference.Incarnation = &token
	}
	return node
}

func cloneEdge(edge GraphEdge) GraphEdge {
	edge.Source = cloneNode(edge.Source)
	edge.Target = cloneNode(edge.Target)
	return edge
}
