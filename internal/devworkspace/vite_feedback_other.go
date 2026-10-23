//go:build !darwin && !linux && !windows

package devworkspace

import (
	"errors"
	"os"
)

func createFeedbackFile(string) (*os.File, error)        { return nil, errors.ErrUnsupported }
func openFeedbackAuthorityFile(string) (*os.File, error) { return nil, errors.ErrUnsupported }
func feedbackFileIdentity(*os.File) (viteFeedbackFileIdentity, error) {
	return viteFeedbackFileIdentity{}, errors.ErrUnsupported
}
func syncFeedbackParent(string) error { return errors.ErrUnsupported }
