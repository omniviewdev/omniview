//go:build !windows

package terminal

import (
	"context"
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/omniviewdev/omniview/internal/shellenv"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// A manager starts its shells from the environment the host was LAUNCHED with, which main records first
// thing: not from the live process environment, which holds whatever the host added after it launched. The
// shellenv tests pin what the record is; this pins that the manager reads it.
func TestANewManagerStartsShellsFromTheLaunchEnvironment(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	m := NewManager(ctx, logging.NewNop(), newChunkSink())
	assert.Equal(t, reflect.ValueOf(shellenv.LaunchEnvironment).Pointer(), reflect.ValueOf(m.base).Pointer(),
		"the environment a shell starts from is shellenv.LaunchEnvironment")
}
