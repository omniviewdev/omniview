package resource

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcetypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// FetchOpenAPISchemas fetches OpenAPI v3 schemas from the K8s cluster for the given
// registered resource keys. Returns schemas suitable for Monaco editor validation.
func FetchOpenAPISchemas(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	registeredKeys []string,
) ([]resourcetypes.EditorSchema, error) {
	if ctx.Connection == nil {
		return nil, fmt.Errorf("no connection in context")
	}

	openapiv3Client := client.Clientset.Discovery().OpenAPIV3()
	paths, err := openapiv3Client.Paths()
	if err != nil {
		return nil, fmt.Errorf("failed to get OpenAPI v3 paths: %w", err)
	}

	// Build a map of group/version -> keys for batch processing
	type gvKey struct {
		group   string
		version string
	}
	gvToKeys := make(map[gvKey][]string)
	for _, key := range registeredKeys {
		meta := resourcetypes.ResourceMetaFromString(key)
		if meta.Group == "" || meta.Version == "" || meta.Kind == "" {
			continue
		}
		gv := gvKey{group: meta.Group, version: meta.Version}
		gvToKeys[gv] = append(gvToKeys[gv], key)
	}

	var schemas []resourcetypes.EditorSchema

	for gv, keys := range gvToKeys {
		// Map SDK group names to OpenAPI v3 paths
		var openAPIPath string
		if gv.group == "core" {
			openAPIPath = fmt.Sprintf("api/%s", gv.version)
		} else {
			// Find the matching path from the server's available paths.
			// The SDK uses short group names (e.g., "apps") but the server
			// paths use the full group name (e.g., "apis/apps/v1").
			found := false
			for pathKey := range paths {
				// pathKey is like "api/v1" or "apis/apps/v1" or "apis/networking.k8s.io/v1"
				if matchesGroupVersion(pathKey, gv.group, gv.version) {
					openAPIPath = pathKey
					found = true
					break
				}
			}
			if !found {
				log.Printf("no OpenAPI path found for %s/%s", gv.group, gv.version)
				continue
			}
		}

		pathItem, ok := paths[openAPIPath]
		if !ok {
			log.Printf("OpenAPI path %q not found in server paths", openAPIPath)
			continue
		}

		schemaBytes, err := pathItem.Schema("application/json")
		if err != nil {
			log.Printf("failed to fetch schema for %s: %v", openAPIPath, err)
			continue
		}

		// Parse the schema document to extract individual Kind definitions
		var schemaDoc map[string]interface{}
		if err := json.Unmarshal(schemaBytes, &schemaDoc); err != nil {
			log.Printf("failed to parse schema for %s: %v", openAPIPath, err)
			continue
		}

		// OpenAPI v3 schema stores definitions under "components.schemas"
		components, _ := schemaDoc["components"].(map[string]interface{})
		if components == nil {
			continue
		}
		defs, _ := components["schemas"].(map[string]interface{})
		if defs == nil {
			continue
		}

		for _, key := range keys {
			meta := resourcetypes.ResourceMetaFromString(key)

			// Look for the definition matching this Kind.
			// The definition key format is typically:
			//   io.k8s.api.apps.v1.Deployment
			//   io.k8s.api.core.v1.Pod
			defKey := findDefinitionKey(defs, meta)
			if defKey == "" {
				continue
			}

			def, ok := defs[defKey]
			if !ok {
				continue
			}

			defBytes, err := json.Marshal(def)
			if err != nil {
				log.Printf("failed to marshal definition for %s: %v", key, err)
				continue
			}

			schemas = append(schemas, resourcetypes.EditorSchema{
				ResourceKey: key,
				FileMatch:   fmt.Sprintf("**/%s/*.yaml", key),
				URI:         fmt.Sprintf("k8s://%s/%s/%s/%s", ctx.Connection.ID, meta.Group, meta.Version, meta.Kind),
				Content:     defBytes,
				Language:    "yaml",
			})
		}
	}

	return schemas, nil
}

// matchesGroupVersion checks if an OpenAPI path key matches a given SDK group and version.
// Path keys look like "api/v1", "apis/apps/v1", "apis/networking.k8s.io/v1".
func matchesGroupVersion(pathKey, group, version string) bool {
	parts := strings.Split(pathKey, "/")

	if group == "core" {
		// core group: "api/v1"
		return len(parts) == 2 && parts[0] == "api" && parts[1] == version
	}

	// Non-core: "apis/{group}/{version}" or "apis/{group}.k8s.io/{version}"
	if len(parts) != 3 || parts[0] != "apis" {
		return false
	}
	if parts[2] != version {
		return false
	}

	apiGroup := parts[1]
	// Exact match
	if apiGroup == group {
		return true
	}
	// Match with .k8s.io suffix
	if apiGroup == group+".k8s.io" {
		return true
	}
	// Match by prefix (e.g., "flowcontrol" matches "flowcontrol.apiserver.k8s.io")
	if strings.HasPrefix(apiGroup, group+".") || strings.HasPrefix(apiGroup, group) {
		return true
	}
	return false
}

// findDefinitionKey searches for a schema definition key matching the given resource kind.
// Returns the full definition key or empty string if not found.
func findDefinitionKey(defs map[string]interface{}, meta resourcetypes.ResourceMeta) string {
	// Primary format: io.k8s.api.{group}.{version}.{Kind}
	group := meta.Group
	if group == "core" {
		group = "core"
	}
	primary := fmt.Sprintf("io.k8s.api.%s.%s.%s", group, meta.Version, meta.Kind)
	if _, ok := defs[primary]; ok {
		return primary
	}

	// Fallback: search for any key ending in .{Kind} that contains the version
	suffix := "." + meta.Kind
	for key := range defs {
		if strings.HasSuffix(key, suffix) && strings.Contains(key, meta.Version) {
			return key
		}
	}

	return ""
}
