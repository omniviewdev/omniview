package storagev1

import (
	"go.uber.org/zap"
	storagev1 "k8s.io/api/storage/v1"

	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
)

type StorageClassService struct {
	resources.NamespacedResourceService[*storagev1.StorageClass]
}

// NewStorageClassService creates a new instance of StorageClassService.
func NewStorageClassService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *StorageClassService {
	return &StorageClassService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*storagev1.StorageClass](
			logger,
			storagev1.SchemeGroupVersion.WithResource("storageclasses"),
			publisher,
			stateChan,
		),
	}
}
