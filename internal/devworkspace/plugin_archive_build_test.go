package devworkspace

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func archiveClosureFixture() []BuildNode {
	return []BuildNode{
		{ID: "bindings", Kind: "bindings"},
		{ID: "providers", Kind: "javascript"},
		{ID: "runtime", Kind: "javascript", Dependencies: []string{"bindings", "providers"}},
		{ID: "vite-plugin", Kind: "javascript", Dependencies: []string{"runtime"}},
		{ID: "plugin-ui:kubernetes", Kind: "javascript", Dependencies: []string{"providers", "runtime", "vite-plugin"}},
		{ID: "plugin-backend:kubernetes", Kind: "plugin-backend", PluginID: "kubernetes"},
		{ID: "plugin-ui:other", Kind: "javascript"},
		{ID: "plugin-backend:other", Kind: "plugin-backend", PluginID: "other"},
		{ID: "host-frontend", Kind: "javascript", Dependencies: []string{"plugin-ui:kubernetes", "plugin-ui:other"}},
		{ID: "host-backend", Kind: "host-backend", Dependencies: []string{"host-frontend"}},
	}
}

func TestPluginArchiveClosureSelectsCanonicalUIAndOwnBackendOnly(t *testing.T) {
	nodes, err := pluginArchiveNodes(archiveClosureFixture(), "kubernetes")
	require.NoError(t, err)
	ids := make([]string, 0, len(nodes))
	for _, node := range nodes {
		ids = append(ids, node.ID)
	}
	require.Equal(t, []string{"providers", "runtime", "vite-plugin", "plugin-ui:kubernetes", "plugin-backend:kubernetes"}, ids)
}

func TestPluginArchiveClosureFailsClosedForIncompleteOrNativeDependencies(t *testing.T) {
	for name, change := range map[string]func([]BuildNode) []BuildNode{
		"missing backend":     func(nodes []BuildNode) []BuildNode { return append(nodes[:5], nodes[6:]...) },
		"wrong backend kind":  func(nodes []BuildNode) []BuildNode { nodes[5].Kind = "host-backend"; return nodes },
		"wrong backend owner": func(nodes []BuildNode) []BuildNode { nodes[5].PluginID = "other"; return nodes },
		"host dependency":     func(nodes []BuildNode) []BuildNode { nodes[5].Dependencies = []string{"host-backend"}; return nodes },
		"unrelated backend": func(nodes []BuildNode) []BuildNode {
			nodes[5].Dependencies = []string{"plugin-backend:other"}
			return nodes
		},
		"native UI dependency": func(nodes []BuildNode) []BuildNode {
			nodes[4].Dependencies = []string{"plugin-backend:kubernetes"}
			return nodes
		},
		"missing UI dependency": func(nodes []BuildNode) []BuildNode { nodes[2].Dependencies = []string{"absent"}; return nodes },
		"cycle":                 func(nodes []BuildNode) []BuildNode { nodes[2].Dependencies = []string{"vite-plugin"}; return nodes },
		"duplicate":             func(nodes []BuildNode) []BuildNode { return append(nodes, nodes[5]) },
	} {
		t.Run(name, func(t *testing.T) {
			_, err := pluginArchiveNodes(change(archiveClosureFixture()), "kubernetes")
			require.Error(t, err)
		})
	}
	_, err := pluginArchiveNodes(archiveClosureFixture(), "absent")
	require.Error(t, err)
}
