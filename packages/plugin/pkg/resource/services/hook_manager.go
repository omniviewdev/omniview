package services

import "github.com/omniviewdev/plugin/pkg/resource/types"

// ============================================= HOOK INDEX ==================================================== //

// keep an index of the registered hooks for the selectors.
type hookIndex[InputT types.OperationInput, ResultT types.OperationResult] struct {
	preMutatation   map[string][]types.PreHook[InputT]
	preValidation   map[string][]types.PreHook[InputT]
	beforeOperation map[string][]types.PreHook[InputT]
	afterOperation  map[string][]types.PostHook[ResultT]
	postValidation  map[string][]types.PostHook[ResultT]
	postMutation    map[string][]types.PostHook[ResultT]
}

type Hooks[InputT types.OperationInput, ResultT types.OperationResult] struct {
	PreMutatation   []types.PreHook[InputT]
	PreValidation   []types.PreHook[InputT]
	BeforeOperation []types.PreHook[InputT]
	AfterOperation  []types.PostHook[ResultT]
	PostValidation  []types.PostHook[ResultT]
	PostMutation    []types.PostHook[ResultT]
}

func (h *hookIndex[InputT, ResultT]) registerPreHook(hook types.PreHook[InputT], selector string) {
	switch hook.HookType {
	case types.PreMutatation:
		h.preMutatation[selector] = append(h.preMutatation[selector], hook)
	case types.PreValidation:
		h.preValidation[selector] = append(h.preValidation[selector], hook)
	case types.BeforeOperation:
		h.beforeOperation[selector] = append(h.beforeOperation[selector], hook)
	}
}

func (h *hookIndex[InputT, ResultT]) registerPostHook(
	hook types.PostHook[ResultT],
	selector string,
) {
	switch hook.HookType {
	case types.AfterOperation:
		h.afterOperation[selector] = append(h.afterOperation[selector], hook)
	case types.PostValidation:
		h.postValidation[selector] = append(h.postValidation[selector], hook)
	case types.PostMutation:
		h.postMutation[selector] = append(h.postMutation[selector], hook)
	}
}

func (h *hookIndex[InputT, ResultT]) getPreHooks(
	selector string,
	preHookType types.PreHookType,
) []types.PreHook[InputT] {
	switch preHookType {
	case types.PreMutatation:
		return h.preMutatation[selector]
	case types.PreValidation:
		return h.preValidation[selector]
	case types.BeforeOperation:
		return h.beforeOperation[selector]
	}
	return nil
}

func (h *hookIndex[InputT, ResultT]) getPostHooks(
	selector string,
	postHookType types.PostHookType,
) []types.PostHook[ResultT] {
	switch postHookType {
	case types.AfterOperation:
		return h.afterOperation[selector]
	case types.PostValidation:
		return h.postValidation[selector]
	case types.PostMutation:
		return h.postMutation[selector]
	}
	return nil
}

func (h *hookIndex[InputT, ResultT]) getAllSelectorHooks(selector string) Hooks[InputT, ResultT] {
	return Hooks[InputT, ResultT]{
		PreMutatation:   h.getPreHooks(selector, types.PreMutatation),
		PreValidation:   h.getPreHooks(selector, types.PreValidation),
		BeforeOperation: h.getPreHooks(selector, types.BeforeOperation),
		AfterOperation:  h.getPostHooks(selector, types.AfterOperation),
		PostValidation:  h.getPostHooks(selector, types.PostValidation),
		PostMutation:    h.getPostHooks(selector, types.PostMutation),
	}
}

func newHookIndex[
	InputT types.OperationInput,
	ResultT types.OperationResult,
]() hookIndex[InputT, ResultT] {
	return hookIndex[InputT, ResultT]{
		preMutatation:   make(map[string][]types.PreHook[InputT]),
		preValidation:   make(map[string][]types.PreHook[InputT]),
		beforeOperation: make(map[string][]types.PreHook[InputT]),
		afterOperation:  make(map[string][]types.PostHook[ResultT]),
		postValidation:  make(map[string][]types.PostHook[ResultT]),
		postMutation:    make(map[string][]types.PostHook[ResultT]),
	}
}

// ============================================= HOOK MANAGER ==================================================== //

// ResourceHookManager allows for hooking into various components of a resourcer's
// lifecycle. This can be used to extend the functionality of a resourcer, such as:
//
// - Validating input before it is sent to the backend
// - Mutating the input before it is sent to the backend
// - Enriching the output before being sent back to the caller
// - Logging the input and output of operations
// - Tracing the input and output of operations
//
// The ResourceHookManager is a component of the resource manager, and is responsible
// for attaching the necessary hooks to the query object that is passed through the resource
// lifecycle.
//
// Resource hooks are executed in the order they are added to the manager, and in the
// following order for each operation:
//
// - PreMutatation
// - PreValidation
// - BeforeOperation
// - <Resource Operation>
// - AfterOperation
// - PostValidation
// - PostMutation
//
// Each of these hooks is optional, and can be added to the manager as needed. Hooks can be
// defined for a specific operation, or for all operations, and can be defined for one or more
// resource types, and optionally using a selector to define when to run.
type resourceHookManager struct {
	// keep an index of the registered hooks for the get operations
	getIndex hookIndex[types.GetInput, types.GetResult]
	// keep an index of the registered hooks for the list operations
	listIndex hookIndex[types.ListInput, types.ListResult]
	// keep an index of the registered hooks for the find operations
	findIndex hookIndex[types.FindInput, types.FindResult]
	// keep an index of the registered hooks for the create operations
	createIndex hookIndex[types.CreateInput, types.CreateResult]
	// keep an index of the registered hooks for the update operations
	updateIndex hookIndex[types.UpdateInput, types.UpdateResult]
	// keep an index of the registered hooks for the delete operations
	deleteIndex hookIndex[types.DeleteInput, types.DeleteResult]
}

type HookManager interface {
	// GetHooksForGet returns all the hooks for the get operation for the given selector.
	GetHooksForGet(selector string) Hooks[types.GetInput, types.GetResult]
	// GetHooksForList returns all the hooks for the list operation for the given selector.
	GetHooksForList(selector string) Hooks[types.ListInput, types.ListResult]
	// GetHooksForFind returns all the hooks for the find operation for the given selector.
	GetHooksForFind(selector string) Hooks[types.FindInput, types.FindResult]
	// GetHooksForCreate returns all the hooks for the create operation for the given selector.
	GetHooksForCreate(selector string) Hooks[types.CreateInput, types.CreateResult]
	// GetHooksForUpdate returns all the hooks for the update operation for the given selector.
	GetHooksForUpdate(selector string) Hooks[types.UpdateInput, types.UpdateResult]
	// GetHooksForDelete returns all the hooks for the delete operation for the given selector.
	GetHooksForDelete(selector string) Hooks[types.DeleteInput, types.DeleteResult]
	// RegisterPreGetHook registers a pre-get hook for the given selector.
	RegisterPreGetHook(hook types.PreHook[types.GetInput])
	// RegisterPostGetHook registers a post-get hook for the given selector.
	RegisterPostGetHook(hook types.PostHook[types.GetResult])
	// RegisterPreListHook registers a pre-list hook for the given selector.
	RegisterPreListHook(hook types.PreHook[types.ListInput])
	// RegisterPostListHook registers a post-list hook for the given selector.
	RegisterPostListHook(hook types.PostHook[types.ListResult])
	// RegisterPreFindHook registers a pre-find hook for the given selector.
	RegisterPreFindHook(hook types.PreHook[types.FindInput])
	// RegisterPostFindHook registers a post-find hook for the given selector.
	RegisterPostFindHook(hook types.PostHook[types.FindResult])
	// RegisterPreCreateHook registers a pre-create hook for the given selector.
	RegisterPreCreateHook(hook types.PreHook[types.CreateInput])
	// RegisterPostCreateHook registers a post-create hook for the given selector.
	RegisterPostCreateHook(hook types.PostHook[types.CreateResult])
	// RegisterPreUpdateHook registers a pre-update hook for the given selector.
	RegisterPreUpdateHook(hook types.PreHook[types.UpdateInput])
	// RegisterPostUpdateHook registers a post-update hook for the given selector.
	RegisterPostUpdateHook(hook types.PostHook[types.UpdateResult])
	// RegisterPreDeleteHook registers a pre-delete hook for the given selector.
	RegisterPreDeleteHook(hook types.PreHook[types.DeleteInput])
	// RegisterPostDeleteHook registers a post-delete hook for the given selector.
	RegisterPostDeleteHook(hook types.PostHook[types.DeleteResult])
}

// Registers a new hook manager for managing global hooks.
func NewHookManager() HookManager {
	return &resourceHookManager{
		getIndex:    newHookIndex[types.GetInput, types.GetResult](),
		listIndex:   newHookIndex[types.ListInput, types.ListResult](),
		findIndex:   newHookIndex[types.FindInput, types.FindResult](),
		createIndex: newHookIndex[types.CreateInput, types.CreateResult](),
		updateIndex: newHookIndex[types.UpdateInput, types.UpdateResult](),
		deleteIndex: newHookIndex[types.DeleteInput, types.DeleteResult](),
	}
}

func (r *resourceHookManager) GetHooksForGet(
	selector string,
) Hooks[types.GetInput, types.GetResult] {
	return r.getIndex.getAllSelectorHooks(selector)
}

func (r *resourceHookManager) GetHooksForList(
	selector string,
) Hooks[types.ListInput, types.ListResult] {
	return r.listIndex.getAllSelectorHooks(selector)
}

func (r *resourceHookManager) GetHooksForFind(
	selector string,
) Hooks[types.FindInput, types.FindResult] {
	return r.findIndex.getAllSelectorHooks(selector)
}

func (r *resourceHookManager) GetHooksForCreate(
	selector string,
) Hooks[types.CreateInput, types.CreateResult] {
	return r.createIndex.getAllSelectorHooks(selector)
}

func (r *resourceHookManager) GetHooksForUpdate(
	selector string,
) Hooks[types.UpdateInput, types.UpdateResult] {
	return r.updateIndex.getAllSelectorHooks(selector)
}

func (r *resourceHookManager) GetHooksForDelete(
	selector string,
) Hooks[types.DeleteInput, types.DeleteResult] {
	return r.deleteIndex.getAllSelectorHooks(selector)
}

// ======================================= HOOK REGISTRATION ========================================= //

// RegisterPreGetHook registers a pre-get hook for the given selector.
func (r *resourceHookManager) RegisterPreGetHook(hook types.PreHook[types.GetInput]) {
	for _, selector := range hook.Selectors {
		r.getIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostGetHook registers a post-get hook for the given selector.
func (r *resourceHookManager) RegisterPostGetHook(hook types.PostHook[types.GetResult]) {
	for _, selector := range hook.Selectors {
		r.getIndex.registerPostHook(hook, selector)
	}
}

// RegisterPreListHook registers a pre-list hook for the given selector.
func (r *resourceHookManager) RegisterPreListHook(hook types.PreHook[types.ListInput]) {
	for _, selector := range hook.Selectors {
		r.listIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostListHook registers a post-list hook for the given selector.
func (r *resourceHookManager) RegisterPostListHook(hook types.PostHook[types.ListResult]) {
	for _, selector := range hook.Selectors {
		r.listIndex.registerPostHook(hook, selector)
	}
}

// RegisterPreFindHook registers a pre-find hook for the given selector.
func (r *resourceHookManager) RegisterPreFindHook(hook types.PreHook[types.FindInput]) {
	for _, selector := range hook.Selectors {
		r.findIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostFindHook registers a post-find hook for the given selector.
func (r *resourceHookManager) RegisterPostFindHook(hook types.PostHook[types.FindResult]) {
	for _, selector := range hook.Selectors {
		r.findIndex.registerPostHook(hook, selector)
	}
}

// RegisterPreCreateHook registers a pre-create hook for the given selector.
func (r *resourceHookManager) RegisterPreCreateHook(hook types.PreHook[types.CreateInput]) {
	for _, selector := range hook.Selectors {
		r.createIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostCreateHook registers a post-create hook for the given selector.
func (r *resourceHookManager) RegisterPostCreateHook(hook types.PostHook[types.CreateResult]) {
	for _, selector := range hook.Selectors {
		r.createIndex.registerPostHook(hook, selector)
	}
}

// RegisterPreUpdateHook registers a pre-update hook for the given selector.
func (r *resourceHookManager) RegisterPreUpdateHook(hook types.PreHook[types.UpdateInput]) {
	for _, selector := range hook.Selectors {
		r.updateIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostUpdateHook registers a post-update hook for the given selector.
func (r *resourceHookManager) RegisterPostUpdateHook(hook types.PostHook[types.UpdateResult]) {
	for _, selector := range hook.Selectors {
		r.updateIndex.registerPostHook(hook, selector)
	}
}

// RegisterPreDeleteHook registers a pre-delete hook for the given selector.
func (r *resourceHookManager) RegisterPreDeleteHook(hook types.PreHook[types.DeleteInput]) {
	for _, selector := range hook.Selectors {
		r.deleteIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostDeleteHook registers a post-delete hook for the given selector.
func (r *resourceHookManager) RegisterPostDeleteHook(hook types.PostHook[types.DeleteResult]) {
	for _, selector := range hook.Selectors {
		r.deleteIndex.registerPostHook(hook, selector)
	}
}
