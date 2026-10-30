package mcprelay

import (
	"context"

	hostlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// ResourceLogsReader consumes finite resource logs with the original invocation
// principal. The existing host logs controller implements this interface.
type ResourceLogsReader interface {
	ReadResourceLogs(context.Context, string, sdklogs.CreateSessionOptions) (*hostlogs.HeadlessResult, error)
}
