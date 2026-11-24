package main

import (
	"fmt"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/activity"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	pluginlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/networker"
)

// Kinds of ActiveWork.
const (
	activeWorkTerminal    = "terminal"
	activeWorkLogStream   = "log-stream"
	activeWorkPortForward = "port-forward"
	activeWorkTask        = "task"
	activeWorkUnknown     = "unknown"
)

// activeWorkLister lists work that a restart would end. A listing that fails
// becomes an "unknown" entry, so the restart still asks for confirmation.
func activeWorkLister(
	execController exec.Controller,
	logsController pluginlogs.Controller,
	networkerController networker.Controller,
	activityService *activity.Service,
) func() []ActiveWork {
	return func() []ActiveWork {
		work := []ActiveWork{}
		work = append(work, activeTerminals(execController)...)
		work = append(work, activeLogStreams(logsController)...)
		work = append(work, activePortForwards(networkerController)...)
		return append(work, activeTasks(activityService)...)
	}
}

func unconfirmedWork(what string, err error) []ActiveWork {
	return []ActiveWork{{Kind: activeWorkUnknown, Description: fmt.Sprintf("Omniview could not confirm that no %s are running: %v", what, err)}}
}

func activeTerminals(controller exec.Controller) []ActiveWork {
	sessions, err := controller.ListSessions()
	if err != nil {
		return unconfirmedWork("terminals", err)
	}
	work := make([]ActiveWork, 0, len(sessions))
	for _, session := range sessions {
		description := "Terminal session " + session.ID
		if len(session.Command) > 0 {
			description = "Terminal: " + strings.Join(session.Command, " ")
		}
		work = append(work, ActiveWork{Kind: activeWorkTerminal, Description: description})
	}
	return work
}

func activeLogStreams(controller pluginlogs.Controller) []ActiveWork {
	sessions, err := controller.ListSessions()
	if err != nil {
		return unconfirmedWork("log streams", err)
	}
	work := make([]ActiveWork, 0, len(sessions))
	for _, session := range sessions {
		work = append(work, ActiveWork{Kind: activeWorkLogStream, Description: "Log stream: " + session.ResourceID})
	}
	return work
}

func activePortForwards(controller networker.Controller) []ActiveWork {
	sessions, err := controller.ListAllPortForwardSessions()
	if err != nil {
		return unconfirmedWork("port forwards", err)
	}
	work := make([]ActiveWork, 0, len(sessions))
	for _, session := range sessions {
		work = append(work, ActiveWork{Kind: activeWorkPortForward, Description: fmt.Sprintf("Port forward: localhost:%d → %d", session.LocalPort, session.RemotePort)})
	}
	return work
}

func activeTasks(service *activity.Service) []ActiveWork {
	var work []ActiveWork
	for _, record := range service.Snapshot().Records {
		if record.Task == nil {
			continue
		}
		switch record.Task.State {
		case "starting", "running", "paused":
			description := record.Presentation.Title
			if description == "" {
				description = record.ID
			}
			work = append(work, ActiveWork{Kind: activeWorkTask, Description: description})
		}
	}
	return work
}
