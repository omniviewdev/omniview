package resource

import (
	"context"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"google.golang.org/protobuf/proto"
)

type legacyTestProvider struct {
	enumerate func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error)
	query     func(context.Context, resourcev2.NativeQueryRequest) (resourcev2.SourcePage, error)
}

func (p legacyTestProvider) Enumerate(ctx context.Context, q resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
	return p.enumerate(ctx, q)
}
func (p legacyTestProvider) NativeQuery(ctx context.Context, q resourcev2.NativeQueryRequest) (resourcev2.SourcePage, error) {
	return p.query(ctx, q)
}

func legacyTestRequest() resourcev2.SourceOpenRequest {
	rep := canonicalTestRepresentation()
	return resourcev2.SourceOpenRequest{SessionID: "session", Generation: "generation", Target: resourcev2.ReadTarget{Route: resourcev2.AccessRoute{Connection: "conn"}, Provider: "p", Authority: "a", Type: "t", Scope: resourcev2.QueryScope{}, Representation: rep.ID}, Binding: resourcev2.RepresentationBinding{Representation: rep}, Mode: resourcev2.SourceModeSnapshot, Acquisition: resourcev2.SourceAcquisition{Kind: resourcev2.SourceAcquisitionEnumerate}, Limits: resourcev2.SourceLimits{MaxFrameBytes: 64 << 10, MaxBatchItems: 1}}
}
func legacyTestPage() resourcev2.SourcePage {
	return resourcev2.SourcePage{Records: []resourcev2.Record{canonicalTestRecord("p", "a", "t", "one")}, Count: resourcev2.Count{Kind: "unknown"}, Coverage: resourcev2.Coverage{Kind: "complete", Paths: []string{}}, Consistency: resourcev2.ConsistencyPointInTime}
}
func legacyTestOpen(t *testing.T, provider any, request resourcev2.SourceOpenRequest) resourcev2.SourceStream {
	t.Helper()
	s, err := newLegacySourceOpener(provider, canonicalTestCatalog("p", "t").Types[0]).OpenSourceStream(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}
func legacyTestRecv(t *testing.T, s resourcev2.SourceStream) resourcev2.SourceFrame {
	t.Helper()
	f, err := s.Recv()
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestLegacySourcePagesCoverageAndBounds(t *testing.T) {
	r := legacyTestRequest()
	next, revision := "next", "revision"
	calls := 0
	p := legacyTestProvider{enumerate: func(_ context.Context, q resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
		calls++
		if q.PageSize != 1 || (calls == 1 && q.Cursor != nil) || (calls == 2 && (q.Cursor == nil || *q.Cursor != next)) {
			t.Errorf("bad pagination: %+v", q)
		}
		page := legacyTestPage()
		page.SourceRevision = &revision
		if calls == 1 {
			page.NextCursor = &next
		} else {
			page.Coverage = resourcev2.Coverage{Kind: "partial", Paths: []string{"/spec"}, Reason: "limited"}
			page.Records[0].Coverage = page.Coverage
		}
		return page, nil
	}}
	s := legacyTestOpen(t, p, r)
	for i := uint64(1); i <= 4; i++ {
		f := legacyTestRecv(t, s)
		if f.Sequence != i || f.SessionID != r.SessionID || f.Generation != r.Generation {
			t.Fatalf("bad frame: %+v", f)
		}
		wire, err := resourcev2.ToProtoSourceFrame(f)
		if err != nil || proto.Size(wire) > int(r.Limits.MaxFrameBytes) {
			t.Fatalf("invalid frame: %v", err)
		}
		encoded, err := proto.Marshal(wire)
		if err != nil {
			t.Fatal(err)
		}
		if err := resourceplugin.ValidateWire(encoded, wire.ProtoReflect().Descriptor()); err != nil {
			t.Fatalf("invalid source wire: %v", err)
		}
		if i == 1 && f.Begin == nil {
			t.Fatal("missing begin")
		}
		if i == 2 || i == 3 {
			if f.Snapshot == nil || len(f.Snapshot.Observations) != 1 {
				t.Fatalf("bad snapshot: %+v", f)
			}
			if i == 3 && !reflect.DeepEqual(f.Snapshot.Observations[0].Record.Coverage, resourcev2.Coverage{Kind: "partial", Paths: []string{"/spec"}, Reason: "limited"}) {
				t.Fatal("record coverage lost")
			}
		}
		if i == 4 && (f.SnapshotEnd == nil || f.SnapshotEnd.Coverage.Enumeration != resourcev2.EnumerationPartial || f.SnapshotEnd.Coverage.Consistency != resourcev2.ConsistencyPointInTime || f.SnapshotEnd.Continuity != resourcev2.ContinuityNotApplicable || !reflect.DeepEqual(f.SnapshotEnd.Coverage.Limitations, []string{"limited", "path:/spec"})) {
			t.Fatalf("bad coverage: %+v", f)
		}
	}
	if _, err := s.Recv(); !errors.Is(err, io.EOF) {
		t.Fatalf("expected EOF: %v", err)
	}
}

func TestLegacySourceBindingAndValidation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*resourcev2.SourcePage)
		reset  bool
	}{
		{"binding", func(p *resourcev2.SourcePage) { p.Records[0].Representation.Revision = "different" }, true},
		{"body", func(p *resourcev2.SourcePage) { p.Records[0].Body.Kind = "invalid" }, false},
		{"scope", func(p *resourcev2.SourcePage) { p.Records[0].Reference.Address.Authority = "other" }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := legacyTestProvider{enumerate: func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
				page := legacyTestPage()
				tc.change(&page)
				return page, nil
			}}
			s := legacyTestOpen(t, p, legacyTestRequest())
			legacyTestRecv(t, s)
			f, err := s.Recv()
			if tc.reset {
				if err != nil || f.Reset == nil || f.Reset.Reason != resourcev2.SourceResetBindingChanged {
					t.Fatalf("expected binding reset: %+v %v", f, err)
				}
			} else if err == nil {
				t.Fatalf("invalid record accepted: %+v", f)
			}
		})
	}
}

func TestLegacySourceQueryAndUnsupportedUpdates(t *testing.T) {
	r := legacyTestRequest()
	query := resourcev2.Value{Kind: "string", String: "select"}
	r.Acquisition = resourcev2.SourceAcquisition{Kind: resourcev2.SourceAcquisitionNativeQuery, Language: "sql", Query: &query}
	p := legacyTestProvider{query: func(_ context.Context, q resourcev2.NativeQueryRequest) (resourcev2.SourcePage, error) {
		if q.Language != "sql" || !reflect.DeepEqual(q.Query, query) {
			t.Errorf("query lost: %+v", q)
		}
		return legacyTestPage(), nil
	}}
	s := legacyTestOpen(t, p, r)
	legacyTestRecv(t, s)
	legacyTestRecv(t, s)
	legacyTestRecv(t, s)
	r.Mode = resourcev2.SourceModeSnapshotAndUpdates
	r.Acquisition = resourcev2.SourceAcquisition{Kind: resourcev2.SourceAcquisitionEnumerate}
	if _, err := newLegacySourceOpener(p, canonicalTestCatalog("p", "t").Types[0]).OpenSourceStream(context.Background(), r); resourcev2.ErrorCode(err) != "UNSUPPORTED" {
		t.Fatalf("updates: %v", err)
	}
}

func TestLegacySourceCancellationAndLimits(t *testing.T) {
	t.Run("close unblocks recv", func(t *testing.T) {
		entered := make(chan struct{})
		p := legacyTestProvider{enumerate: func(ctx context.Context, _ resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
			close(entered)
			<-ctx.Done()
			return resourcev2.SourcePage{}, ctx.Err()
		}}
		s := legacyTestOpen(t, p, legacyTestRequest())
		legacyTestRecv(t, s)
		<-entered
		done := make(chan error, 1)
		go func() { _, err := s.Recv(); done <- err }()
		s.Close()
		select {
		case err := <-done:
			if err == nil {
				t.Fatal("expected cancellation")
			}
		case <-time.After(time.Second):
			t.Fatal("Recv did not unblock")
		}
	})
	t.Run("oversized observation", func(t *testing.T) {
		r := legacyTestRequest()
		r.Limits.MaxFrameBytes = 256
		p := legacyTestProvider{enumerate: func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
			page := legacyTestPage()
			page.Records[0].Body.Map["large"] = resourcev2.Value{Kind: "string", String: strings.Repeat("x", 1024)}
			return page, nil
		}}
		s := legacyTestOpen(t, p, r)
		legacyTestRecv(t, s)
		if _, err := s.Recv(); resourcev2.ErrorCode(err) != "RESOURCE_LIMIT" {
			t.Fatalf("expected limit: %v", err)
		}
	})
	t.Run("repeated cursor", func(t *testing.T) {
		cursor := "same"
		p := legacyTestProvider{enumerate: func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
			page := legacyTestPage()
			page.Records = nil
			page.NextCursor = &cursor
			return page, nil
		}}
		s := legacyTestOpen(t, p, legacyTestRequest())
		legacyTestRecv(t, s)
		if _, err := s.Recv(); resourcev2.ErrorCode(err) != "PROVIDER_ERROR" {
			t.Fatalf("expected cursor error: %v", err)
		}
	})
}

func TestLegacySourceCursorByteLimit(t *testing.T) {
	for _, tc := range []struct {
		name string
		last string
		code string
	}{
		{name: "distinct cursors exhaust budget", last: "new", code: "RESOURCE_LIMIT"},
		{name: "duplicate at budget remains provider error", last: "duplicate", code: "PROVIDER_ERROR"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := legacyTestRequest()
			first := strings.Repeat("a", int(r.Limits.MaxFrameBytes)/2)
			second := strings.Repeat("b", int(r.Limits.MaxFrameBytes)-len(first))
			calls := 0
			p := legacyTestProvider{enumerate: func(_ context.Context, q resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
				calls++
				page := legacyTestPage()
				page.Records = nil
				switch calls {
				case 1:
					page.NextCursor = &first
				case 2:
					if q.Cursor == nil || *q.Cursor != first {
						return resourcev2.SourcePage{}, errors.New("first cursor not forwarded")
					}
					page.NextCursor = &second
				default:
					if q.Cursor == nil || *q.Cursor != second {
						return resourcev2.SourcePage{}, errors.New("second cursor not forwarded")
					}
					next := "new"
					if tc.last == "duplicate" {
						next = first
					}
					page.NextCursor = &next
				}
				return page, nil
			}}
			s := legacyTestOpen(t, p, r)
			legacyTestRecv(t, s)
			if _, err := s.Recv(); resourcev2.ErrorCode(err) != tc.code {
				t.Fatalf("expected %s: %v", tc.code, err)
			}
			if calls != 3 {
				t.Fatalf("expected three pages, got %d", calls)
			}
		})
	}
}

func TestLegacySourceFrameHeaderCountsTowardLimit(t *testing.T) {
	r := legacyTestRequest()
	page := legacyTestPage()
	observation := resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(page.Records[0])}
	size, err := resourcev2.SourceObservationWireSize(observation)
	if err != nil {
		t.Fatal(err)
	}
	if size < resourcev2.MinSourceFrameBytes || size > resourcev2.MaxSourceFrameBytes {
		t.Fatalf("invalid test limit: %d", size)
	}
	r.Limits.MaxFrameBytes = uint32(size)
	if err := resourcev2.ValidateSourceOpenRequest(r); err != nil {
		t.Fatalf("invalid negotiated limits: %v", err)
	}
	begin, err := resourcev2.ToProtoSourceFrame(resourcev2.SourceFrame{SessionID: r.SessionID, Generation: r.Generation, Sequence: 1, Begin: &resourcev2.SourceBegin{Mode: r.Mode}})
	if err != nil || proto.Size(begin) > size {
		t.Fatalf("begin exceeds test limit: %v", err)
	}
	p := legacyTestProvider{enumerate: func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) { return page, nil }}
	s := legacyTestOpen(t, p, r)
	legacyTestRecv(t, s)
	if _, err := s.Recv(); resourcev2.ErrorCode(err) != "RESOURCE_LIMIT" {
		t.Fatalf("frame headers did not count: %v", err)
	}
}

func TestLegacySourcePaginationConsistency(t *testing.T) {
	for _, tc := range []struct {
		name          string
		first, second *string
		consistency   string
		want          string
	}{
		{name: "missing revisions", consistency: resourcev2.ConsistencyPointInTime, want: resourcev2.ConsistencyBestEffort},
		{name: "different revisions", first: new("a"), second: new("b"), consistency: resourcev2.ConsistencyPointInTime, want: resourcev2.ConsistencyBestEffort},
		{name: "best effort page", first: new("a"), second: new("a"), consistency: resourcev2.ConsistencyBestEffort, want: resourcev2.ConsistencyBestEffort},
	} {
		t.Run(tc.name, func(t *testing.T) {
			next := "next"
			p := legacyTestProvider{enumerate: func(_ context.Context, q resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
				page := legacyTestPage()
				page.Records = nil
				page.Consistency = tc.consistency
				if q.Cursor == nil {
					page.NextCursor = &next
					page.SourceRevision = tc.first
				} else {
					page.SourceRevision = tc.second
				}
				return page, nil
			}}
			s := legacyTestOpen(t, p, legacyTestRequest())
			legacyTestRecv(t, s)
			end := legacyTestRecv(t, s)
			if end.SnapshotEnd == nil || end.SnapshotEnd.Coverage.Consistency != tc.want {
				t.Fatalf("bad consistency: %+v", end)
			}
		})
	}
}

func TestLegacySourcePagePreflightBeforeValidation(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*resourcev2.SourcePage)
	}{
		{"schema", func(p *resourcev2.SourcePage) {
			p.Records[0].Representation.Schema.Document = []byte(strings.Repeat("x", maxSourceTransientBytes/512+1))
		}},
		{"cursor", func(p *resourcev2.SourcePage) {
			cursor := strings.Repeat("x", maxSourceTransientBytes/32+1)
			p.NextCursor = &cursor
		}},
		{"aggregate records", func(p *resourcev2.SourcePage) {
			record := p.Records[0]
			record.Body.Map["large"] = resourcev2.Value{Kind: "string", String: strings.Repeat("x", 1024)}
			p.Records = make([]resourcev2.Record, 9000)
			for i := range p.Records {
				p.Records[i] = record
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			page := legacyTestPage()
			tc.edit(&page)
			// Invalid count and binding make validation or comparison win if
			// page preflight does not run first.
			page.Count.Kind = "invalid"
			p := legacyTestProvider{enumerate: func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
				return page, nil
			}}
			s := legacyTestOpen(t, p, legacyTestRequest())
			legacyTestRecv(t, s)
			if _, err := s.Recv(); resourcev2.ErrorCode(err) != "RESOURCE_LIMIT" {
				t.Fatalf("expected page limit before validation: %v", err)
			}
		})
	}
}

func TestLegacySourceOwnsPageBeforeNextCall(t *testing.T) {
	page := legacyTestPage()
	page.Records[0].Body.Map["reuse"] = resourcev2.Value{Kind: "string", String: "first"}
	cursor, revision := "next", "first-revision"
	page.NextCursor = &cursor
	page.SourceRevision = &revision
	mutated := make(chan struct{})
	p := legacyTestProvider{enumerate: func(_ context.Context, q resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
		if q.Cursor == nil {
			return page, nil
		}
		page.Records[0].Body.Map["reuse"] = resourcev2.Value{Kind: "string", String: "second"}
		revision = "second-revision"
		close(mutated)
		page.Records = nil
		page.NextCursor = nil
		return page, nil
	}}
	s := legacyTestOpen(t, p, legacyTestRequest())
	legacyTestRecv(t, s)
	first := legacyTestRecv(t, s)
	select {
	case <-mutated:
	case <-time.After(time.Second):
		t.Fatal("provider did not fetch next page")
	}
	if got := first.Snapshot.Observations[0].Record.Body.Map["reuse"].String; got != "first" {
		t.Fatalf("first frame changed after provider reused page: %q", got)
	}
	end := legacyTestRecv(t, s)
	if end.SnapshotEnd == nil || end.SnapshotEnd.Coverage.Consistency != resourcev2.ConsistencyBestEffort {
		t.Fatalf("reused revision changed first page: %+v", end)
	}
}

func TestLegacySourcePageTransientLedger(t *testing.T) {
	var ledger sourceTransientLedger
	page := legacyTestPage()
	p := legacyTestProvider{enumerate: func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
		return page, nil
	}}
	ctx := context.WithValue(context.Background(), legacySourceTransientKey{}, &ledger)
	s, err := newLegacySourceOpener(p, canonicalTestCatalog("p", "t").Types[0]).OpenSourceStream(ctx, legacyTestRequest())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	legacyTestRecv(t, s)
	ledger.mu.Lock()
	beginCost := ledger.used
	ledger.mu.Unlock()
	held := maxSourceTransientBytes - beginCost
	if beginCost == 0 || !ledger.reserve(held) {
		t.Fatal("could not reserve remaining test budget")
	}
	s.(*legacySourceStream).ackFrame()
	if _, err := s.Recv(); resourcev2.ErrorCode(err) != "RESOURCE_LIMIT" {
		t.Fatalf("expected transient budget limit: %v", err)
	}
	ledger.release(held)
}

func TestLegacySourceFrameReservationHandoff(t *testing.T) {
	var ledger sourceTransientLedger
	page := legacyTestPage()
	pageCost, err := legacyPagePreflight(page)
	if err != nil {
		t.Fatal(err)
	}
	p := legacyTestProvider{enumerate: func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
		return page, nil
	}}
	ctx := context.WithValue(context.Background(), legacySourceTransientKey{}, &ledger)
	stream, err := newLegacySourceOpener(p, canonicalTestCatalog("p", "t").Types[0]).OpenSourceStream(ctx, legacyTestRequest())
	if err != nil {
		t.Fatal(err)
	}
	s := stream.(*legacySourceStream)
	defer s.Close()
	legacyTestRecv(t, s)
	s.ackFrame()
	frame := legacyTestRecv(t, s)
	if frame.Snapshot == nil {
		t.Fatal("expected snapshot")
	}
	ledger.mu.Lock()
	held := ledger.used
	ledger.mu.Unlock()
	if held != pageCost {
		t.Fatalf("page reservation not held during handoff: got %d, want %d", held, pageCost)
	}
	s.ackFrame()
	end := legacyTestRecv(t, s)
	if end.SnapshotEnd == nil {
		t.Fatal("expected snapshot end")
	}
	s.Close()
	select {
	case <-s.results:
	case <-time.After(time.Second):
		t.Fatal("close did not unblock unacknowledged frame")
	}
	if !ledger.reserve(maxSourceTransientBytes) {
		t.Fatal("reservation leaked after close")
	}
	ledger.release(maxSourceTransientBytes)
}

func TestLegacyProducerAndReceiverHaveIndependentBoundedBudgets(t *testing.T) {
	session := &sourceSession{staging: make(map[string]sourceMember)}
	page := legacyTestPage()
	provider := legacyTestProvider{enumerate: func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
		return page, nil
	}}
	ctx := context.WithValue(context.Background(), legacySourceTransientKey{}, &session.legacyTransientLedger)
	stream, err := newLegacySourceOpener(provider, canonicalTestCatalog("p", "t").Types[0]).OpenSourceStream(ctx, legacyTestRequest())
	if err != nil {
		t.Fatal(err)
	}
	s := stream.(*legacySourceStream)
	defer s.Close()
	legacyTestRecv(t, s)
	s.ackFrame()
	frame := legacyTestRecv(t, s)
	if frame.Snapshot == nil {
		t.Fatal("expected snapshot")
	}
	session.legacyTransientLedger.mu.Lock()
	held := session.legacyTransientLedger.used
	session.legacyTransientLedger.mu.Unlock()
	if held <= 0 || !session.legacyTransientLedger.reserve(maxSourceTransientBytes-held) {
		t.Fatal("could not fill producer budget")
	}
	frameBytes, err := sourceFrameTransientEstimate(frame, maxSourceTransientBytes)
	if err != nil || !session.transientLedger.reserve(frameBytes) {
		t.Fatalf("producer pressure exhausted receiver budget: %v", err)
	}
	s.ackFrame()
	_, err = session.applyLocked(frame, sourceFrameContext{frameReserved: frameBytes})
	session.transientLedger.release(frameBytes)
	session.legacyTransientLedger.release(maxSourceTransientBytes - held)
	if err != nil || len(session.staging) != 1 {
		t.Fatalf("receiver could not stage concurrently: %v", err)
	}
}
