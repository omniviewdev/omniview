package devworkspace

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPluginUIClosureBuildsRealJavaScriptDependenciesOnly(t *testing.T) {
	g := graphFixture(t)
	nodes, err := pluginUINodes(g.Nodes, "plugin")
	require.NoError(t, err)
	ids := make([]string, 0, len(nodes))
	for _, node := range nodes {
		require.Equal(t, "javascript", node.Kind)
		ids = append(ids, node.ID)
	}
	require.Equal(t, []string{"base-ui", "ai-ui", "editors", "providers", "runtime", "vite-plugin", "plugin-ui:plugin"}, ids)
}

func TestPluginUIClosureRejectsUnknownTargetAndMissingDependency(t *testing.T) {
	g := graphFixture(t)
	_, err := pluginUINodes(g.Nodes, "absent")
	require.Error(t, err)
	for i := range g.Nodes {
		if g.Nodes[i].ID == "runtime" {
			g.Nodes[i].Dependencies = append(g.Nodes[i].Dependencies, "missing")
		}
	}
	_, err = pluginUINodes(g.Nodes, "plugin")
	require.Error(t, err)
}

func TestPluginUIClosureRejectsNativeDependencyRatherThanBuildingIt(t *testing.T) {
	nodes := []BuildNode{
		{ID: "backend", Kind: "plugin-backend"},
		{ID: "plugin-ui:kubernetes", Kind: "javascript", Dependencies: []string{"backend"}},
	}
	_, err := pluginUINodes(nodes, "kubernetes")
	require.Error(t, err)
}

func TestPluginUIClosureRejectsCyclesAndDuplicateNodeIdentities(t *testing.T) {
	nodes := []BuildNode{
		{ID: "runtime", Kind: "javascript", Dependencies: []string{"plugin-ui:kubernetes"}},
		{ID: "plugin-ui:kubernetes", Kind: "javascript", Dependencies: []string{"runtime"}},
	}
	_, err := pluginUINodes(nodes, "kubernetes")
	require.Error(t, err)
	nodes[0].Dependencies = nil
	nodes = append(nodes, nodes[0])
	_, err = pluginUINodes(nodes, "kubernetes")
	require.Error(t, err)
}
