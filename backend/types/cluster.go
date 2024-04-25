package types

// AddResourceEvent is an event that is emitted when a resource is added to an informer
// This is used to notify the cluster manager of the new resource so it can dispatch it
// to the frontend runtime and any other service listeners.
type AddResourceEvent[T any] struct {
	// the resource object to add
	Obj T

	// the cluster context this resource is being added to
	ClusterContext string
}

// UpdateResourceEvent is an event that is emitted when a resource is updated in an informer
// This is used to notify the cluster manager of the updated resource so it can dispatch it
// to the frontend runtime and any other service listeners.
type UpdateResourceEvent[T any] struct {
	// the resource object to add
	OldObj T `json:"oldObj"`

	// the resource object to add
	NewObj T `json:"newObj"`

	// the cluster context this resource is being added to
	ClusterContext string
}

// UpdateObject is a comparison object for update events. Due to the requirement of json tags
// needing to be on a struct for serialization, we need to use a struct to represent the update
// rather than just passing the two objects directly.
type UpdateObject[T any] struct {
	// the resource object to update
	OldObj T `json:"oldObj"`

	// the resource object to add
	NewObj T `json:"newObj"`
}

// DeleteResourceEvent is an event that is emitted when a resource is deleted from an informer
// This is used to notify the cluster manager of the deleted resource so it can dispatch it
// to the frontend runtime and any other service listeners.
type DeleteResourceEvent[T any] struct {
	// the resource object to add
	Obj T

	// the cluster context this resource is being added to
	ClusterContext string
}
