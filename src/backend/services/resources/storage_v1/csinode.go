package storagev1

import (
	"go.uber.org/zap"
	storagev1 "k8s.io/api/storage/v1"

	"github.com/infraview/infraview/backend/services"
	"github.com/infraview/infraview/backend/services/resources"
)

type CSINodeService struct {
	resources.NamespacedResourceService[*storagev1.CSINode]
}

// NewCSINodeService creates a new instance of CSINodeService.
func NewCSINodeService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *CSINodeService {
	return &CSINodeService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*storagev1.CSINode](
			logger,
			storagev1.SchemeGroupVersion.WithResource("csinodes"),
			publisher,
			stateChan,
		),
	}
}
