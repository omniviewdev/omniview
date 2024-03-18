package resources

import (
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"

	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
)

type ConfigMapService struct {
	resources.NamespacedResourceService[*corev1.ConfigMap]
}

// NewConfigMapService creates a new instance of ConfigMapService.
func NewConfigMapService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *ConfigMapService {
	return &ConfigMapService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.ConfigMap](
			logger,
			corev1.SchemeGroupVersion.WithResource("configmaps"),
			publisher,
			stateChan,
		),
	}
}
