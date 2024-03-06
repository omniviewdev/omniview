package appsv1

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	appsv1 "k8s.io/api/apps/v1"
)

type StatefulSetService struct {
	resources.NamespacedResourceService[*appsv1.StatefulSet]
}

// NewStatefulSetService creates a new instance of StatefulSetService.
func NewStatefulSetService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *StatefulSetService {
	return &StatefulSetService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*appsv1.StatefulSet](
			logger,
			appsv1.SchemeGroupVersion.WithResource("statefulsets"),
			publisher,
			stateChan,
		),
	}
}
