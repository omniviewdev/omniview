package graph

import (
	"testing"

	"github.com/tidwall/gjson"
)

func TestLabelSelector_Matches(t *testing.T) {
	tests := []struct {
		name     string
		selector string
		labels   map[string]string
		want     bool
	}{
		{"empty matches everything", `{}`, nil, true},
		{"matchLabels hit", `{"matchLabels":{"app":"web"}}`, map[string]string{"app": "web", "tier": "fe"}, true},
		{"matchLabels miss", `{"matchLabels":{"app":"web"}}`, map[string]string{"app": "db"}, false},
		{"In hit", `{"matchExpressions":[{"key":"env","operator":"In","values":["prod","stage"]}]}`, map[string]string{"env": "stage"}, true},
		{"In absent key", `{"matchExpressions":[{"key":"env","operator":"In","values":["prod"]}]}`, nil, false},
		{"NotIn other value", `{"matchExpressions":[{"key":"env","operator":"NotIn","values":["prod"]}]}`, map[string]string{"env": "dev"}, true},
		{"NotIn absent key", `{"matchExpressions":[{"key":"env","operator":"NotIn","values":["prod"]}]}`, nil, true},
		{"NotIn listed value", `{"matchExpressions":[{"key":"env","operator":"NotIn","values":["prod"]}]}`, map[string]string{"env": "prod"}, false},
		{"Exists", `{"matchExpressions":[{"key":"canary","operator":"Exists"}]}`, map[string]string{"canary": ""}, true},
		{"DoesNotExist", `{"matchExpressions":[{"key":"canary","operator":"DoesNotExist"}]}`, map[string]string{"canary": "1"}, false},
		{
			"labels and expressions must all hold",
			`{"matchLabels":{"app":"web"},"matchExpressions":[{"key":"env","operator":"In","values":["prod"]}]}`,
			map[string]string{"app": "web", "env": "dev"},
			false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sel, ok := parseLabelSelectorObject(gjson.Parse(tt.selector))
			if !ok {
				t.Fatalf("selector %s rejected", tt.selector)
			}
			if got := sel.matches(tt.labels); got != tt.want {
				t.Errorf("matches(%v) = %v, want %v", tt.labels, got, tt.want)
			}
		})
	}
}

func TestParseLabelSelectorObject_RejectsInvalid(t *testing.T) {
	for _, raw := range []string{
		`"app=web"`,
		`{"matchExpressions":[{"key":"env","operator":"Equals","values":["prod"]}]}`,
		`{"matchExpressions":[{"key":"env","operator":"In","values":[]}]}`,
		`{"matchExpressions":[{"key":"","operator":"Exists"}]}`,
	} {
		if _, ok := parseLabelSelectorObject(gjson.Parse(raw)); ok {
			t.Errorf("selector %s accepted, want rejected", raw)
		}
	}
}
