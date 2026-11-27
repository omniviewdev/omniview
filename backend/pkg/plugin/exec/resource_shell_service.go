package exec

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/transportjson"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const resourceShellRequestLimit = 64 << 10

func (s *ServiceWrapper) shellCaller(ctx context.Context) (context.Context, shellOwner, error) {
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	scope, err := s.admitTerminalWindow(window)
	if err != nil {
		return nil, shellOwner{}, err
	}
	if scope == nil || scope.Principal().Origin() != invocation.TrustedUI {
		return nil, shellOwner{}, shellUnavailable()
	}
	return scope.Context(ctx), shellOwner{window: invocation.IdentityOf(window), scope: scope}, nil
}

func (s *ServiceWrapper) sameShellCaller(ctx context.Context, caller shellOwner) bool {
	_, now, err := s.shellCaller(ctx)
	return err == nil && now == caller
}

// CreateResourceShell starts and attaches a resource provider's registered default shell. Consume
// its replay before reading subsequent bytes through the authenticated ReadResourceShell binding.
// encoded accepts only {id,root,params}. The native root and ordinary exec permission are both required.
func (s *ServiceWrapper) CreateResourceShell(ctx context.Context, owner, encoded string) (*ResourceShellAttachment, error) {
	if len(encoded) > resourceShellRequestLimit || len(owner) > 256 {
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Resource shell request exceeds the byte limit.")
	}
	var request resourceShellRequest
	if err := transportjson.Decode(encoded, &request, owner); err != nil {
		return nil, err
	}
	ctx, caller, err := s.shellCaller(ctx)
	if err != nil {
		return nil, err
	}
	a, err := s.Ctrl.createResourceShell(ctx, caller, owner, request)
	if err != nil {
		return nil, err
	}
	// Retirement before registration found nothing. Check the very same window subject after
	// registration, then retire only this generation if it can no longer receive its attachment.
	if !s.sameShellCaller(ctx, caller) {
		_ = s.Ctrl.closeResourceShell(context.WithoutCancel(ctx), caller, a.ID, a.Attachment)
		return nil, shellUnavailable()
	}
	return a, nil
}

// CheckResourceShell never creates or restores a shell. An empty root checks only the original
// attachment before mounting a menu hook. Hook dispatch and delivery must supply its current root.
func (s *ServiceWrapper) CheckResourceShell(ctx context.Context, id, attachment, encodedRoot string) bool {
	ctx, caller, err := s.shellCaller(ctx)
	if err != nil || !s.Ctrl.checkResourceShell(ctx, caller, id, attachment, encodedRoot) {
		return false
	}
	return s.sameShellCaller(ctx, caller)
}

func (s *ServiceWrapper) WriteResourceShell(ctx context.Context, id, attachment string, data []byte) error {
	ctx, caller, err := s.shellCaller(ctx)
	if err != nil {
		return err
	}
	return s.Ctrl.writeResourceShell(ctx, caller, id, attachment, data)
}

func (s *ServiceWrapper) ResizeResourceShell(ctx context.Context, id, attachment string, rows, cols uint16) error {
	ctx, caller, err := s.shellCaller(ctx)
	if err != nil {
		return err
	}
	return s.Ctrl.resizeResourceShell(ctx, caller, id, attachment, rows, cols)
}

func (s *ServiceWrapper) CloseResourceShell(ctx context.Context, id, attachment string) error {
	ctx, caller, err := s.shellCaller(ctx)
	if err != nil {
		return err
	}
	return s.Ctrl.closeResourceShell(ctx, caller, id, attachment)
}

// ReadResourceShell waits for private bytes or attachment loss. Only one read may be outstanding.
// No process output, including the final error or close, is sent on the Wails broadcast bus.
func (s *ServiceWrapper) ReadResourceShell(ctx context.Context, id, attachment string) (*ResourceShellRead, error) {
	// Deliver bytes only to the same admitted window. Loss at either end of the wait reads as detachment.
	if scoped, caller, err := s.shellCaller(ctx); err == nil {
		frame, readErr := s.Ctrl.readResourceShell(scoped, caller, id, attachment)
		if readErr != nil {
			return nil, readErr
		}
		if s.sameShellCaller(scoped, caller) {
			return frame, nil
		}
	}
	return shellRead(nil, shellDetached), nil
}
