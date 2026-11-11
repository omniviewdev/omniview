package resourcecatalog_test

// P07 acceptance: provider-neutral schema states and one authority.
//
// Everything here goes through the public catalog API (Observe, Entry, Resolve,
// Admit, Navigate, OverlayFor, EditorJSON) and the CEL adapter. The resource
// types model cloud, container and hypervisor-style providers: none declares a
// Kubernetes group/version/kind, a namespace, a metadata block or an OpenAPI
// document, so the contract is proven without any Kubernetes construct.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"cel.dev/cel-go/cel"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes"
)

const (
	p07Draft2020 = resourcev2.DialectJSONSchema202012
	p07Draft07   = resourcev2.DialectJSONSchemaDraft07
)

// p07CloudInstanceSchema is a static, inline JSON Schema 2020-12 document for a
// cloud compute instance: local $ref, array, map, nullable, enum and a closed
// object. Every keyword in it is enforced, so its validation is full.
const p07CloudInstanceSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"type": "object",
	"required": ["id", "state"],
	"properties": {
		"id": {"type": "string", "minLength": 1},
		"state": {"enum": ["pending", "running", "stopped"]},
		"tags": {"type": "object", "additionalProperties": {"type": "string"}},
		"volumes": {"type": "array", "maxItems": 4, "items": {"$ref": "#/$defs/volume"}},
		"note": {"type": ["string", "null"]},
		"network": {"$ref": "#/$defs/network"}
	},
	"$defs": {
		"volume": {"type": "object", "required": ["device"], "properties": {
			"device": {"type": "string"},
			"sizeGiB": {"type": "integer", "minimum": 1}
		}},
		"network": {"type": "object", "additionalProperties": false, "properties": {
			"vpc": {"type": "string"},
			"subnets": {"type": "array", "uniqueItems": true, "minItems": 1, "items": {"type": "string"}}
		}}
	}
}`

const p07CloudInstanceBody = `{"id":"i-0001","state":"running","tags":{"env":"dev","team":"core"},` +
	`"volumes":[{"device":"/dev/sda","sizeGiB":8}],"note":null,"network":{"vpc":"vpc-1","subnets":["a","b"]}}`

// p07ContainerSchema is delivered by reference as draft-07: definitions, a
// definite oneOf overlap, an overlapping anyOf and a nullable string.
const p07ContainerSchema = `{
	"$schema": "http://json-schema.org/draft-07/schema#",
	"type": "object",
	"required": ["name"],
	"properties": {
		"name": {"type": "string", "minLength": 1},
		"image": {"type": ["string", "null"]},
		"ports": {"type": "array", "items": {"$ref": "#/definitions/port"}},
		"restart": {"oneOf": [
			{"type": "string", "enum": ["always", "never"]},
			{"type": "string", "minLength": 1}
		]},
		"limits": {"anyOf": [
			{"type": "object", "required": ["cpu"], "properties": {"cpu": {"type": "number"}}},
			{"type": "object", "required": ["memory"], "properties": {"memory": {"type": "integer"}}}
		]},
		"labels": {"type": "object", "additionalProperties": {"type": "string"}}
	},
	"definitions": {
		"port": {"type": "object", "required": ["containerPort"], "properties": {
			"containerPort": {"type": "integer", "minimum": 1, "maximum": 65535},
			"protocol": {"enum": ["tcp", "udp"]}
		}}
	}
}`

const p07ContainerBody = `{"name":"web","image":null,"ports":[{"containerPort":8080,"protocol":"tcp"}],` +
	`"restart":"x","limits":{"cpu":1.5},"labels":{"tier":"edge"}}`

func p07Value(t testing.TB, raw string) resourcev2.Value {
	t.Helper()
	v, err := resourcev2.JSONToValue([]byte(raw))
	if err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return v
}

func p07Binding(dialect, revision, document string) resourcev2.SchemaBinding {
	return resourcev2.SchemaBinding{State: "available", Revision: &revision, Dialect: dialect, Document: json.RawMessage(document)}
}

func p07RefBinding(dialect, revision, id string) resourcev2.SchemaBinding {
	return resourcev2.SchemaBinding{State: "available", Revision: &revision, Dialect: dialect,
		DocumentRef: &resourcev2.SchemaDocumentReference{ID: id, Revision: revision}}
}

// p07Type declares one resource type with a single "native" representation and
// non-Kubernetes identity and query dimensions.
func p07Type(name string, dimensions []string, operations ...resourcev2.Operation) resourcev2.ResourceType {
	declared := make([]resourcev2.Dimension, len(dimensions))
	for i, dimension := range dimensions {
		declared[i] = resourcev2.Dimension{Name: dimension}
	}
	capabilities := make([]resourcev2.Capability, len(operations))
	for i, operation := range operations {
		capabilities[i] = resourcev2.Capability{Operation: operation, Scope: resourcev2.QueryScope{}}
	}
	return resourcev2.ResourceType{
		Type: name, DisplayName: name,
		IdentityDimensions: declared, QueryDimensions: declared,
		Representations:       []resourcev2.Representation{{ID: "native", Revision: "native/1"}},
		DefaultRepresentation: "native",
		Capabilities:          capabilities,
	}
}

// p07Source belongs to one fixture route and selected operational format.
func p07Source(connection string, typ resourcev2.ResourceType, binding resourcev2.SchemaBinding) resourcecatalog.BindingSource {
	representation := typ.Representations[0]
	return func(_ context.Context, request resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		if request.Route.Connection != connection || request.Type != typ.Type || request.Target.Auxiliary != nil ||
			request.Target.Representation == nil || *request.Target.Representation != representation {
			return resourcev2.SchemaBinding{}, resourcev2.NewError("INVALID_REQUEST", "schema request escaped its fixture target")
		}
		return binding, nil
	}
}

func p07Catalog(revision string, types ...resourcev2.ResourceType) resourcev2.Catalog {
	return resourcev2.Catalog{Provider: "p07", Revision: revision, Types: types, Coverage: resourcev2.Coverage{Kind: "complete"}}
}

func p07Key(plugin, connection string) resourcecatalog.ConnectionKey {
	return resourcecatalog.ConnectionKey{PluginID: plugin, Generation: "g1", Connection: connection, Epoch: 1}
}

var p07Complete = resourcev2.Coverage{Kind: "complete"}

func p07Partial(paths ...string) resourcev2.Coverage {
	return resourcev2.Coverage{Kind: "partial", Paths: paths, Reason: "provider truncated the representation"}
}

func p07Unknown(paths ...string) resourcev2.Coverage {
	return resourcev2.Coverage{Kind: "unknown", Paths: paths, Reason: "provider did not report coverage"}
}

// p07Resolve observes a one-type catalog and resolves its only entry.
func p07Resolve(catalog *resourcecatalog.Catalog, plugin, connection, revision string, typ resourcev2.ResourceType, binding resourcev2.SchemaBinding, fetch resourcecatalog.DocumentSource) (*resourcecatalog.Snapshot, *resourcecatalog.Entry, *resourcecatalog.Schema, error) {
	snapshot := catalog.Observe(p07Key(plugin, connection), p07Catalog(revision, typ))
	entry, err := snapshot.Entry(typ.Type, "native")
	if err != nil {
		return snapshot, nil, nil, err
	}
	resolution, err := entry.Resolve(context.Background(), p07Source(connection, typ, binding), fetch)
	return snapshot, entry, resolution.Schema, err
}

func p07MustResolve(t *testing.T, catalog *resourcecatalog.Catalog, plugin, connection, revision string, typ resourcev2.ResourceType, binding resourcev2.SchemaBinding, fetch resourcecatalog.DocumentSource) (*resourcecatalog.Snapshot, *resourcecatalog.Entry, *resourcecatalog.Schema) {
	t.Helper()
	snapshot, entry, schema, err := p07Resolve(catalog, plugin, connection, revision, typ, binding, fetch)
	if err != nil {
		t.Fatalf("resolve %s/%s: %v", connection, typ.Type, err)
	}
	return snapshot, entry, schema
}

func p07Admit(schema *resourcecatalog.Schema, body resourcev2.Value, coverage resourcev2.Coverage) (resourcecatalog.Admission, error) {
	return resourcecatalog.Admit(context.Background(), schema, body, coverage, resourcecatalog.DefaultPolicy())
}

func p07RequireAdmitted(t *testing.T, schema *resourcecatalog.Schema, raw string, coverage resourcev2.Coverage) resourcecatalog.Admission {
	t.Helper()
	admission, err := p07Admit(schema, p07Value(t, raw), coverage)
	if err != nil {
		t.Fatalf("body must be admitted: %s: %v", raw, err)
	}
	return admission
}

// p07RequireRejected demands INVALID_REQUEST naming the failing value pointer.
func p07RequireRejected(t *testing.T, schema *resourcecatalog.Schema, raw string, coverage resourcev2.Coverage, pointer string) {
	t.Helper()
	_, err := p07Admit(schema, p07Value(t, raw), coverage)
	p07RequireInvalid(t, err, pointer, raw)
}

// p07ErrorMessage returns the SDK error's message; Error() renders the whole
// error as JSON, which escapes the quotes around pointers.
func p07ErrorMessage(err error) string {
	var operation *resourcev2.ResourceOperationError
	if errors.As(err, &operation) {
		return operation.Message
	}
	return err.Error()
}

func p07RequireInvalid(t *testing.T, err error, pointer, raw string) {
	t.Helper()
	if err == nil {
		t.Fatalf("body must be rejected at %q: %s", pointer, raw)
	}
	if code := resourcev2.ErrorCode(err); code != "INVALID_REQUEST" {
		t.Fatalf("code = %q (%v), want INVALID_REQUEST for %s", code, err, raw)
	}
	if !strings.Contains(p07ErrorMessage(err), fmt.Sprintf("%q", pointer)) {
		t.Fatalf("error %q does not name %q for %s", err, pointer, raw)
	}
}

func p07Navigate(t *testing.T, schema *resourcecatalog.Schema, path ...resourcecatalog.PathSegment) resourcecatalog.Navigation {
	t.Helper()
	navigation, err := resourcecatalog.Navigate(context.Background(), schema, path, resourcecatalog.DefaultPolicy())
	if err != nil {
		t.Fatalf("navigate %v: %v", path, err)
	}
	return navigation
}

func p07Fields(navigation resourcecatalog.Navigation) []string {
	names := make([]string, 0, len(navigation.Fields))
	for _, field := range navigation.Fields {
		names = append(names, field.Segment.Name)
	}
	return names
}

func p07FieldInfo(t *testing.T, navigation resourcecatalog.Navigation, name string) resourcecatalog.FieldInfo {
	t.Helper()
	for _, field := range navigation.Fields {
		if field.Segment.Name == name {
			return field
		}
	}
	t.Fatalf("field %q not listed in %v", name, p07Fields(navigation))
	return resourcecatalog.FieldInfo{}
}

func p07Field(name string) resourcecatalog.PathSegment {
	return resourcecatalog.PathSegment{Kind: resourcecatalog.SegmentField, Name: name}
}

func p07CompileEnvironment(t *testing.T, snapshot *resourcecatalog.Snapshot, entry *resourcecatalog.Entry, schema *resourcecatalog.Schema) *cel.Env {
	t.Helper()
	environment, err := celtypes.NewEnvironment(snapshot.Revision(), entry, schema)
	if err != nil {
		t.Fatalf("celtypes.NewEnvironment: %v", err)
	}
	env, err := cel.NewEnv(append([]cel.EnvOption{cel.CrossTypeNumericComparisons(true)}, environment.Options...)...)
	if err != nil {
		t.Fatalf("cel.NewEnv: %v", err)
	}
	return env
}

func p07CompileError(env *cel.Env, expression string) error {
	_, issues := env.Compile(expression)
	return issues.Err()
}

// TestAcceptanceProviderNeutralSchemaStates resolves one profile per schema
// state: static, discovered, absent, unavailable and unsupported. No profile
// has a Kubernetes group/version/kind, namespace or OpenAPI document.
func TestAcceptanceProviderNeutralSchemaStates(t *testing.T) {
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	var fetches atomic.Int32
	provider := map[string]string{"container/v1": p07ContainerSchema}
	fetch := func(_ context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		fetches.Add(1)
		document, ok := provider[ref.ID]
		if !ok {
			return resourcev2.SchemaDocument{}, resourcev2.NewError("NOT_FOUND", "no such document")
		}
		return resourcev2.SchemaDocument{Reference: ref, Dialect: p07Draft07, Document: json.RawMessage(document)}, nil
	}
	forbidden := "FORBIDDEN"
	operations := []resourcev2.Operation{resourcev2.OperationGet, resourcev2.OperationEnumerate}
	cloud := p07Type("compute.instance", []string{"account", "region"}, operations...)
	container := p07Type("container", []string{"host"}, operations...)
	hypervisor := p07Type("vm", []string{"node"}, operations...)
	denied := p07Type("storage.volume", []string{"pool"}, operations...)
	legacy := p07Type("network.policy", []string{"zone"}, operations...)
	bindings := map[string]resourcev2.SchemaBinding{
		cloud.Type:      p07Binding(p07Draft2020, "cloud/1", p07CloudInstanceSchema),
		container.Type:  p07RefBinding(p07Draft07, "container/v1", "container/v1"),
		hypervisor.Type: {State: "absent"},
		denied.Type:     {State: "unavailable", UnavailableReason: &forbidden},
		legacy.Type:     p07Binding("https://json-schema.org/draft/2019-09/schema", "legacy/1", `{"type":"object"}`),
	}

	// Every input is free of Kubernetes constructs.
	for _, typ := range []resourcev2.ResourceType{cloud, container, hypervisor, denied, legacy} {
		for _, dimension := range typ.QueryDimensions {
			if slices.Contains([]string{"namespace", "group", "version", "kind", "apiVersion"}, dimension.Name) {
				t.Fatalf("%s declares Kubernetes dimension %q", typ.Type, dimension.Name)
			}
		}
		if binding := bindings[typ.Type]; binding.Dialect == resourcev2.DialectOpenAPI30 || strings.Contains(string(binding.Document), "x-kubernetes") {
			t.Fatalf("%s uses OpenAPI or Kubernetes extensions", typ.Type)
		}
	}

	t.Run("static", func(t *testing.T) {
		snapshot, entry, schema := p07MustResolve(t, catalog, "neutral", "cloud", "c1", cloud, bindings[cloud.Type], nil)
		if schema == nil || schema.Validation != resourcecatalog.ValidationFull || len(schema.Unvalidated) != 0 || schema.Dialect != p07Draft2020 {
			t.Fatalf("schema = %+v", schema)
		}
		overlay := resourcecatalog.OverlayFor(entry, schema, nil)
		if overlay.HostEvaluation != resourcecatalog.HostEvaluationSchemaChecked || overlay.Validation != resourcecatalog.ValidationFull {
			t.Fatalf("overlay = %+v", overlay)
		}
		if admission := p07RequireAdmitted(t, schema, p07CloudInstanceBody, p07Complete); admission.Validation != resourcecatalog.ValidationFull || len(admission.UnavailablePaths) != 0 {
			t.Fatalf("admission = %+v", admission)
		}
		p07RequireRejected(t, schema, `{"id":"i-1","state":"paused"}`, p07Complete, "/state")
		p07RequireRejected(t, schema, `{"id":"i-1","state":"running","volumes":[{"device":"/dev/sda","sizeGiB":0}]}`, p07Complete, "/volumes/0/sizeGiB")
		p07RequireRejected(t, schema, `{"id":"i-1","state":"running","tags":{"env":1}}`, p07Complete, "/tags/env")
		p07RequireRejected(t, schema, `{"id":"i-1","state":"running","network":{"zone":"z"}}`, p07Complete, "/network/zone")
		p07RequireRejected(t, schema, `{"id":"i-1","state":"running","network":{"subnets":["a","a"]}}`, p07Complete, "/network/subnets")
		p07RequireRejected(t, schema, `{"state":"running"}`, p07Complete, "/id")
		p07RequireRejected(t, schema, `{"id":null,"state":"running"}`, p07Complete, "/id")
		p07RequireAdmitted(t, schema, `{"id":"i-1","state":"running","note":null}`, p07Complete)
		navigation := p07Navigate(t, schema)
		if got := p07Fields(navigation); !slices.Equal(got, []string{"id", "network", "note", "state", "tags", "volumes"}) {
			t.Fatalf("fields = %v", got)
		}
		if note := p07FieldInfo(t, navigation, "note"); note.Nullable != resourcecatalog.NullableYes || !slices.Equal(note.Types, []string{"null", "string"}) {
			t.Fatalf("note = %+v", note)
		}
		if device := p07FieldInfo(t, p07Navigate(t, schema, p07Field("volumes"), resourcecatalog.PathSegment{Kind: resourcecatalog.SegmentItem}), "device"); device.Presence != resourcecatalog.PresenceRequired {
			t.Fatalf("device = %+v", device)
		}
		if tag := p07Navigate(t, schema, p07Field("tags")); len(tag.Fields) != 1 || tag.Fields[0].Segment.Kind != resourcecatalog.SegmentMapValue {
			t.Fatalf("tags children = %+v", tag.Fields)
		}
		env := p07CompileEnvironment(t, snapshot, entry, schema)
		if err := p07CompileError(env, `resource.id == "i-1" && resource.volumes.exists(v, v.device == "/dev/sda")`); err != nil {
			t.Fatalf("typed expression: %v", err)
		}
		if err := p07CompileError(env, `resource.id + 1`); err == nil {
			t.Fatal("string + int must fail CEL checking against the catalog schema")
		}
		if err := p07CompileError(env, `resource.network.zone`); err == nil {
			t.Fatal("undeclared field on a closed object must fail CEL checking")
		}
	})

	t.Run("discovered", func(t *testing.T) {
		before := fetches.Load()
		_, entry, schema := p07MustResolve(t, catalog, "neutral", "docker", "c1", container, bindings[container.Type], fetch)
		if got := fetches.Load() - before; got != 1 {
			t.Fatalf("fetches = %d, want 1 reference fetch", got)
		}
		if schema == nil || schema.Validation != resourcecatalog.ValidationFull || schema.Dialect != p07Draft07 {
			t.Fatalf("schema = %+v", schema)
		}
		if again, err := entry.Resolve(context.Background(), p07Source("docker", container, bindings[container.Type]), fetch); err != nil || again.Schema != schema || fetches.Load() != before+1 {
			t.Fatalf("second resolve = %v, %v (fetches %d)", again, err, fetches.Load()-before)
		}
		p07RequireAdmitted(t, schema, p07ContainerBody, p07Complete)
		// A definite oneOf overlap, no oneOf branch and an anyOf with no match are rejected.
		p07RequireRejected(t, schema, `{"name":"web","restart":"always"}`, p07Complete, "/restart")
		p07RequireRejected(t, schema, `{"name":"web","restart":5}`, p07Complete, "/restart")
		p07RequireRejected(t, schema, `{"name":"web","limits":{}}`, p07Complete, "/limits")
		p07RequireAdmitted(t, schema, `{"name":"web","limits":{"cpu":1,"memory":4}}`, p07Complete) // overlapping anyOf
		p07RequireRejected(t, schema, `{"name":"web","ports":[{"containerPort":70000}]}`, p07Complete, "/ports/0/containerPort")
		p07RequireRejected(t, schema, `{"name":"web","image":7}`, p07Complete, "/image")
	})

	t.Run("absent", func(t *testing.T) {
		snapshot, entry, schema := p07MustResolve(t, catalog, "neutral", "pve", "c1", hypervisor, bindings[hypervisor.Type], fetch)
		if schema != nil {
			t.Fatalf("absent binding resolved to %+v", schema)
		}
		resolution, err := entry.Resolve(context.Background(), p07Source("pve", hypervisor, bindings[hypervisor.Type]), fetch)
		if err != nil || resolution.Binding.State != "absent" || entry.Current(resolution.Observation) != nil {
			t.Fatalf("absent observation = %+v, %v", resolution, err)
		}
		overlay := resourcecatalog.OverlayFor(entry, schema, nil)
		if overlay.HostEvaluation != resourcecatalog.HostEvaluationDynamic || overlay.Validation != resourcecatalog.ValidationNone {
			t.Fatalf("overlay = %+v", overlay)
		}
		// Absent means structural admission only: no schema is invented.
		admission := p07RequireAdmitted(t, schema, `{"vmid":101,"node":"pve1","anything":{"goes":[1,"x",null]}}`, p07Complete)
		if admission.Validation != resourcecatalog.ValidationNone {
			t.Fatalf("admission = %+v", admission)
		}
		if navigation := p07Navigate(t, schema, p07Field("anything")); navigation.Fields != nil {
			t.Fatalf("absent schema listed fields: %+v", navigation)
		}
		if err := p07CompileError(p07CompileEnvironment(t, snapshot, entry, schema), `resource.anything.goes[0] == 1`); err != nil {
			t.Fatalf("absent schema must type resource as dyn: %v", err)
		}
		// A structurally invalid value is still rejected without a schema.
		_, err = p07Admit(schema, resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"vmid": {Kind: "int64", Int: "007"}}}, p07Complete)
		p07RequireInvalid(t, err, "/vmid", "int64 007")
	})

	t.Run("unavailable", func(t *testing.T) {
		_, entry, schema, err := p07Resolve(catalog, "neutral", "storage", "c1", denied, bindings[denied.Type], fetch)
		if schema != nil || resourcev2.ErrorCode(err) != "FORBIDDEN" {
			t.Fatalf("unavailable resolve = %v, %v", schema, err)
		}
		overlay := resourcecatalog.OverlayFor(entry, schema, err)
		if overlay.HostEvaluation != resourcecatalog.HostEvaluationUnavailable || overlay.HostEvaluationCode != "FORBIDDEN" || overlay.Validation != resourcecatalog.ValidationNone {
			t.Fatalf("overlay = %+v", overlay)
		}
	})

	t.Run("unsupported", func(t *testing.T) {
		_, entry, schema, err := p07Resolve(catalog, "neutral", "network", "c1", legacy, bindings[legacy.Type], fetch)
		if schema != nil || resourcev2.ErrorCode(err) != "UNSUPPORTED" {
			t.Fatalf("unsupported dialect resolve = %v, %v", schema, err)
		}
		overlay := resourcecatalog.OverlayFor(entry, schema, err)
		if overlay.HostEvaluation != resourcecatalog.HostEvaluationUnsupported || overlay.HostEvaluationCode != "UNSUPPORTED" {
			t.Fatalf("overlay = %+v: an unsupported dialect must not be weakened to dynamic", overlay)
		}
	})

	// Two documents are retained: the static cloud and the discovered container.
	if stats := catalog.Stats(); stats.Connections != 5 || stats.Entries != 5 || stats.Documents != 2 {
		t.Fatalf("stats = %+v", stats)
	}
}

// TestAcceptanceSchemaGrantsNoOperationOrNativeFiltering resolves one
// descriptor under every schema state: the overlay's operations and native
// languages come from the descriptor alone, and no field at any depth of a
// rich schema is natively filterable.
func TestAcceptanceSchemaGrantsNoOperationOrNativeFiltering(t *testing.T) {
	forbidden := "FORBIDDEN"
	states := map[string]resourcev2.SchemaBinding{
		"static":      p07Binding(p07Draft2020, "s/1", p07CloudInstanceSchema),
		"absent":      {State: "absent"},
		"unavailable": {State: "unavailable", UnavailableReason: &forbidden},
		"unsupported": p07Binding("https://json-schema.org/draft/2019-09/schema", "s/1", `{}`),
	}
	descriptors := map[string][]resourcev2.Operation{
		"read-only": {resourcev2.OperationGet},
		"no-ops":    nil,
		"query":     {resourcev2.OperationGet, resourcev2.OperationEnumerate, resourcev2.OperationNativeQuery},
	}
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	for stateName, binding := range states {
		for descriptorName, operations := range descriptors {
			connection := stateName + "/" + descriptorName
			typ := p07Type("thing", []string{"scope"}, operations...)
			typ.NativeQueries = []resourcev2.NativeQueryDescriptor{{Language: "sql"}, {Language: "jmespath"}}
			_, entry, schema, err := p07Resolve(catalog, "neutral", connection, "c1", typ, binding, nil)
			overlay := resourcecatalog.OverlayFor(entry, schema, err)
			want := append([]resourcev2.Operation{}, operations...)
			slices.Sort(want)
			if !slices.Equal(overlay.Operations, want) {
				t.Fatalf("%s: operations = %v, want exactly the descriptor's %v", connection, overlay.Operations, want)
			}
			wantLanguages := []string{}
			if slices.Contains(operations, resourcev2.OperationNativeQuery) {
				wantLanguages = []string{"jmespath", "sql"}
			}
			if !slices.Equal(overlay.NativeQueryLanguages, wantLanguages) {
				t.Fatalf("%s: native languages = %v, want %v", connection, overlay.NativeQueryLanguages, wantLanguages)
			}
		}
	}

	// Walk every navigable position of the cloud schema and the container schema.
	var walk func(schema *resourcecatalog.Schema, path []resourcecatalog.PathSegment, depth int) int
	walk = func(schema *resourcecatalog.Schema, path []resourcecatalog.PathSegment, depth int) int {
		navigation := p07Navigate(t, schema, path...)
		visited := 1
		for _, field := range navigation.Fields {
			if field.NativeFilter != resourcecatalog.NativeFilterUnsupported {
				t.Fatalf("field %v at %v: NativeFilter = %q, want %q", field.Segment, path, field.NativeFilter, resourcecatalog.NativeFilterUnsupported)
			}
			if field.HasChildren && depth < 6 {
				visited += walk(schema, append(slices.Clone(path), field.Segment), depth+1)
			}
		}
		return visited
	}
	fetch := func(_ context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		return resourcev2.SchemaDocument{Reference: ref, Dialect: p07Draft07, Document: json.RawMessage(p07ContainerSchema)}, nil
	}
	_, _, cloud := p07MustResolve(t, catalog, "neutral", "walk-cloud", "c1", p07Type("compute.instance", []string{"scope"}), p07Binding(p07Draft2020, "cloud/1", p07CloudInstanceSchema), nil)
	_, _, container := p07MustResolve(t, catalog, "neutral", "walk-container", "c1", p07Type("container", []string{"scope"}), p07RefBinding(p07Draft07, "c/1", "c/1"), fetch)
	cloudPositions, containerPositions := walk(cloud, nil, 0), walk(container, nil, 0)
	if cloudPositions < 6 || containerPositions < 5 {
		t.Fatalf("walk visited %d cloud and %d container positions; the schemas have more", cloudPositions, containerPositions)
	}
	t.Logf("NativeFilter %q at every field of %d cloud and %d container navigation positions", resourcecatalog.NativeFilterUnsupported, cloudPositions, containerPositions)
}

// TestAcceptanceNavigationAgreesWithAdmission proves that field discovery and
// admission read one model: a field the catalog reports as required is rejected
// when missing under complete coverage, an optional one is not, and a field it
// reports as nullable (or not) admits (or rejects) null.
func TestAcceptanceNavigationAgreesWithAdmission(t *testing.T) {
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	fetch := func(_ context.Context, ref resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
		return resourcev2.SchemaDocument{Reference: ref, Dialect: p07Draft07, Document: json.RawMessage(p07ContainerSchema)}, nil
	}
	cases := []struct {
		name    string
		typ     resourcev2.ResourceType
		binding resourcev2.SchemaBinding
		fetch   resourcecatalog.DocumentSource
		valid   string
		fields  int
	}{
		{"cloud", p07Type("compute.instance", []string{"account"}), p07Binding(p07Draft2020, "cloud/1", p07CloudInstanceSchema), nil, p07CloudInstanceBody, 6},
		{"container", p07Type("container", []string{"host"}), p07RefBinding(p07Draft07, "c/1", "c/1"), fetch, p07ContainerBody, 6},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, schema := p07MustResolve(t, catalog, "neutral", tc.name, "c1", tc.typ, tc.binding, tc.fetch)
			p07RequireAdmitted(t, schema, tc.valid, p07Complete)
			navigation := p07Navigate(t, schema)
			if len(navigation.Fields) != tc.fields {
				t.Fatalf("fields = %v, want %d", p07Fields(navigation), tc.fields)
			}
			var decoded map[string]any
			decoder := json.NewDecoder(strings.NewReader(tc.valid))
			decoder.UseNumber()
			if err := decoder.Decode(&decoded); err != nil {
				t.Fatal(err)
			}
			encode := func(mutate func(map[string]any)) string {
				clone := make(map[string]any, len(decoded))
				for k, v := range decoded {
					clone[k] = v
				}
				mutate(clone)
				raw, err := json.Marshal(clone)
				if err != nil {
					t.Fatal(err)
				}
				return string(raw)
			}
			checked := 0
			for _, field := range navigation.Fields {
				if field.Segment.Kind != resourcecatalog.SegmentField || field.Applicability != resourcecatalog.ApplicabilityUnconditional {
					continue
				}
				name := field.Segment.Name
				pointer := "/" + name
				missing := encode(func(m map[string]any) { delete(m, name) })
				switch field.Presence {
				case resourcecatalog.PresenceRequired:
					p07RequireRejected(t, schema, missing, p07Complete, pointer)
					checked++
				case resourcecatalog.PresenceOptional:
					p07RequireAdmitted(t, schema, missing, p07Complete)
					checked++
				}
				nulled := encode(func(m map[string]any) { m[name] = nil })
				switch field.Nullable {
				case resourcecatalog.NullableYes:
					p07RequireAdmitted(t, schema, nulled, p07Complete)
					checked++
				case resourcecatalog.NullableNo:
					p07RequireRejected(t, schema, nulled, p07Complete, pointer)
					checked++
				}
			}
			if checked < 2*tc.fields-4 {
				t.Fatalf("only %d presence/nullability facts were cross-checked", checked)
			}
		})
	}
}

// TestAcceptanceEditorSchemaMatchesAdmission checks that the rendered editor
// document states exactly the constraints admission enforces: enforced
// keywords appear, an unsupported keyword is reported as unvalidated and is not
// presented to the editor, and the document is rendered once and shared.
func TestAcceptanceEditorSchemaMatchesAdmission(t *testing.T) {
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	withUnsupported := strings.Replace(p07CloudInstanceSchema, `"note":`, `"probe": {"type": "string", "not": {"const": "forbidden"}}, "note":`, 1)
	if withUnsupported == p07CloudInstanceSchema {
		t.Fatal("fixture edit did not apply")
	}
	_, _, schema := p07MustResolve(t, catalog, "neutral", "editor", "c1", p07Type("compute.instance", []string{"account"}), p07Binding(p07Draft2020, "cloud/1", withUnsupported), nil)
	if schema.Validation != resourcecatalog.ValidationReduced || !slices.Equal(schema.Unvalidated, []resourcecatalog.Constraint{{Pointer: "/properties/probe", Keyword: "not"}}) {
		t.Fatalf("schema = %s %v", schema.Validation, schema.Unvalidated)
	}
	// Reduced validation still enforces everything it can; nothing is bypassed.
	admission := p07RequireAdmitted(t, schema, p07CloudInstanceBody, p07Complete)
	if admission.Validation != resourcecatalog.ValidationReduced || !slices.Equal(admission.Unvalidated, schema.Unvalidated) {
		t.Fatalf("admission = %+v", admission)
	}
	p07RequireRejected(t, schema, `{"id":"i-1","state":"paused"}`, p07Complete, "/state")
	p07RequireAdmitted(t, schema, `{"id":"i-1","state":"running","probe":"forbidden"}`, p07Complete) // `not` is not enforced, and is reported so

	first, err := schema.Document.EditorJSON()
	if err != nil {
		t.Fatal(err)
	}
	second, err := schema.Document.EditorJSON()
	if err != nil || &first[0] != &second[0] {
		t.Fatalf("editor document must be rendered once: %v", err)
	}
	var rendered struct {
		Schema      string                    `json:"$schema"`
		Definitions map[string]map[string]any `json:"definitions"`
	}
	if err := json.Unmarshal(first, &rendered); err != nil {
		t.Fatal(err)
	}
	if rendered.Schema != "http://json-schema.org/draft-07/schema#" {
		t.Fatalf("$schema = %q", rendered.Schema)
	}
	if root := resourcecatalog.EditorRoot(schema); rendered.Definitions[strings.TrimPrefix(root, "#/definitions/")] == nil {
		t.Fatalf("editor root %q is not a rendered definition", root)
	}
	holds := func(keyword string, want any) bool {
		for _, definition := range rendered.Definitions {
			if got, ok := definition[keyword]; ok && fmt.Sprint(got) == fmt.Sprint(want) {
				return true
			}
		}
		return false
	}
	for keyword, want := range map[string]any{
		"minimum":              json.Number("1"),
		"uniqueItems":          true,
		"maxItems":             json.Number("4"),
		"additionalProperties": false,
		"enum":                 []any{"pending", "running", "stopped"},
	} {
		if !holds(keyword, want) {
			t.Errorf("editor document does not state enforced constraint %s=%v", keyword, want)
		}
	}
	for _, definition := range rendered.Definitions {
		if _, ok := definition["not"]; ok {
			t.Errorf("editor document presents the unvalidated keyword not: %v", definition)
		}
	}
}

// TestAcceptancePartialRepresentationsProviderNeutral exercises complete,
// partial and unknown coverage on a cloud-shaped schema. It asserts the §5
// outcomes: a missing required value is unavailable inside a limitation and
// invalid outside it, omission-sensitive checks are indeterminate, and definite
// present-data violations stay errors.
func TestAcceptancePartialRepresentationsProviderNeutral(t *testing.T) {
	const schemaJSON = `{
		"type": "object",
		"required": ["id"],
		"properties": {
			"id": {"type": "string"},
			"volumes": {"type": "array", "minItems": 1, "maxItems": 2, "items": {
				"type": "object", "required": ["device"], "properties": {"device": {"type": "string"}}}},
			"ports": {"type": "array", "uniqueItems": true, "items": {"type": "integer"}},
			"labels": {"type": "object", "additionalProperties": false, "properties": {"tier": {"type": "string"}}},
			"pool": {"type": "object", "minProperties": 2, "properties": {"a": {}, "b": {}, "c": {}}},
			"mode": {"enum": [{"kind": "a"}, {"kind": "b"}]},
			"placement": {"oneOf": [{"required": ["host"]}, {"required": ["zone"]}]}
		}
	}`
	catalog := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	_, _, schema := p07MustResolve(t, catalog, "neutral", "partial", "c1", p07Type("thing", []string{"scope"}), p07Binding(p07Draft2020, "t/1", schemaJSON), nil)
	if schema.Validation != resourcecatalog.ValidationFull {
		t.Fatalf("validation = %s %v", schema.Validation, schema.Unvalidated)
	}
	tests := []struct {
		name     string
		body     string
		coverage resourcev2.Coverage
		want     []string // exact UnavailablePaths, nil when none
		reject   string   // pointer of the INVALID_REQUEST, when the body must be rejected
	}{
		{"required missing, complete", `{}`, p07Complete, nil, "/id"},
		{"required missing, partial whole body", `{}`, p07Partial(), []string{"/id"}, ""},
		{"required missing, unknown whole body", `{}`, p07Unknown(), []string{"/id"}, ""},
		{"required missing, limitation elsewhere", `{}`, p07Partial("/volumes"), nil, "/id"},
		{"required missing, limitation is the field", `{}`, p07Partial("/id"), []string{"/id"}, ""},
		{"required missing outside a limitation that names a deeper path", `{"volumes":[{}]}`, p07Partial("/volumes/0"), nil, "/id"},
		{"nested required inside limitation", `{"id":"a","volumes":[{}]}`, p07Partial("/volumes/0"), []string{"/volumes", "/volumes/0/device"}, ""},
		{"nested required outside limitation", `{"id":"a","volumes":[{}]}`, p07Partial("/labels"), nil, "/volumes/0/device"},
		{"minItems indeterminate under limitation", `{"id":"a","volumes":[]}`, p07Partial("/volumes"), []string{"/volumes"}, ""},
		{"minItems definite when complete", `{"id":"a","volumes":[]}`, p07Complete, nil, "/volumes"},
		{"minItems definite when limitation is elsewhere", `{"id":"a","volumes":[]}`, p07Partial("/labels"), nil, "/volumes"},
		{"minProperties indeterminate under limitation", `{"id":"a","pool":{"a":1}}`, p07Partial("/pool/b"), []string{"/pool"}, ""},
		{"maxItems stays definite under limitation", `{"id":"a","volumes":[{"device":"a"},{"device":"b"},{"device":"c"}]}`, p07Partial("/volumes"), nil, "/volumes"},
		{"uniqueItems stays definite under limitation", `{"id":"a","ports":[1,1]}`, p07Partial("/ports"), nil, "/ports"},
		{"closed object stays definite under limitation", `{"id":"a","labels":{"tier":"x","zone":"z"}}`, p07Partial("/labels"), nil, "/labels/zone"},
		{"present scalar contradiction stays definite", `{"id":7}`, p07Partial(), nil, "/id"},
		{"collection enum exact", `{"id":"a","mode":{"kind":"a"}}`, p07Partial("/mode/kind"), nil, ""},
		{"collection enum with omitted member", `{"id":"a","mode":{"kind":"a"}}`, p07Partial("/mode/extra"), []string{"/mode"}, ""},
		{"oneOf indeterminate with a limited branch key", `{"id":"a","placement":{"host":"h"}}`, p07Partial("/placement/zone"), []string{"/placement", "/placement/zone"}, ""},
		{"oneOf definite when complete", `{"id":"a","placement":{"host":"h","zone":"z"}}`, p07Complete, nil, "/placement"},
		{"oneOf definite overlap stays an error under limitation", `{"id":"a","placement":{"host":"h","zone":"z"}}`, p07Partial("/placement/other"), nil, "/placement"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			admission, err := p07Admit(schema, p07Value(t, tc.body), tc.coverage)
			if tc.reject != "" {
				p07RequireInvalid(t, err, tc.reject, tc.body)
				return
			}
			if err != nil {
				t.Fatalf("admit %s under %s: %v", tc.body, tc.coverage.Kind, err)
			}
			if !slices.Equal(admission.UnavailablePaths, tc.want) {
				t.Fatalf("unavailable = %q, want %q", admission.UnavailablePaths, tc.want)
			}
			if !slices.IsSorted(admission.UnavailablePaths) || len(slices.Compact(slices.Clone(admission.UnavailablePaths))) != len(admission.UnavailablePaths) {
				t.Fatalf("unavailable paths must be sorted and unique: %q", admission.UnavailablePaths)
			}
		})
	}
}
