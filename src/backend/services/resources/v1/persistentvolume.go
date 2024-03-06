package resources

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	corev1 "k8s.io/api/core/v1"
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
