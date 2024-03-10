package discoveryv1

import (
	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
	"go.uber.org/zap"
	discoveryv1 "k8s.io/api/discovery/v1"
)

type EndpointSliceService struct {
	resources.NamespacedResourceService[*discoveryv1.EndpointSlice]
}

// NewEndpointSliceService creates a new instance of EndpointSliceService.
func NewEndpointSliceService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *EndpointSliceService {
	return &EndpointSliceService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*discoveryv1.EndpointSlice](
			logger,
			discoveryv1.SchemeGroupVersion.WithResource("endpointslices"),
			publisher,
			stateChan,
		),
	}
}
