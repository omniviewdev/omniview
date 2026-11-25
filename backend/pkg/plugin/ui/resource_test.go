package ui

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// manyPlugins is how many plugins one test loads at once. The host loads them with a pool of four
// workers (pluginManager.loadPluginsConcurrently), and a test that wants to see a race needs more
// goroutines than that, all released together.
const manyPlugins = 64

// atOnce runs fn(0) .. fn(n-1), each in a goroutine of its own, released together, and waits for
// them all. fn must not call t.FailNow.
func atOnce(n int, fn func(i int)) {
	var ready, done sync.WaitGroup
	start := make(chan struct{})
	ready.Add(n)
	done.Add(n)
	for i := range n {
		go func() {
			defer done.Done()
			ready.Done()
			<-start
			fn(i)
		}()
	}
	ready.Wait()
	close(start)
	done.Wait()
}

// atOnceErr is atOnce for work that can fail: what each call answered, by index (each goroutine
// writes its own slot), for the test to assert on once they are all done.
func atOnceErr(n int, fn func(i int) error) []error {
	errs := make([]error, n)
	atOnce(n, func(i int) { errs[i] = fn(i) })
	return errs
}

// noErrors fails the test for each of the errors there is.
func noErrors(t *testing.T, errs []error) {
	t.Helper()
	for i, err := range errs {
		require.NoError(t, err, "call %d", i)
	}
}

func pluginID(i int) string { return fmt.Sprintf("plugin-%d", i) }

func sidebarComponent(plugin, resource, name string) ResourceComponent {
	return ResourceComponent{
		Owner:          "owner",
		Name:           name,
		Plugin:         plugin,
		Resource:       resource,
		Area:           ResourceComponentAreaSidebar,
		ExtensionPoint: "",
		Extensions:     nil,
	}
}

// What the store does for one caller at a time: these hold before and after the store was made safe
// to share, and they are what the concurrent tests below must not change.

func TestAddComponentRefusesWhatIsMissing(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()
	whole := sidebarComponent("plugin", "resource", "name")

	for _, tc := range []struct {
		missing string
		mutate  func(*ResourceComponent)
	}{
		{"owner", func(c *ResourceComponent) { c.Owner = "" }},
		{"plugin", func(c *ResourceComponent) { c.Plugin = "" }},
		{"resource", func(c *ResourceComponent) { c.Resource = "" }},
		{"name", func(c *ResourceComponent) { c.Name = "" }},
		{"area", func(c *ResourceComponent) { c.Area = "" }},
	} {
		c := whole
		tc.mutate(&c)
		require.EqualError(t, store.AddComponent(c), tc.missing+" is required")
	}

	assert.Empty(t, store.GetComponentsForResource("plugin", "resource"), "a refused component is not kept")
}

func TestAddComponentRefusesTheSameComponentTwice(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()
	c := sidebarComponent("plugin", "resource", "name")

	require.NoError(t, store.AddComponent(c))
	require.EqualError(t, store.AddComponent(c), "component name already exists in plugin plugin for resource resource")
	assert.Len(t, store.GetComponentsForResource("plugin", "resource"), 1)

	other := c
	other.Owner = "another owner"
	require.NoError(t, store.AddComponent(other), "the same name from another owner is another component")
	assert.Len(t, store.GetComponentsForResource("plugin", "resource"), 2)
}

func TestAComponentCanBeAddedToAPluginThatWasNotAddedFirst(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()

	require.NoError(t, store.AddComponent(sidebarComponent("plugin", "resource", "name")))
	assert.Len(t, store.GetComponentsForResource("plugin", "resource"), 1)
	assert.Len(t, store.GetComponentsByResource("plugin"), 1)
}

func TestAddPluginKeepsWhatThePluginAlreadyHas(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()
	require.NoError(t, store.AddComponent(sidebarComponent("plugin", "resource", "name")))

	store.AddPlugin("plugin")

	assert.Len(t, store.GetComponentsForResource("plugin", "resource"), 1)
}

func TestRemovePluginForgetsItsComponents(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()
	store.AddPlugin("plugin")
	require.NoError(t, store.AddComponent(sidebarComponent("plugin", "resource", "name")))

	store.RemovePlugin("plugin")

	assert.Nil(t, store.GetComponentsByResource("plugin"))
	assert.Nil(t, store.GetComponentsForResource("plugin", "resource"))
	store.RemovePlugin("plugin") // removing what is not there is not an error
}

func TestWhatIsNotThereIsNothing(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()
	require.NoError(t, store.AddComponent(sidebarComponent("plugin", "resource", "name")))

	assert.Nil(t, store.GetComponentsForResource("", "resource"))
	assert.Nil(t, store.GetComponentsForResource("plugin", ""))
	assert.Nil(t, store.GetComponentsForResource("other", "resource"))
	assert.Empty(t, store.GetComponentsForResource("plugin", "other"))
	assert.Nil(t, store.GetComponentsByResource(""))
	assert.Nil(t, store.GetComponentsByResource("other"))
	assert.NotNil(t, store.GetComponentsByResource("plugin"))
}

func TestAPluginAddedWithNothingIsThereWithNoResources(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()

	store.AddPlugin("plugin")

	byResource := store.GetComponentsByResource("plugin")
	assert.NotNil(t, byResource, "the plugin is in the store")
	assert.Empty(t, byResource)
}

// The store is shared: the host initialises, starts and stops its plugins from a pool of workers
// (loadPluginsConcurrently), and the frontend reads it while they do. Run with -race.

func TestEveryPluginAddedAtOnceIsInTheStore(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()

	atOnce(manyPlugins, func(i int) { store.AddPlugin(pluginID(i)) })

	for i := range manyPlugins {
		assert.NotNil(t, store.GetComponentsByResource(pluginID(i)), "%s is in the store", pluginID(i))
	}
}

func TestPluginsAddedRemovedAndReadAtOnceLeaveTheStoreWhole(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()

	noErrors(t, atOnceErr(manyPlugins, func(i int) error {
		plugin := pluginID(i)
		store.AddPlugin(plugin)
		err := store.AddComponent(sidebarComponent(plugin, "resource", "name"))
		_ = store.GetComponentsByResource(plugin)
		_ = store.GetComponentsForResource(plugin, "resource")
		if i%2 == 0 {
			store.RemovePlugin(plugin)
		}
		return err
	}))

	for i := range manyPlugins {
		if i%2 == 0 {
			assert.Nil(t, store.GetComponentsByResource(pluginID(i)), "%s was removed", pluginID(i))
			continue
		}
		assert.Len(t, store.GetComponentsForResource(pluginID(i), "resource"), 1, "%s kept its component", pluginID(i))
	}
}

func TestEveryComponentRegisteredIntoOnePluginAtOnceIsKept(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()

	// Plugins register components into other plugins (a component's `plugin` names its target):
	// many of them name the same one.
	noErrors(t, atOnceErr(manyPlugins, func(i int) error {
		err := store.AddComponent(sidebarComponent("target", "resource", fmt.Sprintf("name-%d", i)))
		_ = store.GetComponentsForResource("target", "resource")
		return err
	}))

	assert.Len(t, store.GetComponentsForResource("target", "resource"), manyPlugins, "no registration was lost")
}

func TestTheSameComponentRegisteredAtOnceIsKeptOnce(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()
	c := sidebarComponent("target", "resource", "name")

	errs := atOnceErr(manyPlugins, func(int) error { return store.AddComponent(c) })

	accepted := 0
	for _, err := range errs {
		if err == nil {
			accepted++
		}
	}
	assert.Equal(t, 1, accepted, "exactly one of the registrations was accepted")
	assert.Len(t, store.GetComponentsForResource("target", "resource"), 1)
}

// What the store hands out is the caller's: the frontend's service encodes it while another plugin
// loads, and a caller that changes it must not change the store.

func TestWhatTheStoreHandsOutIsACopy(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()
	require.NoError(t, store.AddComponent(sidebarComponent("plugin", "resource", "name")))

	byResource := store.GetComponentsByResource("plugin")
	byResource["resource"][0].Name = "changed by a caller"
	byResource["added by a caller"] = []ResourceComponent{sidebarComponent("plugin", "added by a caller", "name")}
	delete(byResource, "resource")

	forResource := store.GetComponentsForResource("plugin", "resource")
	require.Len(t, forResource, 1)
	assert.Equal(t, "name", forResource[0].Name)
	forResource[0].Name = "changed too"

	assert.Equal(t, "name", store.GetComponentsForResource("plugin", "resource")[0].Name)
	assert.Len(t, store.GetComponentsByResource("plugin"), 1, "what a caller added to its copy is not in the store")
}

func TestCallersThatChangeWhatTheyWereGivenDoNotRaceWithTheStore(t *testing.T) {
	t.Parallel()
	store := NewResourceComponentStore()
	require.NoError(t, store.AddComponent(sidebarComponent("plugin", "resource", "name")))

	// Each caller changes the component it was handed while the others register and read: with a
	// copy that is its own memory, and nothing is shared.
	noErrors(t, atOnceErr(manyPlugins, func(i int) error {
		byResource := store.GetComponentsByResource("plugin")
		byResource["resource"][0].Name = fmt.Sprintf("changed-%d", i)
		return store.AddComponent(sidebarComponent("plugin", "resource", fmt.Sprintf("name-%d", i)))
	}))

	components := store.GetComponentsForResource("plugin", "resource")
	require.Len(t, components, manyPlugins+1)
	assert.Equal(t, "name", components[0].Name, "the first component is as it was registered")
}
