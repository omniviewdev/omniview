package resources

import (
	"github.com/joshuapare/kubede/backend/services"
	"github.com/joshuapare/kubede/backend/services/resources"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
)

// PodService manages Pod resources in a Kubernetes cluster.
type PodService struct {
	resources.NamespacedResourceService[*corev1.Pod]
}

// NewPodService creates a new instance of PodService.
func NewPodService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *PodService {
	return &PodService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*corev1.Pod](
			logger,
			corev1.SchemeGroupVersion.WithResource("pods"),
			publisher,
			stateChan,
		),
	}
}