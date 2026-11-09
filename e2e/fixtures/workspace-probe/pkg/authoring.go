package main

import (
	"encoding/json"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// The extra representation leaves the benchmark's native data and schema contract unchanged.
func authoringRepresentation(connection string) resource.Representation {
	revision := "authoring/" + connection
	document, err := json.Marshal(map[string]any{
		"type": "object", "additionalProperties": false,
		"properties": map[string]any{
			"name":     map[string]any{"type": "string"},
			"state":    map[string]any{"type": "string", "enum": []string{"running", "stopped"}},
			"hardware": map[string]any{"type": "object", "properties": map[string]any{"cores": map[string]any{"type": "integer"}}},
			"tags":     map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}},
		},
	})
	if err != nil {
		panic(err)
	}
	return resource.Representation{ID: "authoring", Revision: revision, Schema: resource.SchemaBinding{
		State: "available", Revision: &revision, Dialect: resource.DialectJSONSchema202012, Document: document,
	}}
}
