#!/bin/bash
# The server build, a real Chromium (Playwright), each transport: healthy flood 60 s, stalled page 40 s, keystroke echo.
# Sequential on purpose: timings compare only on a quiet machine (uptime is printed first).
cd "$(dirname "$0")/../../.."
OUT=spike/terminalchannel/out/server-matrix.jsonl
uptime
for t in events stream wssame pull; do node spike/terminalchannel/drive/server.mjs --transport $t --state healthy --seconds 60 --browser chromium --out $OUT; done
for t in events stream wssame pull; do node spike/terminalchannel/drive/server.mjs --transport $t --state stalled --seconds 40 --stall_after 3 --browser chromium --out $OUT; done
for t in events stream wssame pull; do node spike/terminalchannel/drive/server.mjs --transport $t --scenario echo --echo_n 300 --seconds 10 --browser chromium --out $OUT; done
for t in events stream; do node spike/terminalchannel/drive/server.mjs --transport $t --scenario echoflood --echo_n 200 --seconds 10 --browser chromium --out $OUT; done
uptime
echo MATRIX-DONE
