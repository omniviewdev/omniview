package main

import (
	"context"
	"encoding/json"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func newTestProvider(t *testing.T) (*benchmarkSource, *benchmarkProvider) {
	t.Helper()
	source, err := loadBenchmarkSource()
	if err != nil {
		t.Fatal(err)
	}
	controller, err := newBenchmarkController(source)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = controller.Close() })
	return source, &benchmarkProvider{Controller: controller}
}

func TestPresentationIsAdvertisedByTheWrapper(t *testing.T) {
	_, provider := newTestProvider(t)
	ctx := context.Background()

	// The plugin server derives traits from the wrapper, not from the bare controller.
	detected, err := resource.DetectFeatures(ctx, provider)
	if err != nil {
		t.Fatal(err)
	}
	if !detected.Has(resource.FeaturePresentation) {
		t.Fatalf("presentation not advertised: %+v", detected)
	}
	bare, err := provider.Controller.Features(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if bare.Has(resource.FeaturePresentation) {
		t.Fatal("the bare controller must not advertise presentation")
	}
	for _, trait := range bare.Traits {
		if !detected.Has(trait) {
			t.Fatalf("wrapper dropped controller trait %q", trait)
		}
	}
}

func TestVMDefinitionDeclaresPlainCustomAndUnregisteredColumns(t *testing.T) {
	source, provider := newTestProvider(t)
	route := resource.AccessRoute{Connection: "hypervisor-bundled-vms"}

	definition, err := provider.GetResourceDefinition(context.Background(), route, presentationType)
	if err != nil {
		t.Fatal(err)
	}
	if err := resource.ValidateResourceDefinition(definition); err != nil {
		t.Fatal(err)
	}
	if scenario := source.scenarios[route.Connection]; scenario.Type != presentationType {
		t.Fatalf("scenario %q serves %q, not %q", route.Connection, scenario.Type, presentationType)
	}
	columns := map[string]resource.ColumnDefinition{}
	for _, column := range definition.ColumnDefs {
		columns[column.ID] = column
	}
	if len(columns) != 3 {
		t.Fatalf("unexpected columns: %+v", definition.ColumnDefs)
	}
	if name := columns["name"]; name.Component != "" || name.ComponentParams != nil {
		t.Fatalf("the plain column must stay a host text cell: %+v", name)
	}
	node := columns["node"]
	if node.Component != nodeCellComponent {
		t.Fatalf("node column component %q", node.Component)
	}
	params, err := json.Marshal(node.ComponentParams)
	if err != nil {
		t.Fatal(err)
	}
	if string(params) != `{"badge":"node","emphasis":true}` {
		t.Fatalf("node column params %s", params)
	}
	if host := columns["host"]; host.Component != unregisteredCellComponent || host.ComponentParams != nil {
		t.Fatalf("the host column must name a renderer nobody contributes: %+v", host)
	}

	// Every accessor must resolve against the real corpus bodies, or its column renders empty.
	for _, name := range []string{"vm-a", "vm-b"} {
		var body map[string]any
		if err := json.Unmarshal(source.records[name].Body, &body); err != nil {
			t.Fatal(err)
		}
		for _, column := range definition.ColumnDefs {
			if value, ok := body[column.Accessors]; !ok || value == "" {
				t.Fatalf("record %s has no %q for column %s", name, column.Accessors, column.ID)
			}
		}
	}
}

func TestOtherTypesAndGroupsStayUnsupported(t *testing.T) {
	_, provider := newTestProvider(t)
	ctx := context.Background()
	route := resource.AccessRoute{Connection: "cloud-bundled-pages"}

	for _, resourceType := range []string{"compute/instance", "container", "host", "disk", "core::v1::Pod", "vm/", ""} {
		_, err := provider.GetResourceDefinition(ctx, route, resourceType)
		if resource.ErrorCode(err) != "UNSUPPORTED" {
			t.Fatalf("type %q: want UNSUPPORTED, got %v", resourceType, err)
		}
	}
	if _, err := provider.GetResourceGroups(ctx, route); resource.ErrorCode(err) != "UNSUPPORTED" {
		t.Fatalf("groups: want UNSUPPORTED, got %v", err)
	}

	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := provider.GetResourceDefinition(canceled, route, presentationType); err == nil {
		t.Fatal("a canceled request must fail")
	}
}
