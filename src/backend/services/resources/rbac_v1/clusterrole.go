package rbacv1

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	rbacv1 "k8s.io/api/rbac/v1"
)

type ClusterRoleService struct {
	resources.NamespacedResourceService[*rbacv1.ClusterRole]
}

// NewClusterRoleService creates a new instance of ClusterRoleService.
func NewClusterRoleService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *ClusterRoleService {
	return &ClusterRoleService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*rbacv1.ClusterRole](
			logger,
			rbacv1.SchemeGroupVersion.WithResource("clusterroles"),
			publisher,
			stateChan,
		),
	}
}
