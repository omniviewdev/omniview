package networkingv1

import (
	"go.uber.org/zap"
	networkingv1 "k8s.io/api/networking/v1"

	"github.com/infraview/infraview/backend/services"
	"github.com/infraview/infraview/backend/services/resources"
)

type NetworkPolicyService struct {
	resources.NamespacedResourceService[*networkingv1.NetworkPolicy]
}

// NewNetworkPolicyService creates a new instance of NetworkPolicyService.
func NewNetworkPolicyService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *NetworkPolicyService {
	return &NetworkPolicyService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*networkingv1.NetworkPolicy](
			logger,
			networkingv1.SchemeGroupVersion.WithResource("networkpolicies"),
			publisher,
			stateChan,
		),
	}
}
