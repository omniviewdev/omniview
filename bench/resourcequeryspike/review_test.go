package main

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestDynamicCheckedResultRequiresActualBoolean(t *testing.T) {
	c := corpusForTest(t)
	r := cloudRequest("p")
	r.Declarations["p"] = BindingType{Kind: "nullable", Value: &BindingType{Kind: "bool"}}
	r.Bindings["p"] = value("bool", true)
	got, err := Execute(context.Background(), r, c)
	if err != nil || !reflect.DeepEqual(got.Names, []string{"cloud-arn", "cloud-ocid"}) {
		t.Fatalf("dyn bool rejected: %+v %v", got, err)
	}
	r.Bindings["p"] = value("bool", false)
	got, err = Execute(context.Background(), r, c)
	if err != nil || len(got.Names) != 0 {
		t.Fatalf("dyn false not bool: %+v %v", got, err)
	}
	r.Bindings["p"] = Value{Kind: "null"}
	if _, err := Execute(context.Background(), r, c); code(err) != "INVALID_REQUEST" {
		t.Fatalf("dyn null truthiness: %v", err)
	}
	r = cloudRequest("1")
	if _, err := Execute(context.Background(), r, c); code(err) != "INVALID_REQUEST" {
		t.Fatalf("known int predicate admitted: %v", err)
	}
}

func TestMultiFieldTextAnyPreservesCoverageAndNullAbsence(t *testing.T) {
	c := corpusForTest(t)
	r := cloudRequest("true")
	r.Text = &TextClause{Fields: [][]string{{"id"}, {"description"}}, Term: "arn:"}
	got, err := Execute(context.Background(), r, c)
	if err != nil || !reflect.DeepEqual(got.Names, []string{"cloud-arn"}) {
		t.Fatalf("ANY null branch: %+v %v", got, err)
	}
	r.Text.Term = "ocid1"
	got, err = Execute(context.Background(), r, c)
	if err != nil || !reflect.DeepEqual(got.Names, []string{"cloud-ocid"}) {
		t.Fatalf("ANY absent branch: %+v %v", got, err)
	}
	r.IncompleteRepresentation = true
	if _, err := Execute(context.Background(), r, c); code(err) != "UNSUPPORTED" {
		t.Fatalf("matching string masked unavailable: %v", err)
	}
	r.IncompleteRepresentation = false
	r.Text.Fields = [][]string{}
	if _, err := Execute(context.Background(), r, c); code(err) != "INVALID_REQUEST" {
		t.Fatalf("nonempty text empty fields: %v", err)
	}
	r.Text.Term = ""
	got, err = Execute(context.Background(), r, c)
	if err != nil || len(got.Names) != 2 {
		t.Fatalf("explicit no text restriction: %+v %v", got, err)
	}
}

func TestActualNativeDiagnosticAfterSupplementaryCombiningText(t *testing.T) {
	source := `"雪😀é" == "雪😀é" && absentParameter`
	r := DraftRequest{Source: source, Cursor: len(source), DocumentRevision: "doc1", EnvironmentRevision: "env1", Declarations: map[string]BindingType{}}
	got, err := AnalyzeDraftEnvironment(r)
	if err != nil || len(got.Diagnostics) == 0 {
		t.Fatalf("actual CEL diagnostic missing: %+v %v", got, err)
	}
	want := strings.Index(source, "absentParameter")
	found := false
	for _, d := range got.Diagnostics {
		if d.Start == want && d.End == want+1 && d.Unit == "utf8-byte" {
			found = true
		}
	}
	if !found {
		t.Fatalf("native codepoint position not translated to byte %d: %+v", want, got.Diagnostics)
	}
	if got.EnvironmentRevision != "env1" || got.DocumentRevision != "doc1" {
		t.Fatal("stale discriminators lost")
	}
	r.Source = "minimum == 1"
	r.Cursor = len(r.Source)
	r.Declarations = map[string]BindingType{"minimum": {Kind: "int64"}}
	a, err := AnalyzeDraftEnvironment(r)
	if err != nil || len(a.Diagnostics) != 0 {
		t.Fatalf("declared int: %+v %v", a, err)
	}
	r.Declarations["minimum"] = BindingType{Kind: "string"}
	r.EnvironmentRevision = "env2"
	b, err := AnalyzeDraftEnvironment(r)
	if err != nil || len(b.Diagnostics) == 0 || b.EnvironmentRevision == a.EnvironmentRevision {
		t.Fatalf("declaration change not checked/revision-bound: %+v %v", b, err)
	}
}
