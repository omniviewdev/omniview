package logs

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/omniviewdev/plugin-sdk/pkg/logs"
	"github.com/omniviewdev/plugin-sdk/pkg/types"

	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
)

// DeploymentSourceResolver resolves a Deployment to its pod containers.
func DeploymentSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	deployment, err := clients.Clientset.AppsV1().Deployments(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get deployment %s/%s: %w", namespace, name, err)
	}

	selector, err := metav1.LabelSelectorAsSelector(deployment.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse selector: %w", err)
	}

	return resolvePodsToSources(ctx, clients, namespace, selector, opts)
}

// StatefulSetSourceResolver resolves a StatefulSet to its pod containers.
func StatefulSetSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	sts, err := clients.Clientset.AppsV1().StatefulSets(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get statefulset %s/%s: %w", namespace, name, err)
	}

	selector, err := metav1.LabelSelectorAsSelector(sts.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse selector: %w", err)
	}

	return resolvePodsToSources(ctx, clients, namespace, selector, opts)
}

// DaemonSetSourceResolver resolves a DaemonSet to its pod containers.
func DaemonSetSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	ds, err := clients.Clientset.AppsV1().DaemonSets(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get daemonset %s/%s: %w", namespace, name, err)
	}

	selector, err := metav1.LabelSelectorAsSelector(ds.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse selector: %w", err)
	}

	return resolvePodsToSources(ctx, clients, namespace, selector, opts)
}

// ReplicaSetSourceResolver resolves a ReplicaSet to its pod containers.
func ReplicaSetSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	rs, err := clients.Clientset.AppsV1().ReplicaSets(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get replicaset %s/%s: %w", namespace, name, err)
	}

	selector, err := metav1.LabelSelectorAsSelector(rs.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse selector: %w", err)
	}

	return resolvePodsToSources(ctx, clients, namespace, selector, opts)
}

// JobSourceResolver resolves a Job to its pod containers.
func JobSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	job, err := clients.Clientset.BatchV1().Jobs(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get job %s/%s: %w", namespace, name, err)
	}

	selector, err := metav1.LabelSelectorAsSelector(job.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse selector: %w", err)
	}

	return resolvePodsToSources(ctx, clients, namespace, selector, opts)
}

// CronJobSourceResolver resolves a CronJob to its active job pods.
func CronJobSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	cronjob, err := clients.Clientset.BatchV1().CronJobs(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get cronjob %s/%s: %w", namespace, name, err)
	}

	var allSources []logs.LogSource
	for _, ref := range cronjob.Status.Active {
		job, err := clients.Clientset.BatchV1().Jobs(namespace).Get(
			ctx.Context, ref.Name, metav1.GetOptions{},
		)
		if err != nil {
			continue
		}

		selector, err := metav1.LabelSelectorAsSelector(job.Spec.Selector)
		if err != nil {
			continue
		}

		result, err := resolvePodsToSources(ctx, clients, namespace, selector, opts)
		if err != nil {
			continue
		}
		allSources = append(allSources, result.Sources...)
	}

	return &logs.SourceResolverResult{Sources: allSources}, nil
}

// resolvePodsToSources lists pods matching a selector and extracts container sources.
func resolvePodsToSources(
	ctx *types.PluginContext,
	clients *kubeauth.KubeClientBundle,
	namespace string,
	selector labels.Selector,
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	pods, err := clients.Clientset.CoreV1().Pods(namespace).List(
		ctx.Context,
		metav1.ListOptions{LabelSelector: selector.String()},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	var sources []logs.LogSource
	for _, pod := range pods.Items {
		sources = append(sources, podToSources(pod, opts.Target)...)
	}

	result := &logs.SourceResolverResult{Sources: sources}

	if opts.Watch {
		eventCh := make(chan logs.SourceEvent, 16)
		result.Events = eventCh
		go watchPodsAsSourceEvents(ctx, clients, namespace, selector, opts.Target, eventCh)
	}

	return result, nil
}

// watchPodsAsSourceEvents watches for pod changes and emits source events.
func watchPodsAsSourceEvents(
	ctx *types.PluginContext,
	clients *kubeauth.KubeClientBundle,
	namespace string,
	selector labels.Selector,
	target string,
	eventCh chan<- logs.SourceEvent,
) {
	defer close(eventCh)

	watcher, err := clients.Clientset.CoreV1().Pods(namespace).Watch(
		context.Background(),
		metav1.ListOptions{LabelSelector: selector.String()},
	)
	if err != nil {
		return
	}
	defer watcher.Stop()

	for {
		select {
		case <-ctx.Context.Done():
			return
		case event, ok := <-watcher.ResultChan():
			if !ok {
				return
			}

			pod, ok := event.Object.(*corev1.Pod)
			if !ok {
				continue
			}

			sources := podToSources(*pod, target)
			for _, src := range sources {
				switch event.Type {
				case "ADDED":
					eventCh <- logs.SourceEvent{Type: logs.SourceAdded, Source: src}
				case "DELETED":
					eventCh <- logs.SourceEvent{Type: logs.SourceRemoved, Source: src}
				}
			}
		}
	}
}
