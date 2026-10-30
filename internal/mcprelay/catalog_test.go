package mcprelay

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/tools"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

func TestBuildCatalogNamespacesAndInjectsConnection(t *testing.T) {
	readOnly := true
	catalog := BuildCatalog(map[string]tools.PluginTools{
		"kubernetes": {
			Meta: config.PluginMeta{ID: "kubernetes", Name: "Kubernetes"},
			Tools: []sdktools.Descriptor{
				{Name: "list_pods", Scope: sdktools.ScopeConnection, InputSchema: sdktools.ObjectSchema(map[string]any{"namespace": map[string]any{"type": "string"}}, "namespace"), OutputSchema: json.RawMessage(`{"type":"object"}`), Annotations: sdktools.Annotations{ReadOnly: &readOnly}},
				{Name: "bad schema", Scope: sdktools.ScopePlugin, InputSchema: json.RawMessage(`{"type":"string"}`)},
				{Name: "no_schema", Scope: sdktools.ScopePlugin, InputSchema: json.RawMessage(`{"type":"string"}`)},
			},
		},
		"alpha": {
			Meta:  config.PluginMeta{ID: "alpha"},
			Tools: []sdktools.Descriptor{{Name: "ping", Scope: sdktools.ScopePlugin, InputSchema: sdktools.ObjectSchema(nil)}},
		},
	})

	names := make([]string, 0, len(catalog))
	for _, info := range catalog {
		names = append(names, info.MCPName+":"+info.Status)
	}
	require.Equal(t, []string{
		"alpha_ping:ok",
		"kubernetes_list_connections:ok",
		"kubernetes_bad schema:invalid-name",
		"kubernetes_list_pods:ok",
		"kubernetes_no_schema:invalid-schema",
	}, names)

	require.Equal(t, "alpha", catalog[0].PluginName, "plugin name falls back to the ID")

	listConnections := catalog[1]
	require.True(t, listConnections.BuiltIn)
	require.True(t, listConnections.ReadOnly)
	require.Equal(t, ScopePlugin, listConnections.Scope)
	require.Equal(t, "Kubernetes", listConnections.PluginName)

	listPods := catalog[3]
	require.Equal(t, ScopeConnection, listPods.Scope)
	require.Equal(t, "Kubernetes", listPods.PluginName)
	properties, ok := listPods.InputSchema["properties"].(map[string]any)
	require.True(t, ok)
	require.Contains(t, properties, "connection_id")
	connectionID, ok := properties["connection_id"].(map[string]any)
	require.True(t, ok)
	require.Contains(t, connectionID["description"], "kubernetes_list_connections")
	require.Equal(t, []any{"namespace", "connection_id"}, listPods.InputSchema["required"])
	require.Equal(t, "object", listPods.OutputSchema["type"])
}

func TestBuildCatalogMarksConflicts(t *testing.T) {
	catalog := BuildCatalog(map[string]tools.PluginTools{
		"a":   {Meta: config.PluginMeta{ID: "a"}, Tools: []sdktools.Descriptor{{Name: "b_c", Scope: sdktools.ScopePlugin, InputSchema: sdktools.ObjectSchema(nil)}}},
		"a_b": {Meta: config.PluginMeta{ID: "a_b"}, Tools: []sdktools.Descriptor{{Name: "c", Scope: sdktools.ScopePlugin, InputSchema: sdktools.ObjectSchema(nil)}}},
	})
	require.Len(t, catalog, 2)
	require.Equal(t, "a_b_c", catalog[0].MCPName)
	require.Equal(t, StatusOK, catalog[0].Status)
	require.Equal(t, "a_b_c", catalog[1].MCPName)
	require.Equal(t, StatusConflict, catalog[1].Status)
}

func TestBuildCatalogWithoutConnectionToolsHasNoListConnections(t *testing.T) {
	catalog := BuildCatalog(map[string]tools.PluginTools{
		"alpha": {Meta: config.PluginMeta{ID: "alpha"}, Tools: []sdktools.Descriptor{{Name: "ping", Scope: sdktools.ScopePlugin, InputSchema: sdktools.ObjectSchema(nil)}}},
	})
	require.Len(t, catalog, 1)
	require.Equal(t, "alpha_ping", catalog[0].MCPName)
	require.Equal(t, []any{}, catalog[0].InputSchema["required"])
}
