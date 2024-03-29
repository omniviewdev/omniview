package resources

import (
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"

	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
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
