package types

// Namespace is a context in which resources are managed. It is a logical grouping of resources
// that share the same credentials and are managed by the same resource manager.
//
// For example, in a cloud provider, a namespace would be a role for a given account. In an cluster
// orchestration system (such as Kubernetes), a namespace would be a cluster context.
//
// Given the need for different resource providers needing different information to create a client,
// the namespace object is a way to encapsulate the information needed for ui visualizations to create a client for a
// given resource, as well as display it with contextual information.
type AuthorizationContext struct {
	// Data is an optional map of arbitrary data that can be used to store additional information about the namespace.
	// This is data that should be used to store additional information about the namespace, such as credential file
	// locations, or other information that is necessary to create a client for the namespace.
	//
	// This data is exposed to the user in the UI under the settings panel for the namespace. If the data is sensitive,
	// it should be stored in the SensitiveData field.
	// +optional
	Data map[string]interface{} `json:"data"`

	// SensitiveData is an optional map of arbitrary data that can be used to store additional information about the
	// namespace. This information is not exposed to the client in the UI, and can be used to store information that is
	// is only necessary within the plugin context, such as credentials necessary to create a client.
	// +optional
	sensitiveData map[string]interface{} `json:"-"`

	// ID is the unique identifier for the namespace.
	// +required
	ID string `json:"id"`

	// Name is the readable name of the namespace.
	// +required
	Name string `json:"name"`

	// Description is an optional description of the namespace. This is primarily for the user to customize
	// the visual representation of the namespace.
	// +optional
	Description string `json:"description"`

	// Image is an optional image that can be used to represent the namespace. This is primarily for the user to customize
	// the visual representation of the namespace.
	// +optional
	Image string `json:"image"`

	// IsAuthed is a boolean that represents whether the namespace has been authenticated or not
	// +optional
	IsAuthed bool `json:"isAuthed"`
}

func (c *AuthorizationContext) GetSensitiveData() map[string]interface{} {
	return c.sensitiveData
}

func (c *AuthorizationContext) SetSensitiveData(data map[string]interface{}) {
	c.sensitiveData = data
}

func (c *AuthorizationContext) GetData() map[string]interface{} {
	return c.Data
}

func (c *AuthorizationContext) SetData(data map[string]interface{}) {
	c.Data = data
}
