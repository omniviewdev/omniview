package resource

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// ============================================================================
// Get
// ============================================================================

func TestGet_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFunc: func(_ context.Context, key string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Success: true, Result: json.RawMessage(`{"key":"` + key + `"}`)}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	result, err := ctrl.Get("p1", "conn-1", "pods", resource.GetInput{})
	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.Contains(t, string(result.Result), "pods")
}

func TestGet_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return nil, errors.New("not found")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.Get("p1", "conn-1", "pods", resource.GetInput{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestGet_ConnectionError_TriggersCrash(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return nil, status.Error(codes.Unavailable, "connection lost")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.Get("p1", "conn-1", "pods", resource.GetInput{})
	assert.Error(t, err)

	events := emitter.EventsWithKey("plugin/crash")
	assert.NotEmpty(t, events)
}

func TestGet_NonConnectionError_NoCrash(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return nil, status.Error(codes.NotFound, "resource not found")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, _ = ctrl.Get("p1", "conn-1", "pods", resource.GetInput{})

	events := emitter.EventsWithKey("plugin/crash")
	assert.Empty(t, events)
}

func TestGet_ContextHasSession(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFunc: func(ctx context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			session := resource.SessionFromContext(ctx)
			assert.NotNil(t, session)
			assert.Equal(t, "conn-1", session.Connection.ID)
			return &resource.GetResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.Get("p1", "conn-1", "pods", resource.GetInput{})
	require.NoError(t, err)
}

// ============================================================================
// List
// ============================================================================

func TestList_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ListFunc: func(_ context.Context, _ string, _ resource.ListInput) (*resource.ListResult, error) {
			return &resource.ListResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	result, err := ctrl.List("p1", "conn-1", "pods", resource.ListInput{})
	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestList_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ListFunc: func(_ context.Context, _ string, _ resource.ListInput) (*resource.ListResult, error) {
			return nil, errors.New("list error")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.List("p1", "conn-1", "pods", resource.ListInput{})
	assert.Error(t, err)
}

func TestList_ConnectionError_TriggersCrash(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ListFunc: func(_ context.Context, _ string, _ resource.ListInput) (*resource.ListResult, error) {
			return nil, status.Error(codes.Unavailable, "dead")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, _ = ctrl.List("p1", "conn-1", "pods", resource.ListInput{})
	assert.NotEmpty(t, emitter.EventsWithKey("plugin/crash"))
}

// ============================================================================
// Find
// ============================================================================

func TestFind_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		FindFunc: func(_ context.Context, _ string, _ resource.FindInput) (*resource.FindResult, error) {
			return &resource.FindResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	result, err := ctrl.Find("p1", "conn-1", "pods", resource.FindInput{})
	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestFind_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		FindFunc: func(_ context.Context, _ string, _ resource.FindInput) (*resource.FindResult, error) {
			return nil, errors.New("find error")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.Find("p1", "conn-1", "pods", resource.FindInput{})
	assert.Error(t, err)
}

func TestFind_ConnectionError_TriggersCrash(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		FindFunc: func(_ context.Context, _ string, _ resource.FindInput) (*resource.FindResult, error) {
			return nil, status.Error(codes.Unavailable, "dead")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, _ = ctrl.Find("p1", "conn-1", "pods", resource.FindInput{})
	assert.NotEmpty(t, emitter.EventsWithKey("plugin/crash"))
}

// ============================================================================
// Create
// ============================================================================

func TestCreate_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		CreateFunc: func(_ context.Context, _ string, _ resource.CreateInput) (*resource.CreateResult, error) {
			return &resource.CreateResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	result, err := ctrl.Create("p1", "conn-1", "pods", resource.CreateInput{})
	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestCreate_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		CreateFunc: func(_ context.Context, _ string, _ resource.CreateInput) (*resource.CreateResult, error) {
			return nil, errors.New("create error")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.Create("p1", "conn-1", "pods", resource.CreateInput{})
	assert.Error(t, err)
}

func TestCreate_ConnectionError_TriggersCrash(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		CreateFunc: func(_ context.Context, _ string, _ resource.CreateInput) (*resource.CreateResult, error) {
			return nil, status.Error(codes.Unavailable, "dead")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, _ = ctrl.Create("p1", "conn-1", "pods", resource.CreateInput{})
	assert.NotEmpty(t, emitter.EventsWithKey("plugin/crash"))
}

// ============================================================================
// Update
// ============================================================================

func TestUpdate_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		UpdateFunc: func(_ context.Context, _ string, _ resource.UpdateInput) (*resource.UpdateResult, error) {
			return &resource.UpdateResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	result, err := ctrl.Update("p1", "conn-1", "pods", resource.UpdateInput{})
	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestUpdate_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		UpdateFunc: func(_ context.Context, _ string, _ resource.UpdateInput) (*resource.UpdateResult, error) {
			return nil, errors.New("update error")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.Update("p1", "conn-1", "pods", resource.UpdateInput{})
	assert.Error(t, err)
}

func TestUpdate_ConnectionError_TriggersCrash(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		UpdateFunc: func(_ context.Context, _ string, _ resource.UpdateInput) (*resource.UpdateResult, error) {
			return nil, status.Error(codes.Unavailable, "dead")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, _ = ctrl.Update("p1", "conn-1", "pods", resource.UpdateInput{})
	assert.NotEmpty(t, emitter.EventsWithKey("plugin/crash"))
}

// ============================================================================
// Delete
// ============================================================================

func TestDelete_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		DeleteFunc: func(_ context.Context, _ string, _ resource.DeleteInput) (*resource.DeleteResult, error) {
			return &resource.DeleteResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	result, err := ctrl.Delete("p1", "conn-1", "pods", resource.DeleteInput{})
	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestDelete_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		DeleteFunc: func(_ context.Context, _ string, _ resource.DeleteInput) (*resource.DeleteResult, error) {
			return nil, errors.New("delete error")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.Delete("p1", "conn-1", "pods", resource.DeleteInput{})
	assert.Error(t, err)
}

func TestDelete_ConnectionError_TriggersCrash(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		DeleteFunc: func(_ context.Context, _ string, _ resource.DeleteInput) (*resource.DeleteResult, error) {
			return nil, status.Error(codes.Unavailable, "dead")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, _ = ctrl.Delete("p1", "conn-1", "pods", resource.DeleteInput{})
	assert.NotEmpty(t, emitter.EventsWithKey("plugin/crash"))
}

// ============================================================================
// Cross-cutting CRUD tests
// ============================================================================

func TestCRUD_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	ops := []struct {
		name string
		fn   func() error
	}{
		{"Get", func() error { _, e := ctrl.Get("x", "c", "k", resource.GetInput{}); return e }},
		{"List", func() error { _, e := ctrl.List("x", "c", "k", resource.ListInput{}); return e }},
		{"Find", func() error { _, e := ctrl.Find("x", "c", "k", resource.FindInput{}); return e }},
		{"Create", func() error { _, e := ctrl.Create("x", "c", "k", resource.CreateInput{}); return e }},
		{"Update", func() error { _, e := ctrl.Update("x", "c", "k", resource.UpdateInput{}); return e }},
		{"Delete", func() error { _, e := ctrl.Delete("x", "c", "k", resource.DeleteInput{}); return e }},
	}

	for _, op := range ops {
		t.Run(op.name, func(t *testing.T) {
			err := op.fn()
			var appErr *apperror.AppError
			require.True(t, errors.As(err, &appErr))
			assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
		})
	}
}

func TestCRUD_EmptyKey(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFunc: func(_ context.Context, key string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	result, err := ctrl.Get("p1", "conn-1", "", resource.GetInput{})
	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestCRUD_NilInput(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	// Zero-value inputs should pass through without panic.
	_, err := ctrl.Get("p1", "c1", "k", resource.GetInput{})
	assert.NoError(t, err)
}

func TestWithSession_CreatesSessionContext(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	provider, ctx, err := ctrl.withSession("p1", "conn-1")
	require.NoError(t, err)
	assert.NotNil(t, provider)

	session := resource.SessionFromContext(ctx)
	require.NotNil(t, session)
	assert.Equal(t, "conn-1", session.Connection.ID)
}

func TestWithSession_PluginNotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	_, _, err := ctrl.withSession("nonexistent", "c1")
	assert.Error(t, err)
}

func TestGetProvider_ReturnsCorrectProvider(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	expected := &mockProvider{}
	registerMockPlugin(ctrl, "p1", expected)

	provider, err := ctrl.getProvider("p1")
	require.NoError(t, err)
	assert.Equal(t, expected, provider)
}

func TestGetProvider_Concurrency(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := ctrl.getProvider("p1")
			assert.NoError(t, err)
			assert.NotNil(t, p)
		}()
	}
	wg.Wait()
}

func TestCRUD_MultiplePlugins_Isolation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	mock1 := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Success: true, Result: json.RawMessage(`"p1"`)}, nil
		},
	}
	mock2 := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Success: true, Result: json.RawMessage(`"p2"`)}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock1)
	registerMockPlugin(ctrl, "p2", mock2)

	r1, err := ctrl.Get("p1", "c1", "k", resource.GetInput{})
	require.NoError(t, err)
	assert.Contains(t, string(r1.Result), "p1")

	r2, err := ctrl.Get("p2", "c1", "k", resource.GetInput{})
	require.NoError(t, err)
	assert.Contains(t, string(r2.Result), "p2")
}

func TestCRUD_AfterPluginStop_Fails(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	_ = ctrl.OnPluginStop("p1", defaultMeta())

	_, err := ctrl.Get("p1", "c1", "k", resource.GetInput{})
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
}
