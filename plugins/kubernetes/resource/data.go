package resource

// Data is non sensitive data store that is provided in the resource namespace object.
// This data is made configurable to the user in the UI, and should include any
// options the user need set in the IDE.
type Data struct {
	// Kubeconfig is the path to the kubeconfig file for where this context is defined.
	Kubeconfig string `json:"kubeconfig"`
}

// SensitiveData is sensitive data that is provided in the resourced namespace object.
// This data acts as a sensitive data store for the plugin to use, and is not made
// available outside of the plugin execution context.
type SensitiveData struct{}
