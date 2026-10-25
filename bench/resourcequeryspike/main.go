package main

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"time"
)

func main() {
	out, err := run()
	if err != nil {
		if e, ok := err.(*ObservationError); ok {
			out = Response{Error: e}
		} else {
			out = Response{Error: &ObservationError{Code: "INTERNAL", Detail: "probe setup failure"}}
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		os.Exit(1)
	}
}

func run() (Response, error) {
	b, err := io.ReadAll(io.LimitReader(os.Stdin, maxRequestBytes+1))
	if err != nil {
		return Response{}, fail("INVALID_REQUEST", "request read failed")
	}
	r, err := DecodeRequest(b)
	if err != nil {
		return Response{}, err
	}
	// Corpus input is the separately provenance-checked merged P44 export, not
	// user-selected arbitrary filesystem content or a product source fallback.
	b, err = os.ReadFile("corpus.json")
	if err != nil {
		return Response{}, err
	}
	var c Corpus
	if err := json.Unmarshal(b, &c); err != nil {
		return Response{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return Execute(ctx, r, c)
}
