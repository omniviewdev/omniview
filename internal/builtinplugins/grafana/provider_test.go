package grafana

import (
	"context"
	"encoding/json"
	"fmt"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fixtureProvider(t *testing.T, endpoint string) *Provider {
	t.Helper()
	dir := t.TempDir()
	p := NewProvider(func() (*os.Root, error) { return os.OpenRoot(dir) })
	t.Cleanup(func() { _ = p.Close() })
	secret := "private-token"
	_, err := p.SaveProviderConnection(nil, metric.ProviderConnectionInput{Connection: metric.ProviderConnection{ID: "test", Name: "test", Kind: "prometheus", URL: endpoint, PublicConfig: map[string]string{"credentialKind": "prometheus-token", "allowInsecureHTTP": "true"}}, Credential: &secret})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMixedCaseHTTPRequiresExplicitOptIn(t *testing.T) {
	for _, endpoint := range []string{"HTTP://127.0.0.1:1", "HtTp://127.0.0.1:1"} {
		for _, username := range []string{"", "basic-user"} {
			t.Run(endpoint+"/"+username, func(t *testing.T) {
				dir := t.TempDir()
				p := NewProvider(func() (*os.Root, error) { return os.OpenRoot(dir) })
				defer p.Close()
				secret := "private-token"
				input := metric.ProviderConnectionInput{Connection: metric.ProviderConnection{ID: "test", Name: "test", Kind: "prometheus", URL: endpoint, PublicConfig: map[string]string{"credentialKind": "prometheus-token", "username": username}}, Credential: &secret}
				if _, err := p.SaveProviderConnection(nil, input); err == nil {
					t.Fatal("mixed-case plaintext endpoint accepted without opt-in")
				}
				input.Connection.PublicConfig["allowInsecureHTTP"] = "true"
				if _, err := p.SaveProviderConnection(nil, input); err != nil {
					t.Fatal(err)
				}
				tr, err := p.connection("test")
				if err != nil || tr.endpoint.Scheme != "http" {
					t.Fatalf("opted-in normalized transport unavailable: %v", err)
				}
			})
		}
	}
}

func TestPersistedHTTPPolicyUsesParsedScheme(t *testing.T) {
	p := fixtureProvider(t, "HTTP://127.0.0.1:1")
	saved := p.connections["test"]
	delete(saved.Public.PublicConfig, "allowInsecureHTTP")
	p.connections["test"] = saved
	if _, err := p.connection("test"); err == nil {
		t.Fatal("persisted plaintext endpoint bypassed activation policy")
	}
}

func TestCloudBasicCredentialsRequireParsedHTTPS(t *testing.T) {
	for _, endpoint := range []string{"HTTP://127.0.0.1:1", "HtTp://127.0.0.1:1"} {
		c := metric.ProviderConnection{Kind: "prometheus", URL: endpoint, PublicConfig: map[string]string{"credentialKind": "cloud-access-policy", "username": "instance", "allowInsecureHTTP": "true"}}
		if _, err := newProviderTransport(c, "private-token"); err == nil {
			t.Fatal("cloud basic credential accepted over plaintext")
		}
	}
	c := metric.ProviderConnection{Kind: "prometheus", URL: "HTTPS://example.invalid", PublicConfig: map[string]string{"credentialKind": "cloud-access-policy", "username": "instance"}}
	tr, err := newProviderTransport(c, "private-token")
	if err != nil {
		t.Fatal(err)
	}
	tr.close()
}
func fixtureQuery(p *Provider) metric.ResourceMetricsQuery {
	bindings := []metric.MetricFieldBinding{
		{Field: "fleet", Label: "fleet", Source: "scope", Required: true},
		{Field: "division", Label: "division", Source: "resource", ResourcePath: "/organization/division", Required: true},
		{Field: "machine", Label: "machine", Source: "resource", ResourcePath: "/identity/serial", Required: true},
	}
	base := metric.MetricDefinition{ID: "example.machine.load", Name: "Load", ResourceKeys: []string{"example:/machines"}, Unit: "count", Semantics: "gauge", QueryLanguage: "promql", Query: `machine_load{fleet=~"{{fleet}}",division=~"{{division}}",machine=~"{{machine}}"}`, FieldBindings: bindings, IdentityLabels: []string{"fleet", "division", "machine"}, Reducer: "none", BatchStrategy: "identity", SupportedShapes: []string{"current", "range"}}
	memory := base
	memory.ID, memory.Name, memory.Unit = "example.machine.capacity", "Capacity", "bytes"
	memory.Query = `machine_capacity_bytes{fleet=~"{{fleet}}",division=~"{{division}}",machine=~"{{machine}}"}`
	q := metric.ResourceMetricsQuery{Source: metric.MetricSourceRef{PluginID: "grafana", ConnectionID: "test", DatasourceKind: "prometheus", DatasourceUID: "direct"}, MetricIDs: []string{base.ID, memory.ID}, Shape: "current", Context: metric.MetricQueryContext{Definitions: []metric.MetricDefinition{base, memory}, PublicScope: map[string]string{"fleet": "fleet-a"}}}
	for i := range 24 {
		q.Targets = append(q.Targets, metric.ResourceMetricTarget{Token: fmt.Sprint(i), Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "example", Authority: "host-owner", Type: "example:/machines", ID: fmt.Sprintf("opaque-%d", i)}}, Route: resourcev2.AccessRoute{Connection: "owner-not-source"}, PublicData: map[string]string{"division": "division-a", "machine": fmt.Sprintf("serial-%d", i)}})
	}
	return q
}
func TestFiniteBatchAndSourceAuthentication(t *testing.T) {
	var calls atomic.Int32
	now := time.Now().Truncate(time.Second)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer private-token" {
			t.Error("source credentials missing")
		}
		if r.URL.Path != "/api/v1/query" {
			t.Error(r.URL.Path)
		}
		var results []any
		for i := range 24 {
			results = append(results, map[string]any{"metric": map[string]string{"fleet": "fleet-a", "division": "division-a", "machine": fmt.Sprintf("serial-%d", i)}, "value": []any{now.Unix(), "2"}})
		}
		results = append(results, map[string]any{"metric": map[string]string{"fleet": "other", "division": "division-a", "machine": "serial-0"}, "value": []any{now.Unix(), "999"}})
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "vector", "result": results}})
	}))
	defer server.Close()
	p := fixtureProvider(t, server.URL)
	q := fixtureQuery(p)
	out, err := p.QueryResources(&types.PluginContext{Context: context.Background()}, q)
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || len(out.Results) != 48 || !out.Complete {
		t.Fatalf("calls=%d results=%d complete=%v", calls.Load(), len(out.Results), out.Complete)
	}
	for _, r := range out.Results {
		if r.Status != "ok" || r.Value == nil || *r.Value != 2 || r.ObservedAt != nil {
			t.Fatalf("bad result: %+v", r)
		}
	}
}
func TestPrivateStoreAndGenerationRetirement(t *testing.T) {
	p := fixtureProvider(t, "http://127.0.0.1:1")
	first, err := p.connection("test")
	if err != nil {
		t.Fatal(err)
	}
	second, _ := p.connection("test")
	if first.client != second.client {
		t.Fatal("connection generation did not pool transport")
	}
	public, err := p.GetProviderConnections(nil)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(public)
	if strings.Contains(string(encoded), "private-token") {
		t.Fatal("secret leaked")
	}
	root, err := p.privateRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	info, err := root.Stat("connections.json")
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("private mode: %v %v", info, err)
	}
	if err := p.DeleteProviderConnection(nil, "test"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-first.generation.Done():
	default:
		t.Fatal("deleted generation not canceled")
	}
}
func TestExactIdentityAndIncarnationProjection(t *testing.T) {
	p := NewProvider(nil)
	defer p.Close()
	q := fixtureQuery(p)
	d := q.Context.Definitions[0]
	d.FieldBindings = append(d.FieldBindings, metric.MetricFieldBinding{Field: "generation", Label: "generation", Source: "resource", ResourcePath: "/identity/generation", Required: true})
	d.IdentityLabels = append(d.IdentityLabels, "generation")
	d.Query = strings.Replace(d.Query, "machine_load{", `machine_load{generation=~"{{generation}}",`, 1)
	uid := "generation-a"
	q.Targets[0].Reference.Incarnation = &uid
	q.Targets[0].PublicData["generation"] = uid
	expression, ids, err := compile(d, q.Targets[:1], q.Context.PublicScope)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(expression, "serial-0") || strings.Contains(expression, "opaque-0") {
		t.Fatalf("query did not use projected identity: %s", expression)
	}
	key, _ := identity(map[string]string{"fleet": "fleet-a", "division": "division-a", "machine": "serial-0", "generation": "generation-b"}, d.IdentityLabels)
	if _, ok := ids[key]; ok {
		t.Fatal("wrong incarnation joined")
	}
	delete(q.Targets[0].PublicData, "generation")
	if _, _, err := compile(d, q.Targets[:1], q.Context.PublicScope); err == nil {
		t.Fatal("reference incarnation substituted for missing projection")
	}
}

func TestRangeSamplesAndAmbiguity(t *testing.T) {
	for _, duplicate := range []bool{false, true} {
		t.Run(fmt.Sprint(duplicate), func(t *testing.T) {
			end := time.Now().Add(-time.Minute).Truncate(time.Second)
			start := end.Add(-time.Minute)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v1/query_range" {
					t.Error(r.URL.Path)
				}
				sample := map[string]any{"metric": map[string]string{"fleet": "fleet-a", "division": "division-a", "machine": "serial-0"}, "values": []any{[]any{start.Unix(), "1"}, []any{end.Unix(), "3"}}}
				series := []any{sample}
				if duplicate {
					series = append(series, sample)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "matrix", "result": series}})
			}))
			defer server.Close()
			p := fixtureProvider(t, server.URL)
			q := fixtureQuery(p)
			q.Targets = q.Targets[:1]
			q.MetricIDs = q.MetricIDs[:1]
			q.Shape = "range"
			q.StartTime = start
			q.EndTime = end
			q.Step = time.Minute
			out, err := p.QueryResources(&types.PluginContext{Context: context.Background()}, q)
			if err != nil {
				t.Fatal(err)
			}
			result := out.Results[0]
			if duplicate {
				if result.Status != "ambiguous" || len(result.Points) != 0 || result.Value != nil {
					t.Fatalf("%+v", result)
				}
				return
			}
			if result.Status != "ok" || len(result.Points) != 2 || !result.Points[0].Time.Equal(start) || !result.Points[1].Time.Equal(end) {
				t.Fatalf("%+v", result)
			}
		})
	}
}

func TestDeniedAndShutdownCancellation(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done(); close(cancelled) }))
	defer server.Close()
	p := fixtureProvider(t, server.URL)
	q := fixtureQuery(p)
	q.Targets = q.Targets[:1]
	q.MetricIDs = q.MetricIDs[:1]
	finished := make(chan error, 1)
	go func() {
		_, err := p.QueryResources(&types.PluginContext{Context: context.Background()}, q)
		finished <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("request did not start")
	}
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("shutdown did not cancel query")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("query did not finish")
	}
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream request not canceled")
	}
	denied := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusForbidden) }))
	defer denied.Close()
	p2 := fixtureProvider(t, denied.URL)
	q2 := fixtureQuery(p2)
	q2.Targets = q2.Targets[:1]
	q2.MetricIDs = q2.MetricIDs[:1]
	out, err := p2.QueryResources(&types.PluginContext{Context: context.Background()}, q2)
	if err != nil {
		t.Fatal(err)
	}
	if out.Results[0].Status != "denied" || out.Results[0].Value != nil {
		t.Fatalf("%+v", out)
	}
}

func TestResourceBindingsRequireExplicitProjection(t *testing.T) {
	q := fixtureQuery(nil)
	for _, field := range []string{"pod", "namespace", "name", "id", "uid", "key", "resource_key"} {
		t.Run(field, func(t *testing.T) {
			binding := metric.MetricFieldBinding{Field: field, Label: field, Source: "resource", ResourcePath: "/public/value", Required: true}
			target := q.Targets[0]
			incarnation := "reference-incarnation"
			target.Reference.Incarnation = &incarnation
			target.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "reference-scope"}}
			if _, err := fieldValue(binding, target, q.Context.PublicScope); err == nil {
				t.Fatal("unprojected identity inferred from reference")
			}
			target.PublicData = map[string]string{field: "projected-value"}
			if value, err := fieldValue(binding, target, q.Context.PublicScope); err != nil || value != "projected-value" {
				t.Fatalf("value=%q err=%v", value, err)
			}
		})
	}
	d := q.Context.Definitions[0]
	d.FieldBindings = append([]metric.MetricFieldBinding(nil), d.FieldBindings...)
	d.FieldBindings[1].ResourcePath = ""
	if err := definitionError(d); err == nil {
		t.Fatal("resource binding without explicit path accepted")
	}
}

func TestDirectDatasourceInfersKindWithoutChangingIdentity(t *testing.T) {
	p := fixtureProvider(t, "http://127.0.0.1:1")
	source := metric.MetricSourceRef{PluginID: "grafana", ConnectionID: "test", DatasourceUID: "direct"}
	sources, err := p.GetDataSources(nil, source)
	if err != nil || len(sources) != 1 || sources[0].UID != "direct" || sources[0].Kind != "prometheus" {
		t.Fatalf("sources=%+v err=%v", sources, err)
	}
	source.DatasourceKind = "loki"
	if _, err := p.GetDataSources(nil, source); err == nil {
		t.Fatal("mismatched explicit kind accepted")
	}
	source.DatasourceKind = ""
	source.DatasourceUID = "other"
	if _, err := p.GetDataSources(nil, source); err == nil {
		t.Fatal("different direct datasource identity accepted")
	}
}

func TestCatalogUsesOnlyInjectedDefinitions(t *testing.T) {
	p := fixtureProvider(t, "http://127.0.0.1:1")
	q := fixtureQuery(p)
	request := metric.ResourceMetricsCatalogRequest{Source: q.Source, ResourceKey: "example:/machines", Context: q.Context}
	catalog, err := p.GetResourceMetricsCatalog(nil, request)
	if err != nil || len(catalog.Metrics) != 2 {
		t.Fatalf("catalog=%+v err=%v", catalog, err)
	}
	request.Context.Definitions = nil
	catalog, err = p.GetResourceMetricsCatalog(nil, request)
	if err != nil || len(catalog.Metrics) != 0 {
		t.Fatalf("unrequested defaults returned: catalog=%+v err=%v", catalog, err)
	}
	request.Source.Native = true
	if _, err := p.GetResourceMetricsCatalog(nil, request); err == nil {
		t.Fatal("native source accepted by external provider")
	}
}

func TestMissingProjectedIdentityDoesNotQuery(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		t.Error("missing projection reached upstream")
	}))
	defer server.Close()
	p := fixtureProvider(t, server.URL)
	q := fixtureQuery(p)
	q.Targets = q.Targets[:1]
	q.MetricIDs = q.MetricIDs[:1]
	delete(q.Targets[0].PublicData, "machine")
	out, err := p.QueryResources(&types.PluginContext{Context: context.Background()}, q)
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 || len(out.Results) != 1 || out.Results[0].Status != "invalid_context" || out.Results[0].Value != nil {
		t.Fatalf("calls=%d response=%+v", calls.Load(), out)
	}
}
