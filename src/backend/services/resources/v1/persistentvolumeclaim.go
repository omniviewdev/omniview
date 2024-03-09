package resources

import (
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"

	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
)

type PersistentVolumeClaimService struct {
	resources.NamespacedResourceService[*corev1.PersistentVolumeClaim]
}

// NewPersistentVolumeClaimService creates a new instance of PersistentVolumeClaimService.
func NewPersistentVolumeClaimService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *PersistentVolumeClaimService {
	return &PersistentVolumeClaimService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.PersistentVolumeClaim](
			logger,
			corev1.SchemeGroupVersion.WithResource("persistentvolumeclaims"),
			publisher,
			stateChan,
		),
	}
}
