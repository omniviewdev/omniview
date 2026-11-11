package metric

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
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
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) OpenMetricsObservation(
	ctx context.Context, request OpenMetricsObservationRequest,
) (_ MetricsObservationSnapshot, retErr error) {
	ctx, end := startOp(ctx, "metric.OpenMetricsObservation")
	defer end(&retErr)
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
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) AttachMetricsObservation(ctx context.Context, token string) (retErr error) {
	ctx, end := startOp(ctx, "metric.AttachMetricsObservation")
	defer end(&retErr)
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return err
	}
	return s.Ctrl.AttachMetricsObservation(ctx, token)
}

// CloseMetricsObservation is idempotent and covers close-before-registration.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) CloseMetricsObservation(ctx context.Context, token string) (retErr error) {
	ctx, end := startOp(ctx, "metric.CloseMetricsObservation")
	defer end(&retErr)
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return err
	}
	return s.Ctrl.CloseMetricsObservation(ctx, token)
}

// RefreshMetricsObservation bypasses completed cache, not compatible in-flight work.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) RefreshMetricsObservation(ctx context.Context, token string) (retErr error) {
	ctx, end := startOp(ctx, "metric.RefreshMetricsObservation")
	defer end(&retErr)
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return err
	}
	return s.Ctrl.RefreshMetricsObservation(ctx, token)
}

// GetResourceMetricsCatalog resolves the selected source for an authenticated owner.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) GetResourceMetricsCatalog(
	ctx context.Context, request ResourceMetricsCatalogRequest,
) (_ *sdk.ResourceMetricsCatalog, retErr error) {
	ctx, end := startOp(ctx, "metric.GetResourceMetricsCatalog")
	defer end(&retErr)
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.GetResourceMetricsCatalog(ctx, request)
}

// GetMetricViewPreferences reads profile-durable presentation state. Revision is
// required when saving; durable store failures are returned, never hidden.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) GetMetricViewPreferences(
	ctx context.Context, plugin, resourceKey string,
) (_ MetricViewPreferences, retErr error) {
	ctx, end := startOp(ctx, "metric.GetMetricViewPreferences",
		attribute.String("plugin_id", plugin), attribute.String("resource_type", resourceKey))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return MetricViewPreferences{}, err
	}
	return s.Ctrl.GetMetricViewPreferences(plugin, resourceKey)
}

// SaveMetricViewPreferences requires the loaded Revision. A stale edit returns
// CONFLICT without overwriting other windows. Reload after a successful save.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) SaveMetricViewPreferences(
	ctx context.Context, plugin, resourceKey string, preferences MetricViewPreferences,
) (retErr error) {
	ctx, end := startOp(ctx, "metric.SaveMetricViewPreferences",
		attribute.String("plugin_id", plugin), attribute.String("resource_type", resourceKey))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return err
	}
	return s.Ctrl.SaveMetricViewPreferences(plugin, resourceKey, preferences)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) GetProviderConnections(
	ctx context.Context, plugin string,
) (_ []sdk.ProviderConnection, retErr error) {
	ctx, end := startOp(ctx, "metric.GetProviderConnections", attribute.String("plugin_id", plugin))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.GetProviderConnections(plugin)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) SaveProviderConnection(
	ctx context.Context, plugin string, input sdk.ProviderConnectionInput,
) (_ *sdk.ProviderConnection, retErr error) {
	ctx, end := startOp(ctx, "metric.SaveProviderConnection", attribute.String("plugin_id", plugin))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.SaveProviderConnection(plugin, input)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) DeleteProviderConnection(ctx context.Context, plugin, connection string) (retErr error) {
	ctx, end := startOp(ctx, "metric.DeleteProviderConnection",
		attribute.String("plugin_id", plugin), attribute.String("connection_id", connection))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return err
	}
	return s.Ctrl.DeleteProviderConnection(plugin, connection)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) GetDataSources(
	ctx context.Context, plugin, connection string,
) (_ []sdk.MetricDataSource, retErr error) {
	ctx, end := startOp(ctx, "metric.GetDataSources",
		attribute.String("plugin_id", plugin), attribute.String("connection_id", connection))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.GetDataSources(plugin, connection)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) TestProviderConnection(
	ctx context.Context, plugin, connection string,
) (_ *sdk.MetricValidationResult, retErr error) {
	ctx, end := startOp(ctx, "metric.TestProviderConnection",
		attribute.String("plugin_id", plugin), attribute.String("connection_id", connection))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.TestProviderConnection(plugin, connection)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) ValidateMetricDefinition(
	ctx context.Context, plugin, connection, datasourceUID string, definition sdk.MetricDefinition,
) (_ *sdk.MetricValidationResult, retErr error) {
	ctx, end := startOp(ctx, "metric.ValidateMetricDefinition",
		attribute.String("plugin_id", plugin), attribute.String("connection_id", connection))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.ValidateMetricDefinition(plugin, connection, datasourceUID, definition)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) DiscoverMetricLabels(
	ctx context.Context, plugin, connection, datasourceUID string, request sdk.MetricDiscoveryRequest,
) (_ *sdk.MetricDiscoveryResult, retErr error) {
	ctx, end := startOp(ctx, "metric.DiscoverMetricLabels",
		attribute.String("plugin_id", plugin), attribute.String("connection_id", connection))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.DiscoverMetricLabels(plugin, connection, datasourceUID, request)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) GetMetricDefinitions(ctx context.Context) (_ []sdk.MetricDefinition, retErr error) {
	ctx, end := startOp(ctx, "metric.GetMetricDefinitions")
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.GetMetricDefinitions()
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) GetMetricOwnerCatalog(
	ctx context.Context, ownerPlugin, ownerConnection string,
) (_ *sdk.MetricOwnerCatalog, retErr error) {
	ctx, end := startOp(ctx, "metric.GetMetricOwnerCatalog",
		attribute.String("plugin_id", ownerPlugin), attribute.String("connection_id", ownerConnection))
	defer end(&retErr)
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.GetMetricOwnerCatalog(ctx, ownerPlugin, ownerConnection)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) SaveMetricDefinition(
	ctx context.Context, ownerPlugin, ownerConnection string, definition sdk.MetricDefinition,
) (_ *sdk.MetricDefinition, retErr error) {
	ctx, end := startOp(ctx, "metric.SaveMetricDefinition",
		attribute.String("plugin_id", ownerPlugin), attribute.String("connection_id", ownerConnection))
	defer end(&retErr)
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.SaveMetricDefinition(ctx, ownerPlugin, ownerConnection, definition)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) DeleteMetricDefinition(ctx context.Context, id string) (retErr error) {
	ctx, end := startOp(ctx, "metric.DeleteMetricDefinition")
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return err
	}
	return s.Ctrl.DeleteMetricDefinition(id)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) GetMetricBindings(
	ctx context.Context, ownerPlugin, ownerConnection string,
) (_ []sdk.MetricBinding, retErr error) {
	ctx, end := startOp(ctx, "metric.GetMetricBindings",
		attribute.String("plugin_id", ownerPlugin), attribute.String("connection_id", ownerConnection))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return nil, err
	}
	return s.Ctrl.GetMetricBindings(ownerPlugin, ownerConnection)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) SaveMetricBinding(
	ctx context.Context, binding sdk.MetricBinding,
) (_ *sdk.MetricBinding, retErr error) {
	ctx, end := startOp(ctx, "metric.SaveMetricBinding")
	defer end(&retErr)
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.SaveMetricBinding(ctx, binding)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) DeleteMetricBinding(
	ctx context.Context, ownerPlugin, ownerConnection, id string,
) (retErr error) {
	ctx, end := startOp(ctx, "metric.DeleteMetricBinding",
		attribute.String("plugin_id", ownerPlugin), attribute.String("connection_id", ownerConnection))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return err
	}
	return s.Ctrl.DeleteMetricBinding(ownerPlugin, ownerConnection, id)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) GetMetricSourceDefaults(ctx context.Context) (_ sdk.MetricSourceDefaults, retErr error) {
	ctx, end := startOp(ctx, "metric.GetMetricSourceDefaults")
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return sdk.MetricSourceDefaults{}, err
	}
	return s.Ctrl.GetMetricSourceDefaults()
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) SaveMetricSourceDefaults(
	ctx context.Context, defaults sdk.MetricSourceDefaults,
) (_ sdk.MetricSourceDefaults, retErr error) {
	ctx, end := startOp(ctx, "metric.SaveMetricSourceDefaults")
	defer end(&retErr)
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return sdk.MetricSourceDefaults{}, err
	}
	return s.Ctrl.SaveMetricSourceDefaults(ctx, defaults)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) PreviewMetricDefinition(
	ctx context.Context, spec MetricsObservationSpec, definition sdk.MetricDefinition,
) (_ *sdk.ResourceMetricsResponse, retErr error) {
	ctx, end := startOp(ctx, "metric.PreviewMetricDefinition")
	defer end(&retErr)
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.PreviewMetricDefinition(ctx, spec, definition)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) GetMetricViewSourceSelection(
	ctx context.Context, ownerPlugin, ownerConnection, resourceKey string,
) (_ sdk.MetricViewSourceSelection, retErr error) {
	ctx, end := startOp(ctx, "metric.GetMetricViewSourceSelection",
		attribute.String("plugin_id", ownerPlugin), attribute.String("connection_id", ownerConnection),
		attribute.String("resource_type", resourceKey))
	defer end(&retErr)
	if _, _, err := s.metricSession(ctx); err != nil {
		return sdk.MetricViewSourceSelection{}, err
	}
	return s.Ctrl.GetMetricViewSourceSelection(ownerPlugin, ownerConnection, resourceKey)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (s *ServiceWrapper) SaveMetricViewSourceSelection(
	ctx context.Context, selection sdk.MetricViewSourceSelection,
) (_ sdk.MetricViewSourceSelection, retErr error) {
	ctx, end := startOp(ctx, "metric.SaveMetricViewSourceSelection")
	defer end(&retErr)
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return sdk.MetricViewSourceSelection{}, err
	}
	return s.Ctrl.SaveMetricViewSourceSelection(ctx, selection)
}
