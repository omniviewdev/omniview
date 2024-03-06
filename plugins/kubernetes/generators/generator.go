package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
)

const (
	START_DIR = "./_tmp/api"
	REPO_URL  = "https://github.com/kubernetes/kubernetes.git"
	SUB_PATH  = "api"

	// Resource settings
	RESOURCE_DIR = "../backend/resource"
	EXEC_DIR     = "../backend/exec"
)

// Clone the repo down to the temporary directory for parsing
func cloneRepo(repoURL string) error {
	// first, clean up the location if it exists, BUT ONLY IF IT'S NOT THE EXISTING GIT REPO

	if _, err := os.Stat(START_DIR); err == nil {
		// if the directory exists, and it's a git repo, don't remove it
		if _, err := os.Stat(filepath.Join(START_DIR, ".git")); err == nil {
			log.Print("Repo already exists. Skipping clone.")
			return nil
		}

		// it's not our git repo, so remove it
		os.RemoveAll(START_DIR)
	}

	// recursively create the directory
	if err := os.MkdirAll(START_DIR, 0755); err != nil {
		return err
	}
	log.Printf("Cloning repo with sparse checkout: %s", repoURL)

	// then, do a sparse checkout
	cmds := []*exec.Cmd{
		exec.Command("git", "init", START_DIR),
		exec.Command("git", "-C", START_DIR, "config", "core.sparseCheckout", "true"),
		exec.Command("bash", "-c", "echo "+SUB_PATH+" > "+START_DIR+"/.git/info/sparse-checkout"),
		exec.Command("git", "-C", START_DIR, "remote", "add", "-f", "origin", repoURL),
		exec.Command("git", "-C", START_DIR, "pull", "origin", "master"),
	}

	// Execute commands in sequence
	for _, cmd := range cmds {
		log.Printf("Running command: %s", cmd.String())
		if err := cmd.Run(); err != nil {
			err = fmt.Errorf("failed to run command: %s, with error: %v", cmd.String(), err)
			return err
		}
	}

	log.Print("Repo cloned successfully")
	return nil
}

// Run the generator
func main() {
	if err := cloneRepo(REPO_URL); err != nil {
		log.Panicf("failed to run generator: %s", err)
	}

	// readSpec(filepath.Join(START_DIR, "api/openapi-spec/v3/api__v1_openapi.json"))

	// parse the open api spec
	ParseOpenAPI(filepath.Join(START_DIR, "api/openapi-spec/swagger.json"))

	log.Print("Generator ran successfully")
}
