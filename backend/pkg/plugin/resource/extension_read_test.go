package resource

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/extensionpolicy"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/extensionread"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestRelatedReadStringByteAccounting(t *testing.T) {
	for _, sample := range []struct{ value, compact string }{
		{"\b\f\n\r\t\"\\\x00\x1f", `"\b\f\n\r\t\"\\\u0000\u001f"`},
		{"�𐀀", `"�𐀀"`},
	} {
		size, valid := relatedStringBytes(sample.value)
		require.True(t, valid)
		require.Equal(t, len(sample.compact), size)
	}
	for _, malformed := range []string{"\xff", "\xef\xbf"} {
		size, valid := relatedStringBytes(malformed)
		require.False(t, valid)
		require.Zero(t, size)
	}
}

func readRef(typ, id, uid string) resourcev2.ResourceReference {
	return resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "owner", Authority: "west", Type: typ, ID: id}, Incarnation: &uid}
}

func readCandidate(label string, evidence, neighbor resourcev2.ResourceReference) extensionread.Candidate {
	return extensionread.Candidate{Row: map[string]any{"label": label}, Evidence: []resourcev2.ResourceReference{evidence}, Neighbor: &neighbor}
}

func TestExtensionReadAdmitsBothCitationsAndOverflowProof(t *testing.T) {
	source := readRef("record", "a", "first")
	target := readRef("record", "b", "second")
	denied := readRef("record", "private", "private-id")
	old := readRef("record", "b", "replaced")
	admit := func(ref resourcev2.ResourceReference) bool {
		return ref.Address.Authority == "west" && ref.Address.ID != "private" && *ref.Incarnation != "replaced"
	}
	row := map[string]string{"label": "string"}
	known := map[string]bool{"record": true}
	process := func(rows []extensionread.Candidate) ExtensionReadResult {
		return projectRelatedPage(extensionread.Page{Coverage: "complete", Sources: []string{"record"}, Rows: rows}, row, known, func() bool { return false }, admit)
	}
	result := process([]extensionread.Candidate{readCandidate("in", source, target), readCandidate("out", target, source),
		readCandidate("no evidence", denied, target), readCandidate("no neighbor", source, denied), readCandidate("wrong UID", source, old),
		{Row: map[string]any{"label": "literal"}, Evidence: []resourcev2.ResourceReference{source}}})
	require.Equal(t, "ready", result.State)
	require.Equal(t, "partial", result.Page.Coverage)
	require.Equal(t, []map[string]any{{"label": "in"}, {"label": "out"}, {"label": "literal"}}, result.Page.Rows)
	require.False(t, result.Page.Truncated)
	require.Equal(t, result, process([]extensionread.Candidate{readCandidate("in", source, target), readCandidate("out", target, source),
		{Row: map[string]any{"label": "literal"}, Evidence: []resourcev2.ResourceReference{source}}}), "hidden neighbors and absent neighbors disclose identical states")
	require.Equal(t, process(nil), process([]extensionread.Candidate{readCandidate("hidden", source, denied)}))

	rows := make([]extensionread.Candidate, 0, 130)
	for i := range 129 {
		rows = append(rows, readCandidate(strconv.Itoa(i), source, target))
	}
	result = process(rows)
	require.Len(t, result.Page.Rows, 128)
	require.True(t, result.Page.Truncated)
	rows[128] = readCandidate("hidden", denied, target)
	result = process(rows)
	require.Len(t, result.Page.Rows, 128)
	require.False(t, result.Page.Truncated, "a denied overflow citation cannot disclose even one bit")
	require.Equal(t, "partial", result.Page.Coverage)
	require.Equal(t, "failed", process(append(rows, rows[0])).State)
}

func TestExtensionReadCoverageAndRowBudget(t *testing.T) {
	ref := readRef("record", "a", "current")
	schema := map[string]string{"label": "string"}
	known := map[string]bool{"record": true, "other": true}
	admit := func(resourcev2.ResourceReference) bool { return true }
	page := extensionread.Page{Sources: []string{"record", "other"}, Coverage: "complete", Rows: []extensionread.Candidate{}}
	complete := func() bool { return true }
	result := projectRelatedPage(page, schema, known, complete, admit)
	require.Equal(t, "complete", result.Page.Coverage)
	require.NotNil(t, result.Page.Rows)
	require.False(t, result.Page.Truncated)
	page.Sources = []string{"record"}
	page.Coverage = "partial"
	require.Equal(t, "partial", projectRelatedPage(page, schema, known, complete, admit).Page.Coverage)
	page.Sources = nil
	require.Equal(t, "unavailable", projectRelatedPage(page, schema, known, complete, admit).State)
	page.Sources = []string{"record"}
	page.Rows = []extensionread.Candidate{readCandidate(strings.Repeat("𐀀", 2049), ref, ref)}
	require.Equal(t, "failed", projectRelatedPage(page, schema, known, complete, admit).State)
	page.Rows[0].Row = map[string]any{"label": "row", "extra": 1.0}
	require.Equal(t, "failed", projectRelatedPage(page, schema, known, complete, admit).State)
	page.Rows[0].Row = map[string]any{"label": map[string]any{"private": true}}
	require.Equal(t, "failed", projectRelatedPage(page, schema, known, complete, admit).State)
	page.Rows[0].Row = map[string]any{"label": "row"}
	page.Rows[0].Evidence = nil
	require.Equal(t, "failed", projectRelatedPage(page, schema, known, complete, admit).State)

	// Compact UTF-8, not UTF-16 length or Go's HTML-escaped encoding. Exactly 64 KiB, then one more authorized row.
	page.Rows = nil
	for range 15 {
		page.Rows = append(page.Rows, readCandidate(strings.Repeat("<", 4096), ref, ref))
	}
	last := 65536 - len(`{"state":"ready","rows":[],"coverage":"partial","truncated":false}`) - 15*(4096+12) - 15 - 12
	page.Rows = append(page.Rows, readCandidate(strings.Repeat("x", last), ref, ref))
	result = projectRelatedPage(page, schema, known, complete, admit)
	require.Len(t, result.Page.Rows, 16)
	require.False(t, result.Page.Truncated)
	page.Rows = append(page.Rows, readCandidate("extra", ref, ref))
	result = projectRelatedPage(page, schema, known, complete, admit)
	require.Len(t, result.Page.Rows, 16)
	require.True(t, result.Page.Truncated)
	// Exactly one byte distinguishes the compact booleans. Keep a boundary
	// row at that byte only with an independently authorized overflow witness.
	page.Rows[15].Row["label"] = strings.Repeat("x", last+1)
	result = projectRelatedPage(page, schema, known, complete, admit)
	require.Len(t, result.Page.Rows, 16)
	require.True(t, result.Page.Truncated)
	page.Rows = page.Rows[:16]
	result = projectRelatedPage(page, schema, known, complete, admit)
	require.Len(t, result.Page.Rows, 15)
	require.True(t, result.Page.Truncated)
}

func TestExtensionReadLaneAbortsLateSuccessAndFailure(t *testing.T) {
	for _, stale := range []ExtensionReadResult{{State: "ready", Page: &ExtensionReadPage{Rows: []map[string]any{{"label": "old"}}}}, {State: "failed"}} {
		synctest.Test(t, func(t *testing.T) {
			s := &ExtensionReadService{}
			key := invocation.WindowIdentity{}
			binding := extensionread.Binding{Point: "owner/tabs", Offer: "peer/detail"}
			entered := make(chan context.Context, 1)
			release := make(chan struct{})
			first := make(chan ExtensionReadResult, 1)
			go func() {
				first <- s.inLane(context.Background(), key, binding, func(ctx context.Context) ExtensionReadResult {
					entered <- ctx
					<-release // Even a provider ignoring cancellation cannot publish.
					return stale
				})
			}()
			ctx := <-entered
			second := make(chan ExtensionReadResult, 1)
			go func() {
				second <- s.inLane(context.Background(), key, binding, func(context.Context) ExtensionReadResult { return ExtensionReadResult{State: "failed"} })
			}()
			synctest.Wait()
			require.ErrorIs(t, ctx.Err(), context.Canceled)
			require.Equal(t, "unavailable", (<-first).State)
			s.invalidatePolicy(extensionpolicy.Change{})
			require.Equal(t, "unavailable", (<-second).State)
			close(release)
			synctest.Wait()
			require.Empty(t, s.windows)
		})
	}
}

func TestExtensionReadDeadlineDoesNotReleaseHungProviderToNewCalls(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s := &ExtensionReadService{}
		key := invocation.WindowIdentity{}
		binding := extensionread.Binding{Point: "owner/tabs", Offer: "peer/detail"}
		release := make(chan struct{})
		result := make(chan ExtensionReadResult, 1)
		go func() {
			result <- s.inLane(context.Background(), key, binding, func(ctx context.Context) ExtensionReadResult {
				<-release
				if !errors.Is(ctx.Err(), context.DeadlineExceeded) {
					t.Error("provider did not receive the deadline")
				}
				return ExtensionReadResult{State: "ready"}
			})
		}()
		synctest.Wait()
		time.Sleep(5 * time.Second) // virtual clock
		require.Equal(t, "failed", (<-result).State)
		called := false
		res := s.inLane(context.Background(), key, binding, func(context.Context) ExtensionReadResult { called = true; return ExtensionReadResult{} })
		require.False(t, called)
		require.NotEqual(t, "ready", res.State)
		close(release)
		synctest.Wait()
		require.Empty(t, s.windows)
	})
}
