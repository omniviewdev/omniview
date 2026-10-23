//go:build darwin || linux

package devserver

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/stretchr/testify/require"
)

// The FIFO is a real source-metadata read barrier: opening its writer proves
// that the actual Go build has completed and the publisher has entered its
// metadata read. No compiler, filesystem watcher, or publication is replaced.
func TestGoWatcherStopRetiresActivePublisher(t *testing.T) {
	goPath, err := exec.LookPath("go")
	require.NoError(t, err)

	for _, initial := range []bool{false, true} {
		name := "debounced-rebuild"
		if initial {
			name = "initial-build"
		}
		t.Run(name, func(t *testing.T) {
			const id = "stop-publisher"
			source := managedSourceFixture(t, id)
			require.NoError(t, os.Mkdir(filepath.Join(source, "pkg"), 0700))
			require.NoError(t, os.WriteFile(filepath.Join(source, "go.mod"), []byte("module example.invalid/stop-publisher\n\ngo 1.22\n"), 0600))
			mainPath := filepath.Join(source, "pkg", "main.go")
			program := func(value string) []byte {
				return []byte(fmt.Sprintf("package main\nimport \"fmt\"\nfunc main() { fmt.Print(%q) }\n", value))
			}
			require.NoError(t, os.WriteFile(mainPath, program("before-stop"), 0600))
			metadataPath := filepath.Join(source, "plugin.yaml")
			metadata := []byte("id: stop-publisher\nname: Before Stop\nversion: 1.0.0\ncapabilities: [resource]\n")
			require.NoError(t, os.WriteFile(metadataPath, metadata, 0600))

			// Child builds must not inherit the verification runner's modfile or
			// workspace identity; this is an independent temporary Go module.
			environment := make([]string, 0, len(os.Environ()))
			for _, entry := range os.Environ() {
				if !strings.HasPrefix(entry, "GOFLAGS=") && !strings.HasPrefix(entry, "OMNIVIEW_WORKSPACE_ID=") {
					environment = append(environment, entry)
				}
			}
			manager := newTestManager(t)
			options := BuildOpts{GoPath: goPath, Environment: environment, DisableDependencyWatching: true}
			inst := NewDevServerInstance(context.Background(), logging.NewNop(), id, source, 0, options,
				&mockPluginReloader{}, manager.pluginsRoot, func(string, DevServerState) {},
				func(string, []LogEntry) {}, func(string, []BuildError) {})
			inst.hasBackend = true
			inst.initializeStages()
			watcher := newGoWatcherProcess(inst.ctx, logging.NewNop(), id, source, options, inst.reloader,
				manager.pluginsRoot, inst.appendLog, inst.setGoStatus, inst.setBuildResult, inst.onErrors)
			inst.goWatcher = watcher
			manager.instances[id] = inst

			var writer *os.File
			t.Cleanup(func() {
				watcher.cancel()
				var fallback *os.File
				if writer != nil {
					_ = writer.Close()
				} else {
					// Keep a writer present while cancellation reaches any
					// reader already opening the FIFO, then release it below.
					fallback, _ = os.OpenFile(metadataPath, os.O_RDWR|syscall.O_NONBLOCK, 0)
				}
				_ = inst.Stop()
				if fallback != nil {
					_ = fallback.Close()
				}
				drained := make(chan struct{})
				go func() {
					watcher.buildMu.Lock()
					watcher.buildMu.Unlock()
					close(drained)
				}()
				select {
				case <-drained:
				case <-time.After(10 * time.Second):
					t.Error("fixture cleanup could not retire the artifact publisher")
				}
			})

			installedMetadata := manager.pluginsRoot.ResolvePath(filepath.Join(id, "plugin.yaml"))
			installedBinary := manager.pluginsRoot.ResolvePath(filepath.Join(id, "bin", "plugin"))
			var previousMetadata []byte
			if !initial {
				require.NoError(t, watcher.Start())
				previousMetadata, err = os.ReadFile(installedMetadata)
				require.NoError(t, err)
				output, runErr := exec.Command(installedBinary).Output()
				require.NoError(t, runErr)
				require.Equal(t, "before-stop", string(output), "baseline must be a real runnable build")
			}

			require.NoError(t, os.Remove(metadataPath))
			require.NoError(t, syscall.Mkfifo(metadataPath, 0600))
			startDone := make(chan error, 1)
			if initial {
				require.NoError(t, os.WriteFile(mainPath, program("after-stop"), 0600))
				go func() { startDone <- watcher.Start() }()
			} else {
				// This real fsnotify write must reach the debounced timer
				// callback, not a direct invocation of handleRebuild.
				require.NoError(t, os.WriteFile(mainPath, program("after-stop"), 0600))
			}
			require.Eventually(t, func() bool {
				var openErr error
				writer, openErr = os.OpenFile(metadataPath, os.O_WRONLY|syscall.O_NONBLOCK, 0)
				if openErr != nil && !errors.Is(openErr, syscall.ENXIO) {
					t.Fatalf("open publication barrier: %v", openErr)
				}
				return openErr == nil
			}, 30*time.Second, 10*time.Millisecond, "actual build never reached the metadata publication barrier")

			stopDone := make(chan error, 1)
			go func() { stopDone <- manager.StopDevServer(id) }()
			var stopErr error
			stopReturned := false
			select {
			case stopErr = <-stopDone:
				stopReturned = true
				if stopErr == nil {
					t.Error("managed stop returned success while the real artifact publisher was still blocked")
				}
				if !manager.IsManaged(id) {
					t.Error("managed stop released ownership before the artifact publisher retired")
				}
			case <-time.After(goWatcherStopTimeout + 2*time.Second):
				t.Error("managed stop did not return a bounded failure for an unretired publisher")
			}

			// Release only after Stop has returned (or exceeded its bound).
			// A cancelled owner must not install these capabilities or bytes,
			// even if a late lifecycle reload would reject the old generation.
			_, writeErr := writer.Write([]byte("id: stop-publisher\nname: After Stop\nversion: 2.0.0\ncapabilities: [resource]\n"))
			require.NoError(t, writeErr)
			require.NoError(t, writer.Close())
			drained := make(chan struct{})
			go func() {
				watcher.buildMu.Lock()
				watcher.buildMu.Unlock()
				close(drained)
			}()
			select {
			case <-drained:
			case <-time.After(10 * time.Second):
				t.Fatal("artifact publisher did not retire after its metadata read was released")
			}
			if initial {
				select {
				case startErr := <-startDone:
					if startErr != nil && !errors.Is(startErr, context.Canceled) {
						t.Errorf("initial Start failed: %v", startErr)
					}
				case <-time.After(10 * time.Second):
					t.Fatal("initial Start did not retire after its publisher was released")
				}
			}
			if !stopReturned {
				select {
				case <-stopDone:
				case <-time.After(10 * time.Second):
					t.Fatal("managed stop remained blocked after its publisher retired")
				}
			}

			if initial {
				for _, path := range []string{installedMetadata, installedBinary} {
					if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
						t.Errorf("cancelled initial publisher installed %s after Stop: %v", filepath.Base(path), statErr)
					}
				}
			} else {
				actualMetadata, readErr := os.ReadFile(installedMetadata)
				require.NoError(t, readErr)
				if !bytes.Equal(previousMetadata, actualMetadata) {
					t.Errorf("cancelled publisher changed installed metadata after Stop: %s", actualMetadata)
				}
				output, runErr := exec.Command(installedBinary).Output()
				require.NoError(t, runErr)
				require.Equal(t, "before-stop", string(output), "cancelled publisher replaced the runnable installed executable after Stop")
			}
			require.NoError(t, manager.StopDevServer(id), "retired publisher must permit a confirmed stop on retry")
			require.False(t, manager.IsManaged(id), "confirmed retirement must release managed ownership")
		})
	}
}

type stoppingGoWatcherReloader struct {
	stop func(string) error
}

func (reloader stoppingGoWatcherReloader) ReloadPlugin(id string) error {
	if err := reloader.stop(id); err != nil {
		return err
	}
	return errors.New("reload finished after stopping its watcher")
}

func TestGoWatcherReloaderCanStopItsPublisher(t *testing.T) {
	goPath, err := exec.LookPath("go")
	require.NoError(t, err)
	const id = "reentrant-stop"
	source := managedSourceFixture(t, id)
	require.NoError(t, os.Mkdir(filepath.Join(source, "pkg"), 0700))
	for relative, content := range map[string]string{
		"go.mod":      "module example.invalid/reentrant-stop\n\ngo 1.22\n",
		"pkg/main.go": "package main\nimport \"fmt\"\nfunc main() { fmt.Print(\"reentrant-stop\") }\n",
		"plugin.yaml": "id: reentrant-stop\nname: Reentrant Stop\nversion: 1.0.0\ncapabilities: [resource]\n",
	} {
		require.NoError(t, os.WriteFile(filepath.Join(source, relative), []byte(content), 0600))
	}
	environment := make([]string, 0, len(os.Environ()))
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "GOFLAGS=") && !strings.HasPrefix(entry, "OMNIVIEW_WORKSPACE_ID=") {
			environment = append(environment, entry)
		}
	}
	manager := newTestManager(t)
	options := BuildOpts{GoPath: goPath, Environment: environment, DisableDependencyWatching: true}
	reloader := stoppingGoWatcherReloader{stop: manager.StopDevServer}
	inst := NewDevServerInstance(context.Background(), logging.NewNop(), id, source, 0, options,
		reloader, manager.pluginsRoot, func(string, DevServerState) {},
		func(string, []LogEntry) {}, func(string, []BuildError) {})
	inst.hasBackend = true
	inst.initializeStages()
	watcher := newGoWatcherProcess(inst.ctx, logging.NewNop(), id, source, options, reloader,
		manager.pluginsRoot, inst.appendLog, inst.setGoStatus, inst.setBuildResult, inst.onErrors)
	watcher.runtimeError = func(err error) { inst.notifyLifecycle(false, false, err) }
	inst.goWatcher = watcher
	manager.instances[id] = inst
	t.Cleanup(func() { _ = inst.Stop() })

	startDone := make(chan error, 1)
	go func() { startDone <- watcher.Start() }()
	select {
	case startErr := <-startDone:
		require.NoError(t, startErr)
	case <-time.After(30 * time.Second):
		t.Fatal("initial lifecycle reload could not stop its own publisher")
	}

	require.False(t, manager.IsManaged(id), "reentrant stop must confirm retirement, not time out")
	state := inst.State()
	require.Equal(t, DevProcessStatusStopped, state.GoStatus)
	require.Equal(t, StageStopped, state.BuildStatus)
	require.Equal(t, StageStopped, state.RPCStatus)
	require.Empty(t, state.LastError, "reload error after retirement must not mutate the stopped generation")
	binary := manager.pluginsRoot.ResolvePath(filepath.Join(id, "bin", "plugin"))
	output, runErr := exec.Command(binary).Output()
	require.NoError(t, runErr)
	require.Equal(t, "reentrant-stop", string(output), "reloader must follow a real completed publication")
}

type serializingGoWatcherReloader struct {
	manager      *DevServerManager
	source       string
	binary       string
	firstEntered chan struct{}
	releaseFirst chan struct{}
	secondReady  chan struct{}
	firstError   error
}

func (reloader *serializingGoWatcherReloader) ReloadPlugin(string) error {
	return errors.New("serialization fixture requires the managed lifecycle boundary")
}

func (reloader *serializingGoWatcherReloader) ReloadManagedPlugin(ctx context.Context, id, source, generation string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if source != reloader.source || generation != reloader.manager.LifecycleGeneration(id, source) {
		return errors.New("managed source/generation changed")
	}
	output, err := exec.Command(reloader.binary).Output()
	if err != nil {
		return err
	}
	switch string(output) {
	case "first-build":
		close(reloader.firstEntered)
		<-reloader.releaseFirst
		return reloader.firstError
	case "second-build":
		runtimeGeneration := reloader.manager.RuntimeGeneration(id, source)
		if !reloader.manager.NotifyPluginLifecycle(id, source, runtimeGeneration, true, true, nil) {
			return errors.New("compiled second consumer could not report its lifecycle")
		}
		close(reloader.secondReady)
		return nil
	default:
		return fmt.Errorf("unexpected compiled consumer output %q", output)
	}
}

func TestGoWatcherSerializesPublicationThroughReload(t *testing.T) {
	goPath, err := exec.LookPath("go")
	require.NoError(t, err)
	const id = "ordered-reloads"
	source := managedSourceFixture(t, id)
	require.NoError(t, os.Mkdir(filepath.Join(source, "pkg"), 0700))
	mainPath := filepath.Join(source, "pkg", "main.go")
	program := func(value string) []byte {
		return []byte(fmt.Sprintf("package main\nimport \"fmt\"\nfunc main() { fmt.Print(%q) }\n", value))
	}
	require.NoError(t, os.WriteFile(mainPath, program("first-build"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(source, "go.mod"), []byte("module example.invalid/ordered-reloads\n\ngo 1.22\n"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(source, "plugin.yaml"),
		[]byte("id: ordered-reloads\nname: Ordered Reloads\nversion: 1.0.0\ncapabilities: [resource]\n"), 0600))
	environment := make([]string, 0, len(os.Environ()))
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "GOFLAGS=") && !strings.HasPrefix(entry, "OMNIVIEW_WORKSPACE_ID=") {
			environment = append(environment, entry)
		}
	}
	manager := newTestManager(t)
	reloader := &serializingGoWatcherReloader{
		manager:      manager,
		source:       source,
		binary:       manager.pluginsRoot.ResolvePath(filepath.Join(id, "bin", "plugin")),
		firstEntered: make(chan struct{}),
		releaseFirst: make(chan struct{}),
		secondReady:  make(chan struct{}),
		firstError:   errors.New("first compiled consumer reload failed"),
	}
	options := BuildOpts{GoPath: goPath, Environment: environment, DisableDependencyWatching: true}
	inst := NewDevServerInstance(context.Background(), logging.NewNop(), id, source, 0, options,
		reloader, manager.pluginsRoot, func(string, DevServerState) {},
		func(string, []LogEntry) {}, func(string, []BuildError) {})
	inst.hasBackend = true
	inst.initializeStages()
	inst.buildOpts.Generation = inst.generation
	var builds atomic.Int32
	secondBuilding := make(chan struct{})
	watcher := newGoWatcherProcess(inst.ctx, logging.NewNop(), id, source, inst.buildOpts, reloader,
		manager.pluginsRoot, inst.appendLog, func(status DevProcessStatus) {
			inst.setGoStatus(status)
			if status == DevProcessStatusBuilding && builds.Add(1) == 2 {
				close(secondBuilding)
			}
		}, inst.setBuildResult, inst.onErrors)
	watcher.runtimeError = func(err error) { inst.notifyLifecycle(false, false, err) }
	inst.goWatcher = watcher
	manager.instances[id] = inst

	releaseFirst := sync.OnceFunc(func() { close(reloader.releaseFirst) })
	var requests sync.WaitGroup
	t.Cleanup(func() {
		releaseFirst()
		_ = inst.Stop()
		done := make(chan struct{})
		go func() { requests.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("managed rebuild requests did not retire during fixture cleanup")
		}
	})
	firstResult := make(chan error, 1)
	requests.Add(1)
	go func() {
		defer requests.Done()
		firstResult <- manager.RebuildPlugin(id)
	}()
	select {
	case <-reloader.firstEntered:
	case <-time.After(30 * time.Second):
		t.Fatal("first real build did not enter the managed reload barrier")
	}
	require.NoError(t, os.WriteFile(mainPath, program("second-build"), 0600))
	secondResult := make(chan error, 1)
	requests.Add(1)
	go func() {
		defer requests.Done()
		secondResult <- manager.RebuildPlugin(id)
	}()

	// The first consumer has actually executed and is still reloading. The
	// second request may queue, but must not publish/ready its replacement yet.
	select {
	case <-secondBuilding:
		t.Error("second build became active while the first reload was still blocked")
		select {
		case <-reloader.secondReady:
		case <-time.After(30 * time.Second):
			t.Fatal("concurrent second real build did not reach its lifecycle consumer")
		}
	case <-time.After(5 * time.Second):
	}
	releaseFirst()
	select {
	case firstErr := <-firstResult:
		require.ErrorIs(t, firstErr, reloader.firstError)
	case <-time.After(30 * time.Second):
		t.Fatal("first managed rebuild did not return after releasing its reload")
	}
	select {
	case secondErr := <-secondResult:
		require.NoError(t, secondErr)
	case <-time.After(30 * time.Second):
		t.Fatal("queued second managed rebuild did not finish")
	}

	output, runErr := exec.Command(reloader.binary).Output()
	require.NoError(t, runErr)
	require.Equal(t, "second-build", string(output), "the installed consumer must be the second real Go build")
	state := manager.GetDevServerState(id)
	require.True(t, state.Ready, "the first reload's error must not poison its ready replacement: %+v", state)
	require.Equal(t, StageReady, state.BuildStatus)
	require.Equal(t, StageReady, state.RPCStatus)
	require.Equal(t, StageReady, state.ControllerStatus)
	require.Empty(t, state.LastError)
}
