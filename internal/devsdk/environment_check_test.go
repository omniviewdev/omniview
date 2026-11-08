package devsdk_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

func environmentAnswer(output string, err error, seen *[]string) devsdk.Runner {
	return func(_ context.Context, _ string, environment []string, args ...string) ([]byte, error) {
		*seen = append(append([]string(nil), environment...), args...)
		return []byte(output), err
	}
}

func TestEnvironmentCheckRefusesAnEffectiveGoFlags(t *testing.T) {
	var seen []string
	err := devsdk.CheckGoEnvironment(context.Background(), devsdk.Consumer{Name: "host", Directory: t.TempDir()},
		devsdk.Published{Version: devsdk.FloorVersion}, environmentAnswer(`{"GOFLAGS":"-toolexec=/x"}`, nil, &seen))
	var typed *devcontract.Error
	require.ErrorAs(t, err, &typed)
	require.Equal(t, devsdk.CodeSelectionConflict, typed.Code)
	require.Equal(t, 4, typed.Exit)
	require.Equal(t, "-toolexec=/x", typed.Details["goflags"])
	require.Equal(t, append(devsdk.ModuleEnvironment(), "env", "-json", "GOFLAGS"), seen)
}

func TestEnvironmentCheckAcceptsAnEmptyGoFlags(t *testing.T) {
	var seen []string
	for _, output := range []string{`{"GOFLAGS":""}`, `{"GOFLAGS":"  "}`} {
		require.NoError(t, devsdk.CheckGoEnvironment(context.Background(), devsdk.Consumer{Directory: t.TempDir()},
			devsdk.Published{}, environmentAnswer(output, nil, &seen)))
	}
}

func TestEnvironmentCheckFailsWithoutRefusingOnAnUnusableGo(t *testing.T) {
	var seen []string
	broken := errors.New("go not found")
	err := devsdk.CheckGoEnvironment(context.Background(), devsdk.Consumer{Directory: t.TempDir()}, devsdk.Published{}, environmentAnswer("", broken, &seen))
	require.Error(t, err)
	var typed *devcontract.Error
	if errors.As(err, &typed) {
		require.NotEqual(t, devsdk.CodeSelectionConflict, typed.Code)
	}
	err = devsdk.CheckGoEnvironment(context.Background(), devsdk.Consumer{Directory: t.TempDir()}, devsdk.Published{}, environmentAnswer("not json", nil, &seen))
	require.Error(t, err)
	require.ErrorAs(t, err, &typed)
	require.NotEqual(t, devsdk.CodeSelectionConflict, typed.Code)
}

// Launch and preflight build the refusal in one place.
func TestEnvironmentFileCheckSharesTheLaunchRefusal(t *testing.T) {
	file := filepath.Join(t.TempDir(), "env")
	require.NoError(t, os.WriteFile(file, []byte("GOFLAGS=-toolexec=/x\n"), 0o600))
	t.Setenv("GOENV", file)
	declared := devsdk.Published{Version: devsdk.FloorVersion}
	fromFile := devsdk.CheckGoEnvironmentFile("host", declared)
	var seen []string
	fromLaunch := devsdk.CheckGoEnvironment(context.Background(), devsdk.Consumer{Name: "host", Directory: t.TempDir()}, declared, environmentAnswer(`{"GOFLAGS":"-toolexec=/x"}`, nil, &seen))
	require.Error(t, fromFile)
	require.Equal(t, fromLaunch, fromFile)
}
