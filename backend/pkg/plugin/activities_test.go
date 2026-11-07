package plugin

import (
	"testing"

	hostactivity "github.com/omniviewdev/omniview/backend/pkg/activity"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/internal/appstate"
	sdkactivity "github.com/omniviewdev/plugin-sdk/pkg/activity"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func activityObserverService(t *testing.T) *hostactivity.Service {
	t.Helper()
	state, err := appstate.New(appstate.WithRoot(t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	service, err := hostactivity.NewService(state.RootDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func navigationPresentation(pluginID string) sdkactivity.Presentation {
	return sdkactivity.Presentation{
		Title: "Work",
		Actions: []resourcev2.ActivityAction{{
			ID: "view", Kind: "navigate-resource", Label: "View resource",
			Target: &resourcev2.ResourceNavigationIntent{
				PluginID: pluginID, TargetID: "target", Representation: "default",
				Route: resourcev2.AccessRoute{Connection: "connection"},
				Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
					Provider: pluginID, Authority: "authority", Type: "resource", ID: "object",
				}},
			},
		}},
	}
}

func TestProviderUpdatesPreserveContextualNavigationThroughCompletion(t *testing.T) {
	service := activityObserverService(t)
	initial := navigationPresentation("alpha")
	record, err := service.BeginOwnedTask("native:alpha", sdkactivity.Spec{Presentation: initial}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, terminal := range []bool{false, true} {
		update := &sdkactivity.Presentation{Title: "Provider phase"}
		presentation := mergeActivityPresentation(record.Presentation, update, initial.Actions)
		record, err = recordActivitySnapshot(service, "native:alpha", record.ID, resource.ActionSnapshot{Terminal: terminal}, presentation, record.Presentation)
		if err != nil {
			t.Fatal(err)
		}
		if len(record.Presentation.Actions) != 1 || record.Presentation.Actions[0].ID != "view" {
			t.Fatal("provider metadata discarded contextual navigation")
		}
	}
	if record.Task.State != "succeeded" || record.Task.Cancellation != "unsupported" {
		t.Fatal("completion invented cancellation or lost actual outcome", record.Task)
	}
}

func TestForeignProviderPresentationCannotPoisonTerminalOutcome(t *testing.T) {
	service := activityObserverService(t)
	initial := navigationPresentation("alpha")
	record, err := service.BeginOwnedTask("native:alpha", sdkactivity.Spec{Presentation: initial}, nil)
	if err != nil {
		t.Fatal(err)
	}
	foreign := navigationPresentation("beta")
	updated, err := recordActivitySnapshot(service, "native:alpha", record.ID, resource.ActionSnapshot{}, foreign, record.Presentation)
	if err == nil {
		t.Fatal("foreign progress presentation rejection was hidden")
	}
	if updated.Presentation.Actions[0].Target.PluginID != "alpha" || updated.Task.State != "running" {
		t.Fatal("foreign progress poisoned accepted presentation")
	}
	completed, err := recordActivitySnapshot(service, "native:alpha", record.ID, resource.ActionSnapshot{Terminal: true}, foreign, updated.Presentation)
	if err == nil {
		t.Fatal("foreign terminal presentation rejection was hidden")
	}
	if completed.Task.State != "succeeded" || completed.Presentation.Actions[0].Target.PluginID != "alpha" {
		t.Fatal("rejected presentation erased known terminal outcome")
	}
}
