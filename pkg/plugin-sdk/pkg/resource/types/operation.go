package types

type OperationType int

const (
	// GetOperation is the operation type for a get operation.
	OperationTypeGet OperationType = iota
	OperationTypeList
	OperationTypeFind
	OperationTypeCreate
	OperationTypeUpdate
	OperationTypeDelete
)

// ========================================== INPUTS ========================================== //

type OperationInput interface {
	GetInput | ListInput | FindInput | CreateInput | UpdateInput | DeleteInput
}

// ResourcerGetInput is the input to the Get operation of a Resourcer.
type GetInput struct {
	// Params is used as an injectable field for any operations that require extra data
	Params map[string]interface{} `json:"params"`

	// ID is the unique identifier of the resource to get.
	ID string `json:"id"`

	// Namespace is an optional identifier to use when a resource backend supports
	// a concept of partitioning resources (like with corev1.Namespace in Kubernetes)
	Namespace string `json:"namespace"`
}

// ResourcerListInput is the input to the List operation of a Resourcer.
type ListInput struct {
	// Params is used as an injectable field for any operations that require extra data
	Params map[string]interface{} `json:"params"`

	// Namespaces is an optional list of namespace identifiers to use when a resource backend
	// supports a concept of partitioning resources (like with corev1.Namespace in Kubernetes).
	//
	// For consisitency, the implemented behavior when this is not specified should be to
	// list all resources in all partitions.
	Namespaces []string `json:"namespaces"`

	// Order is the order parameters for the list operation.
	Order OrderParams `json:"order"`

	// Pagination is the pagination parameters for the list operation.
	Pagination PaginationParams `json:"pagination"`
}

type FindInput struct {
	// Params is used as an injectable field for any operations that require extra data
	Params map[string]interface{} `json:"params"`

	// Conditions is a an object of conditions to filter the list of resources by, specific
	// to the resource backend.
	//
	// Implementations should support a set of common conditions, such as
	// "name", "label", etc.
	Conditions map[string]interface{} `json:"conditions"`

	// Namespaces is an optional list of namespace identifiers to use when a resource backend
	// supports a concept of partitioning resources (like with corev1.Namespace in Kubernetes).
	//
	// For consisitency, the implemented behavior when this is not specified should be to
	// list all resources in all partitions.
	Namespaces []string `json:"namespaces"`

	// Order is the order parameters for the list operation.
	Order OrderParams `json:"order"`

	// Pagination is the pagination parameters for the list operation.
	Pagination PaginationParams `json:"pagination"`
}

type CreateInput struct {
	// Params is used as an injectable field for any operations that require extra data
	Params interface{} `json:"params"`

	// Input is the input to the create operation.
	Input map[string]interface{} `json:"input"`

	// Namespace is an optional identifier to use when a resource backend supports
	// a concept of partitioning resources (like with corev1.Namespace in Kubernetes)
	Namespace string `json:"namespace"`
}

type UpdateInput struct {
	// Options is a set of arbitrary options to the delete operation that must be
	// resolved by the Resourcer.
	Input map[string]interface{} `json:"input"`

	// Params is used as an injectable field for any operations that require extra data
	Params map[string]interface{} `json:"params"`

	// ID is the unique identifier of the resource to update.
	ID string `json:"id"`

	// Namespace is an optional identifier to use when a resource backend supports
	// a concept of partitioning resources (like with corev1.Namespace in Kubernetes)
	Namespace string `json:"namespace"`
}

type DeleteInput struct {
	// Options is a set of arbitrary options to the delete operation that must be
	// resolved by the Resourcer.
	Input map[string]interface{} `json:"input"`

	// Params is used as an injectable field for any operations that require extra data
	Params map[string]interface{} `json:"params"`

	// ID is the unique identifier of the resource to get.
	ID string `json:"id"`

	// Namespace is an optional identifier to use when a resource backend supports
	// a concept of partitioning resources (like with corev1.Namespace in Kubernetes)
	Namespace string `json:"namespace"`
}

// ========================================== RESULTS ========================================== //

type OperationResult interface {
	GetResult | ListResult | FindResult | CreateResult | UpdateResult | DeleteResult
}

type GetResult struct {
	// Result is the result of the operation.
	Result map[string]interface{} `json:"result"`

	// Success is a flag that indicates if the operation was successful.
	Success bool `json:"success"`
}

type ListResult struct {
	// Result is the result of the operation, as a map of resources from the
	// operation by their ID.
	//
	// Due to limitations with method bindings with Wails v2, this needs to
	// be a map of resources by their ID instead of an array.
	Result map[string]interface{} `json:"result"`

	// Success is a flag that indicates if the operation was successful.
	Success bool `json:"success"`

	// Pagination is the pagination result of the list operation.
	Pagination PaginationResult `json:"pagination"`
}

// TODO - we should combine list and find results into a single action
type FindResult struct {
	// Result is the result of the operation, as a map of resources from the
	// operation by their ID.
	//
	// Due to limitations with method bindings with Wails v2, this needs to
	// be a map of resources by their ID instead of an array.
	Result map[string]interface{} `json:"result"`

	// Success is a flag that indicates if the operation was successful.
	Success bool `json:"success"`

	// Pagination is the pagination result of the list operation.
	Pagination PaginationResult `json:"pagination"`
}

type CreateResult struct {
	// Result is the result of the operation.
	Result map[string]interface{} `json:"result"`

	// Success is a flag that indicates if the operation was successful.
	Success bool `json:"success"`
}

type UpdateResult struct {
	// Result is the result of the operation.
	Result map[string]interface{} `json:"result"`

	// Success is a flag that indicates if the operation was successful.
	Success bool `json:"success"`
}

type DeleteResult struct {
	// Result is the result of the operation.
	Result map[string]interface{} `json:"result"`

	// Success is a flag that indicates if the operation was successful.
	Success bool `json:"success"`
}

// ========================================== OPTIONS ========================================== //

type OrderParams struct {
	// OrderBy is a list of fields to order the list of resources by.
	OrderBy string `json:"by"`

	// OrderDirection is the direction to order the list of resources by.
	// true for ascending, false for descending
	OrderDirection bool `json:"direction"`
}

type PaginationParams struct {
	// Page is the page of the list of resources to return.
	Page int `json:"page"`

	// PageSize is the number of resources to return per page.
	// If 0, all resources will be returned.
	PageSize int `json:"pageSize"`
}

type PaginationResult struct {
	PaginationParams

	// Total is the total number of resources in the list.
	Total int `json:"total"`

	// TotalPages is the total number of pages in the list.
	Pages int `json:"pages"`
}
