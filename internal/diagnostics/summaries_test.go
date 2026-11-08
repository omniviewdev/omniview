package diagnostics

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestCaptureListNeverSerializesSamples(t *testing.T) {
	s := testService(t)
	capture, err := s.StartCapture(CaptureRequest{Name: "summary", DurationSeconds: 10})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Export(context.Background(), testData(7)); err != nil {
		t.Fatal(err)
	}
	first, err := json.Marshal(s.ListCaptures())
	if err != nil {
		t.Fatal(err)
	}
	sample := s.GetSnapshot()
	s.mu.Lock()
	for range 100 {
		s.captures[capture.ID].Samples = append(s.captures[capture.ID].Samples, sample)
	}
	s.mu.Unlock()
	summaries := s.ListCaptures()
	encoded, err := json.Marshal(summaries)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "\"samples\"") || strings.Contains(string(encoded), "\"metrics\"") {
		t.Fatalf("capture list leaked samples: %s", encoded)
	}
	if len(summaries) != 1 || summaries[0].SampleCount != 101 || len(encoded) > len(first)+4 {
		t.Fatalf("summary grew with history: %d -> %d, %+v", len(first), len(encoded), summaries)
	}
	full, err := s.GetCapture(capture.ID)
	if err != nil || len(full.Samples) != 101 {
		t.Fatalf("full record lost samples: %d %v", len(full.Samples), err)
	}
}
func TestCatalogContainsOnlyInstrumentDescriptors(t *testing.T) {
	s := testService(t)
	if err := s.Export(context.Background(), testData(7)); err != nil {
		t.Fatal(err)
	}
	catalog := s.GetCatalog()
	encoded, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "\"points\"") || strings.Contains(string(encoded), "\"attributes\"") || strings.Contains(string(encoded), "\"value\"") {
		t.Fatalf("catalog leaked collected points: %s", encoded)
	}
	if len(catalog.Metrics) != 1 || catalog.Metrics[0].Name != "requests" || catalog.Metrics[0].Kind != "counter" {
		t.Fatalf("descriptor lost: %+v", catalog)
	}
	catalog.Metrics[0].Name = "mutated"
	if s.GetSnapshot().Metrics[0].Name != "requests" {
		t.Fatal("descriptor mutation changed sample")
	}
}
