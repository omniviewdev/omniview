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
	Params interface{}
	// ID is the unique identifier of the resource to get.
	ID string
	// PartitionID is an option identifier to use when a resource backend
	// requires a partition identifier to be passed with each request, notably
	// when a resource backend has a concept of partitioning resources (like with corev1.Namespace
	// in Kubernetes).
	PartitionID string
}

// ResourcerListInput is the input to the List operation of a Resourcer.
type ListInput struct {
	// Params is used as an injectable field for any operations that require extra data
	Params interface{}
	// PartitionIDs is an optional list of partition identifiers to use when a resource backend
	// requires a partition identifier to be passed with each request, notably
	// when a resource backend has a concept of partitioning resources (like with corev1.Namespace
	// in Kubernetes).
	//
	// For consisitency, the implemented behavior when this is not specified should be to
	// list all resources in all partitions.
	PartitionIDs []string
	// Order is the order parameters for the list operation.
	Order OrderParams
	// Pagination is the pagination parameters for the list operation.
	Pagination PaginationParams
}

type FindInput struct {
	// Params is used as an injectable field for any operations that require extra data
	Params interface{}
	// PartitionIDs is an optional list of partition identifiers to use when a resource backend
	// requires a partition identifier to be passed with each request, notably
	// when a resource backend has a concept of partitioning resources (like with corev1.Namespace
	// in Kubernetes).
	//
	// For consisitency, the implemented behavior when this is not specified should be to
	// list all resources in all partitions.
	PartitionIDs []string
	// Conditions is a list of conditions to filter the list of resources by.
	// TODO - turn this into a conditions builder, will integrate with a parser
	// and a query builder/lexer to build the conditions. For now, it's just a map
	// of a jsonpath selector to a value.
	Conditions map[string]string
	// Order is the order parameters for the list operation.
	Order OrderParams
	// Pagination is the pagination parameters for the list operation.
	Pagination PaginationParams
}

type CreateInput struct {
	// Params is used as an injectable field for any operations that require extra data
	Params interface{}
	// Input is the input to the create operation.
	Input map[string]interface{}
	// PartitionID is an option identifier to use when a resource backend
	// requires a partition identifier to be passed with each request, notably
	// when a resource backend has a concept of partitioning resources (like with corev1.Namespace
	// in Kubernetes).
	PartitionID string
}

type UpdateInput struct {
	// Params are paramaters for the update operation
	Params interface{}
	// Input is the input to the update operation.
	Input map[string]interface{}
	// PartitionID is an option identifier to use when a resource backend
	// requires a partition identifier to be passed with each request, notably
	// when a resource backend has a concept of partitioning resources (like with corev1.Namespace
	// in Kubernetes).
	PartitionID string
	// ID is the unique identifier of the resource to update.
	ID string
}

type DeleteInput struct {
	// Params is used as an injectable field for any operations that require extra data
	Params interface{}
	// Options is a set of arbitrary options to the delete operation that must be
	// resolved by the Resourcer.
	Input map[string]interface{}
	// PartitionID is an option identifier to use when a resource backend
	// requires a partition identifier to be passed with each request, notably
	// when a resource backend has a concept of partitioning resources (like with corev1.Namespace
	// in Kubernetes).
	PartitionID string
	// ID is the unique identifier of the resource to delete.
	ID string
}

// ========================================== RESULTS ========================================== //

type OperationResult interface {
	GetResult | ListResult | FindResult | CreateResult | UpdateResult | DeleteResult
}

type GetResult struct {
	// Result is the result of the operation.
	Result map[string]interface{}
	// Success is a flag that indicates if the operation was successful.
	Success bool
}

type ListResult struct {
	// Result is the result of the operation.
	Result []map[string]interface{}
	// Success is a flag that indicates if the operation was successful.
	Success bool
	// Pagination is the pagination result of the list operation.
	Pagination PaginationResult
}

type FindResult struct {
	// Result is the result of the operation.
	Result []map[string]interface{}
	// Success is a flag that indicates if the operation was successful.
	Success bool
	// Pagination is the pagination result of the list operation.
	Pagination PaginationResult
}

type CreateResult struct {
	// Result is the result of the operation.
	Result map[string]interface{}
	// Success is a flag that indicates if the operation was successful.
	Success bool
}

type UpdateResult struct {
	// Result is the result of the operation.
	Result map[string]interface{}
	// Success is a flag that indicates if the operation was successful.
	Success bool
}

type DeleteResult struct {
	// Result is the result of the operation.
	Result map[string]interface{}
	// Success is a flag that indicates if the operation was successful.
	Success bool
}

// ========================================== OPTIONS ========================================== //

type OrderParams struct {
	// OrderBy is a list of fields to order the list of resources by.
	OrderBy string
	// OrderDirection is the direction to order the list of resources by.
	// true for ascending, false for descending
	OrderDirection bool
}

type PaginationParams struct {
	// Page is the page of the list of resources to return.
	Page int
	// PageSize is the number of resources to return per page.
	// If 0, all resources will be returned.
	PageSize int
}

type PaginationResult struct {
	PaginationParams
	// Total is the total number of resources in the list.
	Total int
	// TotalPages is the total number of pages in the list.
	Pages int
}
