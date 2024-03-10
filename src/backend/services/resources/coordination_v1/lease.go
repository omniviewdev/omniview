package coordinationv1

import (
	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
	"go.uber.org/zap"
	coordinationv1 "k8s.io/api/coordination/v1"
)

type LeaseService struct {
	resources.NamespacedResourceService[*coordinationv1.Lease]
}

// NewLeaseService creates a new instance of LeaseService.
func NewLeaseService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *LeaseService {
	return &LeaseService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*coordinationv1.Lease](
			logger,
			coordinationv1.SchemeGroupVersion.WithResource("leases"),
			publisher,
			stateChan,
		),
	}
}
