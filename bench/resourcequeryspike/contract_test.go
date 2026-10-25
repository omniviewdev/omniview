package main

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func corpusForTest(t *testing.T) Corpus {
	t.Helper()
	b, err := os.ReadFile("corpus.json")
	if err != nil {
		t.Fatal("export merged P44 corpus first:", err)
	}
	var c Corpus
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func requestFor(scenario, source string) Request {
	return Request{Version: probeVersion, Scenario: scenario, Source: source, Scope: map[string]Constraint{}, Declarations: map[string]BindingType{}, Bindings: map[string]Value{}, PageSize: 128}
}

func cloudRequest(source string) Request {
	r := requestFor("cloud-bundled-pages", source)
	r.Scope = map[string]Constraint{"account": {Kind: "any"}, "region": {Kind: "any"}}
	return r
}

func TestNativeNonnumericScopeAndCorrelation(t *testing.T) {
	c := corpusForTest(t)
	cases := []struct {
		name    string
		request Request
		want    []string
	}{
		{"same-element-not-cross-element", cloudRequest(`resource.tags.exists(t, t.key == "env" && t.value == "prod")`), []string{"cloud-arn"}},
		{"quantifier", cloudRequest(`resource.tags.all(t, t.key != "blocked")`), []string{"cloud-arn", "cloud-ocid"}},
		{"present-null-not-missing", cloudRequest(`has(resource.description) && resource.description == null`), []string{"cloud-arn"}},
		{"known-absent-not-null", cloudRequest(`!has(resource.description)`), []string{"cloud-ocid"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Execute(context.Background(), tc.request, c)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got.Names, tc.want) {
				t.Fatalf("got %v want %v", got.Names, tc.want)
			}
		})
	}
	r := cloudRequest("true")
	r.Scope["region"] = Constraint{Kind: "oneOf", Values: []string{}}
	got, err := Execute(context.Background(), r, c)
	if err != nil || len(got.Names) != 0 {
		t.Fatalf("empty oneOf widened: %+v %v", got, err)
	}
	r.Scope = map[string]Constraint{"account": {Kind: "any"}}
	if _, err := Execute(context.Background(), r, c); code(err) != "INVALID_REQUEST" {
		t.Fatalf("unresolved scope: %v", err)
	}
}

func TestQuotedBindingInjectionAndAbsentSchema(t *testing.T) {
	c := corpusForTest(t)
	r := requestFor("container-absent-snapshot", `("quoted.key/雪" in resource.labels) && resource.labels["quoted.key/雪"] == needle`)
	r.Scope["engine"] = Constraint{Kind: "any"}
	r.Declarations["needle"] = BindingType{Kind: "string"}
	r.Bindings["needle"] = value("string", `x' || true || '`)
	got, err := Execute(context.Background(), r, c)
	if err != nil || !reflect.DeepEqual(got.Names, []string{"container-a"}) {
		t.Fatalf("injection changed predicate: %+v %v", got, err)
	}
	r.Bindings["needle"] = value("string", `" || true || "`)
	got, err = Execute(context.Background(), r, c)
	if err != nil || len(got.Names) != 0 {
		t.Fatalf("nonmatching injection escaped: %+v %v", got, err)
	}
	vm := requestFor("hypervisor-absent-vms", `resource.name == "db"`)
	vm.Scope["node"] = Constraint{Kind: "oneOf", Values: []string{"node/a::1"}}
	got, err = Execute(context.Background(), vm, c)
	if err != nil || !reflect.DeepEqual(got.Names, []string{"vm-a"}) {
		t.Fatalf("node-local scope: %+v %v", got, err)
	}
}

func TestCanonicalAddressIndependentOracles(t *testing.T) {
	c := corpusForTest(t)
	byName := map[string]Record{}
	for _, r := range c.Records {
		byName[r.Name] = r
	}
	for _, tc := range c.IdentityCases {
		a, err := AddressKey(byName[tc.Left])
		if err != nil {
			t.Fatal(err)
		}
		b, err := AddressKey(byName[tc.Right])
		if err != nil {
			t.Fatal(err)
		}
		if (a == b) != tc.Equal {
			t.Fatalf("%s: equality %v want %v", tc.Name, a == b, tc.Equal)
		}
	}
	r := Record{Provider: "cloud", Authority: "a", Type: "compute/instance", Scope: map[string]string{"region": "/雪", "account": "<>&"}, ID: "a::b/%2F"}
	got, err := AddressKey(r)
	want := `["omniview.address.v1","cloud","a","compute/instance",[["account","<>&"],["region","/雪"]],"a::b/%2F"]`
	if err != nil || got != want {
		t.Fatalf("key %s %v", got, err)
	}
}

func TestTypedAdmissionAndExactTransport(t *testing.T) {
	c := corpusForTest(t)
	r := cloudRequest(`resource.sizeBytes == exact && when == timestamp("2026-10-17T12:00:00.123456789Z")`)
	r.Declarations["exact"] = BindingType{Kind: "int64"}
	r.Bindings["exact"] = value("int64", "9007199254740993")
	r.Declarations["when"] = BindingType{Kind: "timestamp"}
	r.Bindings["when"] = value("timestamp", "2026-10-17T14:00:00.123456789+02:00")
	got, err := Execute(context.Background(), r, c)
	if err != nil || !reflect.DeepEqual(got.Names, []string{"cloud-arn"}) {
		t.Fatalf("exact boundary: %+v %v", got, err)
	}
	if string(got.Bindings["when"].Value) != `"2026-10-17T12:00:00.123456789Z"` {
		t.Fatal("timestamp normalization lost nanoseconds")
	}
	bad := []Value{value("int64", "-0"), value("int64", "9223372036854775808"), value("int64", " 1"), value("int64", "1e3")}
	for _, v := range bad {
		r.Bindings["exact"] = v
		if _, err := Execute(context.Background(), r, c); code(err) != "INVALID_REQUEST" {
			t.Fatalf("accepted malformed int %s: %v", v.Value, err)
		}
	}
	r = cloudRequest("true")
	r.Declarations["when"] = BindingType{Kind: "timestamp"}
	r.Bindings["when"] = value("timestamp", "2026-10-17T12:00:00.1234567891Z")
	if _, err := Execute(context.Background(), r, c); code(err) != "INVALID_REQUEST" {
		t.Fatalf("truncated timestamp: %v", err)
	}
}

func TestStrictWireRejectsAmbiguityAndLimits(t *testing.T) {
	for _, raw := range []string{`{"version":"a","version":"b"}`, `{"version":"a","bindings":{"p":{"kind":"string","value":"x","value":"y"}}}`, `{"unknown":true}`, `{} {}`} {
		if _, err := DecodeRequest([]byte(raw)); code(err) != "INVALID_REQUEST" {
			t.Fatalf("accepted %s: %v", raw, err)
		}
	}
	if _, err := DecodeRequest([]byte(strings.Repeat(" ", maxRequestBytes+1))); code(err) != "RESOURCE_LIMIT" {
		t.Fatalf("unbounded request: %v", err)
	}
	c := corpusForTest(t)
	r := cloudRequest(`resource.description == "x"`)
	if _, err := Execute(context.Background(), r, c); code(err) != "INVALID_REQUEST" {
		t.Fatalf("missing field became false: %v", err)
	}
	r = cloudRequest("resource")
	if _, err := Execute(context.Background(), r, c); code(err) != "INVALID_REQUEST" {
		t.Fatalf("nonboolean accepted: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Execute(ctx, cloudRequest("true"), c); code(err) != "CANCELLED" {
		t.Fatalf("scalar bypassed cancellation: %v", err)
	}
	r = cloudRequest("true")
	r.Mode = "follow"
	if _, err := Execute(context.Background(), r, c); code(err) != "UNSUPPORTED" {
		t.Fatalf("fake follow: %v", err)
	}
	r = cloudRequest(`resource.tags.exists(t, t.key == "env")`)
	r.CostLimit = 1
	if _, err := Execute(context.Background(), r, c); code(err) != "RESOURCE_LIMIT" {
		t.Fatalf("cost control not admitted: %v", err)
	}
}

func TestBuilderNegationMissingNullAndResidualWindow(t *testing.T) {
	c := corpusForTest(t)
	clause := Clause{Kind: "equal", Path: []string{"description"}, Parameter: "needle"}
	for _, tc := range []struct {
		kind string
		want []string
	}{{"equal", []string{}}, {"not", []string{"cloud-arn", "cloud-ocid"}}, {"notEqualPresent", []string{}}} {
		r := cloudRequest("")
		clause.Kind = tc.kind
		r.Builder = &clause
		r.Declarations["needle"] = BindingType{Kind: "string"}
		r.Bindings["needle"] = value("string", "prod")
		got, err := Execute(context.Background(), r, c)
		if err != nil || !reflect.DeepEqual(got.Names, tc.want) {
			t.Fatalf("%s: %+v %v", tc.kind, got, err)
		}
	}
	// Expected residual member is the second native source page. Limiting candidates
	// to the first native page before applying the residual loses the required row.
	r := cloudRequest(`resource.tags.exists(t, t.key == "env" && t.value == "dev")`)
	r.PageSize = 1
	full, err := Execute(context.Background(), r, c)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(full.Names, []string{"cloud-ocid"}) {
		t.Fatal(full.Names)
	}
	r.Candidates = []string{"cloud-ocid", "cloud-arn"}
	safe, err := Execute(context.Background(), r, c)
	if err != nil || !reflect.DeepEqual(safe.Names, full.Names) {
		t.Fatalf("safe residual: %+v %v", safe, err)
	}
	r.Candidates = []string{"cloud-arn"}
	unsafe, err := Execute(context.Background(), r, c)
	if err != nil || len(unsafe.Names) != 0 {
		t.Fatalf("counterexample changed: %+v %v", unsafe, err)
	}
	// Text, predicate and explicit scope are all constraints, not alternative modes.
	r = cloudRequest(`resource.tags.all(t, t.key != "blocked")`)
	r.Text = &TextClause{Fields: [][]string{{"id"}}, Term: "ocid1"}
	combined, err := Execute(context.Background(), r, c)
	if err != nil || !reflect.DeepEqual(combined.Names, []string{"cloud-ocid"}) {
		t.Fatalf("text composition: %+v %v", combined, err)
	}
}

func TestPartialDraftAndUnicodeByteUTF16Boundary(t *testing.T) {
	source := `"雪😀" == "雪😀" && resource.labels.`
	draft, err := AnalyzeDraft(source, len(source))
	if err != nil || draft.Context != "resource.labels" || draft.Start != len(source) || draft.End != len(source) || draft.Valid {
		t.Fatalf("partial context %+v %v", draft, err)
	}
	units, err := ByteToUTF16(source, len(`"雪😀"`))
	if err != nil || units != 5 {
		t.Fatalf("utf16 %d %v", units, err)
	}
	if _, err := ByteToUTF16(source, 2); code(err) != "INVALID_REQUEST" {
		t.Fatalf("split codepoint accepted: %v", err)
	}
	if _, err := AnalyzeDraft(source, len(source)+1); code(err) != "INVALID_REQUEST" {
		t.Fatalf("cursor out of range: %v", err)
	}
}
