package appsv1

import (
	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
)

type ReplicaSetService struct {
	resources.NamespacedResourceService[*appsv1.ReplicaSet]
}

// NewReplicaSetService creates a new instance of ReplicaSetService.
func NewReplicaSetService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *ReplicaSetService {
	return &ReplicaSetService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*appsv1.ReplicaSet](
			logger,
			appsv1.SchemeGroupVersion.WithResource("replicasets"),
			publisher,
			stateChan,
		),
	}
}
