package celtypes

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"testing"

	"cel.dev/cel-go/cel"
	"cel.dev/cel-go/common/types"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
)

const testSchema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "big": {"type": "integer", "format": "int64"},
    "count": {"type": "integer", "format": "uint32"},
    "loose": {"type": "integer"},
    "created": {"type": "string", "format": "date-time"},
    "enabled": {"type": "boolean"},
    "maybe": {"type": ["string", "null"]},
    "either": {"anyOf": [{"type": "string"}, {"type": "integer"}]},
    "wrapped": {"allOf": [{"$ref": "#/$defs/meta"}]},
    "metadata": {"$ref": "#/$defs/meta"},
    "spec": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "containers": {"type": "array", "items": {"$ref": "#/$defs/container"}}
      }
    }
  },
  "$defs": {
    "meta": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "labels": {"type": "object", "additionalProperties": {"type": "string"}}
      }
    },
    "container": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name"],
      "properties": {"name": {"type": "string"}, "image": {"type": "string"}}
    }
  }
}`

type fixture struct {
	catalog  *resourcecatalog.Catalog
	snapshot *resourcecatalog.Snapshot
	entry    *resourcecatalog.Entry
	schema   *resourcecatalog.Schema
}

func resolveFixture(t *testing.T, catalogRevision, representationRevision, schemaRevision, document string) fixture {
	t.Helper()
	c := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	return resolveIn(t, c, "conn", catalogRevision, representationRevision, schemaRevision, document)
}

func resolveIn(t *testing.T, c *resourcecatalog.Catalog, connection, catalogRevision, representationRevision, schemaRevision, document string) fixture {
	t.Helper()
	binding := resourcev2.SchemaBinding{State: "absent"}
	if document != "" {
		binding = resourcev2.SchemaBinding{State: "available", Revision: &schemaRevision,
			Dialect: resourcev2.DialectJSONSchema202012, Document: json.RawMessage(document)}
	}
	s := c.Observe(resourcecatalog.ConnectionKey{PluginID: "p", Generation: "g", Connection: connection, Epoch: 1},
		resourcev2.Catalog{Provider: "test", Revision: catalogRevision, Types: []resourcev2.ResourceType{{
			Type: "thing", DisplayName: "thing", DefaultRepresentation: "r",
			Representations: []resourcev2.Representation{{ID: "r", Revision: representationRevision, Schema: binding}},
		}}})
	e, err := s.Entry("thing", "r")
	if err != nil {
		t.Fatal(err)
	}
	schema, err := e.Resolve(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return fixture{catalog: c, snapshot: s, entry: e, schema: schema}
}

func newCELEnv(t *testing.T, f fixture) *cel.Env {
	t.Helper()
	environment, err := NewEnvironment(f.snapshot.Revision(), f.entry, f.schema)
	if err != nil {
		t.Fatal(err)
	}
	options := append([]cel.EnvOption{
		cel.CrossTypeNumericComparisons(true),
		cel.ParserRecursionLimit(64),
		cel.ParserExpressionSizeLimit(16384),
	}, environment.Options...)
	env, err := cel.NewEnv(options...)
	if err != nil {
		t.Fatal(err)
	}
	return env
}

func compileErr(t *testing.T, env *cel.Env, expression string) error {
	t.Helper()
	_, issues := env.Compile(expression)
	return issues.Err()
}

func eval(t *testing.T, env *cel.Env, expression string, body resourcev2.Value) (any, *cel.Ast) {
	t.Helper()
	ast, issues := env.Compile(expression)
	if issues.Err() != nil {
		t.Fatalf("compile %q: %v", expression, issues.Err())
	}
	program, err := env.Program(ast, cel.EvalOptions(cel.OptOptimize))
	if err != nil {
		t.Fatal(err)
	}
	resource, err := ToCEL(body)
	if err != nil {
		t.Fatal(err)
	}
	out, _, err := program.Eval(map[string]any{"resource": resource})
	if err != nil {
		t.Fatalf("eval %q: %v", expression, err)
	}
	return out.Value(), ast
}

func str(s string) resourcev2.Value               { return resourcev2.Value{Kind: "string", String: s} }
func i64(s string) resourcev2.Value               { return resourcev2.Value{Kind: "int64", Int: s} }
func null() resourcev2.Value                      { return resourcev2.Value{Kind: "null"} }
func list(v ...resourcev2.Value) resourcev2.Value { return resourcev2.Value{Kind: "list", List: v} }
func obj(kv ...any) resourcev2.Value {
	m := map[string]resourcev2.Value{}
	for i := 0; i < len(kv); i += 2 {
		m[kv[i].(string)] = kv[i+1].(resourcev2.Value)
	}
	return resourcev2.Value{Kind: "map", Map: m}
}

func body(big string) resourcev2.Value {
	return obj(
		"big", i64(big),
		"maybe", null(),
		"either", i64("3"),
		"metadata", obj("name", str("web"), "labels", obj("app", str("x"))),
		"wrapped", obj("name", str("w")),
		"spec", obj("containers", list(obj("name", str("a"), "image", str("nginx:1.27")), obj("name", str("b"), "image", str("busybox")))),
	)
}

func TestClosedStructRejectsUnknownField(t *testing.T) {
	env := newCELEnv(t, resolveFixture(t, "c1", "rep/1", "s/1", testSchema))
	for _, expression := range []string{"resource.spec.containerz", "resource.nope", "resource.spec.containers[0].imag"} {
		if err := compileErr(t, env, expression); err == nil || !strings.Contains(err.Error(), "undefined field") {
			t.Fatalf("%s: err = %v", expression, err)
		}
	}
	if err := compileErr(t, env, `resource.spec.containers[0].image + 1`); err == nil {
		t.Fatal("string + int must fail checking")
	}
}

func TestNavigationAgreesWithCELShape(t *testing.T) {
	document := `{
		"type":"object", "additionalProperties":false,
		"properties":{
			"ref":{"$ref":"#/$defs/base"},
			"annotated":{"allOf":[{"$ref":"#/$defs/base"},{"description":"documentation"}]},
			"ownAllOf":{"type":"object","properties":{"own":{"type":"string"}},"allOf":[{"$ref":"#/$defs/base"}]},
			"ownRef":{"type":"object","$ref":"#/$defs/base"},
			"multiple":{"allOf":[{"$ref":"#/$defs/base"},{"type":"object"}]}
		},
		"$defs":{"base":{"type":"object","additionalProperties":false,"properties":{"known":{"type":"string"}}}}
	}`
	f := resolveFixture(t, "c1", "rep/1", "s/1", document)
	env := newCELEnv(t, f)
	nav, err := resourcecatalog.Navigate(context.Background(), f.schema, nil, resourcecatalog.DefaultPolicy())
	if err != nil {
		t.Fatal(err)
	}
	fields := make(map[string]resourcecatalog.FieldInfo)
	for _, field := range nav.Fields {
		fields[field.Segment.Name] = field
	}
	for _, tc := range []struct {
		name    string
		dynamic bool
	}{
		{"ref", false},
		{"annotated", false},
		{"ownAllOf", true},
		{"ownRef", true},
		{"multiple", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			field, ok := fields[tc.name]
			if !ok {
				t.Fatalf("field %q missing from navigation", tc.name)
			}
			want := resourcecatalog.CELCheckingStatic
			if tc.dynamic {
				want = resourcecatalog.CELCheckingDynamic
			}
			if field.CELChecking != want {
				t.Errorf("CELChecking = %q, want %q", field.CELChecking, want)
			}
			ast, issues := env.Compile("resource." + tc.name)
			if issues.Err() != nil {
				t.Fatal(issues.Err())
			}
			if got := ast.OutputType().IsExactType(types.DynType); got != tc.dynamic {
				t.Errorf("output type = %v, dynamic = %v", ast.OutputType(), tc.dynamic)
			}
			err := compileErr(t, env, "resource."+tc.name+".unknown")
			if (err == nil) != tc.dynamic {
				t.Errorf("unknown field error = %v, dynamic = %v", err, tc.dynamic)
			}
		})
	}
}

func TestListExistsStartsWith(t *testing.T) {
	env := newCELEnv(t, resolveFixture(t, "c1", "rep/1", "s/1", testSchema))
	out, ast := eval(t, env, `resource.spec.containers.exists(c, c.image.startsWith("nginx"))`, body("1"))
	if out != true || !ast.OutputType().IsExactType(types.BoolType) {
		t.Fatalf("out = %v (%v)", out, ast.OutputType())
	}
	out, _ = eval(t, env, `resource.spec.containers.exists(c, c.image.startsWith("redis"))`, body("1"))
	if out != false {
		t.Fatalf("out = %v", out)
	}
}

func TestOpenObjectMapLabelLookup(t *testing.T) {
	env := newCELEnv(t, resolveFixture(t, "c1", "rep/1", "s/1", testSchema))
	out, _ := eval(t, env, `resource.metadata.labels["app"] == "x" && resource.wrapped.name == "w"`, body("1"))
	if out != true {
		t.Fatalf("out = %v", out)
	}
	// Open object: undeclared fields check as dyn.
	if err := compileErr(t, env, `resource.metadata.undeclared == 1`); err != nil {
		t.Fatal(err)
	}
	if err := compileErr(t, env, `resource.metadata.labels["app"] == 1`); err == nil {
		t.Fatal("map(string,string) value compared to int must fail checking")
	}
	out, _ = eval(t, env, `has(resource.metadata.name) && !has(resource.metadata.namespace)`, body("1"))
	if out != true {
		t.Fatalf("has out = %v", out)
	}
}

func TestInt64FormatExactComparison(t *testing.T) {
	env := newCELEnv(t, resolveFixture(t, "c1", "rep/1", "s/1", testSchema))
	for big, want := range map[string]bool{"9007199254740993": true, "9007199254740992": false} {
		out, _ := eval(t, env, `resource.big == 9007199254740993`, body(big))
		if out != want {
			t.Fatalf("big=%s out = %v", big, out)
		}
		if err := compileErr(t, env, `resource.big == "x"`); err == nil {
			t.Fatal("int field compared to string must fail checking")
		}
	}
}

func TestScalarMapping(t *testing.T) {
	f := resolveFixture(t, "c1", "rep/1", "s/1", testSchema)
	environment, err := NewEnvironment("c1", f.entry, f.schema)
	if err != nil {
		t.Fatal(err)
	}
	built, err := f.schema.Document.LoadCELProvider(func() (any, error) { return nil, errors.New("must be cached") })
	if err != nil {
		t.Fatal(err)
	}
	p := built.(*provider)
	root := p.typeOf(f.schema.Root)
	want := map[string]*types.Type{
		"big": types.IntType, "count": types.UintType, "loose": types.DynType, "created": types.DynType,
		"enabled": types.BoolType, "maybe": types.DynType, "either": types.DynType,
	}
	for field, wantType := range want {
		ft, ok := p.FindStructFieldType(root.TypeName(), field)
		if !ok || !ft.Type.IsExactType(wantType) {
			t.Fatalf("%s = %v, want %v", field, ft, wantType)
		}
	}
	metadata, _ := p.FindStructFieldType(root.TypeName(), "metadata")
	labels, _ := p.FindStructFieldType(metadata.Type.TypeName(), "labels")
	if labels == nil || !labels.Type.IsExactType(types.NewMapType(types.StringType, types.StringType)) {
		t.Fatalf("labels = %v", labels)
	}
	if _, ok := p.FindStructType(root.TypeName()); !ok {
		t.Fatal("root struct type must be found")
	}
	if !strings.HasPrefix(root.TypeName(), "omniview.schema.") || len(environment.Options) != 2 {
		t.Fatalf("root = %s, options = %d", root.TypeName(), len(environment.Options))
	}
}

func TestUnionAndNullablePathsAreDynAndEvaluate(t *testing.T) {
	env := newCELEnv(t, resolveFixture(t, "c1", "rep/1", "s/1", testSchema))
	out, _ := eval(t, env, `resource.either == 3 && resource.maybe == null`, body("1"))
	if out != true {
		t.Fatalf("out = %v", out)
	}
	for _, expression := range []string{"resource.either", "resource.maybe"} {
		a, issues := env.Compile(expression)
		if issues.Err() != nil || !a.OutputType().IsExactType(types.DynType) {
			t.Fatalf("%s type = %v (%v)", expression, a.OutputType(), issues.Err())
		}
	}
}

func TestAbsentSchemaIsDyn(t *testing.T) {
	f := resolveFixture(t, "c1", "rep/1", "", "")
	if f.schema != nil {
		t.Fatal("absent binding must resolve to nil")
	}
	env := newCELEnv(t, f)
	out, _ := eval(t, env, `resource.anything.goes == "x"`, obj("anything", obj("goes", str("x"))))
	if out != true {
		t.Fatalf("out = %v", out)
	}
	a, _ := env.Compile("resource")
	if !a.OutputType().IsExactType(types.DynType) {
		t.Fatalf("resource = %v", a.OutputType())
	}
}

func TestRevisionTracksRevisionsContentKeyTracksContent(t *testing.T) {
	keys := func(f fixture, snapshotRevision string) (string, string) {
		environment, err := NewEnvironment(snapshotRevision, f.entry, f.schema)
		if err != nil {
			t.Fatal(err)
		}
		return environment.ContentKey, environment.Revision
	}
	base := resolveFixture(t, "c1", "rep/1", "s/1", testSchema)
	baseContent, baseRevision := keys(base, "c1")
	for name, f := range map[string]fixture{
		"snapshot":       resolveFixture(t, "c2", "rep/1", "s/1", testSchema),
		"representation": resolveFixture(t, "c1", "rep/2", "s/1", testSchema),
		"schema":         resolveFixture(t, "c1", "rep/1", "s/2", testSchema),
	} {
		content, revision := keys(f, f.snapshot.Revision())
		if content != baseContent || revision == baseRevision {
			t.Fatalf("%s: content same=%v revision same=%v", name, content == baseContent, revision == baseRevision)
		}
	}
	if again, _ := keys(base, "c1"); again != baseContent {
		t.Fatal("content key must be deterministic")
	}
	absent := resolveFixture(t, "c1", "rep/1", "", "")
	absentContent, absentRevision := keys(absent, "c1")
	changedContent, changedRevision := keys(resolveFixture(t, "c1", "rep/2", "", ""), "c1")
	if absentContent == baseContent || absentContent != changedContent || absentRevision == changedRevision {
		t.Fatal("absent keys must be dyn content with revision identity")
	}
}

func TestProviderBuiltOncePerDocument(t *testing.T) {
	c := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	a := resolveIn(t, c, "a", "c1", "rep/1", "s/1", testSchema)
	b := resolveIn(t, c, "b", "c1", "rep/1", "s/1", testSchema)
	if a.schema.Document != b.schema.Document {
		t.Fatal("identical bytes must share a document")
	}
	for i := range 200 {
		f := a
		if i%2 == 1 {
			f = b
		}
		env := newCELEnv(t, f)
		if err := compileErr(t, env, `resource.big > 1`); err != nil {
			t.Fatal(err)
		}
	}
	if st := c.Stats(); st.CELProviders != 1 || st.Documents != 1 {
		t.Fatalf("stats = %+v", st)
	}
}

func TestNewEnvironmentRequiresEntry(t *testing.T) {
	if _, err := NewEnvironment("c1", nil, nil); err == nil {
		t.Fatal("nil entry must fail")
	}
}

func TestToCEL(t *testing.T) {
	v, err := ToCEL(obj("t", resourcev2.Value{Kind: "timestamp", Timestamp: "2026-11-01T00:00:00Z"},
		"u", resourcev2.Value{Kind: "uint64", Uint: "18446744073709551615"},
		"d", resourcev2.Value{Kind: "double", Double: 1.5}, "n", null()))
	if err != nil {
		t.Fatal(err)
	}
	env, _ := cel.NewEnv(cel.Variable("resource", cel.DynType))
	ast, _ := env.Compile(`resource.t == timestamp("2026-11-01T00:00:00Z") && resource.u == 18446744073709551615u && resource.d == 1.5 && resource.n == null`)
	program, _ := env.Program(ast)
	out, _, err := program.Eval(map[string]any{"resource": v})
	if err != nil || out != types.True {
		t.Fatalf("out = %v, %v", out, err)
	}
	if _, err := ToCEL(obj("x", obj("y", resourcev2.Value{Kind: "int64", Int: "nope"}))); err == nil || !strings.Contains(err.Error(), "'/x/y'") {
		t.Fatalf("err = %v", err)
	}
	if _, err := ToCEL(resourcev2.Value{Kind: "bogus"}); err == nil {
		t.Fatal("unknown kind must fail")
	}
}

func resolveKubernetesPod(t *testing.T) fixture {
	t.Helper()
	file, err := os.Open("../testdata/kubernetes/api__v1.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	reader, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	revision := "k8s/1"
	c := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	s := c.Observe(resourcecatalog.ConnectionKey{PluginID: "p", Generation: "g", Connection: "homelab", Epoch: 1},
		resourcev2.Catalog{Provider: "test", Revision: "c1", Types: []resourcev2.ResourceType{{
			Type: "core::v1::Pod", DisplayName: "Pod", DefaultRepresentation: "r",
			Representations: []resourcev2.Representation{{ID: "r", Revision: "rep/1", Schema: resourcev2.SchemaBinding{
				State: "available", Revision: &revision, Dialect: resourcev2.DialectOpenAPI30,
				Root: "#/components/schemas/io.k8s.api.core.v1.Pod", Document: json.RawMessage(raw)}}},
		}}})
	e, err := s.Entry("core::v1::Pod", "r")
	if err != nil {
		t.Fatal(err)
	}
	schema, err := e.Resolve(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return fixture{catalog: c, snapshot: s, entry: e, schema: schema}
}

func TestKubernetesPod(t *testing.T) {
	env := newCELEnv(t, resolveKubernetesPod(t))
	pod := obj(
		"apiVersion", str("v1"), "kind", str("Pod"),
		"metadata", obj("name", str("web"), "labels", obj("app", str("x"))),
		"spec", obj("containers", list(obj("name", str("web"), "image", str("nginx:1.27")))),
	)
	out, _ := eval(t, env, `resource.spec.containers.exists(c, c.image.startsWith("nginx")) && resource.metadata.labels["app"] == "x"`, pod)
	if out != true {
		t.Fatalf("out = %v", out)
	}
	// Kubernetes objects are open (no additionalProperties: false), so per
	// spec §8 an undeclared name checks as dyn (partial) while declared
	// fields keep static types.
	ast, issues := env.Compile("resource.spec.containerz")
	if issues.Err() != nil || !ast.OutputType().IsExactType(types.DynType) {
		t.Fatalf("containerz = %v, %v", ast, issues.Err())
	}
	for _, expression := range []string{`resource.spec.containers[0].image + 1`, `resource.metadata.labels["app"] == 1`, `resource.spec.containers.size() == "1"`} {
		if err := compileErr(t, env, expression); err == nil {
			t.Fatalf("%s must fail checking", expression)
		}
	}
}

func evalResult(t *testing.T, env *cel.Env, expression string, value resourcev2.Value) (any, error) {
	t.Helper()
	ast, issues := env.Compile(expression)
	if issues.Err() != nil {
		t.Fatalf("compile %q: %v", expression, issues.Err())
	}
	program, err := env.Program(ast, cel.EvalOptions(cel.OptOptimize))
	if err != nil {
		t.Fatal(err)
	}
	resource, err := ToCEL(value)
	if err != nil {
		t.Fatal(err)
	}
	out, _, err := program.Eval(map[string]any{"resource": resource})
	if err != nil {
		return nil, err
	}
	return out.Value(), nil
}

func TestMissingOptionalFieldAgreesWithDyn(t *testing.T) {
	checked := newCELEnv(t, resolveFixture(t, "c1", "rep/1", "s/1", testSchema))
	dynamic := newCELEnv(t, resolveFixture(t, "c1", "rep/1", "", ""))
	value := obj("metadata", obj("labels", obj()))
	for _, expression := range []string{`resource.metadata.name`, `resource.metadata.name == "x"`, `has(resource.metadata.name)`, `resource.enabled`} {
		checkedOut, checkedErr := evalResult(t, checked, expression, value)
		dynamicOut, dynamicErr := evalResult(t, dynamic, expression, value)
		if (checkedErr == nil) != (dynamicErr == nil) || checkedOut != dynamicOut {
			t.Fatalf("%s: checked = %v, %v; dyn = %v, %v", expression, checkedOut, checkedErr, dynamicOut, dynamicErr)
		}
		if strings.HasPrefix(expression, "resource.") && (checkedErr == nil || !strings.Contains(checkedErr.Error(), "no such key")) {
			t.Fatalf("%s: missing field must be no such key, got %v, %v", expression, checkedOut, checkedErr)
		}
	}
}

func TestFieldGetterReportsMissingKey(t *testing.T) {
	f := resolveFixture(t, "c1", "rep/1", "s/1", testSchema)
	if _, err := NewEnvironment("c1", f.entry, f.schema); err != nil {
		t.Fatal(err)
	}
	built, err := f.schema.Document.LoadCELProvider(func() (any, error) { return nil, errors.New("must be cached") })
	if err != nil {
		t.Fatal(err)
	}
	p := built.(*provider)
	field, ok := p.FindStructFieldType(p.typeOf(f.schema.Root).TypeName(), "enabled")
	if !ok {
		t.Fatal("enabled must be declared")
	}
	for _, target := range []any{map[string]any{}, "not a map", nil} {
		if v, err := field.GetFrom(target); err == nil || err.Error() != "no such key: enabled" || field.IsSet(target) {
			t.Fatalf("target %#v: %v, %v", target, v, err)
		}
	}
	if v, err := field.GetFrom(map[string]any{"enabled": true}); err != nil || v != true {
		t.Fatalf("present = %v, %v", v, err)
	}
}

func TestConcurrentCompileSharesOneProvider(t *testing.T) {
	f := resolveFixture(t, "c1", "rep/1", "s/1", testSchema)
	var wg sync.WaitGroup
	errs := make(chan error, 32)
	for range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 50 {
				environment, err := NewEnvironment("c1", f.entry, f.schema)
				if err != nil {
					errs <- err
					return
				}
				env, err := cel.NewEnv(append([]cel.EnvOption{cel.CrossTypeNumericComparisons(true)}, environment.Options...)...)
				if err != nil {
					errs <- err
					return
				}
				if _, issues := env.Compile(`resource.spec.containers.exists(c, c.image.startsWith("nginx")) && resource.big > 1`); issues.Err() != nil {
					errs <- issues.Err()
					return
				}
				if _, issues := env.Compile(`resource.spec.containerz`); issues.Err() == nil {
					errs <- errors.New("closed struct accepted unknown field")
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if st := f.catalog.Stats(); st.CELProviders != 1 {
		t.Fatalf("stats = %+v", st)
	}
}
