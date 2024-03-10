package networkingv1

import (
	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
	"go.uber.org/zap"
	networkingv1 "k8s.io/api/networking/v1"
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
