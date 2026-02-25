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

// DaemonSetResourcer wraps KubernetesResourcerBase for CRUD and adds
// daemonset-specific actions: restart.
type DaemonSetResourcer struct {
	*KubernetesResourcerBase[MetaAccessor]
	log *zap.SugaredLogger
}

// Compile-time interface checks.
var (
	_ pkgtypes.Resourcer[clients.ClientSet]       = (*DaemonSetResourcer)(nil)
	_ pkgtypes.ActionResourcer[clients.ClientSet]  = (*DaemonSetResourcer)(nil)
)

// NewDaemonSetResourcer creates a DaemonSetResourcer for apps::v1::DaemonSet.
func NewDaemonSetResourcer(logger *zap.SugaredLogger) *DaemonSetResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		appsv1.SchemeGroupVersion.WithResource("daemonsets"),
	)
	return &DaemonSetResourcer{
		KubernetesResourcerBase: base.(*KubernetesResourcerBase[MetaAccessor]),
		log:                     logger.Named("DaemonSetResourcer"),
	}
}

// ====================== ACTION INTERFACE ====================== //

func (d *DaemonSetResourcer) GetActions(
	_ *types.PluginContext,
	_ *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
) ([]pkgtypes.ActionDescriptor, error) {
	return []pkgtypes.ActionDescriptor{
		{
			ID:          "restart",
			Label:       "Rollout Restart",
			Description: "Restart all pods in this daemonset via a rolling update",
			Icon:        "LuRefreshCw",
			Scope:       pkgtypes.ActionScopeInstance,
			Streaming:   true,
		},
	}, nil
}

func (d *DaemonSetResourcer) ExecuteAction(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	actionID string,
	input pkgtypes.ActionInput,
) (*pkgtypes.ActionResult, error) {
	switch actionID {
	case "restart":
		return d.executeRestart(ctx, client, input)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (d *DaemonSetResourcer) StreamAction(
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

func (d *DaemonSetResourcer) executeRestart(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	input pkgtypes.ActionInput,
) (*pkgtypes.ActionResult, error) {
	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339),
	)
	_, err := client.KubeClient.AppsV1().DaemonSets(input.Namespace).Patch(
		ctx.Context, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to restart daemonset %s: %w", input.ID, err)
	}

	return &pkgtypes.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Rollout restart initiated for daemonset %s", input.ID),
	}, nil
}

func (d *DaemonSetResourcer) streamRestart(
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
	_, err := client.KubeClient.AppsV1().DaemonSets(input.Namespace).Patch(
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

	watcher, err := client.KubeClient.AppsV1().DaemonSets(input.Namespace).Watch(
		ctx.Context, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("metadata.name=%s", input.ID),
		},
	)
	if err != nil {
		stream <- pkgtypes.ActionEvent{
			Type: "error",
			Data: map[string]interface{}{"message": fmt.Sprintf("failed to watch daemonset: %v", err)},
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
			ds, ok := event.Object.(*appsv1.DaemonSet)
			if !ok {
				continue
			}

			desired := ds.Status.DesiredNumberScheduled

			stream <- pkgtypes.ActionEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"ready":   ds.Status.NumberReady,
					"desired": desired,
					"updated": ds.Status.UpdatedNumberScheduled,
					"message": fmt.Sprintf("%d/%d nodes ready", ds.Status.NumberReady, desired),
				},
			}

			if ds.Status.UpdatedNumberScheduled == desired &&
				ds.Status.NumberReady == desired &&
				ds.Status.NumberAvailable == desired {
				stream <- pkgtypes.ActionEvent{
					Type: "complete",
					Data: map[string]interface{}{
						"message": fmt.Sprintf("DaemonSet %s successfully restarted", input.ID),
					},
				}
				return nil
			}
		}
	}
}
