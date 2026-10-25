package main

import (
	"context"
	"sort"
	"strings"

	"cel.dev/cel-go/cel"
	"cel.dev/cel-go/common/types"
)

func Execute(ctx context.Context, r Request, corpus Corpus) (Response, error) {
	out := Response{Names: []string{}, Rows: []Row{}}
	if err := ctx.Err(); err != nil {
		return out, cancelError(err)
	}
	if r.Version != probeVersion {
		return out, fail("UNSUPPORTED", "unknown experimental request version")
	}
	if r.Draft != nil {
		if r.Source != "" || r.Builder != nil {
			return out, fail("INVALID_REQUEST", "draft and execution are distinct")
		}
		d, err := AnalyzeDraftEnvironment(*r.Draft)
		out.Draft = &d
		return out, err
	}
	if r.Mode != "" && r.Mode != "once" {
		return out, fail("UNSUPPORTED", "finite probe has no follow or continuation protocol")
	}
	if r.PageSize < 1 || r.PageSize > 128 || r.Offset < 0 || r.Offset > maxItems {
		return out, fail("RESOURCE_LIMIT", "bounded finite page required")
	}
	scenario, err := corpus.scenario(r.Scenario)
	if err != nil {
		return out, err
	}
	if r.IncompleteRepresentation {
		return out, fail("UNSUPPORTED", "fixture representation requires hydration before any field can be observed")
	}
	if r.Text != nil && r.Text.Term != "" && len(r.Text.Fields) == 0 {
		return out, fail("INVALID_REQUEST", "nonempty text requires selected fields")
	}
	if len(r.Scope) != len(scenario.Selection) {
		return out, fail("INVALID_REQUEST", "unresolved query scope")
	}
	for dim, c := range r.Scope {
		if _, ok := scenario.Selection[dim]; !ok {
			return out, fail("INVALID_REQUEST", "unknown scope dimension")
		}
		if c.Kind != "any" && c.Kind != "oneOf" || c.Kind == "any" && c.Values != nil || c.Kind == "oneOf" && c.Values == nil {
			return out, fail("INVALID_REQUEST", "invalid scope constraint")
		}
		for _, v := range c.Values {
			if v == "" {
				return out, fail("INVALID_REQUEST", "empty fixture scope value")
			}
		}
	}
	opts, activation, normalized, err := admitBindings(r)
	if err != nil {
		return out, err
	}
	out.Bindings = normalized
	source := r.Source
	if r.Builder != nil {
		if source != "" {
			return out, fail("INVALID_REQUEST", "choose source or builder")
		}
		if r.Builder.Parameter != "" {
			if _, ok := r.Declarations[r.Builder.Parameter]; !ok {
				return out, fail("INVALID_REQUEST", "builder parameter must be declared")
			}
		}
		source, err = LowerClause(*r.Builder)
		if err != nil {
			return out, err
		}
	}
	if len(source) == 0 {
		return out, fail("INVALID_REQUEST", "predicate required")
	}
	if len(source) > maxSourceBytes {
		return out, fail("RESOURCE_LIMIT", "predicate source bytes")
	}
	opts = append(opts, cel.ParserRecursionLimit(64), cel.ParserExpressionSizeLimit(maxSourceBytes))
	env, err := cel.NewEnv(opts...)
	if err != nil {
		return out, fail("INVALID_REQUEST", "invalid predicate environment")
	}
	ast, issues := env.Compile(source)
	if issues != nil && issues.Err() != nil {
		return out, fail("INVALID_REQUEST", issues.String())
	}
	if ast.OutputType() != cel.BoolType && ast.OutputType() != cel.DynType {
		return out, fail("INVALID_REQUEST", "known nonboolean predicate")
	}
	cost := r.CostLimit
	if cost == 0 {
		cost = 100000
	}
	if cost > 100000 {
		return out, fail("RESOURCE_LIMIT", "cost exceeds experiment ceiling")
	}
	program, err := env.Program(ast, cel.EvalOptions(cel.OptTrackCost, cel.OptOptimize), cel.CostLimit(cost), cel.InterruptCheckFrequency(1))
	if err != nil {
		return out, fail("INVALID_REQUEST", "program rejected")
	}
	allowed := map[string]bool{}
	for _, p := range scenario.Pages {
		for _, name := range p.Records {
			allowed[name] = true
		}
	}
	candidates := map[string]bool{}
	for _, name := range r.Candidates {
		if !allowed[name] || candidates[name] {
			return out, fail("INVALID_REQUEST", "candidate escaped or duplicated finite source")
		}
		candidates[name] = true
	}
	type matched struct {
		row   Row
		state int
		text  string
	}
	rows := []matched{}
	for _, record := range corpus.Records {
		if !allowed[record.Name] || r.Candidates != nil && !candidates[record.Name] {
			continue
		}
		if err := ctx.Err(); err != nil {
			return out, cancelError(err)
		}
		if record.Provider != scenario.Profile || record.Type != scenario.Type {
			return out, fail("INVALID_REQUEST", "source record target escape")
		}
		selected := true
		for dim, native := range scenario.Selection {
			if !contains(native, record.Scope[dim]) {
				return out, fail("INVALID_REQUEST", "source record scope escape")
			}
			constraint := r.Scope[dim]
			if constraint.Kind == "oneOf" && !contains(constraint.Values, record.Scope[dim]) {
				selected = false
			}
		}
		if !selected {
			continue
		}
		key, err := AddressKey(record)
		if err != nil {
			return out, err
		}
		body, err := admitDocument(record.Body)
		if err != nil {
			return out, err
		}
		if r.Text != nil {
			matches := r.Text.Term == ""
			for _, path := range r.Text.Fields {
				v, present, err := lookup(body, path)
				if err != nil {
					return out, err
				}
				if !present || v == nil {
					continue
				}
				s, ok := v.(string)
				if !ok {
					return out, fail("UNSUPPORTED", "text field is not string")
				}
				if strings.Contains(s, r.Text.Term) {
					matches = true
				}
			}
			if !matches {
				continue
			}
		}
		activation["resource"] = body
		v, details, evalErr := program.ContextEval(ctx, activation)
		if evalErr != nil {
			if err := ctx.Err(); err != nil {
				return out, cancelError(err)
			}
			if details != nil && details.ActualCost() != nil && *details.ActualCost() > cost {
				return out, fail("RESOURCE_LIMIT", "CEL evaluation cost")
			}
			return out, fail("INVALID_REQUEST", "native CEL evaluation error")
		}
		if v == types.False {
			continue
		}
		if v != types.True {
			return out, fail("INVALID_REQUEST", "nonboolean evaluation")
		}
		m := matched{row: Row{Name: record.Name, AddressKey: key, Incarnation: record.Incarnation, Revision: record.Revision}, state: 2}
		if len(r.OrderPath) > 0 {
			field, present, err := lookup(body, r.OrderPath)
			if err != nil {
				return out, err
			}
			if !present {
				m.state = 0
			} else if field == nil {
				m.state = 1
			} else {
				s, ok := field.(string)
				if !ok {
					return out, fail("UNSUPPORTED", "probe order supports strings only")
				}
				m.text = s
			}
		}
		rows = append(rows, m)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].state != rows[j].state {
			return rows[i].state < rows[j].state
		}
		if rows[i].text != rows[j].text {
			return rows[i].text < rows[j].text
		}
		if rows[i].row.AddressKey != rows[j].row.AddressKey {
			return rows[i].row.AddressKey < rows[j].row.AddressKey
		}
		// This finite request has one target. Incarnation is the final opaque
		// identity token, not source revision, fixture name or arrival order.
		return rows[i].row.Incarnation < rows[j].row.Incarnation
	})
	start := min(r.Offset, len(rows))
	end := min(start+r.PageSize, len(rows))
	for _, m := range rows[start:end] {
		out.Rows = append(out.Rows, m.row)
		out.Names = append(out.Names, m.row.Name)
	}
	out.Coverage, out.Freshness = scenario.Coverage, scenario.Freshness
	return out, nil
}

func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

func cancelError(err error) error {
	if err == context.DeadlineExceeded {
		return fail("TIMEOUT", "request deadline")
	}
	return fail("CANCELLED", "request cancelled")
}

func lookup(body map[string]any, path []string) (any, bool, error) {
	if len(path) == 0 || len(path) > maxDepth {
		return nil, false, fail("INVALID_REQUEST", "member path required")
	}
	var current any = body
	for _, p := range path {
		if current == nil {
			return nil, false, nil
		}
		m, ok := current.(map[string]any)
		if !ok {
			return nil, false, fail("UNSUPPORTED", "probe path requires object/map members")
		}
		v, ok := m[p]
		if !ok {
			return nil, false, nil
		}
		current = v
	}
	return current, true, nil
}
