package resources

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	corev1 "k8s.io/api/core/v1"
)

type ServiceAccountService struct {
	resources.NamespacedResourceService[*corev1.ServiceAccount]
}

// NewServiceAccountService creates a new instance of ServiceAccountService.
func NewServiceAccountService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *ServiceAccountService {
	return &ServiceAccountService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.ServiceAccount](
			logger,
			corev1.SchemeGroupVersion.WithResource("serviceaccounts"),
			publisher,
			stateChan,
		),
	}
}
