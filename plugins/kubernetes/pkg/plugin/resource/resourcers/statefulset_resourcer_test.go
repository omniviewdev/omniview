package resourcers

import (
	"context"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
)

func newTestStatefulSetResourcer() *StatefulSetResourcer {
	return NewStatefulSetResourcer(zap.NewNop().Sugar())
}

func newAppsStatefulSetClientSet(objects ...runtime.Object) *clients.ClientSet {
	fakeClient := fake.NewSimpleClientset(objects...)
	return &clients.ClientSet{
		KubeClient: fakeClient,
	}
}

func statefulSetPluginCtx() *types.PluginContext {
	return &types.PluginContext{
		Context: context.Background(),
	}
}

func testStatefulSet(name, ns string, replicas int32, opts ...func(*appsv1.StatefulSet)) *appsv1.StatefulSet {
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": name},
			},
			Template: corev1PodTemplateSpec(name),
		},
	}
	for _, o := range opts {
		o(sts)
	}
	return sts
}

// ===================== GetActions =====================

func TestStatefulSetResourcer_GetActions(t *testing.T) {
	r := newTestStatefulSetResourcer()
	actions, err := r.GetActions(statefulSetPluginCtx(), nil, pkgtypes.ResourceMeta{})
	require.NoError(t, err)
	require.Len(t, actions, 2)

	assert.Equal(t, "restart", actions[0].ID)
	assert.Equal(t, "scale", actions[1].ID)

	for _, a := range actions {
		assert.Equal(t, pkgtypes.ActionScopeInstance, a.Scope)
	}
	assert.True(t, actions[0].Streaming, "restart should be streaming")
	assert.False(t, actions[1].Streaming, "scale should not be streaming")
}

// ===================== Restart =====================

func TestStatefulSetResourcer_Restart(t *testing.T) {
	sts := testStatefulSet("redis", "default", 3)
	cs := newAppsStatefulSetClientSet(sts)
	r := newTestStatefulSetResourcer()

	result, err := r.ExecuteAction(statefulSetPluginCtx(), cs, pkgtypes.ResourceMeta{}, "restart", pkgtypes.ActionInput{
		ID:        "redis",
		Namespace: "default",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)

	updated, err := cs.KubeClient.AppsV1().StatefulSets("default").Get(context.Background(), "redis", metav1.GetOptions{})
	require.NoError(t, err)
	ann := updated.Spec.Template.Annotations
	assert.Contains(t, ann, "kubectl.kubernetes.io/restartedAt")
}

func TestStatefulSetResourcer_Restart_NotFound(t *testing.T) {
	cs := newAppsStatefulSetClientSet()
	r := newTestStatefulSetResourcer()

	result, err := r.ExecuteAction(statefulSetPluginCtx(), cs, pkgtypes.ResourceMeta{}, "restart", pkgtypes.ActionInput{
		ID:        "nonexistent",
		Namespace: "default",
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to restart statefulset")
}

// ===================== Scale =====================

func TestStatefulSetResourcer_Scale(t *testing.T) {
	sts := testStatefulSet("redis", "default", 1)
	cs := newAppsStatefulSetClientSet(sts)
	r := newTestStatefulSetResourcer()

	result, err := r.ExecuteAction(statefulSetPluginCtx(), cs, pkgtypes.ResourceMeta{}, "scale", pkgtypes.ActionInput{
		ID:        "redis",
		Namespace: "default",
		Params:    map[string]interface{}{"replicas": float64(3)},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "scaled to 3")

	updated, err := cs.KubeClient.AppsV1().StatefulSets("default").Get(context.Background(), "redis", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(3), *updated.Spec.Replicas)
}

func TestStatefulSetResourcer_Scale_ToZero(t *testing.T) {
	sts := testStatefulSet("redis", "default", 3)
	cs := newAppsStatefulSetClientSet(sts)
	r := newTestStatefulSetResourcer()

	result, err := r.ExecuteAction(statefulSetPluginCtx(), cs, pkgtypes.ResourceMeta{}, "scale", pkgtypes.ActionInput{
		ID:        "redis",
		Namespace: "default",
		Params:    map[string]interface{}{"replicas": float64(0)},
	})

	require.NoError(t, err)
	require.NotNil(t, result)

	updated, err := cs.KubeClient.AppsV1().StatefulSets("default").Get(context.Background(), "redis", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *updated.Spec.Replicas)
}

func TestStatefulSetResourcer_Scale_MissingParam(t *testing.T) {
	sts := testStatefulSet("redis", "default", 3)
	cs := newAppsStatefulSetClientSet(sts)
	r := newTestStatefulSetResourcer()

	result, err := r.ExecuteAction(statefulSetPluginCtx(), cs, pkgtypes.ResourceMeta{}, "scale", pkgtypes.ActionInput{
		ID:        "redis",
		Namespace: "default",
		Params:    map[string]interface{}{},
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "replicas parameter is required")
}

func TestStatefulSetResourcer_Scale_NotFound(t *testing.T) {
	cs := newAppsStatefulSetClientSet()
	r := newTestStatefulSetResourcer()

	result, err := r.ExecuteAction(statefulSetPluginCtx(), cs, pkgtypes.ResourceMeta{}, "scale", pkgtypes.ActionInput{
		ID:        "nonexistent",
		Namespace: "default",
		Params:    map[string]interface{}{"replicas": float64(3)},
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to scale statefulset")
}

// ===================== Unknown Action =====================

func TestStatefulSetResourcer_UnknownAction(t *testing.T) {
	cs := newAppsStatefulSetClientSet()
	r := newTestStatefulSetResourcer()

	result, err := r.ExecuteAction(statefulSetPluginCtx(), cs, pkgtypes.ResourceMeta{}, "foo", pkgtypes.ActionInput{})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "unknown action")
}

// ===================== StreamAction =====================

func TestStatefulSetResourcer_StreamAction_UnsupportedAction(t *testing.T) {
	r := newTestStatefulSetResourcer()
	stream := make(chan pkgtypes.ActionEvent, 10)

	err := r.StreamAction(statefulSetPluginCtx(), nil, pkgtypes.ResourceMeta{}, "scale", pkgtypes.ActionInput{}, stream)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "streaming not supported")
}

func TestStatefulSetResourcer_StreamAction_Restart_NotFound(t *testing.T) {
	cs := newAppsStatefulSetClientSet()
	r := newTestStatefulSetResourcer()
	stream := make(chan pkgtypes.ActionEvent, 10)

	err := r.StreamAction(statefulSetPluginCtx(), cs, pkgtypes.ResourceMeta{}, "restart", pkgtypes.ActionInput{
		ID:        "nonexistent",
		Namespace: "default",
	}, stream)

	require.Error(t, err)

	var events []pkgtypes.ActionEvent
	for ev := range stream {
		events = append(events, ev)
	}
	require.NotEmpty(t, events)
	assert.Equal(t, "error", events[0].Type)
}
