package types

import (
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInProcessBackend_Dispense(t *testing.T) {
	provider := &struct{}{}
	providers := map[string]interface{}{"resource": provider}
	b := NewInProcessBackend(InProcessBackendConfig{Providers: providers})

	// Caller changes must not alter the backend's registered capabilities.
	delete(providers, "resource")
	providers["exec"] = provider
	raw, err := b.Dispense("resource")
	require.NoError(t, err)
	assert.Same(t, provider, raw)
	_, err = b.Dispense("exec")
	require.Error(t, err)
	caps, err := b.DetectCapabilities()
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"resource"}, caps)

	require.NoError(t, b.Stop())
	_, err = b.Dispense("resource")
	require.Error(t, err)
	assert.False(t, b.Healthy())
	assert.True(t, b.Exited())
}

func TestInProcessBackend_HealthCheck(t *testing.T) {
	var healthy atomic.Bool
	b := NewInProcessBackend(InProcessBackendConfig{HealthCheck: healthy.Load})
	assert.False(t, b.Healthy())
	healthy.Store(true)
	assert.True(t, b.Healthy())
}

func TestInProcessBackend_StoppedOverridesHealthCheck(t *testing.T) {
	b := NewInProcessBackend(InProcessBackendConfig{HealthCheck: func() bool { return true }})
	require.NoError(t, b.Stop())
	assert.False(t, b.Healthy(), "shutdown must fence custom health checks")
}

func TestInProcessBackend_HealthCompletionCannotOutliveStop(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	b := NewInProcessBackend(InProcessBackendConfig{HealthCheck: func() bool {
		close(entered)
		<-release
		return true
	}})
	result := make(chan bool, 1)
	go func() { result <- b.Healthy() }()
	unblock := sync.OnceFunc(func() { close(release) })
	t.Cleanup(unblock)
	awaitBackendResult(t, entered)

	stopped := make(chan error, 1)
	go func() { stopped <- b.Stop() }()
	require.NoError(t, awaitBackendResult(t, stopped))
	unblock()
	assert.False(t, awaitBackendResult(t, result))
}

func TestInProcessBackend_HealthCheckCanInspectState(t *testing.T) {
	var b *InProcessBackend
	b = NewInProcessBackend(InProcessBackendConfig{HealthCheck: func() bool {
		return !b.Exited()
	}})
	result := make(chan bool, 1)
	go func() { result <- b.Healthy() }()
	assert.True(t, awaitBackendResult(t, result))
}

func TestInProcessBackend_ShutdownReleasesStreamOnce(t *testing.T) {
	reader, writer := io.Pipe()
	t.Cleanup(func() { _ = reader.Close(); _ = writer.Close() })
	streamClosed := errors.New("native stream stopped")
	shutdownFailed := errors.New("native shutdown failed")
	workerDone := make(chan error, 1)
	go func() {
		_, err := io.Copy(io.Discard, reader)
		workerDone <- err
	}()

	entered := make(chan struct{})
	release := make(chan struct{})
	var shutdownCalls atomic.Int32
	var b *InProcessBackend
	b = NewInProcessBackend(InProcessBackendConfig{
		Providers: map[string]interface{}{"resource": reader},
		Shutdown: func() error {
			shutdownCalls.Add(1)
			// Observational calls are allowed during shutdown.
			if b.Healthy() || b.Exited() {
				return errors.New("backend reported running or exited during shutdown")
			}
			if err := writer.CloseWithError(streamClosed); err != nil {
				return err
			}
			close(entered)
			<-release
			return shutdownFailed
		},
	})

	const callers = 16
	results := make(chan error, callers)
	for range callers {
		go func() { results <- b.Stop() }()
	}
	killed := make(chan struct{})
	go func() { b.Kill(); close(killed) }()
	unblock := sync.OnceFunc(func() { close(release) })
	t.Cleanup(unblock)
	awaitBackendResult(t, entered)
	require.ErrorIs(t, awaitBackendResult(t, workerDone), streamClosed)
	assert.False(t, b.Healthy())
	assert.False(t, b.Exited(), "cleanup is still running")
	_, err := b.Dispense("resource")
	require.Error(t, err)

	// Concurrent stop callers must all observe the final shutdown error.
	unblock()
	for range callers {
		require.ErrorIs(t, awaitBackendResult(t, results), shutdownFailed)
	}
	awaitBackendResult(t, killed)
	assert.True(t, b.Exited())
	assert.EqualValues(t, 1, shutdownCalls.Load())
	require.ErrorIs(t, b.Stop(), shutdownFailed)
}

func TestInProcessBackend_KillWithoutShutdown(t *testing.T) {
	b := NewInProcessBackend(InProcessBackendConfig{})
	assert.True(t, b.Healthy())
	assert.False(t, b.Exited())
	b.Kill()
	assert.False(t, b.Healthy())
	assert.True(t, b.Exited())
	require.NoError(t, b.Stop())
}

func awaitBackendResult[T any](t *testing.T, result <-chan T) T {
	t.Helper()
	select {
	case value := <-result:
		return value
	case <-time.After(5 * time.Second):
		t.Fatal("backend operation did not complete")
		var zero T
		return zero
	}
}
