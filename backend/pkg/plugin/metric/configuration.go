package metric

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// MetricConfigurationController manages private sources independently of presentation preferences.
type MetricConfigurationController interface {
	SetMetricStateRoot(*appstate.ScopedRoot)
	SetMetricResourceReader(MetricResourceReader)
	SetResourceIdentityGuard(ResourceIdentityGuard)
	GetMetricBindings(string, string) ([]sdk.MetricBinding, error)
	SaveMetricBinding(context.Context, sdk.MetricBinding) (*sdk.MetricBinding, error)
	DeleteMetricBinding(string, string, string) error
	GetMetricDefinitions() ([]sdk.MetricDefinition, error)
	GetMetricOwnerCatalog(context.Context, string, string) (*sdk.MetricOwnerCatalog, error)
	SaveMetricDefinition(context.Context, string, string, sdk.MetricDefinition) (*sdk.MetricDefinition, error)
	DeleteMetricDefinition(string) error
	GetMetricSourceDefaults() (sdk.MetricSourceDefaults, error)
	SaveMetricSourceDefaults(context.Context, sdk.MetricSourceDefaults) (sdk.MetricSourceDefaults, error)
	GetMetricViewSourceSelection(string, string, string) (sdk.MetricViewSourceSelection, error)
	SaveMetricViewSourceSelection(context.Context, sdk.MetricViewSourceSelection) (sdk.MetricViewSourceSelection, error)
	GetProviderConnections(string) ([]sdk.ProviderConnection, error)
	SaveProviderConnection(string, sdk.ProviderConnectionInput) (*sdk.ProviderConnection, error)
	DeleteProviderConnection(string, string) error
	GetDataSources(string, string) ([]sdk.MetricDataSource, error)
	TestProviderConnection(string, string) (*sdk.MetricValidationResult, error)
	ValidateMetricDefinition(string, string, string, sdk.MetricDefinition) (*sdk.MetricValidationResult, error)
	DiscoverMetricLabels(string, string, string, sdk.MetricDiscoveryRequest) (*sdk.MetricDiscoveryResult, error)
	PreviewMetricDefinition(context.Context, MetricsObservationSpec, sdk.MetricDefinition) (*sdk.ResourceMetricsResponse, error)
}

type persistedMetrics struct {
	Bindings    []sdk.MetricBinding             `json:"bindings"`
	Definitions []sdk.MetricDefinition          `json:"definitions"`
	Defaults    sdk.MetricSourceDefaults        `json:"defaults"`
	ViewSources []sdk.MetricViewSourceSelection `json:"view_sources"`
}
type metricState struct {
	sync.Mutex
	root   *appstate.ScopedRoot
	loaded bool
	data   persistedMetrics
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
	finish := c.beginMetricConfigurationChange()
	defer finish()
	s := c.state()
	s.Lock()
	defer s.Unlock()
	s.root = root
	s.loaded = false
	s.data = persistedMetrics{}
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
	if len(raw) > 4<<20 {
		return finiteError("RESOURCE_LIMIT", "Metric configuration exceeds byte limit.")
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
	if len(raw) > 4<<20 {
		return finiteError("RESOURCE_LIMIT", "Metric configuration exceeds byte limit.")
	}
	if err = s.root.MkdirAll("metrics", 0700); err != nil {
		return err
	}
	temp := "metrics/.configuration-" + uuid.NewString()
	f, err := s.root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer func() {
		if removeErr := s.root.Remove(temp); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			metricConfigurationError("remove_temporary_file", removeErr)
		}
	}()
	if _, err = f.Write(raw); err != nil {
		if closeErr := f.Close(); closeErr != nil {
			metricConfigurationError("close_after_write", closeErr)
		}
		return err
	}
	if err = f.Sync(); err != nil {
		if closeErr := f.Close(); closeErr != nil {
			metricConfigurationError("close_after_sync", closeErr)
		}
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = s.root.Rename(temp, "metrics/configuration.json"); err != nil {
		return err
	}
	s.data = data
	return nil
}
func metricConfigurationError(operation string, err error) {
	logging.Default().Debugw(context.Background(), "metric configuration operation failed",
		"operation", operation, "errorClass", telemetryutil.ErrorClass(err))
}

func copyJSON[T any](v T) T {
	var out T
	raw, err := json.Marshal(v)
	if err != nil {
		metricConfigurationError("copy_marshal", err)
		return out
	}
	if unmarshalErr := json.Unmarshal(raw, &out); unmarshalErr != nil {
		metricConfigurationError("copy_unmarshal", unmarshalErr)
	}
	return out
}
func metricDigest(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		metricConfigurationError("digest_marshal", err)
	}
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}
func validateOwnerScope(scope map[string]string, catalog *sdk.MetricOwnerCatalog) error {
	if len(scope) > 32 {
		return errors.New("public scope exceeds limits")
	}
	approved := map[string]bool{}
	for _, field := range catalog.ScopeFields {
		approved[field.Key] = true
	}
	for key, value := range scope {
		if !approved[key] || len(value) > 1024 {
			return errors.New("public scope field is not approved by resource owner or exceeds limits")
		}
	}
	return nil
}

func validateOwnerDefinitionScope(definition sdk.MetricDefinition, catalog *sdk.MetricOwnerCatalog) error {
	scope := map[string]string{}
	for _, binding := range definition.FieldBindings {
		if binding.Source == "scope" {
			scope[binding.Field] = ""
		}
	}
	return validateOwnerScope(scope, catalog)
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
func (c *controller) SaveMetricBinding(ctx context.Context, b sdk.MetricBinding) (*sdk.MetricBinding, error) {
	if b.ResourcePluginID == "" || b.ResourceConnectionID == "" || b.Signal != "metrics" {
		return nil, errors.New("metrics signal and resource owner connection are required")
	}
	if b.Policy != "" && b.Policy != "replace" {
		return nil, errors.New("binding policy must be replace")
	}
	if len(b.Overrides) > 64 {
		return nil, errors.New("binding exceeds limits")
	}
	catalog, err := c.rawMetricOwnerCatalog(ctx, b.ResourcePluginID, b.ResourceConnectionID)
	if err != nil {
		return nil, err
	}
	if err := validateOwnerScope(b.PublicScope, catalog); err != nil {
		return nil, err
	}
	if b.Source != (sdk.MetricSourceRef{}) {
		if err := c.validateOwnerMetricSource(ctx, b.Source, b.ResourcePluginID, b.ResourceConnectionID); err != nil {
			return nil, err
		}
	}
	definitions := catalog.Definitions
	state := c.state()
	state.Lock()
	if err := state.load(); err != nil {
		state.Unlock()
		return nil, err
	}
	definitions = append(append([]sdk.MetricDefinition(nil), definitions...), copyJSON(state.data.Definitions)...)
	state.Unlock()
	byID := map[string]sdk.MetricDefinition{}
	for _, d := range definitions {
		byID[d.ID] = d
	}
	seen := map[string]bool{}
	for _, o := range b.Overrides {
		if o.MetricID == "" || seen[o.MetricID] {
			return nil, errors.New("override IDs must be unique")
		}
		seen[o.MetricID] = true
		if o.Source != nil {
			if err := c.validateOwnerMetricSource(ctx, *o.Source, b.ResourcePluginID, b.ResourceConnectionID); err != nil {
				return nil, err
			}
		}
		definition, exists := byID[o.MetricID]
		if !exists {
			return nil, errors.New("override metric definition does not exist")
		}
		definition = applyMetricOverride(definition, o)
		if err := validateOwnerDefinitionScope(definition, catalog); err != nil {
			return nil, err
		}
		if err := validateConfiguredMetricDefinition(definition); err != nil {
			return nil, err
		}
	}
	finish := c.beginMetricConfigurationChange(finiteConfigurationKey{kind: "binding", plugin: b.ResourcePluginID, connection: b.ResourceConnectionID})
	defer finish()
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return nil, err
	}
	next := copyJSON(s.data)
	if b.ID == "" {
		b.ID = uuid.NewString()
	}
	found := false
	for i, old := range next.Bindings {
		if old.ID == b.ID && (old.ResourcePluginID != b.ResourcePluginID || old.ResourceConnectionID != b.ResourceConnectionID) {
			return nil, errors.New("binding belongs to another resource owner")
		}
		if old.ResourcePluginID == b.ResourcePluginID && old.ResourceConnectionID == b.ResourceConnectionID {
			if old.ID != b.ID {
				return nil, errors.New("one metrics binding is allowed per resource connection")
			}
			if old.Revision != b.Revision {
				return nil, finiteError("CONFLICT", "Metric binding changed; reload before saving.")
			}
			found = true
			next.Bindings[i] = b
		}
	}
	if !found && b.Revision != "" {
		return nil, finiteError("CONFLICT", "Metric binding was deleted; reload before saving.")
	}
	b.Revision = uuid.NewString()
	for i := range next.Bindings {
		if next.Bindings[i].ID == b.ID {
			next.Bindings[i] = copyJSON(b)
		}
	}
	if !found {
		if len(next.Bindings) >= 1024 {
			return nil, finiteError("RESOURCE_LIMIT", "Metric binding limit exceeded.")
		}
		next.Bindings = append(next.Bindings, copyJSON(b))
	}
	if err := s.save(next); err != nil {
		return nil, err
	}
	return &b, nil
}
func (c *controller) DeleteMetricBinding(plugin, connection, id string) error {
	finish := c.beginMetricConfigurationChange(finiteConfigurationKey{kind: "binding", plugin: plugin, connection: connection})
	defer finish()
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
func (c *controller) GetMetricSourceDefaults() (sdk.MetricSourceDefaults, error) {
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return sdk.MetricSourceDefaults{}, err
	}
	return copyJSON(s.data.Defaults), nil
}
func (c *controller) SaveMetricSourceDefaults(ctx context.Context, d sdk.MetricSourceDefaults) (sdk.MetricSourceDefaults, error) {
	if d.Source != nil {
		if d.Source.Native {
			return sdk.MetricSourceDefaults{}, errors.New("native profile defaults must use an empty source")
		}
		if err := c.validateSelectedMetricSource(ctx, *d.Source); err != nil {
			return sdk.MetricSourceDefaults{}, err
		}
	}
	finish := c.beginMetricConfigurationChange(finiteConfigurationKey{kind: "defaults"})
	defer finish()
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return sdk.MetricSourceDefaults{}, err
	}
	if d.Revision != s.data.Defaults.Revision {
		return sdk.MetricSourceDefaults{}, finiteError("CONFLICT", "Metric source defaults changed; reload before saving.")
	}
	next := copyJSON(s.data)
	d.Revision = uuid.NewString()
	next.Defaults = copyJSON(d)
	if err := s.save(next); err != nil {
		return sdk.MetricSourceDefaults{}, err
	}
	return copyJSON(d), nil
}

// GetMetricOwnerCatalog exposes effective profile definitions for owner settings.
// SDK catalogs remain raw owner declarations; persisted definitions never add scope fields.
func (c *controller) GetMetricOwnerCatalog(ctx context.Context, plugin, connection string) (*sdk.MetricOwnerCatalog, error) {
	catalog, err := c.rawMetricOwnerCatalog(ctx, plugin, connection)
	if err != nil {
		return nil, err
	}
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return nil, err
	}
	byID := make(map[string]int, len(catalog.Definitions))
	for i, definition := range catalog.Definitions {
		byID[definition.ID] = i
	}
	for _, definition := range s.data.Definitions {
		if i, exists := byID[definition.ID]; exists {
			catalog.Definitions[i] = copyJSON(definition)
		} else {
			byID[definition.ID] = len(catalog.Definitions)
			catalog.Definitions = append(catalog.Definitions, copyJSON(definition))
		}
	}
	return catalog, nil
}

// rawMetricOwnerCatalog preserves owner authority for scope and query composition.
func (c *controller) rawMetricOwnerCatalog(ctx context.Context, plugin, connection string) (*sdk.MetricOwnerCatalog, error) {
	if plugin == "" || connection == "" {
		return nil, errors.New("resource owner connection is required")
	}
	c.mux.RLock()
	provider := c.clients[plugin]
	c.mux.RUnlock()
	if provider == nil {
		return nil, finiteError("NOT_FOUND", "Resource owner is unavailable.")
	}
	catalog, ok := provider.(sdk.MetricOwnerCatalogProvider)
	if !ok {
		return &sdk.MetricOwnerCatalog{}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, resourceMetricsTimeout)
	defer cancel()
	if capabilities, ok := provider.(interface {
		GetMetricOwnerCapabilities(context.Context) (bool, error)
	}); ok {
		supported, err := capabilities.GetMetricOwnerCapabilities(ctx)
		if err != nil {
			return nil, err
		}
		if !supported {
			cancel()
			return &sdk.MetricOwnerCatalog{}, nil
		}
	}
	pc, err := c.getConnectedCtx(ctx, plugin, connection)
	if err != nil {
		return nil, err
	}
	result, err := catalog.GetMetricOwnerCatalog(pc)
	if err != nil {
		return nil, err
	}
	if err := sdk.ValidateMetricOwnerCatalog(result); err != nil {
		return nil, err
	}
	for _, definition := range result.Definitions {
		if err := validateConfiguredMetricDefinition(definition); err != nil {
			return nil, err
		}
	}
	return copyJSON(result), nil
}

func (c *controller) GetMetricDefinitions() ([]sdk.MetricDefinition, error) {
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return nil, err
	}
	out := make([]sdk.MetricDefinition, 0, len(s.data.Definitions))
	for _, d := range s.data.Definitions {
		out = append(out, copyJSON(d))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
func (c *controller) SaveMetricDefinition(ctx context.Context, ownerPlugin, ownerConnection string, d sdk.MetricDefinition) (*sdk.MetricDefinition, error) {
	if err := validateConfiguredMetricDefinition(d); err != nil {
		return nil, err
	}
	canonical, err := c.rawMetricOwnerCatalog(ctx, ownerPlugin, ownerConnection)
	if err != nil {
		return nil, err
	}
	inheritedRevision := ""
	for _, owner := range canonical.Definitions {
		if owner.ID == d.ID && (owner.Unit != d.Unit || metricDigest(owner.ResourceKeys) != metricDigest(d.ResourceKeys) || owner.Native != d.Native) {
			return nil, errors.New("owner metric semantics and resource applicability cannot change")
		}
		if owner.ID == d.ID {
			inheritedRevision = owner.Revision
		}
	}
	keys, err := c.metricDefinitionConfigurationKeys(d.ID, d.ResourceKeys)
	if err != nil {
		return nil, err
	}
	finish := c.beginMetricConfigurationChange(keys...)
	defer finish()
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return nil, err
	}
	next := copyJSON(s.data)
	found := false
	for i, old := range next.Definitions {
		if old.ID == d.ID {
			if old.Revision != d.Revision {
				return nil, finiteError("CONFLICT", "Metric definition changed; reload before saving.")
			}
			next.Definitions[i] = d
			found = true
		}
	}
	if !found && d.Revision != inheritedRevision {
		return nil, finiteError("CONFLICT", "Metric definition changed or was deleted; reload before saving.")
	}
	d.Revision = uuid.NewString()
	for i := range next.Definitions {
		if next.Definitions[i].ID == d.ID {
			next.Definitions[i] = copyJSON(d)
		}
	}
	if !found {
		if len(next.Definitions) >= 1024 {
			return nil, finiteError("RESOURCE_LIMIT", "Metric definition limit exceeded.")
		}
		next.Definitions = append(next.Definitions, copyJSON(d))
	}
	if err := s.save(next); err != nil {
		return nil, err
	}
	return &d, nil
}
func (c *controller) DeleteMetricDefinition(id string) error {
	keys, err := c.metricDefinitionConfigurationKeys(id, nil)
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}
	finish := c.beginMetricConfigurationChange(keys...)
	defer finish()
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
	cfg, ok := p.(sdk.ProviderConfiguration)
	if !ok {
		return nil, finiteError("UNSUPPORTED", "Metric provider configuration is unavailable.")
	}
	return cfg, nil
}
func (c *controller) GetProviderConnections(plugin string) ([]sdk.ProviderConnection, error) {
	p, err := c.providerConfig(plugin)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), resourceMetricsTimeout)
	defer cancel()
	return p.GetProviderConnections(c.getUnconnectedCtx(ctx))
}
func (c *controller) SaveProviderConnection(plugin string, input sdk.ProviderConnectionInput) (*sdk.ProviderConnection, error) {
	if input.Connection.PluginID != "" && input.Connection.PluginID != plugin {
		return nil, errors.New("provider connection plugin mismatch")
	}
	input.Connection.PluginID = plugin
	p, err := c.providerConfig(plugin)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), resourceMetricsTimeout)
	defer cancel()
	if input.Connection.ID == "" {
		created, err := p.SaveProviderConnection(c.getUnconnectedCtx(ctx), input)
		if err != nil {
			return nil, err
		}
		if created == nil || created.ID == "" {
			return nil, finiteError("UNAVAILABLE", "Metric provider did not return the created connection.")
		}
		finish := c.beginMetricConfigurationChange(finiteConfigurationKey{kind: "source", plugin: plugin, connection: created.ID})
		finish()
		return created, nil
	}
	finish := c.beginMetricConfigurationChange(finiteConfigurationKey{kind: "source", plugin: plugin, connection: input.Connection.ID})
	defer finish()
	return p.SaveProviderConnection(c.getUnconnectedCtx(ctx), input)
}
func (c *controller) DeleteProviderConnection(plugin, id string) error {
	if id == "" {
		return finiteError("INVALID_REQUEST", "Provider connection ID is required.")
	}
	p, err := c.providerConfig(plugin)
	if err != nil {
		return err
	}
	finish := c.beginMetricConfigurationChange(finiteConfigurationKey{kind: "source", plugin: plugin, connection: id})
	defer finish()
	ctx, cancel := context.WithTimeout(context.Background(), resourceMetricsTimeout)
	defer cancel()
	return p.DeleteProviderConnection(c.getUnconnectedCtx(ctx), id)
}
func (c *controller) GetDataSources(plugin, connection string) ([]sdk.MetricDataSource, error) {
	p, err := c.providerConfig(plugin)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), resourceMetricsTimeout)
	defer cancel()
	return p.GetDataSources(c.getUnconnectedCtx(ctx), sdk.MetricSourceRef{PluginID: plugin, ConnectionID: connection})
}
func (c *controller) TestProviderConnection(plugin, connection string) (*sdk.MetricValidationResult, error) {
	p, err := c.providerConfig(plugin)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), resourceMetricsTimeout)
	defer cancel()
	return p.TestProviderConnection(c.getUnconnectedCtx(ctx), connection)
}
func (c *controller) ValidateMetricDefinition(plugin, connection, datasource string, d sdk.MetricDefinition) (*sdk.MetricValidationResult, error) {
	if err := validateConfiguredMetricDefinition(d); err != nil {
		return nil, err
	}
	source, err := c.configuredMetricSource(plugin, connection, datasource)
	if err != nil {
		return nil, err
	}
	p, err := c.providerConfig(plugin)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), resourceMetricsTimeout)
	defer cancel()
	return p.ValidateMetricDefinition(c.getUnconnectedCtx(ctx), source, d)
}
func (c *controller) DiscoverMetricLabels(plugin, connection, datasource string, request sdk.MetricDiscoveryRequest) (*sdk.MetricDiscoveryResult, error) {
	source, err := c.configuredMetricSource(plugin, connection, datasource)
	if err != nil {
		return nil, err
	}
	request.Source = source
	if err := sdk.ValidateMetricDiscovery(request); err != nil {
		return nil, err
	}
	if request.EndTime.Sub(request.StartTime) > 24*time.Hour {
		return nil, errors.New("discovery range exceeds limit")
	}
	c.mux.RLock()
	client := c.clients[plugin]
	c.mux.RUnlock()
	p, ok := client.(sdk.MetricDiscoveryProvider)
	if !ok {
		return nil, errors.New("metric label discovery unsupported")
	}
	ctx, cancel := context.WithTimeout(context.Background(), resourceMetricsTimeout)
	defer cancel()
	return p.DiscoverMetricLabels(c.getUnconnectedCtx(ctx), request)
}
func (c *controller) validateOwnerMetricSource(ctx context.Context, source sdk.MetricSourceRef, plugin, connection string) error {
	if source.Native {
		if source.PluginID != plugin || source.ConnectionID != connection || source.DatasourceKind != "" || source.DatasourceUID != "" {
			return errors.New("native metric source must match resource owner connection")
		}
		return nil
	}
	return c.validateSelectedMetricSource(ctx, source)
}
func (c *controller) validateSelectedMetricSource(ctx context.Context, source sdk.MetricSourceRef) error {
	if source.Native || source.PluginID == "" || source.ConnectionID == "" || source.DatasourceKind == "" || source.DatasourceUID == "" {
		return errors.New("an explicit provider connection and typed datasource are required")
	}
	if err := sdk.ValidateResourceMetricsCatalogRequest(sdk.ResourceMetricsCatalogRequest{Source: source, ResourceKey: "source-validation"}); err != nil {
		return err
	}
	if _, err := c.providerConfig(source.PluginID); err != nil {
		if _, err = c.finiteProvider(source.PluginID); err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(ctx, resourceMetricsTimeout)
		defer cancel()
		_, err = c.finiteSourceContext(ctx, source)
		return err
	}
	p, err := c.providerConfig(source.PluginID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, resourceMetricsTimeout)
	defer cancel()
	pc := c.getUnconnectedCtx(ctx)
	connections, err := p.GetProviderConnections(pc)
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
	sources, err := p.GetDataSources(pc, source)
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

func (c *controller) configuredMetricSource(plugin, connection, datasource string) (sdk.MetricSourceRef, error) {
	source := sdk.MetricSourceRef{PluginID: plugin, ConnectionID: connection, DatasourceUID: datasource}
	if plugin == "" || connection == "" || datasource == "" {
		return source, errors.New("selected provider connection and datasource are required")
	}
	p, err := c.providerConfig(plugin)
	if err != nil {
		return source, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), resourceMetricsTimeout)
	defer cancel()
	sources, err := p.GetDataSources(c.getUnconnectedCtx(ctx), source)
	if err != nil {
		return source, err
	}
	for _, candidate := range sources {
		if candidate.UID == datasource {
			source.DatasourceKind = candidate.Kind
			return source, nil
		}
	}
	return source, errors.New("selected datasource does not exist")
}

func validateConfiguredMetricDefinition(definition sdk.MetricDefinition) error {
	if err := sdk.ValidateMetricDefinitionContract(definition); err != nil {
		return err
	}
	if len(definition.ID) > 256 || len(definition.Name) > 256 || len(definition.Query) > 32768 {
		return finiteError("RESOURCE_LIMIT", "Metric definition identity or query exceeds limits.")
	}
	return validateProjectionBindings(definition)
}

func (c *controller) GetMetricViewSourceSelection(plugin, connection, resource string) (sdk.MetricViewSourceSelection, error) {
	selection := sdk.MetricViewSourceSelection{OwnerPluginID: plugin, OwnerConnectionID: connection, ResourceKey: resource, Mode: "inherit"}
	if plugin == "" || connection == "" || resource == "" {
		return selection, finiteError("INVALID_REQUEST", "View source owner connection and resource key are required.")
	}
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return selection, err
	}
	for _, stored := range s.data.ViewSources {
		if stored.OwnerPluginID == plugin && stored.OwnerConnectionID == connection && stored.ResourceKey == resource {
			return copyJSON(stored), nil
		}
	}
	return selection, nil
}
func (c *controller) SaveMetricViewSourceSelection(ctx context.Context, selection sdk.MetricViewSourceSelection) (sdk.MetricViewSourceSelection, error) {
	empty := sdk.MetricViewSourceSelection{}
	if selection.OwnerPluginID == "" || selection.OwnerConnectionID == "" || selection.ResourceKey == "" {
		return empty, finiteError("INVALID_REQUEST", "View source owner connection and resource key are required.")
	}
	switch selection.Mode {
	case "external":
		if selection.Source == nil || selection.Source.Native {
			return empty, finiteError("INVALID_REQUEST", "External view source requires a typed external source.")
		}
		if err := c.validateSelectedMetricSource(ctx, *selection.Source); err != nil {
			return empty, err
		}
	case "inherit", "native":
		if selection.Source != nil {
			return empty, finiteError("INVALID_REQUEST", "Inherited and native view selections cannot include an external source.")
		}
	default:
		return empty, finiteError("INVALID_REQUEST", "View source mode must be inherit, native, or external.")
	}
	finish := c.beginMetricConfigurationChange(finiteConfigurationKey{kind: "view", plugin: selection.OwnerPluginID, connection: selection.OwnerConnectionID, resource: selection.ResourceKey})
	defer finish()
	s := c.state()
	s.Lock()
	defer s.Unlock()
	if err := s.load(); err != nil {
		return empty, err
	}
	next := copyJSON(s.data)
	index := -1
	revision := ""
	for i, stored := range next.ViewSources {
		if stored.OwnerPluginID == selection.OwnerPluginID && stored.OwnerConnectionID == selection.OwnerConnectionID && stored.ResourceKey == selection.ResourceKey {
			index = i
			revision = stored.Revision
			break
		}
	}
	if selection.Revision != revision {
		return empty, finiteError("CONFLICT", "Metric view source changed; reload before saving.")
	}
	selection.Revision = uuid.NewString()
	if index < 0 {
		if len(next.ViewSources) >= 1024 {
			return empty, finiteError("RESOURCE_LIMIT", "Metric view source selection limit exceeded.")
		}
		next.ViewSources = append(next.ViewSources, copyJSON(selection))
	} else {
		next.ViewSources[index] = copyJSON(selection)
	}
	if err := s.save(next); err != nil {
		return empty, err
	}
	return copyJSON(selection), nil
}
