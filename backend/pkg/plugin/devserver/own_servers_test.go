package devserver

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

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

// An instance that is being stopped is not in the instances any more, and its Vite server may still answer: its address is listed until the stop ends.
func TestTheViteAddressOfAnInstanceThatIsBeingStoppedIsStillListed(t *testing.T) {
	manager := newTestManager(t)
	inst := NewDevServerInstance(context.Background(), logging.NewNop(), "stopping", t.TempDir(), 45174, BuildOpts{},
		&mockPluginReloader{}, manager.pluginsRoot, func(string, DevServerState) {},
		func(string, []LogEntry) {}, func(string, []BuildError) {})
	manager.mu.Lock()
	manager.stopping["stopping"] = inst
	manager.mu.Unlock()
	assert.Equal(t, []string{"127.0.0.1:45174"}, manager.ListenAddresses())
	manager.mu.Lock()
	delete(manager.stopping, "stopping")
	manager.mu.Unlock()
	assert.Empty(t, manager.ListenAddresses())
}

func stoppingInstance(manager *DevServerManager, id string, port int) *DevServerInstance {
	inst := NewDevServerInstance(context.Background(), logging.NewNop(), id, "", port, BuildOpts{},
		&mockPluginReloader{}, manager.pluginsRoot, func(string, DevServerState) {},
		func(string, []LogEntry) {}, func(string, []BuildError) {})
	manager.mu.Lock()
	manager.instances[id] = inst
	manager.mu.Unlock()
	return inst
}

// While StopDevServer stops an instance its Vite server may still answer: the address is listed during the stop, and after a stop that succeeded it is gone.
func TestTheViteAddressIsListedWhileTheStopRunsAndGoneAfterItSucceeded(t *testing.T) {
	manager := newTestManager(t)
	stoppingInstance(manager, "stops", 45175)
	var during []string
	manager.stop = func(*DevServerInstance) error {
		during = manager.ListenAddresses()
		return nil
	}
	require.NoError(t, manager.StopDevServer("stops"))
	assert.Equal(t, []string{"127.0.0.1:45175"}, during, "listed once, while the stop runs")
	assert.Empty(t, manager.ListenAddresses(), "gone after a stop that succeeded")
}

// After a stop that failed the instance is back and its server may be up: the address is listed once, and the stop leaves nothing behind.
func TestTheViteAddressIsListedOnceAfterAStopThatFailed(t *testing.T) {
	manager := newTestManager(t)
	stoppingInstance(manager, "fails", 45176)
	manager.stop = func(*DevServerInstance) error { return errors.New("the process would not stop") }
	require.Error(t, manager.StopDevServer("fails"))
	assert.Equal(t, []string{"127.0.0.1:45176"}, manager.ListenAddresses())
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	assert.Empty(t, manager.stopping)
}
