// Command wsclient is a throwaway fast websocket reader for the review of #658: it reads every frame as fast as it can.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/coder/websocket"
)

func main() {
	url := os.Args[1]
	pause := len(os.Args) > 2 && os.Args[2] == "stall"
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		fmt.Println("DIAL-ERROR", err)
		os.Exit(1)
	}
	conn.SetReadLimit(1 << 30)
	if pause {
		fmt.Println("STALLED-CLIENT connected; never reads")
		time.Sleep(10 * time.Minute)
		return
	}
	var total, last int64
	tick := time.NewTicker(time.Second)
	go func() {
		for range tick.C {
			fmt.Printf("rx %.1f MiB/s total %.1f MiB\n", float64(total-last)/1048576, float64(total)/1048576)
			last = total
		}
	}()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			fmt.Println("READ-ERROR", err)
			return
		}
		total += int64(len(data))
	}
}
