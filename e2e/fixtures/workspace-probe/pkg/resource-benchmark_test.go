package main

import (
	"context"
	"encoding/json"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

func TestFiniteCorpusBodiesAndCursor(t *testing.T) {
	source, err := loadBenchmarkSource()
	if err != nil {
		t.Fatal(err)
	}
	client := &benchmarkClient{name: "cloud-bundled-pages"}
	first, err := source.List(context.Background(), client, resource.ResourceMeta{}, resource.ListInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Result) != 1 || first.NextCursor == "" {
		t.Fatalf("bad first page: %+v", first)
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(first.Result[0], &body); err != nil {
		t.Fatal(err)
	}
	if string(body["sizeBytes"]) != "9007199254740993" {
		t.Fatal("canonical integer changed")
	}
	second, err := source.List(context.Background(), client, resource.ResourceMeta{}, resource.ListInput{Pagination: resource.PaginationParams{Cursor: first.NextCursor}})
	if err != nil || len(second.Result) != 1 || second.NextCursor != "" {
		t.Fatalf("bad final page: %+v %v", second, err)
	}
	if _, err := source.List(context.Background(), client, resource.ResourceMeta{}, resource.ListInput{Pagination: resource.PaginationParams{Cursor: "wrong"}}); err == nil {
		t.Fatal("accepted invalid cursor")
	}
}

func TestScaledCopiesKeepNativeBodiesAndExplicitBoundary(t *testing.T) {
	source, err := loadBenchmarkSource()
	if err != nil {
		t.Fatal(err)
	}
	client := &benchmarkClient{name: "hypervisor-bundled-vms"}
	result, err := source.List(context.Background(), client, resource.ResourceMeta{}, resource.ListInput{Pagination: resource.PaginationParams{Cursor: "p02:copies:501:0"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Result) != 200 || result.NextCursor != "p02:copies:501:200" {
		t.Fatalf("bad scaled page: %+v", result)
	}
	canonical := source.records["vm-a"].Body
	if string(result.Result[0]) != string(canonical) {
		t.Fatal("stress copy mutated canonical native body")
	}
}

func TestSnapshotDoesNotExposeWatch(t *testing.T) {
	source, err := loadBenchmarkSource()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := any(source).(resource.Watcher[benchmarkClient]); ok {
		t.Fatal("finite source acquired fabricated watch")
	}
}
