package apperror

// Action represents a frontend-renderable action button that can be attached
// to structured errors. The frontend maps each action type to a concrete UI
// behaviour (navigation, retry, opening a URL, or clipboard copy).
type Action struct {
	Type   string `json:"type"`             // "navigate", "retry", "open-url", "copy"
	Label  string `json:"label"`
	Target string `json:"target,omitempty"`
}

// NavigateAction creates an action that navigates to the given in-app route.
func NavigateAction(label, route string) Action {
	return Action{Type: "navigate", Label: label, Target: route}
}

// OpenURLAction creates an action that opens an external URL.
func OpenURLAction(label, url string) Action {
	return Action{Type: "open-url", Label: label, Target: url}
}

// RetryAction creates an action that signals the frontend to retry the operation.
func RetryAction(label string) Action {
	return Action{Type: "retry", Label: label}
}

// CopyAction creates an action that copies text to the clipboard.
func CopyAction(label, text string) Action {
	return Action{Type: "copy", Label: label, Target: text}
}

// OpenSettingsAction creates a navigate action to the settings page with the given category.
func OpenSettingsAction(category string) Action {
	return NavigateAction("Open Settings", "#/settings?category="+category)
}
