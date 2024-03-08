package services

import "github.com/infraview/plugin/pkg/resource/types"

// ============================================= HOOK INDEX ==================================================== //

// keep an index of the registered hooks for the selectors.
type hookIndex[InputT types.OperationInput, ResultT types.OperationResult[any]] struct {
	preMutatation   map[string][]types.PreHook[InputT, any]
	preValidation   map[string][]types.PreHook[InputT, any]
	beforeOperation map[string][]types.PreHook[InputT, any]
	afterOperation  map[string][]types.PostHook[ResultT, any]
	postValidation  map[string][]types.PostHook[ResultT, any]
	postMutation    map[string][]types.PostHook[ResultT, any]
}

type Hooks[InputT types.OperationInput, ResultT types.OperationResult[any]] struct {
	PreMutatation   []types.PreHook[InputT, any]
	PreValidation   []types.PreHook[InputT, any]
	BeforeOperation []types.PreHook[InputT, any]
	AfterOperation  []types.PostHook[ResultT, any]
	PostValidation  []types.PostHook[ResultT, any]
	PostMutation    []types.PostHook[ResultT, any]
}

func (h *hookIndex[InputT, ResultT]) registerPreHook(hook types.PreHook[InputT, any], selector string) {
	switch hook.HookType {
	case types.PreMutatation:
		h.preMutatation[selector] = append(h.preMutatation[selector], hook)
	case types.PreValidation:
		h.preValidation[selector] = append(h.preValidation[selector], hook)
	case types.BeforeOperation:
		h.beforeOperation[selector] = append(h.beforeOperation[selector], hook)
	}
}

func (h *hookIndex[InputT, ResultT]) registerPostHook(hook types.PostHook[ResultT, any], selector string) {
	switch hook.HookType {
	case types.AfterOperation:
		h.afterOperation[selector] = append(h.afterOperation[selector], hook)
	case types.PostValidation:
		h.postValidation[selector] = append(h.postValidation[selector], hook)
	case types.PostMutation:
		h.postMutation[selector] = append(h.postMutation[selector], hook)
	}
}

func (h *hookIndex[InputT, ResultT]) getPreHooks(selector string, preHookType types.PreHookType) []types.PreHook[InputT, any] {
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

func (h *hookIndex[InputT, ResultT]) getPostHooks(selector string, postHookType types.PostHookType) []types.PostHook[ResultT, any] {
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

func NewHookIndex[InputT types.OperationInput, ResultT types.OperationResult[any]]() hookIndex[InputT, ResultT] {
	return hookIndex[InputT, ResultT]{
		preMutatation:   make(map[string][]types.PreHook[InputT, any]),
		preValidation:   make(map[string][]types.PreHook[InputT, any]),
		beforeOperation: make(map[string][]types.PreHook[InputT, any]),
		afterOperation:  make(map[string][]types.PostHook[ResultT, any]),
		postValidation:  make(map[string][]types.PostHook[ResultT, any]),
		postMutation:    make(map[string][]types.PostHook[ResultT, any]),
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
type ResourceHookManager struct {
	// keep an index of the registered hooks for the get operations
	getIndex hookIndex[types.GetInput, types.GetResult[any]]
	// keep an index of the registered hooks for the list operations
	listIndex hookIndex[types.ListInput, types.ListResult[any]]
	// keep an index of the registered hooks for the find operations
	findIndex hookIndex[types.FindInput, types.FindResult[any]]
	// keep an index of the registered hooks for the create operations
	createIndex hookIndex[types.CreateInput, types.CreateResult[any]]
	// keep an index of the registered hooks for the update operations
	updateIndex hookIndex[types.UpdateInput, types.UpdateResult[any]]
	// keep an index of the registered hooks for the delete operations
	deleteIndex hookIndex[types.DeleteInput, types.DeleteResult]
}

// Registers a new hook manager for managing global hooks.
func NewResourceHookManager() *ResourceHookManager {
	return &ResourceHookManager{
		getIndex:    NewHookIndex[types.GetInput, types.GetResult[any]](),
		listIndex:   NewHookIndex[types.ListInput, types.ListResult[any]](),
		findIndex:   NewHookIndex[types.FindInput, types.FindResult[any]](),
		createIndex: NewHookIndex[types.CreateInput, types.CreateResult[any]](),
		updateIndex: NewHookIndex[types.UpdateInput, types.UpdateResult[any]](),
		deleteIndex: NewHookIndex[types.DeleteInput, types.DeleteResult](),
	}
}

func (r *ResourceHookManager) GetHooksForGet(selector string) Hooks[types.GetInput, types.GetResult[any]] {
	return r.getIndex.getAllSelectorHooks(selector)
}

func (r *ResourceHookManager) GetHooksForList(selector string) Hooks[types.ListInput, types.ListResult[any]] {
	return r.listIndex.getAllSelectorHooks(selector)
}

func (r *ResourceHookManager) GetHooksForFind(selector string) Hooks[types.FindInput, types.FindResult[any]] {
	return r.findIndex.getAllSelectorHooks(selector)
}

func (r *ResourceHookManager) GetHooksForCreate(selector string) Hooks[types.CreateInput, types.CreateResult[any]] {
	return r.createIndex.getAllSelectorHooks(selector)
}

func (r *ResourceHookManager) GetHooksForUpdate(selector string) Hooks[types.UpdateInput, types.UpdateResult[any]] {
	return r.updateIndex.getAllSelectorHooks(selector)
}

func (r *ResourceHookManager) GetHooksForDelete(selector string) Hooks[types.DeleteInput, types.DeleteResult] {
	return r.deleteIndex.getAllSelectorHooks(selector)
}

// ============================================= HOOK REGISTRATION ==================================================== //

// RegisterPreGetHook registers a pre-get hook for the given selector.
func (r *ResourceHookManager) RegisterPreGetHook(hook types.PreHook[types.GetInput, any]) {
	for _, selector := range hook.Selectors {
		r.getIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostGetHook registers a post-get hook for the given selector.
func (r *ResourceHookManager) RegisterPostGetHook(hook types.PostHook[types.GetResult[any], any]) {
	for _, selector := range hook.Selectors {
		r.getIndex.registerPostHook(hook, selector)
	}
}

// RegisterPreListHook registers a pre-list hook for the given selector.
func (r *ResourceHookManager) RegisterPreListHook(hook types.PreHook[types.ListInput, any]) {
	for _, selector := range hook.Selectors {
		r.listIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostListHook registers a post-list hook for the given selector.
func (r *ResourceHookManager) RegisterPostListHook(hook types.PostHook[types.ListResult[any], any]) {
	for _, selector := range hook.Selectors {
		r.listIndex.registerPostHook(hook, selector)
	}
}

// RegisterPreFindHook registers a pre-find hook for the given selector.
func (r *ResourceHookManager) RegisterPreFindHook(hook types.PreHook[types.FindInput, any]) {
	for _, selector := range hook.Selectors {
		r.findIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostFindHook registers a post-find hook for the given selector.
func (r *ResourceHookManager) RegisterPostFindHook(hook types.PostHook[types.FindResult[any], any]) {
	for _, selector := range hook.Selectors {
		r.findIndex.registerPostHook(hook, selector)
	}
}

// RegisterPreCreateHook registers a pre-create hook for the given selector.
func (r *ResourceHookManager) RegisterPreCreateHook(hook types.PreHook[types.CreateInput, any]) {
	for _, selector := range hook.Selectors {
		r.createIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostCreateHook registers a post-create hook for the given selector.
func (r *ResourceHookManager) RegisterPostCreateHook(hook types.PostHook[types.CreateResult[any], any]) {
	for _, selector := range hook.Selectors {
		r.createIndex.registerPostHook(hook, selector)
	}
}

// RegisterPreUpdateHook registers a pre-update hook for the given selector.
func (r *ResourceHookManager) RegisterPreUpdateHook(hook types.PreHook[types.UpdateInput, any]) {
	for _, selector := range hook.Selectors {
		r.updateIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostUpdateHook registers a post-update hook for the given selector.
func (r *ResourceHookManager) RegisterPostUpdateHook(hook types.PostHook[types.UpdateResult[any], any]) {
	for _, selector := range hook.Selectors {
		r.updateIndex.registerPostHook(hook, selector)
	}
}

// RegisterPreDeleteHook registers a pre-delete hook for the given selector.
func (r *ResourceHookManager) RegisterPreDeleteHook(hook types.PreHook[types.DeleteInput, any]) {
	for _, selector := range hook.Selectors {
		r.deleteIndex.registerPreHook(hook, selector)
	}
}

// RegisterPostDeleteHook registers a post-delete hook for the given selector.
func (r *ResourceHookManager) RegisterPostDeleteHook(hook types.PostHook[types.DeleteResult, any]) {
	for _, selector := range hook.Selectors {
		r.deleteIndex.registerPostHook(hook, selector)
	}
}
