package storagev1

import (
	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
	"go.uber.org/zap"
	storagev1 "k8s.io/api/storage/v1"
)

type CSIDriverService struct {
	resources.NamespacedResourceService[*storagev1.CSIDriver]
}

// NewCSIDriverService creates a new instance of CSIDriverService.
func NewCSIDriverService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *CSIDriverService {
	return &CSIDriverService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*storagev1.CSIDriver](
			logger,
			storagev1.SchemeGroupVersion.WithResource("csidrivers"),
			publisher,
			stateChan,
		),
	}
}
