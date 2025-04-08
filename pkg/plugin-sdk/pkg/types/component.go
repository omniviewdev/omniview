package types

// VisualResourceComponent is a component that can be used to visualize
// a resource in one of the injectable areas in the IDE.
type VisualResourceComponent struct {
	ID        string   `json:"id"`
	Plugin    string   `json:"plugin"`
	Type      string   `json:"type"`
	Resources []string `json:"resources"`
}

// VisualComponentList is a list of visual components that can be used to
// visualize resources in the IDE.
type VisualComponentList struct {
	Resource []VisualResourceComponent `json:"resource"`
}
