package rbacv1

import (
	"go.uber.org/zap"
	rbacv1 "k8s.io/api/rbac/v1"

	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
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
