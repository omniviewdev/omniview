package resourcers

import (
	"fmt"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/watch"
)

// StatefulSetResourcer wraps KubernetesResourcerBase for CRUD and adds
// statefulset-specific actions: restart, scale.
type StatefulSetResourcer struct {
	*KubernetesResourcerBase[MetaAccessor]
	log *zap.SugaredLogger
}

// Compile-time interface checks.
var (
	_ pkgtypes.Resourcer[clients.ClientSet]       = (*StatefulSetResourcer)(nil)
	_ pkgtypes.ActionResourcer[clients.ClientSet]  = (*StatefulSetResourcer)(nil)
)

// NewStatefulSetResourcer creates a StatefulSetResourcer for apps::v1::StatefulSet.
func NewStatefulSetResourcer(logger *zap.SugaredLogger) *StatefulSetResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		appsv1.SchemeGroupVersion.WithResource("statefulsets"),
	)
	return &StatefulSetResourcer{
		KubernetesResourcerBase: base.(*KubernetesResourcerBase[MetaAccessor]),
		log:                     logger.Named("StatefulSetResourcer"),
	}
}

// ====================== ACTION INTERFACE ====================== //

func (s *StatefulSetResourcer) GetActions(
	_ *types.PluginContext,
	_ *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
) ([]pkgtypes.ActionDescriptor, error) {
	return []pkgtypes.ActionDescriptor{
		{
			ID:          "restart",
			Label:       "Rollout Restart",
			Description: "Restart all pods in this statefulset via a rolling update",
			Icon:        "LuRefreshCw",
			Scope:       pkgtypes.ActionScopeInstance,
			Streaming:   true,
		},
		{
			ID:          "scale",
			Label:       "Scale",
			Description: "Change the number of replicas",
			Icon:        "LuScaling",
			Scope:       pkgtypes.ActionScopeInstance,
		},
	}, nil
}

func (s *StatefulSetResourcer) ExecuteAction(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	actionID string,
	input pkgtypes.ActionInput,
) (*pkgtypes.ActionResult, error) {
	switch actionID {
	case "restart":
		return s.executeRestart(ctx, client, input)
	case "scale":
		return s.executeScale(ctx, client, input)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (s *StatefulSetResourcer) StreamAction(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	actionID string,
	input pkgtypes.ActionInput,
	stream chan pkgtypes.ActionEvent,
) error {
	switch actionID {
	case "restart":
		return s.streamRestart(ctx, client, input, stream)
	default:
		return fmt.Errorf("streaming not supported for action: %s", actionID)
	}
}

// ====================== ACTION IMPLEMENTATIONS ====================== //

func (s *StatefulSetResourcer) executeRestart(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	input pkgtypes.ActionInput,
) (*pkgtypes.ActionResult, error) {
	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339),
	)
	_, err := client.KubeClient.AppsV1().StatefulSets(input.Namespace).Patch(
		ctx.Context, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to restart statefulset %s: %w", input.ID, err)
	}

	return &pkgtypes.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Rollout restart initiated for statefulset %s", input.ID),
	}, nil
}

func (s *StatefulSetResourcer) streamRestart(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	input pkgtypes.ActionInput,
	stream chan pkgtypes.ActionEvent,
) error {
	defer close(stream)

	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339),
	)
	_, err := client.KubeClient.AppsV1().StatefulSets(input.Namespace).Patch(
		ctx.Context, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		stream <- pkgtypes.ActionEvent{
			Type: "error",
			Data: map[string]interface{}{"message": fmt.Sprintf("failed to restart: %v", err)},
		}
		return err
	}

	stream <- pkgtypes.ActionEvent{
		Type: "progress",
		Data: map[string]interface{}{"message": "Rollout restart initiated"},
	}

	watcher, err := client.KubeClient.AppsV1().StatefulSets(input.Namespace).Watch(
		ctx.Context, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("metadata.name=%s", input.ID),
		},
	)
	if err != nil {
		stream <- pkgtypes.ActionEvent{
			Type: "error",
			Data: map[string]interface{}{"message": fmt.Sprintf("failed to watch statefulset: %v", err)},
		}
		return err
	}
	defer watcher.Stop()

	timeout := time.After(5 * time.Minute)
	for {
		select {
		case <-timeout:
			stream <- pkgtypes.ActionEvent{
				Type: "error",
				Data: map[string]interface{}{"message": "rollout restart timed out after 5 minutes"},
			}
			return fmt.Errorf("rollout restart timed out")

		case <-ctx.Context.Done():
			return ctx.Context.Err()

		case event, ok := <-watcher.ResultChan():
			if !ok {
				stream <- pkgtypes.ActionEvent{
					Type: "error",
					Data: map[string]interface{}{"message": "watch channel closed unexpectedly"},
				}
				return fmt.Errorf("watch channel closed")
			}
			if event.Type != watch.Modified {
				continue
			}
			sts, ok := event.Object.(*appsv1.StatefulSet)
			if !ok {
				continue
			}

			desired := int32(1)
			if sts.Spec.Replicas != nil {
				desired = *sts.Spec.Replicas
			}

			stream <- pkgtypes.ActionEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"ready":   sts.Status.ReadyReplicas,
					"desired": desired,
					"updated": sts.Status.UpdatedReplicas,
					"message": fmt.Sprintf("%d/%d replicas ready", sts.Status.ReadyReplicas, desired),
				},
			}

			if sts.Status.UpdatedReplicas == desired &&
				sts.Status.ReadyReplicas == desired &&
				sts.Status.Replicas == desired {
				stream <- pkgtypes.ActionEvent{
					Type: "complete",
					Data: map[string]interface{}{
						"message": fmt.Sprintf("StatefulSet %s successfully restarted", input.ID),
					},
				}
				return nil
			}
		}
	}
}

func (s *StatefulSetResourcer) executeScale(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	input pkgtypes.ActionInput,
) (*pkgtypes.ActionResult, error) {
	replicas, ok := input.Params["replicas"].(float64)
	if !ok {
		return nil, fmt.Errorf("replicas parameter is required and must be a number")
	}

	replicaCount := int32(replicas)
	patch := fmt.Sprintf(`{"spec":{"replicas":%d}}`, replicaCount)
	_, err := client.KubeClient.AppsV1().StatefulSets(input.Namespace).Patch(
		ctx.Context, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to scale statefulset %s: %w", input.ID, err)
	}

	return &pkgtypes.ActionResult{
		Success: true,
		Message: fmt.Sprintf("StatefulSet %s scaled to %d replicas", input.ID, replicaCount),
	}, nil
}
