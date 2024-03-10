package rbacv1

import (
	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
	"go.uber.org/zap"
	rbacv1 "k8s.io/api/rbac/v1"
)

type RoleBindingService struct {
	resources.NamespacedResourceService[*rbacv1.RoleBinding]
}

// NewRoleBindingService creates a new instance of RoleBindingService.
func NewRoleBindingService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *RoleBindingService {
	return &RoleBindingService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*rbacv1.RoleBinding](
			logger,
			rbacv1.SchemeGroupVersion.WithResource("rolebindings"),
			publisher,
			stateChan,
		),
	}
}
