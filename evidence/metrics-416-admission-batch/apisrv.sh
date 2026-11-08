#!/bin/sh
# Ground truth from metrics-server itself (requires port-forward on 14443)
curl -sk --cert /tmp/o416/c.crt --key /tmp/o416/c.key https://127.0.0.1:14443/metrics | grep -E 'group="metrics.k8s.io"' | grep -E '^apiserver_request_total|^apiserver_response_sizes_(sum|count)' | sed -E 's/^([a-z_]+)\{.*resource="([^"]*)".*scope="([^"]*)".*verb="([^"]*)".*\} ([0-9.e+]+)$/\1 \2 \3 \4 \5/' | sort
