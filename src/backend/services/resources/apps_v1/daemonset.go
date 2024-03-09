package appsv1

import (
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"

	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
)

type DaemonSetService struct {
	resources.NamespacedResourceService[*appsv1.DaemonSet]
}

// NewDaemonSetService creates a new instance of DaemonSetService.
func NewDaemonSetService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *DaemonSetService {
	return &DaemonSetService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*appsv1.DaemonSet](
			logger,
			appsv1.SchemeGroupVersion.WithResource("daemonsets"),
			publisher,
			stateChan,
		),
	}
}
