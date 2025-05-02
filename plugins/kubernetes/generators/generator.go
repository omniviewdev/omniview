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

// Versions to compile against. These are the tags we'll check out
var Versions = []string{
	"v1.33.0",
	"v1.32.4",
	"v1.31.8",
	"v1.30.12",
	"v1.29.15",
	"v1.28.15",
	"v1.27.16",
	"v1.26.15",
	"v1.25.16",
}

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

// Checkout a specific tag so we can accumulate the resources
func checkoutTag(tag string) error {
	cmd := exec.Command("git", "-C", START_DIR, "checkout", tag)
	log.Printf("Running command: %s", cmd.String())
	if err := cmd.Run(); err != nil {
		err = fmt.Errorf("failed to run command: %s, with error: %v", cmd.String(), err)
		return err
	}
	log.Printf("Checked out tag: %s", tag)
	return nil
}

// Run the generator
func main() {
	if err := cloneRepo(REPO_URL); err != nil {
		log.Panicf("failed to run generator: %s", err)
	}

	resources := make([]Resource, 0, 100)
	packages := make([]Package, 0, 30)

	// readSpec(filepath.Join(START_DIR, "api/openapi-spec/v3/api__v1_openapi.json"))

	// parse the open api spec
	for _, version := range Versions {
		if err := checkoutTag(version); err != nil {
			log.Panicf("failed to run generator: %s", err)
		}
		ParseOpenAPI(
			filepath.Join(START_DIR, "api/openapi-spec/swagger.json"),
			&resources,
			&packages,
		)
		log.Printf("Parsed resources for version: %s", version)
	}

	GenerateRegister(resources, packages)
	log.Print("Generator ran successfully")
}
