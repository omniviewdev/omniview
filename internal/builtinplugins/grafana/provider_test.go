package grafana

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

func testProvider(t *testing.T) *Provider {
	t.Helper()
	dir := t.TempDir()
	return NewProvider(func() (*os.Root, error) { return os.OpenRoot(dir) })
}
func saveTestConnection(t *testing.T, p *Provider, url, kind, id, token string) {
	t.Helper()
	auth := "prometheus-token"
	if kind == "grafana" {
		auth = "grafana-service-account"
	}
	_, err := p.SaveProviderConnection(&metric.QueryContext{Context: context.Background()}, metric.ProviderConnectionInput{Connection: metric.ProviderConnection{ID: id, Name: id, Kind: kind, URL: url, PublicConfig: map[string]string{"credentialKind": auth, "allowInsecureHTTP": "true"}}, Credential: &token})
	if err != nil {
		t.Fatal(err)
	}
}
func testRequest(p *Provider, n int) metric.ResourceSetQueryRequest {
	defs, _ := p.GetMetricDefinitions(nil)
	r := metric.ResourceSetQueryRequest{ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster-owner", Source: metric.MetricSourceReference{PluginID: "grafana", ConnectionID: "one", DatasourceUID: "direct", DatasourceKind: "prometheus"}, MetricIDs: []string{"cpu_usage", "memory_usage"}, Definitions: defs, PublicScope: map[string]string{"cluster": "test"}, EndTime: time.Now()}
	for i := range n {
		r.Resources = append(r.Resources, metric.MetricResource{Token: fmt.Sprint(i), ResourceID: fmt.Sprintf("pod-%d", i), ResourceNamespace: "default", ResourceKey: "k8s:/pods"})
	}
	return r
}
func TestHTTPResourceSetBothTransports(t *testing.T) {
	for _, kind := range []string{"prometheus", "grafana"} {
		t.Run(kind, func(t *testing.T) {
			var count atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				count.Add(1)
				if r.Header.Get("Authorization") != "Bearer private-one" {
					t.Error("credential missing")
				}
				expected := "/api/v1/query"
				if kind == "grafana" {
					expected = "/api/datasources/proxy/uid/manual-uid/api/v1/query"
				}
				if r.URL.Path != expected {
					t.Errorf("wrong path %s", r.URL.Path)
				}
				result := []any{}
				for i := 0; i < 24; i++ {
					result = append(result, map[string]any{"metric": map[string]string{"cluster": "test", "namespace": "default", "pod": fmt.Sprintf("pod-%d", i)}, "value": []any{float64(time.Now().Unix()), "1.5"}})
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "vector", "result": result}})
			}))
			defer s.Close()
			p := testProvider(t)
			defer p.Close()
			saveTestConnection(t, p, s.URL, kind, "one", "private-one")
			req := testRequest(p, 24)
			if kind == "grafana" {
				req.Source.DatasourceUID = "manual-uid"
			}
			out, err := p.QueryResources(&metric.QueryContext{Context: context.Background(), ConnectionID: "one"}, req)
			if err != nil {
				t.Fatal(err)
			}
			if count.Load() != 2 || len(out.Results) != 48 {
				t.Fatalf("expressions=%d results=%d", count.Load(), len(out.Results))
			}
			for _, r := range out.Results {
				if r.Status != metric.MetricStatusOK || r.Value.CurrentValue.Value != 1.5 {
					t.Fatalf("unexpected result %+v", r)
				}
			}
		})
	}
}
func TestEscapingAndMissingScope(t *testing.T) {
	p := testProvider(t)
	defs, _ := p.GetMetricDefinitions(nil)
	req := testRequest(p, 1)
	req.Resources[0].ResourceID = `pod.+"\\|x`
	q, _, err := compile(defs[0], req.Resources, req.PublicScope)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(q, `pod\\.\\+\"`) {
		t.Fatalf("missing separate regex and string escaping: %s", q)
	}
	delete(req.PublicScope, "cluster")
	if _, _, err = compile(defs[0], req.Resources, req.PublicScope); err == nil {
		t.Fatal("missing cluster admitted")
	}
}
func TestPodPresetsPreserveScopedIdentity(t *testing.T) {
	p := testProvider(t)
	defer p.Close()
	definitions, err := p.GetMetricDefinitions(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(definitions) > 32 {
		t.Fatalf("catalog exceeds single-query metric cap: %d", len(definitions))
	}
	resources := []metric.MetricResource{
		{Token: "first", ResourceID: `pod.+`, ResourceNamespace: "first", ResourceKey: "k8s:/pods"},
		{Token: "second", ResourceID: `pod.+`, ResourceNamespace: "second", ResourceKey: "k8s:/pods"},
	}
	seen := make(map[string]bool, len(definitions))
	for _, definition := range definitions {
		if seen[definition.ID] {
			t.Fatalf("duplicate preset ID %s", definition.ID)
		}
		seen[definition.ID] = true
		_, identities, err := compile(definition, resources, map[string]string{"cluster": "test"})
		if err != nil {
			t.Fatalf("%s: %v", definition.ID, err)
		}
		tokens := map[string]bool{}
		for _, token := range identities {
			tokens[token] = true
		}
		if len(identities) != 2 || !tokens["first"] || !tokens["second"] {
			t.Fatalf("%s merged same-name Pods across namespaces: %v", definition.ID, identities)
		}
		if _, _, err := compile(definition, resources, nil); err == nil {
			t.Fatalf("%s admitted missing cluster scope", definition.ID)
		}
	}
}

func TestCredentialsIsolationPersistenceAndPublicDTO(t *testing.T) {
	p := testProvider(t)
	var tokens []string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokens = append(tokens, r.Header.Get("Authorization"))
		fmt.Fprint(w, `{"status":"success","data":{"resultType":"vector","result":[]}}`)
	}))
	defer s.Close()
	saveTestConnection(t, p, s.URL, "prometheus", "one", "secret-one")
	saveTestConnection(t, p, s.URL, "prometheus", "two", "secret-two")
	for _, id := range []string{"one", "two"} {
		tr, err := p.connection(id)
		if err != nil {
			t.Fatal(err)
		}
		_, err = tr.query(context.Background(), "direct", "vector(1)", time.Time{}, time.Now(), 0, false)
		tr.close()
		if err != nil {
			t.Fatal(err)
		}
	}
	if strings.Join(tokens, ",") != "Bearer secret-one,Bearer secret-two" {
		t.Fatalf("credential isolation failed %v", tokens)
	}
	list, err := p.GetProviderConnections(nil)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(list)
	if strings.Contains(string(data), "secret-") {
		t.Fatal("secret exposed")
	}
	root, err := p.privateRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	info, err := root.Stat("connections.json")
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("private mode not preserved", err)
	}
	q := NewProvider(p.openState)
	got, err := q.GetProviderConnections(nil)
	if err != nil || len(got) != 2 || !got[0].HasCredentials {
		t.Fatal("private persistence failed", err)
	}
}
func TestDeniedMissingDuplicateAndNonfinite(t *testing.T) {
	for _, scenario := range []string{"denied", "missing", "duplicate", "nonfinite"} {
		t.Run(scenario, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if scenario == "denied" {
					w.WriteHeader(403)
					fmt.Fprint(w, "private-secret")
					return
				}
				rows := []any{}
				row := func(value string) any {
					return map[string]any{"metric": map[string]string{"cluster": "test", "namespace": "default", "pod": "pod-0"}, "value": []any{time.Now().Unix(), value}}
				}
				switch scenario {
				case "duplicate":
					rows = append(rows, row("1"), row("2"))
				case "nonfinite":
					rows = append(rows, row("NaN"))
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "vector", "result": rows}})
			}))
			defer s.Close()
			p := testProvider(t)
			saveTestConnection(t, p, s.URL, "prometheus", "one", "token")
			req := testRequest(p, 1)
			out, err := p.QueryResources(&metric.QueryContext{Context: context.Background(), ConnectionID: "one"}, req)
			if err != nil {
				t.Fatal(err)
			}
			expected := metric.MetricStatusFailed
			if scenario == "denied" {
				expected = metric.MetricStatusDenied
			}
			if scenario == "missing" {
				expected = metric.MetricStatusMissing
			}
			for _, r := range out.Results {
				if r.Status != expected || r.Value != nil {
					t.Fatalf("unexpected result %+v", r)
				}
				if strings.Contains(strings.Join(r.Warnings, " "), "private-secret") {
					t.Fatal("response secret leaked")
				}
			}
		})
	}
}
func TestRedirectAndTLSRejected(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("redirect followed") }))
	defer target.Close()
	redirect := httptest.NewServer(http.RedirectHandler(target.URL, http.StatusFound))
	defer redirect.Close()
	tr, _ := newTransport(redirect.URL, "prometheus", "private", "")
	defer tr.close()
	if _, err := tr.query(context.Background(), "direct", "vector(1)", time.Time{}, time.Now(), 0, false); err == nil {
		t.Fatal("redirect accepted")
	}
	tls := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer tls.Close()
	secure, _ := newTransport(tls.URL, "prometheus", "private", "")
	defer secure.close()
	if _, err := secure.query(context.Background(), "direct", "vector(1)", time.Time{}, time.Now(), 0, false); err == nil {
		t.Fatal("untrusted certificate accepted")
	}
}
func TestResourceChunkBound(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fmt.Fprint(w, `{"status":"success","data":{"resultType":"vector","result":[]}}`)
	}))
	defer s.Close()
	p := testProvider(t)
	saveTestConnection(t, p, s.URL, "prometheus", "one", "")
	req := testRequest(p, 101)
	_, err := p.QueryResources(&metric.QueryContext{Context: context.Background(), ConnectionID: "one"}, req)
	if err != nil || calls.Load() != 4 {
		t.Fatalf("chunk calls=%d error=%v", calls.Load(), err)
	}
}

func TestShutdownCancelsHTTP(t *testing.T) {
	entered := make(chan struct{})
	done := make(chan error, 1)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-entered:
		default:
			close(entered)
		}
		<-r.Context().Done()
	}))
	defer s.Close()
	p := testProvider(t)
	saveTestConnection(t, p, s.URL, "prometheus", "one", "token")
	req := testRequest(p, 1)
	go func() {
		_, err := p.QueryResources(&metric.QueryContext{Context: context.Background(), ConnectionID: "one"}, req)
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("request did not reach server")
	}
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("shutdown did not cancel query")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not release query")
	}
}

func TestIdentityNamespaceIsolationAndUnitValidation(t *testing.T) {
	p := testProvider(t)
	defs, _ := p.GetMetricDefinitions(nil)
	req := testRequest(p, 2)
	req.Resources[1].ResourceID = req.Resources[0].ResourceID
	req.Resources[1].ResourceNamespace = "other"
	_, ids, err := compile(defs[0], req.Resources, req.PublicScope)
	if err != nil || len(ids) != 2 {
		t.Fatal("same-name namespace identities collided", err)
	}
	req.Resources[1].ResourceNamespace = "default"
	if _, _, err = compile(defs[0], req.Resources, req.PublicScope); err == nil {
		t.Fatal("duplicate requested identity accepted")
	}
	invalid := defs[0]
	invalid.Unit = metric.UnitBytes
	if definitionError(invalid) == nil {
		t.Fatal("rate mapped to bytes accepted")
	}
}

func TestBoundedDiscoveryBothTransports(t *testing.T) {
	for _, kind := range []string{"prometheus", "grafana"} {
		t.Run(kind, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				prefix := "/api/v1/"
				if kind == "grafana" {
					prefix = "/api/datasources/proxy/uid/manual/api/v1/"
				}
				if r.URL.Path != prefix+"label/pod/values" {
					t.Errorf("unexpected discovery path %s", r.URL.Path)
				}
				if r.URL.Query().Get("limit") != "3" {
					t.Error("server-side discovery limit missing")
				}
				if r.URL.Query().Get("match[]") != `{cluster="cluster\"x",__name__="container_cpu_usage_seconds_total"}` {
					t.Errorf("unsafe discovery selector %s", r.URL.Query().Get("match[]"))
				}
				fmt.Fprint(w, `{"status":"success","data":["pod-a","pod-b","pod-c"],"warnings":["discovery warning"]}`)
			}))
			defer s.Close()
			p := testProvider(t)
			saveTestConnection(t, p, s.URL, kind, "one", "token")
			source := metric.MetricSourceReference{PluginID: "grafana", ConnectionID: "one", DatasourceUID: "direct", DatasourceKind: "prometheus"}
			if kind == "grafana" {
				source.DatasourceUID = "manual"
			}
			req := metric.MetricDiscoveryRequest{Source: source, MetricName: "container_cpu_usage_seconds_total", LabelName: "pod", Matchers: map[string]string{"cluster": `cluster"x`}, Limit: 2}
			result, err := p.DiscoverMetricLabels(&metric.QueryContext{Context: context.Background(), ConnectionID: "one"}, req)
			if err != nil || !result.Truncated || len(result.Values) != 2 || len(result.Warnings) == 0 {
				t.Fatalf("discovery result %+v error %v", result, err)
			}
			req.Matchers["cluster"] = ""
			if _, err = p.DiscoverMetricLabels(&metric.QueryContext{Context: context.Background(), ConnectionID: "one"}, req); err == nil {
				t.Fatal("empty discovery scope accepted")
			}
		})
	}
}

func TestTypedTransforms(t *testing.T) {
	binding := metric.MetricFieldBinding{Field: "cluster", Source: "scope", Transform: "lowercase"}
	value, err := fieldValue(binding, metric.MetricResource{}, map[string]string{"cluster": "Cluster-A"})
	if err != nil || value != "cluster-a" {
		t.Fatal("lowercase transform failed", value, err)
	}
	binding.Transform = "uppercase"
	value, err = fieldValue(binding, metric.MetricResource{}, map[string]string{"cluster": "Cluster-A"})
	if err != nil || value != "CLUSTER-A" {
		t.Fatal("uppercase transform failed", value, err)
	}
	binding.Transform = "eval"
	if _, err = fieldValue(binding, metric.MetricResource{}, map[string]string{"cluster": "Cluster-A"}); err == nil {
		t.Fatal("unbounded transform accepted")
	}
}

func TestTransportBodyAndRangeLimits(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fmt.Fprint(w, strings.Repeat(" ", maxResponseBytes+1))
	}))
	defer s.Close()
	tr, err := newTransport(s.URL, "prometheus", "private-token", "")
	if err != nil {
		t.Fatal(err)
	}
	defer tr.close()
	_, err = tr.query(context.Background(), "direct", "vector(1)", time.Time{}, time.Now(), 0, false)
	if err == nil || !strings.Contains(err.Error(), "8 MiB") {
		t.Fatal("body limit missing", err)
	}
	before := calls.Load()
	_, err = tr.query(context.Background(), "direct", "vector(1)", time.Now().Add(-time.Hour), time.Now(), time.Millisecond, true)
	if err == nil || calls.Load() != before {
		t.Fatal("invalid range reached server", err)
	}
}

func TestCredentialBoundaryChangeRequiresWrite(t *testing.T) {
	p := testProvider(t)
	saveTestConnection(t, p, "https://first.example", "grafana", "one", "grafana-private")
	list, err := p.GetProviderConnections(nil)
	if err != nil {
		t.Fatal(err)
	}
	c := list[0]
	c.URL = "https://other.example"
	if _, err = p.SaveProviderConnection(nil, metric.ProviderConnectionInput{Connection: c}); err == nil {
		t.Fatal("credential moved between endpoints without explicit write")
	}
	c = list[0]
	c.Kind = "prometheus"
	c.PublicConfig["credentialKind"] = "prometheus-token"
	if _, err = p.SaveProviderConnection(nil, metric.ProviderConnectionInput{Connection: c}); err == nil {
		t.Fatal("Grafana credential reused for direct transport")
	}
}

func TestApprovedScalarProjectionAndMissingContext(t *testing.T) {
	p := testProvider(t)
	req := testRequest(p, 1)
	binding := metric.MetricFieldBinding{Field: "workload", Label: "pod", Source: "resource", ResourcePath: "/metadata/labels/app~1name", Required: true}
	req.Definitions[0].FieldBindings[2] = binding
	req.Definitions[0].Query = strings.ReplaceAll(req.Definitions[0].Query, "{{pod}}", "{{workload}}")
	req.Resources[0].PublicData = &resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"workload": {Kind: "string", String: `app.+"value`}}}
	value, err := fieldValue(binding, req.Resources[0], req.PublicScope)
	if err != nil || value != `app.+"value` {
		t.Fatal("approved scalar projection lost", value, err)
	}
	expression, _, err := compile(req.Definitions[0], req.Resources, req.PublicScope)
	if err != nil || !strings.Contains(expression, `app\\.\\+\"value`) {
		t.Fatal("projected value not escaped", expression, err)
	}
	req.Resources[0].PublicData = nil
	out, err := p.QueryResources(&metric.QueryContext{Context: context.Background(), ConnectionID: "one"}, req)
	if err != nil || len(out.Results) != 2 {
		t.Fatal("invalid context response missing", out, err)
	}
	for _, result := range out.Results {
		if result.Status != metric.MetricStatusInvalidContext || result.Value != nil {
			t.Fatalf("unsafe missing projection result %+v", result)
		}
	}
	for _, path := range []string{"metadata/name", "/bad~2escape", "/" + strings.Repeat("x", 513)} {
		binding.ResourcePath = path
		req.Definitions[0].FieldBindings[2] = binding
		if definitionError(req.Definitions[0]) == nil {
			t.Fatalf("invalid resource path accepted %q", path)
		}
	}
}

func TestProjectedResourceValuesRejectContainers(t *testing.T) {
	for _, value := range []resourcev2.Value{{Kind: "map", Map: map[string]resourcev2.Value{}}, {Kind: "list"}, {Kind: "null"}} {
		if _, err := projectedScalar(value); err == nil {
			t.Fatalf("container/null projection accepted %+v", value)
		}
	}
	for _, test := range []struct {
		value resourcev2.Value
		want  string
	}{{resourcev2.Value{Kind: "bool", Bool: true}, "true"}, {resourcev2.Value{Kind: "int64", Int: "42"}, "42"}, {resourcev2.Value{Kind: "double", Double: 1.25}, "1.25"}} {
		got, err := projectedScalar(test.value)
		if err != nil || got != test.want {
			t.Fatal("scalar projection changed", got, err)
		}
	}
}

func TestDeclaredDimensionTuples(t *testing.T) {
	for _, scenario := range []string{"distinct", "duplicate", "missing"} {
		t.Run(scenario, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				row := func(container string) any {
					labels := map[string]string{"cluster": "test", "namespace": "default", "pod": "pod-0"}
					if container != "" {
						labels["container"] = container
					}
					return map[string]any{"metric": labels, "value": []any{time.Now().Unix(), "1.5"}}
				}
				rows := []any{row("one")}
				switch scenario {
				case "distinct":
					rows = append(rows, row("two"))
				case "duplicate":
					rows = append(rows, row("one"))
				case "missing":
					rows = []any{row("")}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "vector", "result": rows}})
			}))
			defer s.Close()
			p := testProvider(t)
			saveTestConnection(t, p, s.URL, "prometheus", "one", "")
			req := testRequest(p, 1)
			req.MetricIDs = req.MetricIDs[:1]
			req.Definitions = req.Definitions[:1]
			req.Definitions[0].Dimensions = []string{"container"}
			out, err := p.QueryResources(&metric.QueryContext{Context: context.Background(), ConnectionID: "one"}, req)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "distinct" {
				if len(out.Results) != 2 {
					t.Fatalf("dimension series collapsed %+v", out.Results)
				}
				for _, result := range out.Results {
					if result.Status != metric.MetricStatusOK || len(result.Dimensions) != 1 || result.Dimensions["container"] == "" {
						t.Fatalf("bad dimension result %+v", result)
					}
				}
				if out.Results[0].Dimensions["container"] == out.Results[1].Dimensions["container"] {
					t.Fatal("distinct dimension identities lost")
				}
			} else {
				if len(out.Results) != 1 || out.Results[0].Status != metric.MetricStatusFailed || out.Results[0].Value != nil || len(out.Results[0].Warnings) == 0 {
					t.Fatalf("ambiguous/missing dimension accepted %+v", out.Results)
				}
			}
		})
	}
}

func TestQuerySampleTimeBounds(t *testing.T) {
	for _, scenario := range []string{"future-instant", "year9999", "matrix-before", "matrix-after", "matrix-boundaries", "matrix-partial"} {
		t.Run(scenario, func(t *testing.T) {
			end := time.Now().Truncate(time.Second).Add(-time.Minute)
			start := end.Add(-10 * time.Second)
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				row := map[string]any{"metric": map[string]string{"cluster": "test", "namespace": "default", "pod": "pod-0"}}
				resultType := "matrix"
				point := func(at time.Time) []any { return []any{at.Unix(), "1.5"} }
				switch scenario {
				case "future-instant":
					resultType = "vector"
					row["value"] = point(end.Add(3 * time.Second))
				case "year9999":
					resultType = "vector"
					row["value"] = []any{253402300799, "1.5"}
				case "matrix-before":
					row["values"] = []any{point(start.Add(-time.Second))}
				case "matrix-after":
					row["values"] = []any{point(end.Add(time.Second))}
				case "matrix-boundaries":
					row["values"] = []any{point(start), point(end)}
				case "matrix-partial":
					row["values"] = []any{point(start.Add(-time.Second)), point(end)}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": resultType, "result": []any{row}}})
			}))
			defer s.Close()
			p := testProvider(t)
			saveTestConnection(t, p, s.URL, "prometheus", "one", "")
			req := testRequest(p, 1)
			req.MetricIDs = req.MetricIDs[:1]
			req.Definitions = req.Definitions[:1]
			req.StartTime = start
			req.EndTime = end
			req.Step = time.Second
			if strings.HasPrefix(scenario, "matrix") {
				req.Shape = metric.ShapeTimeseries
			}
			out, err := p.QueryResources(&metric.QueryContext{Context: context.Background(), ConnectionID: "one"}, req)
			if err != nil || len(out.Results) != 1 {
				t.Fatal(out, err)
			}
			result := out.Results[0]
			switch scenario {
			case "matrix-boundaries":
				if result.Status != metric.MetricStatusOK || len(result.Value.TimeSeries.DataPoints) != 2 || !result.ObservedAt.Equal(end) {
					t.Fatalf("inclusive boundary samples rejected %+v", result)
				}
			case "matrix-partial":
				if result.Status != metric.MetricStatusPartial || len(result.Value.TimeSeries.DataPoints) != 1 || !result.ObservedAt.Equal(end) {
					t.Fatalf("out-of-range sample not isolated %+v", result)
				}
			default:
				if result.Status != metric.MetricStatusFailed || result.Value != nil || !result.ObservedAt.IsZero() || !result.ExpiresAt.IsZero() {
					t.Fatalf("invalid time published as fresh %+v", result)
				}
			}
		})
	}
}

func TestInstantClockSkewTolerance(t *testing.T) {
	now := time.Now()
	req := metric.ResourceSetQueryRequest{Shape: metric.ShapeCurrent}
	if err := validateSampleTime(now.Add(2*time.Second), req, now, now); err != nil {
		t.Fatal("bounded tolerance rejected", err)
	}
	if err := validateSampleTime(now.Add(2*time.Second+time.Nanosecond), req, now, now); err == nil {
		t.Fatal("unbounded future observation accepted")
	}
}

func TestManualUIDQueryOnlyGateway(t *testing.T) {
	for _, scenario := range []string{"query-only", "lookup", "unsupported", "lookup401", "lookup404", "query403", "invalid-vector"} {
		t.Run(scenario, func(t *testing.T) {
			var queries, lists atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer scoped-token" {
					t.Error("gateway credential missing")
				}
				switch r.URL.Path {
				case "/api/datasources":
					lists.Add(1)
					w.WriteHeader(403)
				case "/api/datasources/uid/manual":
					switch scenario {
					case "lookup":
						fmt.Fprint(w, `{"uid":"manual","name":"Selected","type":"prometheus"}`)
					case "unsupported":
						fmt.Fprint(w, `{"uid":"manual","name":"Unsupported","type":"loki"}`)
					case "lookup401":
						w.WriteHeader(401)
					case "lookup404":
						w.WriteHeader(404)
					default:
						w.WriteHeader(403)
					}
				case "/api/datasources/proxy/uid/manual/api/v1/query":
					queries.Add(1)
					if r.URL.Query().Get("query") != "vector(0)" {
						t.Error("manual UID probe changed expression")
					}
					if scenario == "query403" {
						w.WriteHeader(403)
						return
					}
					resultType := "vector"
					if scenario == "invalid-vector" {
						resultType = "matrix"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": resultType, "result": []any{map[string]any{"metric": map[string]string{}, "value": []any{time.Now().Unix(), "0"}}}}})
				default:
					t.Errorf("probe escaped selected UID gateway: %s", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer s.Close()
			p := testProvider(t)
			saveTestConnection(t, p, s.URL, "grafana", "one", "scoped-token")
			ctx := &metric.QueryContext{Context: context.Background(), ConnectionID: "one"}
			source := metric.MetricSourceReference{PluginID: "grafana", ConnectionID: "one", DatasourceUID: "manual", DatasourceKind: "prometheus"}
			got, err := p.GetDataSources(ctx, source)
			if scenario == "query-only" || scenario == "lookup" {
				if err != nil || len(got) != 1 || got[0].UID != "manual" || got[0].Kind != "prometheus" {
					t.Fatal("selected UID rejected", got, err)
				}
			} else if err == nil {
				t.Fatal("unsafe manual UID accepted", got)
			}
			if lists.Load() != 0 {
				t.Fatal("selected validation required list discovery")
			}
			wantQueries := int32(0)
			if scenario == "query-only" || scenario == "query403" || scenario == "invalid-vector" {
				wantQueries = 1
			}
			if queries.Load() != wantQueries {
				t.Fatalf("unexpected gateway probe count %d want %d", queries.Load(), wantQueries)
			}
			if scenario == "query-only" {
				source.DatasourceUID = ""
				if _, err = p.GetDataSources(ctx, source); err == nil {
					t.Fatal("denied list discovery concealed")
				}
			}
		})
	}
}
