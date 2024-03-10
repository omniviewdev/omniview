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

type OperationErrorType int

const (
	OperationErrorValidation OperationErrorType = iota
	OperationErrorMutation
	OperationErrorNotFound
	OperationErrorUnknown
)

// ========================================== INPUTS ========================================== //

type OperationInput interface {
	GetInput | ListInput | FindInput | CreateInput | UpdateInput | DeleteInput
}

// ResourcerGetInput is the input to the Get operation of a Resourcer.
type GetInput struct {
	// ID is the unique identifier of the resource to get.
	ID string
}

// ResourcerListInput is the input to the List operation of a Resourcer.
type ListInput struct {
	// Order is the order parameters for the list operation.
	Order OrderParams
	// Pagination is the pagination parameters for the list operation.
	Pagination PaginationParams
}

type FindInput struct {
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
	// Input is the input to the create operation.
	Input interface{}
	// Options is a set of arbitrary options to the create operation that must be
	// resolved by the Resourcer.
	Options interface{}
}

type UpdateInput struct {
	// Input is the input to the update operation.
	Input interface{}
	// Options is a set of arbitrary options to the update operation that must be
	// resolved by the Resourcer.
	Options interface{}
	// ID is the unique identifier of the resource to update.
	ID string
}

type DeleteInput struct {
	// Options is a set of arbitrary options to the delete operation that must be
	// resolved by the Resourcer.
	Options interface{}
	// ID is the unique identifier of the resource to delete.
	ID string
}

// ========================================== RESULTS ========================================== //

type OperationResult interface {
	GetResult | ListResult | FindResult | CreateResult | UpdateResult | DeleteResult
}

func (r *BaseResult) RecordError(err error) {
	if r == nil {
		return
	}

	if err != nil {
		r.Errors = append(r.Errors, err)
		r.Success = false
	}
}

func (r *BaseResult) RecordResult(result interface{}) {
	if r == nil {
		return
	}
	r.Result = result
}

type BaseResult struct {
	// Result is the result of the operation.
	Result interface{}
	// Errors is a list of errors that occurred during the operation.
	Errors []error
	// Success is a flag that indicates if the operation was successful.
	Success bool
}

// create a new base result for out ops.
func newBaseResult() BaseResult {
	return BaseResult{
		Result:  new(interface{}),
		Success: true,
		Errors:  make([]error, 0),
	}
}

type GetResult struct {
	BaseResult
}

func NewGetResult() *GetResult {
	return &GetResult{
		BaseResult: newBaseResult(),
	}
}

type ListResult struct {
	BaseResult
	// Pagination is the pagination result of the list operation.
	Pagination PaginationResult
}

func NewListResult() *ListResult {
	return &ListResult{
		BaseResult: newBaseResult(),
	}
}

type FindResult struct {
	BaseResult
	// Pagination is the pagination result of the find operation.
	Pagination PaginationResult
}

func NewFindResult() *FindResult {
	return &FindResult{
		BaseResult: newBaseResult(),
	}
}

type CreateResult struct {
	BaseResult
}

func NewCreateResult() *CreateResult {
	return &CreateResult{
		BaseResult: newBaseResult(),
	}
}

type UpdateResult struct {
	BaseResult
}

func NewUpdateResult() *UpdateResult {
	return &UpdateResult{
		BaseResult: newBaseResult(),
	}
}

type DeleteResult struct {
	BaseResult
}

func NewDeleteResult() *DeleteResult {
	return &DeleteResult{
		BaseResult: newBaseResult(),
	}
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
