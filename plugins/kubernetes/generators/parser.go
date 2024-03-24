package main

import (
	"encoding/json"
	"fmt"
	"html"
	"log"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"text/template"
)

// OpenAPISpec represents the parts of the OpenAPI spec we are interested in
type OpenAPISpec struct {
	Definitions map[string]Definition `json:"definitions"`
}

// Definition represents a single definition in the OpenAPI spec
type Definition struct {
	Description                 string              `json:"description"`
	Properties                  map[string]Property `json:"properties"`
	XKubernetesGroupVersionKind []GroupVersionKind  `json:"x-kubernetes-group-version-kind"`
}

// Property represents a single property within a definition
type Property struct {
	Ref         string `json:"$ref"`
	Type        string `json:"type"`
	Description string `json:"description"`
}

type GroupVersionKind struct {
	Group   string `json:"group"`
	Version string `json:"version"`
	Kind    string `json:"kind"`
}

type Resource struct {
	Group       string `json:"group"`
	Version     string `json:"version"`
	Kind        string `json:"kind"`
	Description string `json:"description"`
	ImportName  string `json:"importName"`
	ImportPath  string `json:"importPath"`
	SGVRName    string `json:"sgvrName"`
}

type Package struct {
	ImportName string `json:"importName"`
	ImportPath string `json:"importPath"`
}

type TemplateData struct {
	// the imports to add
	Packages []Package
	// The resources to attach to the
	Resources []Resource
}

func ParseOpenAPI(location string, resources *[]Resource, packages *[]Package) {
	// Read the OpenAPI spec file
	data, err := os.ReadFile(location)
	if err != nil {
		log.Fatalf("Failed to read OpenAPI spec file: %v", err)
	}

	// Unmarshal the JSON data into our OpenAPISpec struct
	var spec OpenAPISpec
	if err := json.Unmarshal(data, &spec); err != nil {
		log.Fatalf("Failed to unmarshal OpenAPI spec: %v", err)
	}

	// Process each definition
	for _, def := range spec.Definitions {
		_, hasAPIVersion := def.Properties["apiVersion"]
		_, hasKind := def.Properties["kind"]
		_, hasMetadata := def.Properties["metadata"]

		// Check if the definition has the required properties
		if hasAPIVersion && hasKind && hasMetadata {
			// Write the details to the output file
			for _, gvk := range def.XKubernetesGroupVersionKind {
				// account for "core"
				if gvk.Group == "" {
					gvk.Group = "core"
				}
				// skip anything with a kind ending in "List"
				// check for out of bounds first though
				if len(gvk.Kind) > 4 && gvk.Kind[len(gvk.Kind)-4:] == "List" {
					continue
				}

				// skip CRDs
				if gvk.Kind == "CustomResourceDefinition" {
					continue
				}
				group := gvk.Group

				// if group ends in .k8s.io, remove it
				group = strings.TrimSuffix(group, ".k8s.io")

				// if group still has dots, remove them except in our weird cases
				if strings.Contains(group, ".") {
					// split by dot, and combine in reverse order without dot
					parts := strings.Split(group, ".")

					if strings.HasPrefix(group, "internal.") {
						group = ""
						for i := len(parts) - 1; i >= 0; i-- {
							group += parts[i]
						}
					} else {
						// take the first part of the group
						group = parts[0]
					}
				}

				importPath := fmt.Sprintf("%s/%s", group, gvk.Version)
				importName := fmt.Sprintf("%s%s", group, gvk.Version)

				svgrName := strings.ToLower(gvk.Kind)

				whitelist := []string{
					"endpoints",
					"resourceclaimparameters",
				}

				// english language pluralization
				if svgrName[len(svgrName)-1:] == "s" {
					// they made a mistake with "endpoints" and it's already plural
					if !slices.Contains(whitelist, svgrName) {
						svgrName = fmt.Sprintf("%ses", svgrName)
					}
				} else if svgrName[len(svgrName)-1:] == "y" {
					svgrName = fmt.Sprintf("%sies", svgrName[:len(svgrName)-1])
				} else if svgrName[len(svgrName)-1:] == "x" {
					svgrName = fmt.Sprintf("%ses", svgrName)
				} else {
					svgrName = fmt.Sprintf("%ss", svgrName)
				}

				process := true

				// skip our whitelisted resources
				switch group {
				case "storagemigration":
					process = false
				case "apiregistration":
					process = false
				}

				// yet another whitelist
				switch {
				case group == "resource" && gvk.Version == "v1alpha1":
					process = false
				}

				if !process {
					continue
				}

				// only process if we haven't already
				alreadyProcessed := slices.ContainsFunc(*resources, func(r Resource) bool {
					return r.Kind == gvk.Kind && r.Group == group &&
						r.Version == gvk.Version
				})

				if alreadyProcessed {
					continue
				}

				// add to resources
				*resources = append(*resources, Resource{
					Group:       group,
					Version:     gvk.Version,
					Kind:        gvk.Kind,
					Description: strings.ReplaceAll(html.EscapeString(def.Description), "`", "'"),
					ImportName:  importName,
					ImportPath:  importPath,
					SGVRName:    svgrName,
				})

				// add to packages if not already there
				if !slices.ContainsFunc(*packages, func(p Package) bool {
					return p.ImportPath == importPath
				}) {
					*packages = append(*packages, Package{
						ImportName: importName,
						ImportPath: importPath,
					})
				}
			}
		}
	}
}

func GenerateRegister(resources []Resource, packages []Package) {
	// Sort the entries
	sort.SliceStable(resources, func(i, j int) bool {
		return resources[i].Kind < resources[j].Kind // Descending kind
	})

	// Sort the entries
	sort.SliceStable(resources, func(i, j int) bool {
		return resources[i].Version > resources[j].Version // Ascending version
	})

	sort.SliceStable(resources, func(i, j int) bool {
		return resources[i].Group < resources[j].Group // Descending type
	})

	sort.SliceStable(packages, func(i, j int) bool {
		return packages[i].ImportName < packages[j].ImportName // Descending type
	})

	writepath, err := filepath.Abs("../pkg/plugin/resource/register_gen.go")
	if err != nil {
		panic(err)
	}

	// Parse the template for our resourcer files
	tmpl, err := template.ParseFiles("templates/register_gen.go.tmpl")
	if err != nil {
		panic(err)
	}

	if _, err := os.Stat(writepath); err == nil {
		os.Remove(writepath)
	}

	outputFile, err := os.Create(writepath)
	if err != nil {
		log.Fatalf("Failed to create output file: %v", err)
	}
	defer outputFile.Close()

	if err := tmpl.Execute(outputFile, &TemplateData{
		Resources: resources,
		Packages:  packages,
	}); err != nil {
		log.Fatalf("Failed to execute template: %v", err)
	}

	log.Println("Processing and sorting complete.")
}
