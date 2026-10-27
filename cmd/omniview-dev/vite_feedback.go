package main

import (
	"encoding/json"
	"fmt"

	"github.com/omniviewdev/omniview/internal/devworkspace"
	"github.com/spf13/cobra"
)

func addViteFeedbackCommand(root *cobra.Command) {
	var contextJSON string
	command := &cobra.Command{
		Use:    "vite-feedback-read",
		Short:  "Read an explicitly owned Vite feedback receipt",
		Hidden: true,
		Args:   cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			held, err := devworkspace.ReadViteFeedbackContext(contextJSON)
			if err != nil {
				fmt.Fprintln(cmd.ErrOrStderr(), "feedback authority refused:", err)
				return commandExit(4)
			}
			if err := json.NewEncoder(cmd.OutOrStdout()).Encode(struct {
				Held bool `json:"held"`
			}{Held: held}); err != nil {
				return commandExit(1)
			}
			return nil
		},
	}
	command.Flags().StringVar(&contextJSON, "context", "", "explicit owned feedback context JSON")
	_ = command.MarkFlagRequired("context")
	root.AddCommand(command)
}
