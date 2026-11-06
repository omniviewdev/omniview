package metric

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// SetMetricPreferencesStore binds the current profile's existing settings
// database. Native startup calls this once before exposing frontend services.
// Nil storage makes reads/saves fail visibly; it never silently saves in memory.
func (c *controller) SetMetricPreferencesStore(store *settingsstore.Store) {
	c.preferencesMu.Lock()
	defer c.preferencesMu.Unlock()
	c.preferencesStore = store
}
func defaultMetricViewPreferences() MetricViewPreferences {
	return MetricViewPreferences{Version: 1, MetricIDs: []string{}, Displays: map[string]string{}, Layout: "auto", TimeMode: "relative", DurationMs: 3600000, Details: map[string]bool{}}
}
func preferencesKey(plugin, key string) (string, error) {
	if plugin == "" || key == "" || len(plugin) > 256 || len(key) > 512 || !utf8.ValidString(plugin) || !utf8.ValidString(key) || strings.ContainsAny(plugin+key, "\x00\r\n") {
		return "", finiteError("INVALID_REQUEST", "Preference owner and resource key are required and bounded.")
	}
	// JSON tuple avoids ambiguous plugin/resource separators and source secrets.
	b, _ := json.Marshal([]string{plugin, key})
	return "metric-view-v1/" + string(b), nil
}
func validateMetricViewPreferences(p MetricViewPreferences) error {
	if p.Version != 1 || len(p.MetricIDs) > sdk.MaxFiniteMetrics || len(p.Displays) > 128 || len(p.Details) > 128 {
		return finiteError("INVALID_REQUEST", "Invalid metric preference schema or metric count.")
	}
	ids := map[string]bool{}
	for _, id := range p.MetricIDs {
		if id == "" || len(id) > 256 || !utf8.ValidString(id) || ids[id] || strings.ContainsAny(id, "\x00\r\n") {
			return finiteError("INVALID_REQUEST", "Preference metric IDs must be bounded and unique.")
		}
		ids[id] = true
	}
	for id, display := range p.Displays {
		if id == "" || len(id) > 256 || !utf8.ValidString(id) || strings.ContainsAny(id, "\x00\r\n") || (display != "auto" && display != "value" && display != "capacity" && display != "gauge" && display != "area" && display != "line" && display != "sample-bars") {
			return finiteError("INVALID_REQUEST", "Invalid metric display preference.")
		}
	}
	for id := range p.Details {
		if id == "" || len(id) > 256 || !utf8.ValidString(id) || strings.ContainsAny(id, "\x00\r\n") {
			return finiteError("INVALID_REQUEST", "Invalid metric details key.")
		}
	}
	if p.Layout != "auto" && p.Layout != "grid" && p.Layout != "stack" {
		return finiteError("INVALID_REQUEST", "Invalid metric layout.")
	}
	max := int64(sdk.MaxFiniteRange / 1000000)
	switch p.TimeMode {
	case "relative":
		if p.DurationMs <= 0 || p.DurationMs > max {
			return finiteError("INVALID_REQUEST", "Relative duration must be positive and at most 31 days.")
		}
	case "absolute":
		if p.StartMs <= 0 || p.EndMs <= p.StartMs || p.EndMs-p.StartMs > max {
			return finiteError("INVALID_REQUEST", "Absolute time domain must be ordered and at most 31 days.")
		}
	default:
		return finiteError("INVALID_REQUEST", "Invalid metric time mode.")
	}
	if p.DurationMs < 0 || p.DurationMs > max || p.StartMs < 0 || p.EndMs < 0 || p.StartMs > 253402300799999 || p.EndMs > 253402300799999 {
		return finiteError("INVALID_REQUEST", "Preference time fields exceed supported bounds.")
	}
	return nil
}

const metricPreferencesCategory = "metric-view-preferences-v1"

func (c *controller) loadMetricPreferencesLocked(key string) (MetricViewPreferences, map[string]any, error) {
	values, err := c.preferencesStore.LoadCategory(metricPreferencesCategory)
	if err != nil {
		return MetricViewPreferences{}, nil, err
	}
	if len(values) > 512 {
		return MetricViewPreferences{}, nil, finiteError("RESOURCE_LIMIT", "Metric preference document count exceeded.")
	}
	value, exists := values[key]
	if !exists {
		return defaultMetricViewPreferences(), values, nil
	}
	encoded, ok := value.(string)
	if !ok || len(encoded) > 32768 {
		return MetricViewPreferences{}, nil, finiteError("INVALID_REQUEST", "Stored metric preferences are invalid.")
	}
	var p MetricViewPreferences
	decoder := json.NewDecoder(strings.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&p); err != nil {
		return MetricViewPreferences{}, nil, fmt.Errorf("decode metric preferences: %w", err)
	}
	if err = validateMetricViewPreferences(p); err != nil {
		return MetricViewPreferences{}, nil, err
	}
	return p, values, nil
}

// GetMetricViewPreferences loads profile-owned presentation state or documented
// defaults with Revision zero (not persisted). Empty selection at Revision > 0 is
// intentional and must not be replaced with owning-view defaults. It returns
// durable store/validation errors; callers
// must display save failures instead of claiming persistence. No credentials or
// datasource configuration are accepted or returned by this API.
func (c *controller) GetMetricViewPreferences(plugin, resourceKey string) (MetricViewPreferences, error) {
	key, err := preferencesKey(plugin, resourceKey)
	if err != nil {
		return MetricViewPreferences{}, err
	}
	c.preferencesMu.Lock()
	defer c.preferencesMu.Unlock()
	p, _, err := c.loadMetricPreferencesLocked(key)
	return p, err
}

// SaveMetricViewPreferences atomically saves a complete document only when its
// Revision equals the currently stored revision. On success the durable revision
// increments; reload before another edit. A concurrent stale save returns CONFLICT
// and changes nothing. For example, two windows loading revision 4 cannot both
// save revision 4: the second must reload and explicitly merge its intended edit.
func (c *controller) SaveMetricViewPreferences(plugin, resourceKey string, p MetricViewPreferences) error {
	key, err := preferencesKey(plugin, resourceKey)
	if err != nil {
		return err
	}
	if err = validateMetricViewPreferences(p); err != nil {
		return err
	}
	c.preferencesMu.Lock()
	defer c.preferencesMu.Unlock()
	current, values, err := c.loadMetricPreferencesLocked(key)
	if err != nil {
		return err
	}
	if _, exists := values[key]; !exists && len(values) >= 512 {
		return finiteError("RESOURCE_LIMIT", "Metric preference document count exceeded.")
	}
	if p.Revision != current.Revision {
		return finiteError("CONFLICT", "Metric preferences changed; reload and merge your edit.")
	}
	if p.Revision == math.MaxUint64 {
		return finiteError("RESOURCE_LIMIT", "Preference revision exhausted.")
	}
	p.Revision++
	encoded, err := json.Marshal(p)
	if err != nil {
		return err
	}
	if len(encoded) > 32768 {
		return finiteError("RESOURCE_LIMIT", "Metric preference document byte limit exceeded.")
	}
	values[key] = string(encoded)
	return c.preferencesStore.SaveCategory(metricPreferencesCategory, values)
}
