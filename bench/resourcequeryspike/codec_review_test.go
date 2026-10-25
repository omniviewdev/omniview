package main

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

func TestExactDTOMembersRejectCaseAliasesWithoutRestrictingMapKeys(t *testing.T) {
	for _, raw := range []string{
		`{"Version":"omniview.p01-spike.v1"}`,
		`{"bindings":{"p":{"kind":"string","value":"x","Value":"y"}}}`,
		`{"declarations":{"p":{"Kind":"string"}}}`,
		`{"scope":{"region":{"Kind":"any"}}}`,
		`{"draft":{"source":"true","DocumentRevision":"d"}}`,
		`{"text":{"Fields":[["id"]],"term":"x"}}`,
	} {
		if _, err := DecodeRequest([]byte(raw)); code(err) != "INVALID_REQUEST" {
			t.Fatalf("DTO alias accepted %s: %v", raw, err)
		}
	}
	r := cloudRequest(`size(p) == 3`)
	r.Declarations["p"] = BindingType{Kind: "map", Value: &BindingType{Kind: "string"}}
	r.Bindings["p"] = value("map", map[string]Value{"Value": value("string", "upper"), "value": value("string", "lower"), "雪😀": value("string", "unicode")})
	wire, _ := json.Marshal(r)
	decoded, err := DecodeRequest(wire)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Execute(context.Background(), decoded, corpusForTest(t))
	if err != nil || !reflect.DeepEqual(got.Names, []string{"cloud-arn", "cloud-ocid"}) {
		t.Fatalf("arbitrary map keys restricted: %+v %v", got, err)
	}
	// RawMessage payloads are checked as nested tagged DTOs when admitted.
	r.Bindings["p"] = Value{Kind: "map", Value: json.RawMessage(`{"Value":{"kind":"string","value":"x","Value":"y"}}`)}
	wire, _ = json.Marshal(r)
	decoded, err = DecodeRequest(wire)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Execute(context.Background(), decoded, corpusForTest(t)); code(err) != "INVALID_REQUEST" {
		t.Fatalf("nested tagged DTO alias accepted: %v", err)
	}
}

func TestJSONSurrogatesRejectCoercionButKeepValidStringData(t *testing.T) {
	for _, raw := range []string{
		`{"bindings":{"p":{"kind":"string","value":"\ud800"}}}`,
		`{"bindings":{"p":{"kind":"string","value":"\udfff"}}}`,
		`{"bindings":{"p":{"kind":"string","value":"\ud800\u0041"}}}`,
		`{"bindings":{"\ud800":{"kind":"string","value":"x"}}}`,
		`{"bindings":{"p":{"kind":"map","value":{"\udfff":{"kind":"string","value":"x"}}}}}`,
	} {
		if _, err := DecodeRequest([]byte(raw)); code(err) != "INVALID_REQUEST" {
			t.Fatalf("surrogate coerced %s: %v", raw, err)
		}
	}
	for _, tc := range []struct{ wire, want string }{
		{`"\ud83d\ude00"`, "😀"},
		{`"�"`, "�"},
		{`"\\ud800"`, `\ud800`},
	} {
		var got string
		if err := strictJSON([]byte(tc.wire), &got); err != nil || got != tc.want {
			t.Fatalf("valid string changed %s: %q %v", tc.wire, got, err)
		}
	}
}

func TestDeclarationLimitDistinctFromBindingMismatch(t *testing.T) {
	c := corpusForTest(t)
	r := cloudRequest("true")
	for i := range 128 {
		name := fmt.Sprintf("p%d", i)
		r.Declarations[name] = BindingType{Kind: "bool"}
		r.Bindings[name] = value("bool", true)
	}
	if _, err := Execute(context.Background(), r, c); err != nil {
		t.Fatalf("128 valid declarations rejected: %v", err)
	}
	r.Declarations["p128"] = BindingType{Kind: "bool"}
	r.Bindings["p128"] = value("bool", true)
	wire, _ := json.Marshal(r)
	decoded, err := DecodeRequest(wire)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Execute(context.Background(), decoded, c); code(err) != "RESOURCE_LIMIT" {
		t.Fatalf("129 declarations not limit: %v", err)
	}
	r = cloudRequest("true")
	r.Declarations["p"] = BindingType{Kind: "bool"}
	if _, err := Execute(context.Background(), r, c); code(err) != "INVALID_REQUEST" {
		t.Fatalf("missing binding no longer invalid: %v", err)
	}
}

func TestMidTokenDraftReplacementIncludesIdentifierSuffix(t *testing.T) {
	source := "resource.labels.env"
	got, err := AnalyzeDraft(source, 18)
	if err != nil || got.Start != 16 || got.End != 19 {
		t.Fatalf("midtoken range %+v %v", got, err)
	}
	if edited := source[:got.Start] + "environment" + source[got.End:]; edited != "resource.labels.environment" {
		t.Fatalf("suffix left over: %s", edited)
	}
}
