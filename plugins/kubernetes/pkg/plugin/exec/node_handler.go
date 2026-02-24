package exec

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers"
	"github.com/omniview/kubernetes/pkg/utils"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/omniviewdev/plugin-sdk/pkg/exec"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	debugPodNamespace = "kube-system"
	debugPodTimeout   = 60 * time.Second
	debugPodImage     = "busybox:latest"
)

// NodeHandler creates a privileged debug pod on the target node using
// nsenter to access the host namespaces, then execs into it. On
// disconnect the debug pod is cleaned up.
func NodeHandler(
	ctx *types.PluginContext,
	opts exec.SessionOptions,
	tty *os.File,
	stopCh chan error,
	resize <-chan exec.SessionResizeInput,
) error {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return err
	}

	// Extract node name from the resource data.
	metadata, ok := opts.ResourceData["metadata"].(map[string]interface{})
	if !ok {
		return errors.New("metadata is required")
	}
	nodeName, ok := metadata["name"].(string)
	if !ok {
		return errors.New("node name is required")
	}

	// Create a unique debug pod name.
	debugPodName := fmt.Sprintf("omniview-node-debug-%s-%d", nodeName, time.Now().Unix())

	// Resolve configurable image and nsenter command from params.
	podImage := debugPodImage
	if img, ok := opts.Params["node_shell_image"]; ok && img != "" {
		podImage = img
	}

	nsenterCommand := []string{"nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "/bin/bash"}
	if cmd, ok := opts.Params["node_shell_command"]; ok && cmd != "" {
		nsenterCommand = strings.Fields(cmd)
	}

	// Define the privileged debug pod.
	privileged := true
	hostPID := true
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
			HostPID:       hostPID,
			HostNetwork:   true,
			RestartPolicy: corev1.RestartPolicyNever,
			Containers: []corev1.Container{
				{
					Name:    "debug",
					Image:   podImage,
					Command: nsenterCommand,
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

	// Create the debug pod.
	_, err = clients.Clientset.CoreV1().Pods(debugPodNamespace).Create(ctx.Context, pod, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("failed to create debug pod: %w", err)
	}

	// Ensure cleanup on exit. Use a detached context so the delete succeeds
	// even when the session context has already been cancelled.
	cleanup := func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		_ = clients.Clientset.CoreV1().Pods(debugPodNamespace).Delete(
			cleanupCtx, debugPodName, metav1.DeleteOptions{GracePeriodSeconds: &zero},
		)
	}

	// Wait for pod to be running.
	if err := resourcers.WaitForPodRunning(ctx.Context, clients.Clientset, debugPodNamespace, debugPodName, debugPodTimeout); err != nil {
		cleanup()
		return fmt.Errorf("debug pod did not reach Running state: %w", err)
	}

	// Exec into the debug pod.
	command := opts.Command
	if len(command) == 0 {
		command = []string{"/bin/bash"}
	}

	// Use a wrapper stop channel so we can intercept completion and clean up.
	innerStopCh := make(chan error, 1)
	err = ExecCmd(
		ctx.Context,
		clients.Clientset,
		clients.RestConfig,
		debugPodNamespace,
		debugPodName,
		"debug",
		command,
		tty,
		innerStopCh,
		resize,
	)
	if err != nil {
		cleanup()
		return err
	}

	// Forward the inner stop signal and clean up.
	// Listen for both the exec finishing and context cancellation to ensure
	// the debug pod is always deleted.
	go func() {
		select {
		case execErr := <-innerStopCh:
			cleanup()
			stopCh <- execErr
		case <-ctx.Context.Done():
			cleanup()
			stopCh <- ctx.Context.Err()
		}
	}()

	return nil
}
