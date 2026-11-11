package main

import (
	"context"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Presentation for the host's custom table cell contract. Only the hypervisor VM
// type declares columns. Every other type reports the SDK's UNSUPPORTED class,
// exactly like a provider without presentation, so the host keeps its generic
// columns for them.
const (
	// presentationType is the one probe type that declares columns.
	presentationType = "vm"
	// nodeCellComponent names the renderer the probe UI contributes.
	nodeCellComponent = "workspace-probe/node-badge"
	// unregisteredCellComponent names a renderer that no plugin contributes, so its column
	// must render the host's explicit Unavailable state.
	unregisteredCellComponent = "workspace-probe/unregistered-cell"
)

// benchmarkProvider adds presentation and schema resolution to the controller.
// The controller reports only the optional traits it installed, so the wrapper extends that result.
type benchmarkProvider struct {
	*resource.Controller[benchmarkClient]
}

var (
	_ resource.PresentationProvider = (*benchmarkProvider)(nil)
	_ resource.SchemaResolver       = (*benchmarkProvider)(nil)
	_ resource.FeatureNegotiator    = (*benchmarkProvider)(nil)
)

func (p *benchmarkProvider) Features(ctx context.Context) (resource.FeatureSet, error) {
	features, err := p.Controller.Features(ctx)
	if err != nil {
		return resource.FeatureSet{}, err
	}
	if !features.Has(resource.FeaturePresentation) {
		features.Traits = append(features.Traits, resource.FeaturePresentation)
	}
	if !features.Has(resource.FeatureSchemaResolver) {
		features.Traits = append(features.Traits, resource.FeatureSchemaResolver)
	}
	return features, resource.ValidateFeatures(features)
}

func unsupportedPresentation() error {
	return resource.NewError("UNSUPPORTED", "The probe declares no presentation for this resource type.")
}

// GetResourceGroups declares no groups: the host lists every type by itself.
func (p *benchmarkProvider) GetResourceGroups(ctx context.Context, _ resource.AccessRoute) ([]resource.ResourceGroup, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, unsupportedPresentation()
}

// GetResourceDefinition returns the VM columns: a plain text column, a column whose
// renderer the probe UI contributes (with params the renderer must receive verbatim),
// and a column whose renderer nobody contributes.
func (p *benchmarkProvider) GetResourceDefinition(ctx context.Context, _ resource.AccessRoute, resourceType string) (resource.ResourceDefinition, error) {
	if err := ctx.Err(); err != nil {
		return resource.ResourceDefinition{}, err
	}
	if resourceType != presentationType {
		return resource.ResourceDefinition{}, unsupportedPresentation()
	}
	return resource.ResourceDefinition{ColumnDefs: []resource.ColumnDefinition{
		{ID: "name", Header: "Name", Accessors: "name"},
		{
			ID: "node", Header: "Node", Accessors: "node",
			Component:       nodeCellComponent,
			ComponentParams: map[string]any{"badge": "node", "emphasis": true},
		},
		{ID: "host", Header: "Host", Accessors: "host", Component: unregisteredCellComponent},
	}}, nil
}
