package resources

import (
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"

	"github.com/infraview/infraview/backend/services"
	"github.com/infraview/infraview/backend/services/resources"
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
