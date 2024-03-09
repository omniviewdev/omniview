package types

import (
	"time"
)

type InformerAction int

const (
	// InformerTypeAdd is used to inform the IDE that a resource has been created.
	InformerActionAdd InformerAction = iota
	// InformerTypeUpdate is used to inform the IDE that a resource has been updated.
	InformerActionUpdate
	// InformerTypeDelete is used to inform the IDE that a resource has been deleted.
	InformerActionDelete
)

type InformerAddPayload struct {
	// A timestamp of when the resource was created. If this is a zero-value time,
	// the time at when the informer message was recieved will be upserted.
	Timestamp time.Time
	// The resource that was created
	Resource interface{}
	// The identifier for the resource
	ID string
}

type InformerUpdatePayload struct {
	// A timestamp of when the resource was created. If this is a zero-value time,
	// the time at when the informer message was recieved will be upserted.
	Timestamp time.Time
	// The updated resource object after modification
	NewResource interface{}
	// The old resource object prior to modification. This is optional,
	// and the IDE will perform a nil check and instead use existing state
	// for the diff calculation.
	OldResource interface{}
	// The identifier for the resource
	ID string
}

type InformerDeletePayload struct {
	// A timestamp of when the resource was created. If this is a zero-value time,
	// the time at when the informer message was recieved will be upserted.
	Timestamp time.Time
	// The identifier for the resource
	ID string
}

type InformerPayload interface {
	InformerAddPayload | InformerUpdatePayload | InformerDeletePayload
}

type InformerMessage[P InformerPayload] struct {
	// The payload for the informer action
	Payload P
	// The resource identifier
	ResourceID string
	// The namespace identifier
	NamespaceID string
	// The type of informer action
	Action InformerAction
}
