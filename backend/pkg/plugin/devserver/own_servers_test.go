package devserver

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

// A dev server's Vite port is a server of the host's machine that the host started: the URL opener refuses it while the instance is there.
func TestTheVitePortsOfTheInstancesAreListenAddresses(t *testing.T) {
	manager := newTestManager(t)
	options := BuildOpts{}
	instance := func(id string, port int) *DevServerInstance {
		return NewDevServerInstance(context.Background(), logging.NewNop(), id, t.TempDir(), port, options,
			&mockPluginReloader{}, manager.pluginsRoot, func(string, DevServerState) {},
			func(string, []LogEntry) {}, func(string, []BuildError) {})
	}
	manager.mu.Lock()
	manager.instances["with-ui"] = instance("with-ui", 45173)
	manager.instances["without-ui"] = instance("without-ui", 0)
	manager.mu.Unlock()
	assert.Equal(t, []string{"127.0.0.1:45173"}, manager.ListenAddresses())
}
