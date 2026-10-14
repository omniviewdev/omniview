package resource

// --- Result types (SDK → frontend) ---
// These replace json.RawMessage fields with interface{} so Wails generates
// "any" in TypeScript instead of "number[]".

// ClientResult wraps a single-resource SDK result for the frontend.
type ClientResult struct {
	Result  interface{} `json:"result"`
	Success bool        `json:"success"`
}

// ClientListResult wraps a multi-resource SDK result for the frontend.
type ClientListResult struct {
	Result     []interface{} `json:"result"`
	Success    bool          `json:"success"`
	TotalCount int           `json:"totalCount"`
	NextCursor string        `json:"nextCursor,omitempty"`
}

// --- Input types (frontend → SDK) ---

// ClientCreateInput accepts interface{} from the frontend instead of json.RawMessage.
type ClientCreateInput struct {
	Input     interface{} `json:"input"`
	Namespace string      `json:"namespace"`
}

// ClientUpdateInput accepts interface{} from the frontend instead of json.RawMessage.
type ClientUpdateInput struct {
	Input     interface{} `json:"input"`
	ID        string      `json:"id"`
	Namespace string      `json:"namespace"`
}
