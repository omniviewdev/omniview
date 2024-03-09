package appsv1

import (
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"

	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
)

type DeploymentService struct {
	resources.NamespacedResourceService[*appsv1.Deployment]
}

// NewDeploymentService creates a new instance of DeploymentService.
func NewDeploymentService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *DeploymentService {
	return &DeploymentService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*appsv1.Deployment](
			logger,
			appsv1.SchemeGroupVersion.WithResource("deployments"),
			publisher,
			stateChan,
		),
	}
}
