package types

// PreHookType defines a hook that runs on input lifecycle events of a resource operation.
type PreHookType int

const (
	// PreMutatation runs a mutation on the input before it is sent to the backend. It runs
	// as the first hook in the lifecycle.
	PreMutatation PreHookType = iota
	// PreValidation runs a validation on the input before it is sent to the backend. It runs
	// after the PreMutation hook, and before the BeforeOperation hook.
	PreValidation
	// BeforeOperation runs before the operation is sent to the backend. It runs after the
	// PreMutation and PreValidation hooks.
	BeforeOperation
)

// PostHookType defines a hook that runs on output lifecycle events of a resource operation.
type PostHookType int

const (
	// AfterOperation runs after the operation is sent to the backend. It runs after the
	// operation is sent to the backend, and before the PostValidation and PostMutation hooks.
	AfterOperation PostHookType = iota
	// PostValidation runs a validation on the output after it is sent back from the backend.
	// It runs after the AfterOperation hook, and before the PostMutation hook.
	PostValidation
	// PostMutation runs a mutation on the output after it is sent back from the backend. It runs
	// as the last hook in the lifecycle.
	PostMutation
)

// PreHookFunc is a function that runs on input lifecycle events of a resource operation, and
// is provided an interface representing a pointer to the input of the operation.
type PreHookFunc[I OperationInput] func(*I) error

// PostHookFunc is a function that runs on output lifecycle events of a resource operation, and
// is provided an interface representing a pointer to the output of the operation.
type PostHookFunc[I OperationResult] func(*I) error

// PreHook is a hook that runs on input lifecycle events of a resource operation.
type PreHook[I OperationInput] struct {
	// Execute is the function that should be run when the hook is executed. The input to the
	// function will always be an interface representing a pointer to the input of the operation.
	Execute PreHookFunc[I]

	// ID is the unique identifier of the operation.
	ID string

	// Owner represents the resource type that the hook is associated with. This will be the name
	// of the plugin that registered the hook.
	Owner string

	// Selectors is a list of resource selectors that should define for which resources a hook
	// should run. Selectors should be defined in the following format:
	// <resource-type>.<resource-name>.<resource-namespace>
	//
	// While wildcard selectors were considered, they were not implemented due to the potential
	// for abuse and the requirements of needed to use reflectors
	Selectors []string

	// HookType is the type of hook that this is.
	HookType PreHookType
}

// PostHook is a hook that runs on output lifecycle events of a resource operation.
type PostHook[R OperationResult] struct {
	// Execute is the function that should be run when the hook is executed. The input to the
	// function will always be an interface representing a pointer to the output of the operation.
	Execute PostHookFunc[R]

	// ID is the unique identifier of the operation.
	ID string

	// Owner represents the resource type that the hook is associated with. This will be the name
	// of the plugin that registered the hook.
	Owner string

	// Selectors is a list of resource selectors that should define for which resources a hook
	// should run. Selectors should be defined in the following format:
	// <resource-type>.<resource-name>.<resource-namespace>
	Selectors []string

	// HookType is the type of hook that this is.
	HookType PostHookType
}
