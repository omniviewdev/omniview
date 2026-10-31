//go:build devcontrol

package host

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/instance"
)

// Registered last: Wails starts services in order and shuts them down in reverse.
// Thus no control mutation precedes controller/bootstrap startup or outlives its managers.
type developmentControlLifecycle struct {
	mu               sync.Mutex
	runtimeReady     bool
	profile          instance.Profile
	readSnapshot     func() devcontract.InstanceDescriptor
	publishSnapshot  func(devcontract.InstanceDescriptor)
	manager          plugin.Manager
	dev              *devserver.DevServerManager
	settings         *settingsservice.Service
	server           *devcontrol.Server
	benchmarkMetrics *resourceBenchmarkMetrics
}

// Register adds development control after all services that its adapters depend on.
// The callbacks retain host-only ownership of the authoritative instance snapshot.
func Register(
	app *application.App,
	profile instance.Profile,
	readSnapshot func() devcontract.InstanceDescriptor,
	publishSnapshot func(devcontract.InstanceDescriptor),
	manager plugin.Manager,
	dev *devserver.DevServerManager,
	settings *settingsservice.Service,
) (func(), error) {
	if profile.Descriptor.Kind != "development" {
		return nil, nil
	}
	lifecycle := &developmentControlLifecycle{
		mu:               sync.Mutex{},
		runtimeReady:     false,
		profile:          profile,
		readSnapshot:     readSnapshot,
		publishSnapshot:  publishSnapshot,
		manager:          manager,
		dev:              dev,
		settings:         settings,
		server:           nil,
		benchmarkMetrics: nil,
	}
	app.RegisterService(application.NewService(lifecycle))
	return lifecycle.markRuntimeReady, nil
}

func (s *developmentControlLifecycle) inspect(context.Context) (devcontract.InstanceDescriptor, error) {
	descriptor := s.readSnapshot()
	descriptor.Plugins = nil
	for _, plugin := range s.manager.ListPlugins() {
		state := s.dev.GetDevServerState(plugin.ID)
		descriptor.Plugins = append(descriptor.Plugins, devcontract.PluginState{ID: plugin.ID, Version: plugin.Metadata.Version, Source: state.DevPath, Generation: state.Generation, Mode: string(state.Mode), BuildStatus: string(state.BuildStatus), ViteStatus: string(state.ViteStatus), RPCStatus: string(state.RPCStatus), ControllerStatus: string(state.ControllerStatus)})
	}
	return descriptor, nil
}

func (s *developmentControlLifecycle) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	descriptor := s.profile.Descriptor
	source, err := s.profile.Workspace.RepositoryPath("omniview")
	if err != nil {
		return err
	}
	process, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: descriptor.WorkspaceID, Generation: descriptor.Generation, Role: "host", Source: source})
	if err != nil {
		return fmt.Errorf("capture development host ownership: %w", err)
	}
	descriptor.Process = process
	descriptor.Readiness = "backend-ready"
	if s.runtimeReady {
		descriptor.Readiness = "host-ready"
	}
	s.publishSnapshot(descriptor)
	discovery, err := devsession.OpenDiscoveryStore(s.profile.RuntimeRoot)
	if err != nil {
		return err
	}
	server, err := devcontrol.Start(ctx, devcontrol.Config{
		Descriptor: descriptor,
		Discovery:  discovery,
		Adapters:   New(s.manager, s.dev, s.settings, s.inspect),
	})
	if err != nil {
		return err
	}
	s.server = server
	endpoint := server.Endpoint()
	descriptor.Endpoints.Control = &endpoint
	s.publishSnapshot(descriptor)
	if err := server.Refresh(ctx, descriptor); err != nil {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Close(closeCtx)
		s.server = nil
		return err
	}
	metrics, err := startResourceBenchmarkMetrics(ctx, os.Getenv("OMNIVIEW_P02_METRICS_SOCKET"), descriptor)
	if err != nil {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Close(closeCtx)
		s.server = nil
		return fmt.Errorf("start requested P02 benchmark metrics: %w", err)
	}
	s.benchmarkMetrics = metrics
	go s.observeEndpoints(ctx)
	return nil
}

func (s *developmentControlLifecycle) markRuntimeReady() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.runtimeReady = true
	descriptor := s.readSnapshot()
	descriptor.Readiness = "host-ready"
	s.publishSnapshot(descriptor)
	if s.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := s.server.Refresh(ctx, descriptor); err != nil {
			fmt.Fprintln(os.Stderr, "warning: cannot publish development runtime readiness")
		}
	}
}

func (s *developmentControlLifecycle) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	metricsErr := s.benchmarkMetrics.Close()
	if s.server == nil {
		return metricsErr
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return errors.Join(metricsErr, s.server.Close(ctx))
}
