#!/bin/bash
# B-110 with the REVIEWER'S clients: the real host (server build of this tree's main), his Go websocket reader (no acks)
# and his driver fast.mjs (an UNKEYED terminal: core/exec/stream/stdout events, as the legacy UI), then Playwright WebKit
# (the page the reviewer's number came with) against the probe's server build.
cd "$(dirname "$0")/../../.."
R=/Users/joshuapare/Notes/omniview/ui-migration/reviews/host-658-assets/followup-e457
mkdir -p /tmp/r658/bin /tmp/r658/js spike/wsclient
cp $R/go/zznative/wsclient/main.go spike/wsclient/main.go
cp $R/js/lib.mjs $R/js/fast.mjs /tmp/r658/js/
GOWORK=off GOTOOLCHAIN=local go build -o /tmp/r658/bin/wsclient ./spike/wsclient/ 2>&1 | grep -v "ld: warning" | grep -v "^# github.com"
GOWORK=off GOTOOLCHAIN=local go build -tags production,server -o /tmp/r658/bin/Omniview-server . 2>&1 | grep -v "ld: warning" | grep -v "^# github.com"
ls -la /tmp/r658/bin
uptime
echo "== reviewer's fast.mjs against the real host server build of main (Go reader, no acks, unkeyed terminal), 30 s"
(cd /tmp/r658/js && SECONDS=30 R_SERVER=/tmp/r658/bin/Omniview-server node fast.mjs 2>&1 | tail -14)
OUT=spike/terminalchannel/out/server-webkit.jsonl; rm -f $OUT
for s in healthy stalled; do for t in events stream; do
  sec=60; [ $s = stalled ] && sec=40
  node spike/terminalchannel/drive/server.mjs --transport $t --state $s --seconds $sec --stall_after 3 --browser webkit --out $OUT
done; done
python3 - <<'EOF'
import json
for line in open('/Users/joshuapare/Repos/omniviewdev/worktrees/spike-terminal-channel/spike/terminalchannel/out/server-webkit.jsonl'):
    d=json.loads(line); a=d['args']; r=d.get('report') or {}
    hs=[b['hostRSS'] for b in d.get('browserSamples',[]) if 'hostRSS' in b] or [None]
    br=[b['browserRSS'] for b in d.get('browserSamples',[])] or [None]
    print(f"WEBKIT {a['transport']:6} {a['state']:8} MB={r.get('bytes') and round(r['bytes']/1048576)} mbps={r.get('mbps') and round(r['mbps'],1)} host min/max/last={min(hs)}/{max(hs)}/{hs[-1]} browserRSS max={max(br)} ctrlC={r.get('ctrlCStopMs')} err={r.get('error') or r.get('errors')} report={'yes' if r else 'NO'}")
    print('     host series:', hs)
EOF
uptime
echo B110-DONE
