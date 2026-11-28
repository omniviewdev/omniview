package plugin

import (
	"bytes"
	"maps"
	"slices"
	"unicode/utf8"

	"github.com/tdewolff/parse/v2"
	"github.com/tdewolff/parse/v2/js"
)

const (
	defaultExportName     = "default"
	initializerDepthLimit = 128
	moduleWalkDepthLimit  = 512
)

// Preflight the fixed Rollup System.register envelope. Do not instantiate SystemJS
// or execute the registration function, its setters, execute, or an export. This
// recognizes the packager's module boundary; it is not a sandbox for plugin code.
func extensionModuleExports(data []byte, views bool) ([]string, bool) {
	if len(data) == 0 || len(data) > extensionModuleLimit || !utf8.Valid(data) {
		return nil, false
	}
	ast, err := js.Parse(parse.NewInputBytes(data), js.Options{WhileToFor: false, Inline: false})
	if err != nil {
		return nil, false
	}
	top := systemRegisterCall(ast.List)
	if top == nil {
		return nil, false
	}
	deps, ok := top.Args.List[0].Value.(*js.ArrayExpr)
	if !ok || !extensionDependencies(deps, views) {
		return nil, false
	}
	factory, ok := ungroup(top.Args.List[1].Value).(*js.FuncDecl)
	if !ok || factory.Name != nil || factory.Async || factory.Generator || len(factory.Params.List) != 1 ||
		factory.Params.Rest != nil || factory.Params.List[0].Default != nil || len(factory.Body.List) == 0 {
		return nil, false
	}
	exporter, ok := factory.Params.List[0].Binding.(*js.Var)
	if !ok {
		return nil, false
	}
	execute, ok := extensionExecute(factory.Body.List[len(factory.Body.List)-1], len(deps.List))
	if !ok {
		return nil, false
	}
	audit := moduleAudit{
		exporter: exporter, views: views, valid: true, publisherUses: 0, depth: 0,
		functions: make(map[*js.Var]bool), calls: 0, exports: make(map[string]struct{}),
	}
	audit.topLevel(factory.Body.List[:len(factory.Body.List)-1])
	audit.topLevel(execute.Body.List)
	if !audit.valid || len(audit.exports) == 0 {
		return nil, false
	}
	// Walk the factory body, excluding its parameter declaration. Every use of
	// the real publisher must be the direct callee of a checked top-level call.
	js.Walk(&audit, &factory.Body)
	if !audit.valid || audit.publisherUses != audit.calls {
		return nil, false
	}
	return slices.Sorted(maps.Keys(audit.exports)), true
}

// Only comments may accompany the single two-argument System.register call.
func systemRegisterCall(statements []js.IStmt) *js.CallExpr {
	var top *js.CallExpr
	for _, stmt := range statements {
		if _, comment := stmt.(*js.Comment); comment {
			continue
		}
		expr, ok := stmt.(*js.ExprStmt)
		if !ok || top != nil {
			return nil
		}
		if top, ok = ungroup(expr.Value).(*js.CallExpr); !ok {
			return nil
		}
	}
	if top == nil || top.Optional || len(top.Args.List) != 2 || top.Args.List[0].Rest || top.Args.List[1].Rest {
		return nil
	}
	member, ok := top.X.(*js.DotExpr)
	if !ok || member.Optional || member.Y.String() != "register" {
		return nil
	}
	system, ok := member.X.(*js.Var)
	if !ok || string(system.Name()) != "System" {
		return nil
	}
	return top
}

func ungroup(e js.IExpr) js.IExpr {
	for {
		group, ok := e.(*js.GroupExpr)
		if !ok {
			return e
		}
		e = group.X
	}
}

func bindingOf(v *js.Var) *js.Var {
	for v != nil && v.Link != nil {
		v = v.Link
	}
	return v
}

// Generated paths and export names are literal ASCII, never escape sequences or
// computed properties. For unquoted object keys, Rollup can also use a number.
func moduleKey(lit js.LiteralExpr, quoted bool) string {
	if lit.TokenType == js.StringToken && len(lit.Data) >= 2 && bytes.IndexByte(lit.Data, '\\') == -1 {
		return string(lit.Data[1 : len(lit.Data)-1])
	}
	if !quoted && (js.IsIdentifierName(lit.TokenType) || js.IsNumeric(lit.TokenType)) {
		return string(lit.Data)
	}
	return ""
}

func extensionDependencies(deps *js.ArrayExpr, views bool) bool {
	if !views {
		return len(deps.List) == 0
	}
	var mask uint8
	for _, d := range deps.List {
		lit, ok := d.Value.(*js.LiteralExpr)
		if !ok || d.Spread {
			return false
		}
		var bit uint8
		switch moduleKey(*lit, true) {
		case "react":
			bit = 1
		case "react/jsx-runtime":
			bit = 2
		case "react/compiler-runtime":
			bit = 4
		case "@omniviewdev/kit":
			bit = 8
		default:
			return false
		}
		if mask&bit != 0 {
			return false
		}
		mask |= bit
	}
	return true
}

func extensionExecute(last js.IStmt, dependencies int) (*js.FuncDecl, bool) {
	ret, ok := last.(*js.ReturnStmt)
	if !ok {
		return nil, false
	}
	obj, ok := ungroup(ret.Value).(*js.ObjectExpr)
	if !ok {
		return nil, false
	}
	var execute *js.FuncDecl
	setters := false
	for _, p := range obj.List {
		if p.Name == nil || p.Name.Computed != nil || p.Spread || p.Init != nil {
			return nil, false
		}
		switch moduleKey(p.Name.Literal, false) {
		case "execute":
			f, isFunction := ungroup(p.Value).(*js.FuncDecl)
			if !isFunction || execute != nil || f.Name != nil || f.Async || f.Generator || len(f.Params.List) != 0 || f.Params.Rest != nil {
				return nil, false
			}
			execute = f
		case "setters":
			if setters || !extensionSetters(p.Value, dependencies) {
				return nil, false
			}
			setters = true
		default:
			return nil, false
		}
	}
	return execute, execute != nil && (dependencies == 0 || setters)
}

func extensionSetters(value js.IExpr, dependencies int) bool {
	arr, ok := value.(*js.ArrayExpr)
	if !ok || len(arr.List) != dependencies {
		return false
	}
	for _, entry := range arr.List {
		f, isFunction := ungroup(entry.Value).(*js.FuncDecl)
		if !isFunction || entry.Spread || !extensionSetter(f) {
			return false
		}
	}
	return true
}

// Rollup setters copy named imports (or an entire namespace) into factory
// locals. They must not call code or register anything while linking.
func extensionSetter(f *js.FuncDecl) bool {
	if f.Name != nil || f.Async || f.Generator || f.Params.Rest != nil || len(f.Params.List) > 1 {
		return false
	}
	if len(f.Params.List) == 0 {
		return len(f.Body.List) == 0
	}
	param, isVar := f.Params.List[0].Binding.(*js.Var)
	if !isVar || f.Params.List[0].Default != nil {
		return false
	}
	for _, stmt := range f.Body.List {
		expr, ok := stmt.(*js.ExprStmt)
		if !ok {
			return false
		}
		assign, ok := ungroup(expr.Value).(*js.BinaryExpr)
		if !ok || assign.Op != js.EqToken {
			return false
		}
		target, ok := assign.X.(*js.Var)
		if !ok || bindingOf(target).Decl != js.VariableDecl {
			return false
		}
		value := assign.Y
		if member, isMember := value.(*js.DotExpr); isMember && !member.Optional {
			value = member.X
		}
		source, ok := value.(*js.Var)
		if !ok || bindingOf(source) != bindingOf(param) {
			return false
		}
	}
	return true
}

// Only declarative initializers are recognized before demand. Do not try to
// infer whether an arbitrary initializer is pure or execute it to find out.
func declarativeInit(expr js.IExpr, depth int) bool {
	if depth >= initializerDepthLimit {
		return false
	}
	switch e := ungroup(expr).(type) {
	case nil, *js.FuncDecl, *js.ArrowFunc, *js.LiteralExpr, *js.Var:
		return true
	case *js.UnaryExpr:
		return declarativeUnary(e.Op) && declarativeInit(e.X, depth+1)
	case *js.ArrayExpr:
		for _, item := range e.List {
			if item.Spread || !declarativeInit(item.Value, depth+1) {
				return false
			}
		}
		return true
	case *js.ObjectExpr:
		for _, p := range e.List {
			if p.Name == nil || p.Name.Computed != nil || p.Spread || p.Init != nil || !declarativeInit(p.Value, depth+1) {
				return false
			}
		}
		return true
	}
	return false
}

func declarativeUnary(op js.TokenType) bool {
	return op == js.PosToken || op == js.NegToken || op == js.NotToken ||
		op == js.BitNotToken || op == js.VoidToken || op == js.TypeofToken
}

type moduleAudit struct {
	exporter      *js.Var
	views         bool
	valid         bool
	publisherUses int
	depth         int
	functions     map[*js.Var]bool
	calls         int
	exports       map[string]struct{}
}

func (a *moduleAudit) function(e js.IExpr) bool {
	switch f := ungroup(e).(type) {
	case *js.FuncDecl:
		return !f.Generator && (!a.views || !f.Async)
	case *js.ArrowFunc:
		return !a.views || !f.Async
	case *js.Var:
		return a.functions[bindingOf(f)]
	}
	return false
}

func (a *moduleAudit) exportCall(e js.IExpr) *js.CallExpr {
	call, ok := ungroup(e).(*js.CallExpr)
	if !ok || call.Optional {
		return nil
	}
	v, ok := call.X.(*js.Var)
	if !ok || bindingOf(v) != a.exporter {
		return nil
	}
	a.calls++
	if !a.addExports(call) {
		a.valid = false
	}
	return call
}

func (a *moduleAudit) topLevel(statements []js.IStmt) {
	// Function declarations are hoisted. Constants and their aliases are
	// callable only after their initializer, not merely anywhere in this AST.
	for _, stmt := range statements {
		if f, ok := stmt.(*js.FuncDecl); ok {
			a.functions[bindingOf(f.Name)] = a.function(f)
		}
	}
	for _, stmt := range statements {
		switch s := stmt.(type) {
		case *js.VarDecl:
			a.variableDecl(s)
		case *js.ExprStmt:
			if a.exportCall(s.Value) == nil {
				a.valid = false // no top-level registration, invocation or loader
			}
		case *js.FuncDecl, *js.DirectivePrologueStmt, *js.Comment, *js.EmptyStmt:
		default:
			a.valid = false // publication must not depend on control flow
		}
	}
}

func (a *moduleAudit) variableDecl(s *js.VarDecl) {
	for _, decl := range s.List {
		e := decl.Default
		if call := a.exportCall(e); call != nil && len(call.Args.List) == 2 {
			e = call.Args.List[1].Value
		}
		v, ok := decl.Binding.(*js.Var)
		if !ok || !declarativeInit(e, 0) {
			a.valid = false
		}
		if ok && s.TokenType == js.ConstToken && a.function(e) {
			a.functions[bindingOf(v)] = true
		}
	}
}

func (a *moduleAudit) add(name string, value js.IExpr) bool {
	if !extensionSegment(name) || name == defaultExportName || len(a.exports) >= extensionListLimit || !a.function(value) {
		return false
	}
	if _, exists := a.exports[name]; exists {
		return false
	}
	a.exports[name] = struct{}{}
	return true
}

func (a *moduleAudit) addExports(call *js.CallExpr) bool {
	args := call.Args.List
	if len(args) == 2 && !args[0].Rest && !args[1].Rest {
		lit, ok := args[0].Value.(*js.LiteralExpr)
		return ok && a.add(moduleKey(*lit, true), args[1].Value)
	}
	if len(args) != 1 || args[0].Rest {
		return false
	}
	obj, ok := args[0].Value.(*js.ObjectExpr)
	if !ok || len(obj.List) == 0 {
		return false
	}
	for _, p := range obj.List {
		if p.Name == nil || p.Name.Computed != nil || p.Spread || p.Init != nil || !a.add(moduleKey(p.Name.Literal, false), p.Value) {
			return false
		}
	}
	return true
}

func (a *moduleAudit) Enter(n js.INode) js.IVisitor {
	if a.depth >= moduleWalkDepthLimit {
		a.valid = false
		return nil
	}
	switch v := n.(type) {
	case *js.Var:
		b := bindingOf(v)
		if b == a.exporter {
			a.publisherUses++
		}
		switch string(b.Data) {
		case "System", "require", "importScripts", "Worker", "SharedWorker", "eval", "Function", "arguments":
			a.valid = false
		case "globalThis", "window", "self", "document", "XMLHttpRequest", "fetch":
			if b.Decl == js.NoDecl {
				a.valid = false
			}
		}
	case *js.ImportMetaExpr, *js.ImportStmt, *js.ExportStmt, *js.WithStmt:
		a.valid = false
	case *js.LiteralExpr:
		if v.TokenType == js.ImportToken {
			a.valid = false
		}
	case *js.BinaryExpr:
		if v.Op == js.EqToken && a.function(v.X) {
			a.valid = false // An exported function name must not be rebound.
		}
	}
	if !a.valid {
		return nil
	}
	a.depth++
	return a
}

func (a *moduleAudit) Exit(js.INode) { a.depth-- }
