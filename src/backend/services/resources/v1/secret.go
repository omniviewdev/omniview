package resources

import (
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"

	"github.com/infraview/infraview/backend/services"
	"github.com/infraview/infraview/backend/services/resources"
)

type SecretService struct {
	resources.NamespacedResourceService[*corev1.Secret]
}

// NewSecretService creates a new instance of SecretService.
func NewSecretService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *SecretService {
	return &SecretService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.Secret](
			logger,
			corev1.SchemeGroupVersion.WithResource("secrets"),
			publisher,
			stateChan,
		),
	}
}
