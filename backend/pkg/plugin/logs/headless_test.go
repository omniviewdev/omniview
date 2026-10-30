package logs

import (
	"strings"
	"testing"

	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

func TestHeadlessAggregateLimitsAndSafeErrors(t *testing.T) {
	t.Run("line limit", func(t *testing.T) {
		r := &headlessRead{done: make(chan struct{}), limit: 2}
		for range 3 {
			r.accept(sdklogs.StreamOutput{Line: &sdklogs.LogLine{Content: "actual output"}})
		}
		if len(r.result.Lines) != 2 || !r.result.Truncated || !r.ended {
			t.Fatal("line limit did not close consumption")
		}
		r.accept(sdklogs.StreamOutput{Line: &sdklogs.LogLine{Content: "late output"}})
		if len(r.result.Lines) != 2 {
			t.Fatal("accepted late output")
		}
	})
	t.Run("exact limit EOF", func(t *testing.T) {
		r := &headlessRead{done: make(chan struct{}), limit: 2}
		for range 2 {
			r.accept(sdklogs.StreamOutput{Line: &sdklogs.LogLine{Content: "actual output"}})
		}
		if r.ended || r.result.Truncated {
			t.Fatal("exact line count is not evidence of omitted output")
		}
		r.accept(sdklogs.StreamOutput{Event: &sdklogs.LogStreamEvent{Type: sdklogs.StreamEventStreamEnded}})
		if !r.ended || r.result.Truncated || len(r.result.Lines) != 2 {
			t.Fatal("exact-limit EOF reported truncation")
		}
	})
	t.Run("aggregate metadata bytes", func(t *testing.T) {
		r := &headlessRead{done: make(chan struct{}), limit: 5000}
		r.accept(sdklogs.StreamOutput{Line: &sdklogs.LogLine{Content: "small", Labels: map[string]string{"large": strings.Repeat("x", 1<<20)}}})
		if len(r.result.Lines) != 0 || !r.result.Truncated || !r.ended {
			t.Fatal("metadata escaped aggregate limit")
		}
	})
	t.Run("safe asynchronous error", func(t *testing.T) {
		r := &headlessRead{done: make(chan struct{}), limit: 200}
		r.accept(sdklogs.StreamOutput{Event: &sdklogs.LogStreamEvent{Type: sdklogs.StreamEventStreamError, Message: "secret token=private"}})
		if r.err == nil || strings.Contains(r.err.Error(), "private") || !r.ended {
			t.Fatal("unsafe source failure")
		}
	})
}
