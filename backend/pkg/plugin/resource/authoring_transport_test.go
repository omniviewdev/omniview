package resource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
	"github.com/omniviewdev/omniview/backend/pkg/resourceauthoring"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// These tests drive completion through the same boundary the frontend uses: the
// Wails ServiceWrapper method, with the request decoded strictly from JSON and
// the response encoded back, against the real resource controller, its catalog
// snapshots and invocation admission. Providers are the mock provider (to change
// schemas, slow a call or block it) and, in TestActualSDKChildCompletion, the SDK
// conformance child over gRPC. No completion logic is mocked.

const (
	cloudDocument = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["id","account","region","tags"],"properties":{"id":{"type":"string"},"account":{"type":"string"},"region":{"type":"string"},"tags":{"type":"array","items":{"type":"object","required":["key","value"],"properties":{"key":{"type":"string"},"value":{"type":"string"}}}},"labels":{"type":"object","additionalProperties":{"type":"string"}},"state":{"enum":["pending","running","stopped"]}}}`

	containerDocument = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["Id","State"],"properties":{"Id":{"type":"string"},"Labels":{"type":"object","additionalProperties":{"type":"string"}},"State":{"type":"object","properties":{"Status":{"enum":["created","running","exited"]},"Running":{"type":"boolean"},"ExitCode":{"type":"integer","format":"int32"}}}}}`

	vmDocument = `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["vmid"],"properties":{"vmid":{"type":"integer","format":"int64"},"hardware":{"type":"object","properties":{"cpu":{"type":"object","properties":{"cores":{"type":"integer","format":"int32"}}},"disks":{"type":"array","items":{"type":"object","properties":{"bus":{"enum":["virtio","sata"]},"sizeGiB":{"type":"integer"}}}},"nic":{"type":["object","null"],"properties":{"mac":{"type":"string"}}}}},"boot":{"oneOf":[{"type":"object","properties":{"kind":{"const":"disk"},"disk":{"type":"string"}}},{"type":"object","properties":{"kind":{"const":"network"},"url":{"type":"string"}}}]}}}`
)

// authoringProvider is a provider whose catalog tests can change, slow or block.
type authoringProvider struct {
	mu        sync.Mutex
	name      string
	revision  string
	documents map[string]string
	schemaRev string
	before    func(context.Context) error
}

func newAuthoringProvider(name string) *authoringProvider {
	return &authoringProvider{name: name, revision: "c1", schemaRev: "schema:1", documents: map[string]string{
		"compute/instance": cloudDocument, "container": containerDocument, "vm": vmDocument,
	}}
}

func (p *authoringProvider) mutate(revision, schemaRev, instanceDocument string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.revision, p.schemaRev = revision, schemaRev
	p.documents["compute/instance"] = instanceDocument
}

func (p *authoringProvider) mock() *mockProvider {
	return &mockProvider{CatalogFunc: func(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
		p.mu.Lock()
		before, revision, schemaRev := p.before, p.revision, p.schemaRev
		documents := map[string]string{}
		for k, v := range p.documents {
			documents[k] = v
		}
		p.mu.Unlock()
		if before != nil {
			if err := before(ctx); err != nil {
				return resource.Catalog{}, err
			}
		}
		forbidden := "FORBIDDEN"
		catalog := canonicalTestCatalog(p.name, "x")
		catalog.Revision = revision
		catalog.Types = nil
		for _, name := range []string{"compute/instance", "container", "vm"} {
			descriptor := schemaTestType(name, resource.SchemaBinding{State: "available", Revision: &schemaRev, Dialect: resource.DialectJSONSchema202012, Document: json.RawMessage(documents[name])}, true)
			if name == "compute/instance" {
				descriptor.IdentityDimensions = []resource.Dimension{{Name: "account"}}
				descriptor.QueryDimensions = []resource.Dimension{{Name: "account"}}
				for i := range descriptor.Capabilities {
					descriptor.Capabilities[i].Scope = resource.QueryScope{{Dimension: "account", Match: resource.ScopeAny}}
				}
			}
			catalog.Types = append(catalog.Types, descriptor)
		}
		catalog.Types = append(catalog.Types,
			schemaTestType("absent", resource.SchemaBinding{State: "absent"}, true),
			schemaTestType("unavailable", resource.SchemaBinding{State: "unavailable", UnavailableReason: &forbidden}, true),
			schemaTestType("unsupported", unsupportedDialectBinding(), true),
			schemaTestType("nodefault", inlineSchemaBinding(cloudDocument), false),
		)
		return catalog, nil
	}}
}

type authoringHarness struct {
	t       *testing.T
	ctrl    *controller
	wrapper *ServiceWrapper
	plugin  string
}

func newAuthoringHarness(t *testing.T, plugin string, provider resource.Provider) *authoringHarness {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, plugin, provider)
	return &authoringHarness{t: t, ctrl: ctrl, wrapper: &ServiceWrapper{Ctrl: ctrl, Realm: invocation.NewScope(invocation.TrustedUI)}, plugin: plugin}
}

func baseRequest(connection, typ, source string, cursor int, revision uint64) resourceauthoring.CompletionRequest {
	return resourceauthoring.CompletionRequest{
		Version: resourceauthoring.Version, RequestID: fmt.Sprintf("req-%d", revision), DocumentID: "doc-1", DocumentRevision: revision,
		Source: source, Cursor: resourceauthoring.Cursor{Offset: cursor, Unit: resourceauthoring.UnitUTF8Byte}, Profile: resourceauthoring.PredicateProfile,
		Target:         resourceauthoring.Target{Route: resource.AccessRoute{Connection: connection}, Type: typ, Scope: resource.QueryScope{}},
		MaxSuggestions: 128,
	}
}

// wire sends a request the way the Wails runtime does: encoded to JSON, decoded
// strictly by the DTO, answered, and the answer encoded and decoded again.
func (h *authoringHarness) wire(ctx context.Context, request resourceauthoring.CompletionRequest) (resourceauthoring.CompletionResponse, map[string]any, error) {
	h.t.Helper()
	encoded, err := json.Marshal(request)
	require.NoError(h.t, err)
	var decoded resourceauthoring.CompletionRequest
	require.NoError(h.t, json.Unmarshal(encoded, &decoded))
	response, err := h.wrapper.CompletePredicate(ctx, h.plugin, decoded)
	if err != nil {
		return response, nil, err
	}
	out, err := json.Marshal(response)
	require.NoError(h.t, err)
	require.LessOrEqual(h.t, len(out), resourceauthoring.DefaultPolicy().MaxResponseBytes, "bounded response")
	var generic map[string]any
	require.NoError(h.t, json.Unmarshal(out, &generic))
	var typed resourceauthoring.CompletionResponse
	require.NoError(h.t, json.Unmarshal(out, &typed))
	return typed, generic, nil
}

func (h *authoringHarness) complete(request resourceauthoring.CompletionRequest) resourceauthoring.CompletionResponse {
	h.t.Helper()
	response, _, err := h.wire(testInvocationContext(), request)
	require.NoError(h.t, err)
	return response
}

func labelsOf(items []resourceauthoring.Item) []string {
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = item.Label
	}
	return out
}

func at(source string) (string, int) {
	index := strings.Index(source, "‸")
	return source[:index] + source[index+len("‸"):], index
}

func (h *authoringHarness) completeSource(connection, typ, marked string, revision uint64) resourceauthoring.CompletionResponse {
	source, cursor := at(marked)
	return h.complete(baseRequest(connection, typ, source, cursor, revision))
}

func TestCompletePredicateOverTheServiceWrapper(t *testing.T) {
	h := newAuthoringHarness(t, "neutral", newAuthoringProvider("neutral").mock())

	response, generic, err := h.wire(testInvocationContext(), baseRequest("conn-1", "compute/instance", "resource.", 9, 1))
	require.NoError(t, err)
	assert.Equal(t, []string{"account", "id", "labels", "region", "state", "tags"}, labelsOf(response.Items))
	assert.Equal(t, resourceauthoring.Version, generic["version"])
	for _, member := range []string{"requestId", "documentId", "documentRevision", "cursor", "identity", "schema", "context", "items", "completion", "maxSuggestions"} {
		assert.Contains(t, generic, member, "the wire response carries %s", member)
	}
	identity := response.Identity
	assert.Equal(t, "neutral", identity.Plugin)
	assert.Equal(t, "conn-1", identity.Connection)
	assert.Equal(t, "compute/instance", identity.Type)
	assert.Equal(t, "native", identity.Representation)
	for name, value := range map[string]string{"catalog": identity.CatalogRevision, "representation": identity.RepresentationRevision, "schema": identity.SchemaRevision, "environment": identity.EnvironmentRevision, "access": identity.AccessGeneration, "scope": identity.ScopeKey} {
		assert.NotEmpty(t, value, name)
	}
	assert.Equal(t, "available", response.Schema.State)
	assert.Equal(t, "schemaChecked", response.Schema.HostEvaluation)
	for _, absent := range []string{"metadata", "namespace", "kind", "apiVersion", "spec", "status"} {
		assert.NotContains(t, labelsOf(response.Items), absent, "provider neutrality: no Kubernetes name is suggested")
	}

	// Cloud tag array, tag map, enum value and operators, all through the wire.
	tags := h.completeSource("conn-1", "compute/instance", "resource.tags[0].‸", 2)
	assert.Equal(t, []string{"key", "value"}, labelsOf(tags.Items))
	macro := h.completeSource("conn-1", "compute/instance", `resource.tags.exists(t, t.key == "env" && t.v‸`, 3)
	assert.Equal(t, []string{"value"}, labelsOf(macro.Items))
	state := h.completeSource("conn-1", "compute/instance", `resource.state == "ru‸`, 4)
	assert.Equal(t, []string{"running"}, labelsOf(state.Items))
	source, _ := at(`resource.state == "ru‸`)
	assert.Equal(t, `resource.state == "running"`, source[:state.Items[0].Edit.Start]+state.Items[0].Edit.Text+source[state.Items[0].Edit.End:])
	labels := h.completeSource("conn-1", "compute/instance", `resource.labels.‸`, 5)
	assert.Equal(t, "dynamic", labels.Context.Keys)
	operators := h.completeSource("conn-1", "compute/instance", `resource.region ‸`, 6)
	assert.Contains(t, labelsOf(operators.Items), "startsWith")

	// Container State, VM hardware, nested nullability and a oneOf boot source.
	status := h.completeSource("conn-1", "container", "resource.State.‸", 7)
	assert.Equal(t, []string{"ExitCode", "Running", "Status"}, labelsOf(status.Items))
	values := h.completeSource("conn-1", "container", "resource.State.Status == ‸", 8)
	assert.Equal(t, []string{"created", "running", "exited"}, labelsOf(values.Items))
	nic := h.completeSource("conn-1", "vm", "resource.hardware.nic.‸", 9)
	assert.Equal(t, []string{"mac"}, labelsOf(nic.Items))
	nullable := 0
	for _, ancestor := range nic.Context.Ancestors {
		if ancestor.Nullable == "yes" {
			nullable++
		}
	}
	assert.Equal(t, 1, nullable, "the nullable nic ancestor is reported")
	boot := h.completeSource("conn-1", "vm", "resource.boot.‸", 10)
	conditional := map[string]string{}
	for _, item := range boot.Items {
		conditional[item.Label] = item.Applicability + "/" + item.Checking
	}
	assert.Equal(t, map[string]string{"disk": "conditional/dynamic", "kind": "unconditional/dynamic", "url": "conditional/dynamic"}, conditional)

	// An unrelated type has no hardware: nothing is suggested, and that is complete.
	none := h.completeSource("conn-1", "container", "resource.hardware.‸", 11)
	assert.Empty(t, none.Items)
	assert.Equal(t, resourceauthoring.CompletionComplete, none.Completion.Kind)
	rootless := h.completeSource("conn-1", "vm", "hardware.cpu.co‸", 12)
	assert.Equal(t, "resource.hardware.cpu.cores", rootless.Items[0].Edit.Text)
}

func TestAuthoringSchemaStatesAndAdmission(t *testing.T) {
	h := newAuthoringHarness(t, "neutral", newAuthoringProvider("neutral").mock())
	absent := h.completeSource("c", "absent", "resource.‸", 1)
	assert.Equal(t, "absent", absent.Schema.State)
	assert.Equal(t, "dynamic", absent.Schema.HostEvaluation)
	assert.Empty(t, absent.Items)
	unsupported := h.completeSource("c", "unsupported", "resource.‸", 2)
	assert.Equal(t, "unsupported", unsupported.Schema.HostEvaluation)
	assert.Equal(t, "UNSUPPORTED", unsupported.Schema.HostEvaluationCode)
	assert.Empty(t, unsupported.Items)

	source, cursor := at("resource.‸")
	_, _, err := h.wire(testInvocationContext(), baseRequest("c", "unavailable", source, cursor, 3))
	require.Error(t, err)
	assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code, "a denied schema is a safe error, never an empty success")
	_, _, err = h.wire(testInvocationContext(), baseRequest("c", "missing", source, cursor, 4))
	assert.Equal(t, "NOT_FOUND", requireAppError(t, err).Code)
	_, _, err = h.wire(testInvocationContext(), baseRequest("c", "nodefault", source, cursor, 5))
	assert.Equal(t, "INVALID_REQUEST", requireAppError(t, err).Code)
	bad := baseRequest("c", "compute/instance", source, cursor, 6)
	bad.Target.Scope = resource.QueryScope{{Dimension: "tenant", Match: resource.ScopeAny}}
	_, _, err = h.wire(testInvocationContext(), bad)
	assert.Equal(t, "INVALID_REQUEST", requireAppError(t, err).Code, "an undeclared scope dimension is refused")
	invalid := baseRequest("c", "compute/instance", source, 3, 7)
	invalid.Source = "re\u96ea"
	invalid.Cursor.Offset = 3
	_, _, err = h.wire(testInvocationContext(), invalid)
	assert.Equal(t, "INVALID_REQUEST", requireAppError(t, err).Code, "a cursor inside a scalar is refused")
	// The Wails wrapper issues provenance from its realm; the controller alone refuses a bare context.
	_, err = h.ctrl.CompletePredicate(context.Background(), "neutral", baseRequest("c", "compute/instance", source, cursor, 8))
	require.Error(t, err)
	assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code, "an invocation without host provenance is denied")
}

// Provider, type, scope, declarations, schema, access and principal changes each
// reject a caller that still holds the previous identity, and a request without
// expectations resynchronizes.
func TestAuthoringIdentityChangesRejectStaleExpectations(t *testing.T) {
	provider := newAuthoringProvider("neutral")
	h := newAuthoringHarness(t, "neutral", provider.mock())
	source, cursor := at("resource.‸")
	first := h.complete(baseRequest("conn", "compute/instance", source, cursor, 1))
	expect := func(request resourceauthoring.CompletionRequest, identity resourceauthoring.Identity) resourceauthoring.CompletionRequest {
		request.CatalogRevision, request.RepresentationRevision, request.SchemaRevision = identity.CatalogRevision, identity.RepresentationRevision, identity.SchemaRevision
		request.EnvironmentRevision, request.AccessGeneration = identity.EnvironmentRevision, identity.AccessGeneration
		return request
	}
	rejected := func(request resourceauthoring.CompletionRequest, members ...string) {
		t.Helper()
		_, _, err := h.wire(testInvocationContext(), request)
		require.Error(t, err)
		app := requireAppError(t, err)
		assert.Equal(t, "RESET_REQUIRED", app.Code)
		for _, member := range members {
			assert.Contains(t, app.Detail, member)
		}
	}

	// Unchanged state: the expectations hold, with a newer document revision.
	steady := h.complete(expect(baseRequest("conn", "compute/instance", source, cursor, 2), first.Identity))
	assert.Equal(t, first.Identity, steady.Identity)

	// A different type under the same expectations.
	rejected(expect(baseRequest("conn", "container", source, cursor, 3), first.Identity), "environmentRevision")
	// Declaration types are part of the environment.
	withParameter := expect(baseRequest("conn", "compute/instance", source, cursor, 4), first.Identity)
	withParameter.Declarations = map[string]query.BindingType{"want": {Kind: "string"}}
	rejected(withParameter, "environmentRevision")
	// A different connection changes only what the access binds.
	otherConnection := h.complete(baseRequest("conn-2", "compute/instance", source, cursor, 5))
	assert.NotEqual(t, first.Identity.Connection, otherConnection.Identity.Connection)
	// A different scope is a different identity and an unknown dimension is refused.
	scoped := baseRequest("conn", "compute/instance", source, cursor, 6)
	scoped.Target.Scope = resource.QueryScope{{Dimension: "account", Match: resource.ScopeOneOf, Values: &[]string{"111"}}}
	scopedResponse := h.complete(scoped)
	assert.NotEqual(t, first.Identity.ScopeKey, scopedResponse.Identity.ScopeKey)
	sameScope := baseRequest("conn", "compute/instance", source, cursor, 7)
	sameScope.Target.Scope = resource.QueryScope{{Dimension: "account", Match: resource.ScopeOneOf, Values: &[]string{"111", "111"}}}
	assert.Equal(t, scopedResponse.Identity.ScopeKey, h.complete(sameScope).Identity.ScopeKey, "equal scopes have equal keys")

	// A provider that changes its schema: the old expectations are stale, a request
	// without them resynchronizes and sees the new schema.
	provider.mutate("c2", "schema:2", `{"type":"object","properties":{"zone":{"type":"string"}}}`)
	rejected(expect(baseRequest("conn", "compute/instance", source, cursor, 8), first.Identity), "catalogRevision", "schemaRevision", "environmentRevision")
	refreshed := h.complete(baseRequest("conn", "compute/instance", source, cursor, 9))
	assert.Equal(t, []string{"zone"}, labelsOf(refreshed.Items))
	assert.Equal(t, "schema:2", refreshed.Identity.SchemaRevision)
	assert.NotEqual(t, first.Identity.EnvironmentRevision, refreshed.Identity.EnvironmentRevision)
	assert.Equal(t, refreshed.Identity.AccessGeneration, first.Identity.AccessGeneration, "a schema change alone does not move the access generation")

	// A restarted provider generation moves the access generation.
	registerMockPlugin(h.ctrl, "neutral", provider.mock())
	restarted := baseRequest("conn", "compute/instance", source, cursor, 10)
	restarted.AccessGeneration = refreshed.Identity.AccessGeneration
	rejected(restarted, "accessGeneration")
	afterRestart := h.complete(baseRequest("conn", "compute/instance", source, cursor, 11))
	assert.NotEqual(t, refreshed.Identity.AccessGeneration, afterRestart.Identity.AccessGeneration)

	// Another principal has another access generation.
	other := &ServiceWrapper{Ctrl: h.ctrl, Realm: invocation.NewScope(invocation.TrustedUI)}
	request := baseRequest("conn", "compute/instance", source, cursor, 12)
	response, err := other.CompletePredicate(testInvocationContext(), "neutral", request)
	require.NoError(t, err)
	assert.NotEqual(t, afterRestart.Identity.AccessGeneration, response.Identity.AccessGeneration)

	// Another provider is another identity.
	second := newAuthoringProvider("other-provider")
	registerMockPlugin(h.ctrl, "second", second.mock())
	secondWrapper := &authoringHarness{t: t, ctrl: h.ctrl, wrapper: h.wrapper, plugin: "second"}
	switched := secondWrapper.complete(baseRequest("conn", "compute/instance", source, cursor, 13))
	assert.Equal(t, "second", switched.Identity.Plugin)
	assert.Equal(t, "other-provider", switched.Identity.Provider)
	assert.NotEqual(t, afterRestart.Identity.Provider, switched.Identity.Provider)
	crossed := expect(baseRequest("conn", "compute/instance", source, cursor, 14), afterRestart.Identity)
	_, _, err = secondWrapper.wire(testInvocationContext(), crossed)
	require.Error(t, err)
	assert.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code, "expectations from one provider never apply to another")
}

// A burst of document revisions keeps one request in flight per document: the
// older request is cancelled, a late older revision is refused, and the registry
// stays bounded.
func TestRapidDocumentChangesAreSupersededThroughTheTransport(t *testing.T) {
	provider := newAuthoringProvider("neutral")
	h := newAuthoringHarness(t, "neutral", provider.mock())
	source, cursor := at("resource.‸")
	entered := make(chan struct{})
	var calls atomic.Int32
	provider.before = func(ctx context.Context) error {
		if calls.Add(1) == 1 {
			close(entered)
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}

	type result struct {
		response resourceauthoring.CompletionResponse
		err      error
	}
	slow := make(chan result, 1)
	go func() {
		response, _, err := h.wire(testInvocationContext(), baseRequest("conn", "compute/instance", source, cursor, 1))
		slow <- result{response, err}
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the first request never reached the provider")
	}
	newer := h.complete(baseRequest("conn", "compute/instance", source, cursor, 2))
	assert.Equal(t, uint64(2), newer.DocumentRevision)
	select {
	case got := <-slow:
		require.Error(t, got.err)
		assert.Equal(t, "CANCELLED", requireAppError(t, got.err).Code, "the older request is cancelled by the newer")
		assert.True(t, errors.Is(got.err, resourceauthoring.ErrSuperseded), "and says why")
	case <-time.After(5 * time.Second):
		t.Fatal("the superseded request was not cancelled")
	}
	_, _, err := h.wire(testInvocationContext(), baseRequest("conn", "compute/instance", source, cursor, 1))
	require.Error(t, err)
	assert.Equal(t, "CANCELLED", requireAppError(t, err).Code)
	assert.True(t, errors.Is(err, resourceauthoring.ErrStaleRevision), "a late older revision is refused")

	// A burst on several documents: every answer is for its own revision, every
	// failure is a supersession or a stale refusal, and the registry stays small.
	provider.before = nil
	const documents, revisions = 3, 60
	var group sync.WaitGroup
	var served, cancelled atomic.Int32
	for doc := range documents {
		for rev := 1; rev <= revisions; rev++ {
			group.Add(1)
			go func() {
				defer group.Done()
				time.Sleep(time.Duration(rand.IntN(300)) * time.Microsecond)
				request := baseRequest("conn", "compute/instance", source, cursor, uint64(rev))
				request.DocumentID = fmt.Sprintf("burst-%d", doc)
				response, _, err := h.wire(testInvocationContext(), request)
				if err != nil {
					assert.Equal(t, "CANCELLED", requireAppError(t, err).Code)
					cancelled.Add(1)
					return
				}
				assert.Equal(t, uint64(rev), response.DocumentRevision, "a response answers its own revision")
				assert.Equal(t, request.RequestID, response.RequestID)
				assert.Equal(t, request.DocumentID, response.DocumentID)
				served.Add(1)
			}()
		}
	}
	group.Wait()
	assert.Positive(t, served.Load())
	sessions, policy := h.ctrl.authoring.use()
	assert.LessOrEqual(t, sessions.Len(), policy.MaxDocuments)
	assert.LessOrEqual(t, sessions.Len(), documents+1, "one record per document, not per keystroke")
	t.Logf("burst: %d served, %d cancelled or refused", served.Load(), cancelled.Load())
}

func TestAuthoringDeadlineAndCancellation(t *testing.T) {
	provider := newAuthoringProvider("neutral")
	h := newAuthoringHarness(t, "neutral", provider.mock())
	h.ctrl.authoring.policy = resourceauthoring.DefaultPolicy()
	h.ctrl.authoring.policy.Deadline = 100 * time.Millisecond
	source, cursor := at("resource.‸")
	provider.before = func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }

	start := time.Now()
	_, _, err := h.wire(testInvocationContext(), baseRequest("conn", "compute/instance", source, cursor, 1))
	require.Error(t, err)
	assert.Equal(t, "TIMEOUT", requireAppError(t, err).Code, "a slow provider ends at the request deadline, never a false success")
	assert.Less(t, time.Since(start), 3*time.Second)

	cancelled, cancel := context.WithCancel(testInvocationContext())
	go func() { time.Sleep(20 * time.Millisecond); cancel() }()
	other := baseRequest("conn", "compute/instance", source, cursor, 2)
	other.DocumentID = "doc-cancel"
	_, _, err = h.wire(cancelled, other)
	require.Error(t, err)
	assert.Equal(t, "CANCELLED", requireAppError(t, err).Code, "a client cancel returns no suggestions")
}

func TestAuthoringResponseIsBoundedForLargeSchemas(t *testing.T) {
	var wide strings.Builder
	wide.WriteString(`{"type":"object","properties":{`)
	for i := range 600 {
		if i > 0 {
			wide.WriteString(",")
		}
		fmt.Fprintf(&wide, `"field%03d":{"type":"string","description":%q}`, i, strings.Repeat("long description ", 40))
	}
	wide.WriteString(`}}`)
	provider := newAuthoringProvider("neutral")
	provider.mutate("c1", "schema:1", wide.String())
	h := newAuthoringHarness(t, "neutral", provider.mock())
	response := h.completeSource("conn", "compute/instance", "resource.‸", 1)
	assert.LessOrEqual(t, len(response.Items), 128)
	assert.Equal(t, resourceauthoring.CompletionTruncated, response.Completion.Kind)
	assert.NotEmpty(t, response.Completion.Reason)
	small := baseRequest("conn", "compute/instance", "resource.", 9, 2)
	small.MaxSuggestions = 5
	limited := h.complete(small)
	assert.Len(t, limited.Items, 5)
	assert.Equal(t, 5, limited.MaxSuggestions)
	huge := baseRequest("conn", "compute/instance", "resource.", 9, 3)
	huge.MaxSuggestions = 1 << 20
	assert.Equal(t, 128, h.complete(huge).MaxSuggestions, "a request cannot raise the host ceiling")
}

// The SDK conformance child serves the provider-neutral P44 corpus over real
// gRPC: bundled and by-reference schemas, absent, unavailable and unsupported
// states, and an OpenAPI VM schema with unions. Completion runs against the real
// catalog normalization of those documents.
func TestActualSDKChildCompletion(t *testing.T) {
	binary := compileNativeChild(t)
	provider, _, stop := startNativeChild(t, binary, "read-only")
	defer stop()
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, nativeChildPluginID, provider)
	h := &authoringHarness{t: t, ctrl: ctrl, wrapper: &ServiceWrapper{Ctrl: ctrl, Realm: invocation.NewScope(invocation.TrustedUI)}, plugin: nativeChildPluginID}
	ctx := testInvocationContext()
	typeOf := func(connection string) string {
		_, err := ctrl.StartConnection(ctx, nativeChildPluginID, connection)
		require.NoError(t, err)
		catalog, err := ctrl.Catalog(ctx, nativeChildPluginID, resource.CatalogRequest{Route: resource.AccessRoute{Connection: connection}})
		require.NoError(t, err)
		require.Len(t, catalog.Types, 1)
		return catalog.Types[0].Type
	}
	var revision uint64
	complete := func(connection, marked string) resourceauthoring.CompletionResponse {
		revision++
		return h.completeSource(connection, typeOf(connection), marked, revision)
	}
	neutral := []string{"metadata", "namespace", "kind", "apiVersion", "spec", "status"}

	cloud := complete("cloud-bundled-pages", "resource.‸")
	assert.Equal(t, []string{"account", "createdAt", "description", "id", "region", "sizeBytes", "tags"}, labelsOf(cloud.Items))
	for _, name := range neutral {
		assert.NotContains(t, labelsOf(cloud.Items), name)
	}
	assert.Equal(t, []string{"key", "value"}, labelsOf(complete("cloud-bundled-pages", "resource.tags[0].‸").Items))
	assert.Equal(t, []string{"key", "value"}, labelsOf(complete("cloud-bundled-pages", "resource.tags.exists(t, t.‸").Items))
	byName := map[string]resourceauthoring.Item{}
	for _, item := range cloud.Items {
		byName[item.Label] = item
	}
	assert.Equal(t, "partial", byName["createdAt"].Checking)
	assert.Equal(t, "dynamic", byName["description"].Checking)
	assert.Equal(t, "yes", byName["description"].Nullable)
	assert.Empty(t, complete("cloud-bundled-pages", "spec.con‸").Items, "a cloud type has no spec")
	assert.Contains(t, labelsOf(complete("cloud-bundled-pages", "resource.description ‸").Items), "== null")

	discovered := complete("cloud-discovered-schema", "resource.‸")
	assert.Equal(t, labelsOf(cloud.Items), labelsOf(discovered.Items), "a schema delivered by reference completes like the bundled one")
	assert.NotEmpty(t, discovered.Identity.SchemaRevision)
	assert.NotEqual(t, cloud.Identity.AccessGeneration, discovered.Identity.AccessGeneration, "each connection has its own access")
	assert.NotEqual(t, cloud.Identity.Connection, discovered.Identity.Connection)

	absent := complete("cloud-absent-schema", "resource.‸")
	assert.Equal(t, "dynamic", absent.Schema.HostEvaluation)
	assert.Empty(t, absent.Items)
	unsupported := complete("container-unsupported-dialect", "resource.‸")
	assert.Equal(t, "unsupported", unsupported.Schema.HostEvaluation)
	assert.Empty(t, unsupported.Items)
	revision++
	unavailableType := typeOf("cloud-unavailable-schema")
	source, cursor := at("resource.‸")
	_, _, err := h.wire(ctx, baseRequest("cloud-unavailable-schema", unavailableType, source, cursor, revision))
	require.Error(t, err)
	assert.Equal(t, "FORBIDDEN", requireAppError(t, err).Code, "a forbidden schema is denied, not an empty success")

	container := complete("container-bundled-events", "resource.‸")
	assert.Equal(t, []string{"engine", "generation", "id", "labels", "revision", "state"}, labelsOf(container.Items))
	assert.Equal(t, "dynamic", complete("container-bundled-events", "resource.labels.‸").Context.Keys)
	for _, name := range neutral {
		assert.NotContains(t, labelsOf(container.Items), name)
	}

	vms := complete("hypervisor-bundled-vms", "resource.‸")
	assert.Equal(t, []string{"disks", "host", "name", "node", "vmid"}, labelsOf(vms.Items))
	assert.Contains(t, labelsOf(complete("hypervisor-bundled-vms", "resource.disks[0] ‸").Items), "==")

	placement := complete("hypervisor-openapi-vms", "resource.placement.‸")
	conditional := map[string]string{}
	for _, item := range placement.Items {
		conditional[item.Label] = item.Applicability
	}
	assert.Equal(t, map[string]string{"cores": "conditional", "pool": "unconditional", "sizeGiB": "conditional"}, conditional)
	assert.Equal(t, []string{"bridged", "routed"}, labelsOf(complete("hypervisor-openapi-vms", "resource.network.mode == ‸").Items))
	assert.Equal(t, []string{"bridge", "mode"}, labelsOf(complete("hypervisor-openapi-vms", "resource.network.‸").Items))
}
