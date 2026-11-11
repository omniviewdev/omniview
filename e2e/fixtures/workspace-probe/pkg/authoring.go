package main

import (
	"context"
	"encoding/json"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// The extra representation leaves the benchmark's native data contract unchanged.
// Its schema is acquired only when the host resolves that exact representation.
func authoringRepresentation(connection string) resource.Representation {
	return resource.Representation{ID: "authoring", Revision: "authoring/" + connection}
}

func (p *benchmarkProvider) ResolveSchema(ctx context.Context, request resource.SchemaRequest) (resource.SchemaBinding, error) {
	if err := resource.ValidateSchemaRequest(request); err != nil {
		return resource.SchemaBinding{}, err
	}
	var binding resource.SchemaBinding
	err := p.WithClient(ctx, request.Route, func(bound context.Context, _ *benchmarkClient) error {
		catalog, err := p.Catalog(bound, resource.CatalogRequest{Route: request.Route})
		if err != nil {
			return err
		}
		selected := request.Target.Representation
		if selected != nil {
			for _, resourceType := range catalog.Types {
				if resourceType.Type != request.Type {
					continue
				}
				for _, current := range resourceType.Representations {
					if current.ID != selected.ID {
						continue
					}
					if current != *selected {
						return benchmarkError("RESET_REQUIRED", "The selected body format changed.")
					}
					switch current.ID {
					case "native":
						binding = resource.SchemaBinding{State: "absent"}
						return nil
					case "authoring":
						binding, err = authoringSchema(current.Revision)
						return err
					}
				}
			}
		}
		return benchmarkError("UNSUPPORTED", "The selected schema target is not supported.")
	})
	if err != nil {
		return resource.SchemaBinding{}, err
	}
	return binding, nil
}

func authoringSchema(revision string) (resource.SchemaBinding, error) {
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
		return resource.SchemaBinding{}, err
	}
	return resource.SchemaBinding{
		State: "available", Revision: &revision, Dialect: resource.DialectJSONSchema202012, Document: document,
	}, nil
}
