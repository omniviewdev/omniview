package types

import (
	"context"

	"go.uber.org/zap"
)

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

type IOperation[T any, ClientT any, InputT OperationInput, ResultT OperationResult[T]] interface {
	// ID returns the unique identifier of the operation.
	ID() string
	// GetOperationType returns the type of operation being performed.
	OperationType() OperationType
	// GetContext returns the context of the operation.
	Context() context.Context
	// GetResourceMeta returns the metadata of the resource being operated on.
	ResourceMeta() ResourceMeta
	// GetNamespace returns the namespace of the resource being operated on.
	Namespace() string
	// Client returns the resource client that the operation is being performed with.
	Client() *ClientT
	// Input returns the input to the operation.
	Input() *InputT
	// Result returns the result of the operation.
	Result() *ResultT
	// RecordValidationErrors records a validation error that occurs during the operation.
	RecordValidationErrors(map[string]string)
}

// BaseOperation is a contextual object that defines the operation being performed on a resource,
// that works with a resource of type T.
//
// It is passed through the lifecycle of a resource operation, and is used to provide context
// to the various hooks that are attached to the resource manager..
type Operation[T any, ClientT any, InputT OperationInput, ResultT OperationResult[T]] struct {
	// logger is the logger for the operation.
	logger *zap.SugaredLogger
	// opID is a unique identifier for the operation.
	opID string
	// type is the type of operation being performed.
	operation OperationType
	// Context is the context of the operation. It is used to pass the context of the operation
	ctx context.Context
	// resource is the metadata of the resource being operated on.
	meta ResourceMeta
	// namespace is the resource namespace that the operation is being performed in.
	namespace string
	// client is the resource client that the operation is being performed with.
	client *ClientT
	// input is the input to the operation.
	input *InputT
	// result is the result of the operation.
	result *ResultT
	// validationErrors is a map of validation errors that occur during the operation.
	validationErrors map[string]string
}

func (o *Operation[T, ClientT, InputT, ResultT]) ID() string {
	return o.opID
}

func (o *Operation[T, ClientT, InputT, ResultT]) OperationType() OperationType {
	return o.operation
}

func (o *Operation[T, ClientT, InputT, ResultT]) Context() context.Context {
	return o.ctx
}

func (o *Operation[T, ClientT, InputT, ResultT]) ResourceMeta() ResourceMeta {
	return o.meta
}

func (o *Operation[T, ClientT, InputT, ResultT]) Namespace() string {
	return o.namespace
}

func (o *Operation[T, ClientT, InputT, ResultT]) Client() *ClientT {
	return o.client
}

func (o *Operation[T, ClientT, InputT, ResultT]) Input() *InputT {
	return o.input
}

func (o *Operation[T, ClientT, InputT, ResultT]) Result() *ResultT {
	return o.result
}

func (o *Operation[T, ClientT, InputT, ResultT]) RecordValidationErrors(errors map[string]string) {
	o.validationErrors = errors
}

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

type OperationResult[T any] interface {
	GetResult[T] | ListResult[T] | FindResult[T] | CreateResult[T] | UpdateResult[T] | DeleteResult
}

type BaseResult[T any] struct {
	// Result is the result of the operation.
	Result *T
	// Errors is a list of errors that occurred during the operation.
	Errors []error
	// Success is a flag that indicates if the operation was successful.
	Success bool
}

type GetResult[T any] struct {
	BaseResult[T]
}

type ListResult[T any] struct {
	BaseResult[T]
	// Pagination is the pagination result of the list operation.
	Pagination PaginationResult
}

type FindResult[T any] struct {
	BaseResult[T]
	// Pagination is the pagination result of the find operation.
	Pagination PaginationResult
}

type CreateResult[T any] struct {
	BaseResult[T]
}

type UpdateResult[T any] struct {
	BaseResult[T]
}

type DeleteResult struct {
	// Errors is a list of errors that occurred during the operation.
	Errors []error
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
