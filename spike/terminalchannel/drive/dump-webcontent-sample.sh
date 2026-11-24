#!/bin/bash
cd /Users/joshuapare/Repos/omniviewdev/worktrees/spike-terminal-channel
BEFORE=$(ps -axo pid=,command= | grep -E "WebKit.WebContent" | grep -v grep | awk '{print $1}' | sort)
PROBE_SAMPLE_MS=600000 PROBE_SHOWN=1 PROBE_QUERY="transport=stream&scenario=flood&state=healthy&seconds=40&kind=flood10&ack=1&settle_ms=1500&quit=1&notes=0" /tmp/tcspike-native > /tmp/tc-native-run.log 2>&1 &
PID=$!
sleep 12
AFTER=$(ps -axo pid=,command= | grep -E "WebKit.WebContent" | grep -v grep | awk '{print $1}' | sort)
NEW=$(comm -13 <(echo "$BEFORE") <(echo "$AFTER"))
echo "new WebContent: $NEW"
for i in 1 2 3; do
for p in $NEW; do ps -o pid=,%cpu=,state=,rss=,wq=,nlwp= -p $p 2>/dev/null; sample $p 1 -file /tmp/tc-sample-$p-$i.txt >/dev/null 2>&1; grep -m1 -A18 "com.apple.main-thread" /tmp/tc-sample-$p-$i.txt | tail -6 | cut -c1-160; echo ---; done
sleep 3
done
echo "fds of WebContent:"; for p in $NEW; do lsof -p $p 2>/dev/null | wc -l; done
echo "host fds: $(lsof -p $PID 2>/dev/null | wc -l)"
kill $PID; sleep 2; kill -9 $PID 2>/dev/null
