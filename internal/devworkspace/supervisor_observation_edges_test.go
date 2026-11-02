//go:build devcontrol && (darwin || linux)

package devworkspace

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

func TestSupervisorObservationEdgesStalledHostCannotHoldShutdownAuthority(t *testing.T) {
	s := supervisorEdgeFixture(t)
	host, err := s.workspace.RepositoryPath("omniview")
	require.NoError(t, err)
	profile, err := profileFor(s.workspace, s.manager.options.Home, s.generation)
	require.NoError(t, err)
	descriptor := profile.Descriptor
	owner := devsession.ProcessOwner{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, Role: "host", Source: host}
	descriptor.Process, err = devsession.CaptureProcess(os.Getpid(), owner)
	require.NoError(t, err)
	descriptor.Readiness = "host-ready"
	store, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
	require.NoError(t, err)
	inspecting, release := make(chan struct{}), make(chan struct{})
	var firstInspection, releaseOnce sync.Once
	server, err := devcontrol.Start(context.Background(), devcontrol.Config{
		Descriptor: descriptor, Discovery: store,
		Adapters: devcontrol.Adapters{
			Inspect: func(ctx context.Context) (devcontract.InstanceDescriptor, error) {
				blocked := false
				firstInspection.Do(func() { blocked = true; close(inspecting) })
				if blocked {
					select {
					case <-release:
					case <-ctx.Done():
						return devcontract.InstanceDescriptor{}, ctx.Err()
					}
				}
				return descriptor, nil
			},
			Dev:     &readinessProducer{states: map[string]devcontrol.DevState{}},
			Plugins: struct{ devcontrol.Plugins }{}, Settings: struct{ devcontrol.Settings }{},
		},
	})
	require.NoError(t, err)
	defer func() {
		releaseOnce.Do(func() { close(release) })
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		require.NoError(t, server.Close(cleanup))
	}()
	s.setPhase("ready", nil)
	statusCtx, cancelStatus := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelStatus()
	observation := make(chan supervisorEdgeResult, 1)
	joined := false
	go func() {
		status, err := s.execute(statusCtx, supervisorStatusCommand)
		observation <- supervisorEdgeResult{status, err}
	}()
	defer func() {
		cancelStatus()
		releaseOnce.Do(func() { close(release) })
		if !joined {
			receiveSupervisorEdge(t, observation)
		}
	}()
	select {
	case <-inspecting:
	case <-time.After(3 * time.Second):
		t.Fatal("status did not reach the stalled host inspection")
	}
	stopCtx, cancelStop := context.WithCancel(context.Background())
	defer cancelStop()
	admitted := make(chan struct{})
	cancelSession := s.sessionCancel
	s.sessionCancel = func() { cancelSession(); cancelStop(); close(admitted) }
	stopping := make(chan supervisorEdgeResult, 1)
	go func() {
		status, err := s.execute(stopCtx, supervisorStopCommand)
		stopping <- supervisorEdgeResult{status, err}
	}()
	select {
	case <-admitted:
	case <-time.After(time.Second):
		t.Error("stalled host observation retained source authority against shutdown")
		cancelStop()
		releaseOnce.Do(func() { close(release) })
	}
	result := receiveSupervisorEdge(t, stopping)
	require.ErrorIs(t, result.err, context.Canceled)
	require.ErrorIs(t, s.sessionContext.Err(), context.Canceled)
	require.NoError(t, devsession.VerifyOwnedProcess(descriptor.Process, owner), "canceled shutdown cannot claim or signal this test-owned host")
	releaseOnce.Do(func() { close(release) })
	observed := receiveSupervisorEdge(t, observation)
	joined = true
	require.NoError(t, observed.err)
	require.NotEqual(t, "ready", observed.status.Phase, "a delayed host response cannot undo an admitted shutdown")
	require.Nil(t, observed.status.Instance)
}

func TestSupervisorStatusDelayedHostObservation(t *testing.T) {
	for _, cancelObservation := range []bool{false, true} {
		t.Run(map[bool]string{false: "released", true: "canceled"}[cancelObservation], func(t *testing.T) {
			s := supervisorEdgeFixture(t)
			host, err := s.workspace.RepositoryPath("omniview")
			require.NoError(t, err)
			profile, err := profileFor(s.workspace, s.manager.options.Home, s.generation)
			require.NoError(t, err)
			descriptor := profile.Descriptor
			owner := devsession.ProcessOwner{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, Role: "host", Source: host}
			descriptor.Process, err = devsession.CaptureProcess(os.Getpid(), owner)
			require.NoError(t, err)
			descriptor.Readiness = "host-ready"
			store, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
			require.NoError(t, err)
			entered, release := make(chan struct{}), make(chan struct{})
			var releaseOnce sync.Once
			server, err := devcontrol.Start(context.Background(), devcontrol.Config{
				Descriptor: descriptor, Discovery: store,
				Adapters: devcontrol.Adapters{
					Inspect: func(ctx context.Context) (devcontract.InstanceDescriptor, error) {
						close(entered)
						select {
						case <-release:
							return descriptor, nil
						case <-ctx.Done():
							return devcontract.InstanceDescriptor{}, ctx.Err()
						}
					},
					Dev:     &readinessProducer{states: map[string]devcontrol.DevState{}},
					Plugins: struct{ devcontrol.Plugins }{}, Settings: struct{ devcontrol.Settings }{},
				},
			})
			require.NoError(t, err)
			defer func() {
				releaseOnce.Do(func() { close(release) })
				cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				require.NoError(t, server.Close(cleanup))
			}()
			s.setPhase("ready", nil)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			result := make(chan supervisorEdgeResult, 1)
			go func() {
				status, err := s.execute(ctx, supervisorStatusCommand)
				result <- supervisorEdgeResult{status, err}
			}()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("status did not reach host observation")
			}
			select {
			case <-result:
				t.Fatal("status completed before host observation")
			default:
			}
			if cancelObservation {
				cancel()
			} else {
				releaseOnce.Do(func() { close(release) })
			}
			observed := receiveSupervisorEdge(t, result)
			if cancelObservation {
				require.ErrorIs(t, observed.err, context.Canceled)
			} else {
				require.NoError(t, observed.err)
				require.Equal(t, "ready", observed.status.Phase)
				require.NotNil(t, observed.status.Instance)
			}
		})
	}
}
