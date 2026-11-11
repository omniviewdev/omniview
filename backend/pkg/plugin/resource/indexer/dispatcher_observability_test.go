package indexer

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

func TestDispatcherLogsRecoveredPanicWithoutValue(t *testing.T) {
	const secret = "fake-provider-token-abc123"
	sink := &logtest.RecordingSink{}
	logger := logging.New(logging.Config{Backend: logging.NewSinkBackend(sink)})
	idx := &callbackIndexer{name: "test", onAdd: func(_ registry.ResourceEntry, _ json.RawMessage) { panic(secret) }}
	d := NewDispatcher([]ResourceIndexer{idx}).WithLogger(logger)
	d.dispatch(idx, Event{Type: EventAdd})
	records := sink.Records()
	if len(records) != 1 || records[0].Level != logging.LevelError {
		t.Fatalf("expected recovered panic error, got %v", records)
	}
	fields := records[0].ToMap()
	if fields["method"] != "OnAdd" || fields["stack"] == "" {
		t.Fatalf("missing method or stack: %v", fields)
	}
	if strings.Contains(fmt.Sprint(fields), secret) {
		t.Fatal("panic value leaked in log")
	}
}
