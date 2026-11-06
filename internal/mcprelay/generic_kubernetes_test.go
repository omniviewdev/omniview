package mcprelay

import (
	"encoding/json"
	"testing"

	"github.com/google/jsonschema-go/jsonschema"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestGenericKubernetesDescriptors(t *testing.T) {
	tools := genericKubernetesTools()
	require.Len(t, tools, 5)
	seen := map[string]bool{}
	for _, tool := range tools {
		require.True(t, isGenericKubernetesTool(tool))
		require.False(t, seen[tool.MCPName])
		seen[tool.MCPName] = true
		require.Equal(t, ScopeConnection, tool.Scope)
		require.Equal(t, "kubernetes", tool.PluginID)
		require.Equal(t, StatusOK, tool.Status)
	}
	require.Equal(t, map[string]bool{
		"kubernetes_resource_discover":  true,
		"kubernetes_resource_read":      true,
		"kubernetes_resource_write":     true,
		"kubernetes_resource_action":    true,
		"kubernetes_resource_telemetry": true,
	}, seen)
}

func TestGenericKubernetesGroupOperations(t *testing.T) {
	groups := map[string][]string{
		"discover":  {"catalog", "scope_values"},
		"read":      {"get", "enumerate", "native_query", "related"},
		"write":     {"create", "update", "delete"},
		"action":    {"action"},
		"telemetry": {"events", "health", "metrics", "logs"},
	}
	for _, tool := range genericKubernetesTools() {
		group, ok := genericKubernetesOperationFor(tool)
		require.True(t, ok)
		schemaJSON, err := json.Marshal(tool.InputSchema)
		require.NoError(t, err)
		var schema jsonschema.Schema
		require.NoError(t, json.Unmarshal(schemaJSON, &schema))
		resolved, err := schema.Resolve(nil)
		require.NoError(t, err)
		for _, operation := range groups[group.group] {
			t.Run(group.group+"/"+operation, func(t *testing.T) {
				args := map[string]any{"connection_id": "cluster", "operation": operation, "arguments": map[string]any{}}
				if operation != "catalog" && operation != "scope_values" {
					args["resource_type"] = "pods"
				}
				if operation == "native_query" {
					args["language"] = "selector"
				}
				if operation == "action" {
					args["action"] = "restart"
				}
				require.NoError(t, resolved.Validate(args))
				delete(args, "connection_id")
				raw, err := json.Marshal(args)
				require.NoError(t, err)
				selected, err := genericKubernetesSelectedOperation(group.group, raw)
				require.NoError(t, err)
				require.Equal(t, operation, selected.name)
				_, err = parseGenericKubernetesArguments(selected, raw)
				require.NoError(t, err)
			})
		}
		require.Error(t, resolved.Validate(map[string]any{"connection_id": "cluster", "arguments": map[string]any{}}))
		require.Error(t, resolved.Validate(map[string]any{"connection_id": "cluster", "operation": "invalid", "arguments": map[string]any{}}))
		_, err = genericKubernetesSelectedOperation(group.group, []byte(`{"operation":"invalid"}`))
		require.Error(t, err)
	}
	_, err := genericKubernetesSelectedOperation("read", []byte(`{"operation":"delete"}`))
	require.Error(t, err)
}

func TestGenericKubernetesCatalogDescriptors(t *testing.T) {
	schema := map[string]any{"type": "object", "required": []string{"connection_id"}}
	items := []ToolInfo{
		{MCPName: "hashed-get", PluginID: "kubernetes", Status: StatusOK, InputSchema: schema,
			Resource: &ResourceBinding{PluginID: "kubernetes", Type: "pods", Operation: "resource.Get"}},
		{MCPName: "hashed-create", PluginID: "kubernetes", Status: StatusOK, InputSchema: schema,
			Resource: &ResourceBinding{PluginID: "kubernetes", Type: "pods", Operation: "resource.Mutate", Verb: "create"}},
		{MCPName: "hashed-query", PluginID: "kubernetes", Status: StatusOK, InputSchema: schema,
			Resource: &ResourceBinding{PluginID: "kubernetes", Type: "pods", Operation: "resource.NativeQuery", Language: "selector"}},
		{MCPName: "hashed-action", PluginID: "kubernetes", Status: StatusOK, InputSchema: schema,
			Resource: &ResourceBinding{PluginID: "kubernetes", Type: "pods", Operation: "resource.Action", Action: "restart"}},
		{MCPName: "hashed-events", PluginID: "kubernetes", Status: StatusOK, InputSchema: schema,
			Resource: &ResourceBinding{PluginID: "kubernetes", Operation: opGetResourceEvents, Types: map[string]RouteType{"pods": {}, "nodes": {}}}},
	}
	got := genericKubernetesCatalogDescriptors(items)
	require.Len(t, got, 6)
	require.Equal(t, "kubernetes_resource_read", got[0].Name)
	require.Equal(t, "get", got[0].Operation)
	require.Equal(t, "pods", got[0].ResourceType)
	require.Equal(t, schema, got[0].InputSchema)
	require.Equal(t, "kubernetes_resource_write", got[1].Name)
	require.Equal(t, "create", got[1].Operation)
	require.Equal(t, "native_query", got[2].Operation)
	require.Equal(t, "selector", got[2].Language)
	require.Equal(t, "kubernetes_resource_action", got[3].Name)
	require.Equal(t, "action", got[3].Operation)
	require.Equal(t, "restart", got[3].Action)
	require.Equal(t, "kubernetes_resource_telemetry", got[4].Name)
	require.Equal(t, "events", got[4].Operation)
	require.Equal(t, "nodes", got[4].ResourceType)
	require.Equal(t, "pods", got[5].ResourceType)
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
	valid := []byte(`{"operation":"native_query","resource_type":"pods","language":"selector","arguments":{"query":{"count":9007199254740993}}}`)
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
		{"wrong type", `{"operation":"native_query","resource_type":"nodes","language":"selector","arguments":{"query":{"count":1}}}`, "cluster", []ToolInfo{tool}},
		{"wrong language", `{"operation":"native_query","resource_type":"pods","language":"other","arguments":{"query":{"count":1}}}`, "cluster", []ToolInfo{tool}},
		{"invalid live schema", `{"operation":"native_query","resource_type":"pods","language":"selector","arguments":{"query":{"count":"one"}}}`, "cluster", []ToolInfo{tool}},
		{"unknown field", `{"operation":"native_query","resource_type":"pods","language":"selector","arguments":{"query":{"count":1},"extra":true}}`, "cluster", []ToolInfo{tool}},
		{"connection spoof", `{"operation":"native_query","resource_type":"pods","language":"selector","arguments":{"connection_id":"other","query":{"count":1}}}`, "cluster", []ToolInfo{tool}},
		{"duplicate", `{"operation":"native_query","resource_type":"pods","resource_type":"nodes","language":"selector","arguments":{}}`, "cluster", []ToolInfo{tool}},
		{"missing operation", `{"resource_type":"pods","language":"selector","arguments":{}}`, "cluster", []ToolInfo{tool}},
		{"wrong operation", `{"operation":"get","resource_type":"pods","language":"selector","arguments":{}}`, "cluster", []ToolInfo{tool}},
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
	_, _, err := resolveGenericKubernetesTool(op, "cluster", []byte(`{"operation":"events","resource_type":"pods","arguments":{"reference":{"address":{"type":"pods"}}}}`), []ToolInfo{tool})
	require.NoError(t, err)
	_, _, err = resolveGenericKubernetesTool(op, "cluster", []byte(`{"operation":"events","resource_type":"pods","arguments":{"reference":{"address":{"type":"nodes"}}}}`), []ToolInfo{tool})
	require.Error(t, err)
	_, _, err = resolveGenericKubernetesTool(op, "cluster", []byte(`{"operation":"events","resource_type":"nodes","arguments":{"reference":{"address":{"type":"nodes"}}}}`), []ToolInfo{tool})
	require.Error(t, err)
}
