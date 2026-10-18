package devbaseline

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"

	categories "github.com/omniviewdev/omniview/internal/settings"
	"github.com/omniviewdev/plugin-sdk/settings"
)

// Every key is classified individually. Adding a key to a host category does not
// make it exportable. defaultShell is intentionally excluded: it can reference a
// source worktree or executable, unlike the terminal's visual preferences.
var preferenceKeys = map[string][]string{
	"general":    {"language"},
	"appearance": {"theme"},
	"editor":     {"theme", "folding", "foldingHighlight", "fontSize", "fontWeight", "formatOnPaste", "formatOnType", "lineHeight", "lineNumbers", "lineNumbersMinChars", "minimapEnabled", "minimapScale", "minimapShowSlider", "minimapSide", "minimapSize"},
	"terminal":   {"theme", "fontSize", "cursorStyle", "cursorBlink"},
}
var preferenceText = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$`)

func safePreferences(values map[string]map[string]any) (map[string]map[string]any, error) {
	schemas := map[string]settings.Category{"general": categories.General, "appearance": categories.Appearance, "editor": categories.Editor, "terminal": categories.Terminal}
	result := make(map[string]map[string]any)
	for category, keys := range preferenceKeys {
		schema := schemas[category]
		for _, key := range keys {
			value, present := values[category][key]
			if !present {
				continue
			}
			field, known := schema.Settings[key]
			// Current host schema is authoritative, never the source's schema or a
			// plugin-provided fallback. A newly-sensitive key immediately stops exporting.
			if !known || field.Sensitive || field.DevOnly || field.Type == settings.Password || field.FileSelection != nil {
				continue
			}
			// The host currently persists editor.fontWeight's numeric default despite
			// declaring Text. Preserve that legacy scalar only for this exact key.
			legacyWeight := category == "editor" && key == "fontWeight" && numericFontWeight(value)
			if !legacyWeight && !safeValue(field, value) {
				return nil, fmt.Errorf("baseline: invalid allowlisted preference %s.%s", category, key)
			}
			if field.Validator != nil && field.Validator(value) != nil {
				return nil, fmt.Errorf("baseline: invalid allowlisted preference %s.%s", category, key)
			}
			if result[category] == nil {
				result[category] = make(map[string]any)
			}
			result[category][key] = value
		}
	}
	return result, nil
}

func safeValue(field settings.Setting, value any) bool {
	switch field.Type {
	case settings.Text, settings.Select:
		text, ok := value.(string)
		return ok && preferenceText.MatchString(text)
	case settings.Toggle:
		_, ok := value.(bool)
		return ok
	case settings.Integer:
		switch number := value.(type) {
		case int:
			return number >= 0 && number <= 10000
		case int64:
			return number >= 0 && number <= 10000
		case float64:
			return !math.IsNaN(number) && !math.IsInf(number, 0) && math.Trunc(number) == number && number >= 0 && number <= 10000
		case json.Number:
			n, err := number.Int64()
			return err == nil && n >= 0 && n <= 10000
		}
	}
	return false
}

func numericFontWeight(value any) bool {
	switch number := value.(type) {
	case int:
		return number > 0 && number <= 1000
	case int64:
		return number > 0 && number <= 1000
	case float64:
		return !math.IsNaN(number) && !math.IsInf(number, 0) && math.Trunc(number) == number && number > 0 && number <= 1000
	case json.Number:
		n, err := number.Int64()
		return err == nil && n > 0 && n <= 1000
	default:
		return false
	}
}
