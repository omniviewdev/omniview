package storagev1

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	storagev1 "k8s.io/api/storage/v1"
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
