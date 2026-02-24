package logs

import (
	"fmt"
	"io"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/omniviewdev/plugin-sdk/pkg/logs"
	"github.com/omniviewdev/plugin-sdk/pkg/types"

	"github.com/omniview/kubernetes/pkg/utils"
)

// PodLogHandler opens a log stream for a single K8s pod container.
func PodLogHandler(ctx *types.PluginContext, req logs.LogStreamRequest) (io.ReadCloser, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get kube clients: %w", err)
	}

	// Prefer source labels (set by SourceResolvers for group resources like
	// Deployments, StatefulSets, etc.) over resource data, since resource data
	// may point to the parent resource rather than the actual pod.
	pod := req.Labels["pod"]
	namespace := req.Labels["namespace"]
	if pod == "" {
		pod, namespace = extractPodIdentity(req.ResourceData)
	}

	// Container comes from labels first (resolved sources), then target selection
	container := req.Labels["container"]
	if container == "" {
		container = req.Target
	}

	logOpts := &corev1.PodLogOptions{
		Container:    container,
		Follow:       req.Follow,
		Previous:     req.IncludePrevious,
		Timestamps:   true, // always request timestamps for merge ordering
		TailLines:    ptrIfPositive(req.TailLines),
		SinceSeconds: ptrIfPositive(req.SinceSeconds),
	}

	if req.SinceTime != nil {
		t := metav1.NewTime(*req.SinceTime)
		logOpts.SinceTime = &t
	}

	if req.LimitBytes > 0 {
		logOpts.LimitBytes = &req.LimitBytes
	}

	return clients.Clientset.CoreV1().Pods(namespace).GetLogs(pod, logOpts).Stream(ctx.Context)
}

func ptrIfPositive(v int64) *int64 {
	if v > 0 {
		return &v
	}
	return nil
}

// extractPodIdentity reads the pod name and namespace from resource data (the full K8s object).
func extractPodIdentity(data map[string]interface{}) (name, namespace string) {
	if data == nil {
		return "", ""
	}
	metadata, ok := data["metadata"].(map[string]interface{})
	if !ok {
		return "", ""
	}
	if n, ok := metadata["name"].(string); ok {
		name = n
	}
	if ns, ok := metadata["namespace"].(string); ok {
		namespace = ns
	}
	return name, namespace
}
