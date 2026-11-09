package metric

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"sort"
	"strconv"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// Each delivery owns its mutable SDK pointers/maps; headless consumers cannot
// mutate another observer or corrupt the coordinator's immutable completed cache.
func cloneFiniteResult(result sdk.ResourceMetricResult) sdk.ResourceMetricResult {
	if result.Source != nil {
		source := *result.Source
		result.Source = &source
	}
	if result.Value != nil {
		value := *result.Value
		result.Value = &value
	}
	if result.ObservedAt != nil {
		observed := *result.ObservedAt
		result.ObservedAt = &observed
	}
	result.Dimensions = maps.Clone(result.Dimensions)
	if result.Points != nil {
		points := make([]sdk.ResourceMetricPoint, len(result.Points))
		copy(points, result.Points)
		for i := range points {
			if points[i].Value != nil {
				value := *points[i].Value
				points[i].Value = &value
			}
		}
		result.Points = points
	}
	return result
}

func cloneFiniteCatalog(catalog *sdk.ResourceMetricsCatalog) *sdk.ResourceMetricsCatalog {
	if catalog == nil {
		return nil
	}
	cloned := *catalog
	cloned.Metrics = make([]sdk.FiniteMetricDescriptor, len(catalog.Metrics))
	copy(cloned.Metrics, catalog.Metrics)
	for i := range cloned.Metrics {
		cloned.Metrics[i].Shapes = append([]string(nil), cloned.Metrics[i].Shapes...)
		if cloned.Metrics[i].Source != nil {
			source := *cloned.Metrics[i].Source
			cloned.Metrics[i].Source = &source
		}
	}
	return &cloned
}

func validateFiniteSelection(query sdk.ResourceMetricsQuery, catalog *sdk.ResourceMetricsCatalog) error {
	if len(query.Targets) > catalog.MaxTargets {
		return finiteError("RESOURCE_LIMIT", "Catalog target limit exceeded.")
	}
	for _, id := range query.MetricIDs {
		found := false
		for _, descriptor := range catalog.Metrics {
			if descriptor.ID == id {
				for _, shape := range descriptor.Shapes {
					if shape == query.Shape {
						found = true
					}
				}
			}
		}
		if !found {
			return finiteError("UNSUPPORTED", "Metric or evaluation shape is not in the native catalog.")
		}
	}
	return nil
}

// MetricResourceReader reads only retained owner observations. Paths must be
// approved against the observed representation's current schema before return.
// The guard reauthorizes the owner and fences source, schema and member revision.
type MetricResourceReader func(context.Context, string, resourcev2.AccessRoute, resourcev2.ResourceReference, []string) (*resourcev2.Value, func(context.Context) error, error)

// ResourceIdentityGuard pins an observed identity without resource.Get access.
type ResourceIdentityGuard func(context.Context, string, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (func(context.Context) error, error)

func (c *controller) SetMetricResourceReader(reader MetricResourceReader) {
	c.mux.Lock()
	c.metricResourceReader = reader
	c.mux.Unlock()
}

func (c *controller) SetResourceIdentityGuard(guard ResourceIdentityGuard) {
	c.mux.Lock()
	c.resourceIdentityGuard = guard
	c.mux.Unlock()
}

// projectFinite never accepts caller bodies as observations. Only explicitly
// mapped schema-approved scalar leaves cross the source boundary.
func (c *controller) projectFinite(ctx context.Context, ownerPlugin, ownerConnection string, q sdk.ResourceMetricsQuery) (sdk.ResourceMetricsQuery, func() error, error) {
	q.Targets = append([]sdk.ResourceMetricTarget(nil), q.Targets...)
	for i := range q.Targets {
		q.Targets[i].PublicData = nil
	}
	fields := map[string]string{}
	requested := make(map[string]bool, len(q.MetricIDs))
	for _, id := range q.MetricIDs {
		requested[id] = true
	}
	for _, definition := range q.Context.Definitions {
		if !requested[definition.ID] {
			continue
		}
		if err := validateProjectionBindings(definition); err != nil {
			return q, nil, err
		}
		for _, binding := range definition.FieldBindings {
			if binding.ResourcePath == "" {
				continue
			}
			if previous, exists := fields[binding.Field]; exists && previous != binding.ResourcePath {
				return q, nil, errors.New("resource projection field has conflicting paths")
			}
			fields[binding.Field] = binding.ResourcePath
		}
	}
	if len(fields) > 16 {
		return q, nil, errors.New("resource projection exceeds sixteen fields")
	}
	paths := make([]string, 0, len(fields))
	for _, path := range fields {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	c.mux.RLock()
	reader, identity := c.metricResourceReader, c.resourceIdentityGuard
	c.mux.RUnlock()
	if len(fields) != 0 && reader == nil {
		return q, nil, errors.New("authoritative public resource observations are unavailable")
	}
	if len(fields) == 0 && identity == nil {
		return q, nil, errors.New("authoritative resource identity guard is unavailable")
	}
	// Targets share the route catalog within one admission instant; each guard
	// still fences its own reference. Every delivery re-runs guards in a new batch.
	batch := resource.WithAdmissionBatch(ctx)
	guards := make([]func(context.Context) error, 0, len(q.Targets))
	for i := range q.Targets {
		if err := ctx.Err(); err != nil {
			return q, nil, err
		}
		target := &q.Targets[i]
		if target.Route.Connection != ownerConnection {
			return q, nil, errors.New("resource projection route does not match owner connection")
		}
		var guard func(context.Context) error
		if len(fields) == 0 {
			var err error
			guard, err = identity(batch, "metric.Query", ownerPlugin, target.Route, target.Reference)
			if err != nil {
				return q, nil, err
			}
		} else {
			body, observedGuard, err := reader(batch, ownerPlugin, target.Route, target.Reference, paths)
			if err != nil {
				return q, nil, err
			}
			if body == nil {
				return q, nil, errors.New("authoritative resource observation is required")
			}
			guard = observedGuard
			target.PublicData = make(map[string]string, len(fields))
			for field, path := range fields {
				leaf, err := extractPublicResourceLeaf(*body, path)
				if err != nil {
					return q, nil, fmt.Errorf("metric field %q: %w", field, err)
				}
				target.PublicData[field] = publicResourceScalar(leaf)
			}
		}
		if guard == nil {
			return q, nil, errors.New("authoritative resource observation guard is required")
		}
		guards = append(guards, guard)
	}
	// Keep the projection specification stable across target/metric subsets.
	// Target keys separately include approved scalar values. A changed mapping
	// changes this digest; changed values change only the affected target key.
	projection, err := json.Marshal(q.Context.Definitions)
	if err != nil {
		return q, nil, err
	}
	digest := sha256.Sum256(projection)
	q.Context.ProjectionRevision = hex.EncodeToString(digest[:])
	deliver := func() error {
		delivery := resource.WithAdmissionBatch(ctx)
		for _, guard := range guards {
			if err := guard(delivery); err != nil {
				return err
			}
		}
		return nil
	}
	if err := deliver(); err != nil {
		return q, nil, err
	}
	return q, deliver, nil
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
	if err := resourcev2.ValidateValue(current); err != nil {
		return resourcev2.Value{}, err
	}
	if len(publicResourceScalar(current)) > 1024 {
		return resourcev2.Value{}, errors.New("resource scalar exceeds 1 KiB")
	}
	return current, nil
}

func publicResourceScalar(value resourcev2.Value) string {
	switch value.Kind {
	case "string":
		return value.String
	case "bool":
		return strconv.FormatBool(value.Bool)
	case "int64":
		return value.Int
	case "uint64":
		return value.Uint
	case "double":
		return strconv.FormatFloat(value.Double, 'g', -1, 64)
	case "timestamp":
		return value.Timestamp
	default:
		return ""
	}
}

func validateProjectionBindings(definition sdk.MetricDefinition) error {
	fields := map[string]string{}
	for _, binding := range definition.FieldBindings {
		if binding.ResourcePath == "" {
			continue
		}
		if binding.Source != "resource" || binding.Field == "" {
			return errors.New("resource paths require a named resource field binding")
		}
		if _, err := publicResourcePointer(binding.ResourcePath); err != nil {
			return err
		}
		if previous, exists := fields[binding.Field]; exists && previous != binding.ResourcePath {
			return errors.New("resource projection field has conflicting paths")
		}
		fields[binding.Field] = binding.ResourcePath
	}
	if len(fields) > 16 {
		return errors.New("resource projection exceeds sixteen fields")
	}
	return nil
}
