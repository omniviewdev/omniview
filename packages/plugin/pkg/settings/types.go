package settings

// Select from a list of options.
type Select struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Default     string   `json:"default"`
	Options     []string `json:"options"`
}

// Multiselect from a list of options.
type Multiselect struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Options     []string `json:"options"`
	Default     []string `json:"default"`
}

// Text is a single line of text.
type Text struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Default     string `json:"default"`
}

// Multitext is a multiple entry text.
type Multitext struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Default     []string `json:"default"`
}

// KV is a key value pair.
type KV struct {
	Default     map[string]string `json:"default"`
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
}
