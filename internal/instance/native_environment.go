package instance

import (
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

const nativeOriginalXDG = "OMNIVIEW_NATIVE_ORIGINAL_XDG"

type nativeXDGValue struct {
	Present bool   `json:"present"`
	Value   string `json:"value"`
}

// NativeHostEnvironment is applied only to the native host exec, never to its
// supervisor, source tools, plugins, HOME, config, runtime or desktop session.
// Discard inherited restore metadata: only this exec's actual input is trusted.
func (p Profile) NativeHostEnvironment(base []string) ([]string, error) {
	original := map[string]nativeXDGValue{"XDG_DATA_HOME": {}, "XDG_CACHE_HOME": {}}
	env := make([]string, 0, len(base)+3)
	for _, entry := range base {
		key, value, _ := strings.Cut(entry, "=")
		if _, selected := original[key]; selected {
			original[key] = nativeXDGValue{Present: true, Value: value}
			continue
		}
		if key != nativeOriginalXDG {
			env = append(env, entry)
		}
	}
	raw, err := json.Marshal(original)
	if err != nil {
		return nil, err
	}
	return append(env, "XDG_DATA_HOME="+filepath.Join(p.WebviewRoot, "data"), "XDG_CACHE_HOME="+filepath.Join(p.WebviewRoot, "cache"), nativeOriginalXDG+"="+string(raw)), nil
}

// RestoreNativeChildEnvironment restores absence as well as empty values, so
// plugin/tool credential and cache discovery sees exactly the caller's context.
func RestoreNativeChildEnvironment(base []string) ([]string, error) {
	var raw string
	found := false
	for _, entry := range base {
		key, value, _ := strings.Cut(entry, "=")
		if key == nativeOriginalXDG {
			if found {
				return nil, fmt.Errorf("duplicate native XDG restore metadata")
			}
			found, raw = true, value
		}
	}
	if !found {
		return base, nil
	}
	var original map[string]nativeXDGValue
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&original); err != nil || len(original) != 2 {
		return nil, fmt.Errorf("invalid native XDG restore metadata")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, fmt.Errorf("trailing native XDG restore metadata")
	}
	for _, key := range []string{"XDG_DATA_HOME", "XDG_CACHE_HOME"} {
		if _, ok := original[key]; !ok {
			return nil, fmt.Errorf("incomplete native XDG restore metadata")
		}
		if strings.ContainsRune(original[key].Value, 0) {
			return nil, fmt.Errorf("invalid native XDG environment value")
		}
	}
	env := make([]string, 0, len(base))
	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		if key != nativeOriginalXDG && key != "XDG_DATA_HOME" && key != "XDG_CACHE_HOME" {
			env = append(env, entry)
		}
	}
	for _, key := range []string{"XDG_DATA_HOME", "XDG_CACHE_HOME"} {
		if value := original[key]; value.Present {
			env = append(env, key+"="+value.Value)
		}
	}
	return env, nil
}

func (p Profile) ValidateNativeHostEnvironment(getenv func(string) string) error {
	if getenv(nativeOriginalXDG) == "" {
		return fmt.Errorf("native Linux launch requires the managed pre-start environment to preserve plugin/tool roots; use workspace up --mode native")
	}
	for key, leaf := range map[string]string{"XDG_DATA_HOME": "data", "XDG_CACHE_HOME": "cache"} {
		if getenv(key) != filepath.Join(p.WebviewRoot, leaf) {
			return fmt.Errorf("native Linux launch requires %s selected before process startup; use workspace up --mode native", key)
		}
	}
	return nil
}
