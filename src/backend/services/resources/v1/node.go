package resources

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	corev1 "k8s.io/api/core/v1"
)

type NodeService struct {
	resources.NamespacedResourceService[*corev1.Node]
}

// NewNodeService creates a new instance of NodeService.
func NewNodeService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *NodeService {
	return &NodeService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.Node](
			logger,
			corev1.SchemeGroupVersion.WithResource("nodes"),
			publisher,
			stateChan,
		),
	}
}
