package types

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
	Data      map[string]interface{}
	Key       string
	Context   string
	ID        string
	Namespace string
}

type InformerUpdatePayload struct {
	OldData   map[string]interface{}
	NewData   map[string]interface{}
	Key       string
	Context   string
	ID        string
	Namespace string
}

type InformerDeletePayload struct {
	Data      map[string]interface{}
	Key       string
	Context   string
	ID        string
	Namespace string
}

type InformerPayload interface {
	InformerAddPayload | InformerUpdatePayload | InformerDeletePayload
}
