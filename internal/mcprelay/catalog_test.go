package mcprelay

import (
	"bytes"
	"context"
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

func TestCustomCatalogRejectsUnsafeDeclarations(t *testing.T) {
	for _, raw := range []string{
		`{"type":"object","properties":null}`,
		`{"type":"object","properties":[]}`,
		`{"type":"object","required":"connection_id"}`,
		`{"type":"object","required":[1]}`,
		`{"type":"object","required":["connection_id"]}`,
		`{"type":"object","properties":{"connection_id":{"type":"integer"}}}`,
		`{"type":"object","type":"object"}`,
		`{"type":"object","properties":{"x":{"format":"unknown-format"}}}`,
		`{"type":"object","$ref":"https://example.com/schema"}`,
		`{"type":"object","$schema":"http://json-schema.org/draft-07/schema#"}`,
	} {
		t.Run(raw, func(t *testing.T) {
			info := toolInfo("alpha", "Alpha", sdktools.Descriptor{
				Name: "unsafe", Scope: sdktools.ScopeConnection, InputSchema: json.RawMessage(raw),
			})
			require.Equal(t, StatusInvalidSchema, info.Status)
			require.Nil(t, info.InputSchema)
		})
	}
	info := toolInfo("alpha", "Alpha", sdktools.Descriptor{
		Name: "unsafe_output", Scope: sdktools.ScopePlugin,
		InputSchema: sdktools.ObjectSchema(nil), OutputSchema: json.RawMessage(`{"type":"object","required":7}`),
	})
	require.Equal(t, StatusInvalidSchema, info.Status)
	require.Nil(t, info.InputSchema)
}

func TestCustomCatalogPreservesExactSchemaNumbers(t *testing.T) {
	raw := json.RawMessage(`{"type":"object","properties":{"n":{"type":"integer","minimum":9007199254740993,"maximum":18446744073709551615,"enum":[9007199254740993]}}}`)
	info := toolInfo("alpha", "Alpha", sdktools.Descriptor{
		Name: "exact", Scope: sdktools.ScopePlugin, InputSchema: raw, OutputSchema: raw,
	})
	require.Equal(t, StatusOK, info.Status)
	for _, schema := range []map[string]any{info.InputSchema, info.OutputSchema} {
		encoded, err := json.Marshal(schema)
		require.NoError(t, err)
		require.Contains(t, string(encoded), `"minimum":9007199254740993`)
		require.Contains(t, string(encoded), `"maximum":18446744073709551615`)
		require.Contains(t, string(encoded), `"enum":[9007199254740993]`)
	}
}

func TestMCPInventoryKeepsBuiltinAndDropsUnsafeCustomTools(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	h.tools.mu.Lock()
	entry := h.tools.plugins["kubernetes"]
	entry.Tools = append(entry.Tools,
		sdktools.Descriptor{Name: listConnectionsTool, Scope: sdktools.ScopePlugin, InputSchema: sdktools.ObjectSchema(nil)},
		sdktools.Descriptor{Name: "unsafe_output", Scope: sdktools.ScopePlugin, InputSchema: sdktools.ObjectSchema(nil), OutputSchema: json.RawMessage(`{"type":"object","required":7}`)},
		sdktools.Descriptor{Name: "reserved", Scope: sdktools.ScopeConnection, InputSchema: json.RawMessage(`{"type":"object","properties":{"connection_id":{"const":"attacker"}}}`)},
		sdktools.Descriptor{Name: "overflow_input", Scope: sdktools.ScopePlugin, InputSchema: json.RawMessage(`{"type":"object","properties":{"n":{"minimum":1e4096}}}`)},
		sdktools.Descriptor{Name: "overflow_output", Scope: sdktools.ScopePlugin, InputSchema: sdktools.ObjectSchema(nil), OutputSchema: json.RawMessage(`{"type":"object","properties":{"n":{"maximum":-1e4096}}}`)},
	)
	h.tools.plugins["kubernetes"] = entry
	h.tools.plugins["bad/name"] = tools.PluginTools{Tools: []sdktools.Descriptor{
		{Name: "read", Scope: sdktools.ScopeConnection, InputSchema: sdktools.ObjectSchema(nil)},
	}}
	h.tools.mu.Unlock()
	for _, name := range []string{"kubernetes_unsafe_output", "kubernetes_reserved", "kubernetes_list_connections", "kubernetes_overflow_input", "kubernetes_overflow_output"} {
		require.NoError(t, h.service.SetToolOverride(Scope{}, name, ToolOverride{Enabled: new(true)}))
	}
	h.relay.resync()
	result, err := session.ListTools(context.Background(), nil)
	require.NoError(t, err)
	count := 0
	for _, tool := range result.Tools {
		require.NotEqual(t, "kubernetes_unsafe_output", tool.Name)
		require.NotEqual(t, "kubernetes_reserved", tool.Name)
		require.NotEqual(t, "kubernetes_overflow_input", tool.Name)
		require.NotEqual(t, "kubernetes_overflow_output", tool.Name)
		require.NotEqual(t, "bad/name_list_connections", tool.Name)
		if tool.Name == "kubernetes_list_connections" {
			count++
			require.Contains(t, tool.Description, "connections the AI tools may target")
			raw, err := json.Marshal(tool.InputSchema)
			require.NoError(t, err)
			decoder := json.NewDecoder(bytes.NewReader(raw))
			decoder.UseNumber()
			var schema map[string]any
			require.NoError(t, decoder.Decode(&schema))
			require.Equal(t, false, schema["additionalProperties"])
		}
	}
	require.Equal(t, 1, count)
}

func TestCatalogBuiltinWinsEarlierPluginCollision(t *testing.T) {
	catalog := BuildCatalog(map[string]tools.PluginTools{
		"a": {Tools: []sdktools.Descriptor{
			{Name: "b_list_connections", Scope: sdktools.ScopePlugin, InputSchema: sdktools.ObjectSchema(nil)},
		}},
		"a_b": {Tools: []sdktools.Descriptor{
			{Name: "read", Scope: sdktools.ScopeConnection, InputSchema: sdktools.ObjectSchema(nil)},
		}},
	})
	require.Equal(t, StatusConflict, catalog[0].Status)
	require.True(t, catalog[1].BuiltIn)
	require.Equal(t, StatusOK, catalog[1].Status)
	require.Equal(t, catalog[0].MCPName, catalog[1].MCPName)
	require.Equal(t, StatusInvalidName, listConnectionsInfo("bad/name", "Bad").Status)
}

func TestCustomCatalogRejectsMCPNumericOverflow(t *testing.T) {
	for _, raw := range []string{
		`{"type":"object","properties":{"n":{"minimum":1e4096}}}`,
		`{"type":"object","properties":{"n":{"maximum":-1e4096}}}`,
		`{"type":"object","properties":{"n":{"enum":[1e4096]}}}`,
	} {
		for _, output := range []bool{false, true} {
			d := sdktools.Descriptor{Name: "overflow", Scope: sdktools.ScopePlugin, InputSchema: json.RawMessage(raw)}
			if output {
				d.InputSchema = sdktools.ObjectSchema(nil)
				d.OutputSchema = json.RawMessage(raw)
			}
			require.Equal(t, StatusInvalidSchema, toolInfo("alpha", "Alpha", d).Status)
		}
	}
}
