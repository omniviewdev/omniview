package resources

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	corev1 "k8s.io/api/core/v1"
)

type EndpointsService struct {
	resources.NamespacedResourceService[*corev1.Endpoints]
}

// NewEndpointsService creates a new instance of EndpointsService.
func NewEndpointsService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *EndpointsService {
	return &EndpointsService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.Endpoints](
			logger,
			corev1.SchemeGroupVersion.WithResource("endpoints"),
			publisher,
			stateChan,
		),
	}
}
