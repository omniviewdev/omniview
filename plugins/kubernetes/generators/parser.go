package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"slices"
	"sort"
	"strings"
	"sync"
	"text/template"
)

// OpenAPISpec represents the parts of the OpenAPI spec we are interested in
type OpenAPISpec struct {
	Definitions map[string]Definition `json:"definitions"`
}

// Definition represents a single definition in the OpenAPI spec
type Definition struct {
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

type TemplateData struct {
	// should be lowercase, no spaces the <group><version>
	PackageName string
	// <group>/<version>
	ImportPath string
	// ResourceName is just the Kind
	ResourceName string
	// <resource.lowercase.plural>
	SGVRName string
	// Description is the description of the resource
	// from the OpenAPI spec
	Description string
}

type ManagerPackage struct {
	// the package name
	PackageName string
	// the import path
	ImportPath string
}

type ManagerResource struct {
	// The name of the manager resource
	ResourceName string
	// the package name
	PackageName string
	// the version
	Version string
}

type ResourceManagerTemplateData struct {
	// the imports to add
	Packages []ManagerPackage
	// The resources to attach to the
	Resources []ManagerResource
}

func ParseOpenAPI(location string) {
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

	var entries []GroupVersionKind

	// Process each definition
	for _, def := range spec.Definitions {
		// Check if the definition has the required properties
		if _, ok := def.Properties["apiVersion"]; ok {
			if _, ok := def.Properties["kind"]; ok {
				if _, ok := def.Properties["metadata"]; ok {
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

						// add to entries
						entries = append(entries, gvk)
					}
				}
			}
		}
	}

	// Sort the entries
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Kind < entries[j].Kind // Descending kind
	})

	// Sort the entries
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Version > entries[j].Version // Ascending version
	})

	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Group < entries[j].Group // Descending type
	})

	// empty the resourcers directory
	// if it exists
	if _, err := os.Stat("resourcers"); err == nil {
		os.RemoveAll("resourcers")
	}

	// Create the resourcers directory
	if err := os.MkdirAll("resourcers", 0755); err != nil {
		log.Fatalf("Failed to create resourcers directory: %v", err)
	}

	// Parse the template for our resourcer files
	tmpl, err := template.ParseFiles("templates/resource_gen.go.tmpl")
	if err != nil {
		panic(err)
	}

	var wg sync.WaitGroup

	var managerResources []ManagerResource
	var managerPackages []ManagerPackage

	// Generate each resource on a goroutine to speed up the process
	for _, entry := range entries {
		// if the group version is dot separated, get the first part
		if len(entry.Group) > 0 {
			// check for out of bounds first
			if idx := strings.Index(entry.Group, "."); idx > 0 {
				entry.Group = entry.Group[:idx]
			}
		}

		managerResources = append(managerResources, ManagerResource{
			PackageName:  fmt.Sprintf("%s%s", entry.Group, entry.Version),
			ResourceName: entry.Kind,
			Version:      entry.Version,
		})

		managerPackages = append(managerPackages, ManagerPackage{
			PackageName: fmt.Sprintf("%s%s", entry.Group, entry.Version),
			ImportPath:  fmt.Sprintf("%s/%s", entry.Group, entry.Version),
		})

		wg.Add(1)
		go func(gvk GroupVersionKind) {
			defer wg.Done()
			GenerateResource(gvk, tmpl)
		}(entry)
	}

	wg.Wait()

	GenerateResourceManager(managerResources, managerPackages)

	// write out results to the output file
	if _, err := os.Stat("definitions.txt"); err == nil {
		os.Remove("definitions.txt")
	}

	outputFile, err := os.Create("definitions.txt")
	if err != nil {
		log.Fatalf("Failed to create output file: %v", err)
	}
	defer outputFile.Close()

	for _, entry := range entries {
		line := fmt.Sprintf("%s\t%s\t%s\n", entry.Group, entry.Version, entry.Kind)
		_, err := outputFile.WriteString(line)
		if err != nil {
			log.Fatalf("Failed to write to output file: %v", err)
		}
	}

	log.Println("Processing and sorting complete.")
}

func GenerateResource(gvk GroupVersionKind, template *template.Template) {
	resourceDir := fmt.Sprintf("resourcers/%s/%s", gvk.Group, gvk.Version)

	// Create the resource directory
	if err := os.MkdirAll(resourceDir, 0755); err != nil {
		log.Fatalf("Failed to create resource directory: %v", err)
	}

	// convert camelcase to snakecase
	generatedFile, err := os.Create(fmt.Sprintf("%s/%s.go", resourceDir, strings.ToLower(gvk.Kind)))
	if err != nil {
		log.Fatalf("Failed to create generated file: %v", err)
	}
	defer generatedFile.Close()

	// Create the template data
	data := TemplateData{
		PackageName:  fmt.Sprintf("%s%s", gvk.Group, gvk.Version),
		ImportPath:   fmt.Sprintf("%s/%s", gvk.Group, gvk.Version),
		ResourceName: gvk.Kind,
		SGVRName:     strings.ToLower(fmt.Sprintf("%s%s", gvk.Kind, "s")),
	}

	// Execute the template
	// and write the result to the generated file
	// using the data
	if err := template.Execute(generatedFile, data); err != nil {
		log.Fatalf("Failed to execute template: %v", err)
	}

	// Log the resource generation
	log.Printf("Generated resource: %s/%s/%s", gvk.Group, gvk.Version, gvk.Kind)
}

func GenerateResourceManager(resources []ManagerResource, packages []ManagerPackage) {
	// create and dedup the imports
	var dedupedPackages []ManagerPackage

	for _, entry := range packages {
		if !slices.ContainsFunc(dedupedPackages, func(p ManagerPackage) bool {
			return p.ImportPath == entry.ImportPath
		}) {
			dedupedPackages = append(dedupedPackages, entry)
		}
	}

	data := ResourceManagerTemplateData{
		Packages:  dedupedPackages,
		Resources: resources,
	}

	// write out the resourcer file
	managertmpl, err := template.ParseFiles("templates/resource_manager_gen.go.tmpl")
	if err != nil {
		panic(err)
	}

	// delete the file if it exists
	if _, err := os.Stat("resourcers/resource_manager_gen.go"); err == nil {
		os.Remove("resourcers/resource_manager_gen.go")
	}

	// convert camelcase to snakecase
	generatedFile, err := os.Create("resourcers/resource_manager_gen.go")
	if err != nil {
		log.Fatalf("Failed to create generated file: %v", err)
	}
	defer generatedFile.Close()

	// Execute the template
	// and write the result to the generated file
	// using the data
	if err := managertmpl.Execute(generatedFile, data); err != nil {
		log.Fatalf("Failed to execute template: %v", err)
	}

	// Log the resource generation
	log.Printf("Generated resource manager")
}
