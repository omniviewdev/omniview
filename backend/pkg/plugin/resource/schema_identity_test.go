package resource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// identityAssociation resolves document through a real catalog snapshot and
// derives its editor association exactly as GetEditorSchemas does.
func identityAssociation(t *testing.T, plugin, connection, resourceType, representation, key, document string) (EditorSchemaAssociation, *resourcecatalog.Schema) {
	t.Helper()
	revision := "schema:1"
	declared := representation
	if declared == "" {
		declared = "native"
	}
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	snapshot := catalog.Observe(
		resourcecatalog.ConnectionKey{PluginID: plugin, Generation: "g1", Connection: connection, Epoch: 1},
		resource.Catalog{Provider: "identity", Revision: "c1", Types: []resource.ResourceType{{
			Type: resourceType, DisplayName: resourceType, DefaultRepresentation: declared,
			Representations: []resource.Representation{{ID: declared, Revision: "r1", Schema: resource.SchemaBinding{
				State: "available", Revision: &revision, Dialect: resource.DialectJSONSchema202012, Document: json.RawMessage(document)}}},
		}}})
	entry, err := snapshot.Entry(resourceType, declared)
	require.NoError(t, err)
	schema, err := entry.Resolve(context.Background(), nil)
	require.NoError(t, err)
	association, err := editorAssociation(plugin, connection, resourceType, representation, key, "yaml", schema, nil)
	require.NoError(t, err)
	return association, schema
}

// TestEditorAssociationIdentityIsScopedAndRevisionStable proves the Monaco model
// directory (spec §§2.2, 7.1) is scoped by plugin, connection, type and
// representation (or auxiliary key), follows the contract's hash formula, and is
// deliberately stable across schema revisions while DocumentID tracks content.
func TestEditorAssociationIdentityIsScopedAndRevisionStable(t *testing.T) {
	const documentA = `{"type":"object","properties":{"alpha":{"type":"string"}}}`
	const documentB = `{"type":"object","properties":{"beta":{"type":"integer"}}}`

	// The contract's formula is the independent oracle.
	hex16 := func(plugin, connection, resourceType, discriminator string) string {
		sum := sha256.Sum256([]byte("omniview.editor.v1\x00" + plugin + "\x00" + connection + "\x00" + resourceType + "\x00" + discriminator))
		return hex.EncodeToString(sum[:])[:16]
	}

	base, baseSchema := identityAssociation(t, "p1", "c1", "instance", "native", "", documentA)
	assert.Equal(t, "file:///omniview-schema/"+hex16("p1", "c1", "instance", "native"), base.ModelDirectory)
	assert.Equal(t, "**/omniview-schema/"+hex16("p1", "c1", "instance", "native")+"/*", base.FileMatch)
	assert.Equal(t, "available", base.Status)
	assert.Equal(t, resourcecatalog.EditorRoot(baseSchema), base.Root)
	assert.Equal(t, hex.EncodeToString(baseSchema.Document.Digest[:]), base.DocumentID)

	// Each identity dimension, changed alone, yields a different directory and
	// file match, so two scopes can never share an open editor model.
	variants := map[string]EditorSchemaAssociation{"base": base}
	for name, args := range map[string][5]string{
		"plugin":         {"p2", "c1", "instance", "native", ""},
		"connection":     {"p1", "c2", "instance", "native", ""},
		"type":           {"p1", "c1", "volume", "native", ""},
		"representation": {"p1", "c1", "instance", "model", ""},
		"auxiliary":      {"p1", "c1", "instance", "", "native"}, // key "native" must not collide with representation "native"
		"auxiliary key":  {"p1", "c1", "instance", "", "release/one"},
	} {
		association, _ := identityAssociation(t, args[0], args[1], args[2], args[3], args[4], documentA)
		variants[name] = association
		discriminator := args[3]
		if discriminator == "" {
			discriminator = "aux:" + args[4]
		}
		assert.Equal(t, "file:///omniview-schema/"+hex16(args[0], args[1], args[2], discriminator), association.ModelDirectory, name)
	}
	seenDirectories, seenMatches := map[string]string{}, map[string]string{}
	for name, association := range variants {
		if other, ok := seenDirectories[association.ModelDirectory]; ok {
			t.Errorf("%s and %s share model directory %s", name, other, association.ModelDirectory)
		}
		if other, ok := seenMatches[association.FileMatch]; ok {
			t.Errorf("%s and %s share file match %s", name, other, association.FileMatch)
		}
		seenDirectories[association.ModelDirectory], seenMatches[association.FileMatch] = name, name
		// The same bytes everywhere: content identity is the one thing shared.
		assert.Equal(t, base.DocumentID, association.DocumentID, name)
	}

	// A new schema revision at the same identity keeps the directory, so open
	// models survive; the document identity changes with the content.
	revised, revisedSchema := identityAssociation(t, "p1", "c1", "instance", "native", "", documentB)
	assert.Equal(t, base.ModelDirectory, revised.ModelDirectory, "model directory must be revision-stable")
	assert.Equal(t, base.FileMatch, revised.FileMatch)
	assert.NotEqual(t, base.DocumentID, revised.DocumentID, "DocumentID must follow content")
	assert.Equal(t, hex.EncodeToString(revisedSchema.Document.Digest[:]), revised.DocumentID)

	// The same inputs derive the same association every time.
	again, _ := identityAssociation(t, "p1", "c1", "instance", "native", "", documentA)
	assert.Equal(t, base, again)
}
