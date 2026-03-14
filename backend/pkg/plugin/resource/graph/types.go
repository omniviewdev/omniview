package graph

import (
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
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
	PluginID     string `json:"pluginId"`
	ConnectionID string `json:"connectionId"`
	ResourceKey  string `json:"resourceKey"`
	ID           string `json:"id"`
	Namespace    string `json:"namespace,omitempty"`
}

// Key returns a unique string for this node. Uses "/" as separator — callers
// must ensure component values do not contain "/".
func (n GraphNode) Key() string {
	return n.PluginID + "/" + n.ConnectionID + "/" + n.ResourceKey + "/" + n.Namespace + "/" + n.ID
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

type deferredEdge struct {
	Source    GraphNode
	Type      RelationshipType
	Label     string
	TargetKey string
	TargetID  string
	TargetNS  string
}
