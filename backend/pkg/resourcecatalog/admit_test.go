package resourcecatalog

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"os"
	"slices"
	"strconv"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

var (
	completeCoverage = resourcev2.Coverage{Kind: "complete"}
	partialCoverage  = resourcev2.Coverage{Kind: "partial"}
)

// admitSchema resolves document through a real catalog entry.
func admitSchema(t *testing.T, dialect, document, root string) *Schema {
	t.Helper()
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("admit"), catalogOf("c1", typeOf("t", inlineBinding(dialect, document, root))))
	return resolve(t, entry(t, s, "t", "r0"), nil)
}

// body decodes JSON into a tagged value: integral numbers become int64,
// other numbers double.
func body(t *testing.T, raw string) resourcev2.Value {
	t.Helper()
	tree, err := decodeDocument([]byte(raw))
	if err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	v, err := jsonValue(tree, "")
	if err != nil {
		t.Fatalf("value %s: %v", raw, err)
	}
	return v
}

func record(fields map[string]resourcev2.Value) resourcev2.Value {
	return resourcev2.Value{Kind: "map", Map: fields}
}

func int64Value(i int64) resourcev2.Value {
	return resourcev2.Value{Kind: "int64", Int: strconv.FormatInt(i, 10)}
}

func mustAdmit(t *testing.T, schema *Schema, value resourcev2.Value, coverage resourcev2.Coverage) Admission {
	t.Helper()
	got, err := Admit(context.Background(), schema, value, coverage, DefaultPolicy())
	if err != nil {
		t.Fatalf("Admit: %v", err)
	}
	return got
}

func rejectAdmit(t *testing.T, schema *Schema, value resourcev2.Value, coverage resourcev2.Coverage, messagePart string) {
	t.Helper()
	_, err := Admit(context.Background(), schema, value, coverage, DefaultPolicy())
	requireCode(t, err, codeInvalidRequest, messagePart)
}

func TestAdmitAbsentSchemaIsStructuralOnly(t *testing.T) {
	got := mustAdmit(t, nil, body(t, `{"anything":{"goes":[1,"x",null]}}`), completeCoverage)
	if got.Validation != ValidationNone || got.Unvalidated != nil || got.UnavailablePaths != nil {
		t.Fatalf("absent admission = %+v", got)
	}
	bad := record(map[string]resourcev2.Value{"a": record(map[string]resourcev2.Value{
		"b": {Kind: "int64", Int: "007"},
	})})
	rejectAdmit(t, nil, bad, completeCoverage, `/a/b`)
}

func TestAdmitRootMustBeMap(t *testing.T) {
	schema := admitSchema(t, d2020, `{}`, "")
	rejectAdmit(t, schema, body(t, `[1]`), completeCoverage, "must be a map")
	rejectAdmit(t, nil, body(t, `"x"`), completeCoverage, "must be a map")
}

func TestAdmitOpenAPINullable(t *testing.T) {
	schema := admitSchema(t, dOAS30, `{"components":{"schemas":{"R":{"type":"object","properties":{
		"maybe":{"type":"string","nullable":true},
		"never":{"type":"string"}
	}}}}}`, "#/components/schemas/R")
	got := mustAdmit(t, schema, body(t, `{"maybe":null,"never":"x"}`), completeCoverage)
	if got.Validation != ValidationFull {
		t.Fatalf("validation = %q", got.Validation)
	}
	rejectAdmit(t, schema, body(t, `{"never":null}`), completeCoverage, `/never`)
}

func TestAdmitUnions(t *testing.T) {
	schema := admitSchema(t, d2020, `{"type":"object","properties":{
		"overlap":{"anyOf":[
			{"type":"object","required":["name"],"properties":{"name":{"type":"string"},"size":{"type":"integer"}}},
			{"type":"object","required":["name"],"properties":{"name":{"type":"string"},"color":{"type":"string"}}}
		]},
		"exclusive":{"oneOf":[
			{"type":"object","properties":{"name":{"type":"string"}}},
			{"type":"object","properties":{"name":{"type":"string","minLength":3}}}
		]},
		"all":{"allOf":[{"type":"integer"},{"minimum":10}]}
	}}`, "")

	mustAdmit(t, schema, body(t, `{"overlap":{"name":"both"}}`), completeCoverage)
	mustAdmit(t, schema, body(t, `{"overlap":{"name":"one","size":2}}`), completeCoverage)
	rejectAdmit(t, schema, body(t, `{"overlap":{"name":5}}`), completeCoverage, `value at \"/overlap\" matches no anyOf branch`)

	mustAdmit(t, schema, body(t, `{"exclusive":{"name":"ab"}}`), completeCoverage)
	rejectAdmit(t, schema, body(t, `{"exclusive":{"name":"abcd"}}`), completeCoverage, "value matches more than one oneOf branch")
	rejectAdmit(t, schema, body(t, `{"exclusive":{"name":1}}`), completeCoverage, "matches no oneOf branch")

	mustAdmit(t, schema, body(t, `{"all":10}`), completeCoverage)
	rejectAdmit(t, schema, body(t, `{"all":9}`), completeCoverage, `below the minimum`)
}

func TestAdmitClosedObjectRejectsExtraKey(t *testing.T) {
	schema := admitSchema(t, d2020, `{"type":"object","additionalProperties":false,"properties":{"spec":{
		"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"}}
	}}}`, "")
	mustAdmit(t, schema, body(t, `{"spec":{"a":"x"}}`), completeCoverage)
	rejectAdmit(t, schema, body(t, `{"spec":{"a":"x","extra":1}}`), completeCoverage, `/spec/extra`)
}

func TestAdmitAdditionalSchemaChecksUndeclaredValues(t *testing.T) {
	schema := admitSchema(t, d2020, `{"properties":{"labels":{"type":"object","additionalProperties":{"type":"string"}}}}`, "")
	mustAdmit(t, schema, body(t, `{"labels":{"app":"x","tier":"web"}}`), completeCoverage)
	rejectAdmit(t, schema, body(t, `{"labels":{"app":"x","a~b/c":1}}`), completeCoverage, `/labels/a~0b~1c`)
}

func TestAdmitEnumUsesExactTaggedEquality(t *testing.T) {
	schema := admitSchema(t, d2020, `{"properties":{"big":{"enum":[9007199254740993]},"fixed":{"const":"x"}}}`, "")
	mustAdmit(t, schema, record(map[string]resourcev2.Value{"big": int64Value(9007199254740993)}), completeCoverage)
	rejectAdmit(t, schema, record(map[string]resourcev2.Value{"big": {Kind: "double", Double: 9007199254740992}}), completeCoverage, `/big`)
	rejectAdmit(t, schema, record(map[string]resourcev2.Value{"big": {Kind: "uint64", Uint: "9007199254740993"}}), completeCoverage, "enum")
	rejectAdmit(t, schema, body(t, `{"fixed":"y"}`), completeCoverage, "const")
}

func TestAdmitIntOrStringBothEncodings(t *testing.T) {
	schema := admitSchema(t, dOAS30, `{"components":{"schemas":{
		"R":{"type":"object","properties":{
			"extension":{"x-kubernetes-int-or-string":true},
			"format":{"$ref":"#/components/schemas/io.k8s.apimachinery.pkg.util.intstr.IntOrString"}
		}},
		"io.k8s.apimachinery.pkg.util.intstr.IntOrString":{"type":"string","format":"int-or-string"}
	}}}`, "#/components/schemas/R")
	for _, field := range []string{"extension", "format"} {
		mustAdmit(t, schema, record(map[string]resourcev2.Value{field: int64Value(8080)}), completeCoverage)
		mustAdmit(t, schema, record(map[string]resourcev2.Value{field: {Kind: "string", String: "50%"}}), completeCoverage)
		rejectAdmit(t, schema, record(map[string]resourcev2.Value{field: {Kind: "bool", Bool: true}}), completeCoverage, "/"+field)
		rejectAdmit(t, schema, record(map[string]resourcev2.Value{field: {Kind: "double", Double: 1.5}}), completeCoverage, "/"+field)
	}
}

func TestAdmitKubernetesValidationsAreReduced(t *testing.T) {
	schema := admitSchema(t, dOAS30, `{"components":{"schemas":{"R":{"type":"object",
		"x-kubernetes-validations":[{"rule":"self.a > 0"}],
		"properties":{"a":{"type":"integer"}}}}}}`, "#/components/schemas/R")
	got := mustAdmit(t, schema, body(t, `{"a":-1}`), completeCoverage)
	want := []Constraint{{Pointer: "/components/schemas/R", Keyword: "x-kubernetes-validations"}}
	if got.Validation != ValidationReduced || !slices.Equal(got.Unvalidated, want) {
		t.Fatalf("admission = %+v", got)
	}
}

func TestAdmitTimestampRequiresDateTimeFormat(t *testing.T) {
	schema := admitSchema(t, d2020, `{"properties":{
		"when":{"type":"string","format":"date-time"},
		"text":{"type":"string"}
	}}`, "")
	stamp := resourcev2.Value{Kind: "timestamp", Timestamp: "2026-11-01T10:00:00Z"}
	mustAdmit(t, schema, record(map[string]resourcev2.Value{"when": stamp}), completeCoverage)
	mustAdmit(t, schema, body(t, `{"when":"2026-11-01T10:00:00Z"}`), completeCoverage)
	rejectAdmit(t, schema, record(map[string]resourcev2.Value{"text": stamp}), completeCoverage, `/text`)
}

func TestAdmitEnforcedConstraints(t *testing.T) {
	schema := admitSchema(t, d2020, `{"properties":{
		"int":{"type":"integer","minimum":1,"exclusiveMaximum":10},
		"num":{"type":"number","multipleOf":0.1},
		"str":{"type":"string","minLength":2,"maxLength":3,"pattern":"^[a-zé]+$"},
		"list":{"type":"array","minItems":1,"maxItems":2,"uniqueItems":true,"items":{"type":"integer"}},
		"obj":{"type":"object","minProperties":1,"maxProperties":1}
	}}`, "")
	valid := []string{
		`{"int":1}`, `{"int":9}`, `{"num":2}`,
		`{"str":"éé"}`, `{"str":"abc"}`, `{"list":[1,2]}`, `{"obj":{"a":1}}`,
	}
	for _, raw := range valid {
		mustAdmit(t, schema, body(t, raw), completeCoverage)
	}
	invalid := map[string]string{
		`{"int":0}`:             "below the minimum",
		`{"int":10}`:            "above the maximum",
		`{"int":1.5}`:           `/int`,
		`{"num":0.25}`:          "multipleOf",
		`{"str":"é"}`:           "minLength",
		`{"str":"abcd"}`:        "maxLength",
		`{"str":"AB"}`:          "pattern",
		`{"list":[]}`:           "minItems",
		`{"list":[1,2,3]}`:      "maxItems",
		`{"list":[1,1]}`:        "unique",
		`{"list":["x"]}`:        `/list/0`,
		`{"obj":{}}`:            "minProperties",
		`{"obj":{"a":1,"b":2}}`: "maxProperties",
	}
	for raw, part := range invalid {
		rejectAdmit(t, schema, body(t, raw), completeCoverage, part)
	}
}

func TestAdmitBinary64NumericConstraints(t *testing.T) {
	schema := admitSchema(t, d2020, `{"properties":{
		"min":{"minimum":0.1},"max":{"maximum":0.1},
		"step":{"multipleOf":0.1},"binaryStep":{"multipleOf":0.125}
	}}`, "")
	mustAdmit(t, schema, body(t, `{"min":0.1,"binaryStep":0.375}`), completeCoverage)
	rejectAdmit(t, schema, body(t, `{"max":0.1}`), completeCoverage, "above the maximum")
	rejectAdmit(t, schema, body(t, `{"step":0.3}`), completeCoverage, "multipleOf")
}

func TestAdmitPartialUnionBranches(t *testing.T) {
	for _, keyword := range []string{"anyOf", "oneOf"} {
		document := `{"` + keyword + `":[{"required":["a"]},{"required":["b"]}]}`
		schema := admitSchema(t, d2020, document, "")
		got := mustAdmit(t, schema, body(t, `{}`), partialCoverage)
		want := []string{"/a", "/b"}
		if keyword == "oneOf" {
			want = []string{"", "/a", "/b"}
		}
		if !slices.Equal(got.UnavailablePaths, want) {
			t.Fatalf("%s unavailable = %v", keyword, got.UnavailablePaths)
		}
		rejectAdmit(t, schema, body(t, `{}`), completeCoverage, "matches no")
	}
	any := admitSchema(t, d2020, `{"anyOf":[{"required":["a"]},{"type":"object"}]}`, "")
	got := mustAdmit(t, any, body(t, `{}`), partialCoverage)
	if len(got.UnavailablePaths) != 0 {
		t.Fatalf("confirmed anyOf match retained paths: %v", got.UnavailablePaths)
	}
	one := admitSchema(t, d2020, `{"oneOf":[{"required":["a"]},{"type":"object"}]}`, "")
	got = mustAdmit(t, one, body(t, `{}`), partialCoverage)
	if !slices.Equal(got.UnavailablePaths, []string{"", "/a"}) {
		t.Fatalf("uncertain oneOf unavailable = %v", got.UnavailablePaths)
	}
	overlap := admitSchema(t, d2020, `{"oneOf":[{"required":["a"]},{"type":"object"},{"type":"object"}]}`, "")
	rejectAdmit(t, overlap, body(t, `{}`), partialCoverage, "matches more than one")
	nested := admitSchema(t, d2020, `{"oneOf":[{"anyOf":[{"required":["a"]},{"required":["b"]}]},{"type":"string"}]}`, "")
	got = mustAdmit(t, nested, body(t, `{}`), partialCoverage)
	if !slices.Equal(got.UnavailablePaths, []string{"/a", "/b"}) {
		t.Fatalf("nested unavailable = %v", got.UnavailablePaths)
	}
}

func TestAdmitMissingRequiredFollowsCoverage(t *testing.T) {
	schema := admitSchema(t, d2020, `{"type":"object","required":["spec"],"properties":{
		"spec":{"type":"object","required":["name"],"properties":{"name":{"type":"string"}}}
	}}`, "")
	missingName := body(t, `{"spec":{}}`)

	rejectAdmit(t, schema, missingName, completeCoverage, `required property at \"/spec/name\" is missing`)

	for _, coverage := range []resourcev2.Coverage{
		partialCoverage,
		{Kind: "unknown"},
		{Kind: "partial", Paths: []string{"/spec"}},
		{Kind: "partial", Paths: []string{"/other", "/spec/name"}},
	} {
		got := mustAdmit(t, schema, missingName, coverage)
		if !slices.Equal(got.UnavailablePaths, []string{"/spec/name"}) {
			t.Fatalf("coverage %+v: unavailable = %v", coverage, got.UnavailablePaths)
		}
	}
	for _, paths := range [][]string{{"/spe"}, {"/other"}, {"/spec/name/deeper"}} {
		rejectAdmit(t, schema, missingName, resourcev2.Coverage{Kind: "partial", Paths: paths}, `/spec/name`)
	}

	got := mustAdmit(t, schema, body(t, `{}`), partialCoverage)
	if !slices.Equal(got.UnavailablePaths, []string{"/spec"}) {
		t.Fatalf("unavailable = %v", got.UnavailablePaths)
	}
}

func TestAdmitFailedBranchLeavesNoUnavailablePaths(t *testing.T) {
	schema := admitSchema(t, d2020, `{"anyOf":[
		{"type":"object","required":["missing"],"properties":{"x":{"type":"string"}}},
		{"type":"object"}
	]}`, "")
	got := mustAdmit(t, schema, body(t, `{"x":5}`), partialCoverage)
	if got.UnavailablePaths != nil {
		t.Fatalf("unavailable = %v", got.UnavailablePaths)
	}
}

func TestAdmitWorkBudgetBoundary(t *testing.T) {
	schema := admitSchema(t, d2020, `{"type":"object","properties":{"a":{"type":"string"}}}`, "")
	value := body(t, `{"a":"x"}`)
	// Structural traversal visits both values; schema evaluation revisits the field.
	const work = 5
	policy := DefaultPolicy()
	policy.MaxAdmissionWork = work
	if _, err := Admit(context.Background(), schema, value, completeCoverage, policy); err != nil {
		t.Fatalf("at boundary: %v", err)
	}
	policy.MaxAdmissionWork = work - 1
	_, err := Admit(context.Background(), schema, value, completeCoverage, policy)
	requireCode(t, err, codeResourceLimit, "MaxAdmissionWork")

	// Union branch attempts and branch nodes share the same budget.
	union := admitSchema(t, d2020, `{"anyOf":[{"type":"string"},{"type":"object"}]}`, "")
	// Two structural values, root node, and two branch attempts and nodes.
	policy.MaxAdmissionWork = 7
	if _, err := Admit(context.Background(), union, value, completeCoverage, policy); err != nil {
		t.Fatalf("union at boundary: %v", err)
	}
	policy.MaxAdmissionWork = 6
	_, err = Admit(context.Background(), union, value, completeCoverage, policy)
	requireCode(t, err, codeResourceLimit, "MaxAdmissionWork")
}

func TestAdmitUnconstrainedValuesConsumeWork(t *testing.T) {
	value := body(t, `{"a":[1,{"b":2}]}`)
	for _, schema := range []*Schema{nil, admitSchema(t, d2020, `{}`, "")} {
		work := 5
		if schema != nil {
			work++
		}
		policy := DefaultPolicy()
		policy.MaxAdmissionWork = work
		if _, err := Admit(context.Background(), schema, value, completeCoverage, policy); err != nil {
			t.Fatalf("at boundary: %v", err)
		}
		policy.MaxAdmissionWork--
		_, err := Admit(context.Background(), schema, value, completeCoverage, policy)
		requireCode(t, err, codeResourceLimit, "MaxAdmissionWork")
	}
}

func TestAdmitDeepEqualityConsumesWork(t *testing.T) {
	for _, keyword := range []string{"const", "enum"} {
		document := `{"const":{"x":[1,2]}}`
		if keyword == "enum" {
			document = `{"enum":[{"x":[1,2]}]}`
		}
		schema := admitSchema(t, d2020, document, "")
		value := body(t, `{"x":[1,2]}`)
		policy := DefaultPolicy()
		// Four structural values, one schema node, four comparisons.
		policy.MaxAdmissionWork = 9
		if _, err := Admit(context.Background(), schema, value, completeCoverage, policy); err != nil {
			t.Fatalf("%s at boundary: %v", keyword, err)
		}
		policy.MaxAdmissionWork--
		_, err := Admit(context.Background(), schema, value, completeCoverage, policy)
		requireCode(t, err, codeResourceLimit, "MaxAdmissionWork")
	}

	schema := admitSchema(t, d2020, `{"properties":{"x":{"uniqueItems":true}}}`, "")
	value := body(t, `{"x":[[1,2],[1,2]]}`)
	policy := DefaultPolicy()
	policy.MaxAdmissionWork = 13
	_, err := Admit(context.Background(), schema, value, completeCoverage, policy)
	requireCode(t, err, codeResourceLimit, "MaxAdmissionWork")
	policy.MaxAdmissionWork = 14
	_, err = Admit(context.Background(), schema, value, completeCoverage, policy)
	requireCode(t, err, codeInvalidRequest, "repeats item")
}

func TestDeepEqualityChecksCancellation(t *testing.T) {
	values := make([]resourcev2.Value, admissionContextCheckInterval)
	for i := range values {
		values[i] = int64Value(int64(i))
	}
	value := resourcev2.Value{Kind: "list", List: values}
	ctx := &expiringContext{Context: context.Background(), err: context.Canceled}
	a := admitter{ctx: ctx, policy: DefaultPolicy()}
	_, err := a.valuesEqual(&value, &value)
	requireCode(t, err, codeCancelled, "")
}

// expiringContext reports done once its Err has been consulted after more
// than `after` calls, simulating cancellation during a long admission.
type expiringContext struct {
	context.Context
	after int
	calls int
	err   error
}

func (c *expiringContext) Err() error {
	c.calls++
	if c.calls > c.after {
		return c.err
	}
	return nil
}

func TestAdmitContextCancellation(t *testing.T) {
	schema := admitSchema(t, d2020, `{"properties":{"items":{"type":"array","items":{"type":"integer"}}}}`, "")
	small := body(t, `{"items":[1]}`)

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Admit(cancelled, schema, small, completeCoverage, DefaultPolicy())
	requireCode(t, err, codeCancelled, "")

	items := make([]resourcev2.Value, 2048)
	for i := range items {
		items[i] = int64Value(int64(i))
	}
	large := record(map[string]resourcev2.Value{"items": {Kind: "list", List: items}})
	ctx := &expiringContext{Context: context.Background(), after: 1, err: context.Canceled}
	_, err = Admit(ctx, schema, large, completeCoverage, DefaultPolicy())
	requireCode(t, err, codeCancelled, "")

	expired, stop := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer stop()
	_, err = Admit(expired, schema, small, completeCoverage, DefaultPolicy())
	requireCode(t, err, codeTimeout, "")
	ctx = &expiringContext{Context: context.Background(), after: 1, err: context.DeadlineExceeded}
	_, err = Admit(ctx, schema, large, completeCoverage, DefaultPolicy())
	requireCode(t, err, codeTimeout, "")
}

func TestAdmitRecursiveSchema(t *testing.T) {
	schema := admitSchema(t, dDraft7, `{"$ref":"#/definitions/tree","definitions":{"tree":{
		"type":"object","additionalProperties":false,
		"properties":{"value":{"type":"integer"},"children":{"type":"array","items":{"$ref":"#/definitions/tree"}}}
	}}}`, "")
	mustAdmit(t, schema, body(t, `{"value":1,"children":[{"value":2,"children":[{"value":3}]}]}`), completeCoverage)
	rejectAdmit(t, schema, body(t, `{"value":1,"children":[{"value":2,"children":[{"value":"x"}]}]}`), completeCoverage, `/children/0/children/0/value`)
}

func TestAdmitDoesNotBuildBranchViews(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("t", inlineBinding(d2020, `{"anyOf":[{"type":"object"},{"type":"string"}]}`, ""))))
	schema := resolve(t, entry(t, s, "t", "r0"), nil)
	before := c.Stats()
	mustAdmit(t, schema, body(t, `{"a":1}`), completeCoverage)
	if after := c.Stats(); after != before || after.BranchViews != 0 {
		t.Fatalf("stats changed: before %+v after %+v", before, after)
	}
}

// admitKubernetesPodSchema resolves the committed homelab core/v1 OpenAPI
// document at the Pod schema through a real catalog entry.
func admitKubernetesPodSchema(t *testing.T) *Schema {
	t.Helper()
	compressed, err := os.ReadFile("testdata/kubernetes/api__v1.json.gz")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatalf("gunzip fixture: %v", err)
	}
	document, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("gunzip fixture: %v", err)
	}
	return admitSchema(t, dOAS30, string(document), "#/components/schemas/io.k8s.api.core.v1.Pod")
}

const kubernetesPod = `{
	"apiVersion": "v1",
	"kind": "Pod",
	"metadata": {"name": "web", "namespace": "default", "labels": {"app": "web"}, "creationTimestamp": "2026-11-01T10:00:00Z"},
	"spec": {
		"restartPolicy": "Always",
		"containers": [{
			"name": "nginx",
			"image": "nginx:1.27",
			"ports": [{"containerPort": 80, "protocol": "TCP"}],
			"resources": {"limits": {"cpu": "500m", "memory": "128Mi"}},
			"readinessProbe": {"httpGet": {"path": "/", "port": "http"}}
		}]
	}
}`

func TestAdmitKubernetesPod(t *testing.T) {
	schema := admitKubernetesPodSchema(t)
	got := mustAdmit(t, schema, body(t, kubernetesPod), completeCoverage)
	if got.Validation != ValidationFull && got.Validation != ValidationReduced {
		t.Fatalf("validation = %q", got.Validation)
	}
	if (got.Validation == ValidationReduced) != (len(got.Unvalidated) > 0) {
		t.Fatalf("admission = %+v", got)
	}

	pod := body(t, kubernetesPod)
	container := pod.Map["spec"].Map["containers"].List[0]
	container.Map["image"] = int64Value(5)
	rejectAdmit(t, schema, pod, completeCoverage, `/spec/containers/0/image`)
}

func TestAdmitLocalizedCollectionLiteral(t *testing.T) {
	tests := []struct {
		name, schema, value string
		paths               []string
		want                []string
		reject              string
	}{
		{"oneOf definite overlap", `{"oneOf":[{"const":{"x":1}},{"type":"object"}]}`, `{"x":1}`, []string{"/x"}, nil, "more than one"},
		{"enum exact", `{"enum":[{"x":1}]}`, `{"x":1}`, []string{"/x"}, nil, ""},
		{"anyOf limited missing key", `{"anyOf":[{"required":["z"]},{"const":{"x":1}}]}`, `{"x":1}`, []string{"/x", "/z"}, []string{"", "/z"}, ""},
		{"anyOf confirmed nested scalar", `{"anyOf":[{"minProperties":2},{"const":{"x":{"y":1}}}]}`, `{"x":{"y":1}}`, []string{"/x/y"}, nil, ""},
		{"nested scalar", `{"const":{"x":{"y":1}}}`, `{"x":{"y":1}}`, []string{"/x/y"}, nil, ""},
		{"nested missing key", `{"const":{"x":{"y":1}}}`, `{"x":{"y":1}}`, []string{"/x/z"}, []string{""}, ""},
		{"missing key outside literal", `{"const":{"x":1}}`, `{"x":1}`, []string{"/z"}, []string{""}, ""},
		{"whole object", `{"const":{"x":1}}`, `{"x":1}`, []string{}, []string{""}, ""},
		{"list limited index", `{"properties":{"x":{"const":[1]}}}`, `{"x":[1]}`, []string{"/x/0"}, []string{"/x"}, ""},
		{"list possible omitted index", `{"properties":{"x":{"const":[1]}}}`, `{"x":[1]}`, []string{"/x/1"}, []string{"/x"}, ""},
		{"list nested scalar", `{"properties":{"x":{"const":[{"y":1}]}}}`, `{"x":[{"y":1}]}`, []string{"/x/0/y"}, nil, ""},
		{"scalar mismatch", `{"const":{"x":1}}`, `{"x":2}`, []string{"/x"}, nil, "const"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			schema := admitSchema(t, d2020, tt.schema, "")
			value := body(t, tt.value)
			coverage := resourcev2.Coverage{Kind: "partial", Paths: tt.paths}
			if tt.reject != "" {
				rejectAdmit(t, schema, value, coverage, tt.reject)
				return
			}
			got := mustAdmit(t, schema, value, coverage)
			if !slices.Equal(got.UnavailablePaths, tt.want) {
				t.Fatalf("unavailable = %q, want %q", got.UnavailablePaths, tt.want)
			}
		})
	}
}

func TestAdmitOmissionSensitiveCollections(t *testing.T) {
	tests := []struct {
		name, schema, value string
		coverage            resourcev2.Coverage
		want                []string
		reject              string
	}{
		{"complete minimum", `{"minProperties":2}`, `{"x":1}`, completeCoverage, nil, "minProperties"},
		{"partial root minimum", `{"minProperties":2}`, `{"x":1}`, partialCoverage, []string{""}, ""},
		{"unknown root minimum", `{"minProperties":2}`, `{"x":1}`, resourcev2.Coverage{Kind: "unknown"}, []string{""}, ""},
		{"containing path", `{"minProperties":2}`, `{"x":1}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x/y"}}, []string{""}, ""},
		{"below path", `{"properties":{"x":{"properties":{"y":{"minItems":2}}}}}`, `{"x":{"y":[1]}}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x"}}, []string{"/x/y"}, ""},
		{"ancestor path", `{"properties":{"x":{"minItems":2}}}`, `{"x":[1]}`, resourcev2.Coverage{Kind: "unknown", Paths: []string{"/x/0"}}, []string{"/x"}, ""},
		{"segment boundary", `{"properties":{"xy":{"minItems":2}}}`, `{"xy":[1]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x"}}, nil, "minItems"},
		{"escaped boundary", `{"properties":{"a/b":{"minItems":2}}}`, `{"a/b":[1]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/a~1b"}}, []string{"/a~1b"}, ""},
		{"nested const missing", `{"properties":{"x":{"const":{"y":[1,2]}}}}`, `{"x":{"y":[1]}}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x/y"}}, []string{"/x"}, ""},
		{"nested enum missing", `{"enum":[{"x":{"a":1,"b":2}},{"x":{"a":3}}]}`, `{"x":{"a":1}}`, resourcev2.Coverage{Kind: "unknown", Paths: []string{"/x/b"}}, []string{""}, ""},
		{"list leading omission", `{"properties":{"x":{"const":[1,2]}}}`, `{"x":[2]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x"}}, []string{"/x"}, ""},
		{"list interior omission", `{"properties":{"x":{"enum":[[1,2,3]]}}}`, `{"x":[1,3]}`, resourcev2.Coverage{Kind: "unknown", Paths: []string{"/x"}}, []string{"/x"}, ""},
		{"list omitted limited first member", `{"properties":{"x":{"const":[1,2]}}}`, `{"x":[2]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x/0"}}, []string{"/x"}, ""},
		{"list omitted limited last member", `{"properties":{"x":{"enum":[[1,2]]}}}`, `{"x":[1]}`, resourcev2.Coverage{Kind: "unknown", Paths: []string{"/x/1"}}, []string{"/x"}, ""},
		{"list alternative first match", `{"properties":{"x":{"const":[1,1]}}}`, `{"x":[1]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x/0"}}, []string{"/x"}, ""},
		{"list alternative last match", `{"properties":{"x":{"const":[1,1]}}}`, `{"x":[1]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x/1"}}, []string{"/x"}, ""},
		{"list unlisted omitted member", `{"properties":{"x":{"const":[1,2]}}}`, `{"x":[1]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x/0"}}, nil, "const"},
		{"list nested uncertain", `{"properties":{"x":{"const":[{"a":0},{"a":1,"b":2}]}}}`, `{"x":[{"a":1}]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x"}}, []string{"/x"}, ""},
		{"list limited member", `{"properties":{"x":{"const":[{"a":0,"b":2},{"a":1}]}}}`, `{"x":[{"a":0},{"a":1}]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x/0/b"}}, []string{"/x"}, ""},
		{"list unlimited membership", `{"properties":{"x":{"const":[{"a":0},{"a":1,"b":2}]}}}`, `{"x":[{"a":1}]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x/0/b"}}, nil, "const"},
		{"list disjoint", `{"properties":{"x":{"const":[1,2]}}}`, `{"x":[9]}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x"}}, nil, "const"},
		{"list equal length disjoint", `{"properties":{"x":{"const":[1,2]}}}`, `{"x":[2,1]}`, partialCoverage, nil, "const"},
		{"list too long", `{"properties":{"x":{"enum":[[1,2]]}}}`, `{"x":[1,2,3]}`, partialCoverage, nil, "enum"},
		{"list complete leading omission", `{"properties":{"x":{"const":[1,2]}}}`, `{"x":[2]}`, completeCoverage, nil, "const"},
		{"const present conflict", `{"const":{"x":{"a":1,"b":2}}}`, `{"x":{"a":3}}`, partialCoverage, nil, "const"},
		{"enum disjoint", `{"enum":[{"x":1},{"x":2}]}`, `{"x":3}`, partialCoverage, nil, "enum"},
		{"scalar conflict", `{"properties":{"x":{"const":1}}}`, `{"x":2}`, partialCoverage, nil, "const"},
		{"extra enum key", `{"const":{"x":1}}`, `{"x":1,"y":2}`, partialCoverage, nil, "const"},
		{"unlimited missing key", `{"const":{"x":1,"y":2}}`, `{"x":1}`, resourcev2.Coverage{Kind: "partial", Paths: []string{"/x"}}, nil, "const"},
		{"maximum items", `{"properties":{"x":{"minItems":3,"maxItems":1}}}`, `{"x":[1,2]}`, partialCoverage, nil, "maxItems"},
		{"maximum properties", `{"minProperties":4,"maxProperties":1}`, `{"x":1,"y":2}`, partialCoverage, nil, "maxProperties"},
		{"duplicate items", `{"properties":{"x":{"minItems":3,"uniqueItems":true}}}`, `{"x":[1,1]}`, partialCoverage, nil, "repeats item"},
		{"closed extra", `{"minProperties":3,"properties":{"x":{}},"additionalProperties":false}`, `{"x":1,"y":2}`, partialCoverage, nil, "not allowed"},
		{"deduplicate root", `{"minProperties":3,"const":{"x":1,"y":2}}`, `{"x":1}`, partialCoverage, []string{""}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			schema := admitSchema(t, d2020, tt.schema, "")
			value := body(t, tt.value)
			if tt.reject != "" {
				rejectAdmit(t, schema, value, tt.coverage, tt.reject)
				return
			}
			got := mustAdmit(t, schema, value, tt.coverage)
			if !slices.Equal(got.UnavailablePaths, tt.want) {
				t.Fatalf("unavailable = %q, want %q", got.UnavailablePaths, tt.want)
			}
		})
	}
}

func TestAdmitCollectionCombinators(t *testing.T) {
	tests := []struct {
		name, schema, value string
		want                []string
		reject              string
	}{
		{"all uncertain", `{"allOf":[{"minProperties":2},{"properties":{"x":{"minItems":2}}}]}`, `{"x":[1]}`, []string{"", "/x"}, ""},
		{"all definite failure", `{"allOf":[{"minProperties":2},{"properties":{"x":{"type":"string"}}}]}`, `{"x":1}`, nil, "kind"},
		{"any confirmed", `{"anyOf":[{"minProperties":2},{"type":"object"}]}`, `{}`, nil, ""},
		{"any uncertain", `{"anyOf":[{"minProperties":2},{"type":"string"}]}`, `{}`, []string{""}, ""},
		{"any definite failure", `{"anyOf":[{"const":{"x":1}},{"type":"string"}]}`, `{"x":2}`, nil, "matches no"},
		{"one ambiguous", `{"oneOf":[{"minProperties":2},{"type":"object"}]}`, `{}`, []string{""}, ""},
		{"one maximum ambiguity", `{"oneOf":[{"maxProperties":1},{"maxProperties":2}]}`, `{}`, []string{""}, ""},
		{"one unique ambiguity", `{"properties":{"x":{"oneOf":[{"uniqueItems":true},{"type":"array"}]}}}`, `{"x":[]}`, []string{"/x"}, ""},
		{"one closed ambiguity", `{"oneOf":[{"properties":{"a":{"type":"string"}},"additionalProperties":false},{"properties":{"b":{"type":"string"}},"additionalProperties":false}]}`, `{}`, []string{""}, ""},
		{"one optional ambiguity", `{"oneOf":[{"properties":{"a":{"type":"string"}}},{"properties":{"a":{"type":"number"}}}]}`, `{}`, []string{""}, ""},
		{"one item ambiguity", `{"properties":{"x":{"oneOf":[{"items":{"type":"string"}},{"items":{"type":"integer"}}]}}}`, `{"x":[]}`, []string{"/x"}, ""},
		{"one unconstrained optional overlap", `{"oneOf":[{"properties":{"a":{}}},{"properties":{"a":{}}}]}`, `{}`, nil, "more than one"},
		{"one unconstrained referenced overlap", `{"$defs":{"free":{}},"oneOf":[{"properties":{"a":{"$ref":"#/$defs/free"}}},{"properties":{"a":{"allOf":[{},{"anyOf":[{"type":"string"},{}]}]}}}]}`, `{}`, nil, "more than one"},
		{"one present scalar contradiction", `{"oneOf":[{"properties":{"a":{"type":"string"}}},{"properties":{"a":{"type":"number"}}}]}`, `{"a":true}`, nil, "matches no"},
		{"one definite overlap", `{"oneOf":[{"type":"object"},{"type":"object"},{"minProperties":2}]}`, `{}`, nil, "more than one"},
		{"one uncertain only", `{"oneOf":[{"minProperties":2},{"type":"string"}]}`, `{}`, []string{""}, ""},
		{"one definite failure", `{"oneOf":[{"const":{"x":1}},{"type":"string"}]}`, `{"x":2}`, nil, "matches no"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			schema := admitSchema(t, d2020, tt.schema, "")
			value := body(t, tt.value)
			if tt.reject != "" {
				rejectAdmit(t, schema, value, partialCoverage, tt.reject)
				return
			}
			got := mustAdmit(t, schema, value, partialCoverage)
			if !slices.Equal(got.UnavailablePaths, tt.want) {
				t.Fatalf("unavailable = %q, want %q", got.UnavailablePaths, tt.want)
			}
		})
	}
}

func TestPartialConstraintComparisonChargesWorkAndCancellation(t *testing.T) {
	values := make([]resourcev2.Value, admissionContextCheckInterval)
	for i := range values {
		values[i] = int64Value(int64(i))
	}
	value := resourcev2.Value{Kind: "list", List: values}
	policy := DefaultPolicy()
	policy.MaxAdmissionWork = admissionContextCheckInterval
	a := admitter{ctx: context.Background(), policy: policy, coverage: partialCoverage}
	_, err := a.compareConstraint(&value, &value)
	requireCode(t, err, codeResourceLimit, "MaxAdmissionWork")
	ctx := &expiringContext{Context: context.Background(), err: context.Canceled}
	a = admitter{ctx: ctx, policy: DefaultPolicy(), coverage: partialCoverage}
	_, err = a.compareConstraint(&value, &value)
	requireCode(t, err, codeCancelled, "")
	short := resourcev2.Value{Kind: "list", List: []resourcev2.Value{values[len(values)-1]}}
	policy.MaxAdmissionWork = admissionContextCheckInterval
	a = admitter{ctx: context.Background(), policy: policy, coverage: partialCoverage}
	_, err = a.compareConstraint(&value, &short)
	requireCode(t, err, codeResourceLimit, "MaxAdmissionWork")
	a = admitter{ctx: &expiringContext{Context: context.Background(), err: context.Canceled}, policy: DefaultPolicy(), coverage: partialCoverage}
	_, err = a.compareConstraint(&value, &short)
	requireCode(t, err, codeCancelled, "")
	localCoverage := resourcev2.Coverage{Kind: "partial", Paths: []string{"/0"}, Reason: "first member may be omitted"}
	almostComplete := resourcev2.Value{Kind: "list", List: values[1:]}
	a = admitter{ctx: context.Background(), policy: policy, coverage: localCoverage}
	_, err = a.compareConstraint(&value, &almostComplete)
	requireCode(t, err, codeResourceLimit, "MaxAdmissionWork")
	a = admitter{ctx: &expiringContext{Context: context.Background(), err: context.Canceled}, policy: DefaultPolicy(), coverage: localCoverage}
	_, err = a.compareConstraint(&value, &almostComplete)
	requireCode(t, err, codeCancelled, "")
}

func TestPartialUnionProofSharesAdmissionBudget(t *testing.T) {
	var document bytes.Buffer
	document.WriteString(`{"oneOf":[{"properties":{"payload":{"properties":{`)
	for index := range admissionContextCheckInterval + 128 {
		if index > 0 {
			document.WriteByte(',')
		}
		document.WriteString(strconv.Quote("field" + strconv.Itoa(index)))
		document.WriteString(`:{}`)
	}
	document.WriteString(`}}}},{"type":"object"}]}`)
	schema := admitSchema(t, d2020, document.String(), "")
	value := body(t, `{}`)
	policy := DefaultPolicy()
	policy.MaxAdmissionWork = 128
	_, err := Admit(context.Background(), schema, value, partialCoverage, policy)
	requireCode(t, err, codeResourceLimit, "")
	ctx := &expiringContext{Context: context.Background(), after: 1, err: context.Canceled}
	_, err = Admit(ctx, schema, value, partialCoverage, DefaultPolicy())
	requireCode(t, err, codeCancelled, "")
}
