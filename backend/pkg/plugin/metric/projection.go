package metric

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// ResourceIdentityGuard authorizes metric access and pins current observed identity
// without reading a resource body or requiring resource.Get permission.
type ResourceIdentityGuard func(context.Context, string, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (func(context.Context) error, error)

func (c *controller) SetResourceIdentityGuard(guard ResourceIdentityGuard) {
	c.mux.Lock()
	c.resourceIdentityGuard = guard
	c.mux.Unlock()
}

// MetricResourceReader returns an authoritative source-owner observation. The
// integration must reuse observed bodies or a shared owner cache, not introduce
// one upstream GET per visible row. Caller-supplied bodies are never observations.
// Implementations must retain source admission and exclude private settings.
type MetricResourceReader func(context.Context, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (*resourcev2.Value, func(context.Context) error, error)

func (c *controller) SetMetricResourceReader(reader MetricResourceReader) {
	c.mux.Lock()
	c.metricResourceReader = reader
	c.mux.Unlock()
}

func (c *controller) projectMetricResources(ctx context.Context, req *sdk.ResourceSetQueryRequest) error {
	fields := map[string]string{}
	for _, definition := range req.Definitions {
		for _, binding := range definition.FieldBindings {
			if binding.ResourcePath == "" {
				continue
			}
			if binding.Source != "resource" || binding.Field == "" {
				return errors.New("resource paths require a named resource field binding")
			}
			if previous, exists := fields[binding.Field]; exists && previous != binding.ResourcePath {
				return errors.New("resource projection field has conflicting paths")
			}
			if _, err := publicResourcePointer(binding.ResourcePath); err != nil {
				return err
			}
			fields[binding.Field] = binding.ResourcePath
		}
	}
	if len(fields) == 0 {
		return nil
	}
	if len(fields) > 16 {
		return errors.New("resource projection exceeds sixteen fields")
	}
	c.mux.RLock()
	reader := c.metricResourceReader
	c.mux.RUnlock()
	if reader == nil {
		return errors.New("authoritative public resource observations are unavailable")
	}
	for i := range req.Resources {
		if err := ctx.Err(); err != nil {
			return err
		}
		r := &req.Resources[i]
		if r.Reference == nil || r.Route == nil {
			return errors.New("canonical resource reference and route required for projection")
		}
		body, guard, err := reader(ctx, req.ResourcePluginID, *r.Route, *r.Reference)
		if err != nil {
			return err
		}
		if body == nil || guard == nil {
			return errors.New("authoritative resource observation and generation guard are required")
		}
		projection := resourcev2.Value{Kind: "map", Map: make(map[string]resourcev2.Value, len(fields))}
		for field, path := range fields {
			leaf, err := extractPublicResourceLeaf(*body, path)
			if err != nil {
				return fmt.Errorf("metric field %q: %w", field, err)
			}
			projection.Map[field] = leaf
		}
		// Retain only selected scalar leaves; never store or forward the whole body.
		r.PublicData = &projection
		if err = registerObservationGuard(ctx, r.Token, guard); err != nil {
			return err
		}
	}
	return nil
}

func publicResourcePointer(path string) ([]string, error) {
	if path == "" || !strings.HasPrefix(path, "/") || len(path) > 1024 {
		return nil, errors.New("resource path must be a bounded RFC6901 scalar pointer")
	}
	encoded := strings.Split(path[1:], "/")
	if len(encoded) > 16 {
		return nil, errors.New("resource path nesting exceeds limit")
	}
	parts := make([]string, len(encoded))
	for i, part := range encoded {
		var decoded strings.Builder
		for at := 0; at < len(part); at++ {
			if part[at] != '~' {
				decoded.WriteByte(part[at])
				continue
			}
			at++
			if at >= len(part) {
				return nil, errors.New("invalid RFC6901 escape")
			}
			switch part[at] {
			case '0':
				decoded.WriteByte('~')
			case '1':
				decoded.WriteByte('/')
			default:
				return nil, errors.New("invalid RFC6901 escape")
			}
		}
		parts[i] = decoded.String()
		normalized := strings.ToLower(strings.NewReplacer("-", "", "_", "", ".", "").Replace(parts[i]))
		for _, private := range []string{"secret", "password", "passwd", "token", "credential", "kubeconfig", "privatekey", "clientkey", "authorization", "cookie"} {
			if strings.Contains(normalized, private) {
				return nil, errors.New("resource path selects a sensitive field")
			}
		}
		if i == 0 && (normalized == "data" || normalized == "stringdata" || normalized == "binarydata") {
			return nil, errors.New("resource data payloads are not public metric fields")
		}
	}
	return parts, nil
}
func extractPublicResourceLeaf(body resourcev2.Value, path string) (resourcev2.Value, error) {
	parts, err := publicResourcePointer(path)
	if err != nil {
		return resourcev2.Value{}, err
	}
	current := body
	for _, part := range parts {
		if current.Kind != "map" {
			return resourcev2.Value{}, errors.New("resource paths cannot traverse arrays or scalar values")
		}
		next, ok := current.Map[part]
		if !ok {
			return resourcev2.Value{}, errors.New("resource projection field is missing")
		}
		current = next
	}
	switch current.Kind {
	case "string", "bool", "int64", "uint64", "double", "timestamp":
	default:
		return resourcev2.Value{}, errors.New("resource projection must select a non-null scalar leaf")
	}
	if err = resourcev2.ValidateValue(current); err != nil {
		return resourcev2.Value{}, err
	}
	encoded, err := json.Marshal(current)
	if err != nil {
		return resourcev2.Value{}, err
	}
	if len(encoded) > 2048 {
		return resourcev2.Value{}, errors.New("resource scalar exceeds 2 KiB")
	}
	return current, nil
}

func validateProjectionBindings(definition sdk.MetricDefinition) error {
	paths := 0
	for _, binding := range definition.FieldBindings {
		if binding.ResourcePath == "" {
			continue
		}
		paths++
		if binding.Source != "resource" || binding.Field == "" {
			return errors.New("resource paths require a named resource field binding")
		}
		if _, err := publicResourcePointer(binding.ResourcePath); err != nil {
			return err
		}
	}
	if paths > 16 {
		return errors.New("resource projection exceeds sixteen fields")
	}
	return nil
}
