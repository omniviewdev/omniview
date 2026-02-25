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

// DeploymentResourcer wraps KubernetesResourcerBase for CRUD and adds
// deployment-specific actions: restart, scale, pause, resume.
type DeploymentResourcer struct {
	*KubernetesResourcerBase[MetaAccessor]
	log *zap.SugaredLogger
}

// Compile-time interface checks.
var (
	_ pkgtypes.Resourcer[clients.ClientSet]       = (*DeploymentResourcer)(nil)
	_ pkgtypes.ActionResourcer[clients.ClientSet]  = (*DeploymentResourcer)(nil)
)

// NewDeploymentResourcer creates a DeploymentResourcer for apps::v1::Deployment.
func NewDeploymentResourcer(logger *zap.SugaredLogger) *DeploymentResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		appsv1.SchemeGroupVersion.WithResource("deployments"),
	)
	return &DeploymentResourcer{
		KubernetesResourcerBase: base.(*KubernetesResourcerBase[MetaAccessor]),
		log:                     logger.Named("DeploymentResourcer"),
	}
}

// ====================== ACTION INTERFACE ====================== //

func (d *DeploymentResourcer) GetActions(
	_ *types.PluginContext,
	_ *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
) ([]pkgtypes.ActionDescriptor, error) {
	return []pkgtypes.ActionDescriptor{
		{
			ID:          "restart",
			Label:       "Rollout Restart",
			Description: "Restart all pods in this deployment via a rolling update",
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
		{
			ID:          "pause",
			Label:       "Pause Rollout",
			Description: "Pause the current rollout",
			Icon:        "LuPause",
			Scope:       pkgtypes.ActionScopeInstance,
		},
		{
			ID:          "resume",
			Label:       "Resume Rollout",
			Description: "Resume a paused rollout",
			Icon:        "LuPlay",
			Scope:       pkgtypes.ActionScopeInstance,
		},
	}, nil
}

func (d *DeploymentResourcer) ExecuteAction(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	actionID string,
	input pkgtypes.ActionInput,
) (*pkgtypes.ActionResult, error) {
	switch actionID {
	case "restart":
		return d.executeRestart(ctx, client, input)
	case "scale":
		return d.executeScale(ctx, client, input)
	case "pause":
		return d.executePauseResume(ctx, client, input, true)
	case "resume":
		return d.executePauseResume(ctx, client, input, false)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (d *DeploymentResourcer) StreamAction(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	actionID string,
	input pkgtypes.ActionInput,
	stream chan pkgtypes.ActionEvent,
) error {
	switch actionID {
	case "restart":
		return d.streamRestart(ctx, client, input, stream)
	default:
		return fmt.Errorf("streaming not supported for action: %s", actionID)
	}
}

// ====================== ACTION IMPLEMENTATIONS ====================== //

// executeRestart patches the pod template annotation to trigger a rolling restart.
func (d *DeploymentResourcer) executeRestart(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	input pkgtypes.ActionInput,
) (*pkgtypes.ActionResult, error) {
	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339),
	)
	_, err := client.KubeClient.AppsV1().Deployments(input.Namespace).Patch(
		ctx.Context, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to restart deployment %s: %w", input.ID, err)
	}

	return &pkgtypes.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Rollout restart initiated for deployment %s", input.ID),
	}, nil
}

// streamRestart patches the annotation then watches for rollout completion.
func (d *DeploymentResourcer) streamRestart(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	input pkgtypes.ActionInput,
	stream chan pkgtypes.ActionEvent,
) error {
	defer close(stream)

	// Patch to trigger restart.
	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339),
	)
	_, err := client.KubeClient.AppsV1().Deployments(input.Namespace).Patch(
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

	// Watch the deployment for rollout completion.
	watcher, err := client.KubeClient.AppsV1().Deployments(input.Namespace).Watch(
		ctx.Context, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("metadata.name=%s", input.ID),
		},
	)
	if err != nil {
		stream <- pkgtypes.ActionEvent{
			Type: "error",
			Data: map[string]interface{}{"message": fmt.Sprintf("failed to watch deployment: %v", err)},
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
			dep, ok := event.Object.(*appsv1.Deployment)
			if !ok {
				continue
			}

			desired := int32(1)
			if dep.Spec.Replicas != nil {
				desired = *dep.Spec.Replicas
			}

			stream <- pkgtypes.ActionEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"ready":   dep.Status.AvailableReplicas,
					"desired": desired,
					"updated": dep.Status.UpdatedReplicas,
					"message": fmt.Sprintf("%d/%d replicas ready", dep.Status.AvailableReplicas, desired),
				},
			}

			if dep.Status.UpdatedReplicas == desired &&
				dep.Status.AvailableReplicas == desired &&
				dep.Status.Replicas == desired {
				stream <- pkgtypes.ActionEvent{
					Type: "complete",
					Data: map[string]interface{}{
						"message": fmt.Sprintf("Deployment %s successfully restarted", input.ID),
					},
				}
				return nil
			}
		}
	}
}

// executeScale patches spec.replicas on the deployment.
func (d *DeploymentResourcer) executeScale(
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
	_, err := client.KubeClient.AppsV1().Deployments(input.Namespace).Patch(
		ctx.Context, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to scale deployment %s: %w", input.ID, err)
	}

	return &pkgtypes.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Deployment %s scaled to %d replicas", input.ID, replicaCount),
	}, nil
}

// executePauseResume patches spec.paused on the deployment.
func (d *DeploymentResourcer) executePauseResume(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	input pkgtypes.ActionInput,
	paused bool,
) (*pkgtypes.ActionResult, error) {
	patch := fmt.Sprintf(`{"spec":{"paused":%t}}`, paused)
	_, err := client.KubeClient.AppsV1().Deployments(input.Namespace).Patch(
		ctx.Context, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		verb := "pause"
		if !paused {
			verb = "resume"
		}
		return nil, fmt.Errorf("failed to %s deployment %s: %w", verb, input.ID, err)
	}

	verb := "paused"
	if !paused {
		verb = "resumed"
	}
	return &pkgtypes.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Deployment %s rollout %s", input.ID, verb),
	}, nil
}
