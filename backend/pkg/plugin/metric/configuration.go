package metric

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/appstate"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// ResourceSetController is the typed host API. Resource ownership and provider
// configuration are deliberately independent; credentials never enter this store.
type ResourceSetController interface {
	SetMetricStateRoot(*appstate.ScopedRoot)
	SetMetricResourceReader(MetricResourceReader)
	SetResourceIdentityGuard(ResourceIdentityGuard)
	QueryResources(context.Context, sdk.ResourceSetQueryRequest) (*sdk.ResourceSetQueryResponse, error)
	ReadResourceSet(context.Context, sdk.ResourceSetQueryRequest) (*sdk.ResourceSetQueryResponse, error)
	GetMetricBindings(string, string) ([]sdk.MetricBinding, error)
	SaveMetricBinding(sdk.MetricBinding) (*sdk.MetricBinding, error)
	PreviewMetricDefinition(context.Context, sdk.ResourceSetQueryRequest) (*sdk.ResourceSetQueryResponse, error)
	DiscoverMetricLabels(string, string, string, sdk.MetricDiscoveryRequest) (*sdk.MetricDiscoveryResult, error)
	DeleteMetricBinding(string, string, string) error
	GetMetricDefinitions() ([]sdk.MetricDefinition, error)
	SaveMetricDefinition(sdk.MetricDefinition) (*sdk.MetricDefinition, error)
	DeleteMetricDefinition(string) error
	GetProviderConnections(string) ([]sdk.ProviderConnection, error)
	SaveProviderConnection(string, sdk.ProviderConnectionInput) (*sdk.ProviderConnection, error)
	DeleteProviderConnection(string, string) error
	GetDataSources(string, string) ([]sdk.MetricDataSource, error)
	TestProviderConnection(string, string) (*sdk.MetricValidationResult, error)
	ValidateMetricDefinition(string, string, string, sdk.MetricDefinition) (*sdk.MetricValidationResult, error)
}

type persistedMetrics struct {
	Bindings    []sdk.MetricBinding    `json:"bindings"`
	Definitions []sdk.MetricDefinition `json:"definitions"`
}
type metricState struct {
	sync.Mutex
	root       *appstate.ScopedRoot
	loaded     bool
	data       persistedMetrics
	generation uint64
}

func (c *controller) state() *metricState {
	c.mux.Lock()
	defer c.mux.Unlock()
	if c.metricState == nil {
		c.metricState = &metricState{}
	}
	return c.metricState
}
func (c *controller) SetMetricStateRoot(root *appstate.ScopedRoot) {
	s := c.state()
	s.Lock()
	defer s.Unlock()
	s.root = root
	s.loaded = false
	s.data = persistedMetrics{}
	s.generation++
}
func (s *metricState) load() error {
	if s.loaded {
		return nil
	}
	if s.root == nil {
		return errors.New("metric persistence is not configured")
	}
	raw, err := s.root.ReadFile("metrics/configuration.json")
	if errors.Is(err, os.ErrNotExist) {
		s.loaded = true
		return nil
	}
	if err != nil {
		return err
	}
	var data persistedMetrics
	if err = json.Unmarshal(raw, &data); err != nil {
		return fmt.Errorf("read metric configuration: %w", err)
	}
	s.data = data
	s.loaded = true
	return nil
}
func (s *metricState) save(data persistedMetrics) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	if err = s.root.MkdirAll("metrics", 0700); err != nil {
		return err
	}
	temp := "metrics/.configuration-" + uuid.NewString()
	f, err := s.root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer s.root.Remove(temp)
	if _, err = f.Write(raw); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = s.root.Rename(temp, "metrics/configuration.json"); err != nil {
		return err
	}
	s.data = data
	s.generation++
	return nil
}
func copyJSON[T any](v T) T {
	raw, _ := json.Marshal(v)
	var out T
	_ = json.Unmarshal(raw, &out)
	return out
}
func (c *controller) GetMetricBindings(plugin, connection string) ([]sdk.MetricBinding, error) {
	if plugin == "" || connection == "" {
		return nil, errors.New("resource owner and connection are required")
	}
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return nil, err
	}
	out := []sdk.MetricBinding{}
	for _, b := range s.data.Bindings {
		if b.ResourcePluginID == plugin && b.ResourceConnectionID == connection {
			out = append(out, copyJSON(b))
		}
	}
	return out, nil
}
func (c *controller) SaveMetricBinding(b sdk.MetricBinding) (*sdk.MetricBinding, error) {
	if b.ID == "native" {
		return nil, errors.New("native is a reserved source selector")
	}
	if b.ResourcePluginID == "" || b.ResourceConnectionID == "" || b.Signal != "metrics" {
		return nil, errors.New("metrics signal and resource owner connection are required")
	}
	if b.Source.PluginID == "" || b.Source.ConnectionID == "" || b.Source.DatasourceUID == "" || b.Source.DatasourceKind == "" {
		return nil, errors.New("explicit provider connection and datasource are required")
	}
	if b.Policy != "replace" && b.Policy != "supplement" {
		return nil, errors.New("binding policy must be replace or supplement")
	}
	if len(b.PublicScope) > 32 || len(b.Overrides) > 64 {
		return nil, errors.New("binding exceeds limits")
	}
	for k, v := range b.PublicScope {
		if !publicScopeKey(k) || len(v) > 1024 {
			return nil, errors.New("scope contains an unsupported public field")
		}
	}
	seen := map[string]bool{}
	for _, o := range b.Overrides {
		if o.MetricID == "" || seen[o.MetricID] {
			return nil, errors.New("override IDs must be unique")
		}
		seen[o.MetricID] = true
	}
	err := c.validateSelectedMetricSource(b.Source)
	if err != nil {
		return nil, err
	}
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err = s.load(); err != nil {
		return nil, err
	}
	next := copyJSON(s.data)
	if b.ID == "" {
		b.ID = uuid.NewString()
	}
	b.Revision = uuid.NewString()
	replaced := false
	for i, old := range next.Bindings {
		if old.ID == b.ID && (old.ResourcePluginID != b.ResourcePluginID || old.ResourceConnectionID != b.ResourceConnectionID) {
			return nil, errors.New("binding belongs to another resource owner")
		}
		if old.ResourcePluginID == b.ResourcePluginID && old.ResourceConnectionID == b.ResourceConnectionID && old.Signal == b.Signal {
			if old.ID != b.ID {
				return nil, errors.New("one metrics binding is allowed per resource connection")
			}
			next.Bindings[i] = copyJSON(b)
			replaced = true
		}
	}
	if !replaced {
		next.Bindings = append(next.Bindings, copyJSON(b))
	}
	if err = s.save(next); err != nil {
		return nil, err
	}
	return &b, nil
}
func publicScopeKey(k string) bool {
	// Values here are deliberately public mapping context, never provider settings.
	return k == "cluster" || k == "cluster_id" || k == "namespace" || k == "tenant" || k == "region" || k == "environment" || strings.HasPrefix(k, "label.")
}
func (c *controller) DeleteMetricBinding(plugin, connection, id string) error {
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return err
	}
	next := copyJSON(s.data)
	for i, b := range next.Bindings {
		if b.ID == id && b.ResourcePluginID == plugin && b.ResourceConnectionID == connection {
			next.Bindings = append(next.Bindings[:i], next.Bindings[i+1:]...)
			return s.save(next)
		}
	}
	return errors.New("binding not found in selected resource connection")
}
func (c *controller) catalogDefinitions() ([]sdk.MetricDefinition, error) {
	c.mux.RLock()
	ids := make([]string, 0, len(c.clients))
	providers := map[string]Provider{}
	for id, p := range c.clients {
		ids = append(ids, id)
		providers[id] = p
	}
	c.mux.RUnlock()
	sort.Strings(ids)
	defs := map[string]sdk.MetricDefinition{}
	for _, id := range ids {
		p, ok := providers[id].(sdk.MetricCatalogProvider)
		if !ok {
			continue
		}
		items, err := p.GetMetricDefinitions(&sdk.QueryContext{Context: context.Background(), PluginID: id})
		if err != nil {
			return nil, err
		}
		for _, d := range items {
			if old, exists := defs[d.ID]; exists && digest(old) != digest(d) {
				return nil, fmt.Errorf("conflicting metric definition %q", d.ID)
			}
			defs[d.ID] = d
		}
	}
	out := make([]sdk.MetricDefinition, 0, len(defs))
	for _, d := range defs {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
func (c *controller) GetMetricDefinitions() ([]sdk.MetricDefinition, error) {
	catalog, err := c.catalogDefinitions()
	if err != nil {
		return nil, err
	}
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err = s.load(); err != nil {
		return nil, err
	}
	byID := map[string]sdk.MetricDefinition{}
	for _, d := range catalog {
		byID[d.ID] = d
	}
	for _, d := range s.data.Definitions {
		byID[d.ID] = copyJSON(d)
	}
	out := make([]sdk.MetricDefinition, 0, len(byID))
	for _, d := range byID {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
func (c *controller) SaveMetricDefinition(d sdk.MetricDefinition) (*sdk.MetricDefinition, error) {
	if err := sdk.ValidateMetricDefinitionContract(d); err != nil {
		return nil, err
	}
	if err := validateProjectionBindings(d); err != nil {
		return nil, err
	}
	if d.ID == "" || d.Name == "" || len(d.Query) > 32768 || len(d.ResourceKeys) == 0 || len(d.SupportedShapes) == 0 {
		return nil, errors.New("definition requires identity, resource applicability, supported shapes and bounded query")
	}
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return nil, err
	}
	next := copyJSON(s.data)
	d.Revision = uuid.NewString()
	found := false
	for i, old := range next.Definitions {
		if old.ID == d.ID {
			next.Definitions[i] = copyJSON(d)
			found = true
			break
		}
	}
	if !found {
		next.Definitions = append(next.Definitions, copyJSON(d))
	}
	if err := s.save(next); err != nil {
		return nil, err
	}
	return &d, nil
}
func (c *controller) DeleteMetricDefinition(id string) error {
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return err
	}
	next := copyJSON(s.data)
	for i, d := range next.Definitions {
		if d.ID == id {
			next.Definitions = append(next.Definitions[:i], next.Definitions[i+1:]...)
			return s.save(next)
		}
	}
	return nil
}
func (c *controller) providerConfig(plugin string) (sdk.ProviderConfiguration, error) {
	c.mux.RLock()
	p := c.clients[plugin]
	c.mux.RUnlock()
	if p == nil {
		return nil, errors.New("metric provider unavailable")
	}
	cfg, ok := p.(sdk.ProviderConfiguration)
	if !ok {
		return nil, errors.New("metric provider configuration unsupported")
	}
	return cfg, nil
}
func configContext(plugin, connection string) (*sdk.QueryContext, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(context.Background(), resourceMetricsTimeout)
	return &sdk.QueryContext{Context: ctx, PluginID: plugin, ConnectionID: connection}, cancel
}
func (c *controller) GetProviderConnections(plugin string) ([]sdk.ProviderConnection, error) {
	p, e := c.providerConfig(plugin)
	if e != nil {
		return nil, e
	}
	ctx, cancel := configContext(plugin, "")
	defer cancel()
	return p.GetProviderConnections(ctx)
}
func (c *controller) SaveProviderConnection(plugin string, input sdk.ProviderConnectionInput) (*sdk.ProviderConnection, error) {
	if input.Connection.PluginID != "" && input.Connection.PluginID != plugin {
		return nil, errors.New("provider connection plugin mismatch")
	}
	input.Connection.PluginID = plugin
	p, e := c.providerConfig(plugin)
	if e != nil {
		return nil, e
	}
	c.invalidateResourceQueries()
	ctx, cancel := configContext(plugin, input.Connection.ID)
	defer cancel()
	out, e := p.SaveProviderConnection(ctx, input)
	c.invalidateResourceQueries()
	return out, e
}
func (c *controller) DeleteProviderConnection(plugin, id string) error {
	p, e := c.providerConfig(plugin)
	if e != nil {
		return e
	}
	c.invalidateResourceQueries()
	ctx, cancel := configContext(plugin, id)
	defer cancel()
	e = p.DeleteProviderConnection(ctx, id)
	c.invalidateResourceQueries()
	return e
}
func (c *controller) GetDataSources(plugin, connection string) ([]sdk.MetricDataSource, error) {
	p, e := c.providerConfig(plugin)
	if e != nil {
		return nil, e
	}
	ctx, cancel := configContext(plugin, connection)
	defer cancel()
	return p.GetDataSources(ctx, sdk.MetricSourceReference{PluginID: plugin, ConnectionID: connection})
}
func (c *controller) TestProviderConnection(plugin, connection string) (*sdk.MetricValidationResult, error) {
	p, e := c.providerConfig(plugin)
	if e != nil {
		return nil, e
	}
	ctx, cancel := configContext(plugin, connection)
	defer cancel()
	return p.TestProviderConnection(ctx, connection)
}
func (c *controller) ValidateMetricDefinition(plugin, connection, datasource string, d sdk.MetricDefinition) (*sdk.MetricValidationResult, error) {
	if err := sdk.ValidateMetricDefinitionContract(d); err != nil {
		return nil, err
	}
	if err := validateProjectionBindings(d); err != nil {
		return nil, err
	}
	p, e := c.providerConfig(plugin)
	if e != nil {
		return nil, e
	}
	ctx, cancel := configContext(plugin, connection)
	defer cancel()
	return p.ValidateMetricDefinition(ctx, sdk.MetricSourceReference{PluginID: plugin, ConnectionID: connection, DatasourceUID: datasource}, d)
}

func (c *controller) DiscoverMetricLabels(plugin, connection, datasource string, req sdk.MetricDiscoveryRequest) (*sdk.MetricDiscoveryResult, error) {
	if plugin == "" || connection == "" || datasource == "" || req.Limit < 1 || req.Limit > 100 || len(req.Matchers) > 16 {
		return nil, errors.New("discovery requires selected datasource and bounded exact matchers")
	}
	if req.EndTime.Before(req.StartTime) || req.EndTime.Sub(req.StartTime) > 24*time.Hour {
		return nil, errors.New("discovery range exceeds limit")
	}
	c.mux.RLock()
	client := c.clients[plugin]
	c.mux.RUnlock()
	provider, ok := client.(sdk.MetricDiscoveryProvider)
	if !ok {
		return nil, errors.New("metric label discovery unsupported")
	}
	req.Source = sdk.MetricSourceReference{PluginID: plugin, ConnectionID: connection, DatasourceUID: datasource}
	if err := sdk.ValidateMetricDiscovery(req); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), resourceMetricsTimeout)
	defer cancel()
	return provider.DiscoverMetricLabels(&sdk.QueryContext{Context: ctx, PluginID: plugin, ConnectionID: connection}, req)
}

func (c *controller) validateSelectedMetricSource(source sdk.MetricSourceReference) error {
	if source.PluginID == "" || source.ConnectionID == "" || source.DatasourceUID == "" || source.DatasourceKind == "" {
		return errors.New("an explicit provider connection and typed datasource are required")
	}
	provider, err := c.providerConfig(source.PluginID)
	if err != nil {
		return err
	}
	ctx, cancel := configContext(source.PluginID, source.ConnectionID)
	defer cancel()
	connections, err := provider.GetProviderConnections(ctx)
	if err != nil {
		return err
	}
	found := false
	for _, connection := range connections {
		if connection.ID == source.ConnectionID {
			found = true
			break
		}
	}
	if !found {
		return errors.New("selected provider connection does not exist")
	}
	// Exact selection validation must not depend on datasource-list privilege.
	// Providers may validate an entered UID through their normal datasource query
	// capability. The host never retries through another gateway or datasource.
	sources, err := provider.GetDataSources(ctx, source)
	if err != nil {
		return err
	}
	for _, datasource := range sources {
		if datasource.UID == source.DatasourceUID && datasource.Kind == source.DatasourceKind {
			return nil
		}
	}
	return errors.New("selected datasource does not exist or has incompatible kind")
}
