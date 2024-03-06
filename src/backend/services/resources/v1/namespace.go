package resources

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	corev1 "k8s.io/api/core/v1"
)

type NamespaceService struct {
	resources.NamespacedResourceService[*corev1.Namespace]
}

// NewNamespaceService creates a new instance of NamespaceService.
func NewNamespaceService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *NamespaceService {
	return &NamespaceService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.Namespace](
			logger,
			corev1.SchemeGroupVersion.WithResource("namespaces"),
			publisher,
			stateChan,
		),
	}
}
