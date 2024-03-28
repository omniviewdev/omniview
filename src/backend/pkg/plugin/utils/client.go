package utils

import (
	"encoding/json"
	"log"

	"github.com/go-enry/go-enry/v2"
	"gopkg.in/yaml.v3"
)

type Client struct{}

func NewClient() *Client {
	return &Client{}
}

type GetLanguageInput struct {
	Filename string `json:"filename"`
	Contents string `json:"contents"`
}

//nolint:gochecknoglobals // helper map
var langMap = map[string]string{
	"ABAP":              "abap",
	"Apex":              "apex",
	"C":                 "cpp",
	"Clojure":           "clojure",
	"C++":               "cpp",
	"CSS":               "css",
	"Dart":              "dart",
	"Dockerfile":        "dockerfile",
	"Elixir":            "elixir",
	"Erlang":            "erlang",
	"F#":                "fsharp",
	"Go":                "go",
	"GraphQL":           "graphql",
	"Handlebars":        "handlebars",
	"INI":               "ini",
	"Java":              "java",
	"Java Properties":   "properties",
	"JavaScript":        "javascript",
	"Julia":             "julia",
	"HCL":               "hcl",
	"HTML":              "html",
	"Kotlin":            "kotlin",
	"Less":              "less",
	"Lua":               "lua",
	"Markdown":          "markdown",
	"MDX":               "mdx",
	"Nginx":             "nginx",
	"SQL":               "sql",
	"Objective-C":       "objective-c",
	"Python":            "python",
	"Perl":              "perl",
	"PHP":               "php",
	"PowerShell":        "powershell",
	"Protocol Buffer":   "protobuf",
	"Ruby":              "ruby",
	"Rust":              "rust",
	"Scala":             "scala",
	"SCSS":              "scss",
	"Shell":             "shell",
	"Swift":             "swift",
	"TypeScript":        "typescript",
	"Visual Basic .NET": "vb",
	"Visual Basic 6.0":  "vb",
	"XML":               "xml",
	"YAML":              "yaml",
}

var aceModeMap = map[string]string{
	"abap":       "abap",
	"c_cpp":      "cpp",
	"ini":        "ini",
	"sh":         "shell",
	"markdown":   "markdown",
	"xml":        "xml",
	"java":       "java",
	"html":       "html",
	"css":        "css",
	"javascript": "javascript",
	"csharp":     "csharp",
	"ruby":       "ruby",
	"lua":        "lua",
	"clojure":    "clojure",
	"yaml":       "yaml",
	"json":       "json",
	"pascal":     "pascal",
}

// DetectLanguage detects the language of a file based on its filename and contents.
func (c *Client) DetectLanguage(params GetLanguageInput) string {
	var lang string
	switch {
	case params.Filename != "" && params.Contents != "":
		lang = enry.GetLanguage(params.Filename, []byte(params.Contents))
		log.Println("lang detected from both: ", lang)
	case params.Filename != "":
		lang, _ = enry.GetLanguageByExtension(params.Filename)
		log.Println("lang detected from only extension: ", lang)
	default:
		lang = "text"
	}

	// try some others
	if lang == "" && attemptYamlDetection([]byte(params.Contents)) {
		lang = "YAML"
	}

	if lang == "" && attemptJSONDetection([]byte(params.Contents)) {
		lang = "JSON"
	}

	if lang == "" {
		lang = "text"
	}

	info, err := enry.GetLanguageInfo(lang)
	if err != nil {
		return "text"
	}
	var ok bool
	lang, ok = langMap[info.Name]
	if ok {
		return lang
	}
	lang, ok = aceModeMap[info.AceMode]
	if ok {
		return lang
	}
	return "text"
}

func attemptYamlDetection(contents []byte) bool {
	m := make(map[interface{}]interface{})

	if err := yaml.Unmarshal(contents, &m); err != nil {
		log.Println("yaml err: ", err)
		return false
	}
	return true
}

func attemptJSONDetection(contents []byte) bool {
	m := make(map[string]interface{})

	if err := json.Unmarshal(contents, &m); err != nil {
		log.Println("json err: ", err)
		return false
	}
	return true
}
