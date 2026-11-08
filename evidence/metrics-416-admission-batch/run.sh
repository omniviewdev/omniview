#!/bin/sh
# usage: run.sh NAME WORKLOAD DURATION
cd /Users/joshuapare/Repos/omniviewdev/workspaces
/tmp/o416/apisrv.sh > /tmp/o416/gt-$1-before.txt
/tmp/o416/omniview-dev diagnostics capture --workspace metrics-416 --root . --name "$1" --duration "$3" --workload "$2" --json > /tmp/o416/cap-$1.json 2>&1
/tmp/o416/apisrv.sh > /tmp/o416/gt-$1-after.txt
echo finished
