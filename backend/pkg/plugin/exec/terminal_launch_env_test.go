//go:build !windows

package exec

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// launch.env reaches terminal.Options on both lanes: a name the host owns is refused, naming the field, and nothing
// starts. A lane that dropped the field would start the shell.
func TestLaunchEnvOfTheEventsLaneReachesTheManager(t *testing.T) {
	fx := newTerminalFixture(t)
	_, err := fx.wrapper.CreateTerminal(fx.ctx(fx.page(1)), execsdk.SessionOptions{Command: shell(t)}, terminal.Launch{Env: map[string]string{"TERM": "x"}})
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	assert.Equal(t, "INVALID_REQUEST", app.Code)
	assert.Contains(t, app.Detail, "launch.env.TERM")
	assert.Empty(t, fx.ctrl.terminalManager.ListSessions())
	assert.Zero(t, fx.indexed())
}

func TestLaunchEnvOfTheChannelLaneReachesTheManager(t *testing.T) {
	fx := newTerminalFixture(t)
	_, err := fx.wrapper.CreateTerminal(context.Background(), execsdk.SessionOptions{Command: shell(t)}, terminal.Launch{Channel: true, Env: map[string]string{"TERM": "x"}})
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	assert.Equal(t, "INVALID_REQUEST", app.Code)
	assert.Contains(t, app.Detail, "launch.env.TERM")
}
