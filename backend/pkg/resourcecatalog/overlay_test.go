package resourcecatalog

import (
	"context"
	"slices"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestOverlayNativeQueryLanguagesRequireTheCapability(t *testing.T) {
	descriptor := typeOf("t", resourcev2.SchemaBinding{State: "absent"})
	descriptor.NativeQueries = []resourcev2.NativeQueryDescriptor{{Language: "sql"}, {Language: "promql"}, {Language: "sql"}}
	descriptor.Capabilities = []resourcev2.Capability{{Operation: resourcev2.OperationGet}, {Operation: resourcev2.OperationEnumerate}, {Operation: resourcev2.OperationGet}}

	c := NewCatalog(DefaultPolicy())
	without := entry(t, c.Observe(key("a"), catalogOf("c1", descriptor)), "t", "r0")
	o := OverlayFor(without, nil, nil)
	if len(o.NativeQueryLanguages) != 0 || o.NativeQueryLanguages == nil {
		t.Fatalf("languages without nativeQuery = %#v", o.NativeQueryLanguages)
	}
	if !slices.Equal(o.Operations, []resourcev2.Operation{resourcev2.OperationEnumerate, resourcev2.OperationGet}) {
		t.Fatalf("operations = %v", o.Operations)
	}

	descriptor.Capabilities = append(descriptor.Capabilities, resourcev2.Capability{Operation: resourcev2.OperationNativeQuery})
	with := entry(t, c.Observe(key("b"), catalogOf("c1", descriptor)), "t", "r0")
	if o := OverlayFor(with, nil, nil); !slices.Equal(o.NativeQueryLanguages, []string{"promql", "sql"}) {
		t.Fatalf("languages with nativeQuery = %v", o.NativeQueryLanguages)
	}
}

func TestOverlayStatesForEachResolveOutcome(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	forbidden := "FORBIDDEN"
	server := newDocumentServer(d2020, map[string]string{})
	s := c.Observe(key("a"), catalogOf("c1",
		typeOf("full", inlineBinding(d2020, podSchema, "")),
		typeOf("reduced", inlineBinding(d2020, `{"type":"object","not":{}}`, "")),
		typeOf("absent", resourcev2.SchemaBinding{State: "absent"}),
		typeOf("unavailable", resourcev2.SchemaBinding{State: "unavailable", UnavailableReason: &forbidden}),
		typeOf("unsupported", inlineBinding("https://json-schema.org/draft/2019-09/schema", podSchema, "")),
		typeOf("invalid", inlineBinding(d2020, podSchema, "#/nowhere")),
		typeOf("missing", refBinding(d2020, "gone", "")),
	))
	cases := []struct {
		typ, evaluation, code, validation string
	}{
		{"full", HostEvaluationSchemaChecked, "", ValidationFull},
		{"reduced", HostEvaluationSchemaChecked, "", ValidationReduced},
		{"absent", HostEvaluationDynamic, "", ValidationNone},
		{"unavailable", HostEvaluationUnavailable, "FORBIDDEN", ValidationNone},
		{"unsupported", HostEvaluationUnsupported, codeUnsupported, ValidationNone},
		{"invalid", HostEvaluationUnsupported, codeInvalidRequest, ValidationNone},
		{"missing", HostEvaluationUnavailable, codeNotFound, ValidationNone},
	}
	for _, tc := range cases {
		e := entry(t, s, tc.typ, "r0")
		schema, err := e.Resolve(context.Background(), server.fetch)
		o := OverlayFor(e, schema, err)
		if o.HostEvaluation != tc.evaluation || o.HostEvaluationCode != tc.code || o.Validation != tc.validation {
			t.Errorf("%s: overlay = %+v (err %v)", tc.typ, o, err)
		}
		if tc.validation == ValidationReduced && !slices.Contains(o.Unvalidated, Constraint{Pointer: "", Keyword: "not"}) {
			t.Errorf("reduced overlay unvalidated = %v", o.Unvalidated)
		}
	}
}

func TestOverlayUnavailableBindingPreservesReasonClassification(t *testing.T) {
	for _, code := range []string{codeUnsupported, codeInvalidRequest, codeResourceLimit} {
		t.Run(code, func(t *testing.T) {
			c := NewCatalog(DefaultPolicy())
			s := c.Observe(key("a"), catalogOf("c1",
				typeOf("unavailable", resourcev2.SchemaBinding{
					State:             "unavailable",
					UnavailableReason: &code,
				}),
			))
			e := entry(t, s, "unavailable", "r0")
			schema, err := e.Resolve(context.Background(), nil)
			o := OverlayFor(e, schema, err)
			if o.HostEvaluation != HostEvaluationUnavailable || o.HostEvaluationCode != code || o.Validation != ValidationNone {
				t.Fatalf("overlay = %+v (err %v)", o, err)
			}
		})
	}
}
