package main

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

type benchmarkTestSink struct {
	ready   chan struct{}
	updates chan resource.WatchUpdatePayload
}

func (*benchmarkTestSink) OnAdd(resource.WatchAddPayload)                {}
func (*benchmarkTestSink) OnDelete(resource.WatchDeletePayload)          {}
func (s *benchmarkTestSink) OnUpdate(update resource.WatchUpdatePayload) { s.updates <- update }
func (s *benchmarkTestSink) OnStateChange(resource.WatchStateEvent)      { close(s.ready) }

func TestSparseCanonicalEventReleaseAndCancellation(t *testing.T) {
	source, err := loadBenchmarkSource()
	if err != nil {
		t.Fatal(err)
	}
	events := &benchmarkEvents{source}
	client := &benchmarkClient{name: "container-bundled-events"}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	sink := &benchmarkTestSink{ready: make(chan struct{}), updates: make(chan resource.WatchUpdatePayload, 2)}
	done := make(chan error, 1)
	go func() { done <- events.Watch(ctx, client, resource.ResourceMeta{}, sink) }()
	select {
	case <-sink.ready:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	source.mu.Lock()
	watches := source.watches
	source.mu.Unlock()
	if watches != 1 {
		t.Fatal("source watch not counted")
	}
	_, err = source.List(ctx, client, resource.ResourceMeta{}, resource.ListInput{Pagination: resource.PaginationParams{Cursor: "p02:release"}})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case update := <-sink.updates:
		want := source.scenarios[client.name].Updates[0]
		if string(update.Data) != string(want.Body) || update.ID != source.records[want.Record].ID {
			t.Fatal("canonical sparse event changed")
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("watch did not cancel")
	}
	source.mu.Lock()
	defer source.mu.Unlock()
	if source.watches != 0 || len(source.release) != 0 || source.events != 1 {
		t.Fatalf("retained watch/release or wrong event count: %d %d %d", source.watches, len(source.release), source.events)
	}
}

func TestLifecycleDiagnosticsObserveBothFinalTeardownOrders(t *testing.T) {
	for _, watchLast := range []bool{false, true} {
		name := "client-last"
		if watchLast {
			name = "watch-last"
		}
		t.Run(name, func(t *testing.T) {
			source, err := loadBenchmarkSource()
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			source.lifecycle = &output
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			client, err := source.CreateClient(resource.WithSession(ctx, &resource.Session{Connection: &types.Connection{ID: "container-bundled-events"}}))
			if err != nil {
				t.Fatal(err)
			}
			sink := &benchmarkTestSink{ready: make(chan struct{}), updates: make(chan resource.WatchUpdatePayload, 1)}
			done := make(chan error, 1)
			go func() { done <- (&benchmarkEvents{source}).Watch(ctx, client, resource.ResourceMeta{}, sink) }()
			select {
			case <-sink.ready:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			if watchLast {
				if err := source.DestroyClient(ctx, client); err != nil {
					t.Fatal(err)
				}
			}
			cancel()
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("source watch survived cancellation")
			}
			if !watchLast {
				if err := source.DestroyClient(context.Background(), client); err != nil {
					t.Fatal(err)
				}
			}
			var observed []struct{ Connections, Watches int64 }
			decoder := json.NewDecoder(&output)
			for decoder.More() {
				var entry struct {
					Lifecycle struct {
						Connections int64 `json:"activeConnections"`
						Watches     int64 `json:"activeSourceWatches"`
					} `json:"p02Lifecycle"`
				}
				if err := decoder.Decode(&entry); err != nil {
					t.Fatal(err)
				}
				observed = append(observed, struct{ Connections, Watches int64 }{entry.Lifecycle.Connections, entry.Lifecycle.Watches})
			}
			firstConnections, firstWatches := int64(1), int64(0)
			if watchLast {
				firstConnections, firstWatches = 0, 1
			}
			if len(observed) != 2 || observed[0].Connections != firstConnections || observed[0].Watches != firstWatches || observed[1].Connections != 0 || observed[1].Watches != 0 {
				t.Fatalf("unexpected actual lifecycle transitions: %+v", observed)
			}
			source.mu.Lock()
			defer source.mu.Unlock()
			if source.connections != 0 || source.watches != 0 || source.closed != 1 || len(source.release) != 0 {
				t.Fatalf("provider retained lifecycle resources: connections=%d watches=%d closed=%d release=%d", source.connections, source.watches, source.closed, len(source.release))
			}
		})
	}
}
