#!/bin/bash
# second pass: the events baseline with the host's RSS sampled by the driver, and the own-port WebSocket (ws)
cd "$(dirname "$0")/../../.."
OUT=spike/terminalchannel/out/server-matrix2.jsonl
uptime
for s in healthy stalled; do for t in events stream ws; do
  sec=60; [ $s = stalled ] && sec=40
  node spike/terminalchannel/drive/server.mjs --transport $t --state $s --seconds $sec --stall_after 3 --browser chromium --out $OUT
done; done
node spike/terminalchannel/drive/server.mjs --transport ws --scenario echo --echo_n 300 --seconds 10 --browser chromium --out $OUT
node spike/terminalchannel/drive/server.mjs --transport ws --scenario echoflood --echo_n 200 --seconds 10 --browser chromium --out $OUT
uptime
echo MATRIX2-DONE
