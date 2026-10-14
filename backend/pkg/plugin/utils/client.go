package utils

import (
	"context"
	"encoding/json"
	"log"

	"github.com/go-enry/go-enry/v2"
	"github.com/wailsapp/wails/v3/pkg/application"
	"gopkg.in/yaml.v3"
)

type Client struct{}

func NewClient() *Client {
	return &Client{}
}

func (c *Client) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

func (c *Client) ServiceShutdown() error {
	return nil
}

type GetLanguageInput struct {
	Filename string `json:"filename"`
	Contents string `json:"contents"`
}

// Editor language identifiers returned by DetectLanguage.
const (
	langABAP       = "abap"
	langCPP        = "cpp"
	langClojure    = "clojure"
	langCSS        = "css"
	langINI        = "ini"
	langJava       = "java"
	langJavaScript = "javascript"
	langHTML       = "html"
	langLua        = "lua"
	langMarkdown   = "markdown"
	langRuby       = "ruby"
	langXML        = "xml"
	langYAML       = "yaml"
	langPlainText  = "text"
)

//nolint:gochecknoglobals // helper map
var langMap = map[string]string{
	"ABAP":              langABAP,
	"Apex":              "apex",
	"C":                 langCPP,
	"Clojure":           langClojure,
	"C++":               langCPP,
	"CSS":               langCSS,
	"Dart":              "dart",
	"Dockerfile":        "dockerfile",
	"Elixir":            "elixir",
	"Erlang":            "erlang",
	"F#":                "fsharp",
	"Go":                "go",
	"GraphQL":           "graphql",
	"Handlebars":        "handlebars",
	"INI":               langINI,
	"Java":              langJava,
	"Java Properties":   "properties",
	"JavaScript":        langJavaScript,
	"Julia":             "julia",
	"HCL":               "hcl",
	"HTML":              langHTML,
	"Kotlin":            "kotlin",
	"Less":              "less",
	"Lua":               langLua,
	"Markdown":          langMarkdown,
	"MDX":               "mdx",
	"Nginx":             "nginx",
	"SQL":               "sql",
	"Objective-C":       "objective-c",
	"Python":            "python",
	"Perl":              "perl",
	"PHP":               "php",
	"PowerShell":        "powershell",
	"Protocol Buffer":   "protobuf",
	"Ruby":              langRuby,
	"Rust":              "rust",
	"Scala":             "scala",
	"SCSS":              "scss",
	"Shell":             "shell",
	"Swift":             "swift",
	"TypeScript":        "typescript",
	"Visual Basic .NET": "vb",
	"Visual Basic 6.0":  "vb",
	"XML":               langXML,
	"YAML":              langYAML,
}

var aceModeMap = map[string]string{
	langABAP:       langABAP,
	"c_cpp":        langCPP,
	langINI:        langINI,
	"sh":           "shell",
	langMarkdown:   langMarkdown,
	langXML:        langXML,
	langJava:       langJava,
	langHTML:       langHTML,
	langCSS:        langCSS,
	langJavaScript: langJavaScript,
	"csharp":       "csharp",
	langRuby:       langRuby,
	langLua:        langLua,
	langClojure:    langClojure,
	langYAML:       langYAML,
	"json":         "json",
	"pascal":       "pascal",
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
		lang = langPlainText
	}

	// try some others
	if lang == "" && attemptYamlDetection([]byte(params.Contents)) {
		lang = "YAML"
	}

	if lang == "" && attemptJSONDetection([]byte(params.Contents)) {
		lang = "JSON"
	}

	if lang == "" {
		lang = langPlainText
	}

	info, err := enry.GetLanguageInfo(lang)
	if err != nil {
		return langPlainText
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
	return langPlainText
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
