package resources

import (
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"

	"github.com/infraview/infraview/backend/services"
	"github.com/infraview/infraview/backend/services/resources"
)

type PersistentVolumeService struct {
	resources.NamespacedResourceService[*corev1.PersistentVolume]
}

// NewPersistentVolumeService creates a new instance of PersistentVolumeService.
func NewPersistentVolumeService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *PersistentVolumeService {
	return &PersistentVolumeService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.PersistentVolume](
			logger,
			corev1.SchemeGroupVersion.WithResource("persistentvolumes"),
			publisher,
			stateChan,
		),
	}
}
