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
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
)

func newTestDeploymentResourcer() *DeploymentResourcer {
	return NewDeploymentResourcer(zap.NewNop().Sugar())
}

func newAppsDeploymentClientSet(objects ...runtime.Object) *clients.ClientSet {
	fakeClient := fake.NewSimpleClientset(objects...)
	return &clients.ClientSet{
		KubeClient: fakeClient,
	}
}

func deploymentPluginCtx() *types.PluginContext {
	return &types.PluginContext{
		Context: context.Background(),
	}
}

func testDeployment(name, ns string, replicas int32, opts ...func(*appsv1.Deployment)) *appsv1.Deployment {
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": name},
			},
			Template: corev1PodTemplateSpec(name),
		},
	}
	for _, o := range opts {
		o(dep)
	}
	return dep
}

func withPaused(dep *appsv1.Deployment) {
	dep.Spec.Paused = true
}

// corev1PodTemplateSpec returns a minimal PodTemplateSpec for testing.
func corev1PodTemplateSpec(name string) corev1.PodTemplateSpec {
	return corev1.PodTemplateSpec{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{"app": name},
		},
	}
}

// ===================== GetActions =====================

func TestDeploymentResourcer_GetActions(t *testing.T) {
	r := newTestDeploymentResourcer()
	actions, err := r.GetActions(deploymentPluginCtx(), nil, pkgtypes.ResourceMeta{})
	require.NoError(t, err)
	require.Len(t, actions, 4)

	ids := make([]string, len(actions))
	for i, a := range actions {
		ids[i] = a.ID
	}
	assert.Equal(t, "restart", ids[0])
	assert.Equal(t, "scale", ids[1])
	assert.Equal(t, "pause", ids[2])
	assert.Equal(t, "resume", ids[3])

	for _, a := range actions {
		assert.Equal(t, pkgtypes.ActionScopeInstance, a.Scope)
	}
	assert.True(t, actions[0].Streaming, "restart should be streaming")
	assert.False(t, actions[1].Streaming, "scale should not be streaming")
	assert.False(t, actions[2].Streaming, "pause should not be streaming")
	assert.False(t, actions[3].Streaming, "resume should not be streaming")
}

// ===================== Restart =====================

func TestDeploymentResourcer_Restart(t *testing.T) {
	dep := testDeployment("nginx", "default", 3)
	cs := newAppsDeploymentClientSet(dep)
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "restart", pkgtypes.ActionInput{
		ID:        "nginx",
		Namespace: "default",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)

	// Verify the restart annotation was set.
	updated, err := cs.KubeClient.AppsV1().Deployments("default").Get(context.Background(), "nginx", metav1.GetOptions{})
	require.NoError(t, err)
	ann := updated.Spec.Template.Annotations
	assert.Contains(t, ann, "kubectl.kubernetes.io/restartedAt")
}

func TestDeploymentResourcer_Restart_NotFound(t *testing.T) {
	cs := newAppsDeploymentClientSet()
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "restart", pkgtypes.ActionInput{
		ID:        "nonexistent",
		Namespace: "default",
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to restart deployment")
}

// ===================== Scale =====================

func TestDeploymentResourcer_Scale(t *testing.T) {
	dep := testDeployment("nginx", "default", 3)
	cs := newAppsDeploymentClientSet(dep)
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "scale", pkgtypes.ActionInput{
		ID:        "nginx",
		Namespace: "default",
		Params:    map[string]interface{}{"replicas": float64(5)},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "scaled to 5")

	updated, err := cs.KubeClient.AppsV1().Deployments("default").Get(context.Background(), "nginx", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(5), *updated.Spec.Replicas)
}

func TestDeploymentResourcer_Scale_ToZero(t *testing.T) {
	dep := testDeployment("nginx", "default", 3)
	cs := newAppsDeploymentClientSet(dep)
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "scale", pkgtypes.ActionInput{
		ID:        "nginx",
		Namespace: "default",
		Params:    map[string]interface{}{"replicas": float64(0)},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)

	updated, err := cs.KubeClient.AppsV1().Deployments("default").Get(context.Background(), "nginx", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(0), *updated.Spec.Replicas)
}

func TestDeploymentResourcer_Scale_MissingParam(t *testing.T) {
	dep := testDeployment("nginx", "default", 3)
	cs := newAppsDeploymentClientSet(dep)
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "scale", pkgtypes.ActionInput{
		ID:        "nginx",
		Namespace: "default",
		Params:    map[string]interface{}{},
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "replicas parameter is required")
}

func TestDeploymentResourcer_Scale_NotFound(t *testing.T) {
	cs := newAppsDeploymentClientSet()
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "scale", pkgtypes.ActionInput{
		ID:        "nonexistent",
		Namespace: "default",
		Params:    map[string]interface{}{"replicas": float64(5)},
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to scale deployment")
}

// ===================== Pause =====================

func TestDeploymentResourcer_Pause(t *testing.T) {
	dep := testDeployment("nginx", "default", 3)
	cs := newAppsDeploymentClientSet(dep)
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "pause", pkgtypes.ActionInput{
		ID:        "nginx",
		Namespace: "default",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "paused")

	updated, err := cs.KubeClient.AppsV1().Deployments("default").Get(context.Background(), "nginx", metav1.GetOptions{})
	require.NoError(t, err)
	assert.True(t, updated.Spec.Paused)
}

func TestDeploymentResourcer_Pause_NotFound(t *testing.T) {
	cs := newAppsDeploymentClientSet()
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "pause", pkgtypes.ActionInput{
		ID:        "nonexistent",
		Namespace: "default",
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to pause deployment")
}

// ===================== Resume =====================

func TestDeploymentResourcer_Resume(t *testing.T) {
	dep := testDeployment("nginx", "default", 3, withPaused)
	cs := newAppsDeploymentClientSet(dep)
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "resume", pkgtypes.ActionInput{
		ID:        "nginx",
		Namespace: "default",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Success)
	assert.Contains(t, result.Message, "resumed")
}

func TestDeploymentResourcer_Resume_NotFound(t *testing.T) {
	cs := newAppsDeploymentClientSet()
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "resume", pkgtypes.ActionInput{
		ID:        "nonexistent",
		Namespace: "default",
	})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to resume deployment")
}

// ===================== Unknown Action =====================

func TestDeploymentResourcer_UnknownAction(t *testing.T) {
	cs := newAppsDeploymentClientSet()
	r := newTestDeploymentResourcer()

	result, err := r.ExecuteAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "foo", pkgtypes.ActionInput{})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "unknown action: foo")
}

// ===================== StreamAction =====================

func TestDeploymentResourcer_StreamAction_UnsupportedAction(t *testing.T) {
	r := newTestDeploymentResourcer()
	stream := make(chan pkgtypes.ActionEvent, 10)

	err := r.StreamAction(deploymentPluginCtx(), nil, pkgtypes.ResourceMeta{}, "scale", pkgtypes.ActionInput{}, stream)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "streaming not supported for action: scale")
}

func TestDeploymentResourcer_StreamAction_Restart_NotFound(t *testing.T) {
	cs := newAppsDeploymentClientSet()
	r := newTestDeploymentResourcer()
	stream := make(chan pkgtypes.ActionEvent, 10)

	err := r.StreamAction(deploymentPluginCtx(), cs, pkgtypes.ResourceMeta{}, "restart", pkgtypes.ActionInput{
		ID:        "nonexistent",
		Namespace: "default",
	}, stream)

	require.Error(t, err)

	// Stream should have received an error event and be closed.
	var events []pkgtypes.ActionEvent
	for ev := range stream {
		events = append(events, ev)
	}
	require.NotEmpty(t, events)
	assert.Equal(t, "error", events[0].Type)
}
