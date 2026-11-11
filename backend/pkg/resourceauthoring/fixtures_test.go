package resourceauthoring

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes"
)

// Every fixture below goes through the production catalog: a resourcev2.Catalog
// is observed, its entry resolved and normalized, and completion navigates the
// resulting Schema. Nothing here fakes a schema, a navigation result or an
// overlay; the documents are the only inputs.

// cursorMark marks the cursor in test sources. It is not valid CEL, so it never
// collides with operators such as "||".
const cursorMark = "‸"

// cloudFlatSchema is the SDK conformance corpus's cloud instance schema
// (cloud-bundled-pages): flat fields, a nullable string, a date-time and a tag
// ARRAY of key/value objects. It has no Kubernetes construct.
const cloudFlatSchema = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["id","account","region","tags"],"properties":{"id":{"type":"string"},"account":{"type":"string"},"region":{"type":"string"},"tags":{"type":"array","items":{"type":"object","required":["key","value"],"properties":{"key":{"type":"string"},"value":{"type":"string"}}}},"sizeBytes":{"type":"integer"},"description":{"type":["string","null"]},"createdAt":{"type":"string","format":"date-time"}}}`

// cloudNestedSchema adds nested objects, an array of objects, a tag MAP, enum
// and a closed object.
const cloudNestedSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"type": "object",
	"required": ["id", "state"],
	"properties": {
		"id": {"type": "string", "minLength": 1, "description": "Opaque instance id."},
		"state": {"enum": ["pending", "running", "stopped"], "description": "Lifecycle state."},
		"tags": {"type": "object", "additionalProperties": {"type": "string"}},
		"volumes": {"type": "array", "items": {"$ref": "#/$defs/volume"}},
		"note": {"type": ["string", "null"]},
		"network": {"$ref": "#/$defs/network"},
		"name-with-dash": {"type": "string"},
		"雪": {"type": "string"},
		"in": {"type": "integer"},
		"level": {"type": "integer", "format": "int64", "enum": [1, 2, 3]},
		"code": {"type": "integer", "format": "uint32", "enum": [200, 404]},
		"ratio": {"type": "number", "enum": [0.5, 1]},
		"flag": {"type": "boolean"},
		"priority": {"type": ["string", "null"], "enum": ["low", "high", null]}
	},
	"$defs": {
		"volume": {"type": "object", "required": ["device"], "properties": {
			"device": {"type": "string"},
			"sizeGiB": {"type": "integer", "format": "int64"}
		}},
		"network": {"type": "object", "additionalProperties": false, "properties": {
			"vpc": {"type": "string"},
			"subnets": {"type": "array", "items": {"type": "string"}},
			"ipv6": {"type": ["object", "null"], "properties": {"cidr": {"type": "string"}}}
		}}
	}
}`

// containerStateSchema models a container whose lifecycle lives in a nested
// State object, with a label map and a nullable date-time.
const containerStateSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"type": "object",
	"required": ["Id", "State"],
	"properties": {
		"Id": {"type": "string"},
		"Image": {"type": "string"},
		"Names": {"type": "array", "items": {"type": "string"}},
		"Labels": {"type": "object", "additionalProperties": {"type": "string"}},
		"State": {"type": "object", "required": ["Status"], "properties": {
			"Status": {"enum": ["created", "running", "paused", "restarting", "exited", "dead"], "description": "Lifecycle status of the container."},
			"Running": {"type": "boolean"},
			"ExitCode": {"type": "integer", "format": "int32"},
			"StartedAt": {"type": ["string", "null"], "format": "date-time"}
		}}
	}
}`

// vmHardwareSchema models a virtual machine with nested hardware: an optional
// object, a nullable nested object, an array of disks, a oneOf boot source with
// a const discriminator, and a tag map.
const vmHardwareSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"type": "object",
	"required": ["vmid", "node"],
	"properties": {
		"vmid": {"type": "integer", "format": "int64"},
		"node": {"type": "string"},
		"name": {"type": "string", "description": "Display name."},
		"hardware": {"type": "object", "description": "Virtual hardware.", "properties": {
			"cpu": {"type": "object", "required": ["cores"], "properties": {
				"cores": {"type": "integer", "format": "int32", "minimum": 1},
				"sockets": {"type": "integer", "format": "int32"},
				"model": {"type": "string"}
			}},
			"memory": {"type": "object", "properties": {
				"sizeMiB": {"type": "integer", "format": "int64"},
				"balloon": {"type": ["integer", "null"]}
			}},
			"disks": {"type": "array", "items": {"type": "object", "required": ["bus", "sizeGiB"], "properties": {
				"bus": {"enum": ["virtio", "sata", "scsi"]},
				"sizeGiB": {"type": "integer"},
				"readonly": {"type": "boolean"}
			}}},
			"nic": {"type": ["object", "null"], "properties": {
				"model": {"type": "string"},
				"mac": {"type": "string"}
			}}
		}},
		"boot": {"oneOf": [
			{"type": "object", "required": ["kind"], "properties": {"kind": {"const": "disk"}, "disk": {"type": "string"}}},
			{"type": "object", "required": ["kind"], "properties": {"kind": {"const": "network"}, "url": {"type": "string"}}}
		]},
		"tags": {"type": "object", "additionalProperties": {"type": "string"}},
		"createdAt": {"type": "string", "format": "date-time"}
	}
}`

// hypervisorOpenAPIVMSchema is the SDK conformance corpus's OpenAPI 3.0 VM
// schema (hypervisor-openapi-vms): nullable, an overlapping anyOf, an exclusive
// oneOf, allOf with $ref, maps, arrays and open objects.
const hypervisorOpenAPIVMSchema = `{"openapi":"3.0.3","info":{"title":"fixture hypervisor","version":"1"},` +
	`"paths":{},"components":{"schemas":{` +
	`"VM":{"type":"object","required":["vmid","node"],"properties":{` +
	`"vmid":{"type":"integer","format":"int64"},` +
	`"node":{"type":"string"},` +
	`"description":{"type":"string","nullable":true},` +
	`"placement":{"anyOf":[` +
	`{"type":"object","required":["pool"],"additionalProperties":false,` +
	`"properties":{"pool":{"type":"string"},"sizeGiB":{"type":"integer"}}},` +
	`{"type":"object","required":["pool"],"additionalProperties":false,` +
	`"properties":{"pool":{"type":"string"},"cores":{"type":"integer"}}}]},` +
	`"console":{"oneOf":[{"type":"string"},{"type":"integer"}]},` +
	`"network":{"allOf":[{"$ref":"#/components/schemas/Network"}]},` +
	`"tags":{"type":"object","additionalProperties":{"type":"string"}},` +
	`"nics":{"type":"array","items":{"$ref":"#/components/schemas/NIC"}},` +
	`"cpuLimit":{"x-kubernetes-int-or-string":true},` +
	`"extra":{"type":"object","x-kubernetes-preserve-unknown-fields":true}},` +
	`"x-kubernetes-validations":[{"rule":"self.vmid > 0","message":"vmid must be positive"}]},` +
	`"Network":{"type":"object","required":["bridge"],` +
	`"properties":{"bridge":{"type":"string"},"mode":{"type":"string","enum":["bridged","routed"]}}},` +
	`"NIC":{"type":"object","required":["model"],` +
	`"properties":{"model":{"type":"string"},"mac":{"type":"string"}}}}}}`

// fixture is one admitted representation: the production catalog's resolved
// schema plus the CEL environment built from it.
type fixture struct {
	t        *testing.T
	snapshot *resourcecatalog.Snapshot
	entry    *resourcecatalog.Entry
	schema   *resourcecatalog.Schema
	summary  SchemaSummary
	identity Identity
	env      *celtypes.Environment
}

type binding struct {
	dialect  string
	revision string
	document string
	root     string
	state    string
	reason   string
}

func inline(dialect, document string) binding {
	return binding{dialect: dialect, revision: "schema:r1", document: document, state: "available"}
}

func newFixtureFrom(t *testing.T, name string, b binding) *fixture {
	t.Helper()
	schemaBinding := resourcev2.SchemaBinding{State: b.state}
	switch b.state {
	case "available":
		revision := b.revision
		schemaBinding = resourcev2.SchemaBinding{State: "available", Revision: &revision, Dialect: b.dialect, Root: b.root, Document: json.RawMessage(b.document)}
	case "unavailable":
		reason := b.reason
		schemaBinding.UnavailableReason = &reason
	}
	representation := resourcev2.Representation{ID: "native", Revision: "native/1"}
	resolve := func(_ context.Context, request resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
		if request.Route.Connection != "conn" || request.Type != name || request.Target.Auxiliary != nil ||
			request.Target.Representation == nil || *request.Target.Representation != representation {
			return resourcev2.SchemaBinding{}, resourcev2.NewError("INVALID_REQUEST", "schema request escaped its authoring fixture")
		}
		return schemaBinding, nil
	}
	descriptor := resourcev2.ResourceType{
		Type: name, DisplayName: name,
		Representations:       []resourcev2.Representation{representation},
		DefaultRepresentation: "native",
		Capabilities:          []resourcev2.Capability{{Operation: resourcev2.OperationEnumerate, Scope: resourcev2.QueryScope{}}},
	}
	catalog := resourcev2.Catalog{Provider: "fixture", Revision: "catalog/1", Types: []resourcev2.ResourceType{descriptor}, Coverage: resourcev2.Coverage{Kind: "complete"}}
	store := resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy())
	snapshot := store.Observe(resourcecatalog.ConnectionKey{PluginID: "fixture-plugin", Generation: "g1", Connection: "conn", Epoch: 1}, catalog)
	entry, err := snapshot.Entry(name, "native")
	require.NoError(t, err)
	resolution, resolveErr := entry.Resolve(context.Background(), resolve, nil)
	schema := resolution.Schema
	overlay := resourcecatalog.OverlayFor(entry, schema, resolveErr)
	if schema != nil {
		require.NoError(t, resolveErr)
	}
	environment, err := celtypes.NewEnvironment(snapshot.Revision(), entry, schema)
	if schema != nil || resolveErr == nil {
		require.NoError(t, err)
	}
	f := &fixture{t: t, snapshot: snapshot, entry: entry, schema: schema, env: environment}
	f.summary = SchemaSummary{State: resolution.Binding.State, Dialect: resolution.Binding.Dialect, Validation: overlay.Validation, HostEvaluation: overlay.HostEvaluation, HostEvaluationCode: overlay.HostEvaluationCode}
	environmentRevision := ""
	if environment != nil {
		environmentRevision = environment.Revision
	}
	f.identity = Identity{
		Plugin: "fixture-plugin", Provider: "fixture", Connection: "conn", Type: name, Representation: "native", ScopeKey: "sk1.test",
		CatalogRevision: snapshot.Revision(), RepresentationRevision: entry.RepresentationRevision,
		EnvironmentRevision: environmentRevision, AccessGeneration: "ag1.test",
	}
	if resolution.Binding.Revision != nil {
		f.identity.SchemaRevision = *resolution.Binding.Revision
	}
	return f
}

func newFixture(t *testing.T, name, dialect, document string) *fixture {
	return newFixtureFrom(t, name, inline(dialect, document))
}

const (
	draft2020 = resourcev2.DialectJSONSchema202012
	openAPI30 = resourcev2.DialectOpenAPI30
)

// split removes the cursor mark and returns the source and the cursor's byte offset.
func split(t testing.TB, marked string) (string, int) {
	t.Helper()
	index := strings.Index(marked, cursorMark)
	require.GreaterOrEqual(t, index, 0, "source %q has no cursor mark", marked)
	require.Equal(t, 1, strings.Count(marked, cursorMark), "source %q has several cursor marks", marked)
	return marked[:index] + marked[index+len(cursorMark):], index
}

type option func(*Input)

func withDeclarations(declarations map[string]query.BindingType) option {
	return func(in *Input) { in.Request.Declarations = declarations }
}

func withMax(max int) option { return func(in *Input) { in.Request.MaxSuggestions = max } }

func withPolicy(mutate func(*Policy)) option { return func(in *Input) { mutate(&in.Policy) } }

func (f *fixture) input(source string, cursor int, opts ...option) Input {
	in := Input{
		Request: CompletionRequest{
			Version: Version, RequestID: "req-1", DocumentID: "doc-1", DocumentRevision: 1, Source: source,
			Cursor: Cursor{Offset: cursor, Unit: UnitUTF8Byte}, Profile: PredicateProfile,
			Target:         Target{Route: resourcev2.AccessRoute{Connection: "conn"}, Type: f.identity.Type, Representation: "native"},
			MaxSuggestions: 128,
		},
		Identity: f.identity, Schema: f.schema, Summary: f.summary,
		Navigation: resourcecatalog.DefaultPolicy(), Policy: DefaultPolicy(),
	}
	for _, o := range opts {
		o(&in)
	}
	return in
}

// completeAt completes at the cursor mark of marked.
func (f *fixture) completeAt(marked string, opts ...option) CompletionResponse {
	f.t.Helper()
	source, cursor := split(f.t, marked)
	response, err := Complete(context.Background(), f.input(source, cursor, opts...))
	require.NoError(f.t, err, "completing %q", marked)
	checkResponseInvariants(f.t, source, response)
	return response
}

func labels(items []Item) []string {
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = item.Label
	}
	return out
}

func byLabel(items []Item) map[string]Item {
	out := make(map[string]Item, len(items))
	for _, item := range items {
		out[item.Label] = item
	}
	return out
}

func kindsOf(items []Item, kind string) []string {
	var out []string
	for _, item := range items {
		if item.Kind == kind {
			out = append(out, item.Label)
		}
	}
	return out
}

// checkResponseInvariants asserts what every response promises regardless of
// the case: echoed identity, bounded size, and edits that are valid on the exact
// source (scalar boundaries, in range, valid UTF-8 after applying).
func checkResponseInvariants(t testing.TB, source string, response CompletionResponse) {
	t.Helper()
	require.Equal(t, Version, response.Version)
	require.LessOrEqual(t, len(response.Items), response.MaxSuggestions)
	encoded, err := json.Marshal(response)
	require.NoError(t, err)
	require.LessOrEqual(t, len(encoded), DefaultPolicy().MaxResponseBytes)
	require.NoError(t, ValidateOffset(source, response.Context.Replace.Start))
	require.NoError(t, ValidateOffset(source, response.Context.Replace.End))
	require.LessOrEqual(t, response.Context.Replace.Start, response.Context.Replace.End)
	require.Contains(t, []string{CompletionComplete, CompletionTruncated}, response.Completion.Kind)
	if response.Completion.Kind == CompletionComplete {
		require.Empty(t, response.Completion.Reason)
	}
	for _, item := range response.Items {
		require.NotEmpty(t, item.Label)
		require.NotEmpty(t, item.Kind)
		require.Equal(t, UnitUTF8Byte, item.Edit.Unit, item.Label)
		applied, err := ApplyEdit(source, item.Edit)
		require.NoError(t, err, "edit of %q", item.Label)
		require.True(t, utf8Valid(applied), "edit of %q yields invalid UTF-8", item.Label)
		if item.Edit.Selection != nil {
			selection := item.Edit.Selection
			require.Equal(t, UnitUTF8Byte, selection.Unit)
			require.LessOrEqual(t, selection.Start, selection.End)
			require.NoError(t, ValidateOffset(item.Edit.Text, selection.Start), item.Label)
			require.NoError(t, ValidateOffset(item.Edit.Text, selection.End), item.Label)
		}
	}
}

func utf8Valid(s string) bool { return strings.ToValidUTF8(s, "\x00") == s }

// kubernetesSchema resolves a committed homelab OpenAPI document at a component
// root through the production catalog.
func kubernetesFixture(t *testing.T, file, component string) *fixture {
	t.Helper()
	compressed, err := os.ReadFile("../resourcecatalog/testdata/kubernetes/" + file)
	require.NoError(t, err)
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	require.NoError(t, err)
	document, err := io.ReadAll(reader)
	require.NoError(t, err)
	b := inline(openAPI30, string(document))
	b.root = "#/components/schemas/" + component
	return newFixtureFrom(t, "kubernetes-"+component, b)
}
