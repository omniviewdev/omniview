package rbacv1

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"

	rbacv1 "k8s.io/api/rbac/v1"
)

type ClusterRoleBindingService struct {
	resources.NamespacedResourceService[*rbacv1.ClusterRoleBinding]
}

// NewClusterRoleBindingService creates a new instance of ClusterRoleBindingService.
func NewClusterRoleBindingService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *ClusterRoleBindingService {
	return &ClusterRoleBindingService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*rbacv1.ClusterRoleBinding](
			logger,
			rbacv1.SchemeGroupVersion.WithResource("clusterrolebindings"),
			publisher,
			stateChan,
		),
	}
}
