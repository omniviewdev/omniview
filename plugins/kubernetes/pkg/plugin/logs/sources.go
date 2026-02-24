package logs

import (
	"fmt"

	"github.com/omniviewdev/plugin-sdk/pkg/logs"

	corev1 "k8s.io/api/core/v1"
)

// podToSources extracts LogSources from a pod's containers.
func podToSources(pod corev1.Pod, target string) []logs.LogSource {
	var sources []logs.LogSource

	containers := allContainers(pod)
	for _, c := range containers {
		if target != "" && c.Name != target {
			continue
		}

		sources = append(sources, logs.LogSource{
			ID: fmt.Sprintf("%s/%s", pod.Name, c.Name),
			Labels: map[string]string{
				"pod":       pod.Name,
				"container": c.Name,
				"namespace": pod.Namespace,
				"node":      pod.Spec.NodeName,
			},
		})
	}

	return sources
}

// allContainers returns init, regular, and ephemeral containers.
func allContainers(pod corev1.Pod) []corev1.Container {
	containers := make([]corev1.Container, 0,
		len(pod.Spec.InitContainers)+len(pod.Spec.Containers)+len(pod.Spec.EphemeralContainers))

	containers = append(containers, pod.Spec.InitContainers...)
	containers = append(containers, pod.Spec.Containers...)

	for _, ec := range pod.Spec.EphemeralContainers {
		containers = append(containers, corev1.Container{
			Name:  ec.Name,
			Image: ec.Image,
		})
	}

	return containers
}

// PodSourceBuilder is a SourceBuilderFunc that extracts per-container sources
// from raw pod resource data (map[string]interface{}) so the manager can fan
// out to one handler call per container. Without this, "all containers" mode
// sends a single request with an empty container name, which the K8s API
// rejects for multi-container pods.
func PodSourceBuilder(
	resourceID string,
	resourceData map[string]interface{},
	opts logs.LogSessionOptions,
) []logs.LogSource {
	name, namespace := extractNameAndNamespace(resourceData)
	if name == "" {
		return nil
	}

	// Gather container names from spec.containers, spec.initContainers,
	// and spec.ephemeralContainers in the raw resource data.
	spec, _ := resourceData["spec"].(map[string]interface{})
	if spec == nil {
		return nil
	}

	type containerInfo struct {
		name string
	}
	var containers []containerInfo
	for _, key := range []string{"initContainers", "containers", "ephemeralContainers"} {
		arr, _ := spec[key].([]interface{})
		for _, item := range arr {
			c, _ := item.(map[string]interface{})
			if cName, _ := c["name"].(string); cName != "" {
				containers = append(containers, containerInfo{name: cName})
			}
		}
	}

	target := opts.Target
	node, _ := extractNodeName(resourceData)

	var sources []logs.LogSource
	for _, c := range containers {
		if target != "" && c.name != target {
			continue
		}
		sources = append(sources, logs.LogSource{
			ID: fmt.Sprintf("%s/%s", name, c.name),
			Labels: map[string]string{
				"pod":       name,
				"container": c.name,
				"namespace": namespace,
				"node":      node,
			},
		})
	}
	return sources
}

// extractNodeName reads spec.nodeName from raw resource data.
func extractNodeName(data map[string]interface{}) (string, bool) {
	spec, ok := data["spec"].(map[string]interface{})
	if !ok {
		return "", false
	}
	node, ok := spec["nodeName"].(string)
	return node, ok
}

// extractNameAndNamespace extracts the name and namespace from resource data.
func extractNameAndNamespace(data map[string]interface{}) (string, string) {
	var name, namespace string
	if metadata, ok := data["metadata"].(map[string]interface{}); ok {
		if n, ok := metadata["name"].(string); ok {
			name = n
		}
		if ns, ok := metadata["namespace"].(string); ok {
			namespace = ns
		}
	}
	return name, namespace
}
