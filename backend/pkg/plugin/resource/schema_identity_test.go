package resource

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func identitySchema(t *testing.T, plugin, connection, typ, representation, key, document string) (EditorSchemaResult, *resourcecatalog.Schema) {
	t.Helper()
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	snapshot := catalog.Observe(resourcecatalog.ConnectionKey{PluginID: plugin, Generation: "g1", Connection: connection, Epoch: 1},
		resource.Catalog{Provider: "identity", Revision: "c1", Types: []resource.ResourceType{{Type: typ,
			Representations: []resource.Representation{{ID: "native", Revision: "format:1"}, {ID: "model", Revision: "format:1"}}}}})
	request := resource.SchemaRequest{Route: resource.AccessRoute{Connection: connection}, Type: typ}
	if representation != "" {
		request.Target.Representation = &resource.Representation{ID: representation, Revision: "format:1"}
	} else {
		request.Target.Auxiliary = &resource.AuxiliarySchemaTarget{Key: key,
			Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: "identity", Authority: "authority", Type: typ, ID: key, Scope: []resource.ScopeEntry{}}}}
	}
	entry, err := snapshot.Target(request)
	require.NoError(t, err)
	resolution, err := entry.Resolve(context.Background(), func(context.Context, resource.SchemaRequest) (resource.SchemaBinding, error) {
		return inlineSchemaBinding(document), nil
	}, nil)
	require.NoError(t, err)
	out, err := editorSchema(entry, resolution, nil)
	require.NoError(t, err)
	require.NoError(t, entry.Current(out.Observation))
	return out, resolution.Schema
}

func TestEditorBundleKeepsTargetIdentitySeparateFromSchemaContent(t *testing.T) {
	const documentA = `{"type":"object","properties":{"alpha":{"type":"string"}}}`
	const documentB = `{"type":"object","properties":{"beta":{"type":"integer"}}}`
	base, schema := identitySchema(t, "p1", "c1", "instance", "native", "", documentA)
	require.NotNil(t, base.Document)
	assert.Equal(t, "available", base.Status)
	assert.Equal(t, resourcecatalog.EditorRoot(schema), base.Root)
	assert.Equal(t, hex.EncodeToString(schema.Document.Digest[:]), base.Document.DocumentID)
	for name, args := range map[string][5]string{
		"plugin":         {"p2", "c1", "instance", "native", ""},
		"connection":     {"p1", "c2", "instance", "native", ""},
		"type":           {"p1", "c1", "volume", "native", ""},
		"representation": {"p1", "c1", "instance", "model", ""},
		"auxiliary":      {"p1", "c1", "instance", "", "values/web"},
	} {
		t.Run(name, func(t *testing.T) {
			out, _ := identitySchema(t, args[0], args[1], args[2], args[3], args[4], documentA)
			require.NotNil(t, out.Document)
			assert.Equal(t, base.Document.DocumentID, out.Document.DocumentID, "immutable content may share; content identity is not target permission")
			encoded, err := json.Marshal(out)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "modelDirectory")
			assert.NotContains(t, string(encoded), "fileMatch")
		})
	}
	revised, _ := identitySchema(t, "p1", "c1", "instance", "native", "", documentB)
	assert.Equal(t, base.Target, revised.Target, "schema changes do not change editor target identity")
	require.NotNil(t, revised.Document)
	assert.NotEqual(t, base.Document.DocumentID, revised.Document.DocumentID)
}
