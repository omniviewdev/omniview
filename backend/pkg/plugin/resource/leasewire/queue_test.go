package leasewire

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func meta() ResultMetadata {
	return ResultMetadata{Coverage: "complete", Limitations: []string{}, Freshness: "current", Count: ResultCount{Kind: "unknown"}}
}
func frame(g string, n int) ResultDataFrame {
	p := ResultDataPayload{Kind: "changes", Changes: []ResultChange{}, Metadata: meta()}
	if n == 1 {
		p = ResultDataPayload{Kind: "open", Rows: []ResultRow{}, Metadata: meta()}
	}
	return ResultDataFrame{Lane: "data", LeaseID: "lease", Generation: g, Sequence: fmt.Sprint(n), Payload: p}
}
func drain(t *testing.T, q *Queue, now time.Time) map[string]any {
	t.Helper()
	b, e := q.BeginDrain()
	if e != nil {
		t.Fatal(e)
	}
	var v map[string]any
	if e = json.Unmarshal(b, &v); e != nil {
		t.Fatalf("%s: %v", b, e)
	}
	q.EndDrain(now)
	return v
}
func TestOverflowAndResetBarrier(t *testing.T) {
	now := time.Unix(10, 0)
	q, _ := NewQueue("lease", "g1")
	for i := 1; i <= 64; i++ {
		signal, e := q.Publish(frame("g1", i), now)
		if e != nil {
			t.Fatal(e)
		}
		if signal != (i == 1) {
			t.Fatalf("doorbell %d=%v", i, signal)
		}
	}
	if _, e := q.Publish(frame("g1", 65), now); !errors.Is(e, ErrOverflow) {
		t.Fatal(e)
	}
	if _, e := q.Publish(frame("g1", 65), now); !errors.Is(e, ErrOverflow) {
		t.Fatal("overflow did not latch", e)
	}
	b, e := q.BeginDrain()
	if e != nil || b != nil {
		t.Fatalf("old-generation data survived overflow: %s %v", b, e)
	}
	q.EndDrain(now)
	if _, e := q.Reset("g2", "overflow", now); e != nil {
		t.Fatal(e)
	}
	if _, e := q.Reset("g3", "gap", now); !errors.Is(e, ErrControlPending) {
		t.Fatal(e)
	}
	v := drain(t, q, now)
	p := v["payload"].(map[string]any)
	if p["kind"] != "reset" || p["nextGeneration"] != "g2" {
		t.Fatal(v)
	}
	if _, e := q.Publish(frame("g1", 65), now); !errors.Is(e, ErrGeneration) {
		t.Fatal(e)
	}
	if _, e := q.Publish(frame("g2", 1), now); e != nil {
		t.Fatal(e)
	}
	v = drain(t, q, now)
	if v["sequence"] != "1" || v["generation"] != "g2" {
		t.Fatal(v)
	}
}
func TestTerminalBypassesData(t *testing.T) {
	now := time.Unix(10, 0)
	q, _ := NewQueue("lease", "g1")
	if _, e := q.Publish(frame("g1", 1), now); e != nil {
		t.Fatal(e)
	}
	if _, e := q.Terminate("accessInvalidated", nil, now); e != nil {
		t.Fatal(e)
	}
	v := drain(t, q, now)
	if v["payload"].(map[string]any)["kind"] != "close" {
		t.Fatal(v)
	}
	if _, e := q.Publish(frame("g1", 2), now); !errors.Is(e, ErrClosed) {
		t.Fatal(e)
	}
}
func TestCompleteAndDrain(t *testing.T) {
	now := time.Unix(10, 0)
	q, _ := NewQueue("lease", "g1")
	q.Publish(frame("g1", 1), now)
	q.Complete(now)
	b, e := q.BeginDrain()
	if e != nil || !strings.Contains(string(b), `"kind":"open"`) {
		t.Fatal(string(b), e)
	}
	if _, e = q.BeginDrain(); !errors.Is(e, ErrDrainPending) {
		t.Fatal(e)
	}
	if !q.EndDrain(now) {
		t.Fatal("missing doorbell")
	}
	v := drain(t, q, now)
	if v["payload"].(map[string]any)["state"] != "complete" {
		t.Fatal(v)
	}
	if _, e = q.Publish(frame("g1", 2), now); !errors.Is(e, ErrClosed) {
		t.Fatal(e)
	}
}
func TestExpiryAndOversize(t *testing.T) {
	now := time.Unix(10, 0)
	q, _ := NewQueue("lease", "g1")
	f := frame("g1", 1)
	f.Payload.Metadata.Limitations = []string{strings.Repeat("x", MaxFrameBytes)}
	if _, e := q.Publish(f, now); !errors.Is(e, ErrFrameTooLarge) {
		t.Fatal(e)
	}
	if _, e := q.Publish(frame("g1", 1), now); e != nil {
		t.Fatal(e)
	}
	if q.Expire(now.Add(InactiveTimeout - time.Nanosecond)) {
		t.Fatal("early expiry")
	}
	if !q.Expire(now.Add(InactiveTimeout)) {
		t.Fatal("missing expiry")
	}
	if _, e := q.Publish(frame("g1", 2), now); !errors.Is(e, ErrClosed) {
		t.Fatal(e)
	}
}
func TestDecimalAndEmptyArray(t *testing.T) {
	f := frame("g1", 1)
	n := "9007199254740993"
	f.Payload.Metadata.Count = ResultCount{Kind: "exact", Value: &n}
	b, e := f.encode()
	if e != nil || !strings.Contains(string(b), `"rows":[]`) || !strings.Contains(string(b), `"value":"9007199254740993"`) {
		t.Fatal(string(b), e)
	}
	n = "01"
	if _, e = f.encode(); e == nil {
		t.Fatal("accepted noncanonical integer")
	}
}

func TestByteSaturationAndDrainResponse(t *testing.T) {
	now := time.Unix(10, 0)
	q, _ := NewQueue("lease", "g1")
	for n := 1; n <= 5; n++ {
		f := frame("g1", n)
		f.Payload.Metadata.Limitations = []string{strings.Repeat("x", 220000)}
		_, err := q.Publish(f, now)
		if n < 5 && err != nil {
			t.Fatal(err)
		}
		if n == 5 && !errors.Is(err, ErrOverflow) {
			t.Fatalf("expected byte overflow, got %v", err)
		}
	}
	b, err := json.Marshal(ControlQueryLeaseResponse{Kind: "drain"})
	if err != nil || string(b) != `{"kind":"drain","event":null}` {
		t.Fatalf("empty drain: %s %v", b, err)
	}
}

func TestStrictControlRequests(t *testing.T) {
	valid := []byte(`{"leaseId":"l","control":{"kind":"recover","generation":"g"}}`)
	if _, err := DecodeControlQueryLeaseRequest(valid); err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{
		`{"leaseId":"l","leaseId":"x","control":{"kind":"attach"}}`,
		`{"leaseId":"l","control":{"kind":"attach","generation":null}}`,
		`{"leaseId":"l","control":{"kind":"recover","generation":null}}`,
		`{"leaseId":"l","control":{"kind":"drain","extra":1}}`,
		`{"leaseId":null,"control":{"kind":"attach"}}`,
	} {
		if _, err := DecodeControlQueryLeaseRequest([]byte(input)); err == nil {
			t.Fatalf("accepted %s", input)
		}
	}
}

func TestPreflightEscapesAndCycles(t *testing.T) {
	f := frame("g1", 1)
	f.Payload.Metadata.Limitations = []string{strings.Repeat("<", MaxFrameBytes/5)}
	if err := preflight(f); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("escaped JSON exceeded limit: %v", err)
	}
	type node struct {
		Next *node `json:"next"`
	}
	n := &node{}
	n.Next = n
	if err := preflight(n); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("cycle accepted: %v", err)
	}
}
