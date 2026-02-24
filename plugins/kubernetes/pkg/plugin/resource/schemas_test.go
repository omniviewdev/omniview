package resource

import (
	"testing"

	resourcetypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/stretchr/testify/assert"
)

func TestMatchesGroupVersion(t *testing.T) {
	tests := []struct {
		name     string
		pathKey  string
		group    string
		version  string
		expected bool
	}{
		{
			name:     "core group matches api/v1",
			pathKey:  "api/v1",
			group:    "core",
			version:  "v1",
			expected: true,
		},
		{
			name:     "core group wrong version",
			pathKey:  "api/v1",
			group:    "core",
			version:  "v2",
			expected: false,
		},
		{
			name:     "apps group exact match",
			pathKey:  "apis/apps/v1",
			group:    "apps",
			version:  "v1",
			expected: true,
		},
		{
			name:     "networking with .k8s.io suffix",
			pathKey:  "apis/networking.k8s.io/v1",
			group:    "networking",
			version:  "v1",
			expected: true,
		},
		{
			name:     "flowcontrol with apiserver.k8s.io suffix",
			pathKey:  "apis/flowcontrol.apiserver.k8s.io/v1",
			group:    "flowcontrol",
			version:  "v1",
			expected: true,
		},
		{
			name:     "wrong group",
			pathKey:  "apis/apps/v1",
			group:    "batch",
			version:  "v1",
			expected: false,
		},
		{
			name:     "wrong version",
			pathKey:  "apis/apps/v1",
			group:    "apps",
			version:  "v2",
			expected: false,
		},
		{
			name:     "non-apis prefix",
			pathKey:  "foo/apps/v1",
			group:    "apps",
			version:  "v1",
			expected: false,
		},
		{
			name:     "too few segments",
			pathKey:  "apis/apps",
			group:    "apps",
			version:  "v1",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := matchesGroupVersion(tt.pathKey, tt.group, tt.version)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestFindDefinitionKey(t *testing.T) {
	defs := map[string]interface{}{
		"io.k8s.api.core.v1.Pod":            map[string]interface{}{"type": "object"},
		"io.k8s.api.apps.v1.Deployment":     map[string]interface{}{"type": "object"},
		"io.k8s.api.batch.v1.Job":           map[string]interface{}{"type": "object"},
		"io.k8s.api.networking.v1.Ingress":   map[string]interface{}{"type": "object"},
		"com.example.custom.v1beta1.Widget":  map[string]interface{}{"type": "object"},
	}

	tests := []struct {
		name     string
		meta     resourcetypes.ResourceMeta
		expected string
	}{
		{
			name:     "core Pod",
			meta:     resourcetypes.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"},
			expected: "io.k8s.api.core.v1.Pod",
		},
		{
			name:     "apps Deployment",
			meta:     resourcetypes.ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"},
			expected: "io.k8s.api.apps.v1.Deployment",
		},
		{
			name:     "not found",
			meta:     resourcetypes.ResourceMeta{Group: "core", Version: "v1", Kind: "DoesNotExist"},
			expected: "",
		},
		{
			name:     "fallback match by suffix and version",
			meta:     resourcetypes.ResourceMeta{Group: "custom", Version: "v1beta1", Kind: "Widget"},
			expected: "com.example.custom.v1beta1.Widget",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := findDefinitionKey(defs, tt.meta)
			assert.Equal(t, tt.expected, result)
		})
	}
}
