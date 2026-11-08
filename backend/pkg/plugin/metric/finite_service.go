package metric

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type metricSessionLifetimeKey struct{}
type metricFrontendSession struct {
	scope  *invocation.Scope
	ctx    context.Context
	cancel context.CancelFunc
	window application.Window
}

func (s *ServiceWrapper) metricSession(ctx context.Context) (context.Context, *metricFrontendSession, error) {
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok || window == nil {
		return ctx, nil, finiteError("DENIED", "Metrics operations require an authenticated frontend window.")
	}
	if s.Realm == nil {
		return ctx, nil, finiteError("DENIED", "Metrics frontend realm is unavailable.")
	}
	s.sessionsMu.Lock()
	defer s.sessionsMu.Unlock()
	key := invocation.IdentityOf(window)
	if s.sessions == nil {
		s.sessions = map[invocation.WindowIdentity]*metricFrontendSession{}
	}
	session := s.sessions[key]
	if session == nil {
		if len(s.sessions) >= 64 {
			return ctx, nil, finiteError("RESOURCE_LIMIT", "Metric frontend session limit exceeded.")
		}
		scope := s.Realm.ScopeForWindow(window)
		if scope == nil {
			return ctx, nil, finiteError("CANCELLED", "Metric frontend window is unavailable.")
		}
		lifeBase := context.WithValue(context.Background(), application.WindowKey, window)
		life, cancel := context.WithCancel(scope.Context(lifeBase))
		session = &metricFrontendSession{scope: scope, ctx: life, cancel: cancel, window: window}
		s.sessions[key] = session
		window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
			cancel()
			s.Ctrl.RetireMetricsSession(life)
			s.sessionsMu.Lock()
			if s.sessions[key] == session {
				delete(s.sessions, key)
			}
			s.sessionsMu.Unlock()
		})
	}
	if session.ctx.Err() != nil {
		return ctx, nil, finiteError("CANCELLED", "Metric frontend session closed.")
	}
	return context.WithValue(session.scope.Context(ctx), metricSessionLifetimeKey{}, session.ctx), session, nil
}

// OpenMetricsObservation reserves a window-owned observation without collection.
// The caller installs metric/observation routing before Open, processes the
// returned snapshot, then calls Attach. Events are sent only to this Wails
// window; no application-global metrics payload is broadcast.
func (s *ServiceWrapper) OpenMetricsObservation(ctx context.Context, request OpenMetricsObservationRequest) (MetricsObservationSnapshot, error) {
	ctx, session, err := s.metricSession(ctx)
	if err != nil {
		return MetricsObservationSnapshot{}, err
	}
	work, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(session.ctx, cancel)
	defer stop()
	return s.Ctrl.OpenMetricsObservation(work, request, func(snapshot MetricsObservationSnapshot) {
		if session.ctx.Err() == nil {
			session.window.EmitEvent("metric/observation", snapshot)
		}
	})
}

// AttachMetricsObservation activates an acknowledged window-owned reservation.
func (s *ServiceWrapper) AttachMetricsObservation(ctx context.Context, token string) error {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return err
	}
	return s.Ctrl.AttachMetricsObservation(ctx, token)
}

// CloseMetricsObservation is idempotent and covers close-before-registration.
func (s *ServiceWrapper) CloseMetricsObservation(ctx context.Context, token string) error {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return err
	}
	return s.Ctrl.CloseMetricsObservation(ctx, token)
}

// RefreshMetricsObservation bypasses completed cache, not compatible in-flight work.
func (s *ServiceWrapper) RefreshMetricsObservation(ctx context.Context, token string) error {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return err
	}
	return s.Ctrl.RefreshMetricsObservation(ctx, token)
}

// GetResourceMetricsCatalog resolves the selected source for an authenticated owner.
func (s *ServiceWrapper) GetResourceMetricsCatalog(ctx context.Context, request ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.GetResourceMetricsCatalog(ctx, request)
}

// GetMetricViewPreferences reads profile-durable presentation state. Revision is
// required when saving; durable store failures are returned, never hidden.
func (s *ServiceWrapper) GetMetricViewPreferences(ctx context.Context, plugin, resourceKey string) (MetricViewPreferences, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return MetricViewPreferences{}, err
	}
	return s.Ctrl.GetMetricViewPreferences(plugin, resourceKey)
}

// SaveMetricViewPreferences requires the loaded Revision. A stale edit returns
// CONFLICT without overwriting other windows. Reload after a successful save.
func (s *ServiceWrapper) SaveMetricViewPreferences(ctx context.Context, plugin, resourceKey string, preferences MetricViewPreferences) error {
	if _, _, err := s.metricSession(ctx); err != nil {
		return err
	}
	return s.Ctrl.SaveMetricViewPreferences(plugin, resourceKey, preferences)
}

func (s *ServiceWrapper) GetProviderConnections(ctx context.Context, plugin string) ([]sdk.ProviderConnection, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.GetProviderConnections(plugin)
}
func (s *ServiceWrapper) SaveProviderConnection(ctx context.Context, plugin string, input sdk.ProviderConnectionInput) (*sdk.ProviderConnection, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.SaveProviderConnection(plugin, input)
}
func (s *ServiceWrapper) DeleteProviderConnection(ctx context.Context, plugin, connection string) error {
	if _, _, err := s.metricSession(ctx); err != nil {
		return err
	}
	return s.Ctrl.DeleteProviderConnection(plugin, connection)
}
func (s *ServiceWrapper) GetDataSources(ctx context.Context, plugin, connection string) ([]sdk.MetricDataSource, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.GetDataSources(plugin, connection)
}
func (s *ServiceWrapper) TestProviderConnection(ctx context.Context, plugin, connection string) (*sdk.MetricValidationResult, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.TestProviderConnection(plugin, connection)
}
func (s *ServiceWrapper) ValidateMetricDefinition(ctx context.Context, plugin, connection, datasourceUID string, definition sdk.MetricDefinition) (*sdk.MetricValidationResult, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.ValidateMetricDefinition(plugin, connection, datasourceUID, definition)
}
func (s *ServiceWrapper) DiscoverMetricLabels(ctx context.Context, plugin, connection, datasourceUID string, request sdk.MetricDiscoveryRequest) (*sdk.MetricDiscoveryResult, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.DiscoverMetricLabels(plugin, connection, datasourceUID, request)
}
func (s *ServiceWrapper) GetMetricDefinitions(ctx context.Context) ([]sdk.MetricDefinition, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.GetMetricDefinitions()
}
func (s *ServiceWrapper) GetMetricOwnerCatalog(ctx context.Context, ownerPlugin, ownerConnection string) (*sdk.MetricOwnerCatalog, error) {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.GetMetricOwnerCatalog(ctx, ownerPlugin, ownerConnection)
}
func (s *ServiceWrapper) SaveMetricDefinition(ctx context.Context, ownerPlugin, ownerConnection string, definition sdk.MetricDefinition) (*sdk.MetricDefinition, error) {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.SaveMetricDefinition(ctx, ownerPlugin, ownerConnection, definition)
}
func (s *ServiceWrapper) DeleteMetricDefinition(ctx context.Context, id string) error {
	if _, _, err := s.metricSession(ctx); err != nil {
		return err
	}
	return s.Ctrl.DeleteMetricDefinition(id)
}
func (s *ServiceWrapper) GetMetricBindings(ctx context.Context, ownerPlugin, ownerConnection string) ([]sdk.MetricBinding, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.GetMetricBindings(ownerPlugin, ownerConnection)
}
func (s *ServiceWrapper) SaveMetricBinding(ctx context.Context, binding sdk.MetricBinding) (*sdk.MetricBinding, error) {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.SaveMetricBinding(ctx, binding)
}
func (s *ServiceWrapper) DeleteMetricBinding(ctx context.Context, ownerPlugin, ownerConnection, id string) error {
	if _, _, err := s.metricSession(ctx); err != nil {
		return err
	}
	return s.Ctrl.DeleteMetricBinding(ownerPlugin, ownerConnection, id)
}
func (s *ServiceWrapper) GetMetricSourceDefaults(ctx context.Context) (sdk.MetricSourceDefaults, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return sdk.MetricSourceDefaults{}, err
	}
	return s.Ctrl.GetMetricSourceDefaults()
}
func (s *ServiceWrapper) SaveMetricSourceDefaults(ctx context.Context, defaults sdk.MetricSourceDefaults) (sdk.MetricSourceDefaults, error) {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return sdk.MetricSourceDefaults{}, err
	}
	return s.Ctrl.SaveMetricSourceDefaults(ctx, defaults)
}
func (s *ServiceWrapper) PreviewMetricDefinition(ctx context.Context, spec MetricsObservationSpec, definition sdk.MetricDefinition) (*sdk.ResourceMetricsResponse, error) {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.PreviewMetricDefinition(ctx, spec, definition)
}

func (s *ServiceWrapper) GetMetricViewSourceSelection(ctx context.Context, ownerPlugin, ownerConnection, resourceKey string) (sdk.MetricViewSourceSelection, error) {
	if _, _, err := s.metricSession(ctx); err != nil {
		return sdk.MetricViewSourceSelection{}, err
	}
	return s.Ctrl.GetMetricViewSourceSelection(ownerPlugin, ownerConnection, resourceKey)
}
func (s *ServiceWrapper) SaveMetricViewSourceSelection(ctx context.Context, selection sdk.MetricViewSourceSelection) (sdk.MetricViewSourceSelection, error) {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return sdk.MetricViewSourceSelection{}, err
	}
	return s.Ctrl.SaveMetricViewSourceSelection(ctx, selection)
}
