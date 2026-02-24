package logs

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/pkg/logs"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ---------------------------------------------------------------------------
// allContainers
// ---------------------------------------------------------------------------

func TestAllContainers(t *testing.T) {
	tests := []struct {
		name     string
		pod      corev1.Pod
		wantLen  int
		wantName []string // expected container names in order
	}{
		{
			name:     "no containers",
			pod:      corev1.Pod{},
			wantLen:  0,
			wantName: nil,
		},
		{
			name: "only regular containers",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Name: "app", Image: "nginx"},
						{Name: "sidecar", Image: "envoy"},
					},
				},
			},
			wantLen:  2,
			wantName: []string{"app", "sidecar"},
		},
		{
			name: "only init containers",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{
					InitContainers: []corev1.Container{
						{Name: "init-db", Image: "busybox"},
					},
				},
			},
			wantLen:  1,
			wantName: []string{"init-db"},
		},
		{
			name: "only ephemeral containers",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{
					EphemeralContainers: []corev1.EphemeralContainer{
						{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug", Image: "busybox"}},
					},
				},
			},
			wantLen:  1,
			wantName: []string{"debug"},
		},
		{
			name: "all three container types - init first then regular then ephemeral",
			pod: corev1.Pod{
				Spec: corev1.PodSpec{
					InitContainers: []corev1.Container{
						{Name: "init-1", Image: "busybox"},
					},
					Containers: []corev1.Container{
						{Name: "app", Image: "nginx"},
						{Name: "sidecar", Image: "envoy"},
					},
					EphemeralContainers: []corev1.EphemeralContainer{
						{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug", Image: "busybox"}},
					},
				},
			},
			wantLen:  4,
			wantName: []string{"init-1", "app", "sidecar", "debug"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := allContainers(tt.pod)
			assert.Len(t, got, tt.wantLen)

			if tt.wantName != nil {
				names := make([]string, len(got))
				for i, c := range got {
					names[i] = c.Name
				}
				assert.Equal(t, tt.wantName, names)
			}
		})
	}
}

func TestAllContainers_EphemeralPreservesNameAndImage(t *testing.T) {
	pod := corev1.Pod{
		Spec: corev1.PodSpec{
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{
					Name:  "debug",
					Image: "busybox:latest",
				}},
			},
		},
	}

	got := allContainers(pod)
	require.Len(t, got, 1)
	assert.Equal(t, "debug", got[0].Name)
	assert.Equal(t, "busybox:latest", got[0].Image)
}

// ---------------------------------------------------------------------------
// podToSources
// ---------------------------------------------------------------------------

func TestPodToSources(t *testing.T) {
	basePod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-pod",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			InitContainers: []corev1.Container{
				{Name: "init-db", Image: "busybox"},
			},
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx"},
				{Name: "sidecar", Image: "envoy"},
			},
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug", Image: "busybox"}},
			},
		},
	}

	t.Run("empty target returns all containers", func(t *testing.T) {
		sources := podToSources(basePod, "")
		require.Len(t, sources, 4)

		// Verify ordering: init, regular, ephemeral
		assert.Equal(t, "my-pod/init-db", sources[0].ID)
		assert.Equal(t, "my-pod/app", sources[1].ID)
		assert.Equal(t, "my-pod/sidecar", sources[2].ID)
		assert.Equal(t, "my-pod/debug", sources[3].ID)
	})

	t.Run("target filters to specific container", func(t *testing.T) {
		sources := podToSources(basePod, "app")
		require.Len(t, sources, 1)
		assert.Equal(t, "my-pod/app", sources[0].ID)
	})

	t.Run("target can match init container", func(t *testing.T) {
		sources := podToSources(basePod, "init-db")
		require.Len(t, sources, 1)
		assert.Equal(t, "my-pod/init-db", sources[0].ID)
	})

	t.Run("target can match ephemeral container", func(t *testing.T) {
		sources := podToSources(basePod, "debug")
		require.Len(t, sources, 1)
		assert.Equal(t, "my-pod/debug", sources[0].ID)
	})

	t.Run("nonexistent target returns empty slice", func(t *testing.T) {
		sources := podToSources(basePod, "does-not-exist")
		assert.Empty(t, sources)
	})

	t.Run("labels are populated correctly", func(t *testing.T) {
		sources := podToSources(basePod, "app")
		require.Len(t, sources, 1)

		assert.Equal(t, map[string]string{
			"pod":       "my-pod",
			"container": "app",
			"namespace": "default",
			"node":      "node-1",
		}, sources[0].Labels)
	})

	t.Run("pod with no containers returns nil", func(t *testing.T) {
		emptyPod := corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "empty", Namespace: "ns"},
		}
		sources := podToSources(emptyPod, "")
		assert.Nil(t, sources)
	})

	t.Run("pod with empty node name sets empty node label", func(t *testing.T) {
		pod := corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "p", Namespace: "ns"},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{{Name: "c", Image: "img"}},
			},
		}
		sources := podToSources(pod, "")
		require.Len(t, sources, 1)
		assert.Equal(t, "", sources[0].Labels["node"])
	})
}

// ---------------------------------------------------------------------------
// extractNameAndNamespace
// ---------------------------------------------------------------------------

func TestExtractNameAndNamespace(t *testing.T) {
	tests := []struct {
		name      string
		data      map[string]interface{}
		wantName  string
		wantNS    string
	}{
		{
			name:     "nil data",
			data:     nil,
			wantName: "",
			wantNS:   "",
		},
		{
			name:     "empty data",
			data:     map[string]interface{}{},
			wantName: "",
			wantNS:   "",
		},
		{
			name: "missing metadata key",
			data: map[string]interface{}{
				"spec": map[string]interface{}{},
			},
			wantName: "",
			wantNS:   "",
		},
		{
			name: "metadata is wrong type",
			data: map[string]interface{}{
				"metadata": "not-a-map",
			},
			wantName: "",
			wantNS:   "",
		},
		{
			name: "metadata with both name and namespace",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{
					"name":      "my-pod",
					"namespace": "kube-system",
				},
			},
			wantName: "my-pod",
			wantNS:   "kube-system",
		},
		{
			name: "metadata with name only",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{
					"name": "cluster-resource",
				},
			},
			wantName: "cluster-resource",
			wantNS:   "",
		},
		{
			name: "metadata with namespace only",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{
					"namespace": "default",
				},
			},
			wantName: "",
			wantNS:   "default",
		},
		{
			name: "metadata with non-string name",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{
					"name":      123,
					"namespace": "ns",
				},
			},
			wantName: "",
			wantNS:   "ns",
		},
		{
			name: "metadata with non-string namespace",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{
					"name":      "pod-1",
					"namespace": true,
				},
			},
			wantName: "pod-1",
			wantNS:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			name, ns := extractNameAndNamespace(tt.data)
			assert.Equal(t, tt.wantName, name)
			assert.Equal(t, tt.wantNS, ns)
		})
	}
}

// ---------------------------------------------------------------------------
// extractNodeName
// ---------------------------------------------------------------------------

func TestExtractNodeName(t *testing.T) {
	tests := []struct {
		name     string
		data     map[string]interface{}
		wantNode string
		wantOK   bool
	}{
		{
			name:     "nil data",
			data:     nil,
			wantNode: "",
			wantOK:   false,
		},
		{
			name:     "empty data",
			data:     map[string]interface{}{},
			wantNode: "",
			wantOK:   false,
		},
		{
			name: "no spec key",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{},
			},
			wantNode: "",
			wantOK:   false,
		},
		{
			name: "spec is wrong type",
			data: map[string]interface{}{
				"spec": "not-a-map",
			},
			wantNode: "",
			wantOK:   false,
		},
		{
			name: "spec without nodeName",
			data: map[string]interface{}{
				"spec": map[string]interface{}{
					"containers": []interface{}{},
				},
			},
			wantNode: "",
			wantOK:   false,
		},
		{
			name: "spec with nodeName",
			data: map[string]interface{}{
				"spec": map[string]interface{}{
					"nodeName": "worker-3",
				},
			},
			wantNode: "worker-3",
			wantOK:   true,
		},
		{
			name: "spec with non-string nodeName",
			data: map[string]interface{}{
				"spec": map[string]interface{}{
					"nodeName": 42,
				},
			},
			wantNode: "",
			wantOK:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			node, ok := extractNodeName(tt.data)
			assert.Equal(t, tt.wantNode, node)
			assert.Equal(t, tt.wantOK, ok)
		})
	}
}

// ---------------------------------------------------------------------------
// PodSourceBuilder
// ---------------------------------------------------------------------------

func TestPodSourceBuilder(t *testing.T) {
	fullData := map[string]interface{}{
		"metadata": map[string]interface{}{
			"name":      "web-pod",
			"namespace": "production",
		},
		"spec": map[string]interface{}{
			"nodeName": "node-2",
			"initContainers": []interface{}{
				map[string]interface{}{"name": "init-migrate"},
			},
			"containers": []interface{}{
				map[string]interface{}{"name": "web"},
				map[string]interface{}{"name": "sidecar"},
			},
			"ephemeralContainers": []interface{}{
				map[string]interface{}{"name": "debug-shell"},
			},
		},
	}

	t.Run("nil resource data returns nil", func(t *testing.T) {
		result := PodSourceBuilder("id", nil, logs.LogSessionOptions{})
		assert.Nil(t, result)
	})

	t.Run("empty resource data returns nil", func(t *testing.T) {
		result := PodSourceBuilder("id", map[string]interface{}{}, logs.LogSessionOptions{})
		assert.Nil(t, result)
	})

	t.Run("missing metadata name returns nil", func(t *testing.T) {
		data := map[string]interface{}{
			"metadata": map[string]interface{}{
				"namespace": "ns",
			},
			"spec": map[string]interface{}{
				"containers": []interface{}{
					map[string]interface{}{"name": "app"},
				},
			},
		}
		result := PodSourceBuilder("id", data, logs.LogSessionOptions{})
		assert.Nil(t, result)
	})

	t.Run("missing spec returns nil", func(t *testing.T) {
		data := map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "pod-1",
				"namespace": "ns",
			},
		}
		result := PodSourceBuilder("id", data, logs.LogSessionOptions{})
		assert.Nil(t, result)
	})

	t.Run("spec is wrong type returns nil", func(t *testing.T) {
		data := map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "pod-1",
				"namespace": "ns",
			},
			"spec": "bad-value",
		}
		result := PodSourceBuilder("id", data, logs.LogSessionOptions{})
		assert.Nil(t, result)
	})

	t.Run("empty containers in spec returns nil", func(t *testing.T) {
		data := map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "pod-1",
				"namespace": "ns",
			},
			"spec": map[string]interface{}{
				"containers": []interface{}{},
			},
		}
		result := PodSourceBuilder("id", data, logs.LogSessionOptions{})
		assert.Nil(t, result)
	})

	t.Run("all containers returned with empty target", func(t *testing.T) {
		sources := PodSourceBuilder("res-123", fullData, logs.LogSessionOptions{})
		require.Len(t, sources, 4)

		// Order: initContainers, containers, ephemeralContainers
		assert.Equal(t, "web-pod/init-migrate", sources[0].ID)
		assert.Equal(t, "web-pod/web", sources[1].ID)
		assert.Equal(t, "web-pod/sidecar", sources[2].ID)
		assert.Equal(t, "web-pod/debug-shell", sources[3].ID)
	})

	t.Run("target filters to single container", func(t *testing.T) {
		opts := logs.LogSessionOptions{Target: "web"}
		sources := PodSourceBuilder("res-123", fullData, opts)
		require.Len(t, sources, 1)
		assert.Equal(t, "web-pod/web", sources[0].ID)
	})

	t.Run("target matches init container", func(t *testing.T) {
		opts := logs.LogSessionOptions{Target: "init-migrate"}
		sources := PodSourceBuilder("res-123", fullData, opts)
		require.Len(t, sources, 1)
		assert.Equal(t, "web-pod/init-migrate", sources[0].ID)
	})

	t.Run("target matches ephemeral container", func(t *testing.T) {
		opts := logs.LogSessionOptions{Target: "debug-shell"}
		sources := PodSourceBuilder("res-123", fullData, opts)
		require.Len(t, sources, 1)
		assert.Equal(t, "web-pod/debug-shell", sources[0].ID)
	})

	t.Run("nonexistent target returns nil", func(t *testing.T) {
		opts := logs.LogSessionOptions{Target: "no-such-container"}
		sources := PodSourceBuilder("res-123", fullData, opts)
		assert.Nil(t, sources)
	})

	t.Run("labels include node name", func(t *testing.T) {
		sources := PodSourceBuilder("res-123", fullData, logs.LogSessionOptions{Target: "web"})
		require.Len(t, sources, 1)
		assert.Equal(t, map[string]string{
			"pod":       "web-pod",
			"container": "web",
			"namespace": "production",
			"node":      "node-2",
		}, sources[0].Labels)
	})

	t.Run("missing node name sets empty string in label", func(t *testing.T) {
		data := map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "pod-no-node",
				"namespace": "ns",
			},
			"spec": map[string]interface{}{
				"containers": []interface{}{
					map[string]interface{}{"name": "app"},
				},
			},
		}
		sources := PodSourceBuilder("id", data, logs.LogSessionOptions{})
		require.Len(t, sources, 1)
		assert.Equal(t, "", sources[0].Labels["node"])
	})

	t.Run("container entry missing name is skipped", func(t *testing.T) {
		data := map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "pod-1",
				"namespace": "ns",
			},
			"spec": map[string]interface{}{
				"containers": []interface{}{
					map[string]interface{}{"image": "nginx"}, // no "name" key
					map[string]interface{}{"name": "valid"},
				},
			},
		}
		sources := PodSourceBuilder("id", data, logs.LogSessionOptions{})
		require.Len(t, sources, 1)
		assert.Equal(t, "pod-1/valid", sources[0].ID)
	})

	t.Run("container entry not a map is skipped", func(t *testing.T) {
		data := map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "pod-1",
				"namespace": "ns",
			},
			"spec": map[string]interface{}{
				"containers": []interface{}{
					"not-a-map",
					map[string]interface{}{"name": "real"},
				},
			},
		}
		sources := PodSourceBuilder("id", data, logs.LogSessionOptions{})
		require.Len(t, sources, 1)
		assert.Equal(t, "pod-1/real", sources[0].ID)
	})

	t.Run("containers key is not a slice is skipped gracefully", func(t *testing.T) {
		data := map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "pod-1",
				"namespace": "ns",
			},
			"spec": map[string]interface{}{
				"containers": "not-a-slice",
			},
		}
		sources := PodSourceBuilder("id", data, logs.LogSessionOptions{})
		assert.Nil(t, sources)
	})

	t.Run("resourceID argument does not affect output", func(t *testing.T) {
		// PodSourceBuilder uses metadata name, not resourceID, for source IDs
		s1 := PodSourceBuilder("id-a", fullData, logs.LogSessionOptions{Target: "web"})
		s2 := PodSourceBuilder("id-b", fullData, logs.LogSessionOptions{Target: "web"})
		require.Len(t, s1, 1)
		require.Len(t, s2, 1)
		assert.Equal(t, s1[0].ID, s2[0].ID)
	})
}

// ---------------------------------------------------------------------------
// extractPodIdentity (handler.go)
// ---------------------------------------------------------------------------

func TestExtractPodIdentity(t *testing.T) {
	tests := []struct {
		name      string
		data      map[string]interface{}
		wantName  string
		wantNS    string
	}{
		{
			name:     "nil data",
			data:     nil,
			wantName: "",
			wantNS:   "",
		},
		{
			name:     "empty data",
			data:     map[string]interface{}{},
			wantName: "",
			wantNS:   "",
		},
		{
			name: "metadata missing",
			data: map[string]interface{}{
				"spec": map[string]interface{}{},
			},
			wantName: "",
			wantNS:   "",
		},
		{
			name: "metadata wrong type",
			data: map[string]interface{}{
				"metadata": 42,
			},
			wantName: "",
			wantNS:   "",
		},
		{
			name: "metadata with both fields",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{
					"name":      "nginx-abc123",
					"namespace": "web",
				},
			},
			wantName: "nginx-abc123",
			wantNS:   "web",
		},
		{
			name: "metadata with name only",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{
					"name": "solo",
				},
			},
			wantName: "solo",
			wantNS:   "",
		},
		{
			name: "metadata with namespace only",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{
					"namespace": "kube-system",
				},
			},
			wantName: "",
			wantNS:   "kube-system",
		},
		{
			name: "metadata with non-string values",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{
					"name":      []string{"not", "a", "string"},
					"namespace": false,
				},
			},
			wantName: "",
			wantNS:   "",
		},
		{
			name: "metadata with extra fields does not affect result",
			data: map[string]interface{}{
				"metadata": map[string]interface{}{
					"name":              "pod-x",
					"namespace":         "ns-x",
					"uid":               "abc-def",
					"resourceVersion":   "12345",
					"creationTimestamp": "2024-01-01T00:00:00Z",
				},
			},
			wantName: "pod-x",
			wantNS:   "ns-x",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			name, ns := extractPodIdentity(tt.data)
			assert.Equal(t, tt.wantName, name)
			assert.Equal(t, tt.wantNS, ns)
		})
	}
}

// ---------------------------------------------------------------------------
// ptrIfPositive (handler.go)
// ---------------------------------------------------------------------------

func TestPtrIfPositive(t *testing.T) {
	tests := []struct {
		name    string
		input   int64
		wantNil bool
		wantVal int64
	}{
		{
			name:    "zero returns nil",
			input:   0,
			wantNil: true,
		},
		{
			name:    "negative returns nil",
			input:   -1,
			wantNil: true,
		},
		{
			name:    "large negative returns nil",
			input:   -9999,
			wantNil: true,
		},
		{
			name:    "positive one returns pointer to 1",
			input:   1,
			wantNil: false,
			wantVal: 1,
		},
		{
			name:    "large positive returns pointer",
			input:   1000000,
			wantNil: false,
			wantVal: 1000000,
		},
		{
			name:    "max int64 returns pointer",
			input:   1<<63 - 1,
			wantNil: false,
			wantVal: 1<<63 - 1,
		},
		{
			name:    "min int64 returns nil",
			input:   -1 << 63,
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ptrIfPositive(tt.input)
			if tt.wantNil {
				assert.Nil(t, got)
			} else {
				require.NotNil(t, got)
				assert.Equal(t, tt.wantVal, *got)
			}
		})
	}
}

func TestPtrIfPositive_ReturnedPointerIsIndependent(t *testing.T) {
	// Verify each call returns a distinct pointer (no shared state).
	p1 := ptrIfPositive(10)
	p2 := ptrIfPositive(10)
	require.NotNil(t, p1)
	require.NotNil(t, p2)
	assert.Equal(t, *p1, *p2)

	// Mutating one should not affect the other.
	*p1 = 99
	assert.NotEqual(t, *p1, *p2)
}
