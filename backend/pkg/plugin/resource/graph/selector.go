package graph

import (
	"slices"

	"github.com/tidwall/gjson"
)

// Extractor methods understood by the indexer.
const (
	// MethodFieldPath reads target IDs from a field path.
	MethodFieldPath = "fieldPath"
	// MethodLabelSelector reads a plain label map (a Service's spec.selector).
	// An empty or absent map selects nothing.
	MethodLabelSelector = "labelSelector"
	// MethodLabelSelectorObject reads a Kubernetes LabelSelector object
	// ({matchLabels, matchExpressions}, e.g. a NetworkPolicy's
	// spec.podSelector). An empty object selects every target in the
	// namespace; an absent one selects nothing.
	MethodLabelSelectorObject = "labelSelectorObject"
)

// Label selector operators (metav1.LabelSelectorOperator).
const (
	opIn           = "In"
	opNotIn        = "NotIn"
	opExists       = "Exists"
	opDoesNotExist = "DoesNotExist"
)

// labelSelector matches labels the way Kubernetes does: every matchLabels
// pair and every expression must hold. An empty selector matches everything.
type labelSelector struct {
	matchLabels map[string]string
	expressions []selectorRequirement
}

type selectorRequirement struct {
	key      string
	operator string
	values   []string
}

func (s labelSelector) isEmpty() bool {
	return len(s.matchLabels) == 0 && len(s.expressions) == 0
}

func (s labelSelector) matches(labels map[string]string) bool {
	for k, v := range s.matchLabels {
		if got, ok := labels[k]; !ok || got != v {
			return false
		}
	}
	for _, req := range s.expressions {
		if !req.matches(labels) {
			return false
		}
	}
	return true
}

func (r selectorRequirement) matches(labels map[string]string) bool {
	v, ok := labels[r.key]
	switch r.operator {
	case opIn:
		return ok && slices.Contains(r.values, v)
	case opNotIn:
		return !ok || !slices.Contains(r.values, v)
	case opExists:
		return ok
	case opDoesNotExist:
		return !ok
	default:
		return false
	}
}

// parseLabelMap reads a plain label map.
func parseLabelMap(result gjson.Result) labelSelector {
	sel := labelSelector{matchLabels: map[string]string{}, expressions: nil}
	if !result.IsObject() {
		return sel
	}
	result.ForEach(func(key, value gjson.Result) bool {
		sel.matchLabels[key.String()] = value.String()
		return true
	})
	return sel
}

// parseLabelSelectorObject reads a Kubernetes LabelSelector object. It
// reports false for anything Kubernetes would reject (an unknown operator, or
// In/NotIn without values), so an invalid selector selects nothing rather
// than everything.
func parseLabelSelectorObject(result gjson.Result) (labelSelector, bool) {
	sel := labelSelector{matchLabels: map[string]string{}, expressions: nil}
	if !result.IsObject() {
		return sel, false
	}

	result.Get("matchLabels").ForEach(func(key, value gjson.Result) bool {
		sel.matchLabels[key.String()] = value.String()
		return true
	})

	valid := true
	result.Get("matchExpressions").ForEach(func(_, expr gjson.Result) bool {
		req := selectorRequirement{
			key:      expr.Get("key").String(),
			operator: expr.Get("operator").String(),
			values:   nil,
		}
		expr.Get("values").ForEach(func(_, v gjson.Result) bool {
			req.values = append(req.values, v.String())
			return true
		})

		switch req.operator {
		case opIn, opNotIn:
			valid = req.key != "" && len(req.values) > 0
		case opExists, opDoesNotExist:
			valid = req.key != ""
		default:
			valid = false
		}
		if valid {
			sel.expressions = append(sel.expressions, req)
		}
		return valid
	})

	return sel, valid
}
