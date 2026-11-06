package metric

import (
	"context"
	"time"

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
		return ctx, nil, finiteError("DENIED", "Metrics observations require an authenticated frontend window.")
	}
	s.sessionsMu.Lock()
	defer s.sessionsMu.Unlock()
	if s.sessions == nil {
		s.sessions = map[uint]*metricFrontendSession{}
	}
	if s.closedWindows == nil {
		s.closedWindows = map[uint]time.Time{}
	}
	now := time.Now()
	for id, until := range s.closedWindows {
		if !now.Before(until) {
			delete(s.closedWindows, id)
		}
	}
	if _, closed := s.closedWindows[window.ID()]; closed {
		return ctx, nil, finiteError("CANCELLED", "Metric frontend session closed.")
	}
	session := s.sessions[window.ID()]
	if session == nil {
		if len(s.sessions) >= 64 || len(s.closedWindows) >= 1024 {
			return ctx, nil, finiteError("RESOURCE_LIMIT", "Metric frontend session limit exceeded.")
		}
		scope := invocation.NewScope(invocation.TrustedUI)
		life, cancel := context.WithCancel(scope.Context(context.Background()))
		session = &metricFrontendSession{scope: scope, ctx: life, cancel: cancel, window: window}
		s.sessions[window.ID()] = session
		window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
			cancel()
			s.Ctrl.RetireMetricsSession(life)
			s.sessionsMu.Lock()
			s.closedWindows[window.ID()] = time.Now().Add(finitePendingTTL)
			if s.sessions[window.ID()] == session {
				delete(s.sessions, window.ID())
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

// GetResourceMetricsCatalog resolves only an admitted owner native source.
func (s *ServiceWrapper) GetResourceMetricsCatalog(ctx context.Context, plugin, connection, resourceKey string) (*sdk.ResourceMetricsCatalog, error) {
	ctx, _, err := s.metricSession(ctx)
	if err != nil {
		return nil, err
	}
	return s.Ctrl.GetResourceMetricsCatalog(ctx, plugin, connection, resourceKey)
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
