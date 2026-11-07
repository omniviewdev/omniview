package activity

import (
	"testing"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func TestTypedCloneIsolatesNestedPresentationAndIntent(t *testing.T) {
	original := sdk.Record{
		Task: &sdk.Task{State: "running", Cancellation: "unsupported"},
		Presentation: sdk.Presentation{
			Title:    "work",
			Progress: &resourcev2.ActivityProgress{Kind: "units", Current: "1", Total: "100", Unit: "bytes"},
			Metrics:  []resourcev2.ActivityMetric{{ID: "bytes", Label: "Bytes", Value: "1"}},
			Actions: []resourcev2.ActivityAction{{
				ID: "action", Kind: "resource-action", Label: "Review",
				Intent: &resourcev2.ResourceActionIntent{Request: resourcev2.ActionRequest{
					Input: resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{
						"nested": {Kind: "list", List: []resourcev2.Value{{Kind: "string", String: "before"}}},
					}},
				}},
			}},
		},
	}
	copy := cloneRecord(original)
	copy.Task.State = "failed"
	copy.Presentation.Progress.Current = "99"
	copy.Presentation.Metrics[0].Value = "99"
	value := copy.Presentation.Actions[0].Intent.Request.Input.Map["nested"]
	value.List[0].String = "after"
	if original.Task.State != "running" || original.Presentation.Progress.Current != "1" || original.Presentation.Metrics[0].Value != "1" {
		t.Fatal("typed clone shared presentation or task state")
	}
	if original.Presentation.Actions[0].Intent.Request.Input.Map["nested"].List[0].String != "before" {
		t.Fatal("typed clone shared nested canonical values")
	}
}
