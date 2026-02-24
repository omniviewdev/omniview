package resourcers

import (
	"context"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
)

// newNodeResourcer creates a NodeResourcer for testing.
func newTestNodeResourcer() *NodeResourcer {
	return NewNodeResourcer(zap.NewNop().Sugar())
}

// newNodeClientSet creates a ClientSet with a fake typed clientset seeded with the given objects.
func newNodeClientSet(objects ...runtime.Object) *clients.ClientSet {
	fakeClient := fake.NewSimpleClientset(objects...)
	return &clients.ClientSet{
		KubeClient: fakeClient,
	}
}

func nodePluginCtx() *types.PluginContext {
	return &types.PluginContext{
		Context: context.Background(),
	}
}

// testNode creates a Node object for testing.
func testNode(name string, opts ...func(*corev1.Node)) *corev1.Node {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: name},
		Spec:       corev1.NodeSpec{},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
					Reason: "KubeletReady",
				},
			},
		},
	}
	for _, o := range opts {
		o(node)
	}
	return node
}

func withUnschedulable(n *corev1.Node) {
	n.Spec.Unschedulable = true
}

func withTaints(taints ...corev1.Taint) func(*corev1.Node) {
	return func(n *corev1.Node) {
		n.Spec.Taints = taints
	}
}

// testPodOnNode creates a Pod on a given node for drain tests.
func testPodOnNode(name, namespace, nodeName string, opts ...func(*corev1.Pod)) *corev1.Pod {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Spec: corev1.PodSpec{
			NodeName: nodeName,
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}
	for _, o := range opts {
		o(pod)
	}
	return pod
}

func withDaemonSetOwner(pod *corev1.Pod) {
	pod.OwnerReferences = []metav1.OwnerReference{
		{Kind: "DaemonSet", Name: "some-ds", APIVersion: "apps/v1"},
	}
}

func withMirrorAnnotation(pod *corev1.Pod) {
	if pod.Annotations == nil {
		pod.Annotations = make(map[string]string)
	}
	pod.Annotations[corev1.MirrorPodAnnotationKey] = "some-hash"
}

// ===================== GetActions =====================

func TestNodeResourcer_GetActions(t *testing.T) {
	r := newTestNodeResourcer()
	actions, err := r.GetActions(nodePluginCtx(), nil, pkgtypes.ResourceMeta{})
	require.NoError(t, err)
	require.Len(t, actions, 6)

	ids := make([]string, len(actions))
	for i, a := range actions {
		ids[i] = a.ID
	}
	assert.Contains(t, ids, "cordon")
	assert.Contains(t, ids, "uncordon")
	assert.Contains(t, ids, "drain")
	assert.Contains(t, ids, "add-taint")
	assert.Contains(t, ids, "remove-taint")
	assert.Contains(t, ids, "get-conditions")

	for _, a := range actions {
		assert.Equal(t, pkgtypes.ActionScopeInstance, a.Scope)
		assert.NotEmpty(t, a.Label)
		assert.NotEmpty(t, a.Description)
	}
}

// ===================== Cordon =====================

func TestNodeResourcer_Cordon(t *testing.T) {
	node := testNode("worker-1")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "cordon", pkgtypes.ActionInput{
		ID: "worker-1",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "cordoned")

	// Verify the node is now unschedulable.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "worker-1", metav1.GetOptions{})
	require.NoError(t, err)
	assert.True(t, updated.Spec.Unschedulable)
}

func TestNodeResourcer_Cordon_AlreadyCordoned(t *testing.T) {
	node := testNode("worker-1", withUnschedulable)
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "cordon", pkgtypes.ActionInput{
		ID: "worker-1",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)

	// Still unschedulable.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "worker-1", metav1.GetOptions{})
	require.NoError(t, err)
	assert.True(t, updated.Spec.Unschedulable)
}

func TestNodeResourcer_Cordon_NotFound(t *testing.T) {
	cs := newNodeClientSet() // no nodes
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "cordon", pkgtypes.ActionInput{
		ID: "nonexistent",
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to patch node")
}

// ===================== Uncordon =====================

func TestNodeResourcer_Uncordon(t *testing.T) {
	node := testNode("worker-1", withUnschedulable)
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "uncordon", pkgtypes.ActionInput{
		ID: "worker-1",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "uncordoned")

	// Verify the node is now schedulable.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "worker-1", metav1.GetOptions{})
	require.NoError(t, err)
	assert.False(t, updated.Spec.Unschedulable)
}

// ===================== Drain =====================

func TestNodeResourcer_Drain_EvictsPods(t *testing.T) {
	node := testNode("drain-node")
	pod1 := testPodOnNode("app-1", "default", "drain-node")
	pod2 := testPodOnNode("app-2", "default", "drain-node")
	cs := newNodeClientSet(node, pod1, pod2)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "drain", pkgtypes.ActionInput{
		ID: "drain-node",
		Params: map[string]interface{}{
			"gracePeriodSeconds": float64(30),
			"ignoreDaemonSets":  true,
		},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	// Note: fake clientset doesn't support eviction subresource, so evictions will fail.
	// The drain action should still succeed (with errors reported in data).
	// The node should be cordoned regardless.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "drain-node", metav1.GetOptions{})
	require.NoError(t, err)
	assert.True(t, updated.Spec.Unschedulable, "node should be cordoned after drain")
}

func TestNodeResourcer_Drain_SkipsDaemonSetPods(t *testing.T) {
	node := testNode("drain-node")
	dsPod := testPodOnNode("ds-pod", "default", "drain-node", withDaemonSetOwner)
	cs := newNodeClientSet(node, dsPod)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "drain", pkgtypes.ActionInput{
		ID: "drain-node",
		Params: map[string]interface{}{
			"ignoreDaemonSets": true,
		},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "0 pods evicted")
}

func TestNodeResourcer_Drain_SkipsMirrorPods(t *testing.T) {
	node := testNode("drain-node")
	mirrorPod := testPodOnNode("mirror-pod", "kube-system", "drain-node", withMirrorAnnotation)
	cs := newNodeClientSet(node, mirrorPod)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "drain", pkgtypes.ActionInput{
		ID: "drain-node",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "0 pods evicted")
}

func TestNodeResourcer_Drain_SkipsSucceededPods(t *testing.T) {
	node := testNode("drain-node")
	donePod := testPodOnNode("done-pod", "default", "drain-node")
	donePod.Status.Phase = corev1.PodSucceeded
	cs := newNodeClientSet(node, donePod)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "drain", pkgtypes.ActionInput{
		ID: "drain-node",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "0 pods evicted")
}

func TestNodeResourcer_Drain_NotFound(t *testing.T) {
	cs := newNodeClientSet() // no nodes
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "drain", pkgtypes.ActionInput{
		ID: "nonexistent",
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to cordon node")
}

// ===================== Add Taint =====================

func TestNodeResourcer_AddTaint(t *testing.T) {
	node := testNode("taint-node")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "add-taint", pkgtypes.ActionInput{
		ID: "taint-node",
		Params: map[string]interface{}{
			"key":    "dedicated",
			"value":  "gpu",
			"effect": "NoSchedule",
		},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "added")

	// Verify taint was applied.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "taint-node", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.Spec.Taints, 1)
	assert.Equal(t, "dedicated", updated.Spec.Taints[0].Key)
	assert.Equal(t, "gpu", updated.Spec.Taints[0].Value)
	assert.Equal(t, corev1.TaintEffectNoSchedule, updated.Spec.Taints[0].Effect)
}

func TestNodeResourcer_AddTaint_Duplicate(t *testing.T) {
	existing := corev1.Taint{Key: "dedicated", Value: "gpu", Effect: corev1.TaintEffectNoSchedule}
	node := testNode("taint-node", withTaints(existing))
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "add-taint", pkgtypes.ActionInput{
		ID: "taint-node",
		Params: map[string]interface{}{
			"key":    "dedicated",
			"value":  "gpu",
			"effect": "NoSchedule",
		},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "already exists")

	// Taint count unchanged.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "taint-node", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Len(t, updated.Spec.Taints, 1)
}

func TestNodeResourcer_AddTaint_MissingKey(t *testing.T) {
	node := testNode("taint-node")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "add-taint", pkgtypes.ActionInput{
		ID: "taint-node",
		Params: map[string]interface{}{
			"effect": "NoSchedule",
		},
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "taint key is required")
}

func TestNodeResourcer_AddTaint_MissingEffect(t *testing.T) {
	node := testNode("taint-node")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "add-taint", pkgtypes.ActionInput{
		ID: "taint-node",
		Params: map[string]interface{}{
			"key": "dedicated",
		},
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "taint effect is required")
}

func TestNodeResourcer_AddTaint_NodeNotFound(t *testing.T) {
	cs := newNodeClientSet()
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "add-taint", pkgtypes.ActionInput{
		ID: "nonexistent",
		Params: map[string]interface{}{
			"key":    "foo",
			"effect": "NoSchedule",
		},
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to get node")
}

// ===================== Remove Taint =====================

func TestNodeResourcer_RemoveTaint(t *testing.T) {
	existing := corev1.Taint{Key: "dedicated", Value: "gpu", Effect: corev1.TaintEffectNoSchedule}
	keep := corev1.Taint{Key: "other", Value: "val", Effect: corev1.TaintEffectNoExecute}
	node := testNode("taint-node", withTaints(existing, keep))
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "remove-taint", pkgtypes.ActionInput{
		ID: "taint-node",
		Params: map[string]interface{}{
			"key":    "dedicated",
			"effect": "NoSchedule",
		},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "removed")

	// Verify only the matching taint was removed.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "taint-node", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.Spec.Taints, 1)
	assert.Equal(t, "other", updated.Spec.Taints[0].Key)
}

func TestNodeResourcer_RemoveTaint_ByKeyOnly(t *testing.T) {
	t1 := corev1.Taint{Key: "foo", Value: "bar", Effect: corev1.TaintEffectNoSchedule}
	t2 := corev1.Taint{Key: "foo", Value: "baz", Effect: corev1.TaintEffectNoExecute}
	node := testNode("taint-node", withTaints(t1, t2))
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "remove-taint", pkgtypes.ActionInput{
		ID: "taint-node",
		Params: map[string]interface{}{
			"key": "foo",
			// no effect — removes all taints with this key
		},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)

	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "taint-node", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, updated.Spec.Taints)
}

func TestNodeResourcer_RemoveTaint_NotFound(t *testing.T) {
	node := testNode("taint-node")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "remove-taint", pkgtypes.ActionInput{
		ID: "taint-node",
		Params: map[string]interface{}{
			"key":    "nonexistent",
			"effect": "NoSchedule",
		},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "not found")
}

func TestNodeResourcer_RemoveTaint_MissingKey(t *testing.T) {
	node := testNode("taint-node")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "remove-taint", pkgtypes.ActionInput{
		ID:     "taint-node",
		Params: map[string]interface{}{},
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "taint key is required")
}

// ===================== Get Conditions =====================

func TestNodeResourcer_GetConditions(t *testing.T) {
	node := testNode("cond-node")
	node.Status.Conditions = []corev1.NodeCondition{
		{Type: corev1.NodeReady, Status: corev1.ConditionTrue, Reason: "KubeletReady", Message: "kubelet is posting ready status"},
		{Type: corev1.NodeMemoryPressure, Status: corev1.ConditionFalse, Reason: "KubeletHasSufficientMemory"},
		{Type: corev1.NodeDiskPressure, Status: corev1.ConditionFalse, Reason: "KubeletHasNoDiskPressure"},
	}
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "get-conditions", pkgtypes.ActionInput{
		ID: "cond-node",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)

	conditions, ok := result.Data["conditions"].([]interface{})
	require.True(t, ok)
	assert.Len(t, conditions, 3)

	first := conditions[0].(map[string]interface{})
	assert.Equal(t, "Ready", first["type"])
	assert.Equal(t, "True", first["status"])
	assert.Equal(t, "KubeletReady", first["reason"])
}

func TestNodeResourcer_GetConditions_NodeNotFound(t *testing.T) {
	cs := newNodeClientSet()
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "get-conditions", pkgtypes.ActionInput{
		ID: "ghost",
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to get node")
}

// ===================== Unknown Action =====================

func TestNodeResourcer_UnknownAction(t *testing.T) {
	cs := newNodeClientSet()
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(nodePluginCtx(), cs, pkgtypes.ResourceMeta{}, "invalid", pkgtypes.ActionInput{})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "unknown action")
}

// ===================== StreamAction =====================

func TestNodeResourcer_StreamAction_NotSupported(t *testing.T) {
	r := newTestNodeResourcer()

	err := r.StreamAction(nodePluginCtx(), nil, pkgtypes.ResourceMeta{}, "cordon", pkgtypes.ActionInput{}, nil)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "streaming actions not supported")
}

// ===================== isDaemonSetPod =====================

func TestIsDaemonSetPod_True(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "DaemonSet", Name: "node-exporter"},
			},
		},
	}
	assert.True(t, isDaemonSetPod(pod))
}

func TestIsDaemonSetPod_False_NoOwners(t *testing.T) {
	pod := &corev1.Pod{}
	assert.False(t, isDaemonSetPod(pod))
}

func TestIsDaemonSetPod_False_ReplicaSetOwner(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "ReplicaSet", Name: "my-deploy-abc123"},
			},
		},
	}
	assert.False(t, isDaemonSetPod(pod))
}

// ===================== WaitForPodRunning =====================

func TestWaitForPodRunning_AlreadyRunning(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "running-pod", Namespace: "default"},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	cs := fake.NewSimpleClientset(pod)

	err := WaitForPodRunning(context.Background(), cs, "default", "running-pod", 5*time.Second)
	require.NoError(t, err)
}

func TestWaitForPodRunning_PodNotFound_TimesOut(t *testing.T) {
	cs := fake.NewSimpleClientset()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	err := WaitForPodRunning(ctx, cs, "default", "missing-pod", 2*time.Second)
	require.Error(t, err)
}
