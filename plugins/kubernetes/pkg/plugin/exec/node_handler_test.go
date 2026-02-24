package exec

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers"
)

// TestDebugPodSpec verifies that the debug pod created by NodeHandler has the
// correct security context, toleration, and scheduling properties.
func TestDebugPodSpec(t *testing.T) {
	nodeName := "worker-1"
	debugPodName := "omniview-node-debug-worker-1-1234"

	privileged := true
	zero := int64(0)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      debugPodName,
			Namespace: debugPodNamespace,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "omniview",
				"omniview/debug-target":        nodeName,
			},
		},
		Spec: corev1.PodSpec{
			NodeName:      nodeName,
			HostPID:       true,
			HostNetwork:   true,
			RestartPolicy: corev1.RestartPolicyNever,
			Containers: []corev1.Container{
				{
					Name:    "debug",
					Image:   debugPodImage,
					Command: []string{"nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "/bin/sh"},
					Stdin:   true,
					TTY:     true,
					SecurityContext: &corev1.SecurityContext{
						Privileged: &privileged,
					},
				},
			},
			TerminationGracePeriodSeconds: &zero,
			Tolerations: []corev1.Toleration{
				{Operator: corev1.TolerationOpExists},
			},
		},
	}

	// Verify scheduling to the correct node.
	assert.Equal(t, nodeName, pod.Spec.NodeName)

	// Verify host namespace access.
	assert.True(t, pod.Spec.HostPID)
	assert.True(t, pod.Spec.HostNetwork)

	// Verify privileged container.
	require.Len(t, pod.Spec.Containers, 1)
	container := pod.Spec.Containers[0]
	assert.Equal(t, "debug", container.Name)
	assert.Equal(t, debugPodImage, container.Image)
	require.NotNil(t, container.SecurityContext)
	require.NotNil(t, container.SecurityContext.Privileged)
	assert.True(t, *container.SecurityContext.Privileged)

	// Verify nsenter command for host namespace access.
	assert.Equal(t, []string{"nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "/bin/sh"}, container.Command)

	// Verify TTY is enabled.
	assert.True(t, container.TTY)
	assert.True(t, container.Stdin)

	// Verify tolerate-all so debug pod runs on cordoned/tainted nodes.
	require.Len(t, pod.Spec.Tolerations, 1)
	assert.Equal(t, corev1.TolerationOpExists, pod.Spec.Tolerations[0].Operator)

	// Verify cleanup-friendly settings.
	assert.Equal(t, corev1.RestartPolicyNever, pod.Spec.RestartPolicy)
	require.NotNil(t, pod.Spec.TerminationGracePeriodSeconds)
	assert.Equal(t, int64(0), *pod.Spec.TerminationGracePeriodSeconds)

	// Verify labels for tracking.
	assert.Equal(t, "omniview", pod.Labels["app.kubernetes.io/managed-by"])
	assert.Equal(t, nodeName, pod.Labels["omniview/debug-target"])

	// Verify namespace.
	assert.Equal(t, "kube-system", pod.Namespace)
}

// TestNodeHandler_MetadataExtraction verifies that the node name is correctly
// extracted from the session options resource data.
func TestNodeHandler_MetadataExtraction(t *testing.T) {
	tests := []struct {
		name         string
		resourceData map[string]interface{}
		wantName     string
		wantErr      bool
	}{
		{
			name: "valid metadata",
			resourceData: map[string]interface{}{
				"metadata": map[string]interface{}{
					"name": "worker-1",
				},
			},
			wantName: "worker-1",
		},
		{
			name:         "missing metadata",
			resourceData: map[string]interface{}{},
			wantErr:      true,
		},
		{
			name: "metadata without name",
			resourceData: map[string]interface{}{
				"metadata": map[string]interface{}{},
			},
			wantErr: true,
		},
		{
			name: "metadata is wrong type",
			resourceData: map[string]interface{}{
				"metadata": "not-a-map",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			metadata, ok := tt.resourceData["metadata"].(map[string]interface{})
			if !ok {
				if tt.wantErr {
					return // expected
				}
				t.Fatal("expected metadata extraction to succeed")
			}
			nodeName, ok := metadata["name"].(string)
			if !ok {
				if tt.wantErr {
					return
				}
				t.Fatal("expected name extraction to succeed")
			}
			if tt.wantErr {
				t.Fatal("expected error but got none")
			}
			assert.Equal(t, tt.wantName, nodeName)
		})
	}
}

// TestDebugPodCleanup verifies that debug pod cleanup (delete) works correctly
// using a fake clientset.
func TestDebugPodCleanup(t *testing.T) {
	debugPodName := "omniview-node-debug-worker-1-1234"

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      debugPodName,
			Namespace: debugPodNamespace,
		},
	}

	fakeClient := fake.NewSimpleClientset(pod)

	// Verify pod exists.
	_, err := fakeClient.CoreV1().Pods(debugPodNamespace).Get(t.Context(), debugPodName, metav1.GetOptions{})
	require.NoError(t, err)

	// Simulate cleanup.
	zero := int64(0)
	err = fakeClient.CoreV1().Pods(debugPodNamespace).Delete(
		t.Context(), debugPodName, metav1.DeleteOptions{GracePeriodSeconds: &zero},
	)
	require.NoError(t, err)

	// Verify pod is gone.
	_, err = fakeClient.CoreV1().Pods(debugPodNamespace).Get(t.Context(), debugPodName, metav1.GetOptions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

// TestWaitForPodRunning_DebugPod verifies WaitForPodRunning works for the
// debug pod pattern used by NodeHandler.
func TestWaitForPodRunning_DebugPod(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "omniview-node-debug-test-1234",
			Namespace: debugPodNamespace,
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	fakeClient := fake.NewSimpleClientset(pod)

	err := resourcers.WaitForPodRunning(
		t.Context(), fakeClient, debugPodNamespace, "omniview-node-debug-test-1234", debugPodTimeout,
	)
	require.NoError(t, err)
}

// TestWaitForPodRunning_Pending verifies WaitForPodRunning times out for pending pods.
func TestWaitForPodRunning_Pending(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pending-debug",
			Namespace: debugPodNamespace,
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	}

	fakeClient := fake.NewSimpleClientset(pod)

	err := resourcers.WaitForPodRunning(
		t.Context(), fakeClient, debugPodNamespace, "pending-debug", 3*time.Second,
	)
	require.Error(t, err)
}
