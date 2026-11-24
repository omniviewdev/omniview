package main

import (
	"fmt"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/activity"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	pluginlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/networker"
)

// activeWorkLister lists work that a restart would end. A listing that fails
// becomes an "unknown" entry, so the restart still asks for confirmation.
func activeWorkLister(
	execController exec.Controller,
	logsController pluginlogs.Controller,
	networkerController networker.Controller,
	activityService *activity.Service,
) func() []ActiveWork {
	unknown := func(what string, err error) ActiveWork {
		return ActiveWork{Kind: "unknown", Description: fmt.Sprintf("Omniview could not confirm that no %s are running: %v", what, err)}
	}
	return func() []ActiveWork {
		work := []ActiveWork{}
		if sessions, err := execController.ListSessions(); err != nil {
			work = append(work, unknown("terminals", err))
		} else {
			for _, session := range sessions {
				description := "Terminal session " + session.ID
				if len(session.Command) > 0 {
					description = "Terminal: " + strings.Join(session.Command, " ")
				}
				work = append(work, ActiveWork{Kind: "terminal", Description: description})
			}
		}
		if sessions, err := logsController.ListSessions(); err != nil {
			work = append(work, unknown("log streams", err))
		} else {
			for _, session := range sessions {
				work = append(work, ActiveWork{Kind: "log-stream", Description: "Log stream: " + session.ResourceID})
			}
		}
		if sessions, err := networkerController.ListAllPortForwardSessions(); err != nil {
			work = append(work, unknown("port forwards", err))
		} else {
			for _, session := range sessions {
				work = append(work, ActiveWork{Kind: "port-forward", Description: fmt.Sprintf("Port forward: localhost:%d → %d", session.LocalPort, session.RemotePort)})
			}
		}
		for _, record := range activityService.Snapshot().Records {
			if record.Task == nil {
				continue
			}
			switch record.Task.State {
			case "starting", "running", "paused":
				description := record.Presentation.Title
				if description == "" {
					description = record.ID
				}
				work = append(work, ActiveWork{Kind: "task", Description: description})
			}
		}
		return work
	}
}
