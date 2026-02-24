package resourcers

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
)

func newBaseResourcer() *KubernetesResourcerBase[MetaAccessor] {
	logger := zap.NewNop().Sugar()
	r := NewKubernetesResourcerBase[MetaAccessor](logger, testGVR)
	return r.(*KubernetesResourcerBase[MetaAccessor])
}

// ===================== Get =====================

func TestBase_Get_UnsyncedInformer_Namespaced(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds(), newTestPod("nginx", "default"))
	r := newBaseResourcer()

	result, err := r.Get(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.GetInput{
		ID:        "nginx",
		Namespace: "default",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Equal(t, "nginx", result.Result["metadata"].(map[string]interface{})["name"])
}

func TestBase_Get_UnsyncedInformer_ClusterScoped(t *testing.T) {
	node := newTestPod("node-1", "")
	cs := newFakeClientSet(defaultGVRListKinds(), node)
	r := newBaseResourcer()

	result, err := r.Get(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.GetInput{
		ID:        "node-1",
		Namespace: "",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Equal(t, "node-1", result.Result["metadata"].(map[string]interface{})["name"])
}

func TestBase_Get_SyncedInformer_Namespaced(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cs := newSyncedClientSet(ctx, testGVR, defaultGVRListKinds(), newTestPod("redis", "staging"))
	r := newBaseResourcer()

	result, err := r.Get(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.GetInput{
		ID:        "redis",
		Namespace: "staging",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Equal(t, "redis", result.Result["metadata"].(map[string]interface{})["name"])
}

func TestBase_Get_SyncedInformer_ClusterScoped(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cs := newSyncedClientSet(ctx, testGVR, defaultGVRListKinds(), newTestPod("global-pod", ""))
	r := newBaseResourcer()

	result, err := r.Get(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.GetInput{
		ID:        "global-pod",
		Namespace: "",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Equal(t, "global-pod", result.Result["metadata"].(map[string]interface{})["name"])
}

func TestBase_Get_NotFound(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds()) // no objects
	r := newBaseResourcer()

	result, err := r.Get(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.GetInput{
		ID:        "nonexistent",
		Namespace: "default",
	})

	require.Error(t, err)
	assert.Nil(t, result)
}

// ===================== List =====================

func TestBase_List_Empty(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cs := newSyncedClientSet(ctx, testGVR, defaultGVRListKinds()) // no objects
	r := newBaseResourcer()

	result, err := r.List(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.ListInput{})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Empty(t, result.Result)
}

func TestBase_List_MultipleResources(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cs := newSyncedClientSet(ctx, testGVR, defaultGVRListKinds(),
		newTestPod("pod-a", "default"),
		newTestPod("pod-b", "default"),
		newTestPod("pod-c", "kube-system"),
	)
	r := newBaseResourcer()

	result, err := r.List(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.ListInput{})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Len(t, result.Result, 3)

	// Collect names from results
	names := make(map[string]bool)
	for _, item := range result.Result {
		meta := item["metadata"].(map[string]interface{})
		names[meta["name"].(string)] = true
	}
	assert.True(t, names["pod-a"])
	assert.True(t, names["pod-b"])
	assert.True(t, names["pod-c"])
}

// ===================== Find =====================

func TestBase_Find_ReturnsAll(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cs := newSyncedClientSet(ctx, testGVR, defaultGVRListKinds(),
		newTestPod("find-1", "default"),
		newTestPod("find-2", "default"),
	)
	r := newBaseResourcer()

	result, err := r.Find(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.FindInput{})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Len(t, result.Result, 2)
}

// ===================== Create =====================

func TestBase_Create_Success(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds())
	r := newBaseResourcer()

	input := pkgtypes.CreateInput{
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Pod",
			"metadata": map[string]interface{}{
				"name":      "new-pod",
				"namespace": "default",
			},
		},
	}

	result, err := r.Create(testPluginContext(), cs, pkgtypes.ResourceMeta{}, input)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "new-pod", result.Result["metadata"].(map[string]interface{})["name"])
}

func TestBase_Create_AlreadyExists(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds(), newTestPod("existing", "default"))
	r := newBaseResourcer()

	input := pkgtypes.CreateInput{
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Pod",
			"metadata": map[string]interface{}{
				"name":      "existing",
				"namespace": "default",
			},
		},
	}

	result, err := r.Create(testPluginContext(), cs, pkgtypes.ResourceMeta{}, input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "already exists")
}

// ===================== Update =====================

func TestBase_Update_Success(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds(), newTestPod("update-me", "default"))
	r := newBaseResourcer()

	input := pkgtypes.UpdateInput{
		ID:        "update-me",
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Pod",
			"metadata": map[string]interface{}{
				"name":      "update-me",
				"namespace": "default",
				"labels":    map[string]interface{}{"updated": "true"},
			},
		},
	}

	result, err := r.Update(testPluginContext(), cs, pkgtypes.ResourceMeta{}, input)

	require.NoError(t, err)
	require.NotNil(t, result)

	meta := result.Result["metadata"].(map[string]interface{})
	assert.Equal(t, "update-me", meta["name"])
	labels := meta["labels"].(map[string]interface{})
	assert.Equal(t, "true", labels["updated"])
}

func TestBase_Update_NotFound(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds()) // no objects
	r := newBaseResourcer()

	input := pkgtypes.UpdateInput{
		ID:        "ghost",
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Pod",
			"metadata":   map[string]interface{}{"name": "ghost", "namespace": "default"},
		},
	}

	result, err := r.Update(testPluginContext(), cs, pkgtypes.ResourceMeta{}, input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "not found")
}

// ===================== Delete =====================

func TestBase_Delete_Success(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds(), newTestPod("doomed", "default"))
	r := newBaseResourcer()

	input := pkgtypes.DeleteInput{
		ID:        "doomed",
		Namespace: "default",
	}

	result, err := r.Delete(testPluginContext(), cs, pkgtypes.ResourceMeta{}, input)

	require.NoError(t, err)
	require.NotNil(t, result)

	meta := result.Result["metadata"].(map[string]interface{})
	assert.Equal(t, "doomed", meta["name"])

	// Verify it's actually gone — a second Get should fail
	_, err = r.Get(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.GetInput{
		ID:        "doomed",
		Namespace: "default",
	})
	require.Error(t, err)
}

func TestBase_Delete_NotFound(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds()) // no objects
	r := newBaseResourcer()

	input := pkgtypes.DeleteInput{
		ID:        "phantom",
		Namespace: "default",
	}

	result, err := r.Delete(testPluginContext(), cs, pkgtypes.ResourceMeta{}, input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "not found")
}

// ===================== Success field =====================

func TestBase_Create_SetsSuccessTrue(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds())
	r := newBaseResourcer()

	result, err := r.Create(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.CreateInput{
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "v1", "kind": "Pod",
			"metadata": map[string]interface{}{"name": "test", "namespace": "default"},
		},
	})

	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestBase_Update_SetsSuccessTrue(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds(), newTestPod("target", "default"))
	r := newBaseResourcer()

	result, err := r.Update(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.UpdateInput{
		ID: "target", Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "v1", "kind": "Pod",
			"metadata": map[string]interface{}{"name": "target", "namespace": "default"},
		},
	})

	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestBase_Delete_SetsSuccessTrue(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds(), newTestPod("target", "default"))
	r := newBaseResourcer()

	result, err := r.Delete(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.DeleteInput{
		ID: "target", Namespace: "default",
	})

	require.NoError(t, err)
	assert.True(t, result.Success)
}

// ===================== Unsynced informer fallback =====================

func TestBase_List_UnsyncedInformer(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds(),
		newTestPod("pod-a", "default"),
		newTestPod("pod-b", "default"),
	)
	r := newBaseResourcer()

	result, err := r.List(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.ListInput{})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Len(t, result.Result, 2)
}

func TestBase_Find_UnsyncedInformer(t *testing.T) {
	cs := newFakeClientSet(defaultGVRListKinds(),
		newTestPod("find-a", "default"),
	)
	r := newBaseResourcer()

	result, err := r.Find(testPluginContext(), cs, pkgtypes.ResourceMeta{}, pkgtypes.FindInput{})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Len(t, result.Result, 1)
}
