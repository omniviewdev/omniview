package resourcers

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
)

// patternGVR matches the GVR that gvrFromMeta constructs from patternMeta (pluralized, lowercase).
var patternGVR = schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
var patternMeta = pkgtypes.ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"}

func patternGVRListKinds() map[schema.GroupVersionResource]string {
	return map[schema.GroupVersionResource]string{
		patternGVR: "DeploymentList",
	}
}

func newPatternResourcer() *KubernetesPatternResourcer {
	logger := zap.NewNop().Sugar()
	r := NewKubernetesPatternResourcer(logger)
	return r.(*KubernetesPatternResourcer)
}

// seedDeployment creates a deployment via the DynamicClient so it exists for Update/Delete tests.
func seedDeployment(t *testing.T, cs *clients.ClientSet, name, namespace string) {
	t.Helper()
	dep := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       "Deployment",
		"metadata": map[string]interface{}{
			"name":      name,
			"namespace": namespace,
		},
	}}
	_, err := cs.DynamicClient.Resource(patternGVR).Namespace(namespace).Create(
		context.Background(), dep, v1.CreateOptions{},
	)
	require.NoError(t, err)
}

func TestParseList(t *testing.T) {
	t.Run("converts items to maps", func(t *testing.T) {
		list := &unstructured.UnstructuredList{
			Items: []unstructured.Unstructured{
				{Object: map[string]interface{}{
					"apiVersion": "v1",
					"kind":       "Pod",
					"metadata":   map[string]interface{}{"name": "pod-1", "namespace": "default"},
				}},
				{Object: map[string]interface{}{
					"apiVersion": "v1",
					"kind":       "Pod",
					"metadata":   map[string]interface{}{"name": "pod-2", "namespace": "default"},
				}},
			},
		}

		result, err := parseList(list)
		require.NoError(t, err)
		require.Len(t, result, 2)

		assert.Equal(t, "pod-1", result[0]["metadata"].(map[string]interface{})["name"])
		assert.Equal(t, "pod-2", result[1]["metadata"].(map[string]interface{})["name"])
	})

	t.Run("empty list returns empty slice", func(t *testing.T) {
		list := &unstructured.UnstructuredList{Items: []unstructured.Unstructured{}}
		result, err := parseList(list)
		require.NoError(t, err)
		assert.Empty(t, result)
	})

	t.Run("preserves all fields", func(t *testing.T) {
		list := &unstructured.UnstructuredList{
			Items: []unstructured.Unstructured{
				{Object: map[string]interface{}{
					"apiVersion": "apps/v1",
					"kind":       "Deployment",
					"metadata": map[string]interface{}{
						"name":      "deploy-1",
						"namespace": "production",
						"labels":    map[string]interface{}{"app": "web"},
					},
					"spec": map[string]interface{}{
						"replicas": int64(3),
					},
				}},
			},
		}

		result, err := parseList(list)
		require.NoError(t, err)
		require.Len(t, result, 1)

		assert.Equal(t, "apps/v1", result[0]["apiVersion"])
		assert.Equal(t, "Deployment", result[0]["kind"])

		spec := result[0]["spec"].(map[string]interface{})
		assert.Equal(t, int64(3), spec["replicas"])
	})
}

func TestParseSingleFromList(t *testing.T) {
	t.Run("extracts single item", func(t *testing.T) {
		list := &unstructured.UnstructuredList{
			Items: []unstructured.Unstructured{
				{Object: map[string]interface{}{
					"apiVersion": "v1",
					"kind":       "Service",
					"metadata":   map[string]interface{}{"name": "svc-1"},
				}},
			},
		}

		result, err := parseSingleFromList(list)
		require.NoError(t, err)
		assert.Equal(t, "svc-1", result["metadata"].(map[string]interface{})["name"])
	})

	t.Run("empty list returns error", func(t *testing.T) {
		list := &unstructured.UnstructuredList{Items: []unstructured.Unstructured{}}
		_, err := parseSingleFromList(list)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "expected one item")
	})

	t.Run("multiple items returns error", func(t *testing.T) {
		list := &unstructured.UnstructuredList{
			Items: []unstructured.Unstructured{
				{Object: map[string]interface{}{"metadata": map[string]interface{}{"name": "a"}}},
				{Object: map[string]interface{}{"metadata": map[string]interface{}{"name": "b"}}},
			},
		}
		_, err := parseSingleFromList(list)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "expected one item in list, got 2")
	})
}

// ===================== PatternResourcer Create =====================

func TestPattern_Create_Success(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	r := newPatternResourcer()

	input := pkgtypes.CreateInput{
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata": map[string]interface{}{
				"name":      "my-deploy",
				"namespace": "default",
			},
		},
	}

	result, err := r.Create(testPluginContext(), cs, patternMeta, input)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "my-deploy", result.Result["metadata"].(map[string]interface{})["name"])
}

func TestPattern_Create_AlreadyExists(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	seedDeployment(t, cs, "existing", "default")
	r := newPatternResourcer()

	input := pkgtypes.CreateInput{
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata": map[string]interface{}{
				"name":      "existing",
				"namespace": "default",
			},
		},
	}

	result, err := r.Create(testPluginContext(), cs, patternMeta, input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "already exists")
}

// ===================== PatternResourcer Update =====================

func TestPattern_Update_Success(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	seedDeployment(t, cs, "update-me", "default")
	r := newPatternResourcer()

	input := pkgtypes.UpdateInput{
		ID:        "update-me",
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata": map[string]interface{}{
				"name":      "update-me",
				"namespace": "default",
				"labels":    map[string]interface{}{"env": "staging"},
			},
		},
	}

	result, err := r.Update(testPluginContext(), cs, patternMeta, input)

	require.NoError(t, err)
	require.NotNil(t, result)

	meta := result.Result["metadata"].(map[string]interface{})
	assert.Equal(t, "update-me", meta["name"])
	labels := meta["labels"].(map[string]interface{})
	assert.Equal(t, "staging", labels["env"])
}

func TestPattern_Update_NotFound(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	r := newPatternResourcer()

	input := pkgtypes.UpdateInput{
		ID:        "ghost",
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata":   map[string]interface{}{"name": "ghost", "namespace": "default"},
		},
	}

	result, err := r.Update(testPluginContext(), cs, patternMeta, input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "not found")
}

// ===================== PatternResourcer Delete =====================

func TestPattern_Delete_Success(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	seedDeployment(t, cs, "doomed", "default")
	r := newPatternResourcer()

	input := pkgtypes.DeleteInput{
		ID:        "doomed",
		Namespace: "default",
	}

	result, err := r.Delete(testPluginContext(), cs, patternMeta, input)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "doomed", result.Result["metadata"].(map[string]interface{})["name"])

	// Verify it's gone
	_, err = cs.DynamicClient.Resource(patternGVR).Namespace("default").Get(
		context.Background(), "doomed", v1.GetOptions{},
	)
	require.Error(t, err)
}

func TestPattern_Delete_NotFound(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	r := newPatternResourcer()

	input := pkgtypes.DeleteInput{
		ID:        "phantom",
		Namespace: "default",
	}

	result, err := r.Delete(testPluginContext(), cs, patternMeta, input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "not found")
}

// ===================== PatternResourcer Success field =====================

func TestPattern_Create_SetsSuccessTrue(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	r := newPatternResourcer()

	result, err := r.Create(testPluginContext(), cs, patternMeta, pkgtypes.CreateInput{
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "apps/v1", "kind": "Deployment",
			"metadata": map[string]interface{}{"name": "test", "namespace": "default"},
		},
	})

	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestPattern_Update_SetsSuccessTrue(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	seedDeployment(t, cs, "target", "default")
	r := newPatternResourcer()

	result, err := r.Update(testPluginContext(), cs, patternMeta, pkgtypes.UpdateInput{
		ID: "target", Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "apps/v1", "kind": "Deployment",
			"metadata": map[string]interface{}{"name": "target", "namespace": "default"},
		},
	})

	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestPattern_Delete_SetsSuccessTrue(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	seedDeployment(t, cs, "target", "default")
	r := newPatternResourcer()

	result, err := r.Delete(testPluginContext(), cs, patternMeta, pkgtypes.DeleteInput{
		ID: "target", Namespace: "default",
	})

	require.NoError(t, err)
	assert.True(t, result.Success)
}

// ===================== GVR consistency =====================

// TestPattern_CreateThenDelete_SameGVR verifies that Create and Delete operate
// on the same GVR so a resource written via Create can be deleted via Delete.
func TestPattern_CreateThenDelete_SameGVR(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	r := newPatternResourcer()

	// Create a deployment
	createResult, err := r.Create(testPluginContext(), cs, patternMeta, pkgtypes.CreateInput{
		Namespace: "default",
		Input: map[string]interface{}{
			"apiVersion": "apps/v1", "kind": "Deployment",
			"metadata": map[string]interface{}{"name": "roundtrip", "namespace": "default"},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "roundtrip", createResult.Result["metadata"].(map[string]interface{})["name"])

	// Delete the same deployment — if GVR is consistent this succeeds
	deleteResult, err := r.Delete(testPluginContext(), cs, patternMeta, pkgtypes.DeleteInput{
		ID: "roundtrip", Namespace: "default",
	})
	require.NoError(t, err)
	assert.True(t, deleteResult.Success)
}

// ===================== Helper function tests =====================

func TestResourceName(t *testing.T) {
	tests := []struct {
		kind     string
		expected string
	}{
		{"Deployment", "deployments"},
		{"Pod", "pods"},
		{"Service", "services"},
		{"Ingress", "ingresses"},
		{"Endpoints", "endpoints"},
	}
	for _, tt := range tests {
		t.Run(tt.kind, func(t *testing.T) {
			meta := pkgtypes.ResourceMeta{Kind: tt.kind}
			assert.Equal(t, tt.expected, resourceName(meta))
		})
	}
}

func TestGvrFromMeta(t *testing.T) {
	meta := pkgtypes.ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"}
	gvr := gvrFromMeta(meta)
	assert.Equal(t, "apps", gvr.Group)
	assert.Equal(t, "v1", gvr.Version)
	assert.Equal(t, "deployments", gvr.Resource)
}

func TestApiBasePath(t *testing.T) {
	t.Run("core group uses /api/", func(t *testing.T) {
		assert.Equal(t, "/api/v1", apiBasePath("", "v1"))
	})
	t.Run("named group uses /apis/", func(t *testing.T) {
		assert.Equal(t, "/apis/apps/v1", apiBasePath("apps", "v1"))
	})
	t.Run("extensions group", func(t *testing.T) {
		assert.Equal(t, "/apis/networking.k8s.io/v1", apiBasePath("networking.k8s.io", "v1"))
	})
}
