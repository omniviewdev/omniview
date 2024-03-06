package resources

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	corev1 "k8s.io/api/core/v1"
)

type ServiceService struct {
	resources.NamespacedResourceService[*corev1.Service]
}

// NewServiceService creates a new instance of ServiceService.
func NewServiceService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *ServiceService {
	return &ServiceService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.Service](
			logger,
			corev1.SchemeGroupVersion.WithResource("services"),
			publisher,
			stateChan,
		),
	}
}
