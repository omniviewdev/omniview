package mcprelay

import (
	"encoding/json"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestGenericKubernetesDescriptors(t *testing.T) {
	tools := genericKubernetesTools()
	require.Len(t, tools, len(genericKubernetesOperations))
	seen := map[string]bool{}
	for _, tool := range tools {
		require.True(t, isGenericKubernetesTool(tool))
		require.False(t, seen[tool.MCPName])
		seen[tool.MCPName] = true
		require.Equal(t, ScopeConnection, tool.Scope)
		require.Equal(t, "kubernetes", tool.PluginID)
		require.Equal(t, StatusOK, tool.Status)
	}
}

func TestGenericKubernetesIdentityCannotBeForgedByName(t *testing.T) {
	tool := genericKubernetesTools()[0]
	require.True(t, isGenericKubernetesTool(tool))
	tool.ReadOnly = false
	require.False(t, isGenericKubernetesTool(tool))
	tool = genericKubernetesTools()[0]
	tool.Generation = 1
	require.False(t, isGenericKubernetesTool(tool))
	tool = genericKubernetesTools()[0]
	tool.PluginID = "another-plugin"
	require.False(t, isGenericKubernetesTool(tool))
}

func TestResolveGenericKubernetesTool(t *testing.T) {
	op := genericKubernetesOperation{name: "native_query", operation: "resource.NativeQuery", readOnly: true, selector: "language"}
	binding := &ResourceBinding{PluginID: "kubernetes", Route: resourcev2.AccessRoute{Connection: "cluster"}, Type: "pods", Operation: op.operation, Language: "selector"}
	tool := ToolInfo{MCPName: "real", PluginID: "kubernetes", Status: StatusOK, Resource: binding,
		InputSchema: map[string]any{"type": "object", "properties": map[string]any{
			"connection_id": map[string]any{"type": "string", "enum": []string{"cluster"}},
			"query":         map[string]any{"type": "object", "properties": map[string]any{"count": map[string]any{"type": "integer"}}, "required": []string{"count"}, "additionalProperties": false},
		}, "required": []string{"connection_id", "query"}, "additionalProperties": false}}
	valid := []byte(`{"resource_type":"pods","language":"selector","arguments":{"query":{"count":9007199254740993}}}`)
	selected, args, err := resolveGenericKubernetesTool(op, "cluster", valid, []ToolInfo{tool})
	require.NoError(t, err)
	require.Equal(t, "real", selected.MCPName)
	require.JSONEq(t, `{"query":{"count":9007199254740993}}`, string(args))
	var exact map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(args, &exact))
	require.Contains(t, string(exact["query"]), "9007199254740993")

	for _, tc := range []struct {
		name, raw, connection string
		catalog               []ToolInfo
	}{
		{"wrong connection", string(valid), "other", []ToolInfo{tool}},
		{"wrong type", `{"resource_type":"nodes","language":"selector","arguments":{"query":{"count":1}}}`, "cluster", []ToolInfo{tool}},
		{"wrong language", `{"resource_type":"pods","language":"other","arguments":{"query":{"count":1}}}`, "cluster", []ToolInfo{tool}},
		{"invalid live schema", `{"resource_type":"pods","language":"selector","arguments":{"query":{"count":"one"}}}`, "cluster", []ToolInfo{tool}},
		{"unknown field", `{"resource_type":"pods","language":"selector","arguments":{"query":{"count":1},"extra":true}}`, "cluster", []ToolInfo{tool}},
		{"connection spoof", `{"resource_type":"pods","language":"selector","arguments":{"connection_id":"other","query":{"count":1}}}`, "cluster", []ToolInfo{tool}},
		{"duplicate", `{"resource_type":"pods","resource_type":"nodes","language":"selector","arguments":{}}`, "cluster", []ToolInfo{tool}},
		{"ambiguous", string(valid), "cluster", []ToolInfo{tool, tool}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := resolveGenericKubernetesTool(op, tc.connection, []byte(tc.raw), tc.catalog)
			require.Error(t, err)
		})
	}
}

func TestResolveGenericKubernetesRouteLane(t *testing.T) {
	op := genericKubernetesOperation{name: "events", operation: opGetResourceEvents, routeLane: true, readOnly: true}
	binding := &ResourceBinding{PluginID: "kubernetes", Route: resourcev2.AccessRoute{Connection: "cluster"}, Operation: opGetResourceEvents, Types: map[string]RouteType{"pods": {}}}
	tool := ToolInfo{MCPName: "events", PluginID: "kubernetes", Status: StatusOK, Resource: binding,
		InputSchema: map[string]any{"type": "object", "properties": map[string]any{"connection_id": map[string]any{"type": "string"}, "reference": map[string]any{"type": "object"}}, "required": []string{"connection_id", "reference"}, "additionalProperties": false}}
	_, _, err := resolveGenericKubernetesTool(op, "cluster", []byte(`{"resource_type":"pods","arguments":{"reference":{"address":{"type":"pods"}}}}`), []ToolInfo{tool})
	require.NoError(t, err)
	_, _, err = resolveGenericKubernetesTool(op, "cluster", []byte(`{"resource_type":"pods","arguments":{"reference":{"address":{"type":"nodes"}}}}`), []ToolInfo{tool})
	require.Error(t, err)
	_, _, err = resolveGenericKubernetesTool(op, "cluster", []byte(`{"resource_type":"nodes","arguments":{"reference":{"address":{"type":"nodes"}}}}`), []ToolInfo{tool})
	require.Error(t, err)
}
