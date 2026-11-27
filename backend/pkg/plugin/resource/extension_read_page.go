package resource

import (
	"encoding/json"
	"math"
	"unicode/utf8"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/extensionread"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	maxRelatedRows        = 128
	maxRelatedBytes       = 64 << 10
	maxRelatedSources     = 8
	maxRelatedEvidence    = 4
	maxRelatedFields      = 64
	maxRelatedStringUnits = 4096

	// A BMP scalar takes at most three UTF-8 bytes per UTF-16 code unit.
	// Supplementary scalars take four bytes for two units.
	maxUTF8BytesPerUTF16Unit = 3
	relatedFieldString       = "string"
	relatedFieldNumber       = "number"
)

// Count JSON.stringify's compact UTF-8 size without making a second copy of
// potentially undisclosable data. Field names are bounded ASCII from admission.
func scalarRowBytes(row map[string]any, schema map[string]string) (int, bool) {
	if len(row) != len(schema) || len(schema) == 0 || len(schema) > maxRelatedFields {
		return 0, false
	}
	n := len(`{}`) + len(schema) - 1 // braces and commas
	for field, tag := range schema {
		size, ok := relatedScalarBytes(row[field], tag)
		if !ok {
			return 0, false
		}
		n += len(field) + len(`"":`) + size
	}
	return n, true
}

func relatedScalarBytes(value any, tag string) (int, bool) {
	switch v := value.(type) {
	case string:
		if tag != relatedFieldString {
			return 0, false
		}
		return relatedStringBytes(v)
	case float64:
		if tag != relatedFieldNumber || math.IsNaN(v) || math.IsInf(v, 0) {
			return 0, false
		}
		if v == 0 {
			return len("0"), true // JSON.stringify(-0) is "0".
		}
		b, _ := json.Marshal(v)
		return len(b), true
	default:
		return 0, false
	}
}

func relatedStringBytes(value string) (int, bool) {
	if len(value) > maxRelatedStringUnits*maxUTF8BytesPerUTF16Unit {
		return 0, false
	}
	n := len(value) + len(`""`)
	units := 0
	for len(value) != 0 {
		r, width := utf8.DecodeRuneInString(value)
		if r == utf8.RuneError && width == 1 {
			return 0, false
		}
		value = value[width:]
		units++
		switch {
		case r > '\uffff':
			units++ // UTF-16 surrogate pair.
		case r == '"' || r == '\\' || r == '\b' || r == '\t' || r == '\n' || r == '\f' || r == '\r':
			n++
		case r < ' ':
			n += len(`\u0000`) - 1
		}
	}
	if units > maxRelatedStringUnits {
		return 0, false
	}
	return n, true
}

// Preserve the operation's documented ordering. Never trust a provider's claim
// that some undisclosed (possibly denied) neighbor exists: truncation requires
// one more independently admitted candidate. An examined but unreadable family
// makes coverage partial, not truncated and not an assertion that it was empty.
func projectRelatedPage(page extensionread.Page, schema map[string]string, permitted map[string]bool, covered func() bool, admit func(resourcev2.ResourceReference) bool) ExtensionReadResult {
	if len(page.Rows) > maxRelatedRows+1 || len(page.Sources) > maxRelatedSources ||
		(page.Coverage != readCoveragePartial && page.Coverage != readCoverageComplete) {
		return failedRead()
	}
	sources, readable := relatedPageSources(page.Sources, permitted)
	if sources == nil {
		return failedRead()
	}
	if readable == 0 {
		return unavailableRead()
	}
	// An individual denial is indistinguishable from no candidate at all.
	// Only the independent scope proofs and exhausted work can limit coverage.
	var sizes [maxRelatedRows + 1]int
	rowSizes := sizes[:len(page.Rows)]
	authorized, valid := measureRelatedRows(page.Rows, schema, sources, admit, rowSizes)
	if !valid {
		return failedRead()
	}
	coverage := page.Coverage
	if len(sources) != len(permitted) || readable != len(sources) || !covered() {
		coverage = readCoveragePartial
	}
	return ExtensionReadResult{State: readStateReady, Page: boundedRelatedPage(page.Rows, rowSizes, authorized, coverage)}
}

func relatedPageSources(declarations []string, permitted map[string]bool) (map[string]bool, int) {
	sources := make(map[string]bool, len(declarations))
	readable := 0
	for _, typ := range declarations {
		granted, declared := permitted[typ]
		if _, duplicate := sources[typ]; duplicate || !declared {
			return nil, 0
		}
		sources[typ] = granted
		if granted {
			readable++
		}
	}
	return sources, readable
}

func measureRelatedRows(rows []extensionread.Candidate, schema map[string]string, sources map[string]bool, admit func(resourcev2.ResourceReference) bool, sizes []int) (int, bool) {
	authorized := 0
	for i := range rows {
		candidate := &rows[i]
		if len(candidate.Evidence) == 0 || len(candidate.Evidence) > maxRelatedEvidence {
			return 0, false
		}
		if !relatedCandidateReadable(candidate, sources, admit) {
			continue
		}
		n, valid := scalarRowBytes(candidate.Row, schema)
		if !valid {
			return 0, false
		}
		sizes[i] = n
		authorized++
	}
	return authorized, true
}

func relatedCandidateReadable(candidate *extensionread.Candidate, sources map[string]bool, admit func(resourcev2.ResourceReference) bool) bool {
	for _, ref := range candidate.Evidence {
		if !sources[ref.Address.Type] || !admit(ref) {
			return false
		}
	}
	neighbor := candidate.Neighbor
	return neighbor == nil || (sources[neighbor.Address.Type] && admit(*neighbor))
}

func boundedRelatedPage(rows []extensionread.Candidate, sizes []int, authorized int, coverage string) *ExtensionReadPage {
	out := &ExtensionReadPage{Coverage: coverage, Rows: make([]map[string]any, 0, min(authorized, maxRelatedRows)), Truncated: false}
	size := len(`{"state":"ready","rows":[],"coverage":"","truncated":false}`) + len(coverage)
	for i, n := range sizes {
		if n == 0 {
			continue
		}
		authorized--
		if len(out.Rows) != 0 {
			n++
		}
		// True is one byte shorter than false. Use that byte only when
		// another independently authorized row could prove a genuine cut.
		if n > maxRelatedBytes-size+boolInt(authorized > 0) || len(out.Rows) == maxRelatedRows {
			out.Truncated = true
			break
		}
		size += n
		out.Rows = append(out.Rows, rows[i].Row)
	}
	return out
}
