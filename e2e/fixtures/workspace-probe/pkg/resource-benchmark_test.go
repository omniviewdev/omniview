package main

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func benchmarkTarget(source *benchmarkSource, profile string) resource.ReadTarget {
	scenario := source.scenarios[profile]
	scope := make(resource.QueryScope, 0)
	for dimension := range source.records[scenario.Pages[0].Records[0]].Scope {
		scope = append(scope, resource.ScopeConstraint{Dimension: dimension, Match: resource.ScopeAny})
	}
	return resource.ReadTarget{Route: resource.AccessRoute{Connection: profile}, Provider: "workspace-probe", Authority: "fixture-host-authority", Type: scenario.Type, Scope: scope, Representation: "native"}
}

func TestFiniteCorpusBodiesAndCursor(t *testing.T) {
	source, err := loadBenchmarkSource()
	if err != nil {
		t.Fatal(err)
	}
	client := &benchmarkClient{name: "cloud-bundled-pages"}
	target := benchmarkTarget(source, client.name)
	first, err := source.Enumerate(context.Background(), client, resource.EnumerateRequest{Target: target, PageSize: 200})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Records) != 1 || first.NextCursor == nil {
		t.Fatalf("bad first page: %+v", first)
	}
	if value := first.Records[0].Body.Map["sizeBytes"]; value.Kind != "int64" || value.Int != "9007199254740993" {
		t.Fatal("canonical integer changed")
	}
	if err := resource.ValidateSourcePage(first); err != nil {
		t.Fatal(err)
	}
	want, err := resource.JSONToValue(source.records["cloud-arn"].Body)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first.Records[0].Body, want) {
		t.Fatal("canonical tagged body changed")
	}
	second, err := source.Enumerate(context.Background(), client, resource.EnumerateRequest{Target: target, PageSize: 200, Cursor: first.NextCursor})
	if err != nil || len(second.Records) != 1 || second.NextCursor != nil {
		t.Fatalf("bad final page: %+v %v", second, err)
	}
	if _, err := source.Enumerate(context.Background(), client, resource.EnumerateRequest{Target: target, Cursor: stringPointer("wrong")}); err == nil {
		t.Fatal("accepted invalid cursor")
	}
}

func startedBenchmarkController(t *testing.T, source *benchmarkSource) *resource.Controller[benchmarkClient] {
	t.Helper()
	controller, err := newBenchmarkController(source)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := controller.Close(); err != nil {
			t.Error(err)
		}
	})
	if _, err := controller.LoadConnections(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, profile := range benchmarkProfiles {
		if _, err := controller.StartConnection(context.Background(), profile); err != nil {
			t.Fatal(err)
		}
	}
	return controller
}

func benchmarkAdmissionContext(t *testing.T, controller *resource.Controller[benchmarkClient], route resource.AccessRoute) context.Context {
	t.Helper()
	ctx := context.Background()
	catalog, err := controller.Catalog(ctx, resource.CatalogRequest{Route: route})
	if err != nil {
		t.Fatal(err)
	}
	return resource.WithCatalogRevision(ctx, catalog.Revision)
}

func TestControllerCanonicalPagesRespectPageSizeAndNeverRepeatAddresses(t *testing.T) {
	source, err := loadBenchmarkSource()
	if err != nil {
		t.Fatal(err)
	}
	controller := startedBenchmarkController(t, source)
	for _, profile := range benchmarkProfiles {
		t.Run(profile, func(t *testing.T) {
			target := benchmarkTarget(source, profile)
			ctx := benchmarkAdmissionContext(t, controller, target.Route)
			var cursor *string
			seenCursors, seenAddresses := map[string]bool{}, map[string]bool{}
			var acquired []resource.Record
			for {
				page, err := controller.Enumerate(ctx, resource.EnumerateRequest{Target: target, PageSize: 1, Cursor: cursor})
				if err != nil {
					t.Fatal(err)
				}
				if len(page.Records) > 1 {
					t.Fatal("source exceeded requested page size")
				}
				for _, record := range page.Records {
					key, err := json.Marshal(record.Reference.Address)
					if err != nil {
						t.Fatal(err)
					}
					if seenAddresses[string(key)] {
						t.Fatal("canonical acquisition repeated an address")
					}
					seenAddresses[string(key)] = true
					acquired = append(acquired, record)
				}
				cursor = page.NextCursor
				if cursor == nil {
					break
				}
				if seenCursors[*cursor] {
					t.Fatal("continuation repeated")
				}
				seenCursors[*cursor] = true
			}
			var expected []benchmarkRecord
			for _, page := range source.scenarios[profile].Pages {
				for _, name := range page.Records {
					expected = append(expected, source.records[name])
				}
			}
			if len(acquired) != len(expected) {
				t.Fatalf("lost records: got %d want %d", len(acquired), len(expected))
			}
			for index, item := range expected {
				want, err := source.record(target, item)
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(acquired[index], want) {
					t.Fatal("canonical identity or tagged body changed")
				}
			}
			if _, err := controller.Enumerate(ctx, resource.EnumerateRequest{Target: target, PageSize: 200, Cursor: stringPointer("p02:copies:501:0")}); err == nil {
				t.Fatal("accepted obsolete identity-duplicating stress cursor")
			}
			emptyCursor := ""
			if _, err := controller.Enumerate(ctx, resource.EnumerateRequest{Target: target, PageSize: 1, Cursor: &emptyCursor}); err == nil {
				t.Fatal("accepted explicit empty cursor")
			}
		})
	}
}

func TestControllerEnumerateHonorsNarrowAndEmptyScope(t *testing.T) {
	source, err := loadBenchmarkSource()
	if err != nil {
		t.Fatal(err)
	}
	controller := startedBenchmarkController(t, source)
	target := benchmarkTarget(source, "container-bundled-events")
	ctx := benchmarkAdmissionContext(t, controller, target.Route)
	values := []string{"unix:///engine/b::socket"}
	target.Scope = resource.QueryScope{{Dimension: "engine", Match: resource.ScopeOneOf, Values: &values}}
	page, err := controller.Enumerate(ctx, resource.EnumerateRequest{Target: target, PageSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Records) != 1 || page.NextCursor != nil || page.Records[0].Reference.Address.Scope[0].Value != values[0] {
		t.Fatalf("narrow scope returned wrong membership: %+v", page)
	}
	values = []string{}
	page, err = controller.Enumerate(ctx, resource.EnumerateRequest{Target: target, PageSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Records) != 0 || page.NextCursor != nil {
		t.Fatal("empty scope selection acquired resources")
	}
}

func TestControllerGetUsesUnorderedScopeAndOptionalIncarnation(t *testing.T) {
	source, err := loadBenchmarkSource()
	if err != nil {
		t.Fatal(err)
	}
	controller := startedBenchmarkController(t, source)
	target := benchmarkTarget(source, "cloud-bundled-pages")
	ctx := benchmarkAdmissionContext(t, controller, target.Route)
	want, err := source.record(target, source.records["cloud-arn"])
	if err != nil {
		t.Fatal(err)
	}
	reference := want.Reference
	reference.Address.Scope = append([]resource.ScopeEntry(nil), reference.Address.Scope...)
	reference.Address.Scope[0], reference.Address.Scope[1] = reference.Address.Scope[1], reference.Address.Scope[0]
	got, err := controller.Get(ctx, resource.GetRequest{Route: target.Route, Reference: reference, Representation: "native"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got.Body, want.Body) {
		t.Fatal("reordered identity selected a different body")
	}
	target = benchmarkTarget(source, "container-bundled-events")
	ctx = benchmarkAdmissionContext(t, controller, target.Route)
	want, err = source.record(target, source.records["container-a"])
	if err != nil {
		t.Fatal(err)
	}
	reference = want.Reference
	reference.Incarnation = nil
	got, err = controller.Get(ctx, resource.GetRequest{Route: target.Route, Reference: reference, Representation: "native"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Reference.Incarnation == nil || *got.Reference.Incarnation != *want.Reference.Incarnation {
		t.Fatal("optional incarnation lookup lost observed incarnation")
	}
	reference.Incarnation = stringPointer("wrong-incarnation")
	if _, err := controller.Get(ctx, resource.GetRequest{Route: target.Route, Reference: reference, Representation: "native"}); err == nil {
		t.Fatal("accepted mismatched requested incarnation")
	}
}

func TestAllProfilesAdvertiseOnlyRealOperations(t *testing.T) {
	source, err := loadBenchmarkSource()
	if err != nil {
		t.Fatal(err)
	}
	for _, profile := range benchmarkProfiles {
		catalog, err := source.Catalog(context.Background(), resource.CatalogRequest{Route: resource.AccessRoute{Connection: profile}})
		if err != nil {
			t.Fatal(err)
		}
		if err := resource.ValidateCatalog(catalog); err != nil {
			t.Fatalf("%s: %v", profile, err)
		}
		updates := false
		for _, capability := range catalog.Types[0].Capabilities {
			updates = updates || capability.Operation == resource.OperationUpdate
		}
		if updates != (profile == "container-bundled-events") {
			t.Fatalf("fabricated or missing update support: %s", profile)
		}
	}
}
