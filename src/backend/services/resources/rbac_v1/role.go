package rbacv1

import (
	"go.uber.org/zap"
	rbacv1 "k8s.io/api/rbac/v1"

	"github.com/infraview/infraview/backend/services"
	"github.com/infraview/infraview/backend/services/resources"
)

type RoleService struct {
	resources.NamespacedResourceService[*rbacv1.Role]
}

// NewRoleService creates a new instance of RoleService.
func NewRoleService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *RoleService {
	return &RoleService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*rbacv1.Role](
			logger,
			rbacv1.SchemeGroupVersion.WithResource("roles"),
			publisher,
			stateChan,
		),
	}
}
