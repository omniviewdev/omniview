package resource

import (
	"encoding/json"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

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

// --- Converters: zero-copy for results, one marshal for inputs ---

func toClientResult(r *resource.GetResult) *ClientResult {
	if r == nil {
		return nil
	}
	return &ClientResult{Result: r.Result, Success: r.Success}
}

func createToClientResult(r *resource.CreateResult) *ClientResult {
	if r == nil {
		return nil
	}
	return &ClientResult{Result: r.Result, Success: r.Success}
}

func updateToClientResult(r *resource.UpdateResult) *ClientResult {
	if r == nil {
		return nil
	}
	return &ClientResult{Result: r.Result, Success: r.Success}
}

func deleteToClientResult(r *resource.DeleteResult) *ClientResult {
	if r == nil {
		return nil
	}
	return &ClientResult{Result: r.Result, Success: r.Success}
}

func toClientListResult(r *resource.ListResult) *ClientListResult {
	if r == nil {
		return nil
	}
	items := make([]interface{}, len(r.Result))
	for i, raw := range r.Result {
		items[i] = raw
	}
	return &ClientListResult{
		Result:     items,
		Success:    r.Success,
		TotalCount: r.TotalCount,
		NextCursor: r.NextCursor,
	}
}

func findToClientListResult(r *resource.FindResult) *ClientListResult {
	if r == nil {
		return nil
	}
	items := make([]interface{}, len(r.Result))
	for i, raw := range r.Result {
		items[i] = raw
	}
	return &ClientListResult{
		Result:     items,
		Success:    r.Success,
		TotalCount: r.TotalCount,
		NextCursor: r.NextCursor,
	}
}

func toSDKCreateInput(c ClientCreateInput) (resource.CreateInput, error) {
	raw, err := json.Marshal(c.Input)
	if err != nil {
		return resource.CreateInput{}, err
	}
	return resource.CreateInput{Input: raw, Namespace: c.Namespace}, nil
}

func toSDKUpdateInput(c ClientUpdateInput) (resource.UpdateInput, error) {
	raw, err := json.Marshal(c.Input)
	if err != nil {
		return resource.UpdateInput{}, err
	}
	return resource.UpdateInput{Input: raw, ID: c.ID, Namespace: c.Namespace}, nil
}
