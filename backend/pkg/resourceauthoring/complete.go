package resourceauthoring

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
)

// Input is everything one completion needs. The caller (the resource
// controller) has already admitted the target and resolved the schema; this
// package fetches nothing and holds no state between requests.
type Input struct {
	Request CompletionRequest
	// Identity is the host-computed identity the response echoes.
	Identity Identity
	// Schema is the resolved representation schema; nil for an absent,
	// unsupported or unavailable binding, which completes dynamically.
	Schema *resourcecatalog.Schema
	// Summary reports how the schema participates.
	Summary SchemaSummary
	// Navigation bounds each catalog navigation (fields and visits).
	Navigation resourcecatalog.Policy
	Policy     Policy
}

type rankedItem struct {
	item Item
	rank int
}

// completer carries the state of one completion.
type completer struct {
	ctx    context.Context
	in     Input
	source string
	a      *analyzer
	slot   slot
	scopes map[string]scopeBinding

	// op is the resolved operand, nil when the slot has none or it does not parse.
	op         *operand
	chainStart int
	res        pathResolution
	resolved   bool
	facts      *resourcecatalog.FieldInfo
	class      opClass
	listing    *resourcecatalog.Navigation

	out       Context
	items     []rankedItem
	truncated string
}

// Complete returns the edits valid at the cursor. It is a pure function of its
// input and the context's cancellation: the same request against the same
// admitted schema gives the same answer.
func Complete(ctx context.Context, in Input) (CompletionResponse, error) {
	if !in.Policy.Valid() {
		return CompletionResponse{}, resourcev2.NewError("INTERNAL", "Authoring policy is invalid.")
	}
	if err := ValidateRequest(in.Request, in.Policy); err != nil {
		return CompletionResponse{}, err
	}
	if err := ctx.Err(); err != nil {
		return CompletionResponse{}, err
	}
	a, err := newAnalyzer(in.Request.Source, in.Request.Declarations)
	if err != nil {
		return CompletionResponse{}, err
	}
	c := &completer{ctx: ctx, in: in, source: in.Request.Source, a: a, chainStart: -1}
	c.slot = a.classify(in.Request.Cursor.Offset)
	c.scopes = a.scopes(c.slot)
	c.out = Context{
		Kind:    c.slot.kind.context(),
		Draft:   c.draftState(),
		Prefix:  c.slot.prefix,
		Replace: Range{Start: c.slot.replaceStart, End: c.slot.replaceEnd, Unit: UnitUTF8Byte},
	}
	if err := c.resolveOperand(); err != nil {
		return CompletionResponse{}, err
	}
	switch c.slot.kind {
	case slotMember:
		c.memberItems()
	case slotIndex:
		c.indexItems()
	case slotValue:
		c.valueItems()
	case slotOperator:
		c.operatorItems()
	case slotExpression:
		c.expressionItems()
	}
	if err := ctx.Err(); err != nil {
		return CompletionResponse{}, err
	}
	return c.finish()
}

// draftState parses the whole source. An incomplete draft is the normal state
// of authoring; completion never requires a valid one.
func (c *completer) draftState() string {
	if strings.TrimSpace(c.source) == "" {
		return DraftIncomplete
	}
	_, issues := c.a.parser.Parse(c.source)
	if issues != nil && issues.Err() != nil {
		return DraftIncomplete
	}
	return DraftValid
}

// resolveOperand parses the operand the slot applies to and resolves it
// against the schema, filling the response context.
func (c *completer) resolveOperand() error {
	s := c.slot
	if s.chainEnd < 0 {
		return nil
	}
	start, ok := c.a.scanChain(s.chainEnd)
	if !ok {
		return nil
	}
	c.chainStart = start
	op, ok := c.a.operandOf(start, s.chainEnd, c.scopes)
	if !ok {
		return nil
	}
	c.op = &op
	c.out.Root = op.root
	switch {
	case op.root == RootParameter:
		facts := bindingFacts(*op.param)
		c.facts, c.resolved = &facts, true
	case op.root == "":
		facts := scalarFacts(op.scalar)
		c.facts, c.resolved = &facts, true
	default:
		if c.in.Schema == nil {
			return nil
		}
		resolver := newResolver(c.ctx, c.in.Schema, c.in.Navigation, c.in.Policy.MaxPathDepth)
		res, err := resolver.resolve(op.segments)
		if err != nil {
			return err
		}
		c.res = res
		if res.tooDeep {
			c.truncated = TruncatedTraversal
		}
		if !res.ok {
			return nil
		}
		c.resolved = true
		c.listing = &res.listing
		c.out.Path = segmentsOf(res.path)
		if n := len(res.tiers); n > 0 {
			c.facts = res.tiers[n-1].info
		}
		upto := len(res.tiers)
		if s.kind == slotOperator || s.kind == slotValue {
			upto = max(upto-1, 0)
		}
		c.out.Ancestors = ancestorsOf(res.path[:upto], res.tiers[:upto])
	}
	if c.facts != nil {
		c.class = classOf(*c.facts, c.listing)
		c.out.Operand = &Operand{
			Range:         Range{Start: op.start, End: op.end, Unit: UnitUTF8Byte},
			Type:          typeInfoOf(*c.facts),
			Checking:      c.facts.CELChecking,
			Presence:      c.facts.Presence,
			Nullable:      c.facts.Nullable,
			Applicability: c.facts.Applicability,
			Conditions:    conditionsOf(c.facts.Conditions),
		}
		if (s.kind == slotMember || s.kind == slotIndex) && c.class.isMap {
			c.out.Keys = "dynamic"
		}
	} else if c.resolved {
		c.out.Operand = &Operand{Range: Range{Start: op.start, End: op.end, Unit: UnitUTF8Byte}}
	}
	return nil
}

// add records a candidate; ranking and the bounds are applied in finish.
func (c *completer) add(item Item, rank int) {
	item.Edit.Unit = UnitUTF8Byte
	if item.Edit.Selection != nil {
		item.Edit.Selection.Unit = UnitUTF8Byte
	}
	c.items = append(c.items, rankedItem{item: item, rank: rank})
}

// truncate records the first reason the candidate set may be incomplete.
func (c *completer) truncate(reason string) {
	if c.truncated == "" {
		c.truncated = reason
	}
}

// noteListing carries a truncated catalog listing into the completeness state.
func (c *completer) noteListing(nav *resourcecatalog.Navigation) {
	if nav == nil || !nav.Truncated {
		return
	}
	switch nav.TruncationReason {
	case resourcecatalog.TruncatedVisits:
		c.truncate(TruncatedTraversal)
	default:
		c.truncate(TruncatedItems)
	}
}

// finish orders the candidates, applies the item and byte bounds and builds the
// response.
func (c *completer) finish() (CompletionResponse, error) {
	maxItems := min(c.in.Request.MaxSuggestions, c.in.Policy.MaxSuggestions)
	sort.SliceStable(c.items, func(i, j int) bool { return c.items[i].rank < c.items[j].rank })
	items := make([]Item, 0, min(len(c.items), maxItems))
	for _, candidate := range c.items {
		if len(items) == maxItems {
			c.truncate(TruncatedItems)
			break
		}
		items = append(items, candidate.item)
	}
	response := CompletionResponse{
		Version:          Version,
		RequestID:        c.in.Request.RequestID,
		DocumentID:       c.in.Request.DocumentID,
		DocumentRevision: c.in.Request.DocumentRevision,
		Cursor:           c.in.Request.Cursor,
		Identity:         c.in.Identity,
		Schema:           c.in.Summary,
		Context:          c.out,
		Items:            items,
		MaxSuggestions:   maxItems,
	}
	fitted, cut, err := fitBytes(response, c.in.Policy.MaxResponseBytes)
	if err != nil {
		return CompletionResponse{}, err
	}
	response = fitted
	if cut {
		c.truncate(TruncatedBytes)
	}
	response.Completion = Completeness{Kind: CompletionComplete}
	if c.truncated != "" {
		response.Completion = Completeness{Kind: CompletionTruncated, Reason: c.truncated}
	}
	return response, nil
}

// fitBytes keeps the longest item prefix whose encoded response fits the limit.
func fitBytes(response CompletionResponse, limit int) (CompletionResponse, bool, error) {
	encode := func(n int) (int, error) {
		trial := response
		trial.Items = response.Items[:n]
		trial.Completion = Completeness{Kind: CompletionTruncated, Reason: TruncatedBytes}
		encoded, err := json.Marshal(trial)
		return len(encoded), err
	}
	full, err := encode(len(response.Items))
	if err != nil {
		return response, false, resourcev2.NewError("INTERNAL", "Completion response could not be encoded.")
	}
	if full <= limit {
		return response, false, nil
	}
	low, high := 0, len(response.Items)
	for low < high {
		mid := (low + high + 1) / 2
		size, err := encode(mid)
		if err != nil {
			return response, false, resourcev2.NewError("INTERNAL", "Completion response could not be encoded.")
		}
		if size <= limit {
			low = mid
		} else {
			high = mid - 1
		}
	}
	size, err := encode(low)
	if err != nil || size > limit {
		return response, false, resourcev2.NewError("RESOURCE_LIMIT", "Completion response exceeds the byte limit.")
	}
	response.Items = response.Items[:low]
	return response, true, nil
}
