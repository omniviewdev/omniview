package mcprelay

import "context"

// Confirm returns the consent requirement captured atomically with the bound
// policy revision. A handler must not consult an earlier relay config snapshot.
func (a *Authority) Confirm(ctx context.Context) (bool, error) {
	c, ok := ctx.Value(authorityContextKey{}).(*authorityCall)
	if !ok {
		return false, errAuthority
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !c.bound || !a.allowedLocked(c) {
		return false, errAuthority
	}
	return c.confirm, nil
}

// Approve accepts only the decision for this still-current immutable call.
// Consent never carries over to another revision or target.
func (a *Authority) Approve(ctx context.Context) error {
	c, ok := ctx.Value(authorityContextKey{}).(*authorityCall)
	if !ok {
		return errAuthority
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !c.bound || c.dispatched || !a.allowedLocked(c) {
		return errAuthority
	}
	c.approved = true
	return nil
}

// Policy supplies the same bound policy document for inventory filtering. A
// later policy update cancels the call, and Dispatch fences an in-flight result.
func (a *Authority) Policy(ctx context.Context) (Config, error) {
	c, ok := ctx.Value(authorityContextKey{}).(*authorityCall)
	if !ok {
		return Config{}, errAuthority
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !c.bound || !a.allowedLocked(c) {
		return Config{}, errAuthority
	}
	return c.config.clone(), nil
}
