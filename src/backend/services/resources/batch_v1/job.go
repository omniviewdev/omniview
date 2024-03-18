package batchv1

import (
	"go.uber.org/zap"
	batchv1 "k8s.io/api/batch/v1"

	"github.com/omniviewdev/omniview/backend/services"
	"github.com/omniviewdev/omniview/backend/services/resources"
)

type JobService struct {
	resources.NamespacedResourceService[*batchv1.Job]
}

// NewJobService creates a new instance of JobService.
func NewJobService(
	logger *zap.SugaredLogger,
	publisher *services.ClusterContextPublisher,
	stateChan chan<- services.ResourceStateEvent,
) *JobService {
	return &JobService{
		NamespacedResourceService: *resources.NewNamespacedResourceService[*batchv1.Job](
			logger,
			batchv1.SchemeGroupVersion.WithResource("jobs"),
			publisher,
			stateChan,
		),
	}
}
