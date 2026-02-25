package types

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInProcessBackend_Dispense_Success(t *testing.T) {
	b := NewInProcessBackend(map[string]interface{}{
		"resource": "mock-resource",
	})

	raw, err := b.Dispense("resource")
	require.NoError(t, err)
	assert.Equal(t, "mock-resource", raw)
}

func TestInProcessBackend_Dispense_NotFound(t *testing.T) {
	b := NewInProcessBackend(map[string]interface{}{})

	_, err := b.Dispense("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no provider registered")
}

func TestInProcessBackend_Dispense_Stopped(t *testing.T) {
	b := NewInProcessBackend(map[string]interface{}{
		"resource": "mock",
	})
	require.NoError(t, b.Stop())

	_, err := b.Dispense("resource")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "stopped")
}

func TestInProcessBackend_Healthy_Default(t *testing.T) {
	b := NewInProcessBackend(nil)
	assert.True(t, b.Healthy())
}

func TestInProcessBackend_Healthy_AfterStop(t *testing.T) {
	b := NewInProcessBackend(nil)
	require.NoError(t, b.Stop())
	assert.False(t, b.Healthy())
}

func TestInProcessBackend_Healthy_CustomFunc(t *testing.T) {
	b := NewInProcessBackend(nil)
	b.HealthFunc = func() bool { return false }
	assert.False(t, b.Healthy())

	b.HealthFunc = func() bool { return true }
	assert.True(t, b.Healthy())
}

func TestInProcessBackend_Stop(t *testing.T) {
	b := NewInProcessBackend(nil)
	assert.False(t, b.Exited())

	require.NoError(t, b.Stop())
	assert.True(t, b.Exited())
}

func TestInProcessBackend_Kill(t *testing.T) {
	b := NewInProcessBackend(nil)
	b.Kill()
	assert.True(t, b.Exited())
}

func TestInProcessBackend_Exited(t *testing.T) {
	b := NewInProcessBackend(nil)
	assert.False(t, b.Exited())

	b.Stop()
	assert.True(t, b.Exited())
}

func TestInProcessBackend_DetectCapabilities(t *testing.T) {
	b := NewInProcessBackend(map[string]interface{}{
		"resource": "mock",
		"exec":     "mock",
	})

	caps, err := b.DetectCapabilities()
	require.NoError(t, err)
	assert.Len(t, caps, 2)
	assert.Contains(t, caps, "resource")
	assert.Contains(t, caps, "exec")
}

func TestInProcessBackend_DetectCapabilities_Empty(t *testing.T) {
	b := NewInProcessBackend(nil)

	caps, err := b.DetectCapabilities()
	require.NoError(t, err)
	assert.Empty(t, caps)
}

func TestInProcessBackend_NilProviders(t *testing.T) {
	b := NewInProcessBackend(nil)
	assert.NotNil(t, b.providers)
	assert.Empty(t, b.providers)
}
