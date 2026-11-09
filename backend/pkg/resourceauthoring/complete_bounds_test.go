package resourceauthoring

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
)

func wideSchema(properties int, description string) string {
	var out strings.Builder
	out.WriteString(`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{`)
	for i := range properties {
		if i > 0 {
			out.WriteString(",")
		}
		fmt.Fprintf(&out, `"p%03d":{"type":"string","description":%q}`, i, description)
	}
	out.WriteString(`}}`)
	return out.String()
}

// A popup never receives the schema: at most the item ceiling, and a truncated
// answer says so instead of claiming the absence of the rest.
func TestSuggestionBoundsAndTruncation(t *testing.T) {
	wide := newFixture(t, "wide", draft2020, wideSchema(600, "a field"))

	all := wide.completeAt("resource." + cursorMark)
	assert.Len(t, all.Items, 128, "the default ceiling")
	assert.Equal(t, 128, all.MaxSuggestions)
	assert.Equal(t, Completeness{Kind: CompletionTruncated, Reason: TruncatedItems}, all.Completion)

	few := wide.completeAt("resource."+cursorMark, withMax(10))
	assert.Len(t, few.Items, 10)
	assert.Equal(t, 10, few.MaxSuggestions)
	assert.Equal(t, TruncatedItems, few.Completion.Reason)
	assert.Equal(t, labels(all.Items)[:10], labels(few.Items), "the same order, cut")

	clamped := wide.completeAt("resource."+cursorMark, withMax(100000))
	assert.Equal(t, 128, clamped.MaxSuggestions, "a request cannot raise the ceiling; the effective bound is reported")
	assert.Len(t, clamped.Items, 128)

	lowered := wide.completeAt("resource."+cursorMark, withPolicy(func(p *Policy) { p.MaxSuggestions = 5 }))
	assert.Len(t, lowered.Items, 5, "the host can lower the ceiling")

	// The catalog lists at most its navigation limit per node: a listing cut short
	// is reported even when the prefix would have matched, never silently complete.
	prefixed := wide.completeAt("resource.p00" + cursorMark)
	assert.Len(t, prefixed.Items, 10)
	assert.Equal(t, TruncatedItems, prefixed.Completion.Reason, "the catalog's field listing was truncated")
	beyond := wide.completeAt("resource.p599" + cursorMark)
	assert.Empty(t, beyond.Items)
	assert.Equal(t, CompletionTruncated, beyond.Completion.Kind, "an empty truncated answer is not an assertion that the field does not exist")

	// A schema within the listing limit completes fully for any prefix.
	narrow := newFixture(t, "narrow", draft2020, wideSchema(100, "a field"))
	complete := narrow.completeAt("resource.p0" + cursorMark)
	assert.Len(t, complete.Items, 100)
	assert.Equal(t, CompletionComplete, complete.Completion.Kind)
}

func TestResponseByteBudget(t *testing.T) {
	heavy := newFixture(t, "heavy", draft2020, wideSchema(128, strings.Repeat("documentation ", 80)))
	response := heavy.completeAt("resource." + cursorMark)
	encoded, err := json.Marshal(response)
	require.NoError(t, err)
	assert.LessOrEqual(t, len(encoded), DefaultPolicy().MaxResponseBytes)
	assert.Less(t, len(response.Items), 128, "the byte budget cut the list before the item ceiling")
	assert.Equal(t, Completeness{Kind: CompletionTruncated, Reason: TruncatedBytes}, response.Completion)
	for _, item := range response.Items {
		assert.LessOrEqual(t, len(item.Documentation), DefaultPolicy().MaxDocumentationBytes)
		assert.True(t, utf8.ValidString(item.Documentation))
	}
	last := response.Items[len(response.Items)-1].Documentation
	assert.True(t, strings.HasSuffix(last, "…"), "a cut description is marked")

	smaller := heavy.completeAt("resource."+cursorMark, withPolicy(func(p *Policy) { p.MaxResponseBytes = 8192 }))
	encoded, err = json.Marshal(smaller)
	require.NoError(t, err)
	assert.LessOrEqual(t, len(encoded), 8192)
	assert.Less(t, len(smaller.Items), len(response.Items))

	// Multi-byte text is cut on a scalar boundary.
	unicode := newFixture(t, "unicode", draft2020, wideSchema(4, strings.Repeat("雪", 400)))
	for _, item := range unicode.completeAt("resource." + cursorMark).Items {
		assert.True(t, utf8.ValidString(item.Documentation), item.Label)
		assert.LessOrEqual(t, len(item.Documentation), 512)
	}
}

const recursiveSchema = `{"$schema":"https://json-schema.org/draft/2020-12/schema","$ref":"#/$defs/n","$defs":{"n":{"type":"object","properties":{"a":{"$ref":"#/$defs/n"},"b":{"$ref":"#/$defs/n"},"leaf":{"type":"string"}}}}}`

func TestTraversalBounds(t *testing.T) {
	f := newFixture(t, "recursive", draft2020, recursiveSchema)

	// A recursive schema is walked lazily, never expanded: a path of ten tiers is cheap.
	near := f.completeAt("resource." + strings.Repeat("a.", 10) + cursorMark)
	assert.Equal(t, []string{"a", "b", "leaf"}, labels(near.Items))
	assert.Equal(t, CompletionComplete, near.Completion.Kind)

	// A path deeper than the policy depth stops, and says why.
	deep := f.completeAt("resource." + strings.Repeat("a.", 40) + cursorMark)
	assert.Empty(t, deep.Items)
	assert.Equal(t, Completeness{Kind: CompletionTruncated, Reason: TruncatedTraversal}, deep.Completion)
	shallow := f.completeAt("resource."+strings.Repeat("a.", 5)+cursorMark, withPolicy(func(p *Policy) { p.MaxPathDepth = 3 }))
	assert.Equal(t, TruncatedTraversal, shallow.Completion.Reason, "the host can lower the depth")

	// The catalog's own navigation budget carries through as a traversal truncation.
	source, cursor := split(t, "resource."+cursorMark)
	in := f.input(source, cursor)
	in.Navigation.MaxNavigationVisits = 1
	response, err := Complete(t.Context(), in)
	require.NoError(t, err)
	assert.Equal(t, CompletionTruncated, response.Completion.Kind)
	assert.Equal(t, TruncatedTraversal, response.Completion.Reason)
}

func TestRequestAdmission(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)
	valid := func() Input { return f.input("resource.", 9) }
	cases := []struct {
		name   string
		mutate func(*Input)
		code   string
	}{
		{"version", func(in *Input) { in.Request.Version = "omniview.authoring.v0" }, "UNSUPPORTED"},
		{"profile", func(in *Input) { in.Request.Profile = "other" }, "UNSUPPORTED"},
		{"empty request id", func(in *Input) { in.Request.RequestID = "" }, "INVALID_REQUEST"},
		{"control character in request id", func(in *Input) { in.Request.RequestID = "a\x01b" }, "INVALID_REQUEST"},
		{"long document id", func(in *Input) { in.Request.DocumentID = strings.Repeat("d", 257) }, "RESOURCE_LIMIT"},
		{"revision beyond a JavaScript integer", func(in *Input) { in.Request.DocumentRevision = 1 << 53 }, "INVALID_REQUEST"},
		{"source over the byte limit", func(in *Input) { in.Request.Source = strings.Repeat("a", 16385); in.Request.Cursor.Offset = 0 }, "RESOURCE_LIMIT"},
		{"invalid UTF-8", func(in *Input) { in.Request.Source = "res\xff"; in.Request.Cursor.Offset = 0 }, "INVALID_REQUEST"},
		{"cursor unit", func(in *Input) { in.Request.Cursor.Unit = "utf16" }, "INVALID_REQUEST"},
		{"cursor past the end", func(in *Input) { in.Request.Cursor.Offset = 10 }, "INVALID_REQUEST"},
		{"negative cursor", func(in *Input) { in.Request.Cursor.Offset = -1 }, "INVALID_REQUEST"},
		{"non-positive maximum", func(in *Input) { in.Request.MaxSuggestions = 0 }, "INVALID_REQUEST"},
		{"declaration shadows resource", func(in *Input) { in.Request.Declarations = map[string]query.BindingType{"resource": {Kind: "string"}} }, "INVALID_REQUEST"},
		{"declaration with a bad name", func(in *Input) { in.Request.Declarations = map[string]query.BindingType{"1x": {Kind: "string"}} }, "INVALID_REQUEST"},
		{"declaration with a reserved name", func(in *Input) { in.Request.Declarations = map[string]query.BindingType{"in": {Kind: "string"}} }, "INVALID_REQUEST"},
		{"declaration with a malformed type", func(in *Input) { in.Request.Declarations = map[string]query.BindingType{"x": {Kind: "list"}} }, "INVALID_REQUEST"},
		{"too many declarations", func(in *Input) {
			in.Request.Declarations = map[string]query.BindingType{}
			for i := range 129 {
				in.Request.Declarations[fmt.Sprintf("p%d", i)] = query.BindingType{Kind: "string"}
			}
		}, "RESOURCE_LIMIT"},
		{"no route", func(in *Input) { in.Request.Target.Route.Connection = "" }, "INVALID_REQUEST"},
		{"no type", func(in *Input) { in.Request.Target.Type = "" }, "INVALID_REQUEST"},
		{"long expectation", func(in *Input) { in.Request.SchemaRevision = strings.Repeat("r", 513) }, "RESOURCE_LIMIT"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := valid()
			tc.mutate(&in)
			_, err := Complete(t.Context(), in)
			require.Error(t, err)
			assert.Equal(t, tc.code, resourcev2.ErrorCode(err))
		})
	}
	_, err := Complete(t.Context(), valid())
	require.NoError(t, err)

	in := valid()
	in.Policy.MaxSuggestions = 0
	_, err = Complete(t.Context(), in)
	assert.Equal(t, "INTERNAL", resourcev2.ErrorCode(err), "an invalid host policy is never silently defaulted")
}

func TestStrictRequestDecoding(t *testing.T) {
	const base = `{"version":"omniview.authoring.v1","requestId":"r","documentId":"d","documentRevision":1,"source":"resource.","cursor":{"offset":9,"unit":"utf8-byte"},"profile":"omniview.resource-predicate.v1","target":{"route":{"connection":"c"},"type":"t","scope":[]},"maxSuggestions":8`
	var ok CompletionRequest
	require.NoError(t, json.Unmarshal([]byte(base+`}`), &ok))
	assert.Equal(t, uint64(1), ok.DocumentRevision)
	assert.Equal(t, 9, ok.Cursor.Offset)

	for name, payload := range map[string]string{
		"unknown member":           base + `,"extra":1}`,
		"unknown nested member":    strings.Replace(base, `"unit":"utf8-byte"`, `"unit":"utf8-byte","x":1`, 1) + `}`,
		"duplicate member":         base + `,"source":"other"}`,
		"trailing data":            base + `} {}`,
		"unpaired surrogate":       strings.Replace(base, `"source":"resource."`, `"source":"\ud83d"`, 1) + `}`,
		"wrong type":               strings.Replace(base, `"maxSuggestions":8`, `"maxSuggestions":"8"`, 1) + `}`,
		"negative revision":        strings.Replace(base, `"documentRevision":1`, `"documentRevision":-1`, 1) + `}`,
		"declaration unknown kind": base + `,"declarations":{"x":{"kind":"string","bogus":true}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			var request CompletionRequest
			err := json.Unmarshal([]byte(payload), &request)
			require.Error(t, err)
		})
	}
	var withDeclarations CompletionRequest
	require.NoError(t, json.Unmarshal([]byte(base+`,"declarations":{"names":{"kind":"list","element":{"kind":"string"}}}}`), &withDeclarations))
	assert.Equal(t, "list", withDeclarations.Declarations["names"].Kind)
	assert.Equal(t, "string", withDeclarations.Declarations["names"].Element.Kind)
}

func TestCancellationAndDeadline(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := Complete(cancelled, f.input("resource.", 9))
	assert.ErrorIs(t, err, context.Canceled, "a cancelled request returns no suggestions")
	expired, stop := context.WithDeadline(t.Context(), time.Now().Add(-time.Second))
	defer stop()
	_, err = Complete(expired, f.input("resource.", 9))
	assert.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestResponseEchoesRequestIdentity(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)
	source, cursor := split(t, "resource.re"+cursorMark)
	in := f.input(source, cursor)
	in.Request.RequestID, in.Request.DocumentID, in.Request.DocumentRevision = "req-42", "doc-7", 42
	response, err := Complete(t.Context(), in)
	require.NoError(t, err)
	assert.Equal(t, "req-42", response.RequestID)
	assert.Equal(t, "doc-7", response.DocumentID)
	assert.Equal(t, uint64(42), response.DocumentRevision)
	assert.Equal(t, Cursor{Offset: cursor, Unit: UnitUTF8Byte}, response.Cursor)
	assert.Equal(t, f.identity, response.Identity)
	assert.Equal(t, f.summary, response.Schema)
	assert.Equal(t, Version, response.Version)
	// Deterministic: the same request against the same schema is byte-identical.
	again, err := Complete(t.Context(), in)
	require.NoError(t, err)
	first, _ := json.Marshal(response)
	second, _ := json.Marshal(again)
	assert.JSONEq(t, string(first), string(second))
}

// fuzzCorpus mixes valid, incomplete and hostile drafts.
var fuzzCorpus = []string{
	``, `resource`, `resource.`, `resource.re`, `resource["`, `resource['x`, `resource.tags[0].`, `resource.tags.exists(t, t.`,
	`resource.tags.exists(t, t.key == "a" && t.`, `has(resource.`, `!resource.`, `((((resource.`, `))))`, `resource.a.b.c.d.e.f.g.h.i.j.`,
	`resource.region == "`, `resource.region == 'x`, `resource.region == "x" && resource.`, `resource.region in ["a", `,
	`resource.region =`, `resource.region !`, `resource.region <`, `resource.region &`, `resource.region |`, `resource.region == `,
	`resource.sizeBytes > 1 || resource.sizeBytes < `, `"""triple`, `r"raw\`, `b"bytes"`, `// comment`, `resource.region // c`,
	"resource.\u96ea.\U0001F600.e\u0301.", "resource[\"\u96ea\U0001F600\"].", "\t\r\n ", `@#$%^&*`, `resource.tags[0][1][2].`,
	`1 == resource.`, `"a" == resource.`, `resource.region.startsWith("`, `resource.region.size() > resource.`,
	`resource.tags.filter(t, t.key == "a")[0].`, `resource.tags.map(t, t.key).`, `spec.`, `spec.con`, `s`, `[`, `]`, `.`, `..`, `...`,
	`resource.tags.exists(t, resource.tags.exists(u, u.key == t.`, `resource.tags.exists(t, `, `resource.tags.exists(`, `exists(t, t.`,
}

func TestEveryCursorOfEveryDraftCompletes(t *testing.T) {
	fixtures := []*fixture{
		newFixture(t, "compute/instance", draft2020, cloudFlatSchema),
		newFixture(t, "nested", draft2020, cloudNestedSchema),
		newFixture(t, "vm", draft2020, vmHardwareSchema),
		kubernetesFixture(t, "api__v1.json.gz", "io.k8s.api.core.v1.Pod"),
		newFixtureFrom(t, "absent", binding{state: "absent"}),
	}
	completions := 0
	for _, f := range fixtures {
		for _, source := range fuzzCorpus {
			for cursor := 0; cursor <= len(source); cursor++ {
				if ValidateOffset(source, cursor) != nil {
					continue
				}
				response, err := Complete(t.Context(), f.input(source, cursor))
				require.NoError(t, err, "%q at %d", source, cursor)
				checkResponseInvariants(t, source, response)
				completions++
			}
		}
	}
	t.Logf("%d completions across %d fixtures and %d drafts", completions, len(fixtures), len(fuzzCorpus))
}

// FuzzComplete runs the seed corpus under go test and any input under -fuzz: no
// source or cursor may panic, error unexpectedly or yield an invalid edit.
func FuzzComplete(f *testing.F) {
	for _, seed := range fuzzCorpus {
		f.Add(seed, len(seed)/2)
		f.Add(seed, len(seed))
	}
	shared := &fixture{}
	var once bool
	f.Fuzz(func(t *testing.T, source string, cursor int) {
		if !once {
			*shared = *newFixture(t, "nested", draft2020, cloudNestedSchema)
			once = true
		}
		if !utf8.ValidString(source) || len(source) > DefaultPolicy().MaxSourceBytes || ValidateOffset(source, cursor) != nil {
			return
		}
		shared.t = t
		response, err := Complete(t.Context(), shared.input(source, cursor))
		require.NoError(t, err)
		checkResponseInvariants(t, source, response)
	})
}
