package auditgate

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// policyFiles holds the shipped table.
//
//go:embed policy.json
var policyFiles embed.FS

// policyVersion is the only table schema this package reads.
const policyVersion = 1

// Decision is the policy outcome for a bound method, a runtime call or an
// event. Anything the policy does not name is denied; a shipped table never
// contains a third, undecided state.
type Decision string

// The two decisions a table may record.
const (
	Allow Decision = "allow"
	Deny  Decision = "deny"
)

func (d Decision) valid() bool { return d == Allow || d == Deny }

// MethodRule classifies one Wails-bound Go method, keyed by the fully
// qualified name Wails derives: PkgPath.TypeName.Method.
type MethodRule struct {
	FQN      string   `json:"fqn"`
	Decision Decision `json:"decision"`
	Reason   string   `json:"reason"`
}

// RuntimeMethodRule classifies one method of a Wails runtime object other than
// the bound-method dispatcher, for example Window.Name or Application.Quit.
type RuntimeMethodRule struct {
	Method   int      `json:"method"`
	Name     string   `json:"name"`
	Decision Decision `json:"decision"`
	Reason   string   `json:"reason"`
}

// RuntimeObjectRule lists the rules of one Wails runtime object. Methods the
// list does not name are denied.
type RuntimeObjectRule struct {
	Object  int                 `json:"object"`
	Name    string              `json:"name"`
	Reason  string              `json:"reason"`
	Methods []RuntimeMethodRule `json:"methods"`
}

// EventMatch selects how an EventRule compares against an event name.
type EventMatch string

// The ways an event rule can match a name.
const (
	MatchExact  EventMatch = "exact"
	MatchPrefix EventMatch = "prefix"
	MatchSuffix EventMatch = "suffix"
)

// EventRule classifies backend events by name. A name matched by any deny
// rule is dropped, a name matched by an allow rule is forwarded, and every
// other name is dropped.
type EventRule struct {
	Match    EventMatch `json:"match"`
	Name     string     `json:"name"`
	Decision Decision   `json:"decision"`
	Reason   string     `json:"reason"`
}

func (r EventRule) matches(name string) bool {
	switch r.Match {
	case MatchExact:
		return name == r.Name
	case MatchPrefix:
		return strings.HasPrefix(name, r.Name)
	case MatchSuffix:
		return strings.HasSuffix(name, r.Name)
	default:
		return false
	}
}

type policyFile struct {
	Version int                 `json:"version"`
	Wails   string              `json:"wails"`
	Methods []MethodRule        `json:"methods"`
	Runtime []RuntimeObjectRule `json:"runtime"`
	Events  []EventRule         `json:"events"`
}

type runtimeObject struct {
	rule    RuntimeObjectRule
	methods map[int]RuntimeMethodRule
}

// Policy is the immutable, deny-by-default classification table. It is safe
// for concurrent use.
type Policy struct {
	wails   string
	methods map[string]*MethodRule
	ids     map[uint32]string
	objects map[int]*runtimeObject
	events  []EventRule
}

// Default parses and validates the policy embedded in the binary
// (policy.json). The table is small, so every call parses it afresh; callers
// that need it repeatedly should keep the result.
func Default() (*Policy, error) {
	data, err := policyFiles.ReadFile("policy.json")
	if err != nil {
		return nil, fmt.Errorf("auditgate: read embedded policy: %w", err)
	}
	return Parse(data)
}

var (
	// fqnPattern is the shape of a Wails binding name: an import path (or
	// "main"), a type name and an exported method name.
	fqnPattern  = regexp.MustCompile(`^[A-Za-z0-9_.~+/-]+\.[A-Za-z_][A-Za-z0-9_]*\.[A-Z][A-Za-z0-9_]*$`)
	namePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*$`)
)

// Parse validates and indexes a policy table. It rejects repeated and
// case-variant keys, unknown fields, trailing data, an unsupported version,
// undecided or unexplained rows, duplicates, ID collisions and event allow
// rules that a deny rule shadows.
func Parse(data []byte) (*Policy, error) {
	// Go's decoder keeps the last of repeated keys and matches keys
	// case-insensitively, so a table with such a key would load differently
	// from how a reviewer reads the file. Refuse the text before decoding it.
	if reason := checkStrictJSON(data); reason != "" {
		return nil, fmt.Errorf("auditgate: invalid policy: %s", strings.ReplaceAll(string(reason), "_", " "))
	}
	var file policyFile
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&file); err != nil {
		return nil, fmt.Errorf("auditgate: invalid policy: %w", err)
	}
	if file.Version != policyVersion {
		return nil, fmt.Errorf("auditgate: unsupported policy version %d (want %d)", file.Version, policyVersion)
	}
	if strings.TrimSpace(file.Wails) == "" {
		return nil, errors.New("auditgate: policy must record the reviewed Wails version")
	}
	policy := &Policy{
		wails:   file.Wails,
		methods: make(map[string]*MethodRule, len(file.Methods)),
		ids:     make(map[uint32]string, len(file.Methods)),
		objects: make(map[int]*runtimeObject, len(file.Runtime)),
		events:  nil,
	}
	if err := policy.indexMethods(file.Methods); err != nil {
		return nil, err
	}
	if err := policy.indexRuntime(file.Runtime); err != nil {
		return nil, err
	}
	if err := policy.indexEvents(file.Events); err != nil {
		return nil, err
	}
	return policy, nil
}

func (p *Policy) indexMethods(rules []MethodRule) error {
	for _, rule := range rules {
		if !fqnPattern.MatchString(rule.FQN) || len(rule.FQN) > maxMethodNameBytes {
			return fmt.Errorf("auditgate: invalid method name %q", rule.FQN)
		}
		if !rule.Decision.valid() {
			return fmt.Errorf("auditgate: method %s has decision %q; use %q or %q", rule.FQN, rule.Decision, Allow, Deny)
		}
		if strings.TrimSpace(rule.Reason) == "" {
			return fmt.Errorf("auditgate: method %s has no reason", rule.FQN)
		}
		if _, dup := p.methods[rule.FQN]; dup {
			return fmt.Errorf("auditgate: duplicate method %s", rule.FQN)
		}
		id := MethodID(rule.FQN)
		if other, clash := p.ids[id]; clash {
			return fmt.Errorf("auditgate: methods %s and %s share binding id %d", other, rule.FQN, id)
		}
		kept := rule
		p.methods[rule.FQN] = &kept
		p.ids[id] = rule.FQN
	}
	return nil
}

func (p *Policy) indexRuntime(rules []RuntimeObjectRule) error {
	names := make(map[string]struct{}, len(rules))
	for _, rule := range rules {
		if rule.Object < 0 || !namePattern.MatchString(rule.Name) {
			return fmt.Errorf("auditgate: invalid runtime object %d %q", rule.Object, rule.Name)
		}
		if strings.TrimSpace(rule.Reason) == "" {
			return fmt.Errorf("auditgate: runtime object %s has no reason", rule.Name)
		}
		if _, dup := p.objects[rule.Object]; dup {
			return fmt.Errorf("auditgate: duplicate runtime object %d", rule.Object)
		}
		if _, dup := names[rule.Name]; dup {
			return fmt.Errorf("auditgate: duplicate runtime object name %s", rule.Name)
		}
		names[rule.Name] = struct{}{}
		methods, err := indexRuntimeMethods(rule)
		if err != nil {
			return err
		}
		p.objects[rule.Object] = &runtimeObject{rule: rule, methods: methods}
	}
	return nil
}

func indexRuntimeMethods(object RuntimeObjectRule) (map[int]RuntimeMethodRule, error) {
	methods := make(map[int]RuntimeMethodRule, len(object.Methods))
	names := make(map[string]struct{}, len(object.Methods))
	for _, method := range object.Methods {
		if method.Method < 0 || !namePattern.MatchString(method.Name) {
			return nil, fmt.Errorf("auditgate: invalid runtime method %s.%d %q", object.Name, method.Method, method.Name)
		}
		if !method.Decision.valid() {
			return nil, fmt.Errorf("auditgate: runtime method %s.%s has decision %q", object.Name, method.Name, method.Decision)
		}
		if strings.TrimSpace(method.Reason) == "" {
			return nil, fmt.Errorf("auditgate: runtime method %s.%s has no reason", object.Name, method.Name)
		}
		if _, dup := methods[method.Method]; dup {
			return nil, fmt.Errorf("auditgate: duplicate runtime method %s.%d", object.Name, method.Method)
		}
		if _, dup := names[method.Name]; dup {
			return nil, fmt.Errorf("auditgate: duplicate runtime method name %s.%s", object.Name, method.Name)
		}
		names[method.Name] = struct{}{}
		methods[method.Method] = method
	}
	return methods, nil
}

func (p *Policy) indexEvents(rules []EventRule) error {
	type key struct {
		match EventMatch
		name  string
	}
	seen := make(map[key]struct{}, len(rules))
	for _, rule := range rules {
		if err := validateEventRule(rule); err != nil {
			return err
		}
		if _, dup := seen[key{rule.Match, rule.Name}]; dup {
			return fmt.Errorf("auditgate: duplicate event rule %s %q", rule.Match, rule.Name)
		}
		seen[key{rule.Match, rule.Name}] = struct{}{}
	}
	for _, allow := range rules {
		if allow.Decision != Allow {
			continue
		}
		for _, deny := range rules {
			if deny.Decision == Deny && shadows(deny, allow) {
				return fmt.Errorf("auditgate: event allow rule %s %q is unreachable: deny rule %s %q matches first",
					allow.Match, allow.Name, deny.Match, deny.Name)
			}
		}
	}
	p.events = append([]EventRule(nil), rules...)
	return nil
}

func validateEventRule(rule EventRule) error {
	switch rule.Match {
	case MatchExact, MatchPrefix, MatchSuffix:
	default:
		return fmt.Errorf("auditgate: event rule %q has unknown match %q", rule.Name, rule.Match)
	}
	if !validEventName(rule.Name) {
		return fmt.Errorf("auditgate: invalid event rule name %q", rule.Name)
	}
	if !rule.Decision.valid() {
		return fmt.Errorf("auditgate: event rule %q has decision %q", rule.Name, rule.Decision)
	}
	if strings.TrimSpace(rule.Reason) == "" {
		return fmt.Errorf("auditgate: event rule %q has no reason", rule.Name)
	}
	return nil
}

// shadows reports whether every name the allow rule could match is already
// matched by the deny rule, which makes the allow rule dead configuration.
func shadows(deny, allow EventRule) bool {
	switch deny.Match {
	case MatchExact:
		return allow.Match == MatchExact && allow.Name == deny.Name
	case MatchPrefix:
		return (allow.Match == MatchExact || allow.Match == MatchPrefix) && strings.HasPrefix(allow.Name, deny.Name)
	case MatchSuffix:
		return (allow.Match == MatchExact || allow.Match == MatchSuffix) && strings.HasSuffix(allow.Name, deny.Name)
	default:
		return false
	}
}

// WailsVersion is the Wails module version whose runtime object and method
// numbering the table was reviewed against.
func (p *Policy) WailsVersion() string { return p.wails }

// Method returns the rule for a fully qualified bound method name.
func (p *Policy) Method(fqn string) (MethodRule, bool) {
	rule, ok := p.methods[fqn]
	if !ok {
		var none MethodRule
		return none, false
	}
	return *rule, true
}

// MethodByID returns the rule for a Wails binding ID. The lookup covers every
// classified method, denied ones included, so a denied ID is reported as
// denied rather than unknown.
func (p *Policy) MethodByID(id uint32) (MethodRule, bool) {
	fqn, ok := p.ids[id]
	if !ok {
		var none MethodRule
		return none, false
	}
	return *p.methods[fqn], true
}

// Methods returns a copy of every method rule, sorted by name.
func (p *Policy) Methods() []MethodRule {
	rules := make([]MethodRule, 0, len(p.methods))
	for _, rule := range p.methods {
		rules = append(rules, *rule)
	}
	sort.Slice(rules, func(i, j int) bool { return rules[i].FQN < rules[j].FQN })
	return rules
}

// Counts returns how many bound methods the table allows and denies.
func (p *Policy) Counts() (int, int) {
	allowed, denied := 0, 0
	for _, rule := range p.methods {
		if rule.Decision == Allow {
			allowed++
		} else {
			denied++
		}
	}
	return allowed, denied
}

// RuntimeObject returns the rule of a Wails runtime object by number.
func (p *Policy) RuntimeObject(object int) (RuntimeObjectRule, bool) {
	entry, ok := p.objects[object]
	if !ok {
		var none RuntimeObjectRule
		return none, false
	}
	return entry.rule, true
}

// RuntimeMethod returns the rule of one method of a Wails runtime object.
func (p *Policy) RuntimeMethod(object, method int) (RuntimeMethodRule, bool) {
	entry, ok := p.objects[object]
	if !ok {
		var none RuntimeMethodRule
		return none, false
	}
	rule, ok := entry.methods[method]
	return rule, ok
}

// RuntimeObjects returns a copy of the runtime object rules, sorted by number.
func (p *Policy) RuntimeObjects() []RuntimeObjectRule {
	rules := make([]RuntimeObjectRule, 0, len(p.objects))
	for _, entry := range p.objects {
		rule := entry.rule
		rule.Methods = append([]RuntimeMethodRule(nil), rule.Methods...)
		rules = append(rules, rule)
	}
	sort.Slice(rules, func(i, j int) bool { return rules[i].Object < rules[j].Object })
	return rules
}

// EventRules returns a copy of the event rules in table order.
func (p *Policy) EventRules() []EventRule {
	return append([]EventRule(nil), p.events...)
}

// UnclassifiedError reports bound methods that are missing from the table.
type UnclassifiedError struct {
	FQNs []string
}

func (e *UnclassifiedError) Error() string {
	const shown = 8
	list := e.FQNs
	suffix := ""
	if len(list) > shown {
		suffix = fmt.Sprintf(" (+%d more)", len(list)-shown)
		list = list[:shown]
	}
	return fmt.Sprintf(
		"audit gateway allowlist does not classify %d bound method(s): %s%s; "+
			"add each to internal/auditgate/policy.json as allow or deny (docs/development-audit-gateway.md)",
		len(e.FQNs), strings.Join(list, ", "), suffix)
}

// Verify checks that every method Wails will bind for the given service
// instances is classified. The host calls it before registering services so a
// conditional or build-tagged service cannot expose an unreviewed method.
func (p *Policy) Verify(instances ...any) error {
	fqns, err := BoundMethodFQNs(instances...)
	if err != nil {
		return err
	}
	var missing []string
	for _, fqn := range fqns {
		if _, ok := p.methods[fqn]; !ok {
			missing = append(missing, fqn)
		}
	}
	if len(missing) > 0 {
		return &UnclassifiedError{FQNs: missing}
	}
	return nil
}
