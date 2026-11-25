package ui

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// metaOf is the metadata of a plugin that declares one component for each of the resources, in the
// plugin it names (its own when it names none).
func metaOf(id, target string, resources ...string) config.PluginMeta {
	return config.PluginMeta{
		ID: id,
		Components: config.PluginComponents{
			Resource: []config.PluginResourceComponent{{
				Name:           "view-of-" + id,
				Plugin:         target,
				Area:           config.PluginComponentAreaSidebar,
				Resources:      resources,
				ExtensionPoint: "",
			}},
		},
	}
}

// The host calls OnPluginInit, OnPluginStart and OnPluginStop of every manager from the workers
// that load its plugins (loadPluginsConcurrently), while the frontend asks the service what is
// registered. Run with -race.
func TestManagerKeepsEveryPluginThatLoadsAtOnce(t *testing.T) {
	t.Parallel()
	cm := NewComponentManager(logging.NewNop())
	ctx := context.Background()

	noErrors(t, atOnceErr(manyPlugins, func(i int) error {
		id := pluginID(i)
		meta := metaOf(id, "", "things", "others")
		err := errors.Join(cm.OnPluginInit(ctx, id, meta), cm.OnPluginStart(ctx, id, meta))
		_ = cm.GetPluginComponents(GetPluginComponentsInput{Plugin: id})
		_ = cm.GetResourceComponents(GetResourceComponentsInput{Plugin: id, Resource: "things"})
		_ = cm.GetResourceAreaComponent(GetResourceAreaComponentInput{Plugin: id, Resource: "things", Area: ResourceComponentAreaSidebar})
		return err
	}))

	for i := range manyPlugins {
		byResource := cm.GetPluginComponents(GetPluginComponentsInput{Plugin: pluginID(i)})
		assert.Len(t, byResource, 2, "%s has its two resources", pluginID(i))
		area := cm.GetResourceAreaComponent(GetResourceAreaComponentInput{Plugin: pluginID(i), Resource: "things", Area: ResourceComponentAreaSidebar})
		require.NotNil(t, area, "%s has its sidebar component", pluginID(i))
		assert.Equal(t, "view-of-"+pluginID(i), area.Name)
	}
}

func TestManagerKeepsEveryComponentThatPluginsRegisterIntoOneTarget(t *testing.T) {
	t.Parallel()
	cm := NewComponentManager(logging.NewNop())
	ctx := context.Background()
	require.NoError(t, cm.OnPluginInit(ctx, "target", metaOf("target", "")))

	noErrors(t, atOnceErr(manyPlugins, func(i int) error {
		id := pluginID(i)
		meta := metaOf(id, "target", "things")
		err := errors.Join(cm.OnPluginInit(ctx, id, meta), cm.OnPluginStart(ctx, id, meta))
		_ = cm.GetResourceComponents(GetResourceComponentsInput{Plugin: "target", Resource: "things"})
		return err
	}))

	assert.Len(t, cm.GetResourceComponents(GetResourceComponentsInput{Plugin: "target", Resource: "things"}), manyPlugins)
}

func TestManagerForgetsEveryPluginThatStopsAtOnce(t *testing.T) {
	t.Parallel()
	cm := NewComponentManager(logging.NewNop())
	ctx := context.Background()
	for i := range manyPlugins {
		meta := metaOf(pluginID(i), "", "things")
		require.NoError(t, cm.OnPluginInit(ctx, pluginID(i), meta))
		require.NoError(t, cm.OnPluginStart(ctx, pluginID(i), meta))
	}

	noErrors(t, atOnceErr(manyPlugins, func(i int) error {
		id := pluginID(i)
		var err error
		switch i % 3 {
		case 0:
			err = cm.OnPluginStop(ctx, id, metaOf(id, ""))
		case 1:
			err = cm.OnPluginShutdown(ctx, id, metaOf(id, ""))
		default:
			err = cm.OnPluginDestroy(ctx, id, metaOf(id, ""))
		}
		_ = cm.GetPluginComponents(GetPluginComponentsInput{Plugin: pluginID((i + 1) % manyPlugins)})
		return err
	}))

	for i := range manyPlugins {
		assert.Nil(t, cm.GetPluginComponents(GetPluginComponentsInput{Plugin: pluginID(i)}), "%s was forgotten", pluginID(i))
	}
}
