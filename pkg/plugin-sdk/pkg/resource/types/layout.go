package types

type LayoutItem struct {
	// Unique identifier for the layout item. If this does not have children,
	// this will be the ID of the layout item.
	ID string `json:"id"`
	// Display label for the layout item
	Label string `json:"title"`
	// Optional icon for the layout item
	Icon string `json:"icon"`
	// Optional description for the layout item
	Description string `json:"description"`
	// Optional nested children for the layout items
	Items []LayoutItem `json:"items"`
}

type LayoutOpts struct {
	Layouts       map[string][]LayoutItem
	DefaultLayout string
}
