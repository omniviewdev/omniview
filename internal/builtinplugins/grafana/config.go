package grafana

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"sort"
	"sync"

	"github.com/omniviewdev/plugin-sdk/pkg/state"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

type savedConnection struct {
	Public metric.ProviderConnection `json:"public"`
	Secret string                    `json:"secret"`
}
type Provider struct {
	mu          sync.Mutex
	active      sync.WaitGroup
	connections map[string]savedConnection
	loaded      bool
	closed      bool
	openState   func() (*os.Root, error)
	lifetime    context.Context
	cancel      context.CancelFunc
}

func NewProvider(openState func() (*os.Root, error)) *Provider {
	lifetime, cancel := context.WithCancel(context.Background())
	return &Provider{connections: map[string]savedConnection{}, openState: openState, lifetime: lifetime, cancel: cancel}
}
func (p *Provider) privateRoot() (*os.Root, error) {
	if p.openState == nil {
		return nil, errors.New("private plugin state is unavailable")
	}
	return p.openState()
}
func (p *Provider) loadLocked() error {
	if p.closed {
		return errors.New("Grafana provider stopped")
	}
	if p.loaded {
		return nil
	}
	root, err := p.privateRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	if err = state.RejectSymlink(root, "connections.json"); err != nil {
		return err
	}
	file, err := root.Open("connections.json")
	if os.IsNotExist(err) {
		p.loaded = true
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if err != nil {
		return err
	}
	if len(data) > 1<<20 {
		return errors.New("provider configuration exceeds limit")
	}
	if err = json.Unmarshal(data, &p.connections); err != nil {
		return errors.New("invalid private provider configuration")
	}
	p.loaded = true
	return nil
}
func (p *Provider) persistLocked(next map[string]savedConnection) error {
	root, err := p.privateRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	data, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if len(data) > 1<<20 {
		return errors.New("provider configuration exceeds 1 MiB limit")
	}
	if err = state.RejectSymlink(root, "connections.tmp"); err != nil {
		return err
	}
	if err = state.RejectSymlink(root, "connections.json"); err != nil {
		return err
	}
	f, err := root.OpenFile("connections.tmp", os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return root.Rename("connections.tmp", "connections.json")
}
func publicConnection(s savedConnection) metric.ProviderConnection {
	c := s.Public
	c.HasCredentials = s.Secret != ""
	c.CredentialRef = ""
	c.PublicConfig = map[string]string{"username": s.Public.PublicConfig["username"], "credentialKind": s.Public.PublicConfig["credentialKind"], "allowInsecureHTTP": s.Public.PublicConfig["allowInsecureHTTP"]}
	return c
}
func (p *Provider) GetProviderConnections(*metric.QueryContext) ([]metric.ProviderConnection, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.loadLocked(); err != nil {
		return nil, err
	}
	out := make([]metric.ProviderConnection, 0, len(p.connections))
	for _, c := range p.connections {
		out = append(out, publicConnection(c))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
func (p *Provider) SaveProviderConnection(_ *metric.QueryContext, in metric.ProviderConnectionInput) (*metric.ProviderConnection, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.loadLocked(); err != nil {
		return nil, err
	}
	c := in.Connection
	if err := state.ValidateComponent(c.ID); err != nil {
		return nil, err
	}
	if c.Name == "" || len(c.Name) > 256 {
		return nil, errors.New("connection name required (max 256 characters)")
	}
	if len(p.connections) >= 100 {
		if _, ok := p.connections[c.ID]; !ok {
			return nil, errors.New("maximum 100 provider connections")
		}
	}
	kind := c.PublicConfig["credentialKind"]
	if c.Kind == "grafana" && kind != "grafana-service-account" || c.Kind == "prometheus" && kind != "cloud-access-policy" && kind != "prometheus-token" {
		return nil, errors.New("credential kind does not match transport")
	}
	if len(c.URL) >= 7 && c.URL[:7] == "http://" && c.PublicConfig["allowInsecureHTTP"] != "true" {
		return nil, errors.New("HTTP requires explicit allowInsecureHTTP opt-in; prefer trusted HTTPS")
	}
	old, exists := p.connections[c.ID]
	if exists && old.Secret != "" && in.Credential == nil && (old.Public.URL != c.URL || old.Public.Kind != c.Kind || old.Public.PublicConfig["credentialKind"] != kind || old.Public.PublicConfig["username"] != c.PublicConfig["username"]) {
		return nil, errors.New("changing endpoint or authentication requires re-entering credentials")
	}
	if c.Kind == "grafana" && c.PublicConfig["username"] != "" {
		return nil, errors.New("Grafana service-account credentials require bearer authentication")
	}
	if kind == "cloud-access-policy" && (c.PublicConfig["username"] == "" || len(c.URL) < 8 || c.URL[:8] != "https://") {
		return nil, errors.New("Cloud access-policy credentials require HTTPS and instance username")
	}
	secret := p.connections[c.ID].Secret
	if in.Credential != nil {
		secret = *in.Credential
	}
	if len(secret) > 16384 {
		return nil, errors.New("credential exceeds limit")
	}
	tr, err := newTransport(c.URL, c.Kind, secret, c.PublicConfig["username"])
	if err != nil {
		return nil, err
	}
	tr.close()
	c.PluginID = "grafana"
	c.CredentialRef = ""
	c.HasCredentials = secret != ""
	c.PublicConfig = map[string]string{"username": c.PublicConfig["username"], "credentialKind": kind, "allowInsecureHTTP": c.PublicConfig["allowInsecureHTTP"]}
	next := make(map[string]savedConnection, len(p.connections)+1)
	for k, v := range p.connections {
		next[k] = v
	}
	next[c.ID] = savedConnection{c, secret}
	if err = p.persistLocked(next); err != nil {
		return nil, err
	}
	p.connections = next
	out := publicConnection(next[c.ID])
	return &out, nil
}
func (p *Provider) DeleteProviderConnection(_ *metric.QueryContext, id string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.loadLocked(); err != nil {
		return err
	}
	next := map[string]savedConnection{}
	for k, v := range p.connections {
		if k != id {
			next[k] = v
		}
	}
	if err := p.persistLocked(next); err != nil {
		return err
	}
	p.connections = next
	return nil
}
func (p *Provider) connection(id string) (*transport, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.loadLocked(); err != nil {
		return nil, err
	}
	s, ok := p.connections[id]
	if !ok {
		return nil, errors.New("provider connection not found")
	}
	return newTransport(s.Public.URL, s.Public.Kind, s.Secret, s.Public.PublicConfig["username"])
}
func (p *Provider) Close() error {
	p.cancel()
	p.mu.Lock()
	p.closed = true
	clear(p.connections)
	p.mu.Unlock()
	p.active.Wait()
	return nil
}
func (p *Provider) GetSupportedResources(*types.PluginContext) (*metric.ProviderInfo, []metric.Handler) {
	return &metric.ProviderInfo{ID: "grafana", Name: "Grafana / Prometheus"}, nil
}
func (p *Provider) Query(*types.PluginContext, metric.QueryRequest) (*metric.QueryResponse, error) {
	return nil, errors.New("Grafana requires explicit resource-set queries")
}
func (p *Provider) StreamMetrics(context.Context, chan metric.StreamInput) (chan metric.StreamOutput, error) {
	return nil, errors.New("Grafana resource sets use host-coordinated polling")
}
func (p *Provider) GetDataSources(ctx *metric.QueryContext, source metric.MetricSourceReference) ([]metric.MetricDataSource, error) {
	call, done, err := p.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	owned := *ctx
	owned.Context = call
	ctx = &owned
	t, err := p.connection(source.ConnectionID)
	if err != nil {
		return nil, err
	}
	defer t.close()
	if source.DatasourceKind != "" && source.DatasourceKind != "prometheus" {
		return nil, errors.New("only Prometheus-compatible datasources supported")
	}
	if t.mode == "prometheus" {
		if source.DatasourceUID != "" && (source.DatasourceUID != "direct" || source.DatasourceKind != "prometheus") {
			return nil, errors.New("direct datasource requires UID direct and kind prometheus")
		}
		return []metric.MetricDataSource{{UID: "direct", Name: "Direct Prometheus-compatible endpoint", Kind: "prometheus"}}, nil
	}
	if source.DatasourceUID != "" {
		if _, err := t.apiPath(source.DatasourceUID, "query"); err != nil {
			return nil, err
		}
		var datasource struct {
			UID  string `json:"uid"`
			Name string `json:"name"`
			Type string `json:"type"`
		}
		lookupErr := t.get(ctx, "/api/datasources/uid/"+source.DatasourceUID, nil, &datasource)
		if lookupErr == nil {
			if datasource.UID != source.DatasourceUID || datasource.Type != "prometheus" {
				return nil, errors.New("selected datasource is not a matching Prometheus datasource")
			}
			return []metric.MetricDataSource{{UID: datasource.UID, Name: datasource.Name, Kind: datasource.Type}}, nil
		}
		var denied *HTTPError
		if !errors.As(lookupErr, &denied) || denied.Status != 403 {
			return nil, lookupErr
		}
		// Query-only Grafana roles may deny metadata. Probe only the selected
		// gateway UID; never substitute direct access or a different datasource.
		now := nowTime()
		probe, err := t.query(ctx, source.DatasourceUID, "vector(0)", zeroTime(), now, 0, false)
		if err != nil {
			return nil, err
		}
		if probe.Data.ResultType != "vector" || len(probe.Data.Result) != 1 {
			return nil, errors.New("datasource permission probe did not return a Prometheus vector")
		}
		sample, err := samplePoint(probe.Data.Result[0].Value)
		if err != nil || sample.Value != 0 {
			return nil, errors.New("datasource permission probe returned an invalid Prometheus sample")
		}
		if err := validateSampleTime(sample.Timestamp, metric.ResourceSetQueryRequest{Shape: metric.ShapeCurrent}, now, nowTime()); err != nil {
			return nil, err
		}
		return []metric.MetricDataSource{{UID: source.DatasourceUID, Name: source.DatasourceUID, Kind: "prometheus"}}, nil
	}
	var raw []struct {
		UID  string `json:"uid"`
		Name string `json:"name"`
		Type string `json:"type"`
	}
	if err = t.get(ctx, "/api/datasources", nil, &raw); err != nil {
		return nil, err
	}
	if len(raw) > 1000 {
		return nil, errors.New("datasource discovery exceeds 1000 entries; enter UID manually")
	}
	out := []metric.MetricDataSource{}
	for _, d := range raw {
		if d.Type == "prometheus" {
			out = append(out, metric.MetricDataSource{UID: d.UID, Name: d.Name, Kind: d.Type})
		}
	}
	return out, nil
}
func (p *Provider) TestProviderConnection(ctx *metric.QueryContext, id string) (*metric.MetricValidationResult, error) {
	call, done, err := p.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	t, err := p.connection(id)
	if err != nil {
		return nil, err
	}
	defer t.close()
	if t.mode == "grafana" {
		var health map[string]any
		err = t.get(call, "/api/health", nil, &health)
	} else {
		_, err = t.query(call, "direct", "vector(1)", zeroTime(), nowTime(), 0, false)
	}
	if err != nil {
		return nil, err
	}
	return &metric.MetricValidationResult{Valid: true, Issues: []metric.MetricValidationIssue{{Field: "permissions", Code: "health_only", Message: "Endpoint reachable; health does not prove datasource query permission. Validate a mapping with real scope."}}}, nil
}

func (p *Provider) begin(ctx context.Context) (context.Context, func(), error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, nil, errors.New("Grafana provider stopped")
	}
	p.active.Add(1)
	p.mu.Unlock()
	call, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(p.lifetime, cancel)
	return call, func() { stop(); cancel(); p.active.Done() }, nil
}
