package storagev1

import (
	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
	"go.uber.org/zap"
	storagev1 "k8s.io/api/storage/v1"
)

type VolumeAttachmentService struct {
	resources.NamespacedResourceService[*storagev1.VolumeAttachment]
}

// NewVolumeAttachmentService creates a new instance of VolumeAttachmentService.
func NewVolumeAttachmentService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *VolumeAttachmentService {
	return &VolumeAttachmentService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*storagev1.VolumeAttachment](
			logger,
			storagev1.SchemeGroupVersion.WithResource("volumeattachments"),
			publisher,
			stateChan,
		),
	}
}
